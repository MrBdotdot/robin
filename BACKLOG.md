# Backlog

Features that have been considered and consciously deferred. Pull from this
list when ready to keep building.

## Auth — promote from testing-grade to production ✅ SHIPPED 2026-05-22

Shipped as Phase 2. Replaces the shared password with Supabase magic-link auth, adds a three-role membership model (admin / organizer / participant) with per-event organizer assignment, an invite system, and tightened RLS across every `rr_*` table. See `docs/superpowers/specs/2026-05-04-auth-phase-2-design.md` and `CLAUDE.md` for details.

**Auth-adjacent items still deferred:**

- **Sub-project 2 — slim claim flow** (next on the roadmap): at signup, an invitee picks the existing `rr_players` row that represents them. Replaces the `rr_is_in_event` SQL stub so `/me` actually shows match history.
- **Sub-project 3 — network rating**: personal Glicko rating computed only against claimed-player matches. Depends on sub-project 2.
- **Per-event share links** for spectator read-only access without an account (deferred — Phase 2 took a different shape).
- **Audit log enforcement** (`rr_audit_log` still exists but nothing reads/writes it).
- **Resend domain verification** so invites can go to any address (currently sandboxed to wbeestudio@gmail.com until DNS verification completes).

## Other deferred ideas

- **Venue display mode.** Big-screen view designed for a TV/tablet at the
  playing area: current matches with court assignments, live scores, "up
  next" queue, live standings. Glanceable from across a room.
- **Match notes.** Per-match text field for "switched to best-of-5",
  "longest match of the day", etc. Schema column to add: `rr_matches.notes`.
- **Audit log surfacing.** `rr_audit_log` table exists but is never written
  to or displayed. Add an event-level "history" view showing who changed
  what (especially relevant once real auth lands).
