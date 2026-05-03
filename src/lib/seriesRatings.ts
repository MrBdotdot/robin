import { supabase } from "./supabase";
import type {
  InitialRatingSnapshot,
  Player,
  SeriesRating,
} from "@/types/database";
import type { Rating } from "./glicko2";

/**
 * Helpers for the per-series Glicko ratings introduced in migration 003.
 *
 * Big-picture: every series-bound event maintains its own rating cosmos
 * for each participating player, on top of the player's global rating.
 * First time a player joins a series, their series rating is seeded
 * from their global rating; from then on, only matches in series-bound
 * events update the series rating.
 */

/** Default Glicko state used when both global and series are missing. */
export const DEFAULT_RATING: Rating = { rating: 1500, rd: 350, vol: 0.06 };

/** Pull existing per-series ratings for a set of (series, players). */
export async function loadSeriesRatings(
  seriesId: string,
  playerIds: string[]
): Promise<Map<string, SeriesRating>> {
  const out = new Map<string, SeriesRating>();
  if (playerIds.length === 0) return out;
  const { data, error } = await supabase
    .from("rr_series_ratings")
    .select("*")
    .eq("series_id", seriesId)
    .in("player_id", playerIds);
  if (error) return out;
  for (const r of (data ?? []) as SeriesRating[]) {
    out.set(r.player_id, r);
  }
  return out;
}

/**
 * Build the snapshot payload that goes into rr_event_players.initial_rating_snapshot.
 *
 *   - `global` is always populated from the player row.
 *   - `series` is populated only when `seriesRating` is non-null. Pass null
 *     for standalone events; pass a SeriesRating row for series events.
 *     If the player has no row yet for this series, the caller should pass
 *     `seedSeriesFromPlayer(player)` so the series rating begins life
 *     identical to the global rating.
 */
export function buildSnapshot(
  player: Player,
  seriesRating: SeriesRating | null
): InitialRatingSnapshot {
  const snap: InitialRatingSnapshot = {
    global: {
      singles: {
        rating: player.glicko_singles_rating,
        rd: player.glicko_singles_rd,
        vol: player.glicko_singles_vol,
      },
      doubles: {
        rating: player.glicko_doubles_rating,
        rd: player.glicko_doubles_rd,
        vol: player.glicko_doubles_vol,
      },
    },
  };
  if (seriesRating) {
    snap.series = {
      singles: {
        rating: seriesRating.glicko_singles_rating,
        rd: seriesRating.glicko_singles_rd,
        vol: seriesRating.glicko_singles_vol,
      },
      doubles: {
        rating: seriesRating.glicko_doubles_rating,
        rd: seriesRating.glicko_doubles_rd,
        vol: seriesRating.glicko_doubles_vol,
      },
    };
  }
  return snap;
}

/**
 * Synthesize a "starting" series rating from the player's global rating.
 * Used when a player joins a series-bound event for the first time so the
 * snapshot has a `series` block even though no rr_series_ratings row
 * exists yet. The row is created later when the event finalizes.
 */
export function seedSeriesFromPlayer(player: Player): SeriesRating {
  const now = new Date().toISOString();
  return {
    id: "synthetic",
    player_id: player.id,
    series_id: "synthetic",
    glicko_singles_rating: player.glicko_singles_rating,
    glicko_singles_rd: player.glicko_singles_rd,
    glicko_singles_vol: player.glicko_singles_vol,
    glicko_doubles_rating: player.glicko_doubles_rating,
    glicko_doubles_rd: player.glicko_doubles_rd,
    glicko_doubles_vol: player.glicko_doubles_vol,
    matches_played: 0,
    last_played_at: null,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Convenience: given a series id and a set of players, build snapshots
 * for every one of them. Loads existing series ratings in a single round
 * trip; for any player without a row, seeds from their global. Returns a
 * Map keyed by player id.
 */
export async function buildSnapshotsForSeriesEvent(
  seriesId: string | null,
  players: Player[]
): Promise<Map<string, InitialRatingSnapshot>> {
  const map = new Map<string, InitialRatingSnapshot>();
  if (!seriesId) {
    for (const p of players) map.set(p.id, buildSnapshot(p, null));
    return map;
  }
  const existing = await loadSeriesRatings(
    seriesId,
    players.map((p) => p.id)
  );
  for (const p of players) {
    const sr = existing.get(p.id) ?? seedSeriesFromPlayer(p);
    map.set(p.id, buildSnapshot(p, sr));
  }
  return map;
}

/**
 * Options for upsertSeriesRating.
 *
 *  - `rating`         — the new rating(s) to write (one side per call, in
 *                       practice; an event is either singles or doubles).
 *                       Optional: omit when you want to update only
 *                       `matchesPlayed` / `lastPlayedAt` without touching
 *                       the rating itself (e.g. backfilling a completed
 *                       event for a player who already has a series row
 *                       — overwriting their rating would clobber later
 *                       activity).
 *  - `matchesPlayed`  — explicit total to *set* on the row. The replay
 *                       engine in liveRatings is idempotent, so callers
 *                       count completed matches per player from the replay
 *                       and pass the total here. If omitted, the existing
 *                       row's count is preserved (or 0 on insert).
 *  - `lastPlayedAt`   — ISO timestamp of the latest completed match in the
 *                       replay. Idempotent. If omitted, falls back to
 *                       existing value (or now() on insert).
 *  - `seedFromGlobal` — for the very first row this player has in this
 *                       series, used to seed the *unused* side from the
 *                       player's global Glicko rating. Without this the
 *                       unused side would default to 1500/350/0.06, which
 *                       is wrong: the contract is that a fresh series
 *                       rating equals the player's global rating until
 *                       drift sets in.
 */
export interface UpsertSeriesRatingOptions {
  rating?: { singles?: Rating; doubles?: Rating };
  matchesPlayed?: number;
  lastPlayedAt?: string;
  seedFromGlobal?: { singles: Rating; doubles: Rating };
}

/**
 * Upsert a series rating row. Used by liveRatings + finalizeEvent to
 * persist the recomputed series rating after a match resolves.
 *
 * Note: `recomputeLiveRatings` is idempotent (it replays all completed
 * matches from scratch every time a score changes), so this function
 * sets values rather than incrementing them.
 */
export async function upsertSeriesRating(
  seriesId: string,
  playerId: string,
  opts: UpsertSeriesRatingOptions
): Promise<void> {
  const { rating, matchesPlayed, lastPlayedAt, seedFromGlobal } = opts;

  // Load existing row first so we know what to merge
  const { data: existing } = await supabase
    .from("rr_series_ratings")
    .select("*")
    .eq("series_id", seriesId)
    .eq("player_id", playerId)
    .maybeSingle();

  const row: Partial<SeriesRating> = {
    series_id: seriesId,
    player_id: playerId,
  };

  // Caller-provided rating overwrites the side they're updating.
  if (rating?.singles) {
    row.glicko_singles_rating = rating.singles.rating;
    row.glicko_singles_rd = rating.singles.rd;
    row.glicko_singles_vol = rating.singles.vol;
  }
  if (rating?.doubles) {
    row.glicko_doubles_rating = rating.doubles.rating;
    row.glicko_doubles_rd = rating.doubles.rd;
    row.glicko_doubles_vol = rating.doubles.vol;
  }
  if (matchesPlayed !== undefined) {
    row.matches_played = matchesPlayed;
  }
  if (lastPlayedAt !== undefined) {
    row.last_played_at = lastPlayedAt;
  }

  if (existing) {
    await supabase
      .from("rr_series_ratings")
      .update(row)
      .eq("id", (existing as SeriesRating).id);
    return;
  }

  // First-time insert. Seed the side that wasn't written from the
  // player's global rating (if provided) so a player who plays only
  // doubles in a series has a sensible singles seed should they later
  // play singles in the same series.
  const seedSingles =
    seedFromGlobal?.singles ?? DEFAULT_RATING;
  const seedDoubles =
    seedFromGlobal?.doubles ?? DEFAULT_RATING;
  const insert: Partial<SeriesRating> = {
    ...row,
    glicko_singles_rating:
      row.glicko_singles_rating ?? seedSingles.rating,
    glicko_singles_rd: row.glicko_singles_rd ?? seedSingles.rd,
    glicko_singles_vol: row.glicko_singles_vol ?? seedSingles.vol,
    glicko_doubles_rating:
      row.glicko_doubles_rating ?? seedDoubles.rating,
    glicko_doubles_rd: row.glicko_doubles_rd ?? seedDoubles.rd,
    glicko_doubles_vol: row.glicko_doubles_vol ?? seedDoubles.vol,
    matches_played: row.matches_played ?? matchesPlayed ?? 0,
    last_played_at: row.last_played_at ?? lastPlayedAt ?? null,
  };
  await supabase.from("rr_series_ratings").insert(insert);
}
