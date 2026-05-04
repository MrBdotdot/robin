-- migration-005-rls-tighten.sql
-- Tightens RLS across every rr_* table to use the three-role model.
-- IMPORTANT: apply only AFTER the owner has signed in via magic link
-- (so an admin membership row exists). Otherwise you lock yourself out.

begin;

-- =========================================================================
-- Drop old permissive policies. Names assumed from migration-001; adjust if
-- your policies are named differently. List them in Supabase Studio first
-- if unsure: select tablename, policyname from pg_policies where tablename like 'rr_%';
-- =========================================================================

do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public' and tablename like 'rr_%'
  loop
    execute format('drop policy if exists %I on %I.%I',
                   r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- =========================================================================
-- Helper macro pattern repeated below: each existing data table gets
-- read by admin/member-of-event/collaborator, and writes restricted to admin
-- (with rr_matches.update having the scorekeeper exception).
-- =========================================================================

-- ---- rr_players ----------------------------------------------------------
alter table rr_players enable row level security;

create policy rr_players_select on rr_players for select using (
  rr_is_admin()
  -- non-admin scope: self + co-players in events they're in.
  -- Phase 2 stub: rr_is_in_event returns false, so non-admins see nothing here.
  -- Sub-project 2 will replace rr_is_in_event and add a "self via claim" branch.
  or exists (
    select 1 from rr_event_players ep
    where ep.player_id = rr_players.id
      and rr_is_in_event(ep.event_id)
  )
);

create policy rr_players_insert on rr_players for insert with check (rr_is_admin());
create policy rr_players_update on rr_players for update using (rr_is_admin()) with check (rr_is_admin());
create policy rr_players_delete on rr_players for delete using (rr_is_admin());

-- ---- rr_pairs ------------------------------------------------------------
alter table rr_pairs enable row level security;

create policy rr_pairs_select on rr_pairs for select using (
  rr_is_admin()
  or exists (
    select 1 from rr_event_players ep
    where (ep.player_id = rr_pairs.player_a_id or ep.player_id = rr_pairs.player_b_id)
      and rr_is_in_event(ep.event_id)
  )
);

create policy rr_pairs_insert on rr_pairs for insert with check (rr_is_admin());
create policy rr_pairs_update on rr_pairs for update using (rr_is_admin()) with check (rr_is_admin());
create policy rr_pairs_delete on rr_pairs for delete using (rr_is_admin());

-- ---- rr_events -----------------------------------------------------------
alter table rr_events enable row level security;

create policy rr_events_select on rr_events for select using (
  rr_is_admin()
  or rr_is_in_event(id)
  or exists (
    select 1 from rr_event_collaborators
    where event_id = rr_events.id and user_id = auth.uid()
  )
);

create policy rr_events_insert on rr_events for insert with check (rr_is_admin());
create policy rr_events_update on rr_events for update using (rr_is_admin()) with check (rr_is_admin());
create policy rr_events_delete on rr_events for delete using (rr_is_admin());

-- ---- rr_event_players ----------------------------------------------------
alter table rr_event_players enable row level security;

create policy rr_event_players_select on rr_event_players for select using (
  rr_is_admin()
  or rr_is_in_event(event_id)
  or exists (
    select 1 from rr_event_collaborators
    where event_id = rr_event_players.event_id and user_id = auth.uid()
  )
);

create policy rr_event_players_insert on rr_event_players for insert with check (rr_is_admin());
create policy rr_event_players_update on rr_event_players for update using (rr_is_admin()) with check (rr_is_admin());
create policy rr_event_players_delete on rr_event_players for delete using (rr_is_admin());

-- ---- rr_matches ----------------------------------------------------------
alter table rr_matches enable row level security;

create policy rr_matches_select on rr_matches for select using (
  rr_is_admin()
  or rr_is_in_event(event_id)
  or exists (
    select 1 from rr_event_collaborators
    where event_id = rr_matches.event_id and user_id = auth.uid()
  )
);

create policy rr_matches_insert on rr_matches for insert with check (rr_is_admin());

-- The scorekeeper exception lives only on update, and only on score-related
-- columns. Postgres RLS doesn't gate columns directly — we accept that any
-- update by a scorekeeper passes RLS, and rely on the frontend to limit edits
-- to score fields. (A trigger could enforce this, deferred — see open knobs.)
create policy rr_matches_update on rr_matches for update
  using (rr_can_score(event_id))
  with check (rr_can_score(event_id));

create policy rr_matches_delete on rr_matches for delete using (rr_is_admin());

-- ---- rr_series ----------------------------------------------------------
alter table rr_series enable row level security;

create policy rr_series_select on rr_series for select using (
  rr_is_admin()
  or exists (
    select 1 from rr_events e
    where e.series_id = rr_series.id and rr_is_in_event(e.id)
  )
);

create policy rr_series_insert on rr_series for insert with check (rr_is_admin());
create policy rr_series_update on rr_series for update using (rr_is_admin()) with check (rr_is_admin());
create policy rr_series_delete on rr_series for delete using (rr_is_admin());

-- ---- rr_series_ratings ---------------------------------------------------
alter table rr_series_ratings enable row level security;

create policy rr_series_ratings_select on rr_series_ratings for select using (
  rr_is_admin()
  or exists (
    select 1 from rr_event_players ep
    join rr_events e on e.id = ep.event_id
    where ep.player_id = rr_series_ratings.player_id
      and e.series_id = rr_series_ratings.series_id
      and rr_is_in_event(e.id)
  )
);

create policy rr_series_ratings_write on rr_series_ratings for all using (rr_is_admin()) with check (rr_is_admin());

-- ---- rr_rating_history + rr_pair_rating_history --------------------------
alter table rr_rating_history enable row level security;
create policy rr_rating_history_select on rr_rating_history for select using (
  rr_is_admin()
  or exists (
    select 1 from rr_event_players ep
    where ep.player_id = rr_rating_history.player_id
      and rr_is_in_event(ep.event_id)
  )
);
create policy rr_rating_history_write on rr_rating_history for all using (rr_is_admin()) with check (rr_is_admin());

alter table rr_pair_rating_history enable row level security;
create policy rr_pair_rating_history_select on rr_pair_rating_history for select using (rr_is_admin());
create policy rr_pair_rating_history_write on rr_pair_rating_history for all using (rr_is_admin()) with check (rr_is_admin());

-- =========================================================================
-- Phase 2 tables
-- =========================================================================

-- rr_memberships: own row visible to self; admins see all; writes admin-only
alter table rr_memberships enable row level security;

create policy rr_memberships_select_self on rr_memberships for select using (
  user_id = auth.uid() or rr_is_admin()
);
create policy rr_memberships_insert_admin on rr_memberships for insert with check (rr_is_admin());
create policy rr_memberships_update_admin on rr_memberships for update using (rr_is_admin()) with check (rr_is_admin());
create policy rr_memberships_delete_admin on rr_memberships for delete using (rr_is_admin());

-- rr_invites: admin-only for direct table access. Anon redemption goes
-- through the lookup_invite RPC (security definer) defined in migration-004.
alter table rr_invites enable row level security;

create policy rr_invites_select_admin on rr_invites for select using (rr_is_admin());
create policy rr_invites_insert_admin on rr_invites for insert with check (rr_is_admin());
create policy rr_invites_update_admin on rr_invites for update using (rr_is_admin()) with check (rr_is_admin());
create policy rr_invites_delete_admin on rr_invites for delete using (rr_is_admin());

-- rr_event_collaborators: admin sees all; user sees own rows; writes admin-only
alter table rr_event_collaborators enable row level security;

create policy rr_event_collaborators_select on rr_event_collaborators for select using (
  user_id = auth.uid() or rr_is_admin()
);
create policy rr_event_collaborators_insert_admin on rr_event_collaborators for insert with check (rr_is_admin());
create policy rr_event_collaborators_update_admin on rr_event_collaborators for update using (rr_is_admin()) with check (rr_is_admin());
create policy rr_event_collaborators_delete_admin on rr_event_collaborators for delete using (rr_is_admin());

-- =========================================================================
-- Special-case: invite-acceptance must be able to insert a membership row
-- and update the invite (mark accepted_at). We expose this via a security
-- definer RPC instead of granting raw write access.
-- =========================================================================

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

-- Bootstrap sign-in helper: idempotent membership creation for new sign-ins.
-- First user to call this (with no admin existing) becomes admin; rest become participants.
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
