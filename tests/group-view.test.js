import assert from "node:assert/strict";
import { escapeGroupHTML, renderActivity, renderExpenseForm, renderGroupsList, renderGroupShell, renderSettlementSuggestions } from "../src/groups/view.js";

assert.equal(escapeGroupHTML(`<img onerror="x">`), "&lt;img onerror=&quot;x&quot;&gt;");
const list = renderGroupsList([{ id: "g1", name: "<Trip>", icon: "✈️", currency: "EUR" }]);
assert.match(list, /&lt;Trip&gt;/);
assert.doesNotMatch(list, /<Trip>/);
assert.match(list, /data-group-id="g1"/);

assert.match(renderGroupShell({ state: "signed-out" }), /Continue with Google/);
assert.match(renderGroupShell({ state: "offline" }), /internet connection/i);
assert.match(renderGroupShell({ state: "list", groups: [] }), /Create a group/);
assert.match(renderGroupShell({ state: "invite-error", message: "Invalid invite" }), /Invalid invite/);

const members = [
  { user_id: "u1", status: "active", profiles: { display_name: "Ada" } },
  { user_id: "u2", status: "active", profiles: { display_name: "Ben" } },
  { user_id: "u3", status: "removed", profiles: { display_name: "Cal" } }
];
const form = renderExpenseForm({ members, currentUserId: "u1", today: "2026-09-25" });
assert.match(form, /name="payerId"[\s\S]*value="u1" selected/);
assert.match(form, /name="expenseDate"[^>]*value="2026-09-25"/);
assert.match(form, /name="participantIds" value="u1" checked/);
assert.match(form, /name="participantIds" value="u2" checked/);
assert.doesNotMatch(form, /value="u3"/);

const activity = renderActivity([
  { id: "e1", description: "<Dinner>", category: `<img onerror="x">`, amount_minor: 1200, expense_date: "2026-09-25", payer_id: "u1", created_by: "u1" },
  { id: "e2", description: "Deleted", category: "Food", amount_minor: 200, deleted_at: "2026-09-25T00:00:00Z" }
], { currentUserId: "u1", ownerId: "u9", currency: "EUR" });
assert.match(activity, /&lt;Dinner&gt;/);
assert.doesNotMatch(activity, /<img/);
assert.doesNotMatch(activity, /Deleted/);
assert.match(activity, /data-expense-edit="e1"/);

const settlementMembers = [
  { user_id: "a", status: "active", profiles: { display_name: "A" } },
  { user_id: "b", status: "active", profiles: { display_name: "B" } },
  { user_id: "c", status: "removed", profiles: { display_name: "C" } }
];
const settlements = renderSettlementSuggestions({ a: 500, b: -200, c: -300 }, settlementMembers, "EUR");
assert.match(settlements, /C owes A €3\.00/);
assert.match(settlements, /B owes A €2\.00/);
assert.match(settlements, /data-repayment-payer="c"/);
assert.match(renderSettlementSuggestions({ a: 0, b: 0 }, settlementMembers, "EUR"), /All settled/);

const archived = renderGroupShell({ state: "detail", group: { id: "g", name: "Old trip", status: "archived", owner_id: "u1", group_members: members, group_expenses: [] }, currentUserId: "u1" });
assert.match(archived, /Archived/);
assert.doesNotMatch(archived, /data-expense-open/);
assert.doesNotMatch(archived, /data-expense-edit/);
