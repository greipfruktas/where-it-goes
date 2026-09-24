# Shared Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add private, Google-authenticated shared expense groups with equal splits, live activity, calculated balances, invitations, and repayments while leaving the existing personal tracker unchanged.

**Architecture:** Keep GitHub Pages as the static host and add Supabase for Google authentication, PostgreSQL storage, row-level security, and real-time updates. Isolate shared-group domain calculations, remote persistence, and UI control in small ES modules; the existing `app.js` remains the personal tracker and exposes only the minimal navigation hooks Groups needs.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, browser ES modules, Supabase JavaScript client v2, PostgreSQL/Supabase migrations, Node.js assertion tests, GitHub Pages PWA.

**Spec:** `docs/superpowers/specs/2026-09-24-shared-groups-design.md`

## Global Constraints

- Existing personal expenses remain in `localStorage`, private to the device, and usable offline.
- Shared Groups requires Google sign-in and an internet connection.
- All currency values use integer minor units; no floating-point balance arithmetic.
- Version one supports one payer and equal splits between selected active members only.
- Every shared participant is a real Google-authenticated user; manual members are excluded.
- No service-role key or Google client secret may appear in browser code or Git history.
- Only active group members may read group records; mutation permissions follow the approved owner/creator rules.
- Financial deletion is soft deletion, and historical names remain visible after member removal.
- The app remains installable and usable on iPhone from the existing GitHub Pages URL.

## Review Focus

- A split that leaves a cent remainder must allocate it deterministically and still equal the original amount; Task 1 tests this.
- Rapid retry after a network timeout must not create duplicate expenses or repayments; Tasks 3 and 5 test idempotency.
- A removed member or outsider must lose read/write access immediately; Task 2 tests row-level security.
- An OAuth redirect from an invitation must restore the invitation destination without exposing group data first; Tasks 3 and 4 test this.
- An archived group or offline device must become read-only without affecting Personal mode; Tasks 6 and 8 test this.

---

## File Map

- `src/groups/domain.js`: pure amount parsing, equal-share allocation, balance netting, transfer simplification, and validation.
- `src/groups/supabase.js`: Supabase client creation, session handling, Google OAuth, and invitation return state.
- `src/groups/repository.js`: all shared-data reads and writes behind one browser-facing interface.
- `src/groups/view.js`: safe shared-group markup and DOM rendering helpers.
- `src/groups/controller.js`: Groups navigation, form state, subscriptions, retries, and coordination.
- `supabase/config.js`: committed browser-safe Supabase project URL and anonymous key obtained during provisioning.
- `supabase/migrations/001_shared_groups.sql`: schema, constraints, helper functions, row-level security, invitation join, and atomic/idempotent write operations.
- `index.html`: Personal/Groups mode navigation and shared-group views/sheets.
- `styles.css`: responsive shared-group styling using the existing A/B/C design tokens.
- `app.js`: minimal integration so the Personal add button and views retain existing behavior.
- `sw.js`: new cache version and new local module assets; remote Supabase API requests are never cached.
- `tests/group-domain.test.js`: deterministic unit tests for money and balances.
- `tests/group-contract.test.js`: static contract checks for HTML, module wiring, cache list, and secret hygiene.
- `tests/group-repository.test.js`: mocked repository tests for payloads, error propagation, and idempotency.
- `tests/group-view.test.js`: rendering and escaping tests.
- `tests/group-controller.test.js`: controller tests for sign-in return, offline state, duplicate submits, and Personal regression boundaries.
- `tests/sql-policy.test.js`: migration contract checks for required policies, constraints, and RPC functions.
- `docs/setup-supabase.md`: exact dashboard setup, redirect URLs, Google provider configuration, migration, and verification steps.

### Task 1: Pure shared-expense domain

**Files:**
- Create: `src/groups/domain.js`
- Create: `tests/group-domain.test.js`

**Interfaces:**
- Consumes: plain objects and integer minor-unit amounts.
- Produces: `parseMinorUnits(input)`, `allocateEqualShares(amountMinor, memberIds)`, `calculateNetBalances(expenses, repayments)`, `simplifyTransfers(netBalances)`, `validateExpenseDraft(draft, activeMemberIds)`, and `validateRepaymentDraft(draft, activeMemberIds, suggestedTransfers)`.

- [ ] **Step 1: Write failing tests for parsing, equal allocation, and validation**

```js
import assert from "node:assert/strict";
import {
  parseMinorUnits,
  allocateEqualShares,
  validateExpenseDraft
} from "../src/groups/domain.js";

assert.equal(parseMinorUnits("12.34"), 1234);
assert.equal(parseMinorUnits("12,34"), 1234);
assert.throws(() => parseMinorUnits("0"), /greater than zero/);
assert.deepEqual(allocateEqualShares(1000, ["c", "a", "b"]), [
  { memberId: "a", shareMinor: 334 },
  { memberId: "b", shareMinor: 333 },
  { memberId: "c", shareMinor: 333 }
]);
assert.deepEqual(validateExpenseDraft({
  amountMinor: 1000,
  payerId: "a",
  participantIds: ["a", "b"],
  description: "Dinner",
  category: "Food",
  date: "2026-09-24"
}, ["a", "b"]), []);
assert.match(validateExpenseDraft({
  amountMinor: 1000,
  payerId: "removed",
  participantIds: ["a"],
  description: "Dinner",
  category: "Food",
  date: "2026-09-24"
}, ["a"])[0], /payer/i);
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run: `node tests/group-domain.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/groups/domain.js`.

- [ ] **Step 3: Implement parsing, sorted deterministic remainder allocation, and explicit validation errors**

```js
export function allocateEqualShares(amountMinor, memberIds) {
  const ids = [...new Set(memberIds)].sort();
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || ids.length === 0) {
    throw new Error("A positive integer amount and at least one participant are required");
  }
  const base = Math.floor(amountMinor / ids.length);
  const remainder = amountMinor % ids.length;
  return ids.map((memberId, index) => ({
    memberId,
    shareMinor: base + (index < remainder ? 1 : 0)
  }));
}
```

Implement `parseMinorUnits` without binary floating-point multiplication: normalize comma to period, validate with `/^\d+(?:\.\d{1,2})?$/`, split whole/fraction text, and combine integer digits. Return arrays of concrete user-facing messages from both validators.

- [ ] **Step 4: Add failing tests for balances, repayments, and deterministic simplification**

```js
import { calculateNetBalances, simplifyTransfers, validateRepaymentDraft } from "../src/groups/domain.js";

const net = calculateNetBalances([
  { payerId: "a", amountMinor: 900, shares: [
    { memberId: "a", shareMinor: 300 },
    { memberId: "b", shareMinor: 300 },
    { memberId: "c", shareMinor: 300 }
  ] }
], [{ payerId: "b", recipientId: "a", amountMinor: 100 }]);
assert.deepEqual(net, { a: 500, b: -200, c: -300 });
assert.deepEqual(simplifyTransfers(net), [
  { payerId: "c", recipientId: "a", amountMinor: 300 },
  { payerId: "b", recipientId: "a", amountMinor: 200 }
]);
assert.match(validateRepaymentDraft({
  payerId: "b", recipientId: "a", amountMinor: 201, date: "2026-09-24"
}, ["a", "b"], [{ payerId: "b", recipientId: "a", amountMinor: 200 }])[0], /exceed/i);
```

- [ ] **Step 5: Implement balance and transfer functions, then run tests**

Run: `node tests/group-domain.test.js`

Expected: PASS with no output.

- [ ] **Step 6: Commit the independently testable domain layer**

```bash
git add src/groups/domain.js tests/group-domain.test.js
git commit -m "Add shared expense balance calculations"
```

### Task 2: Supabase schema and access controls

**Files:**
- Create: `supabase/migrations/001_shared_groups.sql`
- Create: `tests/sql-policy.test.js`

**Interfaces:**
- Consumes: Supabase `auth.users` and `auth.uid()`.
- Produces: tables `profiles`, `groups`, `group_members`, `group_invites`, `group_expenses`, `expense_participants`, `group_repayments`; functions `is_active_group_member(uuid)`, `is_group_owner(uuid)`, `join_group(text)`, `save_group_expense(jsonb)`, and `save_group_repayment(jsonb)`.

- [ ] **Step 1: Write a failing migration contract test**

```js
import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync(new URL("../supabase/migrations/001_shared_groups.sql", import.meta.url), "utf8");
for (const table of ["profiles", "groups", "group_members", "group_invites", "group_expenses", "expense_participants", "group_repayments"]) {
  assert.match(sql, new RegExp(`create table(?: if not exists)? public\\.${table}`, "i"));
  assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
}
for (const fn of ["join_group", "save_group_expense", "save_group_repayment"]) {
  assert.match(sql, new RegExp(`create or replace function public\\.${fn}`, "i"));
}
assert.match(sql, /unique\s*\(group_id, idempotency_key\)/i);
assert.doesNotMatch(sql, /service_role/i);
```

- [ ] **Step 2: Run the test and verify the migration is missing**

Run: `node tests/sql-policy.test.js`

Expected: FAIL with `ENOENT`.

- [ ] **Step 3: Write the schema with integer-money and history constraints**

Use `bigint` plus `check (amount_minor > 0)` for amounts, `date` for financial dates, `timestamptz` for audit times, `deleted_at` for soft deletion, and `uuid` foreign keys. Add a unique `(group_id, idempotency_key)` constraint to both expense and repayment tables. Add a trigger that copies new authenticated users into `profiles` using their Google display name and avatar metadata.

- [ ] **Step 4: Add row-level policies and security-definer RPC functions**

Implement membership reads through `is_active_group_member`, owner actions through `is_group_owner`, and creator-or-owner mutation policies. Lock each `security definer` function to `set search_path = public`, verify `auth.uid()` internally, revoke public execution, and grant execution only to `authenticated`.

`save_group_expense(jsonb)` must validate active payer/participants, insert or reuse by idempotency key, allocate exact submitted shares in one transaction, and reject archived groups. `save_group_repayment(jsonb)` must validate distinct active members and insert or reuse atomically. `join_group(text)` hashes the presented token with `digest(..., 'sha256')`, checks active/unexpired status, and upserts membership.

- [ ] **Step 5: Extend policy tests for the four actor classes**

Assert the migration contains explicit policies covering owner, member, removed-member exclusion via `status = 'active'`, and outsider exclusion. Assert invitation tokens are stored as `token_hash`, not plaintext, and that archive state is checked in write RPCs.

- [ ] **Step 6: Run the SQL contract test**

Run: `node tests/sql-policy.test.js`

Expected: PASS with no output.

- [ ] **Step 7: Commit the database boundary**

```bash
git add supabase/migrations/001_shared_groups.sql tests/sql-policy.test.js
git commit -m "Add secure shared groups database schema"
```

### Task 3: Supabase browser client and repository

**Files:**
- Create: `supabase/config.js`
- Create: `src/groups/supabase.js`
- Create: `src/groups/repository.js`
- Create: `tests/group-repository.test.js`

**Interfaces:**
- Consumes: `window.supabase.createClient`, browser storage, and the Task 2 tables/RPCs.
- Produces: `createGroupsClient(config)`, `signInWithGoogle(returnPath)`, `consumeAuthReturn()`, `createGroupsRepository(client)`, and repository methods `listGroups`, `getGroup`, `createGroup`, `joinGroup`, `saveExpense`, `saveRepayment`, `archiveGroup`, `reopenGroup`, `removeMember`, `transferOwnership`, `rotateInvite`, `disableInvite`, and `subscribeToGroup`.

- [ ] **Step 1: Write repository tests with a recording Supabase stub**

```js
import assert from "node:assert/strict";
import { createGroupsRepository } from "../src/groups/repository.js";

const calls = [];
const client = {
  rpc: async (name, args) => { calls.push({ name, args }); return { data: { id: "expense-1" }, error: null }; }
};
const repository = createGroupsRepository(client);
await repository.saveExpense({ groupId: "g", idempotencyKey: "once", amountMinor: 501, payerId: "a", participantShares: [
  { memberId: "a", shareMinor: 251 }, { memberId: "b", shareMinor: 250 }
] });
assert.equal(calls[0].name, "save_group_expense");
assert.equal(calls[0].args.payload.idempotency_key, "once");
```

Add a second assertion that calling `saveExpense` twice with the same draft preserves the same idempotency key, and an error assertion that a Supabase error becomes an `Error` with its original message.

- [ ] **Step 2: Run the test and verify it fails on the missing repository**

Run: `node tests/group-repository.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the auth client and repository adapters**

`signInWithGoogle(returnPath)` stores `returnPath` in `sessionStorage` and calls OAuth with `redirectTo` set to `${location.origin}${location.pathname}`. `consumeAuthReturn()` returns and removes the stored path only after a valid session exists. Repository methods unwrap `{ data, error }` consistently and never perform balance arithmetic.

- [ ] **Step 4: Provision the external services and write the returned public configuration**

In Supabase, create the production project, enable Google authentication, add the live GitHub Pages URL and local test URL to allowed redirects, run `001_shared_groups.sql`, and enable Realtime for shared tables. In Google Cloud, create the OAuth web client using the callback URL shown by Supabase. Copy the project URL and browser-safe anonymous key returned by the created project into `supabase/config.js`, exporting `Object.freeze({ url, anonKey })`. Before committing, confirm the key is labelled anonymous/publishable and is not a service-role or secret key. This step uses the generated production values directly; it must not commit sample strings or replacement markers.

- [ ] **Step 5: Run repository tests and scan for prohibited secrets**

Run: `node tests/group-repository.test.js`

Expected: PASS with no output.

Run: `rg -n "service_role|client_secret|SUPABASE_SERVICE" . -g '!docs/**'`

Expected: no matches.

- [ ] **Step 6: Commit client and persistence adapters**

```bash
git add supabase/config.js src/groups/supabase.js src/groups/repository.js tests/group-repository.test.js
git commit -m "Connect shared groups to Supabase"
```

### Task 4: Shared Groups shell, sign-in, and invitations

**Files:**
- Create: `src/groups/view.js`
- Create: `src/groups/controller.js`
- Create: `tests/group-view.test.js`
- Create: `tests/group-controller.test.js`
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `app.js`

**Interfaces:**
- Consumes: Task 3 auth/repository and the existing `data-style` theme state.
- Produces: `escapeGroupHTML`, `renderGroupsList`, `renderGroupShell`, and `createGroupsController({ repository, auth, root, navigatorState })` with `start()`, `showGroups()`, and `showPersonal()`.

- [ ] **Step 1: Write failing rendering tests**

```js
import assert from "node:assert/strict";
import { escapeGroupHTML, renderGroupsList } from "../src/groups/view.js";

assert.equal(escapeGroupHTML(`<img onerror="x">`), "&lt;img onerror=&quot;x&quot;&gt;");
const html = renderGroupsList([{ id: "g1", name: "<Trip>", icon: "✈️", currency: "EUR" }]);
assert.match(html, /&lt;Trip&gt;/);
assert.doesNotMatch(html, /<Trip>/);
```

- [ ] **Step 2: Write failing controller tests for invitation restoration and offline mode**

Use a fake auth object whose `consumeAuthReturn()` returns `?invite=abc` and a fake repository whose `joinGroup("abc")` records the token. Assert `start()` joins then opens the returned group. Set `navigatorState.onLine = false`; assert Groups renders the offline state and does not call a write method. Assert switching back to Personal does not call or mutate `localStorage`.

- [ ] **Step 3: Run the tests and verify both modules are missing**

Run: `node tests/group-view.test.js && node tests/group-controller.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 4: Add Personal/Groups navigation and signed-out/signed-in shells**

Add a top-level two-option mode switch labelled **Personal** and **Groups**. Keep the existing Personal DOM inside its current shell. Add a single `#groupsRoot` region with loading, signed-out, group-list, invitation-error, and group-detail states rendered by `view.js`. Load Supabase JS v2 and `src/groups/controller.js` as modules after `app.js`.

- [ ] **Step 5: Implement sign-in, sign-out, group list, creation, and invitation acceptance**

The controller restores `?invite=TOKEN` across OAuth, validates it through `joinGroup`, removes only the invite query parameter with `history.replaceState`, and shows invalid/expired/disabled messages without group metadata. The group creation form collects name, icon, ISO currency code, and optional dates and prevents duplicate submission until the first request resolves.

- [ ] **Step 6: Implement theme-aware, accessible mobile styling**

Reuse existing CSS custom properties. Ensure 44px minimum touch targets, visible focus states, `aria-live` status, fixed-sheet safe-area padding, and 16px minimum form font size to prevent iPhone input zoom. Preserve Styles A/B/C.

- [ ] **Step 7: Run focused and existing regression tests**

Run: `node tests/group-view.test.js && node tests/group-controller.test.js && node tests/category-breakdown.test.js && node tests/design-refresh.test.js`

Expected: all commands exit 0.

- [ ] **Step 8: Commit the authenticated Groups shell**

```bash
git add index.html styles.css app.js src/groups/view.js src/groups/controller.js tests/group-view.test.js tests/group-controller.test.js
git commit -m "Add signed-in shared groups shell"
```

### Task 5: Expense entry, activity, and live synchronization

**Files:**
- Modify: `src/groups/view.js`
- Modify: `src/groups/controller.js`
- Modify: `src/groups/repository.js`
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `tests/group-view.test.js`
- Modify: `tests/group-controller.test.js`
- Modify: `tests/group-repository.test.js`

**Interfaces:**
- Consumes: `allocateEqualShares`, `validateExpenseDraft`, and repository `saveExpense`/`subscribeToGroup`.
- Produces: `renderActivity`, `renderExpenseForm`, controller actions `openExpense`, `submitExpense`, `editExpense`, and `deleteExpense`.

- [ ] **Step 1: Add failing tests for safe activity rendering and default participants**

Assert a new expense defaults payer to the current user, date to the local calendar date, and participants to every active member. Assert descriptions/categories are HTML-escaped and deleted records are absent from the default activity list.

- [ ] **Step 2: Add failing controller tests for idempotent retry and form preservation**

Submit a draft with a fixed generated UUID, make the first repository call reject with `Network unavailable`, and assert the form values and UUID remain. Retry and assert the same UUID is sent. Trigger two simultaneous submits and assert only one repository call occurs.

- [ ] **Step 3: Implement the short amount-first expense sheet**

Use amount, description, category, date, payer, and participant controls. Compute shares through `allocateEqualShares` before calling the repository. Keep the form open and populated on failure; show a retry status. On success, close the sheet and refresh activity/balances.

- [ ] **Step 4: Implement creator/owner edit and soft-delete actions**

Render edit/delete only when the current profile is the entry creator or group owner. Confirm deletion, call repository soft-delete, and keep the original activity immutable for unauthorized users.

- [ ] **Step 5: Wire Realtime with focus-refresh fallback**

Subscribe to expense, participant, repayment, membership, and group changes for the open group. Debounce all events into one `loadGroup(groupId)` refresh. When subscription status is not `SUBSCRIBED`, refresh after local writes and on `visibilitychange` when the document becomes visible.

- [ ] **Step 6: Run focused tests**

Run: `node tests/group-domain.test.js && node tests/group-repository.test.js && node tests/group-view.test.js && node tests/group-controller.test.js`

Expected: all commands exit 0.

- [ ] **Step 7: Commit expense collaboration**

```bash
git add src/groups/view.js src/groups/controller.js src/groups/repository.js index.html styles.css tests/group-view.test.js tests/group-controller.test.js tests/group-repository.test.js
git commit -m "Add shared group expense activity"
```

### Task 6: Balances and repayments

**Files:**
- Modify: `src/groups/view.js`
- Modify: `src/groups/controller.js`
- Modify: `src/groups/repository.js`
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `tests/group-view.test.js`
- Modify: `tests/group-controller.test.js`
- Modify: `tests/group-repository.test.js`

**Interfaces:**
- Consumes: `calculateNetBalances`, `simplifyTransfers`, `validateRepaymentDraft`, loaded expenses/repayments/members.
- Produces: `renderSettlementSuggestions`, `renderRepaymentForm`, and controller actions `openRepayment` and `submitRepayment`.

- [ ] **Step 1: Add failing view tests for settlement suggestions**

Assert `{ a: 500, b: -200, c: -300 }` renders exactly “C owes A €3.00” and “B owes A €2.00” using member display names, and that zero balances render “All settled”. Assert removed members still render their historical display names.

- [ ] **Step 2: Add failing repayment tests**

Assert tapping a suggestion prefills payer, recipient, and exact amount. Assert overpayment, equal payer/recipient, inactive members, and zero values prevent repository calls. Assert a failed save preserves the generated idempotency key for retry.

- [ ] **Step 3: Implement balances and repayment sheet**

Calculate balances locally from loaded exact shares and repayment events. Render suggested transfers above activity. Submit only validated repayments, preserve the form on failure, and refresh/subscription-update on success.

- [ ] **Step 4: Test archived-group read-only behavior**

Add a controller test with `group.status = "archived"`; assert balances and activity render, while Add Expense, Repay, edit, delete, and invitation actions are disabled. Assert Personal mode remains interactive.

- [ ] **Step 5: Run all group tests**

Run: `node tests/group-domain.test.js && node tests/group-repository.test.js && node tests/group-view.test.js && node tests/group-controller.test.js && node tests/sql-policy.test.js`

Expected: all commands exit 0.

- [ ] **Step 6: Commit settlements**

```bash
git add src/groups/view.js src/groups/controller.js src/groups/repository.js index.html styles.css tests/group-view.test.js tests/group-controller.test.js tests/group-repository.test.js
git commit -m "Add group balances and repayments"
```

### Task 7: Membership, invitations, and ownership controls

**Files:**
- Modify: `src/groups/view.js`
- Modify: `src/groups/controller.js`
- Modify: `src/groups/repository.js`
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `tests/group-view.test.js`
- Modify: `tests/group-controller.test.js`
- Modify: `tests/group-repository.test.js`

**Interfaces:**
- Consumes: current group/member roles and Task 3 owner repository methods.
- Produces: owner settings UI for invitation copying/rotation/disabling, removal, ownership transfer, archive, and reopen.

- [ ] **Step 1: Add failing permission-rendering tests**

Assert ordinary members never receive owner controls in rendered HTML. Assert owners receive controls, cannot remove themselves while another active member exists, and must select a new owner before leaving.

- [ ] **Step 2: Add failing controller tests for destructive confirmations**

Assert member removal, invitation rotation, and archive call the repository only after confirmation. Assert cancellation produces no write. Assert successful removal refreshes immediately and a repository `not authorized` response exits the removed user's group detail to the group list.

- [ ] **Step 3: Implement owner settings and invitation sharing**

Use the Web Share API when available and clipboard fallback otherwise. Invitation rotation invalidates the old link before displaying the new one. Display only active member names and avatars in controls; preserve removed names in historical activity.

- [ ] **Step 4: Implement transfer-before-leave and archive/reopen**

Require ownership transfer to an active member before the owner can leave a group with other members. Archive disables writes and invitations; reopen restores writes but requires a newly rotated invitation.

- [ ] **Step 5: Run focused tests and commit**

Run: `node tests/group-repository.test.js && node tests/group-view.test.js && node tests/group-controller.test.js`

Expected: all commands exit 0.

```bash
git add src/groups/view.js src/groups/controller.js src/groups/repository.js index.html styles.css tests/group-view.test.js tests/group-controller.test.js tests/group-repository.test.js
git commit -m "Add shared group owner controls"
```

### Task 8: PWA caching, setup guide, and integration verification

**Files:**
- Modify: `sw.js`
- Create: `tests/group-contract.test.js`
- Create: `docs/setup-supabase.md`

**Interfaces:**
- Consumes: every browser module and asset created by Tasks 3–7.
- Produces: installable cached local shell, uncached Supabase traffic, reproducible service setup, and a full automated verification command.

- [ ] **Step 1: Write a failing static integration contract test**

```js
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const sw = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
for (const asset of ["src/groups/domain.js", "src/groups/supabase.js", "src/groups/repository.js", "src/groups/view.js", "src/groups/controller.js", "supabase/config.js"]) {
  assert.match(sw, new RegExp(asset.replaceAll("/", "\\/")));
}
assert.match(html, /id="groupsRoot"/);
assert.match(html, /type="module"/);
assert.match(sw, /event\.request\.url/);
assert.match(sw, /supabase/i);
```

- [ ] **Step 2: Run the contract test and verify the cache list fails**

Run: `node tests/group-contract.test.js`

Expected: FAIL because the new module assets are not yet cached.

- [ ] **Step 3: Update the service worker safely**

Increment the cache name. Precache all local group modules and config. In the fetch handler, bypass caching for non-GET requests and requests whose hostname ends in `.supabase.co`; use network-first for local HTML/JS/CSS and the existing cached-shell fallback. Never cache OAuth callback responses containing query/hash credentials.

- [ ] **Step 4: Write the reproducible Supabase setup guide**

Document project creation, migration execution, Google Cloud consent screen/client creation, exact authorized redirect locations, Supabase URL configuration, Realtime tables, copying only the publishable key, rotating invites after reopen, and a rollback section that disables Groups without touching Personal local data.

- [ ] **Step 5: Run the complete automated suite**

Run: `for test in tests/*.test.js; do node "$test"; done`

Expected: every test exits 0.

- [ ] **Step 6: Serve locally and complete manual iPhone-sized checks**

Run: `python3 -m http.server 4173`

Verify at `http://localhost:4173` using a 390×844 viewport: Personal history remains present; note input does not zoom; Groups offline state does not cover Personal; Google sign-in restores the intended invite; two sessions see the same expense; a repayment updates both balances; outsider access fails; archived group is read-only; Styles A/B/C remain readable.

- [ ] **Step 7: Commit PWA and documentation work**

```bash
git add sw.js tests/group-contract.test.js docs/setup-supabase.md
git commit -m "Finish shared groups PWA integration"
```

### Task 9: Production deployment and two-user acceptance

**Files:**
- No planned file changes; this task deploys and verifies the already-tested commits. Any discovered defect returns to the task that owns that behavior and adds a regression test there before the fix.

**Interfaces:**
- Consumes: the finished static app, Supabase production project, and GitHub Pages deployment.
- Produces: verified live shared groups on the existing public URL.

- [ ] **Step 1: Verify a clean tree and complete suite before deployment**

Run: `git status --short`

Expected: no output.

Run: `for test in tests/*.test.js; do node "$test"; done`

Expected: every test exits 0.

- [ ] **Step 2: Push the completed commits**

Run: `git push origin main`

Expected: GitHub accepts the new commits and Pages starts a deployment.

- [ ] **Step 3: Verify deployed assets and cache version**

Open the live GitHub Pages URL with a cache-busting query. Confirm `src/groups/controller.js`, `supabase/config.js`, and the new `sw.js` return HTTP 200 and the service worker cache name matches Task 8.

- [ ] **Step 4: Perform the success-criteria test with two Google users**

User A creates a group and shares the invite. User B signs in and joins. User A records a €30 expense shared by both; both devices show User B owing User A €15. User B records the €15 repayment; both devices show “All settled”. Sign out and verify the group cannot be viewed anonymously. Use a third signed-in user without membership and verify direct group access is denied.

- [ ] **Step 5: Record acceptance evidence and final status**

Save the deployment URL, deployed commit ID, test command output, and acceptance results in the final handoff. If any acceptance step fails, add a regression test first, make the smallest fix, rerun the complete suite, commit, push, and repeat the failed acceptance step.
