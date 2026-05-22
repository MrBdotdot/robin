-- migration-004a-fix-view-security.sql
-- Fixes two Supabase linter warnings on rr_memberships_with_email:
--   1. "Exposed Auth Users" — the view granted SELECT to all authenticated users,
--      exposing emails too broadly.
--   2. "Security Definer View" — Postgres views default to running with the
--      view-creator's privileges, which bypasses RLS.
--
-- Solution: drop the view and replace with a SECURITY DEFINER function that
-- does an explicit admin check before returning rows. Only admins can read
-- the email list (used by AssignScorekeepersSheet).

begin;

-- Drop the problematic view
drop view if exists rr_memberships_with_email;

-- Replace with an RPC that does the admin check inline.
-- Only callable by signed-in users; only admins get rows back.
create or replace function list_scorekeepers_with_email()
returns table (
  id uuid,
  user_id uuid,
  role text,
  created_at timestamptz,
  email text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not rr_is_admin() then
    raise exception 'admin only';
  end if;
  return query
    select m.id, m.user_id, m.role, m.created_at, u.email
    from rr_memberships m
    left join auth.users u on u.id = m.user_id
    where m.role = 'scorekeeper'
    order by u.email;
end;
$$;

grant execute on function list_scorekeepers_with_email() to authenticated;

commit;
