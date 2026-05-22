# Session log — 2026-05-22 — Phase 2 auth shipped

Started ~14:00 PT, ended ~20:00 PT (local time). Spanned the full brainstorm → spec → plan → execution → production cutover for Phase 2 auth.

## What shipped

PR [#1](https://github.com/MrBdotdot/robin/pull/1) — squash-merged to `main`, deployed live at https://round-robin-sand.vercel.app.

### Database (in `migrations/`)

- `004` — `rr_memberships`, `rr_invites`, `rr_event_collaborators`, helper functions (`rr_is_admin`, `rr_is_member`, `rr_can_score`, `rr_is_in_event` stub), `lookup_invite` RPC
- `004a` — replaced the leaky `rr_memberships_with_email` view with an admin-gated `list_organizers_with_email()` RPC after Supabase's linter flagged it
- `004b` — extracted `bootstrap_membership` and `accept_invite` RPCs (originally in 005) so they exist before the first sign-in
- `005` — RLS policies on every `rr_*` table for the three-role model (skipped `rr_series_ratings` since the table doesn't exist live)
- `006` — renamed `scorekeeper` role → `organizer` (label change, no permission change)
- `007` — partial unique index on pending invites + before-insert trigger rejecting invites for emails that already have a membership

### Frontend

- Magic-link sign-in via Supabase Auth (`AuthGate.tsx` rewritten)
- `useMembership()` hook + `bootstrapMembership()` RPC consolidation (eliminates a race condition)
- `useSession()` + `permissions.ts` helpers (`isAdmin`, `isOrganizer`, `isParticipant`, `canScoreEvent`, etc.)
- Avatar menu (top-right, both desktop + mobile)
- Role-aware nav: admins see Events/Series/Players/Settings; non-admins see just Home/Settings
- Role-aware routing: `<AdminOnly>` wrapper for admin routes, `<HomeRedirect>` index router
- `/me` participant home with placeholders for sub-projects 2 + 3
- `/invite/:token` redemption page (4 states: loading / valid / expired / already-used; signed-out / signed-in non-member / already-a-member)
- `InviteSheet` (admin invite generator with copy + email-send + revoke)
- `AssignOrganizersSheet` (per-event organizer assignment)
- Edit chrome gated on role across `EventDetail` (18 affordances) and `SeriesDetail` (3 affordances)
- ScoreSheet + PlayerDetailSheet accept role-aware props

### Server (Supabase Edge Function)

- `send-invite/index.ts` — Resend integration, admin check, CORS handling, optional display name (`INVITE_FROM_NAME`)
- Deployed via `npx supabase functions deploy send-invite`

### Tests

- Vitest framework added (Task 1)
- 17 passing tests across `permissions.test.ts` (12) and `membership.test.tsx` (5)

### Infra

- `.gitignore` updated for `supabase/.temp/` and `supabase/.branches/`
- `tsconfig.node.json` extended to include `vitest.config.ts`

## Notable mid-flight corrections

- **Sheet API mismatch**: original spec assumed shadcn-split `Sheet`/`SheetContent`/`SheetHeader`/`SheetTitle`, but the project uses a monolithic `Sheet` with `title` prop. Caught by Task 12 implementer, corrected for Tasks 12 and 15.
- **Bootstrap RPC missing at deploy 1**: originally bundled into migration-005 alongside RLS tightening. Extracted into 004b so the bootstrap RPC exists when the first sign-in fires `useMembership()`.
- **RLS auto-enabled by Supabase linter**: user clicked through security warnings which silently enabled RLS on the Phase 2 tables. Initially this blocked `useMembership` reads even though policies hadn't been written. Resolved by applying migration-005 with proper policies.
- **`rr_series_ratings` missing**: migration-003 was never applied to the live DB. Migration-005 was tailored to skip those policies. The Series Ratings tab is non-functional as a result — flagged as a Phase 2 follow-up.
- **Race condition on first sign-in**: `bootstrap_membership` and `useMembership`'s SELECT raced; the row was created but the hook returned null. Fixed by consolidating bootstrap into `useMembership` (the RPC IS the fetch).
- **CORS on Edge Function**: original function didn't handle OPTIONS preflight, so the browser blocked the POST entirely. Added explicit CORS headers + 204 OPTIONS response.
- **Race + RLS combined diagnostic**: roughly 90 minutes of debug time when the avatar showed `—` despite an admin row existing. Compound cause was (1) RLS was on but missing policies and (2) `useMembership` raced with bootstrap. Both fixed.

## Mid-flight product polish requests from user

- Drop "admin" from the invite role dropdown — admins should only be promoted via SQL.
- Rename "scorekeeper" → "organizer" everywhere.
- Reject inviting someone who's already a member.
- Reject duplicate pending invites for the same email.
- More breathing room around `Select` chevron.
- Avatar menu background was transparent (used `bg-popover` which isn't defined in this project's Tailwind theme) — switched to `bg-card`.
- Avatar menu dropdown overflowed left of viewport on desktop (sidebar too narrow) — changed to `md:right-auto md:left-0` so the dropdown extends right into the main content area on desktop, still drops left on mobile.

## What's NOT shipped (deferred)

- **Sub-project 2 (slim claim flow)** — `rr_is_in_event` still returns `false`; `/me`'s events/series sections are empty for non-admins. This is the next sub-project.
- **Sub-project 3 (network rating)** — the original ask. Depends on sub-project 2.
- **Resend domain verification** — waiting on DNS propagation. Until verified, the sandbox sender only delivers to `wbeestudio@gmail.com`.
- **Column-level enforcement on `rr_matches.update`** for organizers (currently RLS is row-level only; a before-update trigger would lock down non-score fields).
- **Audit log surfacing**.
- **Migrations 001/002/003 backfill** into the repo (D3 polish).
- **Apply migration-003 to live DB** so the Series Ratings tab works.

## Where to pick up

Next session:
1. If DNS has verified the Resend domain by then, update `INVITE_FROM_EMAIL` Supabase secret + Auth SMTP sender to use it. Test inviting at non-wbeestudio email.
2. Brainstorm + spec sub-project 2 (slim claim flow).
3. Use `superpowers:brainstorming` → `writing-plans` → `subagent-driven-development` chain again. Worked well this session.
