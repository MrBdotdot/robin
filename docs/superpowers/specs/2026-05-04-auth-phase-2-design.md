# Phase 2 — Auth invites + memberships + per-event scorekeepers

**Status:** Design approved 2026-05-04. Ready for implementation plan.

**Author:** brainstormed with Bence on 2026-05-04.

## Why this exists

Round Robin currently has Phase 1 auth (email/password sign-in for a single owner). The next user-facing feature on the roadmap — a network rating computed against the friends a user actually plays with — depends on having multiple signed-in humans whose `rr_players` rows can be linked back to their accounts. That feature is sub-project 3 of a 3-project chain:

1. **Phase 2 (this spec)** — invites, memberships, per-event scorekeepers, RLS rewrite, magic-link sign-in.
2. **Slim claim flow** — at signup, a new user picks the `rr_players` row that represents them. Adds `claimed_by_user_id` to `rr_players`. Single-claim only; no merge/undo UI.
3. **Network rating** — a personal Glicko rating replayed only against matches involving claimed players in your tenant.

Each gets its own spec → implementation plan → ship. This spec covers Phase 2 only.

## Scope

### In scope

- Replace email/password with magic-link sign-in (drops Phase 1's password code).
- Three roles: admin, scorekeeper, participant.
- Tenant-level memberships (one row per signed-in human, single-tenant model).
- Per-event scorekeeper assignment (Approach 2 from brainstorm).
- Invite system: tokenised links with optional email delivery.
- Open self-signup that auto-grants the participant role.
- Scoped reads for participants and scorekeepers (own profile + events/series they appeared in).
- Read-only event/series view for non-admins.
- Avatar menu: sign-out, settings, "Invite someone" (admin-only).
- Two-deploy cutover plan that avoids locking the owner out.

### Out of scope

These are deferred to later sub-projects so this one stays small:

- Slim claim flow (sub-project 2).
- Network rating itself (sub-project 3).
- Full identity-merge UI (multi-claim, undo, splits — yesterday's AUTH_PLAN.md Phase 3).
- Audit log surfacing (`rr_audit_log` exists but stays unwritten/unread).
- Custom email branding for invite emails — will use Supabase's default sender; revisit if it becomes ugly or hits rate limits.
- Spectator share links (no-account read-only access).
- OAuth / Google sign-in.
- Multi-tenant data model.

## Decisions resolved during brainstorm

| Decision | Picked | Rationale |
|---|---|---|
| Network meaning | Logged-in user's network (Option B) | Matches the app's "personal ratings for your hemisphere" concept. |
| Sequencing | Phase 2 + slim claim + network rating, in that order | Honest dependency chain; each is a separate spec. |
| Phase 2 brainstorm starting point | Fresh (Option B) | Yesterday's AUTH_PLAN.md is reference, not the spec. |
| Role model | 3 roles (admin / scorekeeper / participant) | Scorekeeper tier prevents giving venue helpers full admin. |
| Tenant scope | Single-tenant, implicit (no `tenant_id` columns) | App is personal-scale; multi-tenant migration is mechanical if ever needed. |
| Participant view scope | Own profile + scoped leaderboards | Coherent network-rating UI; richer than "own only," safer than "tenant-wide read." |
| Invite delivery | Both email and copy-link | Email by default, copy-link as fallback for spam/branding issues. |
| Auth method | Magic link only — for everyone | One auth surface; drops Phase 1's password code. Friendlier for occasional invitees. |
| Invite scope | Tenant-level membership; per-event linkage via slim claim (sub-project 2) | Cleanest schema; per-event membership table not needed. |
| Self-signup | Open; auto-grants participant role | User accepted abuse risk; mitigation deferred. |
| Scorekeeper assignment | Per-event (Approach 2) | "Approach 2 is more in line with the concept behind this app." |
| Invite expiry | 7 days default | Bounded leak risk; cheap to regenerate. |
| Cutover | Two-deploy (permissive → tight) | Lower lock-out risk than single-deploy. |

## Data model

Single migration file: `migration-004-auth-phase-2.sql`. Three new tables; no `tenant_id` columns added to existing `rr_*` tables.

```sql
-- One row per signed-in human who is part of the tenant.
create table rr_memberships (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  role        text not null check (role in ('admin','scorekeeper','participant')),
  created_at  timestamptz not null default now()
);

create index rr_memberships_user_id_idx on rr_memberships (user_id);

-- Pending invites; the token is consumed when accepted.
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

-- Per-event scorekeeper assignment.
-- Existence of a row = user can edit scores on this event.
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
```

**No `rr_owners` / `rr_tenants` table.** Single-tenant is implicit.

**No `rr_players.claimed_by_user_id`.** That column belongs to sub-project 2 and is deliberately excluded here.

### Helper SQL functions

A handful of small functions keep the RLS policies readable:

```sql
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

-- True if the calling user can edit scores on a given event.
-- (Admin always; scorekeeper iff they have a collaborator row for the event.)
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

-- True if the calling user appeared in the event's roster (as a claimed player).
-- Phase 2 stub: returns false until sub-project 2 lands.
create or replace function rr_is_in_event(_event_id uuid)
returns boolean language sql stable as $$
  select false;  -- replaced in sub-project 2 with real claim-aware logic
$$;
```

`rr_is_in_event` is a stub during Phase 2. Until sub-project 2 lands, the participant view will be "name + email + empty list of events." This is acceptable for the cutover and matches what we agreed on (Phase 2 ships participant home with placeholders; sub-project 2 wires up the data).

## Permissions

| Action | Admin | Scorekeeper | Participant |
|---|---|---|---|
| Create / edit / finalize / archive events | ✓ | — | — |
| Edit roster (`rr_event_players`) | ✓ | — | — |
| Insert / update `rr_matches.scores` | ✓ | only for events they have a `rr_event_collaborators` row on | — |
| Insert / update `rr_matches` (cancel, add, etc.) | ✓ | — | — |
| Read `rr_events` / `rr_series` | all | events with a collaborator row + events they appear in (stub: none); series they appear in (stub: none) | events they appear in (stub: none); series they appear in (stub: none) |
| Read `rr_players` | all | self + people they appear with (stub: self only) | self + people they appear with (stub: self only) |
| Read `rr_matches` | all | events with a collaborator row + events they appear in (stub: none) | events they appear in (stub: none) |
| Send invites (insert into `rr_invites`) | ✓ | — | — |
| Assign scorekeepers (insert/delete `rr_event_collaborators`) | ✓ | — | — |
| Read `rr_memberships` | all rows | own row only | own row only |
| Sign out / view own auth user | ✓ | ✓ | ✓ |

Notes:

- A scorekeeper not assigned to an event behaves like a participant on that event.
- An admin who happens to be a participant in their own event still has full admin power.
- **During Phase 2, all "appears in event" lookups resolve to false** because `rr_is_in_event` is stubbed until sub-project 2 lands. Practical consequence: a participant with no collaborator rows sees nothing on their `/me` page except their name and email. A scorekeeper sees only the events they have a collaborator row on. This is intentional — Phase 2 ships the auth scaffolding; sub-project 2 wires participants up to their match history.

## Row-level security policies

RLS is enabled on every `rr_*` table. The patterns used:

```sql
-- Example: rr_events
alter table rr_events enable row level security;

create policy rr_events_select on rr_events
for select using (
  rr_is_admin()
  or rr_is_in_event(id)
  or exists (
       select 1 from rr_event_collaborators
       where event_id = rr_events.id and user_id = auth.uid()
     )
);

create policy rr_events_insert on rr_events
for insert with check (rr_is_admin());

create policy rr_events_update on rr_events
for update using (rr_is_admin()) with check (rr_is_admin());

create policy rr_events_delete on rr_events
for delete using (rr_is_admin());
```

```sql
-- Example: rr_matches (the score-editing surface for scorekeepers)
alter table rr_matches enable row level security;

create policy rr_matches_select on rr_matches
for select using (
  rr_is_admin()
  or rr_is_in_event(event_id)
  or exists (
       select 1 from rr_event_collaborators
       where event_id = rr_matches.event_id and user_id = auth.uid()
     )
);

create policy rr_matches_update_admin on rr_matches
for update using (rr_is_admin()) with check (rr_is_admin());

create policy rr_matches_update_scorekeeper on rr_matches
for update using (rr_can_score(event_id))
            with check (rr_can_score(event_id));

-- Insert/delete restricted to admins.
create policy rr_matches_insert on rr_matches
for insert with check (rr_is_admin());
create policy rr_matches_delete on rr_matches
for delete using (rr_is_admin());
```

The full RLS migration covers every existing `rr_*` table with the same patterns: select scoped to admin/member-of-event, mutations scoped to admin (with the scorekeeper exception only on `rr_matches.update`).

`rr_invites`: select/insert/update/delete restricted to admin. Anon access is **not** granted via a permissive select policy (that would let anon dump every invite token). Instead, a `security definer` RPC function exposes a single token lookup:

```sql
create or replace function lookup_invite(_token text)
returns table (id uuid, email text, role text, expires_at timestamptz, accepted_at timestamptz)
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
```

This way, the redemption page can call `supabase.rpc('lookup_invite', { _token })` to fetch a single invite by token without granting broad read access to the table. The token acts as a capability — knowing it is the auth.

`rr_memberships`: select scoped to "own row only" for non-admin; admins read all. Insert is system-only (created by the auth callback or invite acceptance, not by user-facing code paths). Update/delete admin-only.

`rr_event_collaborators`: select for admin (all) and the user themselves (own rows); insert/delete admin-only.

## Sign-in flow

A single page (replaces today's `AuthGate.tsx` password form):

- Email field + "Send me a link" button.
- On submit, call Supabase's `auth.signInWithOtp({ email, options: { emailRedirectTo: '/' } })`.
- Show "Check your email — we sent you a link to sign in."
- Magic link redirects to `/` (or to `/invite/:token` if the original entry was via an invite — see below).
- On the auth callback, a one-time effect: if the user has no `rr_memberships` row, insert one with `role = 'participant'` (or with the role from the active invite token if present).

**Invite-aware redirection.** When a user opens `/invite/:token`:

- If signed out: show the email form, but stash the token in a query param on the magic-link redirect URL so it survives the round trip.
- If signed in: look up the invite, validate it (not expired, not accepted), show "Join as [role]?" with an Accept button. On accept: insert membership row with the invite's role, mark invite `accepted_at = now()`, redirect to home.
- If signed in and already a member: "You're already in — going to your home" auto-redirect.
- If invite is expired or already accepted: friendly error page with a "ask the admin for a new one" message and the admin's contact (their email, since they created the invite).

## UX surfaces

### Sign-in page
- Single email field + "Send me a link."
- After submit: "Check your email." That's it — no sign-up vs sign-in tabs; new email = new account, known email = sign-in.

### Invite sheet (admin-only, in avatar menu)
- Form: email, role dropdown (admin / scorekeeper / participant), "Generate invite" button.
- On generate: show the invite link with copy-to-clipboard. A second button, "Email it to them," triggers a Supabase mail-send. (Detail: we'll likely use an Edge Function rather than client-side, since Supabase auth's invite-email feature is for full Supabase Auth invites and we want our own template.)
- Below: pending invites with countdown to expiry, accepted invites, with a "Revoke" action on pending ones.

### Invite redemption page (`/invite/:token`)
- States covered above in "Sign-in flow."

### Scorekeeper assignment (event detail page, admin-only)
- New "Scorekeepers" section on the event detail page, listing currently assigned scorekeepers.
- "Add scorekeeper" → sheet listing all members with `role = 'scorekeeper'` with checkboxes; saving syncs `rr_event_collaborators` rows.
- Removing an assignment takes effect immediately (the scorekeeper loses score-edit access on next request).

### Participant home (`/me`)
- Header: avatar, name (from auth user metadata or display name), email.
- "Network rating" section: placeholder card. Wired up in sub-project 3.
- "Events you've played in": list, each clickable to a read-only event detail. Empty during Phase 2 (since `rr_is_in_event` is stubbed to false until sub-project 2).
- "Series you've played in": same.
- "You haven't been linked to a player yet — ask the admin to link you" empty state, with the admin's email.

### Read-only event / series detail
- When a non-admin viewer has access (via being in the event or being a scorekeeper for it), the detail pages render without edit chrome.
- Specifically hidden: "Edit settings," "Add match," "Cancel match," "Finalize," "Archive," roster drag-and-drop, swap sheet, score input on matches the user can't score.
- Standings, completed scores, and read-only round/chip strip remain visible.

### Avatar menu (top-right)
- Already partly there from the dashboard work.
- Adds: "Invite someone" (admin-only), "Settings," "Sign out."

### Routing changes
- After sign-in: admin → `/`, scorekeeper/participant → `/me`.
- A non-admin who navigates to an admin-only route (`/events/new`, etc.) is redirected to `/me` with a toast: "Admin-only."

## Migration / cutover plan

The cutover is two deploys. The risk we're avoiding: a single-step combo migration that tightens RLS and switches the auth method at the same time, where the owner's existing access disappears before they've signed in under the new system.

### Deploy 1 (permissive)

1. Run `migration-004-auth-phase-2.sql` (new tables + helper functions).
2. Configure Supabase to enable magic-link auth and disable password sign-up (Studio → Authentication → Providers).
3. Deploy frontend that:
   - Replaces password form with magic-link form. Calls `auth.signInWithOtp({ email, options: { shouldCreateUser: true } })`. (The `shouldCreateUser` default is true; specifying it explicitly documents intent.)
   - Adds a one-time bootstrap effect on sign-in: if no membership row exists for the user, create one with `role = 'admin'` **only if no admin exists yet in `rr_memberships`**, otherwise `role = 'participant'`. This bootstraps the owner's admin row on the first sign-in after deploy 1.
4. Sign in as the owner once. Since the bootstrap rule says "first signed-in user with no admin yet → admin," whoever signs in first becomes admin. Practical mitigation: do this within minutes of the deploy, before sharing the URL. Airtight alternative: pre-seed your admin row via raw SQL in Supabase Studio before deploy 1, so the bootstrap rule never matches anyone.
5. Verify the membership row exists with `role = 'admin'`.

### Deploy 2 (tight)

1. Run `migration-005-rls-tighten.sql` — the RLS policies above.
2. Deploy frontend that:
   - Removes the bootstrapping logic from step 3 above (replaced with normal "new sign-in → participant by default" logic).
   - Wires up the rest: invite sheet, redemption page, `/me`, scorekeeper sheet, read-only views.

After deploy 2, anonymous access returns nothing. Anyone signing in fresh becomes a participant automatically.

### Rollback

If deploy 2 misbehaves, the rollback is to drop the RLS policies (reverting to permissive) — the tables and the magic-link auth stay in place, and the app is functional for the admin again. The new tables are additive; no data is destroyed.

## Files this will touch

```
migrations/
  migration-004-auth-phase-2.sql       new
  migration-005-rls-tighten.sql        new
  (plus copy 001/002/003 from old session output — D3 polish item)

src/components/AuthGate.tsx            heavy edit (password → magic link)
src/components/AvatarMenu.tsx          new (or extend existing top-right menu)
src/components/InviteSheet.tsx         new
src/components/AssignScorekeepersSheet.tsx  new
src/lib/auth.ts                        rewrite for magic link + role lookup
src/lib/membership.ts                  new — useMembership() hook
src/lib/permissions.ts                 new — small role-aware helpers used by UI gating
src/pages/Invite.tsx                   new — /invite/:token handler
src/pages/Me.tsx                       new — participant home
src/pages/EventDetail.tsx              edit — gate edit chrome on role
src/pages/SeriesDetail.tsx             edit — gate edit chrome on role
src/App.tsx                            edit — add /me, /invite/:token, role-aware redirects
src/components/AppShell.tsx            edit — avatar menu, sign-out, role-aware nav
.env.local                             drop VITE_APP_PASSWORD (already gone if Phase 1 dropped it)
```

## Open knobs (defaulted, change here if you disagree)

- **Invite expiry: 7 days.** Cheap to regenerate; bounds leak window.
- **Track invite creator (`created_by`).** Tiny audit benefit.
- **Two-deploy cutover** (vs single-deploy with manual SQL bootstrap). Two-deploy is safer.
- **Email-send for invites: Supabase Edge Function, not client-side.** Keeps the SMTP credentials server-side.
- **Supabase default sender for invite emails.** Custom branding deferred.

## Dependencies on later sub-projects

- The participant home (`/me`) ships with empty "events / series you've played in" lists in Phase 2 because `rr_is_in_event` is a stub. Sub-project 2 (slim claim) replaces the stub with a real claim-aware lookup.
- The "Network rating" section on `/me` is a placeholder card in Phase 2. Sub-project 3 fills it in.
- The "see other people's profiles in your network" capability requires sub-project 2 to land first — the RLS policies are written to support it but won't return non-self rows until claims exist.

These are not blockers for shipping Phase 2; they're places where Phase 2's UI is deliberately empty until sub-projects 2 and 3 fill them in.
