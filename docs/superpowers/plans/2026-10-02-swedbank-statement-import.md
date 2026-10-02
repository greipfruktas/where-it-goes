# Swedbank Statement Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user privately import a Swedbank `.xlsx` or `.xls` statement, review and correct outgoing transactions, and save selected rows as Personal expenses with remembered categories and duplicate protection.

**Architecture:** A vendored SheetJS build feeds a Swedbank-only parser, then pure categorization, duplicate, and import-domain modules prepare temporary review rows. A controller and view own the review sheet, while a narrow bridge in `app.js` performs one validated local batch commit and emits the existing Personal sync operations. Learned merchant rules live in the Personal settings snapshot and sync through an additive Supabase migration.

**Tech Stack:** Browser File API, SheetJS CE, ES modules, Web Crypto SHA-256, localStorage, Supabase/Postgres, service worker cache, Node.js assertion tests.

**Spec:** `docs/superpowers/specs/2026-10-02-swedbank-statement-import-design.md`

## Global Constraints

- Support Swedbank Lithuanian `.xlsx` and legacy `.xls` files up to exactly 10 MB.
- Parse the workbook locally from an `ArrayBuffer`; never upload or log statement contents.
- Import only negative transactions; count and ignore zero or positive amounts.
- Never persist the workbook, incoming rows, balances, account holder names, or account numbers.
- Keep all parsed rows, edits, selections, and pending rules temporary until a successful batch save.
- Use deterministic IDs prefixed with `swedbank:` and exclude existing IDs by default.
- Save a selected batch atomically to local state; a validation error saves none of it.
- Preserve Pocket Ledger, Midnight Ledger, and Minimal Swiss behavior and mobile layout.
- Keep existing owner-only RLS and write-through-RPC protections.
- Treat workbook text as untrusted data and render it only through escaping/text APIs.

## Review Focus

- A workbook whose used-range metadata says `A1` but contains a real table must still discover the table and parse rows (Task 1 test).
- Lithuanian decimal commas, non-breaking spaces, and Excel date representations must not change the amount or calendar day (Task 1 test).
- Two identical purchases in one statement must get distinct stable IDs, while a re-import gets the same pair (Task 3 test).
- An older client sending `settings_replace` without `import_rules` must preserve stored rules (Task 6 migration test).
- A selected row becoming invalid after editing must block the entire batch, leaving expenses and rules unchanged (Task 4 test).

---

### Task 1: Workbook dependency, fixtures, and Swedbank parser

**Files:**
- Create: `vendor/xlsx.full.min.js`
- Create: `vendor/sheetjs-LICENSE.txt`
- Create: `tests/fixtures/swedbank-sanitized.xlsx`
- Create: `tests/fixtures/swedbank-sanitized.xls`
- Create: `src/import/swedbank-parser.js`
- Create: `tests/swedbank-parser.test.js`

**Interfaces:**
- Consumes: SheetJS global/object exposing `read`, `utils.sheet_to_json`, and `SSF.parse_date_code`.
- Produces: `parseSwedbankWorkbook(arrayBuffer, XLSX) -> { transactions, unreadableRows }`, where each transaction is `{ date, signedAmount, merchant, description, sourceRow }`.

- [ ] **Step 1: Vendor and document the pinned SheetJS CE browser build**

Add the unmodified minified distribution and its license. Record the exact version and upstream download URL at the top of `vendor/sheetjs-LICENSE.txt`; verify the build exposes the interface above and contains no remote loader.

- [ ] **Step 2: Create sanitized `.xlsx` and `.xls` fixtures**

Preserve the reference layout and headers `Data`, `Gavėjas/Mokėtojas`, `Paaiškinimai`, `Apyvarta`, and optional `Likutis`. Include summary rows, a deliberately incorrect worksheet dimension in the `.xlsx`, negative and positive amounts, a duplicate pair, an Excel serial date, a date cell, a Lithuanian date string, one malformed row, and no real personal or merchant data.

- [ ] **Step 3: Write the failing parser test**

Assert both fixtures parse to the same normalized transaction fields; the `A1` dimension does not hide the table; all three date forms retain their calendar day; `-1 234,56` becomes `-1234.56`; summary/balance rows are absent; and the malformed row increments `unreadableRows`. Also assert missing headers, no transactions, and wholly invalid date/amount workbooks reject with stable error messages.

- [ ] **Step 4: Run the parser test to verify it fails**

Run: `node tests/swedbank-parser.test.js`

Expected: FAIL because `src/import/swedbank-parser.js` does not exist.

- [ ] **Step 5: Implement `parseSwedbankWorkbook(arrayBuffer, XLSX)`**

Discover the header row by Unicode-normalized header values, force SheetJS to inspect the real populated range when worksheet metadata is too narrow, and normalize dates to local `YYYY-MM-DD` without UTC conversion. Return valid transaction rows and a malformed-row count; do not return ignored account or balance data.

- [ ] **Step 6: Run the parser test to verify it passes**

Run: `node tests/swedbank-parser.test.js`

Expected: PASS with no output.

- [ ] **Step 7: Commit**

```bash
git add vendor src/import/swedbank-parser.js tests/fixtures tests/swedbank-parser.test.js
git commit -m "feat: parse Swedbank statement files"
```

### Task 2: Merchant categorization and learned rules

**Files:**
- Create: `src/import/categorizer.js`
- Create: `tests/import-categorizer.test.js`

**Interfaces:**
- Consumes: merchant and description strings, current category objects, and `{ merchantKey, category, updatedAt }[]` learned rules.
- Produces: `normalizeMerchant(text) -> string`, `categorizeTransaction(transaction, categories, learnedRules) -> { category, merchantKey, source }`, and `upsertLearnedRule(rules, merchantKey, category, updatedAt) -> Rule[]`.

- [ ] **Step 1: Write the failing categorizer test**

Assert Unicode/case/whitespace and known terminal suffixes normalize consistently without merging distinct merchants; a learned rule overrides a built-in match; conservative grocery, restaurant, transport, fuel, home, bill, health, shopping, insurance, and entertainment terms map only to present category names; missing/renamed targets and unmatched text return `Other`; and upserting replaces only the matching merchant rule.

- [ ] **Step 2: Run the categorizer test to verify it fails**

Run: `node tests/import-categorizer.test.js`

Expected: FAIL because the categorizer module does not exist.

- [ ] **Step 3: Implement the categorizer interfaces**

Keep built-in rules as explicit keyword groups. Match learned rules first, then built-ins, then the current `Other` category; do not interpret merchant text as markup, selectors, regular expressions, or code.

- [ ] **Step 4: Run the categorizer test to verify it passes**

Run: `node tests/import-categorizer.test.js`

Expected: PASS with no output.

- [ ] **Step 5: Commit**

```bash
git add src/import/categorizer.js tests/import-categorizer.test.js
git commit -m "feat: categorize imported transactions"
```

### Task 3: Deterministic IDs and import review domain

**Files:**
- Create: `src/import/duplicates.js`
- Create: `src/import/domain.js`
- Create: `tests/import-domain.test.js`

**Interfaces:**
- Consumes: parsed transactions, categories, learned rules, current expenses, date bounds, edited review rows, and a SHA-256 provider.
- Produces: `assignImportIds(transactions, digest) -> Promise<TransactionWithId[]>`, `createReviewState(input) -> Promise<ReviewState>`, `filterReviewRows(state, from, to) -> ReviewState`, `updateReviewRow(state, id, patch) -> ReviewState`, `reviewSummary(state) -> Summary`, and `buildImportBatch(state, now) -> { expenses, learnedRules }`.

- [ ] **Step 1: Write the failing duplicate/domain test**

Assert SHA-256 input uses bank/date/minor amount/normalized merchant/normalized description/occurrence number; identical same-day rows receive stable `:1` and `:2` inputs and distinct `swedbank:` IDs across re-imports; existing IDs start unchecked and may be manually reselected; incoming rows are counted but absent; date bounds auto-detect and can narrow/reverse safely; `Other`, outside-range, duplicate, unreadable, and incoming summary counts are correct; edits do not mutate the source; and cancelling has no persistent side effect.

- [ ] **Step 2: Run the domain test to verify it fails**

Run: `node tests/import-domain.test.js`

Expected: FAIL because the domain modules do not exist.

- [ ] **Step 3: Implement deterministic IDs**

Use amount minor units and normalized text, number otherwise-identical rows in original statement order, digest with Web Crypto-compatible SHA-256, encode lowercase hexadecimal, and prefix with `swedbank:`.

- [ ] **Step 4: Implement the review-domain interfaces**

Convert negative signed amounts to positive expenses, keep status and selection separate from editable expense fields, and make every transition return a new state. `Select all new` must leave duplicate rows unchecked; `Exclude all` unchecks every row.

- [ ] **Step 5: Run the domain test to verify it passes**

Run: `node tests/import-domain.test.js`

Expected: PASS with no output.

- [ ] **Step 6: Commit**

```bash
git add src/import/duplicates.js src/import/domain.js tests/import-domain.test.js
git commit -m "feat: prepare statement import batches"
```

### Task 4: Atomic Personal bridge and rule persistence

**Files:**
- Modify: `app.js`
- Create: `tests/personal-import-bridge.test.js`

**Interfaces:**
- Consumes: `buildImportBatch` output and the current Personal namespace.
- Produces: `whereItGoesPersonalData.snapshot()` including `importRules`, `commitImportBatch({ expenses, learnedRules })`, and existing mutation events for every saved expense plus one `settings_replace` event.

- [ ] **Step 1: Write the failing bridge test**

Load the bridge through a minimal fake DOM/localStorage harness. Assert guest rules use `where-it-goes-import-rules-v1`; account rules live in the account snapshot; a valid batch inserts new IDs and replaces matching duplicate IDs without creating two rows; all rows are persisted before events fire; category corrections save with the batch; and one invalid edited row leaves both expenses and rules byte-for-byte unchanged and emits no mutations.

- [ ] **Step 2: Run the bridge test to verify it fails**

Run: `node tests/personal-import-bridge.test.js`

Expected: FAIL because `commitImportBatch` and `importRules` are absent.

- [ ] **Step 3: Extend Personal state with `importRules`**

Update guest loading, account cache persistence, snapshots, namespace replacement, and category rename handling. Normalize learned rules to non-empty strings, valid current categories, and finite timestamps.

- [ ] **Step 4: Implement atomic `commitImportBatch({ expenses, learnedRules })`**

Validate the full batch using the manual-expense constraints before assigning any new state. Commit one cloned state update, persist once, emit `expense_upsert` for each selected expense and `settings_replace` with categories/style/importRules, render, and return the saved count.

- [ ] **Step 5: Run the bridge and existing Personal tests**

Run: `node tests/personal-import-bridge.test.js && node tests/personal-sync-domain.test.js && node tests/category-breakdown.test.js`

Expected: all commands PASS.

- [ ] **Step 6: Commit**

```bash
git add app.js tests/personal-import-bridge.test.js
git commit -m "feat: commit personal imports atomically"
```

### Task 5: Import sheet, row editor, and controller

**Files:**
- Create: `src/import/view.js`
- Create: `src/import/controller.js`
- Create: `tests/import-view.test.js`
- Create: `tests/import-controller.test.js`
- Modify: `index.html`
- Modify: `styles.css`

**Interfaces:**
- Consumes: the Task 1 parser, Task 2 categorizer, Task 3 domain, vendored `XLSX`, and `whereItGoesPersonalData`.
- Produces: `renderImportSheet(root, state, categories)`, `createImportController({ root, fileReader, XLSX, personalData, digest, notify })`, and an Import toolbar button opening an accessible modal sheet.

- [ ] **Step 1: Write the failing view test**

Assert markup contains a file picker accepting `.xlsx,.xls`, filename, privacy copy, editable From/To controls, all summary counts, include checkboxes, category emoji and label, `Other`/duplicate status, `Select all new`, `Exclude all`, row edit controls, cancel, and `Save selected expenses`. Assert imported `<img onerror=...>`-style text is escaped and never appears as active markup.

- [ ] **Step 2: Write the failing controller test**

With fake file, view, and Personal dependencies, assert unsupported extension and files over 10 MB reject before reading; unreadable/encrypted/missing-header/empty files show stable errors; selection and edits remain temporary; closing clears the file input and state; category edits create pending rules; save calls `commitImportBatch` once and reports local success even if later cloud sync is unavailable; invalid rows remain visible with errors; and successful save closes and resets the importer.

- [ ] **Step 3: Run both tests to verify they fail**

Run: `node tests/import-view.test.js && node tests/import-controller.test.js`

Expected: FAIL because the view and controller modules do not exist.

- [ ] **Step 4: Implement `renderImportSheet`**

Render through escaped strings or DOM text properties, maintain labels/ARIA for every input, and keep one compact row layout that expands into the existing category-icon, label, reimbursement, date, amount, and description controls.

- [ ] **Step 5: Implement `createImportController`**

Read one `ArrayBuffer`, retain only temporary normalized data, route all actions through domain transitions, derive pending rules from explicit category edits, and delegate the sole persistent action to `commitImportBatch`.

- [ ] **Step 6: Add the import entry point and responsive styles**

Place the Import icon beside style/export controls. Add the sheet root and module script after `app.js`; ensure 320 px width has no horizontal overflow, date/category fields remain within the sheet, touch targets are at least 44 px, keyboard focus stays usable, and closing restores body scrolling.

- [ ] **Step 7: Run the view/controller and static mobile tests**

Run: `node tests/import-view.test.js && node tests/import-controller.test.js && node tests/group-mobile-ux.test.js && node tests/design-refresh.test.js`

Expected: all commands PASS.

- [ ] **Step 8: Commit**

```bash
git add src/import/view.js src/import/controller.js tests/import-view.test.js tests/import-controller.test.js index.html styles.css
git commit -m "feat: add statement import review flow"
```

### Task 6: Learned-rule cloud sync and backward-compatible migration

**Files:**
- Create: `supabase/migrations/005_personal_import_rules.sql`
- Modify: `src/personal-sync/domain.js`
- Modify: `src/personal-sync/storage.js`
- Modify: `src/personal-sync/repository.js`
- Modify: `src/personal-sync/controller.js`
- Modify: `tests/personal-sync-domain.test.js`
- Modify: `tests/personal-sync-storage.test.js`
- Modify: `tests/personal-sync-repository.test.js`
- Modify: `tests/personal-sync-controller.test.js`
- Create: `tests/personal-import-rules-policy.test.js`

**Interfaces:**
- Consumes: Personal snapshots/settings with `importRules` and existing `settings_replace` operations.
- Produces: cloud rows using `import_rules`, settings operations carrying `import_rules`, and a migration that preserves stored rules when the JSON field is omitted.

- [ ] **Step 1: Write failing sync tests**

Assert storage round-trips account and guest `importRules`; repository selects/maps `import_rules`; controller includes rules in render/cache/upload and preserves them across pull/merge; `settings_replace` serializes them as `import_rules`; malformed cloud values normalize to `[]`; and existing categories/style behavior is unchanged.

- [ ] **Step 2: Write the failing migration policy test**

Assert migration 005 adds `import_rules jsonb not null default '[]'` with an array check, validates supplied rules, retains owner-only RLS and RPC-only writes, updates rules when present, preserves existing rules when omitted by an old client, and defaults to `[]` on a first old-client insert.

- [ ] **Step 3: Run sync/policy tests to verify they fail**

Run: `node tests/personal-sync-domain.test.js && node tests/personal-sync-storage.test.js && node tests/personal-sync-repository.test.js && node tests/personal-sync-controller.test.js && node tests/personal-import-rules-policy.test.js`

Expected: at least the new rule assertions FAIL.

- [ ] **Step 4: Implement import-rule mapping through Personal sync**

Use camelCase `importRules` in browser state and snake_case `import_rules` only at the Supabase boundary. `chooseInitialSettings` must treat categories, style, and rules as one coherent settings snapshot.

- [ ] **Step 5: Implement migration 005**

Use `alter table` plus `create or replace function`. In `settings_replace`, distinguish `payload ? 'import_rules'` from a missing field; validate each supplied rule object and preserve the current column on an update when missing.

- [ ] **Step 6: Run all sync/policy tests**

Run: `node tests/personal-sync-domain.test.js && node tests/personal-sync-storage.test.js && node tests/personal-sync-repository.test.js && node tests/personal-sync-controller.test.js && node tests/personal-sync-policy.test.js && node tests/personal-import-rules-policy.test.js`

Expected: all commands PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/005_personal_import_rules.sql src/personal-sync tests/personal-sync-*.test.js tests/personal-import-rules-policy.test.js
git commit -m "feat: sync learned import categories"
```

### Task 7: Offline cache, privacy copy, and end-to-end import contract

**Files:**
- Modify: `sw.js`
- Modify: `privacy.html`
- Create: `tests/import-integration.test.js`
- Modify: `tests/privacy-page.test.js`
- Modify: `tests/design-refresh.test.js`

**Interfaces:**
- Consumes: all import modules and assets from Tasks 1–6.
- Produces: an offline-capable import release and an automated sanitized fixture journey.

- [ ] **Step 1: Write the failing integration and release-contract tests**

Assert the sanitized fixture parses, auto-detects dates, categorizes, exposes review edits, saves selected rows, re-imports with every saved deterministic ID excluded, and allows one duplicate override without adding a second ID. Assert `index.html` loads the import module and local SheetJS file, `sw.js` caches every import module/vendor asset/fixture-independent runtime asset under a new cache version, and privacy copy says statement files stay on-device and only saved expenses/rules sync for signed-in users.

- [ ] **Step 2: Run the release-contract tests to verify they fail**

Run: `node tests/import-integration.test.js && node tests/privacy-page.test.js && node tests/design-refresh.test.js`

Expected: FAIL on missing offline/privacy release wiring.

- [ ] **Step 3: Update offline and privacy wiring**

Bump the service worker cache version, cache SheetJS and all six import modules, keep Supabase requests network-only, and update the privacy page without claiming that saved signed-in data remains exclusively local.

- [ ] **Step 4: Run the complete automated suite**

Run: `for test in tests/*.test.js; do node "$test" || exit 1; done`

Expected: every test exits 0.

- [ ] **Step 5: Commit**

```bash
git add sw.js privacy.html tests/import-integration.test.js tests/privacy-page.test.js tests/design-refresh.test.js
git commit -m "feat: finish offline statement import"
```

### Task 8: Migration, mobile verification, and publication

**Files:**
- Modify only if verification reveals a defect: files owned by Tasks 1–7 and their matching tests.

**Interfaces:**
- Consumes: completed implementation, linked Supabase project, and GitHub Pages deployment.
- Produces: verified database support and a published PWA release.

- [ ] **Step 1: Apply migration 005 to the linked Supabase project**

Apply `supabase/migrations/005_personal_import_rules.sql`, then verify `personal_settings.import_rules`, its array constraint, and the replaced RPC exist. Test both a new settings write with rules and an old-style write without the field.

- [ ] **Step 2: Perform browser and iPhone-width verification**

At 320 px, 390 px, and desktop widths, test all three themes: open importer; reject bad type/oversize; load the sanitized `.xlsx` and `.xls`; adjust From/To; edit category/labels/reimbursement/date/amount/description; exclude rows; cancel without changes; save; re-import; override one duplicate; confirm overview/history totals; and confirm no horizontal overflow or keyboard zoom/stuck scrolling.

- [ ] **Step 3: Verify offline installation behavior**

Load once online, update the service worker, then go offline and confirm the installed PWA opens the importer and parses both fixtures without fetching SheetJS from a CDN.

- [ ] **Step 4: Run final automated verification**

Run: `git diff --check && for test in tests/*.test.js; do node "$test" || exit 1; done && git status --short`

Expected: no whitespace errors, every test exits 0, and only intentional verification fixes are listed.

- [ ] **Step 5: Commit any verification fixes**

```bash
git add <only-the-files-fixed-during-verification>
git commit -m "fix: polish statement import release"
```

Skip this step when verification required no code changes.

- [ ] **Step 6: Publish and verify GitHub Pages**

Push `main`, wait for GitHub Pages deployment, open the published app with a cache-busting release query, confirm the new service worker controls the page, and repeat one `.xlsx` import/save/re-import smoke test. Do not use the user's real statement for published testing.
