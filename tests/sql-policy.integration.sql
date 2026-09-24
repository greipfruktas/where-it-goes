\set ON_ERROR_STOP on

do $$
begin
  if current_database() <> 'shared_groups_test' then
    raise exception 'Run this regression only in shared_groups_test';
  end if;
end;
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'a@example.test', '{"full_name":"A","picture":"https://example.test/a"}'),
  ('00000000-0000-0000-0000-000000000002', 'b@example.test', '{"name":"B"}'),
  ('00000000-0000-0000-0000-000000000003', 'c@example.test', '{"name":"C"}'),
  ('00000000-0000-0000-0000-000000000004', 'd@example.test', '{"name":"D"}');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
insert into public.groups (id, owner_id, name, currency) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Trip', 'EUR')
returning id;
insert into public.group_members (group_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'owner');
insert into public.group_members (group_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'member'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'member');
reset role;
set role authenticated;

do $$
begin
  perform public.save_group_expense('{"group_id":"10000000-0000-0000-0000-000000000001","idempotency_key":"unequal","amount_minor":100,"payer_id":"00000000-0000-0000-0000-000000000001","description":"Unequal","category":"Food","date":"2026-09-24","participant_shares":[{"member_id":"00000000-0000-0000-0000-000000000001","share_minor":99},{"member_id":"00000000-0000-0000-0000-000000000002","share_minor":1}]}'::jsonb);
  raise exception 'Unequal split unexpectedly accepted';
exception
  when sqlstate '22023' then
    if sqlerrm <> 'Participant shares must match the deterministic equal split' then
      raise;
    end if;
end;
$$;

select set_config(
  'test.expense_id',
  (public.save_group_expense('{"group_id":"10000000-0000-0000-0000-000000000001","idempotency_key":"expense-1","amount_minor":101,"payer_id":"00000000-0000-0000-0000-000000000001","description":"Dinner","category":"Food","date":"2026-09-24","participant_shares":[{"member_id":"00000000-0000-0000-0000-000000000001","share_minor":51},{"member_id":"00000000-0000-0000-0000-000000000002","share_minor":50}]}'::jsonb)).id::text,
  false
);

do $$
begin
  perform public.update_group_expense(jsonb_build_object(
    'expense_id', current_setting('test.expense_id'),
    'amount_minor', 101,
    'payer_id', '00000000-0000-0000-0000-000000000001',
    'description', 'Wrong remainder',
    'category', 'Food',
    'date', '2026-09-24',
    'participant_shares', jsonb_build_array(
      jsonb_build_object('member_id', '00000000-0000-0000-0000-000000000001', 'share_minor', 50),
      jsonb_build_object('member_id', '00000000-0000-0000-0000-000000000002', 'share_minor', 51)
    )
  ));
  raise exception 'Wrong deterministic remainder unexpectedly accepted';
exception
  when sqlstate '22023' then
    if sqlerrm <> 'Participant shares must match the deterministic equal split' then
      raise;
    end if;
end;
$$;

update public.group_members
set status = 'removed', removed_at = now()
where group_id = '10000000-0000-0000-0000-000000000001'
  and user_id = '00000000-0000-0000-0000-000000000003';

do $$
begin
  perform public.update_group_expense(jsonb_build_object(
    'expense_id', current_setting('test.expense_id'),
    'amount_minor', 102,
    'payer_id', '00000000-0000-0000-0000-000000000001',
    'description', 'Removed member',
    'category', 'Food',
    'date', '2026-09-24',
    'participant_shares', jsonb_build_array(
      jsonb_build_object('member_id', '00000000-0000-0000-0000-000000000001', 'share_minor', 51),
      jsonb_build_object('member_id', '00000000-0000-0000-0000-000000000003', 'share_minor', 51)
    )
  ));
  raise exception 'Removed participant unexpectedly accepted';
exception
  when sqlstate '22023' then
    if sqlerrm <> 'All participants must be active group members' then
      raise;
    end if;
end;
$$;

do $$
begin
  begin
    update public.group_expenses
    set amount_minor = 999
    where id = current_setting('test.expense_id')::uuid;
    if found then
      raise exception 'Direct expense mutation unexpectedly accepted';
    end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    delete from public.expense_participants
    where expense_id = current_setting('test.expense_id')::uuid;
    if found then
      raise exception 'Direct share deletion unexpectedly accepted';
    end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.expense_participants
    set share_minor = share_minor + 1
    where expense_id = current_setting('test.expense_id')::uuid;
    if found then
      raise exception 'Direct share update unexpectedly accepted';
    end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.expense_participants (expense_id, group_id, member_id, share_minor)
    values (
      current_setting('test.expense_id')::uuid,
      '10000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000003',
      1
    );
    raise exception 'Direct removed-member share insert unexpectedly accepted';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select (public.update_group_expense(jsonb_build_object(
  'expense_id', current_setting('test.expense_id'),
  'amount_minor', 103,
  'payer_id', '00000000-0000-0000-0000-000000000001',
  'description', 'Dinner updated',
  'category', 'Food',
  'date', '2026-09-25',
  'participant_shares', jsonb_build_array(
    jsonb_build_object('member_id', '00000000-0000-0000-0000-000000000001', 'share_minor', 52),
    jsonb_build_object('member_id', '00000000-0000-0000-0000-000000000002', 'share_minor', 51)
  )
))).id;

do $$
declare
  total bigint;
begin
  select sum(ep.share_minor) into total
  from public.expense_participants as ep
  where ep.expense_id = current_setting('test.expense_id')::uuid;
  if total <> 103 then
    raise exception 'Atomic edit left incorrect shares: %', total;
  end if;
end;
$$;

do $$
begin
  perform public.save_group_repayment('{"group_id":"10000000-0000-0000-0000-000000000001","idempotency_key":"too-much","payer_id":"00000000-0000-0000-0000-000000000002","recipient_id":"00000000-0000-0000-0000-000000000001","amount_minor":52,"date":"2026-09-25"}'::jsonb);
  raise exception 'Repayment over the current suggestion unexpectedly accepted';
exception
  when sqlstate '22023' then
    if sqlerrm <> 'Repayment amount exceeds the current suggested transfer' then
      raise;
    end if;
end;
$$;

do $$
declare
  first_id uuid;
  retry_id uuid;
begin
  select (public.save_group_repayment('{"group_id":"10000000-0000-0000-0000-000000000001","idempotency_key":"repay-1","payer_id":"00000000-0000-0000-0000-000000000002","recipient_id":"00000000-0000-0000-0000-000000000001","amount_minor":10,"date":"2026-09-25"}'::jsonb)).id into first_id;
  select (public.save_group_repayment('{"group_id":"10000000-0000-0000-0000-000000000001","idempotency_key":"repay-1","payer_id":"00000000-0000-0000-0000-000000000002","recipient_id":"00000000-0000-0000-0000-000000000001","amount_minor":10,"date":"2026-09-25"}'::jsonb)).id into retry_id;
  if first_id is distinct from retry_id then
    raise exception 'Idempotent repayment retry returned a different row';
  end if;
end;
$$;

do $$
begin
  perform public.transfer_group_ownership(
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000004'
  );
  raise exception 'Outsider ownership transfer unexpectedly accepted';
exception
  when sqlstate '22023' then
    if sqlerrm <> 'New owner must be an active group member' then
      raise;
    end if;
end;
$$;

do $$
begin
  begin
    update public.groups
    set owner_id = '00000000-0000-0000-0000-000000000004'
    where id = '10000000-0000-0000-0000-000000000001';
    if found then
      raise exception 'Direct owner transfer unexpectedly accepted';
    end if;
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select (public.transfer_group_ownership(
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002'
)).owner_id;

do $$
begin
  if not exists (
    select 1 from public.groups as g
    join public.group_members as gm
      on gm.group_id = g.id and gm.user_id = g.owner_id
    where g.id = '10000000-0000-0000-0000-000000000001'
      and g.owner_id = '00000000-0000-0000-0000-000000000002'
      and gm.role = 'owner'
      and gm.status = 'active'
  ) then
    raise exception 'Ownership transfer did not update group and member roles atomically';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);

do $$
declare
  extension_schema text;
begin
  select n.nspname into extension_schema
  from pg_extension as e
  join pg_namespace as n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';
  if extension_schema <> 'extensions' then
    raise exception 'pgcrypto installed in unexpected schema: %', extension_schema;
  end if;
end;
$$;

insert into public.group_invites (group_id, token_hash, created_by, expires_at)
values (
  '10000000-0000-0000-0000-000000000001',
  extensions.digest('secret-token', 'sha256'),
  '00000000-0000-0000-0000-000000000002',
  now() + interval '1 day'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
select public.join_group('secret-token');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select (public.delete_group_expense(current_setting('test.expense_id')::uuid)).deleted_at is not null as soft_deleted;

do $$
begin
  if not exists (
    select 1 from public.expense_participants
    where expense_id = current_setting('test.expense_id')::uuid
  ) then
    raise exception 'Soft delete removed audit shares';
  end if;
end;
$$;

reset role;
