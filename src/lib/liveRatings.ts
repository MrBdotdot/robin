import { supabase } from "./supabase";
import { updateRating, teamRating, type Rating } from "./glicko2";
import type {
  InitialRatingSnapshot,
  Player,
  SeriesRating,
} from "@/types/database";
import {
  loadSeriesRatings,
  upsertSeriesRating,
} from "./seriesRatings";

interface LegacyRatingSnapshot {
  singles: Rating;
  doubles: Rating;
}

export type RatingSnapshot = InitialRatingSnapshot;

function normalizeSnapshot(raw: unknown): InitialRatingSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.global) return raw as InitialRatingSnapshot;
  if (obj.singles && obj.doubles) {
    const legacy = raw as LegacyRatingSnapshot;
    return {
      global: { singles: legacy.singles, doubles: legacy.doubles },
    };
  }
  return null;
}

export function snapshotFromPlayer(p: Player): InitialRatingSnapshot {
  return {
    global: {
      singles: {
        rating: p.glicko_singles_rating,
        rd: p.glicko_singles_rd,
        vol: p.glicko_singles_vol,
      },
      doubles: {
        rating: p.glicko_doubles_rating,
        rd: p.glicko_doubles_rd,
        vol: p.glicko_doubles_vol,
      },
    },
  };
}

export async function recomputeLiveRatings(eventId: string): Promise<void> {
  const [
    { data: event, error: evErr },
    { data: eventPlayers, error: epErr },
    { data: matches, error: mErr },
  ] = await Promise.all([
    supabase.from("rr_events").select("*").eq("id", eventId).single(),
    supabase.from("rr_event_players").select("*").eq("event_id", eventId),
    supabase.from("rr_matches").select("*").eq("event_id", eventId),
  ]);

  if (evErr || epErr || mErr) return;
  if (!event || !eventPlayers || !matches) return;
  if (event.status === "completed" || event.status === "archived") return;

  const playerIds = eventPlayers.map((ep) => ep.player_id);
  if (playerIds.length === 0) return;

  const { data: players } = await supabase
    .from("rr_players")
    .select("*")
    .in("id", playerIds);
  if (!players) return;

  const playersById: Record<string, Player> = {};
  for (const p of players as Player[]) playersById[p.id] = p;

  const seriesId: string | null =
    (event as { series_id: string | null }).series_id ?? null;

  let existingSeriesRatings: Map<string, SeriesRating> = new Map();
  if (seriesId) {
    existingSeriesRatings = await loadSeriesRatings(seriesId, playerIds);
  }

  // Lazy-backfill snapshots
  for (const ep of eventPlayers) {
    const p = playersById[ep.player_id];
    if (!p) continue;
    const current = normalizeSnapshot(ep.initial_rating_snapshot);
    let needsWrite = false;
    let snap: InitialRatingSnapshot;
    if (!current) {
      snap = snapshotFromPlayer(p);
      needsWrite = true;
    } else {
      snap = current;
      if (current !== ep.initial_rating_snapshot) needsWrite = true;
    }
    if (seriesId && !snap.series) {
      const sr = existingSeriesRatings.get(ep.player_id);
      if (sr) {
        snap.series = {
          singles: {
            rating: sr.glicko_singles_rating,
            rd: sr.glicko_singles_rd,
            vol: sr.glicko_singles_vol,
          },
          doubles: {
            rating: sr.glicko_doubles_rating,
            rd: sr.glicko_doubles_rd,
            vol: sr.glicko_doubles_vol,
          },
        };
      } else {
        // Seed from snap.global (the pre-event baseline), NOT from the
        // player's current global rating. By the time we lazy-backfill,
        // recomputeLiveRatings has likely already absorbed this event's
        // completed matches into rr_players.glicko_*, so using the current
        // global would double-count once we replay the same matches
        // against this snapshot.
        snap.series = {
          singles: { ...snap.global.singles },
          doubles: { ...snap.global.doubles },
        };
      }
      needsWrite = true;
    }
    if (needsWrite) {
      const { error } = await supabase
        .from("rr_event_players")
        .update({ initial_rating_snapshot: snap })
        .eq("id", ep.id);
      if (!error) {
        ep.initial_rating_snapshot = snap as unknown as never;
      }
    }
  }

  const isDoubles = event.mode !== "singles";

  const completed = matches
    .filter((m) => m.status === "completed" && m.winner_side)
    .sort((a, b) => {
      const tA = a.completed_at
        ? new Date(a.completed_at).getTime()
        : new Date(a.created_at).getTime();
      const tB = b.completed_at
        ? new Date(b.completed_at).getTime()
        : new Date(b.created_at).getTime();
      if (tA !== tB) return tA - tB;
      return a.round - b.round || (a.court ?? 0) - (b.court ?? 0);
    });

  interface ReplayResult {
    /** Final rating per player after all completed matches replayed. */
    live: Map<string, Rating>;
    /** Completed-match count per player from the replay. */
    matchCount: Map<string, number>;
  }

  const replay = (
    pickRating: (snap: InitialRatingSnapshot) => Rating | null
  ): ReplayResult => {
    const live = new Map<string, Rating>();
    const matchCount = new Map<string, number>();
    for (const ep of eventPlayers) {
      const snap = normalizeSnapshot(ep.initial_rating_snapshot);
      if (!snap) continue;
      const r = pickRating(snap);
      if (r) live.set(ep.player_id, r);
    }
    const teamRatingFor = (ids: string[]): Rating => {
      const ratings = ids
        .map((id) => live.get(id))
        .filter((r): r is Rating => !!r);
      if (ratings.length === 0) return { rating: 1500, rd: 350, vol: 0.06 };
      if (ratings.length === 1) return ratings[0];
      return ratings.reduce((acc, r, i) =>
        i === 0 ? r : teamRating(acc, r)
      );
    };
    for (const m of completed) {
      const oppForA = teamRatingFor(m.side_b_player_ids);
      const oppForB = teamRatingFor(m.side_a_player_ids);
      for (const id of m.side_a_player_ids) {
        const before = live.get(id);
        if (!before) continue;
        const score =
          m.winner_side === "a" ? 1 : m.winner_side === "draw" ? 0.5 : 0;
        live.set(id, updateRating(before, [{ opponent: oppForA, score }]));
        matchCount.set(id, (matchCount.get(id) ?? 0) + 1);
      }
      for (const id of m.side_b_player_ids) {
        const before = live.get(id);
        if (!before) continue;
        const score =
          m.winner_side === "b" ? 1 : m.winner_side === "draw" ? 0.5 : 0;
        live.set(id, updateRating(before, [{ opponent: oppForB, score }]));
        matchCount.set(id, (matchCount.get(id) ?? 0) + 1);
      }
    }
    return { live, matchCount };
  };

  const globalReplay = replay((snap) =>
    isDoubles ? snap.global.doubles : snap.global.singles
  );
  const liveGlobal = globalReplay.live;
  const seriesReplay = seriesId
    ? replay((snap) => {
        const series = snap.series;
        if (!series) return null;
        return isDoubles ? series.doubles : series.singles;
      })
    : null;

  // Save global ratings to rr_players
  for (const ep of eventPlayers) {
    const r = liveGlobal.get(ep.player_id);
    if (!r) continue;
    const update: Partial<Player> = {};
    if (isDoubles) {
      update.glicko_doubles_rating = r.rating;
      update.glicko_doubles_rd = r.rd;
      update.glicko_doubles_vol = r.vol;
    } else {
      update.glicko_singles_rating = r.rating;
      update.glicko_singles_rd = r.rd;
      update.glicko_singles_vol = r.vol;
    }
    await supabase.from("rr_players").update(update).eq("id", ep.player_id);
  }

  // Save series ratings to rr_series_ratings.
  //
  // Recompute is idempotent: it replays every completed match in this
  // event from the player's snapshot. So matches_played is *set*, not
  // bumped, to (this-event count) + (sibling-events count) — see
  // computeSeriesMatchTotals.
  if (seriesId && seriesReplay) {
    // Latest completed match in this event — used for last_played_at.
    const latestCompletedAt = (() => {
      for (let i = completed.length - 1; i >= 0; i--) {
        const ts = completed[i].completed_at;
        if (ts) return ts;
      }
      return null;
    })();

    // Per-player match totals across the entire series (every series
    // event, completed or live), so we can persist a correct
    // `matches_played`.
    const seriesMatchTotals = await computeSeriesMatchTotals(
      seriesId,
      eventPlayers.map((ep) => ep.player_id),
      eventId,
      seriesReplay.matchCount
    );

    for (const ep of eventPlayers) {
      const r = seriesReplay.live.get(ep.player_id);
      if (!r) continue;
      await upsertSeriesRating(seriesId, ep.player_id, {
        rating: { [isDoubles ? "doubles" : "singles"]: r },
        matchesPlayed: seriesMatchTotals.get(ep.player_id) ?? 0,
        lastPlayedAt: latestCompletedAt ?? undefined,
        seedFromGlobal: {
          singles: {
            rating: playersById[ep.player_id].glicko_singles_rating,
            rd: playersById[ep.player_id].glicko_singles_rd,
            vol: playersById[ep.player_id].glicko_singles_vol,
          },
          doubles: {
            rating: playersById[ep.player_id].glicko_doubles_rating,
            rd: playersById[ep.player_id].glicko_doubles_rd,
            vol: playersById[ep.player_id].glicko_doubles_vol,
          },
        },
      });
    }
  }
}

/**
 * Compute total completed matches per player across every event in a
 * series, *excluding* the current event (which is supplied by the
 * caller via `currentEventCounts` from the in-memory replay). Used to
 * keep `rr_series_ratings.matches_played` correct under recompute,
 * which is idempotent.
 *
 * This is a single round-trip (one query for the series's other
 * events' matches), and the caller already has the current event's
 * counts from the replay it just ran.
 */
async function computeSeriesMatchTotals(
  seriesId: string,
  playerIds: string[],
  currentEventId: string,
  currentEventCounts: Map<string, number>
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  for (const id of playerIds) totals.set(id, currentEventCounts.get(id) ?? 0);

  // Find sibling events in the series (everything except the one being recomputed)
  const { data: siblingEvents } = await supabase
    .from("rr_events")
    .select("id")
    .eq("series_id", seriesId)
    .neq("id", currentEventId);
  const siblingIds = (siblingEvents ?? []).map(
    (e: { id: string }) => e.id
  );
  if (siblingIds.length === 0) return totals;

  const { data: siblingMatches } = await supabase
    .from("rr_matches")
    .select("side_a_player_ids,side_b_player_ids,status,winner_side")
    .in("event_id", siblingIds);

  for (const m of (siblingMatches ?? []) as Array<{
    side_a_player_ids: string[];
    side_b_player_ids: string[];
    status: string;
    winner_side: string | null;
  }>) {
    if (m.status !== "completed" || !m.winner_side) continue;
    for (const id of m.side_a_player_ids) {
      if (totals.has(id)) totals.set(id, (totals.get(id) ?? 0) + 1);
    }
    for (const id of m.side_b_player_ids) {
      if (totals.has(id)) totals.set(id, (totals.get(id) ?? 0) + 1);
    }
  }

  return totals;
}

/**
 * One-shot backfill of rr_series_ratings for an event that was already
 * completed/archived when it was assigned to a series.
 *
 * recomputeLiveRatings early-returns on completed/archived events (so
 * scoring an old event can't accidentally re-mutate ratings). That means
 * AssignEventsSheet can attach a finished event to a series, but the
 * event's matches won't show up in the series leaderboard until something
 * runs a series-only replay — which is what this function does.
 *
 * Behavior is best-effort, not chronologically perfect:
 *
 *  - For players who don't yet have an rr_series_ratings row in this
 *    series, we lazy-backfill snap.series from snap.global, replay this
 *    event's completed matches against that seed, and INSERT a row with
 *    the resulting rating + matches_played + last_played_at.
 *
 *  - For players who already have a row (from another series event), we
 *    do NOT overwrite their rating — that would clobber later activity
 *    with results from an event that may or may not even predate them.
 *    We only update matches_played (cumulative across the series, set,
 *    not bumped — replay is idempotent) and last_played_at (only if it
 *    advances).
 *
 * The full chronological-replay-across-the-whole-series fix lives in
 * the still-open D1 backlog item.
 */
export async function backfillCompletedEventSeriesRatings(
  eventId: string
): Promise<void> {
  const [
    { data: event, error: evErr },
    { data: eventPlayers, error: epErr },
    { data: matches, error: mErr },
  ] = await Promise.all([
    supabase.from("rr_events").select("*").eq("id", eventId).single(),
    supabase.from("rr_event_players").select("*").eq("event_id", eventId),
    supabase.from("rr_matches").select("*").eq("event_id", eventId),
  ]);

  if (evErr || epErr || mErr) return;
  if (!event || !eventPlayers || !matches) return;
  if (event.status !== "completed" && event.status !== "archived") return;

  const seriesId: string | null =
    (event as { series_id: string | null }).series_id ?? null;
  if (!seriesId) return;

  const playerIds = eventPlayers.map((ep) => ep.player_id);
  if (playerIds.length === 0) return;

  const { data: players } = await supabase
    .from("rr_players")
    .select("*")
    .in("id", playerIds);
  if (!players) return;

  const playersById: Record<string, Player> = {};
  for (const p of players as Player[]) playersById[p.id] = p;

  const existingSeriesRatings = await loadSeriesRatings(seriesId, playerIds);

  // Lazy-backfill snap.series from snap.global where missing. (We never
  // pull from existingSeriesRatings here — those rows reflect post-other-
  // event activity, not what this player looked like when this event
  // happened.)
  for (const ep of eventPlayers) {
    const p = playersById[ep.player_id];
    if (!p) continue;
    const current = normalizeSnapshot(ep.initial_rating_snapshot);
    let snap: InitialRatingSnapshot;
    let needsWrite = false;
    if (!current) {
      snap = snapshotFromPlayer(p);
      needsWrite = true;
    } else {
      snap = current;
      if (current !== ep.initial_rating_snapshot) needsWrite = true;
    }
    if (!snap.series) {
      snap.series = {
        singles: { ...snap.global.singles },
        doubles: { ...snap.global.doubles },
      };
      needsWrite = true;
    }
    if (needsWrite) {
      const { error } = await supabase
        .from("rr_event_players")
        .update({ initial_rating_snapshot: snap })
        .eq("id", ep.id);
      if (!error) {
        ep.initial_rating_snapshot = snap as unknown as never;
      }
    }
  }

  const isDoubles = event.mode !== "singles";

  const completed = matches
    .filter((m) => m.status === "completed" && m.winner_side)
    .sort((a, b) => {
      const tA = a.completed_at
        ? new Date(a.completed_at).getTime()
        : new Date(a.created_at).getTime();
      const tB = b.completed_at
        ? new Date(b.completed_at).getTime()
        : new Date(b.created_at).getTime();
      if (tA !== tB) return tA - tB;
      return a.round - b.round || (a.court ?? 0) - (b.court ?? 0);
    });

  // Replay only the series leg.
  const live = new Map<string, Rating>();
  const matchCount = new Map<string, number>();
  for (const ep of eventPlayers) {
    const snap = normalizeSnapshot(ep.initial_rating_snapshot);
    if (!snap?.series) continue;
    const r = isDoubles ? snap.series.doubles : snap.series.singles;
    if (r) live.set(ep.player_id, r);
  }
  const teamRatingFor = (ids: string[]): Rating => {
    const ratings = ids
      .map((id) => live.get(id))
      .filter((r): r is Rating => !!r);
    if (ratings.length === 0) return { rating: 1500, rd: 350, vol: 0.06 };
    if (ratings.length === 1) return ratings[0];
    return ratings.reduce((acc, r, i) => (i === 0 ? r : teamRating(acc, r)));
  };
  for (const m of completed) {
    const oppForA = teamRatingFor(m.side_b_player_ids);
    const oppForB = teamRatingFor(m.side_a_player_ids);
    for (const id of m.side_a_player_ids) {
      const before = live.get(id);
      if (!before) continue;
      const score =
        m.winner_side === "a" ? 1 : m.winner_side === "draw" ? 0.5 : 0;
      live.set(id, updateRating(before, [{ opponent: oppForA, score }]));
      matchCount.set(id, (matchCount.get(id) ?? 0) + 1);
    }
    for (const id of m.side_b_player_ids) {
      const before = live.get(id);
      if (!before) continue;
      const score =
        m.winner_side === "b" ? 1 : m.winner_side === "draw" ? 0.5 : 0;
      live.set(id, updateRating(before, [{ opponent: oppForB, score }]));
      matchCount.set(id, (matchCount.get(id) ?? 0) + 1);
    }
  }

  const latestCompletedAt = (() => {
    for (let i = completed.length - 1; i >= 0; i--) {
      const ts = completed[i].completed_at;
      if (ts) return ts;
    }
    return null;
  })();

  const seriesMatchTotals = await computeSeriesMatchTotals(
    seriesId,
    playerIds,
    eventId,
    matchCount
  );

  for (const ep of eventPlayers) {
    const r = live.get(ep.player_id);
    if (!r) continue;
    const existing = existingSeriesRatings.get(ep.player_id);
    const hasPriorActivity = !!existing && (existing.matches_played ?? 0) > 0;

    // Advance-only on lastPlayedAt: never regress a more-recent timestamp
    // from another series event.
    let lastPlayedAt: string | undefined;
    if (latestCompletedAt) {
      if (!existing?.last_played_at) {
        lastPlayedAt = latestCompletedAt;
      } else if (
        new Date(latestCompletedAt).getTime() >
        new Date(existing.last_played_at).getTime()
      ) {
        lastPlayedAt = latestCompletedAt;
      }
    }

    await upsertSeriesRating(seriesId, ep.player_id, {
      // Skip rating overwrite when the player already has activity in this
      // series — the existing row reflects later events we'd otherwise
      // clobber. New rows get the replayed rating, seeded from snap.global.
      rating: hasPriorActivity
        ? undefined
        : { [isDoubles ? "doubles" : "singles"]: r },
      matchesPlayed: seriesMatchTotals.get(ep.player_id) ?? 0,
      lastPlayedAt,
      seedFromGlobal: {
        singles: {
          rating: playersById[ep.player_id].glicko_singles_rating,
          rd: playersById[ep.player_id].glicko_singles_rd,
          vol: playersById[ep.player_id].glicko_singles_vol,
        },
        doubles: {
          rating: playersById[ep.player_id].glicko_doubles_rating,
          rd: playersById[ep.player_id].glicko_doubles_rd,
          vol: playersById[ep.player_id].glicko_doubles_vol,
        },
      },
    });
  }
}
