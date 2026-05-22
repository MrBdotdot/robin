-- migration-007-invite-dedup-and-member-check.sql
-- Two rejections on rr_invites:
--   1. No two pending invites for the same email (partial unique index, case-insensitive).
--   2. No invite for an email that already belongs to a member.
--
-- Both surface as Postgres exceptions; the frontend translates the
-- specific error codes into friendly toast messages.

begin;

-- ---- 1) Prevent duplicate pending invites for the same email -------------
create unique index if not exists rr_invites_unique_pending_email
  on rr_invites (lower(email))
  where accepted_at is null;

-- ---- 2) Reject invites for emails that already have a membership ---------
create or replace function rr_invites_reject_existing_member()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if exists (
    select 1
    from auth.users u
    join rr_memberships m on m.user_id = u.id
    where lower(u.email) = lower(new.email)
  ) then
    raise exception 'email % is already a member', new.email
      using errcode = '23514'; -- check_violation
  end if;
  return new;
end;
$$;

drop trigger if exists rr_invites_reject_existing_member_trg on rr_invites;
create trigger rr_invites_reject_existing_member_trg
  before insert on rr_invites
  for each row execute function rr_invites_reject_existing_member();

commit;
