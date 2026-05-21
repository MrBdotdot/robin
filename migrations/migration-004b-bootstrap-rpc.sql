-- migration-004b-bootstrap-rpc.sql
-- Adds bootstrap_membership() and accept_invite() RPCs needed for the auth
-- flow. These were originally bundled into migration-005 alongside RLS
-- tightening, but they need to exist BEFORE the first sign-in (so the admin
-- row gets created) while RLS stays permissive until after that first sign-in.
--
-- Safe to apply at any time. Idempotent — also re-created by migration-005.

begin;

-- Invite-acceptance helper: signed-in user redeems a token, gets a membership
-- row with the role from the invite. Used by Invite.tsx redemption page.
create or replace function accept_invite(_token text)
returns rr_memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  inv rr_invites%rowtype;
  membership rr_memberships%rowtype;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to accept an invite';
  end if;

  select * into inv from rr_invites where token = _token;
  if not found then
    raise exception 'invite not found';
  end if;
  if inv.accepted_at is not null then
    raise exception 'invite already accepted';
  end if;
  if inv.expires_at < now() then
    raise exception 'invite expired';
  end if;

  -- Idempotent: if user already has a membership, return it without altering role.
  select * into membership from rr_memberships where user_id = auth.uid();
  if found then
    update rr_invites set accepted_at = now() where id = inv.id;
    return membership;
  end if;

  insert into rr_memberships (user_id, role) values (auth.uid(), inv.role)
  returning * into membership;

  update rr_invites set accepted_at = now() where id = inv.id;
  return membership;
end;
$$;

grant execute on function accept_invite(text) to authenticated;

-- Bootstrap sign-in helper: idempotent membership creation on first sign-in.
-- First user with no admin existing becomes admin; everyone else becomes participant.
create or replace function bootstrap_membership()
returns rr_memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  membership rr_memberships%rowtype;
  has_admin boolean;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;

  select * into membership from rr_memberships where user_id = auth.uid();
  if found then
    return membership;
  end if;

  select exists (select 1 from rr_memberships where role = 'admin') into has_admin;

  insert into rr_memberships (user_id, role)
  values (auth.uid(), case when has_admin then 'participant' else 'admin' end)
  returning * into membership;

  return membership;
end;
$$;

grant execute on function bootstrap_membership() to authenticated;

commit;
