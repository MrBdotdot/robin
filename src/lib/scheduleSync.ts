import { supabase } from "./supabase";
import { generateScheduleForMode, generateOneRotation } from "./scheduler";
import type { EventConfig, MatchRow } from "@/types/database";

type SeedingStrategy = "rating" | "random" | "order";

/**
 * Append just enough matches for every active player to play once more.
 *
 * - Singles with even player count: 1 Berger round.
 * - Singles with odd player count: 2 Berger rounds (rotation gets the
 *   sitter back in by round 2).
 * - Doubles where N is divisible by 4: typically 1 Berger round.
 * - Doubles otherwise: 2 Berger rounds.
 *
 * Press repeatedly to keep extending the event one rotation at a time.
 * Pairings will repeat across rotations — that's the cost of going beyond
 * the natural round-robin length.
 */
export async function appendOneRotation(
  eventId: string
): Promise<{ matchesAdded: number; rounds: number }> {
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
    return { matchesAdded: 0, rounds: 0 };
  }
  if (event.status === "completed" || event.status === "archived") {
    throw new Error("Event is closed — finalize undone or duplicate it first.");
  }

  const seeded = eventPlayers
    .filter((ep) => !ep.withdrawn)
    .sort(
      (a, b) =>
        (a.seed ?? 999) - (b.seed ?? 999) ||
        new Date(a.added_at).getTime() - new Date(b.added_at).getTime()
    )
    .map((ep) => ep.player_id);

  const cfg = event.config as EventConfig & { seeding_strategy?: SeedingStrategy };
  const strategy: SeedingStrategy = cfg.seeding_strategy ?? "order";
  const isDoubles = event.mode === "doubles_americano";

  let ratingsByPlayer = new Map<string, number>();
  if (strategy === "rating") {
    const { data: players } = await supabase
      .from("rr_players")
      .select("id, glicko_singles_rating, glicko_doubles_rating")
      .in("id", seeded);
    for (const p of players ?? []) {
      ratingsByPlayer.set(
        p.id,
        isDoubles ? p.glicko_doubles_rating : p.glicko_singles_rating
      );
    }
  }

  const activeIds = reseed(seeded, strategy, (id) =>
    ratingsByPlayer.get(id) ?? 1500
  );

  const minPlayers = isDoubles ? 4 : 2;
  if (activeIds.length < minPlayers) {
    throw new Error("Not enough active players to add more rounds.");
  }

  const numCourts = cfg.num_courts ?? 1;
  const newSchedule = generateOneRotation(event.mode, activeIds, {
    numCourts,
    avoidBackToBack: cfg.avoid_back_to_back ?? false,
    avoidRecentMatchups: cfg.avoid_recent_matchups ?? false,
    fillEmptyCourts: cfg.fill_empty_courts ?? false,
  });
  if (newSchedule.length === 0) {
    return { matchesAdded: 0, rounds: 0 };
  }

  const maxExistingRound = matches.reduce(
    (max, m) => (m.round > max ? m.round : max),
    0
  );

  const inserts = newSchedule.map((m) => ({
    event_id: eventId,
    stage: "group_rr" as const,
    round: maxExistingRound + m.round,
    court: m.court,
    side_a_player_ids: m.sideA,
    side_b_player_ids: m.sideB,
    status: "scheduled" as const,
  }));

  const { error: insErr } = await supabase
    .from("rr_matches")
    .insert(inserts);
  if (insErr) throw insErr;

  // If event was somehow back in draft, flip to live
  if (event.status === "draft") {
    await supabase
      .from("rr_events")
      .update({ status: "live", started_at: new Date().toISOString() })
      .eq("id", eventId);
  }

  const newTotalRounds = Math.max(
    ...inserts.map((r) => r.round),
    maxExistingRound
  );

  return { matchesAdded: inserts.length, rounds: newTotalRounds };
}

/**
 * After a substitution, push the substitute's other scheduled future matches
 * toward the back of the schedule. We do this by swapping each of their
 * future scheduled matches with the latest scheduled match that doesn't
 * involve them, as long as no double-booking would result.
 *
 * The match they were just substituted into is left alone (it's where
 * they're playing now). Already-completed and in-progress matches are
 * never touched.
 *
 * Returns the number of swaps performed (some may be skipped if they'd
 * cause a same-round conflict for either side).
 */
export async function pushPlayerToBack(
  eventId: string,
  playerId: string,
  excludeMatchId: string
): Promise<{ swapped: number }> {
  const { data, error } = await supabase
    .from("rr_matches")
    .select("*")
    .eq("event_id", eventId);
  if (error) throw error;
  if (!data) return { swapped: 0 };

  // Mutable in-memory copy so we can track round assignments across iterations
  const all = data.map((m) => ({ ...m }));

  // Player's other scheduled matches, earliest first
  const playerMatches = all
    .filter((m) => m.id !== excludeMatchId)
    .filter((m) => m.status === "scheduled" && m.stage === "group_rr")
    .filter(
      (m) =>
        m.side_a_player_ids.includes(playerId) ||
        m.side_b_player_ids.includes(playerId)
    )
    .sort((a, b) => a.round - b.round);

  if (playerMatches.length === 0) return { swapped: 0 };

  let swapped = 0;

  for (const pMatch of playerMatches) {
    // Latest scheduled match without this player, with round > pMatch.round
    const candidates = all
      .filter((m) => m.status === "scheduled" && m.stage === "group_rr")
      .filter(
        (m) =>
          !m.side_a_player_ids.includes(playerId) &&
          !m.side_b_player_ids.includes(playerId)
      )
      .filter((m) => m.round > pMatch.round)
      .sort((a, b) => b.round - a.round);

    let target: (typeof all)[number] | undefined;

    for (const c of candidates) {
      // Conflict: would the player end up in two matches in c.round?
      const playerAlreadyInTargetRound = all.some(
        (m) =>
          m.id !== c.id &&
          m.round === c.round &&
          m.status === "scheduled" &&
          (m.side_a_player_ids.includes(playerId) ||
            m.side_b_player_ids.includes(playerId))
      );
      if (playerAlreadyInTargetRound) continue;

      // Conflict: would any of c's players end up in two matches in pMatch.round?
      const cPlayers = [...c.side_a_player_ids, ...c.side_b_player_ids];
      const cPlayerInSourceRound = all.some(
        (m) =>
          m.id !== pMatch.id &&
          m.round === pMatch.round &&
          m.status === "scheduled" &&
          (m.side_a_player_ids.some((id) => cPlayers.includes(id)) ||
            m.side_b_player_ids.some((id) => cPlayers.includes(id)))
      );
      if (cPlayerInSourceRound) continue;

      target = c;
      break;
    }

    if (!target) continue;

    // Persist the swap. Use a sentinel round to avoid a unique-violation if
    // a constraint is ever added later.
    const SENTINEL = -1;
    const oldPRound = pMatch.round;
    const oldTRound = target.round;

    const r1 = await supabase
      .from("rr_matches")
      .update({ round: SENTINEL })
      .eq("id", pMatch.id);
    if (r1.error) throw r1.error;

    const r2 = await supabase
      .from("rr_matches")
      .update({ round: oldPRound })
      .eq("id", target.id);
    if (r2.error) throw r2.error;

    const r3 = await supabase
      .from("rr_matches")
      .update({ round: oldTRound })
      .eq("id", pMatch.id);
    if (r3.error) throw r3.error;

    // Reflect in local cache for subsequent iterations
    pMatch.round = oldTRound;
    target.round = oldPRound;

    swapped++;
  }

  return { swapped };
}

function reseed(
  ids: string[],
  strategy: SeedingStrategy,
  ratingOf: (id: string) => number
): string[] {
  if (strategy === "rating") {
    return [...ids].sort((a, b) => ratingOf(b) - ratingOf(a));
  }
  if (strategy === "random") {
    const arr = [...ids];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  return ids;
}

export interface SyncResult {
  deleted: number;
  created: number;
  totalRounds: number;
  message: string;
}

/**
 * Regenerate the future portion of an event's schedule based on the current
 * active (non-withdrawn) roster.
 *
 * Behavior:
 *   - Completed and in-progress matches are kept untouched.
 *   - Scheduled, forfeit, walkover, and cancelled matches are deleted.
 *   - A fresh schedule is generated for the active roster.
 *   - New round numbers are offset so they start after the last "frozen"
 *     (completed or in-progress) round. If nothing has been played yet, the
 *     new schedule starts at round 1 — fully replacing the old.
 *
 * Use this after roster changes (add players, court count change). On
 * withdrawals we forfeit instead, so don't call this there unless you want
 * forfeits to be wiped.
 */
export async function regenerateFutureSchedule(
  eventId: string
): Promise<SyncResult> {
  const [
    { data: event, error: eErr },
    { data: eventPlayers, error: epErr },
    { data: matches, error: mErr },
  ] = await Promise.all([
    supabase.from("rr_events").select("*").eq("id", eventId).single(),
    supabase.from("rr_event_players").select("*").eq("event_id", eventId),
    supabase.from("rr_matches").select("*").eq("event_id", eventId),
  ]);

  if (eErr) throw eErr;
  if (epErr) throw epErr;
  if (mErr) throw mErr;
  if (!event || !eventPlayers || !matches) {
    return { deleted: 0, created: 0, totalRounds: 0, message: "Nothing to do." };
  }

  // Don't touch completed/archived events
  if (event.status === "completed" || event.status === "archived") {
    return {
      deleted: 0,
      created: 0,
      totalRounds: 0,
      message: "Event is closed — schedule preserved.",
    };
  }

  const seedOrdered = eventPlayers
    .filter((ep) => !ep.withdrawn)
    .sort(
      (a, b) =>
        (a.seed ?? 999) - (b.seed ?? 999) ||
        new Date(a.added_at).getTime() - new Date(b.added_at).getTime()
    )
    .map((ep) => ep.player_id);

  // Apply seeding strategy from event config (falls back to "order")
  const cfg = event.config as EventConfig & { seeding_strategy?: SeedingStrategy };
  const strategy: SeedingStrategy = cfg.seeding_strategy ?? "order";
  const isDoubles = event.mode === "doubles_americano";

  let ratingsByPlayer = new Map<string, number>();
  if (strategy === "rating") {
    const { data: players } = await supabase
      .from("rr_players")
      .select("id, glicko_singles_rating, glicko_doubles_rating")
      .in("id", seedOrdered);
    for (const p of players ?? []) {
      ratingsByPlayer.set(
        p.id,
        isDoubles ? p.glicko_doubles_rating : p.glicko_singles_rating
      );
    }
  }

  const activeIds = reseed(seedOrdered, strategy, (id) =>
    ratingsByPlayer.get(id) ?? 1500
  );

  const minPlayers = isDoubles ? 4 : 2;

  // Frozen = stays no matter what
  const frozen: MatchRow[] = matches.filter(
    (m) => m.status === "completed" || m.status === "in_progress"
  );
  // Discardable = scheduled / forfeit / walkover / cancelled
  const discardable: MatchRow[] = matches.filter(
    (m) =>
      m.status === "scheduled" ||
      m.status === "forfeit_a" ||
      m.status === "forfeit_b" ||
      m.status === "walkover" ||
      m.status === "cancelled"
  );

  const maxFrozenRound =
    frozen.length > 0 ? Math.max(...frozen.map((m) => m.round)) : 0;

  let deleted = 0;
  let created = 0;

  if (discardable.length > 0) {
    const { error: delErr } = await supabase
      .from("rr_matches")
      .delete()
      .in("id", discardable.map((m) => m.id));
    if (delErr) throw delErr;
    deleted = discardable.length;
  }

  let totalRounds = maxFrozenRound;

  if (activeIds.length >= minPlayers) {
    const cfgFull = event.config as EventConfig;
    const numCourts = cfgFull.num_courts ?? 1;
    const newSchedule = generateScheduleForMode(event.mode, activeIds, {
      numCourts,
      avoidBackToBack: cfgFull.avoid_back_to_back ?? false,
      avoidRecentMatchups: cfgFull.avoid_recent_matchups ?? false,
      fillEmptyCourts: cfgFull.fill_empty_courts ?? false,
    });

    if (newSchedule.length > 0) {
      const insertRows = newSchedule.map((m) => ({
        event_id: eventId,
        stage: "group_rr" as const,
        round: maxFrozenRound + m.round,
        court: m.court,
        side_a_player_ids: m.sideA,
        side_b_player_ids: m.sideB,
        status: "scheduled" as const,
      }));

      const { error: insErr } = await supabase
        .from("rr_matches")
        .insert(insertRows);
      if (insErr) throw insErr;

      created = insertRows.length;
      totalRounds = Math.max(...insertRows.map((r) => r.round));
    }
  }

  // If the event was already 'live', keep it. If still 'draft' but now has matches,
  // flip to live (mirrors the manual "Generate schedule" flow).
  if (event.status === "draft" && created > 0) {
    await supabase
      .from("rr_events")
      .update({ status: "live", started_at: new Date().toISOString() })
      .eq("id", eventId);
  }

  const message =
    created === 0 && deleted === 0
      ? "Schedule unchanged."
      : `${created} match${created === 1 ? "" : "es"} scheduled across ${totalRounds} round${totalRounds === 1 ? "" : "s"}${deleted > 0 ? ` (${deleted} replaced)` : ""}.`;

  return { deleted, created, totalRounds, message };
}
