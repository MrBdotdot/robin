import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles, AlertTriangle, Trophy } from "lucide-react";
import { toast } from "sonner";
import type {
  EventConfig,
  EventPlayer,
  EventRow,
  MatchRow,
  Player,
} from "@/types/database";
import { computeStandings, type Tiebreaker } from "@/lib/standings";
import { startKnockout } from "@/lib/startKnockout";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";

interface StartKnockoutSheetProps {
  open: boolean;
  onClose: () => void;
  event: EventRow;
  matches: MatchRow[];
  eventPlayers: EventPlayer[];
  playersById: Record<string, Player>;
  onStarted: () => Promise<void> | void;
}

export function StartKnockoutSheet({
  open,
  onClose,
  event,
  matches,
  eventPlayers,
  playersById,
  onStarted,
}: StartKnockoutSheetProps) {
  const [saving, setSaving] = useState(false);

  const cfg = event.config as EventConfig;
  const tiebreakers = (cfg.tiebreakers ??
    ["wins", "h2h", "point_diff", "points_for"]) as Tiebreaker[];

  const standings = useMemo(() => {
    if (!open) return [];
    const allPlayerIds = eventPlayers
      .filter((ep) => !ep.withdrawn)
      .map((ep) => ep.player_id);
    return computeStandings(allPlayerIds, matches, tiebreakers);
  }, [open, eventPlayers, matches, tiebreakers]);

  const numAdvancing = useMemo(() => {
    if (event.format === "rr_final_bronze") return 4;
    const depth = cfg.knockout_depth ?? 2;
    return Math.pow(2, Math.max(1, Math.min(4, depth)));
  }, [event, cfg]);

  useEffect(() => {
    // No-op effect to silence unused; could be used to refresh data later
  }, [open]);

  const remaining = matches.filter(
    (m) =>
      m.stage === "group_rr" &&
      (m.status === "scheduled" || m.status === "in_progress")
  ).length;

  const advancing = standings.slice(0, Math.min(numAdvancing, standings.length));

  const handleStart = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await startKnockout(event.id);
      const parts = [
        `${result.matchesGenerated} bracket match${result.matchesGenerated === 1 ? "" : "es"} created`,
      ];
      if (result.byesAutoAdvanced > 0) {
        parts.push(`${result.byesAutoAdvanced} bye${result.byesAutoAdvanced === 1 ? "" : "s"} auto-advanced`);
      }
      toast.success("Playoffs started", { description: parts.join(" · ") });
      onClose();
      await onStarted();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Couldn't start playoffs", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Start playoffs"
      description={
        event.format === "rr_final_bronze"
          ? "Top 2 play the final. 3rd and 4th play for bronze."
          : `Top ${numAdvancing} advance to a single-elimination bracket.`
      }
      footer={
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={saving}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={handleStart}
            disabled={saving || advancing.length < 2}
            className="flex-1"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Start playoffs
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {remaining > 0 && (
          <div className="flex items-start gap-3 rounded-md border border-forfeit/40 bg-forfeit/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-forfeit-foreground/80" />
            <div>
              <p className="font-medium">
                {remaining} round-robin match{remaining === 1 ? "" : "es"} unplayed.
              </p>
              <p className="mt-1 text-muted-foreground">
                They'll be cancelled. Cancelled matches don't affect ratings or standings.
              </p>
            </div>
          </div>
        )}

        {/* Who advances */}
        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Trophy className="h-3 w-3" />
            Advancing to playoffs
          </h4>
          {advancing.length === 0 ? (
            <p className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-center text-sm text-muted-foreground">
              No standings yet — at least 2 completed matches needed.
            </p>
          ) : (
            <ol className="divide-y rounded-md border">
              {advancing.map((s) => (
                <li
                  key={s.playerId}
                  className="flex items-center justify-between px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      #{s.rank}
                    </span>
                    <span>{playersById[s.playerId]?.full_name ?? "Unknown"}</span>
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {s.wins}–{s.losses}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {advancing.length < numAdvancing && advancing.length >= 2 && (
          <p className="text-xs text-muted-foreground">
            Only {advancing.length} player{advancing.length === 1 ? "" : "s"} eligible — bracket will be sized to fit.
          </p>
        )}
      </div>
    </Sheet>
  );
}
