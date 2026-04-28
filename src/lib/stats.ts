import type { MatchRow } from "@/types/database";

export interface H2HRecord {
  wins: number;
  losses: number;
  played: number;
}

export interface PlayerStats {
  totalPlayed: number;       // completed matches
  totalWins: number;
  totalLosses: number;
  upcoming: number;          // scheduled or in-progress, not completed
  forfeited: number;         // matches forfeited (either side)
  h2h: Map<string, H2HRecord>;          // opponentId -> record
  partnerships: Map<string, H2HRecord>; // partnerId -> record (doubles only)
}

/**
 * Compute a player's stats from the event's match list.
 * Pure function — feed it whatever subset of matches you want stats over.
 */
export function computePlayerStats(
  playerId: string,
  matches: MatchRow[]
): PlayerStats {
  const stats: PlayerStats = {
    totalPlayed: 0,
    totalWins: 0,
    totalLosses: 0,
    upcoming: 0,
    forfeited: 0,
    h2h: new Map(),
    partnerships: new Map(),
  };

  for (const m of matches) {
    const onA = m.side_a_player_ids.includes(playerId);
    const onB = m.side_b_player_ids.includes(playerId);
    if (!onA && !onB) continue;

    if (m.status === "scheduled" || m.status === "in_progress") {
      stats.upcoming++;
      continue;
    }
    if (
      m.status === "forfeit_a" ||
      m.status === "forfeit_b" ||
      m.status === "walkover"
    ) {
      stats.forfeited++;
      continue;
    }
    if (m.status !== "completed") continue;

    stats.totalPlayed++;
    const playerSide: "a" | "b" = onA ? "a" : "b";
    const opponentIds = playerSide === "a" ? m.side_b_player_ids : m.side_a_player_ids;
    const partnerIds = (playerSide === "a"
      ? m.side_a_player_ids
      : m.side_b_player_ids
    ).filter((id) => id !== playerId);
    const won = m.winner_side === playerSide;

    if (won) stats.totalWins++;
    else stats.totalLosses++;

    for (const opp of opponentIds) {
      const r = stats.h2h.get(opp) ?? { wins: 0, losses: 0, played: 0 };
      r.played++;
      if (won) r.wins++;
      else r.losses++;
      stats.h2h.set(opp, r);
    }
    for (const partner of partnerIds) {
      const r =
        stats.partnerships.get(partner) ?? { wins: 0, losses: 0, played: 0 };
      r.played++;
      if (won) r.wins++;
      else r.losses++;
      stats.partnerships.set(partner, r);
    }
  }

  return stats;
}

/**
 * Format a record as "W–L" (e.g. "3–1"). Uses en-dash for visual polish.
 */
export function formatRecord(r: H2HRecord): string {
  return `${r.wins}–${r.losses}`;
}
