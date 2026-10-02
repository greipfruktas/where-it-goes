import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync(new URL("../supabase/migrations/005_personal_import_rules.sql", import.meta.url), "utf8");
assert.match(sql, /add column[^;]*import_rules jsonb not null default '\[\]'::jsonb/i);
assert.match(sql, /jsonb_typeof\(import_rules\) = 'array'/i);
assert.match(sql, /create or replace function public\.apply_personal_operation\(payload jsonb\)/i);
assert.match(sql, /payload \? 'import_rules'/i);
assert.match(sql, /jsonb_typeof\(v_import_rules\) <> 'array'/i);
assert.match(sql, /merchantKey/i);
assert.match(sql, /category/i);
assert.match(sql, /updatedAt/i);
assert.match(sql, /coalesce\(v_import_rules, personal_settings\.import_rules\)/i);
assert.match(sql, /coalesce\(v_import_rules, '\[\]'::jsonb\)/i);
assert.match(sql, /security definer[\s\S]+auth\.uid\(\)/i);
assert.match(sql, /revoke insert, update, delete on public\.personal_settings from authenticated/i);
