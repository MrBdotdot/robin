# Round Robin — Claude working notes

A small, mobile-first web app for running round-robin tournaments (mostly pickleball, but sport-agnostic). Multi-user, magic-link auth via Supabase Auth, Supabase-backed. No build server, no SSR — just Vite → static.

These notes exist so a fresh Claude session can pick up work without re-reading every file. Update this file when you change something architectural.

## Stack

- React 18 + TypeScript + Vite
- Tailwind CSS + a small in-house shadcn-style UI kit (`src/components/ui/`)
- React Router v6 (`src/App.tsx` is the route table)
- Supabase (Postgres + Auth + Edge Functions) — single client at `src/lib/supabase.ts`
- Glicko-2 for ratings (custom impl in `src/lib/glicko2.ts`)
- `sonner` for toasts, `lucide-react` for icons
- Vitest for unit tests (added in Phase 2; `npm run test` / `npm run test:run`)
- One Edge Function at `supabase/functions/send-invite/` (Resend integration for invite emails)

Every mutation is a direct Supabase call from the browser, gated by RLS. The only server-side code is the `send-invite` Edge Function.

## Routes / page map

| Path | File | Purpose | Access |
|---|---|---|---|
| `/` | `pages/Dashboard.tsx` (admin) or `Me.tsx` (others, via `HomeRedirect`) | Admin home or participant home | All signed-in |
| `/me` | `pages/Me.tsx` | Participant home — profile, network rating placeholder, events/series you're in | All signed-in |
| `/invite/:token` | `pages/Invite.tsx` | Invite redemption (signed-out or signed-in) | Open (handles its own auth) |
| `/events` | `pages/EventsList.tsx` | Cards of all events | Admin-only |
| `/events/new` | `pages/EventCreate.tsx` + `pages/wizard/*` | Multi-step event wizard | Admin-only |
| `/events/:id` | `pages/EventDetail.tsx` | Live event: rounds, scoring, standings, finalize; edit chrome gated by role | Admin/organizer/in-event |
| `/players` | `pages/PlayersList.tsx` | All players + global ratings | All signed-in |
| `/players/:id` | `pages/PlayerProfile.tsx` | Single player: ratings, history, h2h, partners, **per-series ratings** | All signed-in |
| `/players/pairs` | `pages/PairLeaderboard.tsx` | Doubles pair ratings | All signed-in |
| `/series` | `pages/SeriesList.tsx` | All series | All signed-in |
| `/series/:id` | `pages/SeriesDetail.tsx` | Series: cumulative standings, Ratings tab, events; edit chrome gated by role | All signed-in |
| `/settings` | `pages/Settings.tsx` | Misc config | All signed-in |

## Domain model

Database lives in Supabase under the `rr_` prefix. Hand-typed in `src/types/database.ts` (no codegen yet).

- `rr_players` — global Glicko ratings (singles + doubles), aggregate stats
- `rr_pairs` — doubles partnerships, separately rated
- `rr_events` — a single tournament. Optional `series_id` linking it to a series
- `rr_event_players` — membership rows. Stores `initial_rating_snapshot` (JSON, see below)
- `rr_matches` — every match, scheduled or completed. Score blob in `scores`
- `rr_series` — a long-running league/season grouping events
- `rr_series_ratings` — **per-(player, series) Glicko ratings**. Added in migration 003 — **note: this table doesn't exist in the live Supabase** (migration-003 was never applied; the SeriesDetail Ratings tab renders empty as a result)
- `rr_rating_history` — append-only log of (event → rating before/after) for the global rating chart
- `rr_pair_rating_history` — same idea for pairs

### Phase 2 auth tables (migration-004 and on)

- `rr_memberships` — one row per signed-in human. `role` is `admin` / `organizer` / `participant`
- `rr_invites` — pending and accepted invites. Token-as-capability for redemption
- `rr_event_collaborators` — per-event organizer assignment (existence of row = can score that event)

### Phase 2 SQL helpers / RPCs

- `rr_is_admin()`, `rr_is_member()`, `rr_can_score(event_id)` — boolean stable functions used in RLS policies
- `rr_is_in_event(event_id)` — **stubbed to return false** in Phase 2. Sub-project 2 (slim claim) will replace this with claim-aware logic
- `bootstrap_membership()` — security-definer RPC that idempotently creates a membership row on first sign-in. First user with no admin becomes admin; rest become participants. Called from `useMembership()`
- `accept_invite(token)` — security-definer RPC that consumes an invite and creates the membership row
- `lookup_invite(token)` — anon-callable security-definer RPC for the redemption page to fetch a single invite without exposing the whole table
- `list_organizers_with_email()` — admin-gated security-definer RPC. Returns scorekeeper memberships joined with `auth.users.email` for the AssignOrganizersSheet

### `initial_rating_snapshot` shape

Stored as JSON on each `rr_event_players` row. Captures the player's pre-event Glicko state so live recomputation can replay matches deterministically.

```ts
{
  global: {
    singles: { rating, rd, vol },
    doubles: { rating, rd, vol },
  },
  series?: {  // only present when event has a series_id
    singles: { rating, rd, vol },
    doubles: { rating, rd, vol },
  } | null,
}
```

A legacy shape `{ singles, doubles }` (no `global` wrapper) exists on older rows and is normalized on read by `liveRatings.normalizeSnapshot()`.

## Ratings — how they work

Ratings update **live** as scores are entered. Finalize is mostly bookkeeping (cancel un-played matches, write rating_history rows, compute final ranks, mark completed).

### The replay engine

`src/lib/liveRatings.ts → recomputeLiveRatings(eventId)` is the single source of truth for "what is each player's current rating after the matches completed so far?".

1. Load the event, its players, and all matches.
2. Lazy-backfill any missing or legacy `initial_rating_snapshot` blobs (and add a `series` block if the event has a `series_id` but the snapshot doesn't).
3. Sort completed matches by `completed_at` (then `round`, then `court`).
4. For **global**: replay each match through `glicko2.updateRating`, treating each match as a single outcome per player. Persist per-player to `rr_players.glicko_*`.
5. For **series** (if `event.series_id` is set): replay the same matches against the snapshot's `series` block. Persist per-(player, series) to `rr_series_ratings` via `upsertSeriesRating`.

Recompute is **idempotent** — it does not bump counters, it sets them. This means any persisted "matches_played" / "last_played_at" must be derived from the replay, not incremented per call.

Recompute is a no-op on `completed` and `archived` events. ⚠️ This means assigning a finished event to a series after the fact does **not** populate `rr_series_ratings` for that event — you'd need a one-time backfill.

### Helpers

- `src/lib/seriesRatings.ts` — `loadSeriesRatings`, `buildSnapshot`, `seedSeriesFromPlayer`, `buildSnapshotsForSeriesEvent`, `upsertSeriesRating`. Anything touching `rr_series_ratings` should go through here.
- `src/lib/finalizeEvent.ts` — orchestrates the finalize step. Calls `recomputeLiveRatings` once at the start, then writes history rows, pair updates, final ranks.
- `src/lib/liveRatings.ts → backfillCompletedEventSeriesRatings(eventId)` — one-shot series-only replay used when assigning a completed/archived event to a series. Skips rating overwrite for players who already have a series row (advance-only on `last_played_at`); inserts fresh rows seeded from `snap.global` for first-time players.

### `upsertSeriesRating` contract

```ts
upsertSeriesRating(seriesId, playerId, {
  rating: { singles?: Rating } | { doubles?: Rating },  // one side per call
  matchesPlayed?: number,        // SET (not bumped) — replay is idempotent
  lastPlayedAt?: string,         // ISO of latest replayed completed match
  seedFromGlobal?: { singles, doubles },  // for first-time insert: fills the
                                          // unused side from player's global
                                          // rating instead of the 1500/350 default
})
```

`recomputeLiveRatings` is the only production caller. It passes `seedFromGlobal` from the player row, `matchesPlayed` from `computeSeriesMatchTotals` (this event's replay count + sibling events' completed-match count), and `lastPlayedAt` from the latest completed match in this event.

## Key files for ratings work

| File | What lives here |
|---|---|
| `src/lib/glicko2.ts` | Pure Glicko-2 math: `updateRating`, `teamRating`, `Rating` type |
| `src/lib/liveRatings.ts` | Replay engine, snapshot normalization, `recomputeLiveRatings` |
| `src/lib/seriesRatings.ts` | All `rr_series_ratings` reads/writes |
| `src/lib/finalizeEvent.ts` | Finalize pipeline + per-pair rating updates |
| `src/pages/wizard/submit.ts` | Where snapshots are first created on event creation |
| `src/pages/SeriesDetail.tsx` | Series Ratings tab — leaderboard renderer + per-mode match counts |
| `src/pages/PlayerProfile.tsx` | Per-player series rating cards |

## Migrations

The `migrations/` folder now exists at the repo root. From Phase 2 onward, all migration SQL is tracked there. Applied manually via the Supabase SQL editor in numeric order.

| File | Adds | In repo? | In live DB? |
|---|---|---|---|
| `migration-001-initial-schema` | Core tables | no (old session output) | yes |
| `migration-002-rating-history` | rating history tables | no | yes |
| `migration-003-series-ratings` | rr_series_ratings + snapshot series block | no | **NO** — never applied; SeriesDetail Ratings tab renders empty |
| `migration-004-auth-phase-2.sql` | rr_memberships, rr_invites, rr_event_collaborators + helper functions | yes | yes |
| `migration-004a-fix-view-security.sql` | replaces leaky email view with admin-gated RPC | yes | yes |
| `migration-004b-bootstrap-rpc.sql` | bootstrap_membership + accept_invite RPCs (extracted from 005 so they exist before first sign-in) | yes | yes |
| `migration-005-rls-tighten.sql` | RLS policies for the three-role model | yes | yes (with `rr_series_ratings` policies skipped since the table doesn't exist) |
| `migration-006-rename-scorekeeper-to-organizer.sql` | Role rename | yes | yes |
| `migration-007-invite-dedup-and-member-check.sql` | Partial unique index on pending invites + trigger rejecting invites for existing members | yes | yes |

D3 is partially shipped: new migrations are tracked, but 001/002/003 still live in old session output. Backfilling them remains a polish item.

## Conventions

- `cn()` from `src/lib/utils.ts` for class-merging — use it instead of inline string concat with conditionals.
- `formatDate(iso)` and `formatRecord(...)` are the project's display helpers.
- Sheets / drawers: `src/components/ui/sheet.tsx` is the wrapper. Most "open this from a button to edit something" UIs use it.
- Tabs are home-rolled (the small `TabButton` pattern at the bottom of `SeriesDetail.tsx` / `PlayerProfile.tsx`). No shadcn Tabs primitive in use.
- Toast on every successful mutation, with `toast.error` on failure (description = error message).
- `Math.round(rating)` for display; never round before computing.
- Tabular numbers: add `tabular-nums` whenever a column should align vertically.

## Things to be careful about

1. **Recompute is idempotent.** Don't add counters that increment on call — derive them from the replay. `matches_played` on `rr_series_ratings` is *set* by `recomputeLiveRatings` to the replay-derived total (this event + sibling events in the same series), not bumped per call.
2. **Series rating seed — first-time insert.** When `upsertSeriesRating` inserts a brand-new row, the side that *isn't* being written gets seeded from `seedFromGlobal` (the player's current global rating). Without this, a player's first doubles match in a series would lock the singles side at the 1500/350 default forever, even after they later played singles in the same series.
3. **Series rating seed — lazy backfill seeds from `snap.global`.** When a snapshot is missing its `series` block and no `rr_series_ratings` row exists for the player yet, `recomputeLiveRatings` clones `snap.global` (the pre-event baseline already captured on the row). It does *not* read the player's current global rating, which by then has typically absorbed this event's completed matches and would double-count when those same matches are replayed against the snapshot.
4. **Snapshot legacy shape.** Older `rr_event_players` rows have `{ singles, doubles }` directly — `normalizeSnapshot()` handles this. Don't access `.global` without going through it.
5. **Lazy backfill writes back.** When `recomputeLiveRatings` upgrades a snapshot shape, it writes the upgraded JSON back to the row. That's intentional — it migrates legacy data on touch.
6. **Recompute skips completed events.** `recomputeLiveRatings` returns early on `completed` and `archived` events. Practical consequence: assigning a finished event to a series after the fact does NOT populate `rr_series_ratings` for that event. A backfill script is needed.

## UI rules for series ratings

- **Hide empty mode columns.** If a series has zero completed matches in a given mode, don't render that column. Same on per-player series cards.
- **Show "—" for unplayed sides.** If the series HAS the mode but a specific player has 0 matches in it, render their rating in that column as "—" (not the seed number) so default-seeded ratings don't read as real.
- **Always show RD.** `1620 ± 280` format. High-RD ratings should look provisional.
- **Leaderboard sort.** By the rating in the mode with the most matches in the series. Ties broken by the other mode's rating.

## Known polish items

These came out of the May 2026 audit. Bundle A shipped (matches_played, seed-from-global on insert, conditional mode columns, RD display, fixed sort). C3 also shipped (lazy-backfill now seeds from `snap.global` instead of the player's current global). C4 shipped: `AssignEventsSheet` now calls `backfillCompletedEventSeriesRatings` for any newly-added completed event, and shows a warning explaining that players already in the series keep their existing rating (chronological replay is still D1). What's still open:

**M4 — Profile series cards have no specified order.** Render order is whatever Postgres returns. Should sort by `last_played_at` desc.

**M5 — `last_played_at` was reset to `now()` on every recompute (now fixed to use the latest replayed match's `completed_at`, but verify under realistic load).**

**L3 — Series cards on the profile don't indicate Endless vs Ended.** The series detail page does. Could include a tiny "Ongoing" or end-date tag.

**L4 — Empty-state copy on the leaderboard tab.** Currently says "No ratings yet." Could explain *why* when applicable (e.g., events are still draft, or migration 003 not yet run).

**D1 — Backfill script for events that completed before migration 003.** No `rr_series_ratings` rows exist for those. A one-time script that walks every series-bound completed event and replays in chronological order across the whole series would fix the leaderboard for historical data.

**D2 — `upsertSeriesRating` is SELECT-then-INSERT-or-UPDATE, not atomic.** Not an issue at current scale, but a real `.upsert()` with `onConflict: "player_id,series_id"` would be cleaner.

**D3 — Migration SQL not in repo.** Migrations 001 / 002 / 003 live in old session output folders. Should be copied into `migrations/` (or `supabase/migrations/`) so they're source-controlled.

## Local dev

```sh
npm install
npm run dev       # vite dev server, default port 5173
npm run build     # tsc -b && vite build
npm run lint      # tsc -b --noEmit
npm run test      # vitest watch
npm run test:run  # vitest single-run (CI mode)
```

`.env.local` holds `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. (`VITE_APP_PASSWORD` is no longer used; auth went magic-link in Phase 2.)

Worktrees: `.env.local` is gitignored so it doesn't carry across worktrees. Copy it from the main repo when you spin up a new worktree, or local dev will throw "Missing VITE_SUPABASE_URL."

## Deployment

- **Vercel project**: `round-robin`. Linked to `MrBdotdot/robin` on GitHub. Pushes to `main` auto-deploy to **https://round-robin-sand.vercel.app**. Pushes to any branch get a preview URL.
- **Supabase project**: `sbzomcpqwueftuosobtd` (project ref). Same backend for local dev and production — both `.env.local` and Vercel envs point at the same URL.
- **Edge Function**: `send-invite`. Deploy with `npx supabase functions deploy send-invite --project-ref sbzomcpqwueftuosobtd`. Reads secrets at runtime — no redeploy needed for secret changes.

## Supabase configuration (project state worth remembering)

- **Auth providers**: email/magic-link enabled. Password sign-up may be on (left as-is); the app uses magic-link only.
- **Auth → URL Configuration**: Site URL = `https://round-robin-sand.vercel.app`. Redirect URLs include the prod URL, a wildcard for preview URLs (`https://round-robin-*-mrbdotdots-projects.vercel.app/**`), and `http://localhost:5173/**`.
- **Auth → Email → SMTP Settings**: custom SMTP via Resend (host `smtp.resend.com:465`, username `resend`, password = Resend API key, sender = whatever's verified, sender name set to whatever you want).
- **Edge Function secrets** (Project Settings → Edge Functions → Secrets):
  - `RESEND_API_KEY` — Resend API key
  - `INVITE_FROM_EMAIL` — sender for invite emails (`onboarding@resend.dev` until a domain is verified; then `noreply@yourdomain.com`)
  - `INVITE_FROM_NAME` — optional display name, e.g. `Will from Robin Rounds`
  - `APP_URL` — `https://round-robin-sand.vercel.app` (used to construct invite URLs in the email body)

## Phase 2 follow-ups (in priority order)

1. **Verify a Resend domain** — until verified, the sandbox sender only delivers to the Resend account email. Blocks inviting anyone outside `wbeestudio@gmail.com`.
2. **Sub-project 2 — slim claim flow** — at signup, let invitees pick one `rr_players` row that represents them (sets `claimed_by_user_id`). Replaces the `rr_is_in_event` stub with real claim-aware logic. Unlocks the participant view's events/series lists on `/me`.
3. **Sub-project 3 — network rating** — personal Glicko rating computed only against matches involving claimed players. Original ask. Depends on sub-project 2.
4. **Apply migration-003 to live DB** — `rr_series_ratings` doesn't exist. Series Ratings tab is non-functional. SQL lives in old session output; will need recovery or re-derivation from `src/lib/seriesRatings.ts` types.
5. **Column-level enforcement on `rr_matches.update` for organizers** — RLS is row-level; an organizer could currently update any column on a match they're assigned to, not just score columns. Mitigation = before-update trigger.
6. **Audit log surfacing** — `rr_audit_log` exists but nothing reads/writes it yet.
