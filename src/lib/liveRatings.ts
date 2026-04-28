import { supabase } from "./supabase";
import { updateRating, teamRating, type Rating } from "./glicko2";
import type { Player } from "@/types/database";

export interface RatingSnapshot {
  singles: Rating;
  doubles: Rating;
}

export function snapshotFromPlayer(p: Player): RatingSnapshot {
  return {
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
  };
}

/**
 * Recompute live ratings for an event.
 *
 * Approach (deterministic, idempotent):
 *   1. For each event_player without an initial_rating_snapshot, snapshot
 *      their current rating (lazy backfill so this works for events created
 *      before live ratings shipped).
 *   2. Reset every event participant to their snapshot rating.
 *   3. Replay every completed match in chronological order, applying a
 *      per-match Glicko-2 update. This is sequential (not batch), which is
 *      slightly less smooth than a batched rating period but more useful
 *      for live tracking — and consistent across re-runs.
 *   4. Save updated ratings back to rr_players.
 *
 * Skipped: forfeits, walkovers, cancelled matches — they don't affect rating
 * by design.
 *
 * Called after every score change so seeding regens, standings, and the
 * player profile reflect mid-event performance.
 */
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
  // Live recompute is meaningless on completed/archived events
  if (event.status === "completed" || event.status === "archived") return;

  const playerIds = eventPlayers.map((ep) => ep.player_id);
  if (playerIds.length === 0) return;

  const { data: players } = await supabase
    .from("rr_players")
    .select("*")
    .in("id", playerIds);
  if (!players) return;

  const playersById: Record<string, Player> = {};
  for (const p of players) playersById[p.id] = p;

  // Step 1: lazy-backfill snapshots
  const needsSnapshot = eventPlayers.filter(
    (ep) => !ep.initial_rating_snapshot
  );
  for (const ep of needsSnapshot) {
    const p = playersById[ep.player_id];
    if (!p) continue;
    const snap = snapshotFromPlayer(p);
    const { error } = await supabase
      .from("rr_event_players")
      .update({ initial_rating_snapshot: snap })
      .eq("id", ep.id);
    if (!error) {
      ep.initial_rating_snapshot = snap;
    }
  }

  const isDoubles = event.mode === "doubles_americano";

  // Step 2: reset to snapshot in a local working map
  const live = new Map<string, Rating>();
  for (const ep of eventPlayers) {
    const snap = ep.initial_rating_snapshot as RatingSnapshot | null;
    if (!snap) continue;
    live.set(ep.player_id, isDoubles ? snap.doubles : snap.singles);
  }

  // Step 3: replay completed matches
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
      // Stable ordering when timestamps tie
      return a.round - b.round || (a.court ?? 0) - (b.court ?? 0);
    });

  const teamRatingFor = (ids: string[]): Rating => {
    const ratings = ids.map((id) => live.get(id)).filter((r): r is Rating => !!r);
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
    }
    for (const id of m.side_b_player_ids) {
      const before = live.get(id);
      if (!before) continue;
      const score =
        m.winner_side === "b" ? 1 : m.winner_side === "draw" ? 0.5 : 0;
      live.set(id, updateRating(before, [{ opponent: oppForB, score }]));
    }
  }

  // Step 4: save updated ratings back to rr_players
  for (const ep of eventPlayers) {
    const r = live.get(ep.player_id);
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
}
