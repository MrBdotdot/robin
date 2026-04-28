import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Flag, AlertTriangle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { EventRow, MatchRow } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { finalizeEvent, describeFinalize } from "@/lib/finalizeEvent";

interface FinalizeEventSheetProps {
  open: boolean;
  onClose: () => void;
  event: EventRow;
  matches: MatchRow[];
  onFinalized: () => Promise<void> | void;
}

export function FinalizeEventSheet({
  open,
  onClose,
  event,
  matches,
  onFinalized,
}: FinalizeEventSheetProps) {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);

  const completed = matches.filter((m) => m.status === "completed").length;
  const forfeit = matches.filter(
    (m) =>
      m.status === "forfeit_a" ||
      m.status === "forfeit_b" ||
      m.status === "walkover"
  ).length;
  const remaining = matches.filter(
    (m) => m.status === "scheduled" || m.status === "in_progress"
  ).length;

  const handleFinalize = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await finalizeEvent(event.id);
      toast.success("Event finalized", { description: describeFinalize(result) });
      onClose();
      await onFinalized();
      // Stay on the event page so the user sees the final standings
      navigate(`/events/${event.id}`, { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Couldn't finalize event", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Finalize event"
      description="Lock in the final standings and update player ratings."
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
            onClick={handleFinalize}
            disabled={saving}
            className="flex-1"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Finalize event
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <SummaryCell label="Completed" value={completed} />
          <SummaryCell label="Forfeits" value={forfeit} />
          <SummaryCell
            label="Unplayed"
            value={remaining}
            highlight={remaining > 0}
          />
        </div>

        {remaining > 0 && (
          <div className="flex items-start gap-3 rounded-md border border-forfeit/40 bg-forfeit/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-forfeit-foreground/80" />
            <div className="text-foreground/90">
              <p className="font-medium">
                {remaining} match{remaining === 1 ? "" : "es"} haven't been played.
              </p>
              <p className="mt-1 text-muted-foreground">
                They'll be cancelled when you finalize. Cancelled matches don't affect ratings or standings.
              </p>
            </div>
          </div>
        )}

        <div className="rounded-lg border bg-muted/30 p-4 text-sm">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            What this does
          </h4>
          <ul className="space-y-1.5 text-muted-foreground">
            <li className="flex gap-2">
              <span className="text-foreground">•</span>
              <span>
                Updates each player's{" "}
                <span className="font-medium text-foreground">
                  {event.mode === "singles" ? "singles" : "doubles"} rating
                </span>{" "}
                based on completed matches.
              </span>
            </li>
            {event.mode === "doubles_americano" && (
              <li className="flex gap-2">
                <span className="text-foreground">•</span>
                <span>Updates each pair's <span className="font-medium text-foreground">partnership rating</span>.</span>
              </li>
            )}
            <li className="flex gap-2">
              <span className="text-foreground">•</span>
              <span>Writes a rating-history snapshot for every player who played.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-foreground">•</span>
              <span>Computes <span className="font-medium text-foreground">final ranks</span> using your tiebreakers.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-foreground">•</span>
              <span>Marks the event <span className="font-medium text-foreground">completed</span> and locks future edits.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-foreground">•</span>
              <span className="text-muted-foreground/80">
                Forfeits and walkovers don't affect ratings.
              </span>
            </li>
          </ul>
        </div>

        {completed === 0 && (
          <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <Flag className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="text-foreground/90">
              <p className="font-medium">No completed matches.</p>
              <p className="mt-1 text-muted-foreground">
                You can still finalize, but no ratings will change.
              </p>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function SummaryCell({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border bg-background p-3 text-center ${
        highlight ? "border-forfeit/60 bg-forfeit/5" : ""
      }`}
    >
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
