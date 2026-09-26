import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync(new URL("../supabase/migrations/004_group_table_grants.sql", import.meta.url), "utf8");
for (const table of ["profiles", "groups", "group_members", "group_invites", "group_expenses", "expense_participants", "group_repayments"]) {
  assert.match(sql, new RegExp(`public\\.${table}`, "i"));
}
assert.match(sql, /grant select on table[\s\S]+to authenticated/i);
assert.match(sql, /grant insert on table public\.groups, public\.group_members, public\.group_invites/i);
assert.match(sql, /grant update \(status, removed_at\) on public\.group_members/i);
assert.match(sql, /grant update \(is_active, revoked_at\) on public\.group_invites/i);
assert.match(sql, /revoke insert, update, delete on public\.group_expenses from authenticated/i);
assert.match(sql, /revoke insert, update, delete on public\.expense_participants from authenticated/i);
