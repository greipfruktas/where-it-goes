-- Apply after 001_shared_groups.sql on existing installations.
-- Archiving atomically revokes invitations, and archived groups reject owner mutations.

drop policy if exists "owners manage group metadata" on public.groups;
create policy "owners manage group metadata"
on public.groups for update to authenticated
using (public.is_group_owner(id) and status = 'active' and archived_at is null)
with check (public.is_active_group_member(id) and status = 'active' and archived_at is null);

drop policy if exists "owners add members" on public.group_members;
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

drop policy if exists "owners manage members" on public.group_members;
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

drop policy if exists "owners rotate or disable invitations" on public.group_invites;
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
  select g.* into v_group from public.groups as g where g.id = p_group_id for update;
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
  select g.* into v_group from public.groups as g where g.id = p_group_id for update;
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

revoke update on public.groups from authenticated;
grant update (name, icon, currency, starts_on, ends_on) on public.groups to authenticated;
revoke all on function public.archive_group(uuid) from public;
revoke all on function public.reopen_group(uuid) from public;
grant execute on function public.archive_group(uuid) to authenticated;
grant execute on function public.reopen_group(uuid) to authenticated;
