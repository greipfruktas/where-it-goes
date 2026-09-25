create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Supabase normally installs pgcrypto in `extensions`. If it already exists in
-- another schema, relocate it so schema-qualified calls below remain portable.
do $$
declare
  v_extension_schema text;
begin
  select n.nspname into v_extension_schema
  from pg_extension as e
  join pg_namespace as n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';

  if v_extension_schema is distinct from 'extensions' then
    alter extension pgcrypto set schema extensions;
  end if;
end;
$$;

grant usage on schema extensions to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (btrim(display_name) <> ''),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  name text not null check (btrim(name) <> ''),
  icon text not null default '👥' check (btrim(icon) <> ''),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  starts_on date,
  ends_on date,
  status text not null default 'active' check (status in ('active', 'archived')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  check ((status = 'archived') = (archived_at is not null))
);

create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  role text not null default 'member' check (role in ('owner', 'member')),
  status text not null default 'active' check (status in ('active', 'removed')),
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (group_id, user_id),
  check ((status = 'removed') = (removed_at is not null))
);

create table public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  token_hash bytea not null unique,
  created_by uuid not null references public.profiles(id),
  is_active boolean not null default true,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (group_id, created_by)
    references public.group_members(group_id, user_id),
  check ((not is_active) or revoked_at is null)
);

create table public.group_expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  description text not null check (btrim(description) <> ''),
  category text not null check (btrim(category) <> ''),
  expense_date date not null,
  payer_id uuid not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, group_id),
  unique (group_id, idempotency_key),
  foreign key (group_id, payer_id)
    references public.group_members(group_id, user_id),
  foreign key (group_id, created_by)
    references public.group_members(group_id, user_id)
);

create table public.expense_participants (
  expense_id uuid not null,
  group_id uuid not null,
  member_id uuid not null,
  share_minor bigint not null check (share_minor > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (expense_id, member_id),
  foreign key (expense_id, group_id)
    references public.group_expenses(id, group_id) on delete cascade,
  foreign key (group_id, member_id)
    references public.group_members(group_id, user_id)
);

create table public.group_repayments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  payer_id uuid not null,
  recipient_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  repayment_date date not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (group_id, idempotency_key),
  foreign key (group_id, payer_id)
    references public.group_members(group_id, user_id),
  foreign key (group_id, recipient_id)
    references public.group_members(group_id, user_id),
  foreign key (group_id, created_by)
    references public.group_members(group_id, user_id),
  check (payer_id <> recipient_id)
);

create index group_members_user_active_idx
  on public.group_members(user_id, group_id)
  where status = 'active';
create index group_expenses_group_date_idx
  on public.group_expenses(group_id, expense_date, created_at)
  where deleted_at is null;
create index group_repayments_group_date_idx
  on public.group_repayments(group_id, repayment_date, created_at)
  where deleted_at is null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();
create trigger groups_set_updated_at
before update on public.groups
for each row execute function public.set_updated_at();
create trigger group_members_set_updated_at
before update on public.group_members
for each row execute function public.set_updated_at();
create trigger group_invites_set_updated_at
before update on public.group_invites
for each row execute function public.set_updated_at();
create trigger group_expenses_set_updated_at
before update on public.group_expenses
for each row execute function public.set_updated_at();
create trigger expense_participants_set_updated_at
before update on public.expense_participants
for each row execute function public.set_updated_at();
create trigger group_repayments_set_updated_at
before update on public.group_repayments
for each row execute function public.set_updated_at();

create or replace function public.protect_current_owner_membership()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1 from public.groups as g
    where g.id = old.group_id and g.owner_id = old.user_id
  ) and (
    tg_op = 'DELETE'
    or new.status <> 'active'
    or new.role <> 'owner'
  ) then
    raise exception 'Transfer ownership before removing or demoting the owner'
      using errcode = '22023';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger group_members_protect_current_owner
before update or delete on public.group_members
for each row execute function public.protect_current_owner_membership();

create or replace function public.protect_group_currency()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.currency is distinct from old.currency
     and (
       exists (select 1 from public.group_expenses as ge where ge.group_id = old.id)
       or exists (select 1 from public.group_repayments as gr where gr.group_id = old.id)
     ) then
    raise exception 'Group currency cannot change after financial activity'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger groups_protect_currency
before update on public.groups
for each row execute function public.protect_group_currency();

-- Serialize every balance-affecting mutation on the group row. In particular,
-- a concurrent soft deletion cannot change the balance while a repayment RPC
-- is checking its current deterministic suggestion.
create or replace function public.lock_financial_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  if tg_op = 'DELETE' then
    v_group_id := old.group_id;
  else
    v_group_id := new.group_id;
  end if;

  perform 1 from public.groups as g where g.id = v_group_id for update;
  return coalesce(new, old);
end;
$$;

create trigger group_expenses_lock_group
before update on public.group_expenses
for each row execute function public.lock_financial_group();
create trigger expense_participants_lock_group
before insert or update or delete on public.expense_participants
for each row execute function public.lock_financial_group();
create trigger group_repayments_lock_group
before update on public.group_repayments
for each row execute function public.lock_financial_group();

-- Repayments are immutable accounting events. Creator/owner UPDATE access is
-- intentionally limited to one-way soft deletion, so direct table writes
-- cannot bypass save_group_repayment's active-member or overpayment checks.
create or replace function public.protect_repayment_financial_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id
     or new.group_id is distinct from old.group_id
     or new.idempotency_key is distinct from old.idempotency_key
     or new.payer_id is distinct from old.payer_id
     or new.recipient_id is distinct from old.recipient_id
     or new.amount_minor is distinct from old.amount_minor
     or new.repayment_date is distinct from old.repayment_date
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Repayment financial fields are immutable' using errcode = '22023';
  end if;
  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'A deleted repayment cannot be restored' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger group_repayments_protect_financial_fields
before update on public.group_repayments
for each row execute function public.protect_repayment_financial_fields();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Member'
    ),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
      nullif(new.raw_user_meta_data ->> 'picture', '')
    )
  )
  on conflict (id) do update
  set display_name = excluded.display_name,
      avatar_url = excluded.avatar_url,
      updated_at = now();
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_active_group_member(p_group_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  return exists (
    select 1
    from public.group_members as gm
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
      and gm.status = 'active'
  );
end;
$$;

create or replace function public.is_group_owner(p_group_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  return exists (
    select 1
    from public.groups as g
    join public.group_members as gm
      on gm.group_id = g.id
     and gm.user_id = g.owner_id
    where g.id = p_group_id
      and g.owner_id = auth.uid()
      and gm.status = 'active'
  );
end;
$$;

-- INSERT ... RETURNING evaluates the groups SELECT policy before a helper can
-- query the just-inserted group row. This helper only checks the membership
-- table; the policy separately compares the returned row's owner_id to auth.uid().
create or replace function public.has_no_group_members(p_group_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  return not exists (
    select 1 from public.group_members as gm where gm.group_id = p_group_id
  );
end;
$$;

-- A newly inserted group has no membership row yet. This narrowly scoped
-- bootstrap predicate permits its owner to read the generated id and add the
-- first owner membership; it becomes false as soon as any membership exists.
create or replace function public.is_uninitialized_group_owner(p_group_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  return exists (
    select 1
    from public.groups as g
    where g.id = p_group_id
      and g.owner_id = auth.uid()
      and not exists (
        select 1 from public.group_members as gm where gm.group_id = g.id
      )
  );
end;
$$;

create or replace function public.can_view_profile(p_profile_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  if p_profile_id = auth.uid() then
    return true;
  end if;

  return exists (
    select 1
    from public.group_members as viewer
    join public.group_members as subject
      on subject.group_id = viewer.group_id
    where viewer.user_id = auth.uid()
      and viewer.status = 'active'
      and subject.user_id = p_profile_id
  );
end;
$$;

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invites enable row level security;
alter table public.group_expenses enable row level security;
alter table public.expense_participants enable row level security;
alter table public.group_repayments enable row level security;

create policy "users read their own and shared-group profiles"
on public.profiles for select to authenticated
using (public.can_view_profile(id));

create policy "users update their own profile"
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- The helper returns false for removed members and outsiders, so this policy
-- explicitly admits only the active-member actor class.
create policy "active members read groups"
on public.groups for select to authenticated
using (
  public.is_active_group_member(id)
  or (owner_id = auth.uid() and public.has_no_group_members(id))
);

create policy "authenticated users create groups they own"
on public.groups for insert to authenticated
with check (owner_id = auth.uid() and status = 'active' and archived_at is null);

create policy "owners manage group metadata"
on public.groups for update to authenticated
using (public.is_group_owner(id) and status = 'active' and archived_at is null)
with check (public.is_active_group_member(id) and status = 'active' and archived_at is null);

create policy "active members read membership history"
on public.group_members for select to authenticated
using (public.is_active_group_member(group_id));

create policy "owners add members"
on public.group_members for insert to authenticated
with check (
  (
    public.is_group_owner(group_id)
    and exists (
      select 1 from public.groups as g
      where g.id = group_id and g.status = 'active' and g.archived_at is null
    )
  )
  or (
    user_id = auth.uid()
    and role = 'owner'
    and status = 'active'
    and public.is_uninitialized_group_owner(group_id)
  )
);

create policy "owners manage members"
on public.group_members for update to authenticated
using (
  public.is_group_owner(group_id)
  and exists (
    select 1 from public.groups as g
    where g.id = group_id and g.status = 'active' and g.archived_at is null
  )
)
with check (
  public.is_group_owner(group_id)
  and exists (
    select 1 from public.groups as g
    where g.id = group_id and g.status = 'active' and g.archived_at is null
  )
);

create policy "owners read invitations"
on public.group_invites for select to authenticated
using (public.is_group_owner(group_id));

create policy "owners create invitations"
on public.group_invites for insert to authenticated
with check (
  public.is_group_owner(group_id)
  and exists (
    select 1 from public.groups as g
    where g.id = group_id and g.status = 'active' and g.archived_at is null
  )
);

create policy "owners rotate or disable invitations"
on public.group_invites for update to authenticated
using (
  public.is_group_owner(group_id)
  and exists (
    select 1 from public.groups as g
    where g.id = group_id and g.status = 'active' and g.archived_at is null
  )
)
with check (
  public.is_group_owner(group_id)
  and exists (
    select 1 from public.groups as g
    where g.id = group_id and g.status = 'active' and g.archived_at is null
  )
);

create policy "active members read expenses"
on public.group_expenses for select to authenticated
using (public.is_active_group_member(group_id));

-- Direct inserts are intentionally denied. The security-definer RPC is the
-- only insert boundary and performs the active-member and accounting checks.
create policy "active members create financial entries through rpc"
on public.group_expenses for insert to authenticated
with check (false);

create policy "active members read expense shares"
on public.expense_participants for select to authenticated
using (public.is_active_group_member(group_id));

create policy "active members read repayments"
on public.group_repayments for select to authenticated
using (public.is_active_group_member(group_id));

create policy "active members create repayments through rpc"
on public.group_repayments for insert to authenticated
with check (false);

create policy "creators or owners update repayments"
on public.group_repayments for update to authenticated
using (
  public.is_active_group_member(group_id)
  and (created_by = auth.uid() or public.is_group_owner(group_id))
)
with check (
  public.is_active_group_member(group_id)
  and (created_by = auth.uid() or public.is_group_owner(group_id))
  and exists (
    select 1 from public.groups as g
    where g.id = group_id and g.status = 'active' and g.archived_at is null
  )
);

create or replace function public.join_group(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if nullif(btrim(p_token), '') is null then
    raise exception 'Invitation is invalid or unavailable' using errcode = '22023';
  end if;

  select gi.group_id
  into v_group_id
  from public.group_invites as gi
  join public.groups as g on g.id = gi.group_id
  where gi.token_hash = extensions.digest(p_token, 'sha256')
    and gi.is_active = true
    and gi.revoked_at is null
    and gi.expires_at > now()
    and g.status = 'active'
    and g.archived_at is null
  for update of gi;

  if v_group_id is null then
    raise exception 'Invitation is invalid or unavailable' using errcode = '22023';
  end if;

  insert into public.group_members (group_id, user_id, role, status, removed_at)
  values (v_group_id, auth.uid(), 'member', 'active', null)
  on conflict (group_id, user_id) do update
  set status = 'active',
      removed_at = null,
      updated_at = now();

  return v_group_id;
end;
$$;

-- Validate the authoritative equal split used by both expense create and edit.
-- Remainder minor units go to the lowest member UUIDs, matching domain.js.
create or replace function public.assert_valid_equal_expense_draft(
  p_group_id uuid,
  p_amount_minor bigint,
  p_payer_id uuid,
  p_shares jsonb
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_share_count integer;
  v_distinct_count integer;
  v_active_count integer;
  v_share_total bigint;
begin
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'Amount must be greater than zero' using errcode = '22023';
  end if;
  if jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) = 0 then
    raise exception 'At least one participant share is required' using errcode = '22023';
  end if;

  select
    count(*),
    count(distinct (share ->> 'member_id')::uuid),
    coalesce(sum((share ->> 'share_minor')::bigint), 0)
  into v_share_count, v_distinct_count, v_share_total
  from jsonb_array_elements(p_shares) as items(share);

  if v_share_count <> v_distinct_count then
    raise exception 'Participant members must be unique' using errcode = '22023';
  end if;
  if v_share_total <> p_amount_minor then
    raise exception 'Participant shares must total the expense amount' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_shares) as items(share)
    where (share ->> 'share_minor')::bigint <= 0
  ) then
    raise exception 'Participant shares must be greater than zero' using errcode = '22023';
  end if;

  if exists (
    with submitted as (
      select
        (share ->> 'member_id')::uuid as member_id,
        (share ->> 'share_minor')::bigint as share_minor
      from jsonb_array_elements(p_shares) as items(share)
    ), ranked as (
      select
        member_id,
        share_minor,
        row_number() over (order by member_id) as split_rank,
        count(*) over () as participant_count
      from submitted
    )
    select 1
    from ranked
    where share_minor <> (
      p_amount_minor / participant_count
      + case when split_rank <= p_amount_minor % participant_count then 1 else 0 end
    )
  ) then
    raise exception 'Participant shares must match the deterministic equal split'
      using errcode = '22023';
  end if;

  -- Lock every referenced membership so removal cannot race validation.
  perform 1
  from public.group_members as gm
  where gm.group_id = p_group_id
    and gm.user_id in (
      select (share ->> 'member_id')::uuid
      from jsonb_array_elements(p_shares) as items(share)
      union
      select p_payer_id
    )
  for share;

  select count(*) into v_active_count
  from public.group_members as gm
  where gm.group_id = p_group_id
    and gm.status = 'active'
    and gm.user_id in (
      select (share ->> 'member_id')::uuid
      from jsonb_array_elements(p_shares) as items(share)
    );
  if v_active_count <> v_share_count then
    raise exception 'All participants must be active group members' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.group_members as gm
    where gm.group_id = p_group_id
      and gm.user_id = p_payer_id
      and gm.status = 'active'
  ) then
    raise exception 'Payer must be an active group member' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.save_group_expense(payload jsonb)
returns public.group_expenses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_group_id uuid := (payload ->> 'group_id')::uuid;
  v_payer_id uuid := (payload ->> 'payer_id')::uuid;
  v_idempotency_key text := nullif(btrim(payload ->> 'idempotency_key'), '');
  v_amount_minor bigint := (payload ->> 'amount_minor')::bigint;
  v_expense_date date := coalesce(
    nullif(payload ->> 'expense_date', '')::date,
    nullif(payload ->> 'date', '')::date
  );
  v_description text := nullif(btrim(payload ->> 'description'), '');
  v_category text := nullif(btrim(payload ->> 'category'), '');
  v_shares jsonb := payload -> 'participant_shares';
  v_group public.groups%rowtype;
  v_expense public.group_expenses%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select g.* into v_group
  from public.groups as g
  where g.id = v_group_id
  for update;

  if not found or v_group.status <> 'active' or v_group.archived_at is not null then
    raise exception 'Group is unavailable or archived' using errcode = '22023';
  end if;

  perform 1
  from public.group_members as gm
  where gm.group_id = v_group_id
    and gm.user_id = v_actor_id
    and gm.status = 'active'
  for share;
  if not found then
    raise exception 'Active group membership required' using errcode = '42501';
  end if;

  if v_idempotency_key is null then
    raise exception 'Idempotency key is required' using errcode = '22023';
  end if;

  select ge.* into v_expense
  from public.group_expenses as ge
  where ge.group_id = v_group_id
    and ge.idempotency_key = v_idempotency_key;
  if found then
    return v_expense;
  end if;

  if v_description is null or v_category is null or v_expense_date is null then
    raise exception 'Description, category, and date are required' using errcode = '22023';
  end if;
  if payload ? 'currency' and payload ->> 'currency' <> v_group.currency then
    raise exception 'Currency must match the group currency' using errcode = '22023';
  end if;
  perform public.assert_valid_equal_expense_draft(
    v_group_id,
    v_amount_minor,
    v_payer_id,
    v_shares
  );

  insert into public.group_expenses (
    group_id,
    idempotency_key,
    amount_minor,
    currency,
    description,
    category,
    expense_date,
    payer_id,
    created_by
  ) values (
    v_group_id,
    v_idempotency_key,
    v_amount_minor,
    v_group.currency,
    v_description,
    v_category,
    v_expense_date,
    v_payer_id,
    v_actor_id
  )
  on conflict (group_id, idempotency_key) do nothing
  returning * into v_expense;

  if v_expense.id is null then
    select ge.* into strict v_expense
    from public.group_expenses as ge
    where ge.group_id = v_group_id
      and ge.idempotency_key = v_idempotency_key;
    return v_expense;
  end if;

  insert into public.expense_participants (
    expense_id,
    group_id,
    member_id,
    share_minor
  )
  select
    v_expense.id,
    v_group_id,
    (share ->> 'member_id')::uuid,
    (share ->> 'share_minor')::bigint
  from jsonb_array_elements(v_shares) as items(share);

  return v_expense;
end;
$$;

create or replace function public.update_group_expense(payload jsonb)
returns public.group_expenses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_expense_id uuid := coalesce(
    nullif(payload ->> 'expense_id', ''),
    nullif(payload ->> 'id', '')
  )::uuid;
  v_payer_id uuid := (payload ->> 'payer_id')::uuid;
  v_amount_minor bigint := (payload ->> 'amount_minor')::bigint;
  v_expense_date date := coalesce(
    nullif(payload ->> 'expense_date', '')::date,
    nullif(payload ->> 'date', '')::date
  );
  v_description text := nullif(btrim(payload ->> 'description'), '');
  v_category text := nullif(btrim(payload ->> 'category'), '');
  v_shares jsonb := payload -> 'participant_shares';
  v_group public.groups%rowtype;
  v_expense public.group_expenses%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_expense_id is null then
    raise exception 'Expense id is required' using errcode = '22023';
  end if;

  select ge.* into v_expense
  from public.group_expenses as ge
  where ge.id = v_expense_id;
  if not found then
    raise exception 'Expense is unavailable' using errcode = '22023';
  end if;

  select g.* into v_group
  from public.groups as g
  where g.id = v_expense.group_id
  for update;

  select ge.* into strict v_expense
  from public.group_expenses as ge
  where ge.id = v_expense_id
  for update;

  if v_group.status <> 'active' or v_group.archived_at is not null then
    raise exception 'Group is unavailable or archived' using errcode = '22023';
  end if;
  if v_expense.deleted_at is not null then
    raise exception 'Deleted expenses cannot be edited' using errcode = '22023';
  end if;
  if payload ? 'group_id'
     and (payload ->> 'group_id')::uuid <> v_expense.group_id then
    raise exception 'Expense cannot move between groups' using errcode = '22023';
  end if;

  perform 1
  from public.group_members as gm
  where gm.group_id = v_expense.group_id
    and gm.user_id = v_actor_id
    and gm.status = 'active'
  for share;
  if not found then
    raise exception 'Active group membership required' using errcode = '42501';
  end if;
  if v_expense.created_by <> v_actor_id and v_group.owner_id <> v_actor_id then
    raise exception 'Only the creator or group owner may edit this expense'
      using errcode = '42501';
  end if;

  if v_description is null or v_category is null or v_expense_date is null then
    raise exception 'Description, category, and date are required' using errcode = '22023';
  end if;
  if payload ? 'currency' and payload ->> 'currency' <> v_group.currency then
    raise exception 'Currency must match the group currency' using errcode = '22023';
  end if;

  perform public.assert_valid_equal_expense_draft(
    v_expense.group_id,
    v_amount_minor,
    v_payer_id,
    v_shares
  );

  update public.group_expenses
  set amount_minor = v_amount_minor,
      currency = v_group.currency,
      description = v_description,
      category = v_category,
      expense_date = v_expense_date,
      payer_id = v_payer_id
  where id = v_expense_id
  returning * into v_expense;

  delete from public.expense_participants as ep
  where ep.expense_id = v_expense_id;

  insert into public.expense_participants (
    expense_id,
    group_id,
    member_id,
    share_minor
  )
  select
    v_expense_id,
    v_expense.group_id,
    (share ->> 'member_id')::uuid,
    (share ->> 'share_minor')::bigint
  from jsonb_array_elements(v_shares) as items(share);

  return v_expense;
end;
$$;

create or replace function public.delete_group_expense(p_expense_id uuid)
returns public.group_expenses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_group public.groups%rowtype;
  v_expense public.group_expenses%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select ge.* into v_expense
  from public.group_expenses as ge
  where ge.id = p_expense_id;
  if not found then
    raise exception 'Expense is unavailable' using errcode = '22023';
  end if;

  select g.* into v_group
  from public.groups as g
  where g.id = v_expense.group_id
  for update;

  select ge.* into strict v_expense
  from public.group_expenses as ge
  where ge.id = p_expense_id
  for update;

  if v_group.status <> 'active' or v_group.archived_at is not null then
    raise exception 'Group is unavailable or archived' using errcode = '22023';
  end if;

  perform 1
  from public.group_members as gm
  where gm.group_id = v_expense.group_id
    and gm.user_id = v_actor_id
    and gm.status = 'active'
  for share;
  if not found then
    raise exception 'Active group membership required' using errcode = '42501';
  end if;
  if v_expense.created_by <> v_actor_id and v_group.owner_id <> v_actor_id then
    raise exception 'Only the creator or group owner may delete this expense'
      using errcode = '42501';
  end if;

  if v_expense.deleted_at is not null then
    return v_expense;
  end if;

  update public.group_expenses
  set deleted_at = now()
  where id = p_expense_id
  returning * into v_expense;

  return v_expense;
end;
$$;

-- This helper is the database equivalent of src/groups/domain.js's
-- deterministic simplifyTransfers algorithm. It derives current net balances
-- from non-deleted financial history, sorts debtors by debt descending then UUID
-- and creditors by credit descending then UUID, and greedily matches the two.
create or replace function public.current_group_suggested_transfers(p_group_id uuid)
returns table (payer_id uuid, recipient_id uuid, amount_minor bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_debtor_ids uuid[];
  v_debtor_amounts bigint[];
  v_creditor_ids uuid[];
  v_creditor_amounts bigint[];
  v_debtor_index integer := 1;
  v_creditor_index integer := 1;
  v_debtor_remaining bigint;
  v_creditor_remaining bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.is_active_group_member(p_group_id) then
    raise exception 'Active group membership required' using errcode = '42501';
  end if;

  with movements as (
    select ge.payer_id as user_id, ge.amount_minor as delta_minor
    from public.group_expenses as ge
    where ge.group_id = p_group_id and ge.deleted_at is null
    union all
    select ep.member_id, -ep.share_minor
    from public.expense_participants as ep
    join public.group_expenses as ge on ge.id = ep.expense_id
    where ge.group_id = p_group_id and ge.deleted_at is null
    union all
    select gr.payer_id, gr.amount_minor
    from public.group_repayments as gr
    where gr.group_id = p_group_id and gr.deleted_at is null
    union all
    select gr.recipient_id, -gr.amount_minor
    from public.group_repayments as gr
    where gr.group_id = p_group_id and gr.deleted_at is null
  ), balances as (
    select movements.user_id, sum(movements.delta_minor)::bigint as balance_minor
    from movements
    group by movements.user_id
  )
  select
    array_agg(user_id order by balance_minor asc, user_id::text asc),
    array_agg((-balance_minor)::bigint order by balance_minor asc, user_id::text asc)
  into v_debtor_ids, v_debtor_amounts
  from balances
  where balance_minor < 0;

  with movements as (
    select ge.payer_id as user_id, ge.amount_minor as delta_minor
    from public.group_expenses as ge
    where ge.group_id = p_group_id and ge.deleted_at is null
    union all
    select ep.member_id, -ep.share_minor
    from public.expense_participants as ep
    join public.group_expenses as ge on ge.id = ep.expense_id
    where ge.group_id = p_group_id and ge.deleted_at is null
    union all
    select gr.payer_id, gr.amount_minor
    from public.group_repayments as gr
    where gr.group_id = p_group_id and gr.deleted_at is null
    union all
    select gr.recipient_id, -gr.amount_minor
    from public.group_repayments as gr
    where gr.group_id = p_group_id and gr.deleted_at is null
  ), balances as (
    select movements.user_id, sum(movements.delta_minor)::bigint as balance_minor
    from movements
    group by movements.user_id
  )
  select
    array_agg(user_id order by balance_minor desc, user_id::text asc),
    array_agg(balance_minor order by balance_minor desc, user_id::text asc)
  into v_creditor_ids, v_creditor_amounts
  from balances
  where balance_minor > 0;

  if coalesce(array_length(v_debtor_ids, 1), 0) = 0
     or coalesce(array_length(v_creditor_ids, 1), 0) = 0 then
    return;
  end if;

  v_debtor_remaining := v_debtor_amounts[v_debtor_index];
  v_creditor_remaining := v_creditor_amounts[v_creditor_index];

  while v_debtor_index <= array_length(v_debtor_ids, 1)
    and v_creditor_index <= array_length(v_creditor_ids, 1)
  loop
    payer_id := v_debtor_ids[v_debtor_index];
    recipient_id := v_creditor_ids[v_creditor_index];
    amount_minor := least(v_debtor_remaining, v_creditor_remaining);
    return next;

    v_debtor_remaining := v_debtor_remaining - amount_minor;
    v_creditor_remaining := v_creditor_remaining - amount_minor;

    if v_debtor_remaining = 0 then
      v_debtor_index := v_debtor_index + 1;
      if v_debtor_index <= array_length(v_debtor_ids, 1) then
        v_debtor_remaining := v_debtor_amounts[v_debtor_index];
      end if;
    end if;
    if v_creditor_remaining = 0 then
      v_creditor_index := v_creditor_index + 1;
      if v_creditor_index <= array_length(v_creditor_ids, 1) then
        v_creditor_remaining := v_creditor_amounts[v_creditor_index];
      end if;
    end if;
  end loop;
end;
$$;

create or replace function public.save_group_repayment(payload jsonb)
returns public.group_repayments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_group_id uuid := (payload ->> 'group_id')::uuid;
  v_payer_id uuid := (payload ->> 'payer_id')::uuid;
  v_recipient_id uuid := (payload ->> 'recipient_id')::uuid;
  v_idempotency_key text := nullif(btrim(payload ->> 'idempotency_key'), '');
  v_amount_minor bigint := (payload ->> 'amount_minor')::bigint;
  v_repayment_date date := coalesce(
    nullif(payload ->> 'repayment_date', '')::date,
    nullif(payload ->> 'date', '')::date
  );
  v_group public.groups%rowtype;
  v_repayment public.group_repayments%rowtype;
  v_suggested_amount bigint;
  v_active_count integer;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Every financial RPC locks the group row. Repayments with different
  -- idempotency keys therefore cannot both validate against the same balance.
  select g.* into v_group
  from public.groups as g
  where g.id = v_group_id
  for update;

  if not found or v_group.status <> 'active' or v_group.archived_at is not null then
    raise exception 'Group is unavailable or archived' using errcode = '22023';
  end if;

  perform 1
  from public.group_members as gm
  where gm.group_id = v_group_id
    and gm.user_id = v_actor_id
    and gm.status = 'active'
  for share;
  if not found then
    raise exception 'Active group membership required' using errcode = '42501';
  end if;

  if v_idempotency_key is null then
    raise exception 'Idempotency key is required' using errcode = '22023';
  end if;

  select gr.* into v_repayment
  from public.group_repayments as gr
  where gr.group_id = v_group_id
    and gr.idempotency_key = v_idempotency_key;
  if found then
    return v_repayment;
  end if;

  if v_payer_id = v_recipient_id then
    raise exception 'Payer and recipient must be different members' using errcode = '22023';
  end if;
  if v_amount_minor is null or v_amount_minor <= 0 then
    raise exception 'Amount must be greater than zero' using errcode = '22023';
  end if;
  if v_repayment_date is null then
    raise exception 'Repayment date is required' using errcode = '22023';
  end if;

  perform 1
  from public.group_members as gm
  where gm.group_id = v_group_id
    and gm.user_id in (v_payer_id, v_recipient_id)
  for share;

  select count(*) into v_active_count
  from public.group_members as gm
  where gm.group_id = v_group_id
    and gm.status = 'active'
    and gm.user_id in (v_payer_id, v_recipient_id);
  if v_active_count <> 2 then
    raise exception 'Payer and recipient must be active group members' using errcode = '22023';
  end if;

  select transfer.amount_minor
  into v_suggested_amount
  from public.current_group_suggested_transfers(v_group_id) as transfer
  where transfer.payer_id = v_payer_id
    and transfer.recipient_id = v_recipient_id;

  if v_suggested_amount is null then
    raise exception 'No current suggested transfer exists for these members' using errcode = '22023';
  end if;
  if v_amount_minor > v_suggested_amount then
    raise exception 'Repayment amount exceeds the current suggested transfer' using errcode = '22023';
  end if;

  insert into public.group_repayments (
    group_id,
    idempotency_key,
    payer_id,
    recipient_id,
    amount_minor,
    repayment_date,
    created_by
  ) values (
    v_group_id,
    v_idempotency_key,
    v_payer_id,
    v_recipient_id,
    v_amount_minor,
    v_repayment_date,
    v_actor_id
  )
  on conflict (group_id, idempotency_key) do nothing
  returning * into v_repayment;

  if v_repayment.id is null then
    select gr.* into strict v_repayment
    from public.group_repayments as gr
    where gr.group_id = v_group_id
      and gr.idempotency_key = v_idempotency_key;
  end if;

  return v_repayment;
end;
$$;

create or replace function public.transfer_group_ownership(
  p_group_id uuid,
  p_new_owner_id uuid
)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_group public.groups%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select g.* into v_group
  from public.groups as g
  where g.id = p_group_id
  for update;

  if not found or v_group.status <> 'active' or v_group.archived_at is not null then
    raise exception 'Group is unavailable or archived' using errcode = '22023';
  end if;
  if v_group.owner_id <> v_actor_id then
    raise exception 'Only the active group owner may transfer ownership'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.group_members as gm
    where gm.group_id = p_group_id
      and gm.user_id = v_actor_id
      and gm.status = 'active'
  ) then
    raise exception 'Only the active group owner may transfer ownership'
      using errcode = '42501';
  end if;

  perform 1
  from public.group_members as gm
  where gm.group_id = p_group_id
    and gm.user_id = p_new_owner_id
    and gm.status = 'active'
  for update;
  if not found then
    raise exception 'New owner must be an active group member' using errcode = '22023';
  end if;

  if p_new_owner_id = v_actor_id then
    return v_group;
  end if;

  update public.groups
  set owner_id = p_new_owner_id
  where id = p_group_id
  returning * into v_group;

  update public.group_members
  set role = case
    when user_id = p_new_owner_id then 'owner'
    when user_id = v_actor_id then 'member'
    else role
  end
  where group_id = p_group_id
    and user_id in (v_actor_id, p_new_owner_id);

  return v_group;
end;
$$;

create or replace function public.archive_group(p_group_id uuid)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.groups%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select g.* into v_group
  from public.groups as g
  where g.id = p_group_id
  for update;

  if not found or v_group.owner_id <> auth.uid() or not public.is_group_owner(p_group_id) then
    raise exception 'Only the active group owner may archive this group' using errcode = '42501';
  end if;

  update public.group_invites
  set is_active = false, revoked_at = now()
  where group_id = p_group_id and is_active = true;

  update public.groups
  set status = 'archived', archived_at = now()
  where id = p_group_id
  returning * into v_group;
  return v_group;
end;
$$;

create or replace function public.reopen_group(p_group_id uuid)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.groups%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select g.* into v_group
  from public.groups as g
  where g.id = p_group_id
  for update;

  if not found or v_group.owner_id <> auth.uid() or not public.is_group_owner(p_group_id) then
    raise exception 'Only the active group owner may reopen this group' using errcode = '42501';
  end if;

  update public.groups
  set status = 'active', archived_at = null
  where id = p_group_id
  returning * into v_group;
  return v_group;
end;
$$;

-- Browser roles can read financial rows through RLS but cannot mutate them
-- directly. Expense create/edit/delete is transactional through the RPCs above.
revoke insert, update, delete on public.group_expenses from authenticated;
revoke insert, update, delete on public.expense_participants from authenticated;

-- Metadata remains owner-editable, but owner_id is only writable by the
-- transfer_group_ownership RPC after locking and validating the new owner.
revoke update on public.groups from authenticated;
grant update (name, icon, currency, starts_on, ends_on)
  on public.groups to authenticated;

revoke all on function public.handle_new_user() from public;
revoke all on function public.protect_current_owner_membership() from public;
revoke all on function public.protect_group_currency() from public;
revoke all on function public.lock_financial_group() from public;
revoke all on function public.protect_repayment_financial_fields() from public;
revoke all on function public.is_active_group_member(uuid) from public;
revoke all on function public.is_group_owner(uuid) from public;
revoke all on function public.has_no_group_members(uuid) from public;
revoke all on function public.is_uninitialized_group_owner(uuid) from public;
revoke all on function public.can_view_profile(uuid) from public;
revoke all on function public.join_group(text) from public;
revoke all on function public.assert_valid_equal_expense_draft(uuid, bigint, uuid, jsonb) from public;
revoke all on function public.save_group_expense(jsonb) from public;
revoke all on function public.update_group_expense(jsonb) from public;
revoke all on function public.delete_group_expense(uuid) from public;
revoke all on function public.current_group_suggested_transfers(uuid) from public;
revoke all on function public.save_group_repayment(jsonb) from public;
revoke all on function public.transfer_group_ownership(uuid, uuid) from public;
revoke all on function public.archive_group(uuid) from public;
revoke all on function public.reopen_group(uuid) from public;

grant execute on function public.is_active_group_member(uuid) to authenticated;
grant execute on function public.is_group_owner(uuid) to authenticated;
grant execute on function public.has_no_group_members(uuid) to authenticated;
grant execute on function public.is_uninitialized_group_owner(uuid) to authenticated;
grant execute on function public.can_view_profile(uuid) to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.save_group_expense(jsonb) to authenticated;
grant execute on function public.update_group_expense(jsonb) to authenticated;
grant execute on function public.delete_group_expense(uuid) to authenticated;
grant execute on function public.current_group_suggested_transfers(uuid) to authenticated;
grant execute on function public.save_group_repayment(jsonb) to authenticated;
grant execute on function public.transfer_group_ownership(uuid, uuid) to authenticated;
grant execute on function public.archive_group(uuid) to authenticated;
grant execute on function public.reopen_group(uuid) to authenticated;
