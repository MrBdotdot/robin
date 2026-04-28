import { supabase } from "@/lib/supabase";
import { generateScheduleForMode } from "@/lib/scheduler";
import type { EventConfig, ScoringTemplate } from "@/types/database";
import type { WizardState } from "./types";

interface ExistingPlayer {
  id: string;
  full_name: string;
  glicko_singles_rating: number;
  glicko_singles_rd: number;
  glicko_singles_vol: number;
  glicko_doubles_rating: number;
  glicko_doubles_rd: number;
  glicko_doubles_vol: number;
}

function buildScoring(s: WizardState): ScoringTemplate {
  if (s.scoringType === "first_to_points") {
    return { type: "first_to_points", points_to: s.pointsTo, win_by: s.winBy };
  }
  if (s.scoringType === "best_of_sets") {
    return {
      type: "best_of_sets",
      sets: s.setsBestOf,
      set_to: s.setTo,
      win_by: s.winBy,
    };
  }
  if (s.scoringType === "win_loss") return { type: "win_loss" };
  if (s.scoringType === "timed") return { type: "timed", minutes: 15 };
  return { type: "custom", fields: [] };
}

function buildConfig(s: WizardState): EventConfig & { seeding_strategy?: string } {
  const config: EventConfig & { seeding_strategy?: string } = {
    num_courts: s.numCourts,
    tiebreakers: s.tiebreakers as EventConfig["tiebreakers"],
    seeding_strategy: s.seedingStrategy,
    avoid_back_to_back: s.avoidBackToBack,
    avoid_recent_matchups: s.avoidRecentMatchups,
    fill_empty_courts: s.fillEmptyCourts,
  };
  if (s.format === "rr_knockout") {
    config.knockout_depth = s.knockoutDepth;
    config.num_groups = s.numGroups;
    config.advance_per_group = s.advancePerGroup;
    config.include_bronze = true;
  }
  if (s.format === "rr_final_bronze") {
    config.include_bronze = true;
  }
  return config;
}

function orderPlayerNames(
  names: string[],
  existingMap: Map<string, ExistingPlayer | { id: string; full_name: string }>,
  s: WizardState
): string[] {
  const isDoubles = s.mode === "doubles_americano";
  if (s.seedingStrategy === "rating") {
    return [...names].sort((a, b) => {
      const ra = existingMap.get(a) as ExistingPlayer | undefined;
      const rb = existingMap.get(b) as ExistingPlayer | undefined;
      const va = ra
        ? isDoubles
          ? ra.glicko_doubles_rating
          : ra.glicko_singles_rating
        : 1500;
      const vb = rb
        ? isDoubles
          ? rb.glicko_doubles_rating
          : rb.glicko_singles_rating
        : 1500;
      return vb - va;
    });
  }
  if (s.seedingStrategy === "random") {
    const shuffled = [...names];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
  return names;
}

/**
 * Run the full wizard submit pipeline:
 *  1. Insert event row.
 *  2. Look up / create players, capture rating snapshots.
 *  3. Insert event_player rows in seed order.
 *  4. Auto-generate the schedule + flip event to live.
 *
 * Returns the new event's id on success.
 */
export async function submitWizard(s: WizardState): Promise<string> {
  const scoring = buildScoring(s);
  const config = buildConfig(s);

  // 1. Create the event
  const { data: eventRow, error: evErr } = await supabase
    .from("rr_events")
    .insert({
      name: s.name.trim(),
      sport: s.sportLabel.trim(),
      mode: s.mode,
      format: s.format,
      scoring_template: scoring,
      config,
      status: "draft",
      scheduled_date: s.scheduledDate || null,
      notes: s.notes.trim() || null,
    })
    .select("*")
    .single();
  if (evErr || !eventRow) throw evErr ?? new Error("Failed to create event");

  // 2. Players
  const trimmed = s.playerNames.map((n) => n.trim()).filter(Boolean);
  let playerIds: string[] = [];
  if (trimmed.length > 0) {
    const { data: existing } = await supabase
      .from("rr_players")
      .select(
        "id, full_name, glicko_singles_rating, glicko_singles_rd, glicko_singles_vol, glicko_doubles_rating, glicko_doubles_rd, glicko_doubles_vol"
      )
      .in("full_name", trimmed);
    const existingMap = new Map<string, ExistingPlayer>(
      (existing ?? []).map((p) => [p.full_name, p as ExistingPlayer])
    );

    const toCreate = trimmed.filter((n) => !existingMap.has(n));
    if (toCreate.length > 0) {
      const { data: created, error: createErr } = await supabase
        .from("rr_players")
        .insert(toCreate.map((full_name) => ({ full_name })))
        .select(
          "id, full_name, glicko_singles_rating, glicko_singles_rd, glicko_singles_vol, glicko_doubles_rating, glicko_doubles_rd, glicko_doubles_vol"
        );
      if (createErr) throw createErr;
      for (const p of created ?? []) existingMap.set(p.full_name, p as ExistingPlayer);
    }

    const orderedNames = orderPlayerNames(trimmed, existingMap, s);
    playerIds = orderedNames
      .map((n) => existingMap.get(n)?.id)
      .filter(Boolean) as string[];

    // 3. event_player rows with rating snapshots
    const rows = playerIds.map((player_id, idx) => {
      const fromName = orderedNames[idx];
      const found = existingMap.get(fromName);
      const snapshot = found
        ? {
            singles: {
              rating: found.glicko_singles_rating,
              rd: found.glicko_singles_rd,
              vol: found.glicko_singles_vol,
            },
            doubles: {
              rating: found.glicko_doubles_rating,
              rd: found.glicko_doubles_rd,
              vol: found.glicko_doubles_vol,
            },
          }
        : null;
      return {
        event_id: eventRow.id,
        player_id,
        seed: idx + 1,
        initial_rating_snapshot: snapshot,
      };
    });
    const { error: epErr } = await supabase
      .from("rr_event_players")
      .insert(rows);
    if (epErr) throw epErr;
  }

  // 4. Auto-generate schedule and flip to live
  const minPlayers = s.mode === "doubles_americano" ? 4 : 2;
  if (playerIds.length >= minPlayers) {
    try {
      const schedule = generateScheduleForMode(s.mode, playerIds, {
        numCourts: s.numCourts,
        avoidBackToBack: s.avoidBackToBack,
        avoidRecentMatchups: s.avoidRecentMatchups,
        fillEmptyCourts: s.fillEmptyCourts,
      });
      if (schedule.length > 0) {
        const matchRows = schedule.map((m) => ({
          event_id: eventRow.id,
          stage: "group_rr" as const,
          round: m.round,
          court: m.court,
          side_a_player_ids: m.sideA,
          side_b_player_ids: m.sideB,
          status: "scheduled" as const,
        }));
        const { error: insMatchErr } = await supabase
          .from("rr_matches")
          .insert(matchRows);
        if (insMatchErr) throw insMatchErr;
        await supabase
          .from("rr_events")
          .update({ status: "live", started_at: new Date().toISOString() })
          .eq("id", eventRow.id);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("Auto-schedule failed", err);
    }
  }

  return eventRow.id;
}
