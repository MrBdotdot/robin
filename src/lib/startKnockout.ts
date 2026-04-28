import { supabase } from "./supabase";
import { computeStandings, type Tiebreaker } from "./standings";
import { generateBracket, nextRound, feederPositions } from "./bracket";
import type {
  EventConfig,
  MatchRow,
} from "@/types/database";

export interface StartKnockoutResult {
  matchesGenerated: number;
  byesAutoAdvanced: number;
  bronzeIncluded: boolean;
}

/**
 * Transition a live RR event into its knockout phase.
 *
 * - Cancels any remaining scheduled / in-progress group-stage matches.
 * - Computes standings, takes the top N (depending on format & knockout depth).
 * - Generates the bracket structure and inserts the first round (with seeds).
 * - Auto-completes any "bye" matches so high seeds advance directly.
 *
 * Subsequent rounds are filled in by `advanceKnockoutWinners` after each
 * round completes.
 */
export async function startKnockout(
  eventId: string
): Promise<StartKnockoutResult> {
  const [
    { data: event, error: evErr },
    { data: eventPlayers, error: epErr },
    { data: matches, error: mErr },
  ] = await Promise.all([
    supabase.from("rr_events").select("*").eq("id", eventId).single(),
    supabase.from("rr_event_players").select("*").eq("event_id", eventId),
    supabase.from("rr_matches").select("*").eq("event_id", eventId),
  ]);
  if (evErr) throw evErr;
  if (epErr) throw epErr;
  if (mErr) throw mErr;
  if (!event || !eventPlayers || !matches) {
    throw new Error("Failed to load event data");
  }
  if (event.format === "pure_rr") {
    throw new Error("This event isn't configured for a knockout phase");
  }
  if (event.status !== "live") {
    throw new Error("Event isn't in progress");
  }
  // Already started knockout?
  if (matches.some((m) => m.stage !== "group_rr")) {
    throw new Error("Knockout phase has already been started");
  }

  // Cancel remaining group-stage matches
  const cancellable = matches.filter(
    (m) =>
      m.stage === "group_rr" &&
      (m.status === "scheduled" || m.status === "in_progress")
  );
  if (cancellable.length > 0) {
    const { error: cErr } = await supabase
      .from("rr_matches")
      .update({ status: "cancelled" })
      .in("id", cancellable.map((m) => m.id));
    if (cErr) throw cErr;
  }

  // Determine how many advance based on format
  const cfg = event.config as EventConfig;
  let numAdvancing: number;
  let includeBronze: boolean;
  if (event.format === "rr_final_bronze") {
    numAdvancing = 4;
    includeBronze = true;
  } else {
    // rr_knockout — slider determines depth. depth 1=top2, 2=top4, 3=top8, 4=top16
    const depth = cfg.knockout_depth ?? 2;
    numAdvancing = Math.pow(2, Math.max(1, Math.min(4, depth)));
    includeBronze = !!cfg.include_bronze;
  }

  // Compute standings to choose top N
  const allPlayerIds = eventPlayers
    .filter((ep) => !ep.withdrawn)
    .map((ep) => ep.player_id);
  const tiebreakers = (cfg.tiebreakers ??
    ["wins", "h2h", "point_diff", "points_for"]) as Tiebreaker[];
  const standings = computeStandings(allPlayerIds, matches, tiebreakers);

  // Cap to actually-available roster size
  numAdvancing = Math.min(numAdvancing, standings.length);
  if (numAdvancing < 2) {
    throw new Error("Not enough players to start a knockout");
  }

  const topSeeds = standings.slice(0, numAdvancing);
  const seedToPlayerId: Record<number, string> = {};
  topSeeds.forEach((s, idx) => {
    seedToPlayerId[idx + 1] = s.playerId;
  });

  // Special-case: rr_final_bronze produces top-2 final and top-3-vs-4 bronze
  // (no semis). Build directly.
  let inserts: Array<Partial<MatchRow> & { event_id: string }> = [];

  if (event.format === "rr_final_bronze") {
    // Final between seed 1 and seed 2
    inserts.push({
      event_id: eventId,
      stage: "final",
      knockout_round: "f",
      round: 1000, // big enough to come after RR rounds; we use a separate ordering anyway
      court: 1,
      side_a_player_ids: [seedToPlayerId[1]],
      side_b_player_ids: [seedToPlayerId[2]],
      status: "scheduled",
    });
    if (standings.length >= 4 && includeBronze) {
      inserts.push({
        event_id: eventId,
        stage: "bronze",
        knockout_round: "bronze",
        round: 1000,
        court: 2,
        side_a_player_ids: [seedToPlayerId[3]],
        side_b_player_ids: [seedToPlayerId[4]],
        status: "scheduled",
      });
    }
  } else {
    // Standard seeded bracket
    const specs = generateBracket(numAdvancing, includeBronze);
    // Find the first-round label (could be r16, qf, sf, or f based on size)
    const firstLabel = specs[0]?.knockout_round ?? "f";
    const roundOrder = ["r16", "qf", "sf", "f", "bronze"] as const;

    inserts = specs.map((spec, _idx) => {
      const isFirstRound = spec.knockout_round === firstLabel;
      const aPlayer = spec.side_a_seed
        ? [seedToPlayerId[spec.side_a_seed]]
        : [];
      const bPlayer = spec.side_b_seed
        ? [seedToPlayerId[spec.side_b_seed]]
        : [];

      // Stage
      const stage =
        spec.knockout_round === "f"
          ? "final"
          : spec.knockout_round === "bronze"
          ? "bronze"
          : "knockout";

      // Default to scheduled. Bye matches will be auto-advanced below.
      let status: MatchRow["status"] = "scheduled";
      let winner_side: MatchRow["winner_side"] = null;

      if (isFirstRound) {
        if (spec.bye_a && !spec.bye_b) {
          status = "completed";
          winner_side = "b";
        }
        if (spec.bye_b && !spec.bye_a) {
          status = "completed";
          winner_side = "a";
        }
      }

      return {
        event_id: eventId,
        stage,
        knockout_round: spec.knockout_round,
        round: 1000 + roundOrder.indexOf(spec.knockout_round) * 100 + spec.position,
        court: spec.position,
        side_a_player_ids: aPlayer,
        side_b_player_ids: bPlayer,
        status,
        winner_side,
        scores: null,
        completed_at:
          status === "completed" ? new Date().toISOString() : null,
      };
    });
  }

  let byesAutoAdvanced = 0;
  if (inserts.length > 0) {
    const { error: insErr } = await supabase
      .from("rr_matches")
      .insert(inserts);
    if (insErr) throw insErr;
    byesAutoAdvanced = inserts.filter((m) => m.status === "completed").length;

    // Cascade auto-completed byes into the next round
    if (byesAutoAdvanced > 0) {
      await advanceKnockoutWinners(eventId);
    }
  }

  return {
    matchesGenerated: inserts.length,
    byesAutoAdvanced,
    bronzeIncluded: includeBronze && (inserts.some((m) => m.stage === "bronze")),
  };
}

/**
 * After a knockout match completes, push winners into the next round's match.
 * Idempotent — safe to call multiple times.
 *
 * Should be called after every match save in the score-entry flow.
 */
export async function advanceKnockoutWinners(eventId: string): Promise<void> {
  const { data: matches, error } = await supabase
    .from("rr_matches")
    .select("*")
    .eq("event_id", eventId)
    .neq("stage", "group_rr");
  if (error) throw error;
  if (!matches) return;

  // Group matches by round
  const byRound = new Map<string, MatchRow[]>();
  for (const m of matches) {
    const k = m.knockout_round ?? "";
    if (!k) continue;
    const arr = byRound.get(k) ?? [];
    arr.push(m);
    byRound.set(k, arr);
  }

  // For each round (in order), if all matches complete, fill the next round
  const order = ["r16", "qf", "sf"] as const;
  for (const round of order) {
    const list = byRound.get(round) ?? [];
    if (list.length === 0) continue;
    const allComplete = list.every((m) => m.winner_side != null);
    if (!allComplete) continue;

    const next = nextRound(round);
    if (!next) continue;
    const nextList = (byRound.get(next) ?? []).sort(
      (a, b) => (a.court ?? 0) - (b.court ?? 0)
    );
    for (const nextMatch of nextList) {
      // Skip if both sides already filled
      if (nextMatch.side_a_player_ids.length > 0 && nextMatch.side_b_player_ids.length > 0) continue;

      const feeders = feederPositions(nextMatch.court ?? 1);
      const sortedList = [...list].sort(
        (a, b) => (a.court ?? 0) - (b.court ?? 0)
      );
      const aFeeder = sortedList.find((m) => m.court === feeders.a);
      const bFeeder = sortedList.find((m) => m.court === feeders.b);

      const winnerOf = (m?: MatchRow): string[] => {
        if (!m) return [];
        if (m.winner_side === "a") return m.side_a_player_ids;
        if (m.winner_side === "b") return m.side_b_player_ids;
        return [];
      };

      const aWinner = winnerOf(aFeeder);
      const bWinner = winnerOf(bFeeder);

      const update: Partial<MatchRow> = {};
      if (nextMatch.side_a_player_ids.length === 0 && aWinner.length > 0) {
        update.side_a_player_ids = aWinner;
      }
      if (nextMatch.side_b_player_ids.length === 0 && bWinner.length > 0) {
        update.side_b_player_ids = bWinner;
      }
      if (Object.keys(update).length > 0) {
        await supabase.from("rr_matches").update(update).eq("id", nextMatch.id);
      }
    }
  }

  // Bronze: needs the two semi losers
  const semis = byRound.get("sf") ?? [];
  const bronzeList = byRound.get("bronze") ?? [];
  if (semis.length === 2 && semis.every((m) => m.winner_side != null) && bronzeList.length === 1) {
    const bronze = bronzeList[0];
    if (
      bronze.side_a_player_ids.length === 0 ||
      bronze.side_b_player_ids.length === 0
    ) {
      const sortedSemis = [...semis].sort(
        (a, b) => (a.court ?? 0) - (b.court ?? 0)
      );
      const loserOf = (m: MatchRow): string[] => {
        if (m.winner_side === "a") return m.side_b_player_ids;
        if (m.winner_side === "b") return m.side_a_player_ids;
        return [];
      };
      const update: Partial<MatchRow> = {
        side_a_player_ids: loserOf(sortedSemis[0]),
        side_b_player_ids: loserOf(sortedSemis[1]),
      };
      await supabase.from("rr_matches").update(update).eq("id", bronze.id);
    }
  }
}
