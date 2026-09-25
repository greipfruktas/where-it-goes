import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync(new URL("../supabase/migrations/003_personal_sync.sql", import.meta.url), "utf8");

for (const table of ["personal_expenses", "personal_settings", "personal_operations"]) {
  assert.match(sql, new RegExp(`create table public\\.${table}`, "i"));
  assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  assert.match(sql, new RegExp(`on public\\.${table} for select to authenticated[\\s\\S]+owner_id = auth\\.uid\\(\\)`, "i"));
}

assert.match(sql, /primary key\s*\(owner_id, expense_id\)/i);
assert.match(sql, /primary key\s*\(owner_id, operation_id\)/i);
assert.match(sql, /deleted_at\s+timestamptz/i);
assert.match(sql, /categories\s+jsonb[^,]+check\s*\(jsonb_typeof\(categories\) = 'array'\)/i);
assert.match(sql, /style\s+text[^,]+check\s*\(style in \('pocket', 'neon', 'swiss'\)\)/i);
assert.match(sql, /create or replace function public\.apply_personal_operation\(payload jsonb\)/i);
assert.match(sql, /security definer[\s\S]+set search_path = public/i);
assert.match(sql, /v_owner_id uuid := auth\.uid\(\)/i);
assert.match(sql, /on conflict \(owner_id, operation_id\) do nothing/i);
assert.match(sql, /get diagnostics v_inserted = row_count[\s\S]+if v_inserted = 0 then[\s\S]+return false/i);
assert.match(sql, /payload \? 'owner_id'[\s\S]+must not include owner_id/i);
assert.match(sql, /unknown personal operation kind/i);

for (const table of ["personal_expenses", "personal_settings", "personal_operations"]) {
  assert.match(sql, new RegExp(`revoke insert, update, delete on public\\.${table} from authenticated`, "i"));
}
assert.match(sql, /revoke all on function public\.apply_personal_operation\(jsonb\) from public/i);
assert.match(sql, /grant execute on function public\.apply_personal_operation\(jsonb\) to authenticated/i);
assert.doesNotMatch(sql, /service_role/i);
