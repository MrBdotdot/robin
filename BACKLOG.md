# Backlog

Features that have been considered and consciously deferred. Pull from this
list when ready to keep building.

## Auth — promote from testing-grade to production

Current state: a single shared password (`415`) gates the whole app, set via
`VITE_APP_PASSWORD`. Supabase RLS is enabled on every `rr_*` table but
policies allow `anon` to do everything — the frontend gate is the only real
access control.

To go public, replace with:

- **Supabase Auth** — email magic link or OAuth (Google).
- **Roles**: admin (full edit), scorekeeper (enter scores only), spectator
  (read-only). Store as a custom claim or a role row keyed by `auth.uid()`.
- **RLS policies** rewritten to check `auth.uid()` and the role claim per
  table. Admins/scorekeepers can write; spectators read only. Score entry
  permitted to any signed-in user; event creation/finalization to admins.
- **Per-event share links** that issue a scoped JWT (signed via an Edge
  Function) so spectators don't even need an account.
- **Audit log enforcement**: a trigger on `rr_matches` writing the actor's
  `auth.uid()` to `rr_audit_log` for every score change.

Migration plan: add an `auth` schema users mapping table, extend RLS
policies with role checks, swap the password gate for a Supabase Auth
component, add a "share link" button per event for spectator access.

## Other deferred ideas

- **Venue display mode.** Big-screen view designed for a TV/tablet at the
  playing area: current matches with court assignments, live scores, "up
  next" queue, live standings. Glanceable from across a room.
- **Match notes.** Per-match text field for "switched to best-of-5",
  "longest match of the day", etc. Schema column to add: `rr_matches.notes`.
- **Audit log surfacing.** `rr_audit_log` table exists but is never written
  to or displayed. Add an event-level "history" view showing who changed
  what (especially relevant once real auth lands).
