import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { EventRow } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { cn, formatDate } from "@/lib/utils";
import { backfillCompletedEventSeriesRatings } from "@/lib/liveRatings";

interface AssignEventsSheetProps {
  open: boolean;
  onClose: () => void;
  seriesId: string;
  seriesName: string;
  /** Currently-assigned events (to filter out / show as already in). */
  assignedEventIds: string[];
  onAssigned: () => Promise<void> | void;
}

/**
 * Bulk-assign events to a series. Lists every standalone event (not already
 * in any series) plus events from this series, and lets the user pick which
 * ones to keep / add.
 */
export function AssignEventsSheet({
  open,
  onClose,
  seriesId,
  seriesName,
  assignedEventIds,
  onAssigned,
}: AssignEventsSheetProps) {
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEvents(null);
    setPicked(new Set(assignedEventIds));
    (async () => {
      const { data, error } = await supabase
        .from("rr_events")
        .select("*")
        .or(`series_id.is.null,series_id.eq.${seriesId}`)
        .order("scheduled_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) {
        toast.error("Couldn't load events", { description: error.message });
        setEvents([]);
        return;
      }
      setEvents(data ?? []);
    })();
  }, [open, seriesId, assignedEventIds.join(",")]);

  const togglePick = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const { toAdd, toRemove, completedToAdd } = useMemo(() => {
    const assigned = new Set(assignedEventIds);
    const adds: string[] = [];
    const removes: string[] = [];
    for (const id of picked) if (!assigned.has(id)) adds.push(id);
    for (const id of assignedEventIds) if (!picked.has(id)) removes.push(id);
    const eventsById = new Map((events ?? []).map((e) => [e.id, e]));
    const completed = adds.filter((id) => {
      const e = eventsById.get(id);
      return e && (e.status === "completed" || e.status === "archived");
    });
    return { toAdd: adds, toRemove: removes, completedToAdd: completed };
  }, [picked, assignedEventIds, events]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const ops: any[] = [];
      if (toAdd.length > 0) {
        ops.push(
          supabase
            .from("rr_events")
            .update({ series_id: seriesId })
            .in("id", toAdd)
        );
      }
      if (toRemove.length > 0) {
        ops.push(
          supabase
            .from("rr_events")
            .update({ series_id: null })
            .in("id", toRemove)
        );
      }
      const results = (await Promise.all(ops)) as Array<{ error: unknown }>;
      for (const r of results) {
        if (r && typeof r === "object" && "error" in r && r.error) {
          throw new Error(String((r.error as { message?: string }).message ?? r.error));
        }
      }
      // Backfill series ratings for any completed events we just added.
      // recomputeLiveRatings early-returns on completed/archived, so without
      // this step their matches wouldn't show up in the series leaderboard.
      if (completedToAdd.length > 0) {
        await Promise.all(
          completedToAdd.map((id) => backfillCompletedEventSeriesRatings(id))
        );
      }
      toast.success("Series updated", {
        description:
          toAdd.length > 0 && toRemove.length > 0
            ? `Added ${toAdd.length}, removed ${toRemove.length}.`
            : toAdd.length > 0
            ? `Added ${toAdd.length} event${toAdd.length === 1 ? "" : "s"}.`
            : `Removed ${toRemove.length} event${toRemove.length === 1 ? "" : "s"}.`,
      });
      onClose();
      await onAssigned();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Couldn't update", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = toAdd.length > 0 || toRemove.length > 0;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Manage events in ${seriesName}`}
      description="Pick which events belong to this series. Events without a series are listed too."
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
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="flex-1"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {!hasChanges
              ? "No changes"
              : toAdd.length > 0 && toRemove.length === 0
              ? `Add ${toAdd.length}`
              : toAdd.length === 0 && toRemove.length > 0
              ? `Remove ${toRemove.length}`
              : `Apply ${toAdd.length + toRemove.length} change${
                  toAdd.length + toRemove.length === 1 ? "" : "s"
                }`}
          </Button>
        </div>
      }
    >
      {events === null && (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading events…</span>
        </div>
      )}

      {events && events.length === 0 && (
        <p className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          No standalone events to assign. Events in other series aren't shown — open them and re-assign from the event's edit sheet.
        </p>
      )}

      {completedToAdd.length > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {completedToAdd.length === 1 ? "1 completed event" : `${completedToAdd.length} completed events`}
            {" "}will join the series. Their matches will count toward series totals, but ratings can't be retroactively rebuilt in chronological order — players new to this series get a fresh series rating from these matches; players already in the series keep their existing rating.
          </span>
        </div>
      )}

      {events && events.length > 0 && (
        <ul className="divide-y rounded-md border">
          {events.map((e) => {
            const isPicked = picked.has(e.id);
            const wasAssigned = assignedEventIds.includes(e.id);
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => togglePick(e.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/40",
                    isPicked && "bg-primary/5"
                  )}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                        isPicked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background"
                      )}
                      aria-hidden
                    >
                      {isPicked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {e.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {e.sport}
                        {e.scheduled_date && ` · ${formatDate(e.scheduled_date)}`}
                        {wasAssigned && " · already in this series"}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
