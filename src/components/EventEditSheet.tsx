import { useEffect, useState, type ReactNode } from "react";
import { Check, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { EventConfig, EventRow, Series } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

interface EventEditSheetProps {
  open: boolean;
  onClose: () => void;
  event: EventRow;
  hasMatches: boolean;       // true if matches have been generated
  hasScores: boolean;        // true if any match has a recorded score
  onSaved: () => Promise<void> | void;
}

interface DraftEvent {
  name: string;
  sport: string;
  scheduledDate: string;
  numCourts: number;
  minRoundsPerPlayer: number;
  avoidBackToBack: boolean;
  avoidRecentMatchups: boolean;
  fillEmptyCourts: boolean;
  notes: string;
  seriesId: string;
}

function draftFrom(event: EventRow): DraftEvent {
  const cfg = event.config as EventConfig;
  return {
    name: event.name,
    sport: event.sport,
    scheduledDate: event.scheduled_date ?? "",
    numCourts: cfg.num_courts ?? 1,
    minRoundsPerPlayer: cfg.min_rounds_per_player ?? 0,
    avoidBackToBack: cfg.avoid_back_to_back ?? false,
    avoidRecentMatchups: cfg.avoid_recent_matchups ?? false,
    fillEmptyCourts: cfg.fill_empty_courts ?? false,
    notes: event.notes ?? "",
    seriesId: event.series_id ?? "",
  };
}

export function EventEditSheet({
  open,
  onClose,
  event,
  hasMatches,
  hasScores,
  onSaved,
}: EventEditSheetProps) {
  const [draft, setDraft] = useState<DraftEvent>(() => draftFrom(event));
  const [saving, setSaving] = useState(false);
  const [seriesOptions, setSeriesOptions] = useState<Series[]>([]);

  // Re-seed when the sheet opens for a fresh look at the event
  useEffect(() => {
    if (open) {
      setDraft(draftFrom(event));
      // Load series options
      (async () => {
        const { data } = await supabase
          .from("rr_series")
          .select("*")
          .order("name");
        setSeriesOptions(data ?? []);
      })();
    }
  }, [open, event]);

  const set = <K extends keyof DraftEvent>(key: K, value: DraftEvent[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const handleSave = async () => {
    if (saving) return;
    if (!draft.name.trim()) {
      toast.error("Name can't be empty.");
      return;
    }
    if (!draft.sport.trim()) {
      toast.error("Sport can't be empty.");
      return;
    }
    setSaving(true);
    try {
      const cfg = (event.config as EventConfig) ?? {};
      const newConfig: EventConfig = {
        ...cfg,
        num_courts: Math.max(1, draft.numCourts),
        avoid_back_to_back: draft.avoidBackToBack,
        avoid_recent_matchups: draft.avoidRecentMatchups,
        fill_empty_courts: draft.fillEmptyCourts,
      };
      if (draft.minRoundsPerPlayer && draft.minRoundsPerPlayer > 0) {
        newConfig.min_rounds_per_player = draft.minRoundsPerPlayer;
      } else {
        delete newConfig.min_rounds_per_player;
      }

      const { error } = await supabase
        .from("rr_events")
        .update({
          name: draft.name.trim(),
          sport: draft.sport.trim(),
          scheduled_date: draft.scheduledDate || null,
          notes: draft.notes.trim() || null,
          series_id: draft.seriesId || null,
          config: newConfig,
        })
        .eq("id", event.id);
      if (error) throw error;

      toast.success("Event updated");
      onClose();
      await onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Couldn't save", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Edit event"
      description="Some settings are locked once matches have been generated."
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
          <Button onClick={handleSave} disabled={saving} className="flex-1">
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Field label="Event name" htmlFor="ev-name">
          <Input
            id="ev-name"
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            autoFocus
          />
        </Field>

        <Field label="Sport" htmlFor="ev-sport">
          <Input
            id="ev-sport"
            value={draft.sport}
            onChange={(e) => set("sport", e.target.value)}
          />
        </Field>

        <Field label="Date" htmlFor="ev-date">
          <Input
            id="ev-date"
            type="date"
            value={draft.scheduledDate}
            onChange={(e) => set("scheduledDate", e.target.value)}
          />
        </Field>

        <Field label="How many courts or tables?" htmlFor="ev-courts">
          <Input
            id="ev-courts"
            type="number"
            inputMode="numeric"
            min={1}
            value={draft.numCourts}
            onChange={(e) => set("numCourts", Number(e.target.value))}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Affects how upcoming matches are split. Existing matches keep their court numbers.
          </p>
        </Field>

        <Field
          label="Cap on group-play rounds (optional)"
          htmlFor="ev-min-rounds"
        >
          <Input
            id="ev-min-rounds"
            type="number"
            inputMode="numeric"
            min={0}
            value={draft.minRoundsPerPlayer || ""}
            onChange={(e) =>
              set(
                "minRoundsPerPlayer",
                Math.max(0, Number(e.target.value) || 0)
              )
            }
            placeholder="Leave blank for full round-robin"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Hard cap on group-stage rounds. Leave blank for the full round-robin. Future rounds beyond the cap are removed when you save.
          </p>
        </Field>

        <button
          type="button"
          onClick={() =>
            set("avoidRecentMatchups", !draft.avoidRecentMatchups)
          }
          className={`flex w-full items-center justify-between rounded-lg border bg-background p-4 text-left transition-colors hover:bg-accent/40 ${
            draft.avoidRecentMatchups
              ? "border-primary ring-2 ring-primary/20"
              : ""
          }`}
        >
          <span className="min-w-0">
            <span className="block text-sm font-medium">
              Avoid recent matchups
            </span>
            <span className="block text-xs text-muted-foreground">
              Bias future scheduling against repeat partners or opponents.
            </span>
          </span>
          <span
            aria-hidden
            className={`ml-3 inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors ${
              draft.avoidRecentMatchups
                ? "border-primary bg-primary"
                : "border-input bg-muted"
            }`}
          >
            <span
              className={`h-5 w-5 rounded-full bg-card shadow-sm transition-transform ${
                draft.avoidRecentMatchups ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </span>
        </button>

        <button
          type="button"
          onClick={() => set("fillEmptyCourts", !draft.fillEmptyCourts)}
          className={`flex w-full items-center justify-between rounded-lg border bg-background p-4 text-left transition-colors hover:bg-accent/40 ${
            draft.fillEmptyCourts
              ? "border-primary ring-2 ring-primary/20"
              : ""
          }`}
        >
          <span className="min-w-0">
            <span className="block text-sm font-medium">Fill empty courts</span>
            <span className="block text-xs text-muted-foreground">
              Keep all courts busy by pulling in already-played players when needed. Some matchups will repeat.
            </span>
          </span>
          <span
            aria-hidden
            className={`ml-3 inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors ${
              draft.fillEmptyCourts
                ? "border-primary bg-primary"
                : "border-input bg-muted"
            }`}
          >
            <span
              className={`h-5 w-5 rounded-full bg-card shadow-sm transition-transform ${
                draft.fillEmptyCourts ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </span>
        </button>

        <button
          type="button"
          onClick={() => set("avoidBackToBack", !draft.avoidBackToBack)}
          className={`flex w-full items-center justify-between rounded-lg border bg-background p-4 text-left transition-colors hover:bg-accent/40 ${
            draft.avoidBackToBack
              ? "border-primary ring-2 ring-primary/20"
              : ""
          }`}
        >
          <span className="min-w-0">
            <span className="block text-sm font-medium">
              Avoid back-to-back matches
            </span>
            <span className="block text-xs text-muted-foreground">
              Push players who just played into a later sub-round when matches overflow available courts.
            </span>
          </span>
          <span
            aria-hidden
            className={`ml-3 inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors ${
              draft.avoidBackToBack
                ? "border-primary bg-primary"
                : "border-input bg-muted"
            }`}
          >
            <span
              className={`h-5 w-5 rounded-full bg-card shadow-sm transition-transform ${
                draft.avoidBackToBack ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </span>
        </button>

        <Field label="Series (optional)" htmlFor="ev-series">
          <Select
            id="ev-series"
            value={draft.seriesId}
            onChange={(e) => set("seriesId", e.target.value)}
          >
            <option value="">Standalone — not part of a series</option>
            {seriesOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            Group this event with others for cumulative standings.
          </p>
        </Field>

        <Field label="Notes (optional)" htmlFor="ev-notes">
          <Textarea
            id="ev-notes"
            value={draft.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Anything you want to remember"
          />
        </Field>

        <LockedSection
          hasMatches={hasMatches}
          hasScores={hasScores}
          event={event}
        />
      </div>
    </Sheet>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function LockedSection({
  hasMatches,
  hasScores,
  event,
}: {
  hasMatches: boolean;
  hasScores: boolean;
  event: EventRow;
}) {
  const items: { label: string; value: string; locked: boolean; reason?: string }[] = [
    {
      label: "Singles / Doubles",
      value: event.mode === "singles" ? "Singles" : "Doubles (rotating)",
      locked: hasMatches,
      reason: "Changing this would invalidate the existing schedule.",
    },
    {
      label: "Tournament format",
      value:
        event.format === "pure_rr"
          ? "Round robin only"
          : event.format === "rr_final_bronze"
          ? "Round robin → Final + Bronze"
          : "Round robin → Knockout",
      locked: hasMatches,
      reason: "Changing the format mid-event isn't supported yet.",
    },
    {
      label: "Scoring",
      value: scoringSummary(event),
      locked: hasScores,
      reason: "Locked once any match has a recorded score.",
    },
  ];

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Lock className="h-3 w-3" />
        Locked settings
      </div>
      <ul className="divide-y divide-border/60">
        {items.map((it) => (
          <li key={it.label} className="flex items-center justify-between gap-3 py-1.5">
            <div className="min-w-0">
              <div className="text-sm">{it.label}</div>
              <div className="truncate text-xs text-muted-foreground">{it.value}</div>
            </div>
            {it.locked && (
              <span
                className="text-xs text-muted-foreground"
                title={it.reason}
              >
                Locked
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function scoringSummary(event: EventRow): string {
  const t = event.scoring_template as { type: string } & Record<string, unknown>;
  if (!t || typeof t !== "object") return "—";
  if (t.type === "win_loss") return "Just win or lose";
  if (t.type === "first_to_points")
    return `First to ${t.points_to}, win by ${t.win_by}`;
  if (t.type === "best_of_sets")
    return `Best of ${t.sets} sets to ${t.set_to}`;
  if (t.type === "timed") return `Timed (${t.minutes} min)`;
  return "Custom";
}
