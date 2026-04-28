/**
 * Compute event standings with configurable tiebreakers.
 *
 * Default tiebreaker order (set during event creation):
 *   1. wins
 *   2. h2h     — head-to-head record among tied players
 *   3. point_diff
 *   4. points_for
 *   5. points_against (lower is better)
 *
 * Forfeits are counted as wins for the non-forfeiting side and losses for
 * the forfeiting side (in W-L). Forfeits don't have point scores so they
 * don't affect point differential.
 */

import type { MatchRow } from "@/types/database";

export type Tiebreaker =
  | "wins"
  | "h2h"
  | "point_diff"
  | "points_for"
  | "points_against";

export interface PlayerStanding {
  playerId: string;
  rank: number;       // 1-based, ties share the same rank
  played: number;
  wins: number;
  losses: number;
  draws: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
}

interface RawStats {
  playerId: string;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  pointsFor: number;
  pointsAgainst: number;
}

function emptyStats(playerId: string): RawStats {
  return {
    playerId,
    played: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    pointsFor: 0,
    pointsAgainst: 0,
  };
}

/**
 * Pull a numeric score for one side out of a match, if any. Returns null
 * if the match doesn't have a numeric score (e.g. win/loss-only events,
 * forfeits, draws without scores).
 */
function sideScore(match: MatchRow, side: "a" | "b"): number | null {
  const s = match.scores;
  if (!s || typeof s !== "object") return null;
  const obj = s as Record<string, unknown>;
  const v = side === "a" ? obj.side_a : obj.side_b;
  if (typeof v === "number") return v;
  return null;
}

function accumulateMatch(stats: RawStats, match: MatchRow, side: "a" | "b") {
  const won =
    match.winner_side === side ||
    (match.status === "forfeit_a" && side === "b") ||
    (match.status === "forfeit_b" && side === "a");
  const lost =
    (match.winner_side && match.winner_side !== side && match.winner_side !== "draw") ||
    (match.status === "forfeit_a" && side === "a") ||
    (match.status === "forfeit_b" && side === "b");
  const drew = match.winner_side === "draw";

  // Forfeits and walkovers count toward W-L but not toward played-with-score
  // Only "completed" matches with real scores get point totals.
  if (match.status === "completed" || match.status === "forfeit_a" || match.status === "forfeit_b" || match.status === "walkover") {
    stats.played++;
    if (won) stats.wins++;
    else if (drew) stats.draws++;
    else if (lost) stats.losses++;

    if (match.status === "completed") {
      const pf = sideScore(match, side);
      const pa = sideScore(match, side === "a" ? "b" : "a");
      if (pf != null) stats.pointsFor += pf;
      if (pa != null) stats.pointsAgainst += pa;
    }
  }
}

/**
 * Compute raw stats per player from the event's matches.
 */
function computeRawStats(playerIds: string[], matches: MatchRow[]): Map<string, RawStats> {
  const out = new Map<string, RawStats>();
  for (const id of playerIds) out.set(id, emptyStats(id));

  for (const m of matches) {
    for (const id of m.side_a_player_ids) {
      const s = out.get(id);
      if (s) accumulateMatch(s, m, "a");
    }
    for (const id of m.side_b_player_ids) {
      const s = out.get(id);
      if (s) accumulateMatch(s, m, "b");
    }
  }

  return out;
}

/**
 * Compute "wins" for a single player but considering only matches between
 * a specified set of player IDs. Used for the head-to-head tiebreaker.
 */
function h2hWinsAmong(playerId: string, group: Set<string>, matches: MatchRow[]): number {
  let wins = 0;
  for (const m of matches) {
    const onA = m.side_a_player_ids.includes(playerId);
    const onB = m.side_b_player_ids.includes(playerId);
    if (!onA && !onB) continue;

    // Every player on the OPPOSING side must be in the tied group for the
    // match to count. (For doubles, this means at least one opponent in the
    // group; we accept any opponent in the group as making this an "in-group"
    // match for the player.)
    const opponents = onA ? m.side_b_player_ids : m.side_a_player_ids;
    const anyOppInGroup = opponents.some((id) => id !== playerId && group.has(id));
    if (!anyOppInGroup) continue;

    const playerSide: "a" | "b" = onA ? "a" : "b";
    const won =
      m.winner_side === playerSide ||
      (m.status === "forfeit_a" && playerSide === "b") ||
      (m.status === "forfeit_b" && playerSide === "a");
    if (won) wins++;
  }
  return wins;
}

/**
 * Compute final standings.
 *
 * @param playerIds Active roster (typically the event's non-withdrawn players,
 *                  but withdrawn players can be included to show them at the bottom).
 * @param matches All matches for the event.
 * @param tiebreakers Ordered tiebreaker list. Defaults to ["wins","h2h","point_diff","points_for"].
 */
export function computeStandings(
  playerIds: string[],
  matches: MatchRow[],
  tiebreakers: Tiebreaker[] = ["wins", "h2h", "point_diff", "points_for"]
): PlayerStanding[] {
  const raw = computeRawStats(playerIds, matches);
  let entries = Array.from(raw.values());

  // Map of metric extractors. For all metrics, "higher value sorts earlier"
  // EXCEPT points_against where lower is better — handled by sign flip.
  const metricFor = (
    s: RawStats,
    tb: Tiebreaker,
    groupIds: Set<string>
  ): number => {
    switch (tb) {
      case "wins":
        return s.wins;
      case "point_diff":
        return s.pointsFor - s.pointsAgainst;
      case "points_for":
        return s.pointsFor;
      case "points_against":
        return -s.pointsAgainst;
      case "h2h":
        return h2hWinsAmong(s.playerId, groupIds, matches);
    }
  };

  // Recursive grouping: sort by tiebreaker[idx], then sub-sort tied groups
  // by tiebreaker[idx+1], etc.
  function sortGroup(group: RawStats[], tbIdx: number): RawStats[] {
    if (group.length <= 1 || tbIdx >= tiebreakers.length) return group;

    const tb = tiebreakers[tbIdx];
    const groupIds = new Set(group.map((s) => s.playerId));
    const scored = group.map((s) => ({ s, v: metricFor(s, tb, groupIds) }));
    scored.sort((a, b) => b.v - a.v); // higher first

    const out: RawStats[] = [];
    let i = 0;
    while (i < scored.length) {
      let j = i;
      while (j < scored.length && scored[j].v === scored[i].v) j++;
      const subGroup = scored.slice(i, j).map((x) => x.s);
      out.push(...sortGroup(subGroup, tbIdx + 1));
      i = j;
    }
    return out;
  }

  entries = sortGroup(entries, 0);

  // Compute ranks. Players tied on every tiebreaker share rank.
  const standings: PlayerStanding[] = [];
  let lastKey = "";
  let lastRank = 0;
  entries.forEach((s, idx) => {
    const key = tiebreakers
      .map((tb) => metricFor(s, tb, new Set(entries.map((e) => e.playerId))))
      .join("|");
    const rank = key === lastKey && idx > 0 ? lastRank : idx + 1;
    lastKey = key;
    lastRank = rank;
    standings.push({
      playerId: s.playerId,
      rank,
      played: s.played,
      wins: s.wins,
      losses: s.losses,
      draws: s.draws,
      pointsFor: s.pointsFor,
      pointsAgainst: s.pointsAgainst,
      pointDiff: s.pointsFor - s.pointsAgainst,
    });
  });

  return standings;
}
