import { supabase } from "./supabase";
import type { EventConfig, EventRow, ScoringTemplate } from "@/types/database";

/**
 * Duplicate an event into a fresh draft. Copies scoring, format, mode,
 * config, notes, sport label. Optionally copies the roster too.
 *
 * Returns the new event's ID.
 */
export async function cloneEvent(
  sourceEventId: string,
  options: { includeRoster: boolean; newName?: string; newDate?: string | null }
): Promise<string> {
  // Load source
  const { data: source, error: srcErr } = await supabase
    .from("rr_events")
    .select("*")
    .eq("id", sourceEventId)
    .single();
  if (srcErr) throw srcErr;
  if (!source) throw new Error("Source event not found");

  const ev = source as EventRow;

  const insertPayload = {
    name: options.newName ?? `${ev.name} (copy)`,
    sport: ev.sport,
    mode: ev.mode,
    format: ev.format,
    scoring_template: ev.scoring_template as ScoringTemplate,
    config: ev.config as EventConfig,
    status: "draft" as const,
    scheduled_date:
      options.newDate !== undefined ? options.newDate : null,
    notes: ev.notes,
  };

  const { data: created, error: insErr } = await supabase
    .from("rr_events")
    .insert(insertPayload)
    .select("*")
    .single();
  if (insErr) throw insErr;
  if (!created) throw new Error("Couldn't create cloned event");

  // Optionally copy roster
  if (options.includeRoster) {
    const { data: src_eps, error: epErr } = await supabase
      .from("rr_event_players")
      .select("*")
      .eq("event_id", sourceEventId);
    if (epErr) throw epErr;
    if (src_eps && src_eps.length > 0) {
      const rows = src_eps.map((ep) => ({
        event_id: created.id,
        player_id: ep.player_id,
        seed: ep.seed,
        joined_at_round: 0,
        withdrawn: false,
      }));
      const { error: insEpsErr } = await supabase
        .from("rr_event_players")
        .insert(rows);
      if (insEpsErr) throw insEpsErr;
    }
  }

  return created.id;
}
