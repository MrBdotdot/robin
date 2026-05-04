-- migration-004-auth-phase-2.sql
-- Adds the auth/membership/invite tables and helper functions.
-- RLS policies live in migration-005 so the bootstrap sign-in can run
-- against permissive policies first.

begin;

-- =========================================================================
-- Tables
-- =========================================================================

create table rr_memberships (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  role        text not null check (role in ('admin','scorekeeper','participant')),
  created_at  timestamptz not null default now()
);

create index rr_memberships_user_id_idx on rr_memberships (user_id);

create table rr_invites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  role        text not null check (role in ('admin','scorekeeper','participant')),
  token       text not null unique,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now()
);

create index rr_invites_token_idx on rr_invites (token);
create index rr_invites_email_idx on rr_invites (email);

create table rr_event_collaborators (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  event_id    uuid not null references rr_events(id) on delete cascade,
  granted_by  uuid not null references auth.users(id),
  granted_at  timestamptz not null default now(),
  unique (user_id, event_id)
);

create index rr_event_collaborators_user_id_idx on rr_event_collaborators (user_id);
create index rr_event_collaborators_event_id_idx on rr_event_collaborators (event_id);

-- =========================================================================
-- Helper functions
-- =========================================================================

-- True if the calling user has any membership row.
create or replace function rr_is_member()
returns boolean language sql stable as $$
  select exists (select 1 from rr_memberships where user_id = auth.uid());
$$;

-- True if the calling user is an admin.
create or replace function rr_is_admin()
returns boolean language sql stable as $$
  select exists (
    select 1 from rr_memberships
    where user_id = auth.uid() and role = 'admin'
  );
$$;

-- True if the calling user is a scorekeeper for the given event.
-- Existence of an rr_event_collaborators row is the source of truth;
-- we additionally require the user has the scorekeeper role to avoid
-- granting score-edit power to a stale collaborator row after a role change.
create or replace function rr_can_score(_event_id uuid)
returns boolean language sql stable as $$
  select rr_is_admin()
      or exists (
           select 1 from rr_event_collaborators ec
           join rr_memberships m on m.user_id = ec.user_id
           where ec.user_id = auth.uid()
             and ec.event_id = _event_id
             and m.role = 'scorekeeper'
         );
$$;

-- Phase 2 stub: returns false. Sub-project 2 (slim claim) replaces this
-- with claim-aware logic that joins rr_event_players on rr_players.claimed_by_user_id.
create or replace function rr_is_in_event(_event_id uuid)
returns boolean language sql stable as $$
  select false;
$$;

-- =========================================================================
-- RPC: anon-callable invite lookup by token (capability-style auth)
-- =========================================================================

create or replace function lookup_invite(_token text)
returns table (
  id uuid,
  email text,
  role text,
  expires_at timestamptz,
  accepted_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select id, email, role, expires_at, accepted_at
  from rr_invites
  where token = _token
  limit 1;
$$;

grant execute on function lookup_invite(text) to anon, authenticated;

-- =========================================================================
-- View: rr_memberships joined with auth.users.email for admin sheets
-- (used by the AssignScorekeepersSheet to list scorekeepers by email).
-- =========================================================================

create or replace view rr_memberships_with_email as
select m.id, m.user_id, m.role, m.created_at, u.email
from rr_memberships m
left join auth.users u on u.id = m.user_id;

grant select on rr_memberships_with_email to authenticated;

-- =========================================================================
-- Verification
-- =========================================================================

-- After running, sanity-check:
select 'rr_memberships' as table_name, count(*) from rr_memberships
union all
select 'rr_invites', count(*) from rr_invites
union all
select 'rr_event_collaborators', count(*) from rr_event_collaborators;

-- Expected: all three return 0 rows.

commit;
