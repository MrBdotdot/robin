-- migration-006-rename-scorekeeper-to-organizer.sql
-- Renames the 'scorekeeper' role to 'organizer' throughout the database.
-- Same permissions, friendlier label. UI also drops the 'admin' option from
-- the invite dropdown (admin role stays a back-end concept, manually
-- promoted via SQL).
--
-- Apply at any time. Idempotent.

begin;

-- Migrate any existing rows
update rr_memberships set role = 'organizer' where role = 'scorekeeper';
update rr_invites set role = 'organizer' where role = 'scorekeeper';

-- Replace check constraints
alter table rr_memberships drop constraint if exists rr_memberships_role_check;
alter table rr_memberships add constraint rr_memberships_role_check
  check (role in ('admin','organizer','participant'));

alter table rr_invites drop constraint if exists rr_invites_role_check;
alter table rr_invites add constraint rr_invites_role_check
  check (role in ('admin','organizer','participant'));

-- rr_can_score: check for organizer role instead of scorekeeper
create or replace function rr_can_score(_event_id uuid)
returns boolean language sql stable as $$
  select rr_is_admin()
      or exists (
           select 1 from rr_event_collaborators ec
           join rr_memberships m on m.user_id = ec.user_id
           where ec.user_id = auth.uid()
             and ec.event_id = _event_id
             and m.role = 'organizer'
         );
$$;

-- Replace list_scorekeepers_with_email with list_organizers_with_email
drop function if exists list_scorekeepers_with_email();

create or replace function list_organizers_with_email()
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
    where m.role = 'organizer'
    order by u.email;
end;
$$;

grant execute on function list_organizers_with_email() to authenticated;

commit;
