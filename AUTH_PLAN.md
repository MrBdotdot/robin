# Auth + Invites + Identity Merge — Plan

A phased plan for replacing the password gate with real per-user accounts, adding an invite flow, and letting invitees claim ad-hoc `rr_players` rows that were typed in by name before they had an account.

This is a multi-session project. Treat each phase as its own PR-sized chunk.

## Goal

By the end:
- The app is gated by Supabase Auth, not a shared password.
- One user (you) is the **owner** of all existing data.
- Invited users can sign in, see what they've been invited to, and view their own profile + history.
- Players who were entered by name in past events can be linked back to the corresponding signed-in user — without losing match history, ratings, or audit trail.

## Today's posture (the starting point)

- Single `VITE_APP_PASSWORD` gate in `PasswordGate.tsx`. Anyone with the password gets full read/write via the Supabase anon key.
- RLS policies on every `rr_*` table currently allow anon to do everything (per migration-001, see PROJECT_NOTES section 14).
- No notion of a user. `rr_players` is a list of *names*; nothing identifies a row as belonging to an account.

## Phase 1 — Supabase Auth replaces the gate

**Outcome:** signed-in users only; anon access is read-nothing or schema-only. All existing data continues to work; the data is implicitly owned by the first registered user.

**Tasks:**

1. **Schema additions (migration-004):**
   - `rr_owners` table: `(id UUID pk, user_id UUID references auth.users not null unique, created_at timestamptz default now())`. One row per user who can own data. (We'll add roles later.)
   - Add `owner_id UUID references rr_owners(id)` to: `rr_events`, `rr_series`, `rr_players`. Nullable initially; backfilled to your owner row in a one-shot.
   - **Backfill plan:** `INSERT INTO rr_owners (user_id) SELECT id FROM auth.users WHERE email = '<your email>'`, then `UPDATE rr_events SET owner_id = (SELECT id FROM rr_owners LIMIT 1)` (and same for series, players).

2. **RLS rewrite:** every `rr_*` table policy becomes
   ```sql
   USING (owner_id = (SELECT id FROM rr_owners WHERE user_id = auth.uid()))
   ```
   for SELECT/UPDATE/DELETE. INSERT policies require `owner_id` to match the calling user's owner row. (Audit log gets relaxed read for own data only.)

3. **Client changes:**
   - Remove `PasswordGate.tsx`; replace with a Supabase Auth gate using magic-link sign-in. (Email + OTP is fewer moving parts than password.)
   - Add a `useOwner()` hook that resolves the current user's `rr_owners.id` once at mount and caches it.
   - Mutations that insert into `rr_events`/`rr_series`/`rr_players` need to set `owner_id`. Easiest: a tiny `withOwner()` helper that adds it.

4. **Settings page additions:** sign-out button, displayed email.

5. **`.env.local`:** drop `VITE_APP_PASSWORD`.

**Risks / decisions:**

- **Magic link vs password.** Magic link is simpler and matches the personal-tool feel. Password flow is more familiar but adds reset/forgot complexity.
- **Email provider.** Supabase ships with a default email sender that has rate limits. Fine for private invites, not fine for a public sign-up form. Phase 1 only invites people manually, so default is OK.
- **Backfill ordering.** The owner_id backfill must run *after* the first sign-in (so `auth.users` has your row) and *before* RLS is tightened. Coordinate as: deploy migration → sign in once → run backfill → tighten RLS. Document this sequence in the migration file.

**Out of scope here:** roles, invites, claiming. Phase 1 lands you with a single-tenant signed-in experience.

---

## Phase 2 — Org/role + invite links

**Outcome:** the owner can invite specific people via email; invitees sign up and land in a scoped view of the data.

**Tasks:**

1. **Schema (migration-005):**
   - `rr_memberships`: `(id UUID pk, owner_id UUID references rr_owners, user_id UUID references auth.users, role TEXT check (role in ('admin', 'participant')), created_at)`. Replaces the implicit "you alone own everything" model with an explicit membership table.
   - `rr_invites`: `(id UUID pk, owner_id UUID, email TEXT, role TEXT, token TEXT unique, expires_at timestamptz, accepted_at timestamptz nullable, created_at)`. The `token` is a long random string used as the invite-link query param.
   - **Migration:** create one `rr_memberships` row for yourself with `role = 'admin'`.

2. **RLS rewrite (again):** policies now check membership in the same `owner_id`, not just owner ownership. Admins can read/write everything in the owner's data; participants can read their own profile + events they were invited to.

3. **Invite flow:**
   - **Admin → "Invite someone"** sheet (probably accessible from the new top-bar avatar menu). Form: email, role. Submitting inserts an `rr_invites` row with a generated token. The link is shown to the admin to share manually (no email-sending in Phase 2 — keeps it simple).
   - **Invitee opens link `/invite/:token`:**
     - If not signed in → magic-link sign-in flow with `redirect_to` back to this URL.
     - If signed in → show "Join [owner name] as [role]?", and on accept, insert `rr_memberships` and mark invite `accepted_at = now()`.

4. **Participant UX (very minimal):**
   - `/me` route: signed-in user's profile, their match history (from `rr_rating_history` joined to events).
   - The events/series pages stay unchanged for admins; participants see a pared-down read-only view (no "edit", no "finalize").

**Risks / decisions:**

- **Role granularity.** Two roles is enough for now. Resist adding "scorer" / "viewer" / "owner" until there's pressure for it.
- **Invite reuse.** Tokens are single-use (deleted or marked `accepted_at`) for safety. Re-invites are cheap (just generate another).
- **Team/org concept.** A single `rr_owners` row is conceptually "your team". If you ever want multi-team (different leagues each with their own data), you'll add a `rr_teams` table that owners belong to. **Defer.**
- **Participant scope leak.** A participant invited to one series shouldn't see other series under the same owner. RLS for participants needs to filter to events they appear in (`exists` join through `rr_event_players`) and series whose events they're in.

**Out of scope here:** retroactive identity merge. A participant signs in, lands in `/me`, and sees an empty history because their `auth.users.id` isn't linked to any historical `rr_players` row yet.

---

## Phase 3 — Retroactive identity claim

**Outcome:** when a participant signs up, they can claim one or more `rr_players` rows that represent past versions of them, merging the rating + match history into their account.

This is the trickiest phase. Most of the complexity is in disambiguating identities and making merges undoable.

**Tasks:**

1. **Schema (migration-006):**
   - Add `claimed_by_user_id UUID nullable references auth.users(id)` to `rr_players`. A player row "belongs to" a user iff this is set.
   - `rr_player_claims`: audit log. `(id UUID pk, player_id UUID, user_id UUID, action TEXT check (action in ('claimed', 'unclaimed', 'merged')), merged_into_player_id UUID nullable, created_at, undone_at nullable)`. Every claim/unclaim/merge writes a row; an undo flips `undone_at` and reverts the schema change.

2. **Claim suggestion algorithm:**
   When a participant lands on `/me` with no claimed players, surface a "We found N players that might be you" panel. Candidates ranked by:
   - Exact name match (`full_name ILIKE 'first last'` against the auth user's display name)
   - Same email (if you ever store player emails)
   - Co-occurrence with their inviter's events (if invited via series X, prefer players who appeared in series X events)
   - Players already claimed by another user are excluded (no double-claiming).
   Display each candidate with: events they appeared in, total matches, recent rating, last played. Let the user pick **multiple** (a person can have many ad-hoc rows from different events).

3. **Claim UX:**
   - Single-click claim per row.
   - Multi-claim **merges** into one player. The "primary" row keeps its `id` (so foreign keys don't break); the others are folded in: `rr_event_players`, `rr_matches` (player id arrays), `rr_rating_history`, `rr_pair_rating_history` are rewritten to point at the primary; the secondary rows are deleted; `rr_player_claims` records the merge.
   - **Important:** the rating-history rewrite is a SQL transaction. The replay-from-snapshot architecture means the *historical* ratings stay intact, but `rr_players.glicko_*` for the merged primary becomes a question mark. Practical answer: re-run a global Glicko period using the union of all merged matches sorted chronologically. Document this.

4. **Undo:**
   - Within 7 days, the user can undo a claim/merge.
   - Undo restores the deleted secondary rows from a snapshot (we keep them serialized in the `rr_player_claims.metadata` JSON before deleting), reverts foreign keys, and marks the claim row `undone_at`.

5. **Admin override:**
   - Admins can see all claims and force-unmerge / force-claim on behalf of a participant.
   - Useful when a participant claims wrong rows or two people share a name.

**Risks / decisions:**

- **Name collisions.** "Alex" plays in three pickleball nights, "Alex" also plays in three tennis events — could be the same person, could be two people. The disambiguation UI must show enough context (sport, dates, co-players) for the user to decide. If they're unsure, they don't have to claim everything; claims are additive and undoable.
- **Rating history continuity.** A "claim and merge" produces a sensible *forward* rating, but you can't truthfully reconstruct what the rating *would* have been if all matches had been played by the same identity. Document this as expected behavior — the merged rating is a best-effort recomputation, not a historical reconstruction.
- **Undo window.** 7 days is a pragmatic default. Beyond that, claims are permanent (or require admin intervention). This bounds how long we keep the secondary-row snapshot blobs.
- **Soft delete vs hard delete on merge.** Hard delete with snapshots in the audit table is simpler than carrying tombstones around. Pick this and stick with it.
- **What if a player should be split?** Inverse problem: an admin typed "Alex" once meaning person 1 and once meaning person 2; both got merged to one row before split was discovered. The "split" UX is much harder than merge — defer until someone hits it. Add a TODO in the audit table to support splits later.

---

## Sequencing & estimates

Rough effort, single-developer, evening/weekend pace:

| Phase | Effort | Notes |
|-------|--------|-------|
| 1 — Auth replaces gate | 1–2 sessions | Most risk is in the RLS rewrite + backfill ordering. |
| 2 — Invites + roles | 2 sessions | Mostly UI; the RLS layer for participants is the gnarly part. |
| 3 — Identity claim | 3–4 sessions | Disambiguation UX + merge transaction + undo each take real time. |

**Phase 1 is the only one with no-going-back consequences** (RLS tightening will break the app for unauthenticated users until they sign in). Plan it for a session you have time to test in.

**Phases 2 and 3 can be paused at any boundary** — Phase 2 leaves you with a working multi-user system without merge; Phase 3 can ship its UX behind a feature flag and only flip on once tested.

---

## Open questions

These need a decision *before* we start Phase 1:

1. **Auth method:** magic-link, password, or OAuth (Google)? *Recommendation: magic-link — simplest, no password reset.*
2. **Email sender:** Supabase default vs custom SMTP? *Recommendation: default for Phase 1; revisit if rate limits bite.*
3. **Single owner forever, or design for multiple from the start?** Multiple owners means a `rr_teams`-like layer. *Recommendation: single owner now, defer multi-team. The migration to multi-team later is mechanical (add a column, update RLS).*
4. **Do participants see other participants' profiles?** A series leaderboard implies "yes, by name + rating". Profile drilldown (history, partners) implies "maybe". *Recommendation: leaderboards are public within a series; deep-profile is private (only your own).*

---

## Files this will touch (rough list)

- `migration-004-auth.sql` (new)
- `migration-005-invites.sql` (new)
- `migration-006-claims.sql` (new)
- `src/components/PasswordGate.tsx` → delete
- `src/components/AuthGate.tsx` (new)
- `src/lib/auth.ts` — heavy rewrite
- `src/lib/owner.ts` (new) — `useOwner()` hook
- `src/pages/Me.tsx` (new) — participant home
- `src/pages/Invite.tsx` (new) — invite-redemption page
- `src/components/InviteSheet.tsx` (new) — admin sends invites
- `src/components/ClaimPlayersSheet.tsx` (new) — Phase 3 claim UI
- `src/components/AppShell.tsx` — top-bar avatar menu, sign-out, role-aware nav
- Most page components — gate admin-only actions on role
