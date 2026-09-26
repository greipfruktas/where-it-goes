-- Restore the browser role's table privileges. Row-level security remains the
-- authorization boundary, and financial writes remain RPC-only.

grant select on table
  public.profiles,
  public.groups,
  public.group_members,
  public.group_invites,
  public.group_expenses,
  public.expense_participants,
  public.group_repayments
to authenticated;

grant insert on table public.groups, public.group_members, public.group_invites
to authenticated;

grant update (status, removed_at) on public.group_members to authenticated;
grant update (is_active, revoked_at) on public.group_invites to authenticated;

-- Reassert the intentionally narrow financial boundary.
revoke insert, update, delete on public.group_expenses from authenticated;
revoke insert, update, delete on public.expense_participants from authenticated;
