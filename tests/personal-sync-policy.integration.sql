\set ON_ERROR_STOP on

do $$
begin
  if current_database() <> 'shared_groups_test' then
    raise exception 'Run this regression only in shared_groups_test';
  end if;
end;
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('90000000-0000-0000-0000-000000000001', 'personal-a@example.test', '{"full_name":"Personal A"}'),
  ('90000000-0000-0000-0000-000000000002', 'personal-b@example.test', '{"full_name":"Personal B"}');

set role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000001', false);

do $$
declare
  first_apply boolean;
  retry_apply boolean;
begin
  select public.apply_personal_operation('{"operation_id":"a:1","kind":"expense_upsert","expense":{"id":"phone-a:e1","amount_minor":1250,"category":"Food","labels":["Must"],"reimbursement_percent":50,"date":"2026-09-26","note":"Lunch","created_at_client":1790380800000}}'::jsonb) into first_apply;
  select public.apply_personal_operation('{"operation_id":"a:1","kind":"expense_upsert","expense":{"id":"phone-a:e1","amount_minor":9999,"category":"Wrong","labels":[],"reimbursement_percent":0,"date":"2026-09-26","note":"Duplicate","created_at_client":1790380800000}}'::jsonb) into retry_apply;
  if first_apply is not true or retry_apply is not false then
    raise exception 'Operation idempotency returned unexpected values';
  end if;
  if (select amount_minor from public.personal_expenses where expense_id = 'phone-a:e1') <> 1250 then
    raise exception 'Duplicate operation overwrote the accepted expense';
  end if;
end;
$$;

select public.apply_personal_operation('{"operation_id":"a:2","kind":"expense_upsert","expense":{"id":"phone-a:e1","amount_minor":1300,"category":"Food","labels":["Must"],"reimbursement_percent":50,"date":"2026-09-26","note":"Lunch updated","created_at_client":1790380800000}}'::jsonb);

select public.apply_personal_operation('{"operation_id":"a:settings","kind":"settings_replace","categories":[{"name":"Food","emoji":"🥑","color":"#e6f0df"}],"style":"neon"}'::jsonb);

select public.apply_personal_operation('{"operation_id":"a:delete","kind":"expense_delete","expense_id":"phone-a:e1"}'::jsonb);

do $$
declare
  old_retry boolean;
begin
  select public.apply_personal_operation('{"operation_id":"a:2","kind":"expense_upsert","expense":{"id":"phone-a:e1","amount_minor":1300,"category":"Food","labels":["Must"],"reimbursement_percent":50,"date":"2026-09-26","note":"Lunch updated","created_at_client":1790380800000}}'::jsonb) into old_retry;
  if old_retry is not false then
    raise exception 'Previously accepted operation was applied twice';
  end if;
  if (select deleted_at from public.personal_expenses where expense_id = 'phone-a:e1') is null then
    raise exception 'Old retry resurrected a deleted expense';
  end if;
end;
$$;

do $$
begin
  begin
    insert into public.personal_expenses (owner_id, expense_id, deleted_at)
    values ('90000000-0000-0000-0000-000000000001', 'direct', now());
    raise exception 'Direct personal expense insert unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000002', false);

do $$
begin
  if (select count(*) from public.personal_expenses) <> 0 then
    raise exception 'Another user can read personal expenses';
  end if;
  if (select count(*) from public.personal_settings) <> 0 then
    raise exception 'Another user can read personal settings';
  end if;
  if (select count(*) from public.personal_operations) <> 0 then
    raise exception 'Another user can read personal operation history';
  end if;
end;
$$;

do $$
begin
  begin
    perform public.apply_personal_operation('{"operation_id":"spoof","kind":"settings_replace","owner_id":"90000000-0000-0000-0000-000000000001","categories":[{"name":"Other","emoji":"✨","color":"#ffffff"}],"style":"pocket"}'::jsonb);
    raise exception 'Owner spoof unexpectedly succeeded';
  exception when sqlstate '22023' then
    if sqlerrm <> 'Personal operation must not include owner_id' then
      raise;
    end if;
  end;
end;
$$;

reset role;
set role anon;

do $$
begin
  begin
    perform count(*) from public.personal_expenses;
    raise exception 'Anonymous personal expense read unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.apply_personal_operation('{"operation_id":"anon","kind":"expense_delete","expense_id":"phone-a:e1"}'::jsonb);
    raise exception 'Anonymous personal operation unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
