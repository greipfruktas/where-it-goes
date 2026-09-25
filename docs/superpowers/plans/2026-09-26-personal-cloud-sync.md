# Personal Cloud Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one optional Google account entry point that automatically synchronizes Personal expenses, categories, icons, colors, and style across devices while preserving guest and offline behavior.

**Architecture:** Keep the existing Personal UI local-first and expose a small data bridge from `app.js`. New focused personal-sync modules normalize legacy data, maintain per-account caches and durable outboxes, and reconcile them through owner-only Supabase RPCs. The existing Supabase client and Google session become app-wide so the welcome screen, Personal, and Groups share one identity.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, browser ES modules, localStorage, Supabase JavaScript client v2, PostgreSQL/RLS/security-definer RPCs, Node.js assertion tests, GitHub Pages PWA.

**Spec:** `docs/superpowers/specs/2026-09-26-personal-cloud-sync-design.md`

## Global Constraints

- Guest Personal use remains available without an account and without a network connection.
- Personal mutations render and persist locally before any network request.
- Google sign-in automatically enables both Personal sync and Groups; no sync button is added.
- Expenses, categories, icons, colors, and selected style synchronize; temporary view/form state does not.
- Cloud rows are private to `auth.uid()` and group membership grants no personal-data access.
- Existing guest records are imported once per account/device and never silently discarded.
- Empty new-device defaults never overwrite existing cloud settings.
- Expense deletion uses tombstones so deleted data cannot reappear from an older cache.
- Supabase and OAuth traffic remain network-only in the service worker.
- No service-role key, Google secret, expense payload, or other sensitive record is logged or committed.

## Review Focus

- A second account signing in on the same device must never see the first account's cached data; Task 3 includes an account-switch isolation test.
- A delayed retry of an already-applied operation must not overwrite a newer edit; Task 1 includes an operation-id idempotency database test and Task 4 includes a retry regression.
- A fresh device's untouched defaults must not overwrite non-empty cloud settings; Task 2 includes a settings merge test.
- An offline deletion must remain deleted after another device reconnects with an older copy; Tasks 2 and 4 include tombstone merge tests.
- A failed or empty network response must not replace a non-empty local cache; Task 4 includes an interrupted-pull test.

---

## File Structure

- `supabase/migrations/003_personal_sync.sql`: private personal tables, RLS, operation idempotency, and atomic mutation RPC.
- `tests/personal-sync-policy.test.js`: static migration/security contract.
- `tests/personal-sync-policy.integration.sql`: owner/outsider/anonymous and operation-order behavior against PostgreSQL.
- `src/personal-sync/domain.js`: pure legacy normalization, stable IDs, cloud/local merge, and operation construction.
- `src/personal-sync/storage.js`: guest/account namespaces, durable outbox, import markers, and device identity.
- `src/personal-sync/repository.js`: Supabase reads, mutation RPC calls, and Realtime subscription.
- `src/personal-sync/controller.js`: sign-in import, pull/merge, outbox flush, retry triggers, and account switching.
- `src/account/view.js`: welcome/account-state markup only.
- `src/account/controller.js`: app-wide session, welcome path, OAuth destination restoration, Personal/Groups navigation, and sign-out.
- `app.js`: expose a narrow Personal data bridge and emit local mutation records without moving presentation logic.
- `src/groups/controller.js`: consume shared account/session actions instead of owning app-wide bootstrap.
- `index.html`, `styles.css`: welcome surface and unified signed-in shell.
- `sw.js`, `tests/group-contract.test.js`: cache new local modules and preserve network-only auth/data traffic.
- `privacy.html`, `docs/setup-supabase.md`: user-facing disclosure and exact migration/acceptance steps.

---

### Task 1: Owner-only personal data and idempotent mutation boundary

**Files:**
- Create: `supabase/migrations/003_personal_sync.sql`
- Create: `tests/personal-sync-policy.test.js`
- Create: `tests/personal-sync-policy.integration.sql`
- Modify: `docs/setup-supabase.md`

**Interfaces:**
- Produces: `personal_expenses`, `personal_settings`, and `personal_operations` tables.
- Produces: `public.apply_personal_operation(payload jsonb) returns boolean`; `true` means a new operation was applied and `false` means that operation ID was already accepted.
- Consumes: existing `profiles(id)` and `auth.uid()` identity created by migration 001.

- [ ] **Step 1: Write the failing static migration contract**

Create `tests/personal-sync-policy.test.js` to read migration 003 and assert all three tables, RLS, owner-only select policies, revoked direct mutations, the security-definer RPC, explicit `auth.uid()` validation, operation ID uniqueness, expense tombstones, settings JSON validation, and authenticated-only execute grant:

```js
import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync(new URL("../supabase/migrations/003_personal_sync.sql", import.meta.url), "utf8");
for (const table of ["personal_expenses", "personal_settings", "personal_operations"]) {
  assert.match(sql, new RegExp(`create table public\\.${table}`, "i"));
  assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
}
assert.match(sql, /primary key\s*\(owner_id, expense_id\)/i);
assert.match(sql, /primary key\s*\(owner_id, operation_id\)/i);
assert.match(sql, /deleted_at\s+timestamptz/i);
assert.match(sql, /create or replace function public\.apply_personal_operation\(payload jsonb\)/i);
assert.match(sql, /security definer[\s\S]+set search_path = public/i);
assert.match(sql, /owner_id\s*=\s*auth\.uid\(\)/i);
assert.match(sql, /revoke insert, update, delete on public\.personal_/i);
assert.match(sql, /grant execute on function public\.apply_personal_operation\(jsonb\) to authenticated/i);
```

- [ ] **Step 2: Run the static contract and verify RED**

Run: `node tests/personal-sync-policy.test.js`

Expected: FAIL because `003_personal_sync.sql` does not exist.

- [ ] **Step 3: Write the migration with transactional idempotency**

Implement normalized expense columns (`amount_minor bigint`, `category text`, `labels text[]`, `reimbursement_percent smallint`, `expense_date date`, `note text`, `created_at_client bigint`, `deleted_at timestamptz`) and a JSON settings row (`categories jsonb`, `style text`). The RPC must first insert `(auth.uid(), operation_id)` with `on conflict do nothing`; return `false` immediately when the insert did not occur, otherwise apply exactly one `expense_upsert`, `expense_delete`, or `settings_replace` operation and return `true`.

Use this mutation envelope consistently:

```json
{
  "operation_id": "device-id:42",
  "kind": "expense_upsert",
  "expense": {
    "id": "device-id:legacy-1700000000000",
    "amount_minor": 1299,
    "category": "Food",
    "labels": ["Must"],
    "reimbursement_percent": 50,
    "date": "2026-09-26",
    "note": "Dinner",
    "created_at_client": 1700000000000
  }
}
```

RLS permits `select` only when `owner_id = auth.uid()`. Revoke direct insert/update/delete from `authenticated`; all mutations use the RPC. Reject unknown kinds, missing IDs, invalid amounts/dates, malformed categories, style values outside `pocket|neon|swiss`, and payload owners supplied by the browser.

- [ ] **Step 4: Add behavioral SQL tests**

In `tests/personal-sync-policy.integration.sql`, create two fixture users and assert:

```sql
-- As owner A: an operation applies once, its retry returns false, and a later
-- unique operation updates the row.
select public.apply_personal_operation('{"operation_id":"a:1","kind":"expense_upsert",...}'::jsonb);
select public.apply_personal_operation('{"operation_id":"a:1","kind":"expense_upsert",...}'::jsonb);

-- As user B and anonymous: A's expense/settings rows return zero rows and
-- direct table writes fail.

-- Delete operation keeps the row with deleted_at set; retrying an older
-- already-accepted operation cannot clear that tombstone.
```

Reuse the disposable PostgreSQL/Supabase fixture pattern from `tests/sql-policy-fixture.sql`. Do not weaken tests when the local database runner is unavailable; record that integration execution is deferred to the configured Supabase test database while the static contract still runs.

- [ ] **Step 5: Verify Task 1**

Run:

```bash
node tests/personal-sync-policy.test.js
node tests/sql-policy.test.js
```

Expected: both PASS. Run `tests/personal-sync-policy.integration.sql` through the same PostgreSQL fixture used for the existing SQL integration suite and expect all assertions to complete without exception.

- [ ] **Step 6: Document migration order and commit**

Update `docs/setup-supabase.md` to run `003_personal_sync.sql` after 001 and 002, list the two new Realtime tables (`personal_expenses`, `personal_settings`), and include owner/outsider verification. Commit:

```bash
git add supabase/migrations/003_personal_sync.sql tests/personal-sync-policy.test.js tests/personal-sync-policy.integration.sql docs/setup-supabase.md
git commit -m "feat(sync): add private personal data schema"
```

---

### Task 2: Pure normalization and deterministic merge rules

**Files:**
- Create: `src/personal-sync/domain.js`
- Create: `tests/personal-sync-domain.test.js`

**Interfaces:**
- Produces: `normalizeLegacyExpenses(items, deviceId, nextOperationId) -> { expenses, operations, invalid }`.
- Produces: `mergeExpenseRows(localRows, cloudRows) -> expenseRow[]`, including tombstone rows; server `updated_at` order decides matching IDs while unrelated IDs are additive. Callers render only rows without `deletedAt`.
- Produces: `chooseInitialSettings({ local, cloud, localIsDefault }) -> { settings, upload }`.
- Produces: `expenseToOperation(expense, operationId)` and `deletionToOperation(expenseId, operationId)`.

- [ ] **Step 1: Write failing domain tests**

Create `tests/personal-sync-domain.test.js` with real data assertions:

```js
const legacy = [{ id: 1700000000000, amount: 12.5, category: "Food", labels: ["Must"], reimbursementPercent: 50, date: "2026-09-26", note: "Lunch", createdAt: 1700000000000 }];
const normalized = normalizeLegacyExpenses(legacy, "phone-a", () => "phone-a:1");
assert.equal(normalized.expenses[0].id, "phone-a:legacy-1700000000000");
assert.equal(normalized.expenses[0].amount, 12.5);
assert.deepEqual(normalized.expenses[0].labels, ["Must"]);

assert.equal(
  mergeExpenseRows([{ id: "e1", amount: 10, serverUpdatedAt: "2026-09-26T10:00:00Z" }], [{ id: "e1", deletedAt: "2026-09-26T11:00:00Z", serverUpdatedAt: "2026-09-26T11:00:00Z" }])[0].deletedAt,
  "2026-09-26T11:00:00Z"
);

assert.deepEqual(
  chooseInitialSettings({ local: defaultSettings, cloud: customCloudSettings, localIsDefault: true }),
  { settings: customCloudSettings, upload: false }
);
```

Also cover invalid records, UUID/string IDs that must remain stable, two devices with identical legacy numeric IDs, an offline tombstone beating an older cloud copy, additive unrelated records, and both sides populated.

- [ ] **Step 2: Run domain tests and verify RED**

Run: `node tests/personal-sync-domain.test.js`

Expected: FAIL because `src/personal-sync/domain.js` does not exist.

- [ ] **Step 3: Implement the pure functions**

Use integer minor units only at the repository boundary; preserve the Personal UI's decimal `amount` in local snapshots. Never mutate input arrays. Validate finite positive amounts, ISO dates, labels arrays, reimbursement in `0..100`, and category/note strings. Return invalid records separately when normalization cannot safely preserve them rather than silently dropping them.

Settings equality must compare normalized category name/icon/color/order plus style, not object identity. `localIsDefault` is true only when both stored category and style keys were absent before initial rendering.

- [ ] **Step 4: Verify Task 2 and commit**

Run:

```bash
node tests/personal-sync-domain.test.js
node tests/category-breakdown.test.js
node tests/design-refresh.test.js
```

Expected: all PASS.

Commit:

```bash
git add src/personal-sync/domain.js tests/personal-sync-domain.test.js
git commit -m "feat(sync): add personal merge rules"
```

---

### Task 3: Per-account local storage and Personal data bridge

**Files:**
- Create: `src/personal-sync/storage.js`
- Create: `tests/personal-sync-storage.test.js`
- Modify: `app.js`
- Modify: `tests/category-breakdown.test.js`
- Modify: `tests/design-refresh.test.js`

**Interfaces:**
- Produces: `createPersonalStorage(storage, { deviceIdFactory })` with `guestSnapshot()`, `accountSnapshot(userId)`, `saveAccountSnapshot(userId, snapshot)`, `outbox(userId)`, `enqueue(userId, operation)`, `ack(userId, operationId)`, `hasImportedGuest(userId)`, and `markGuestImported(userId)`. Account snapshots retain tombstone rows; the Personal bridge receives only active expenses.
- Produces in `app.js`: `globalThis.whereItGoesPersonalData` with `snapshot()`, `replaceSnapshot(snapshot)`, `useNamespace(namespace, snapshot)`, `onMutation(listener)`, and `showStorageError(message)`.
- Mutation listener receives `{ kind, expense?, expenseId?, settings? }` after the local write succeeds.

- [ ] **Step 1: Write failing storage and bridge tests**

Use an in-memory Storage stub to assert stable device ID creation, separate `guest`, `user-a`, and `user-b` caches, durable FIFO outbox, idempotent `ack`, and per-user guest-import markers.

Extend the VM-based Personal tests to assert:

```js
assert.equal(typeof sandbox.whereItGoesPersonalData.snapshot, "function");
assert.equal(typeof sandbox.whereItGoesPersonalData.replaceSnapshot, "function");

const before = sandbox.whereItGoesPersonalData.snapshot();
sandbox.whereItGoesPersonalData.useNamespace("user-a", userASnapshot);
assert.deepEqual(sandbox.whereItGoesPersonalData.snapshot().expenses, userASnapshot.expenses);
sandbox.whereItGoesPersonalData.useNamespace("user-b", userBSnapshot);
assert.doesNotMatch(JSON.stringify(sandbox.whereItGoesPersonalData.snapshot()), /user-a-secret/);
```

Trigger save, edit, delete, category rename, and style selection and assert each emits the matching mutation only after local persistence.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node tests/personal-sync-storage.test.js
node tests/category-breakdown.test.js
node tests/design-refresh.test.js
```

Expected: FAIL for missing storage module/bridge.

- [ ] **Step 3: Implement namespaced storage**

Retain legacy guest keys (`where-it-goes-expenses-v1`, `where-it-goes-groups-v1`, `where-it-goes-style-v1`). Use `where-it-goes-personal-cache-v2:<userId>`, `where-it-goes-personal-outbox-v2:<userId>`, `where-it-goes-personal-imported-v1:<userId>`, and one `where-it-goes-device-id-v1` key for account state. Parse defensively and write whole JSON values atomically with one `setItem` call.

- [ ] **Step 4: Add the bridge without changing Personal presentation**

Refactor only the persistence boundary in `app.js`: all existing rendering and input handlers remain. `replaceSnapshot` updates expenses/categories/style, persists to the active namespace, reinitializes choices, applies style without emitting a local settings mutation, and renders once. `useNamespace` clears selected edit IDs and unsaved form state before swapping account data.

Expense delete emits a tombstone mutation before removing the visible record. Storage quota errors call the existing toast through `showStorageError` and preserve the previous in-memory snapshot.

- [ ] **Step 5: Verify Task 3 and commit**

Run:

```bash
node tests/personal-sync-storage.test.js
node tests/category-breakdown.test.js
node tests/design-refresh.test.js
```

Expected: all PASS and existing export/category behavior unchanged.

Commit:

```bash
git add src/personal-sync/storage.js tests/personal-sync-storage.test.js app.js tests/category-breakdown.test.js tests/design-refresh.test.js
git commit -m "refactor(personal): expose local data bridge"
```

---

### Task 4: Repository and automatic synchronization controller

**Files:**
- Create: `src/personal-sync/repository.js`
- Create: `src/personal-sync/controller.js`
- Create: `tests/personal-sync-repository.test.js`
- Create: `tests/personal-sync-controller.test.js`

**Interfaces:**
- Repository produces `pull(userId) -> { expenses, settings }`, `apply(operation) -> boolean`, and `subscribe(userId, onChange, onStatus)`.
- Controller consumes `{ repository, storage, personalData, auth, networkState, documentState }`.
- Controller produces `startSession(user)`, `stopSession()`, `syncNow()`, `status()`, and `dispose()`.

- [ ] **Step 1: Write failing repository tests**

Assert exact Supabase calls: owner-filtered selects for `personal_expenses` and `.single()`/`.maybeSingle()` settings, `rpc("apply_personal_operation", { payload })`, and Realtime filters on `owner_id=eq.<userId>`. Verify Supabase errors reject without exposing payload contents in the message.

- [ ] **Step 2: Run repository test and verify RED**

Run: `node tests/personal-sync-repository.test.js`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement repository and verify GREEN**

Map database minor units back to local decimal amounts exactly, carry `updated_at` as `serverUpdatedAt`, and retain tombstones in repository results for domain merge. Do not query another user's rows even though RLS also protects them.

Run: `node tests/personal-sync-repository.test.js`

Expected: PASS.

- [ ] **Step 4: Write failing controller tests**

Cover these flows with real storage/domain code and a narrow fake repository:

```js
await controller.startSession({ id: "user-a" });
assert.deepEqual(personalData.snapshot().expenses.map(x => x.id).sort(), ["cloud-1", "phone-a:legacy-1"]);
assert.equal(storage.hasImportedGuest("user-a"), true);

// Failed pull leaves non-empty local data untouched.
repository.pull = async () => { throw new Error("offline"); };
await assert.rejects(() => controller.syncNow());
assert.equal(personalData.snapshot().expenses.length, 2);

// Same operation retry is sent again until acknowledged but cannot duplicate.
// Signing out switches to guest; signing user-b in never renders user-a cache.
// Offline delete remains in outbox and wins after reconnect.
```

Also assert untouched defaults do not enqueue settings before the initial cloud pull, a failed operation remains in FIFO order, successful operations are acknowledged individually, concurrent `syncNow()` calls share one promise, and Realtime/online/visibility events schedule rather than overlap pulls.

- [ ] **Step 5: Run controller test and verify RED**

Run: `node tests/personal-sync-controller.test.js`

Expected: FAIL because the controller does not exist.

- [ ] **Step 6: Implement local-first orchestration**

On `startSession`, capture guest data, load the account cache, pull cloud, perform the one-time guest merge, flush generated import operations, then render the merged account snapshot. If offline or pull fails, render an existing account cache only after Supabase identifies the user; never borrow another account cache. Attach the Personal mutation listener only for the active namespace.

Serialize synchronization with one in-flight promise. Flush outbox entries sequentially, acknowledging only successful operations; stop at the first network/auth failure to preserve order. Pull after a successful flush. `stopSession` unsubscribes Realtime, detaches listeners, clears in-memory user identity, and restores the guest snapshot.

- [ ] **Step 7: Verify Task 4 and commit**

Run:

```bash
node tests/personal-sync-domain.test.js
node tests/personal-sync-storage.test.js
node tests/personal-sync-repository.test.js
node tests/personal-sync-controller.test.js
```

Expected: all PASS.

Commit:

```bash
git add src/personal-sync/repository.js src/personal-sync/controller.js tests/personal-sync-repository.test.js tests/personal-sync-controller.test.js
git commit -m "feat(sync): synchronize personal expenses automatically"
```

---

### Task 5: Unified welcome, authentication, and Personal/Groups shell

**Files:**
- Create: `src/account/view.js`
- Create: `src/account/controller.js`
- Create: `tests/account-controller.test.js`
- Create: `tests/account-view.test.js`
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `src/groups/controller.js`
- Modify: `src/groups/view.js`
- Modify: `src/groups/supabase.js`
- Modify: `tests/group-controller.test.js`
- Modify: `tests/group-view.test.js`

**Interfaces:**
- Account controller consumes the shared Supabase `client`, group controller, personal-sync controller, welcome root, app shell, location/history, and network state.
- Produces `start()`, `continueWithGoogle(destination)`, `continueAsGuest()`, `showPersonal()`, `showGroups()`, and `signOut()`.
- Groups controller no longer constructs a second client or owns the global sign-out/session bootstrap.

- [ ] **Step 1: Write failing view tests**

Assert the welcome markup contains exactly one Google action and one guest action, is escaped, and contains no sync/backup controls. Assert signed-in shell includes Personal/Groups plus one account/avatar action. Add a guest Groups state that explains sign-in enables both cloud Personal and Groups; replace the obsolete “Personal expenses stay only on this device” copy for signed-in-capable flow.

- [ ] **Step 2: Run view tests and verify RED**

Run:

```bash
node tests/account-view.test.js
node tests/group-view.test.js
```

Expected: FAIL because account view does not exist and old copy remains.

- [ ] **Step 3: Implement welcome HTML/CSS and view renderer**

Add `#welcomeRoot` outside `#appShell`; wrap the mode switch, `#personalRoot`, and `#groupsRoot` in `#appShell`. Initially hide both until session resolution prevents guest/account data flashing. Match existing Pocket Ledger typography, colors, large iPhone touch targets, safe-area insets, and all three style variables without adding a fourth visual system.

- [ ] **Step 4: Write failing account-controller tests**

Assert:

- Existing session skips welcome, starts Personal sync, and opens Personal unless an invite/Groups return destination exists.
- No session shows welcome and touches neither account cache nor Groups repository.
- Guest action opens Personal without network calls.
- Google action stores exact destination and invokes existing OAuth once.
- OAuth return starts sync before exposing account Personal.
- Invitation return remains intact and opens joined Groups.
- Personal and Groups use the same session/user.
- Sign-out stops sync before showing guest data and does not erase account/cloud rows.
- Offline cached session may open cached Personal; offline unsigned Google action shows an actionable error.

- [ ] **Step 5: Run controller tests and verify RED**

Run: `node tests/account-controller.test.js`

Expected: FAIL because account controller does not exist.

- [ ] **Step 6: Refactor to one app-wide bootstrap**

Move browser startup from the bottom of `src/groups/controller.js` into `src/account/controller.js`. Create one Supabase client using `supabase/config.js`; construct both repositories/controllers with it. Extend `src/groups/supabase.js` to store/consume `{ destination, invite }` rather than only a raw return path. Keep pure `createGroupsController` exports intact for tests.

The account controller waits for `client.auth.getSession()`, subscribes to `onAuthStateChange`, and ignores duplicate initial events. It must call `personalSync.startSession(user)` before unhiding signed-in Personal. Groups sign-out delegates to the account controller so cache isolation always runs.

- [ ] **Step 7: Verify Task 5 and commit**

Run:

```bash
node tests/account-view.test.js
node tests/account-controller.test.js
node tests/group-view.test.js
node tests/group-controller.test.js
node tests/category-breakdown.test.js
node tests/design-refresh.test.js
```

Expected: all PASS.

Commit:

```bash
git add src/account/view.js src/account/controller.js tests/account-view.test.js tests/account-controller.test.js index.html styles.css src/groups/controller.js src/groups/view.js src/groups/supabase.js tests/group-controller.test.js tests/group-view.test.js
git commit -m "feat(account): unify Personal and Groups sign-in"
```

---

### Task 6: PWA integration, privacy, provisioning, and release acceptance

**Files:**
- Modify: `sw.js`
- Modify: `tests/group-contract.test.js`
- Modify: `privacy.html`
- Modify: `tests/privacy-page.test.js`
- Modify: `docs/setup-supabase.md`

**Interfaces:**
- Consumes all new local modules and migration 003.
- Produces a deployable GitHub Pages build only after production migration success.

- [ ] **Step 1: Write failing PWA/privacy contracts**

Extend `tests/group-contract.test.js` to require every `src/personal-sync/*.js` and `src/account/*.js` asset in the cache, exact cache version `where-it-goes-v22`, query/hash bypass, cross-origin bypass, and explicit Supabase network bypass.

Extend `tests/privacy-page.test.js` to assert clear disclosure of guest device storage, Google-authenticated cloud sync, private personal data, local cached copies after sign-out, and a contact/deletion path without claiming that Groups members can see Personal.

- [ ] **Step 2: Run contracts and verify RED**

Run:

```bash
node tests/group-contract.test.js
node tests/privacy-page.test.js
```

Expected: FAIL for missing assets/version/disclosures.

- [ ] **Step 3: Update service worker, privacy, and setup guide**

Increment the cache name, add only same-origin static modules, and preserve network-only handling for `.supabase.co`, OAuth-bearing query/hash navigations, and CDN assets. Update privacy and setup/rollback instructions. Rollback must hide welcome/sync bootstrap without clearing legacy guest localStorage or weakening RLS.

- [ ] **Step 4: Run the complete local suite**

Run:

```bash
for test in tests/*.test.js; do node "$test" || exit 1; done
git diff --check
```

Expected: exit 0 with no warnings. Then run a local server and verify at iPhone width: welcome → guest Personal, Google button route, existing-session Personal, Personal/Groups switch, expense add/edit/delete, category edit, style selection, offline Personal, and no console errors.

- [ ] **Step 5: Review before external changes**

Request a whole-branch code/security review. Resolve critical and important findings with regression tests, rerun the complete suite, and keep the worktree clean.

- [ ] **Step 6: Pause for migration and publishing confirmation**

Present the reviewed migration and build outcome. Obtain explicit confirmation before running migration 003 in the production Supabase project or pushing the release to GitHub `main`.

- [ ] **Step 7: Apply production migration and Realtime configuration**

Run `003_personal_sync.sql` in Supabase SQL Editor, verify success, and enable Realtime for `personal_expenses` and `personal_settings`. Verify anonymous and cross-account reads fail before deployment.

- [ ] **Step 8: Publish and verify deployment**

Push the reviewed commit to `main`, wait for the GitHub Pages deployment to succeed, and verify cache-busted live assets show the unified welcome and account shell. Confirm the deployed controller and migration hashes match the reviewed commit.

- [ ] **Step 9: Perform two-profile acceptance**

Using one Google account in two browser profiles/devices:

1. In profile A, enter as guest, add an expense, rename a category/icon, and choose another style.
2. Sign in and confirm the guest data remains.
3. Sign into the same account in profile B and confirm expense/category/icon/color/style match.
4. Take A offline, edit/add/delete, reconnect, and confirm B converges without a deleted record returning.
5. Sign out on B and confirm account data disappears from guest Personal.
6. Sign in as a different Google account and confirm A's personal data is absent.
7. Confirm Groups create/join/expense/repayment still works.

Record commit SHA, Pages run URL, migration result, browser/profile matrix, and each pass/fail observation in the task ledger. If a second Google account is not available, report cross-account browser acceptance as pending while retaining the automated RLS proof; do not claim it passed.

- [ ] **Step 10: Commit final docs if evidence changed tracked files**

```bash
git add sw.js privacy.html docs/setup-supabase.md tests/group-contract.test.js tests/privacy-page.test.js
git commit -m "docs(sync): finalize personal sync rollout"
```

Do not create an empty commit when all tracked release documentation was committed earlier.
