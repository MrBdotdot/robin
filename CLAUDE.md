# Round Robin — Claude working notes

A small, mobile-first web app for running round-robin tournaments (mostly pickleball, but sport-agnostic). Single-user, password-gated, Supabase-backed. No build server, no SSR — just Vite → static.

These notes exist so a fresh Claude session can pick up work without re-reading every file. Update this file when you change something architectural.

## Stack

- React 18 + TypeScript + Vite
- Tailwind CSS + a small in-house shadcn-style UI kit (`src/components/ui/`)
- React Router v6 (`src/App.tsx` is the route table)
- Supabase (Postgres + auto-generated REST) — single client at `src/lib/supabase.ts`
- Glicko-2 for ratings (custom impl in `src/lib/glicko2.ts`)
- `sonner` for toasts, `lucide-react` for icons

No backend code — every mutation is a direct Supabase call from the browser. The `PasswordGate` component is the only auth.

## Routes / page map

| Path | File | Purpose |
|---|---|---|
| `/events` | `pages/EventsList.tsx` | Cards of all events |
| `/events/new` | `pages/EventCreate.tsx` + `pages/wizard/*` | Multi-step wizard to create an event |
| `/events/:id` | `pages/EventDetail.tsx` | Live event: rounds, scoring, standings, finalize |
| `/players` | `pages/PlayersList.tsx` | All players + global ratings |
| `/players/:id` | `pages/PlayerProfile.tsx` | Single player: ratings, history, h2h, partners, **per-series ratings** |
| `/players/pairs` | `pages/PairLeaderboard.tsx` | Doubles pair ratings |
| `/series` | `pages/SeriesList.tsx` | All series |
| `/series/:id` | `pages/SeriesDetail.tsx` | Series: cumulative standings, **Ratings tab**, events |
| `/settings` | `pages/Settings.tsx` | Misc config |

## Domain model

Database lives in Supabase under the `rr_` prefix. Hand-typed in `src/types/database.ts` (no codegen yet).

- `rr_players` — global Glicko ratings (singles + doubles), aggregate stats
- `rr_pairs` — doubles partnerships, separately rated
- `rr_events` — a single tournament. Optional `series_id` linking it to a series
- `rr_event_players` — membership rows. Stores `initial_rating_snapshot` (JSON, see below)
- `rr_matches` — every match, scheduled or completed. Score blob in `scores`
- `rr_series` — a long-running league/season grouping events
- `rr_series_ratings` — **per-(player, series) Glicko ratings**. Added in migration 003
- `rr_rating_history` — append-only log of (event → rating before/after) for the global rating chart
- `rr_pair_rating_history` — same idea for pairs

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

Migration SQL is generated as deliverables and lives outside `src/`. The most recent:

- `migration-001` — initial schema
- `migration-002-rating-history` — `rr_rating_history`, `rr_pair_rating_history`
- `migration-003-series-ratings` — `rr_series_ratings` + the `series` block in `initial_rating_snapshot`

There is no `migrations/` folder in the repo yet. Migrations have to be applied manually in the Supabase SQL editor. **TODO**: copy them into `migrations/` so they're source-controlled.

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
npm run dev      # vite dev server, default port 5173
npm run build    # tsc -b && vite build
npm run lint     # tsc -b --noEmit
```

`.env.local` holds `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` + `VITE_APP_PASSWORD` (the gate).
