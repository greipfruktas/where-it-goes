-- Private, local-first Personal expense synchronization.

create table public.personal_expenses (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  expense_id text not null check (btrim(expense_id) <> ''),
  amount_minor bigint,
  category text,
  labels text[] not null default '{}',
  reimbursement_percent smallint,
  expense_date date,
  note text not null default '',
  created_at_client bigint,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, expense_id),
  check (
    deleted_at is not null
    or (
      amount_minor > 0
      and btrim(category) <> ''
      and reimbursement_percent between 0 and 100
      and expense_date is not null
      and created_at_client is not null
    )
  )
);

create table public.personal_settings (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  categories jsonb not null check (jsonb_typeof(categories) = 'array'),
  style text not null check (style in ('pocket', 'neon', 'swiss')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.personal_operations (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  operation_id text not null check (btrim(operation_id) <> ''),
  kind text not null check (kind in ('expense_upsert', 'expense_delete', 'settings_replace')),
  applied_at timestamptz not null default now(),
  primary key (owner_id, operation_id)
);

create index personal_expenses_owner_updated_idx
  on public.personal_expenses(owner_id, updated_at);

alter table public.personal_expenses enable row level security;
alter table public.personal_settings enable row level security;
alter table public.personal_operations enable row level security;

create policy "owners read personal expenses"
on public.personal_expenses for select to authenticated
using (owner_id = auth.uid());

create policy "owners read personal settings"
on public.personal_settings for select to authenticated
using (owner_id = auth.uid());

create policy "owners read personal operations"
on public.personal_operations for select to authenticated
using (owner_id = auth.uid());

create or replace function public.apply_personal_operation(payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_operation_id text := nullif(btrim(payload ->> 'operation_id'), '');
  v_kind text := payload ->> 'kind';
  v_expense jsonb := payload -> 'expense';
  v_expense_id text;
  v_amount_minor bigint;
  v_category text;
  v_labels text[];
  v_reimbursement_percent smallint;
  v_expense_date date;
  v_note text;
  v_created_at_client bigint;
  v_categories jsonb;
  v_style text;
  v_inserted integer;
begin
  if v_owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Personal operation must be an object' using errcode = '22023';
  end if;
  if payload ? 'owner_id' then
    raise exception 'Personal operation must not include owner_id' using errcode = '22023';
  end if;
  if v_operation_id is null then
    raise exception 'Personal operation ID is required' using errcode = '22023';
  end if;
  if v_kind not in ('expense_upsert', 'expense_delete', 'settings_replace') then
    raise exception 'Unknown personal operation kind' using errcode = '22023';
  end if;

  if v_kind = 'expense_upsert' then
    if jsonb_typeof(v_expense) <> 'object' then
      raise exception 'Expense payload is required' using errcode = '22023';
    end if;
    v_expense_id := nullif(btrim(v_expense ->> 'id'), '');
    v_amount_minor := (v_expense ->> 'amount_minor')::bigint;
    v_category := nullif(btrim(v_expense ->> 'category'), '');
    v_reimbursement_percent := (v_expense ->> 'reimbursement_percent')::smallint;
    v_expense_date := (v_expense ->> 'date')::date;
    v_note := coalesce(v_expense ->> 'note', '');
    v_created_at_client := (v_expense ->> 'created_at_client')::bigint;
    if jsonb_typeof(v_expense -> 'labels') <> 'array' then
      raise exception 'Expense labels must be an array' using errcode = '22023';
    end if;
    select coalesce(array_agg(label), '{}') into v_labels
    from jsonb_array_elements_text(v_expense -> 'labels') as item(label);
    if v_expense_id is null or v_amount_minor <= 0 or v_category is null
       or v_reimbursement_percent not between 0 and 100
       or v_created_at_client is null then
      raise exception 'Expense payload is invalid' using errcode = '22023';
    end if;
  elsif v_kind = 'expense_delete' then
    v_expense_id := nullif(btrim(payload ->> 'expense_id'), '');
    if v_expense_id is null then
      raise exception 'Expense ID is required for deletion' using errcode = '22023';
    end if;
  else
    v_categories := payload -> 'categories';
    v_style := payload ->> 'style';
    if jsonb_typeof(v_categories) <> 'array' or jsonb_array_length(v_categories) = 0 then
      raise exception 'Settings categories must be a non-empty array' using errcode = '22023';
    end if;
    if v_style not in ('pocket', 'neon', 'swiss') then
      raise exception 'Settings style is invalid' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_categories) as category
      where jsonb_typeof(category) <> 'object'
        or nullif(btrim(category ->> 'name'), '') is null
        or nullif(btrim(category ->> 'emoji'), '') is null
        or nullif(btrim(category ->> 'color'), '') is null
    ) then
      raise exception 'Settings category is invalid' using errcode = '22023';
    end if;
  end if;

  insert into public.personal_operations (owner_id, operation_id, kind)
  values (v_owner_id, v_operation_id, v_kind)
  on conflict (owner_id, operation_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return false;
  end if;

  if v_kind = 'expense_upsert' then
    insert into public.personal_expenses (
      owner_id, expense_id, amount_minor, category, labels,
      reimbursement_percent, expense_date, note, created_at_client, deleted_at
    ) values (
      v_owner_id, v_expense_id, v_amount_minor, v_category, v_labels,
      v_reimbursement_percent, v_expense_date, v_note, v_created_at_client, null
    )
    on conflict (owner_id, expense_id) do update set
      amount_minor = excluded.amount_minor,
      category = excluded.category,
      labels = excluded.labels,
      reimbursement_percent = excluded.reimbursement_percent,
      expense_date = excluded.expense_date,
      note = excluded.note,
      created_at_client = excluded.created_at_client,
      deleted_at = null,
      updated_at = now();
  elsif v_kind = 'expense_delete' then
    insert into public.personal_expenses (owner_id, expense_id, deleted_at)
    values (v_owner_id, v_expense_id, now())
    on conflict (owner_id, expense_id) do update set
      deleted_at = now(),
      updated_at = now();
  else
    insert into public.personal_settings (owner_id, categories, style)
    values (v_owner_id, v_categories, v_style)
    on conflict (owner_id) do update set
      categories = excluded.categories,
      style = excluded.style,
      updated_at = now();
  end if;

  return true;
end;
$$;

grant select on public.personal_expenses to authenticated;
grant select on public.personal_settings to authenticated;
grant select on public.personal_operations to authenticated;
revoke insert, update, delete on public.personal_expenses from authenticated;
revoke insert, update, delete on public.personal_settings from authenticated;
revoke insert, update, delete on public.personal_operations from authenticated;
revoke all on function public.apply_personal_operation(jsonb) from public;
grant execute on function public.apply_personal_operation(jsonb) to authenticated;
