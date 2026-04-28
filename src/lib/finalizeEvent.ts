import { supabase } from "./supabase";
import {
  updateRating,
  type Outcome,
  type Rating,
} from "./glicko2";
import { computeStandings, type Tiebreaker } from "./standings";
import { recomputeLiveRatings, type RatingSnapshot } from "./liveRatings";
import type { MatchRow, Player, RatingType } from "@/types/database";

export interface FinalizeResult {
  playersUpdated: number;
  pairsUpdated: number;
  matchesCancelled: number;
  finalRanksWritten: number;
}

export function describeFinalize(r: FinalizeResult): string {
  const parts: string[] = [];
  parts.push(
    `${r.playersUpdated} player rating${r.playersUpdated === 1 ? "" : "s"} updated`
  );
  if (r.pairsUpdated > 0)
    parts.push(
      `${r.pairsUpdated} pair rating${r.pairsUpdated === 1 ? "" : "s"} updated`
    );
  if (r.matchesCancelled > 0)
    parts.push(
      `${r.matchesCancelled} unplayed match${r.matchesCancelled === 1 ? "" : "es"} cancelled`
    );
  return parts.join(" · ");
}

/**
 * Finalize an event.
 *
 * The heavy rating math now happens continuously via liveRatings.recomputeLiveRatings,
 * so finalize is straightforward:
 *   1. Cancel any remaining scheduled / in-progress matches.
 *   2. Run a final recomputeLiveRatings to ensure rr_players is up to date.
 *   3. Write rating_history rows comparing each player's snapshot to their
 *      now-final rating.
 *   4. For doubles, update per-pair ratings (these aren't tracked live yet).
 *   5. Compute final standings, write final_rank.
 *   6. Mark event completed.
 */
export async function finalizeEvent(eventId: string): Promise<FinalizeResult> {
  const [
    { data: event, error: evErr },
    { data: eventPlayers, error: epErr },
    { data: matchesPre, error: mErr },
  ] = await Promise.all([
    supabase.from("rr_events").select("*").eq("id", eventId).single(),
    supabase.from("rr_event_players").select("*").eq("event_id", eventId),
    supabase.from("rr_matches").select("*").eq("event_id", eventId),
  ]);
  if (evErr) throw evErr;
  if (epErr) throw epErr;
  if (mErr) throw mErr;
  if (!event || !eventPlayers || !matchesPre) {
    throw new Error("Failed to load event data");
  }
  if (event.status === "completed" || event.status === "archived") {
    throw new Error("Event is already finalized");
  }

  // 1. Cancel un-played matches
  const cancellable = matchesPre.filter(
    (m) => m.status === "scheduled" || m.status === "in_progress"
  );
  let matchesCancelled = 0;
  if (cancellable.length > 0) {
    const { error: cErr } = await supabase
      .from("rr_matches")
      .update({ status: "cancelled" })
      .in("id", cancellable.map((m) => m.id));
    if (cErr) throw cErr;
    matchesCancelled = cancellable.length;
  }

  // 2. Final live recompute so rr_players reflects every completed match
  await recomputeLiveRatings(eventId);

  // Reload after recompute
  const [
    { data: matches },
    { data: playersAfter },
    { data: eventPlayersAfter },
  ] = await Promise.all([
    supabase.from("rr_matches").select("*").eq("event_id", eventId),
    supabase
      .from("rr_players")
      .select("*")
      .in("id", eventPlayers.map((ep) => ep.player_id)),
    supabase.from("rr_event_players").select("*").eq("event_id", eventId),
  ]);
  if (!matches || !playersAfter || !eventPlayersAfter) {
    throw new Error("Failed to reload after recompute");
  }
  const playersById: Record<string, Player> = {};
  for (const p of playersAfter) playersById[p.id] = p;

  const isDoubles = event.mode === "doubles_americano";
  const ratingType: RatingType = isDoubles ? "doubles" : "singles";

  // 3. Write rating history rows: snapshot → final
  const historyRows: Array<{
    event_id: string;
    player_id: string;
    rating_type: RatingType;
    rating_before: number;
    rating_after: number;
    rd_before: number;
    rd_after: number;
    vol_before: number;
    vol_after: number;
  }> = [];
  let playersUpdated = 0;

  for (const ep of eventPlayersAfter) {
    const p = playersById[ep.player_id];
    if (!p) continue;
    const snap = ep.initial_rating_snapshot as RatingSnapshot | null;
    if (!snap) continue;
    const before = isDoubles ? snap.doubles : snap.singles;
    const after: Rating = isDoubles
      ? {
          rating: p.glicko_doubles_rating,
          rd: p.glicko_doubles_rd,
          vol: p.glicko_doubles_vol,
        }
      : {
          rating: p.glicko_singles_rating,
          rd: p.glicko_singles_rd,
          vol: p.glicko_singles_vol,
        };
    // Skip players who didn't actually play (rating unchanged)
    if (before.rating === after.rating && before.rd === after.rd) continue;

    historyRows.push({
      event_id: eventId,
      player_id: p.id,
      rating_type: ratingType,
      rating_before: before.rating,
      rating_after: after.rating,
      rd_before: before.rd,
      rd_after: after.rd,
      vol_before: before.vol,
      vol_after: after.vol,
    });
    playersUpdated++;
  }
  if (historyRows.length > 0) {
    const { error: hErr } = await supabase
      .from("rr_rating_history")
      .insert(historyRows);
    if (hErr) throw hErr;
  }

  // 4. Pair ratings (doubles only, batched at finalize)
  let pairsUpdated = 0;
  if (isDoubles) {
    const ratingMatches = matches.filter(
      (m) => m.status === "completed" && m.winner_side
    );
    pairsUpdated = await updatePairRatingsForEvent(
      eventId,
      ratingMatches,
      playersById
    );
  }

  // 5. Final ranks
  const tiebreakers = (
    (event.config as { tiebreakers?: Tiebreaker[] }).tiebreakers ?? [
      "wins",
      "h2h",
      "point_diff",
      "points_for",
    ]
  ) as Tiebreaker[];
  const standings = computeStandings(
    eventPlayersAfter.map((ep) => ep.player_id),
    matches,
    tiebreakers
  );
  let finalRanksWritten = 0;
  for (const s of standings) {
    const ep = eventPlayersAfter.find((x) => x.player_id === s.playerId);
    if (!ep) continue;
    const { error: rErr } = await supabase
      .from("rr_event_players")
      .update({ final_rank: s.rank })
      .eq("id", ep.id);
    if (rErr) throw rErr;
    finalRanksWritten++;
  }

  // 6. Mark completed
  const { error: evMarkErr } = await supabase
    .from("rr_events")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", eventId);
  if (evMarkErr) throw evMarkErr;

  return { playersUpdated, pairsUpdated, matchesCancelled, finalRanksWritten };
}

// =============================================================
// Pair rating helpers (unchanged from before — pairs aren't live)
// =============================================================
async function updatePairRatingsForEvent(
  eventId: string,
  matches: MatchRow[],
  _playersById: Record<string, Player>
): Promise<number> {
  type PairKey = string;
  const pairMatches = new Map<
    PairKey,
    Array<{ opponentPair: string[]; score: number }>
  >();

  const canonicalize = (ids: string[]): string[] => [...ids].sort();

  for (const m of matches) {
    if (m.side_a_player_ids.length !== 2 || m.side_b_player_ids.length !== 2)
      continue;
    const aPair = canonicalize(m.side_a_player_ids);
    const bPair = canonicalize(m.side_b_player_ids);
    const aKey = aPair.join("|");
    const bKey = bPair.join("|");
    const aScore =
      m.winner_side === "a" ? 1 : m.winner_side === "draw" ? 0.5 : 0;
    const bScore =
      m.winner_side === "b" ? 1 : m.winner_side === "draw" ? 0.5 : 0;

    const aArr = pairMatches.get(aKey) ?? [];
    aArr.push({ opponentPair: bPair, score: aScore });
    pairMatches.set(aKey, aArr);

    const bArr = pairMatches.get(bKey) ?? [];
    bArr.push({ opponentPair: aPair, score: bScore });
    pairMatches.set(bKey, bArr);
  }

  if (pairMatches.size === 0) return 0;

  const allPairKeys = new Set<string>();
  for (const k of pairMatches.keys()) allPairKeys.add(k);
  for (const arr of pairMatches.values()) {
    for (const o of arr) allPairKeys.add(o.opponentPair.join("|"));
  }

  const pairRows = Array.from(allPairKeys).map((k) => {
    const [a, b] = k.split("|");
    return { player_a_id: a, player_b_id: b };
  });

  const { error: pInsErr } = await supabase
    .from("rr_pairs")
    .upsert(pairRows, {
      onConflict: "player_a_id,player_b_id",
      ignoreDuplicates: true,
    });
  if (pInsErr) throw pInsErr;

  const { data: pairs, error: pSelErr } = await supabase
    .from("rr_pairs")
    .select("*")
    .in(
      "player_a_id",
      pairRows.map((r) => r.player_a_id)
    )
    .in(
      "player_b_id",
      pairRows.map((r) => r.player_b_id)
    );
  if (pSelErr) throw pSelErr;
  if (!pairs) return 0;

  const pairsByKey = new Map<string, (typeof pairs)[number]>();
  for (const p of pairs) {
    pairsByKey.set(`${p.player_a_id}|${p.player_b_id}`, p);
  }

  const pairHistoryRows: Array<{
    event_id: string;
    pair_id: string;
    rating_before: number;
    rating_after: number;
    rd_before: number;
    rd_after: number;
    vol_before: number;
    vol_after: number;
  }> = [];

  let pairsUpdated = 0;
  for (const [pairKey, outcomes] of pairMatches.entries()) {
    const pairRow = pairsByKey.get(pairKey);
    if (!pairRow) continue;

    const before: Rating = {
      rating: pairRow.pair_rating,
      rd: pairRow.pair_rd,
      vol: pairRow.pair_vol,
    };

    const ratedOutcomes: Outcome[] = outcomes.map((o) => {
      const oppPair = pairsByKey.get(o.opponentPair.join("|"));
      const opponentRating: Rating = oppPair
        ? {
            rating: oppPair.pair_rating,
            rd: oppPair.pair_rd,
            vol: oppPair.pair_vol,
          }
        : { rating: 1500, rd: 350, vol: 0.06 };
      return { opponent: opponentRating, score: o.score };
    });

    const after = updateRating(before, ratedOutcomes);

    const { error: upErr } = await supabase
      .from("rr_pairs")
      .update({
        pair_rating: after.rating,
        pair_rd: after.rd,
        pair_vol: after.vol,
        matches_played: (pairRow.matches_played ?? 0) + outcomes.length,
        last_played_at: new Date().toISOString(),
      })
      .eq("id", pairRow.id);
    if (upErr) throw upErr;

    pairHistoryRows.push({
      event_id: eventId,
      pair_id: pairRow.id,
      rating_before: before.rating,
      rating_after: after.rating,
      rd_before: before.rd,
      rd_after: after.rd,
      vol_before: before.vol,
      vol_after: after.vol,
    });
    pairsUpdated++;
  }

  if (pairHistoryRows.length > 0) {
    const { error: phErr } = await supabase
      .from("rr_pair_rating_history")
      .insert(pairHistoryRows);
    if (phErr) throw phErr;
  }

  return pairsUpdated;
}
