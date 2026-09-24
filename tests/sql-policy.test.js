import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync(
  new URL("../supabase/migrations/001_shared_groups.sql", import.meta.url),
  "utf8",
);

for (const table of [
  "profiles",
  "groups",
  "group_members",
  "group_invites",
  "group_expenses",
  "expense_participants",
  "group_repayments",
]) {
  assert.match(
    sql,
    new RegExp(`create table(?: if not exists)? public\\.${table}`, "i"),
  );
  assert.match(
    sql,
    new RegExp(`alter table public\\.${table} enable row level security`, "i"),
  );
}

for (const fn of [
  "join_group",
  "save_group_expense",
  "update_group_expense",
  "delete_group_expense",
  "save_group_repayment",
  "transfer_group_ownership",
]) {
  assert.match(
    sql,
    new RegExp(`create or replace function public\\.${fn}`, "i"),
  );
}

assert.match(sql, /unique\s*\(group_id, idempotency_key\)/i);
assert.equal(
  sql.match(/unique\s*\(group_id, idempotency_key\)/gi)?.length,
  2,
  "expenses and repayments must each enforce idempotency",
);
assert.doesNotMatch(sql, /service_role/i);

assert.match(sql, /create schema if not exists extensions/i);
assert.match(sql, /create extension if not exists pgcrypto with schema extensions/i);
assert.match(sql, /grant usage on schema extensions to authenticated/i);
assert.match(sql, /extensions\.digest\s*\(p_token,\s*'sha256'\)/i);
assert.match(sql, /amount_minor\s+bigint\s+not null\s+check\s*\(amount_minor > 0\)/i);
assert.match(sql, /expense_date\s+date\s+not null/i);
assert.match(sql, /repayment_date\s+date\s+not null/i);
assert.match(sql, /deleted_at\s+timestamptz/i);

assert.match(sql, /after insert on auth\.users/i);
assert.match(sql, /raw_user_meta_data\s*->>\s*'full_name'/i);
assert.match(sql, /raw_user_meta_data\s*->>\s*'(?:avatar_url|picture)'/i);

for (const fn of [
  "is_active_group_member",
  "is_group_owner",
  "has_no_group_members",
  "is_uninitialized_group_owner",
  "can_view_profile",
  "join_group",
  "save_group_expense",
  "update_group_expense",
  "delete_group_expense",
  "current_group_suggested_transfers",
  "save_group_repayment",
  "transfer_group_ownership",
]) {
  assert.match(
    sql,
    new RegExp(
      `create or replace function public\\.${fn}[^$]+security definer[^$]+set search_path = public`,
      "i",
    ),
  );
  assert.match(
    sql,
    new RegExp(`revoke all on function public\\.${fn}\\([^;]+ from public`, "i"),
  );
  assert.match(
    sql,
    new RegExp(`grant execute on function public\\.${fn}\\([^;]+ to authenticated`, "i"),
  );
}

assert.match(sql, /create policy "active members read groups"/i);
assert.match(sql, /create policy "owners manage group metadata"/i);
assert.match(sql, /create policy "active members create financial entries through rpc"/i);
assert.match(sql, /only the creator or group owner may edit this expense/i);
assert.match(sql, /only the creator or group owner may delete this expense/i);
assert.match(sql, /status\s*=\s*'active'/i);
assert.match(sql, /auth\.uid\(\) is null/i);

const ownerFn = sql.match(
  /create or replace function public\.is_group_owner[\s\S]+?\$\$;/i,
)?.[0] ?? "";
assert.match(ownerFn, /join public\.group_members/i);
assert.match(ownerFn, /gm\.status\s*=\s*'active'/i);
assert.match(sql, /owner_id\s*=\s*auth\.uid\(\)[\s\S]+public\.has_no_group_members\(id\)/i);
assert.match(sql, /public\.is_uninitialized_group_owner\(group_id\)/i);

assert.match(sql, /token_hash\s+bytea\s+not null/i);
assert.doesNotMatch(sql, /\btoken\s+text\s+(?:not\s+null|null)/i);
assert.match(sql, /digest\s*\(p_token,\s*'sha256'\)/i);
assert.match(sql, /is_active\s*=\s*true/i);
assert.match(sql, /expires_at\s*>\s*now\(\)/i);

assert.match(sql, /create or replace function public\.current_group_suggested_transfers/i);
assert.match(sql, /balance_minor asc,\s*user_id::text asc/i);
assert.match(sql, /balance_minor desc,\s*user_id::text asc/i);
assert.match(sql, /repayment amount exceeds the current suggested transfer/i);
assert.match(sql, /v_amount_minor\s*>\s*v_suggested_amount/i);
assert.match(sql, /for update/i);
assert.match(sql, /repayment financial fields are immutable/i);
assert.match(sql, /create trigger group_repayments_lock_group/i);
assert.match(sql, /create trigger group_expenses_lock_group/i);
assert.match(sql, /group currency cannot change after financial activity/i);
assert.match(sql, /participant shares must match the deterministic equal split/i);
assert.match(sql, /row_number\(\) over \(order by member_id\)/i);
assert.match(sql, /revoke insert, update, delete on public\.group_expenses/i);
assert.match(sql, /revoke insert, update, delete on public\.expense_participants/i);
assert.doesNotMatch(sql, /create policy "creators or owners update expenses"/i);
assert.doesNotMatch(sql, /create policy "creators or owners (?:insert|update|delete) expense shares"/i);
assert.match(sql, /new owner must be an active group member/i);
assert.match(sql, /revoke update on public\.groups from authenticated/i);

const expenseRpc = sql.match(
  /create or replace function public\.save_group_expense[\s\S]+?revoke all on function public\.save_group_expense/i,
)?.[0] ?? "";
assert.match(expenseRpc, /status\s*=\s*'active'/i);
assert.match(expenseRpc, /archived_at is not null/i);
assert.match(expenseRpc, /jsonb_array_elements/i);
assert.match(expenseRpc, /assert_valid_equal_expense_draft/i);
assert.match(sql, /sum\s*\(\s*\(share\s*->>\s*'share_minor'\)\s*::bigint\s*\)/i);

const repaymentRpc = sql.match(
  /create or replace function public\.save_group_repayment[\s\S]+?revoke all on function public\.save_group_repayment/i,
)?.[0] ?? "";
assert.match(repaymentRpc, /status\s*=\s*'active'/i);
assert.match(repaymentRpc, /archived_at is not null/i);
assert.match(repaymentRpc, /v_payer_id\s*=\s*v_recipient_id/i);
assert.match(repaymentRpc, /current_group_suggested_transfers/i);
