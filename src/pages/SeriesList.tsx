import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  Loader2,
  Layers,
  ChevronRight,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { Series } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet } from "@/components/ui/sheet";
import { formatDate } from "@/lib/utils";

export default function SeriesList() {
  const [series, setSeries] = useState<Series[] | null>(null);
  const [eventCounts, setEventCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setError(null);
    const { data, error: sErr } = await supabase
      .from("rr_series")
      .select("*")
      .order("starts_on", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (sErr) {
      setError(sErr.message);
      toast.error("Couldn't load series", { description: sErr.message });
      return;
    }
    setSeries(data ?? []);

    // Event counts per series
    const ids = (data ?? []).map((s) => s.id);
    if (ids.length > 0) {
      const { data: rows } = await supabase
        .from("rr_events")
        .select("series_id")
        .in("series_id", ids);
      const counts: Record<string, number> = {};
      for (const r of rows ?? []) {
        if (r.series_id) counts[r.series_id] = (counts[r.series_id] ?? 0) + 1;
      }
      setEventCounts(counts);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl uppercase">Series</h1>
          <p className="text-sm text-muted-foreground">
            Group events into a league or season for cumulative standings.
          </p>
        </div>
        {series && series.length > 0 && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New series
          </Button>
        )}
      </header>

      {series === null && !error && (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm">
          <p className="font-medium text-destructive">Couldn't load series</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
        </div>
      )}

      {series && series.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-muted/30 px-6 py-16 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Layers className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold">No series yet</h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Create a series to group multiple events together with cumulative
            standings — leagues, seasons, weekly meet-ups.
          </p>
          <Button size="lg" className="mt-6" onClick={() => setCreating(true)}>
            <Plus className="h-5 w-5" />
            Create your first series
          </Button>
        </div>
      )}

      {series && series.length > 0 && (
        <Card className="overflow-hidden">
          <ul className="divide-y">
            {series.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/series/${s.id}`}
                  className="group flex items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-accent/30"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {s.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {eventCounts[s.id] ?? 0} event
                      {(eventCounts[s.id] ?? 0) === 1 ? "" : "s"}
                      {s.starts_on && ` · starts ${formatDate(s.starts_on)}`}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <CreateSeriesSheet
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={load}
      />
    </div>
  );
}

function CreateSeriesSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [endless, setEndless] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setStartsOn(new Date().toISOString().slice(0, 10));
      setEndsOn("");
      setEndless(false);
    }
  }, [open]);

  const handleCreate = async () => {
    if (saving) return;
    if (!name.trim()) {
      toast.error("Name can't be empty.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("rr_series").insert({
        name: name.trim(),
        description: description.trim() || null,
        starts_on: startsOn || null,
        ends_on: endless ? null : endsOn || null,
      });
      if (error) throw error;
      toast.success("Series created");
      onClose();
      await onCreated();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Couldn't create series", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New series"
      description="A series groups events together for cumulative standings."
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
          <Button onClick={handleCreate} disabled={saving} className="flex-1">
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Create
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="series-name">Series name</Label>
          <Input
            id="series-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Spring 2026 Pickleball League"
            autoFocus
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="series-start">Starts</Label>
            <Input
              id="series-start"
              type="date"
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="series-end">Ends</Label>
            <Input
              id="series-end"
              type="date"
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
              disabled={endless}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setEndless(!endless)}
          className={`flex w-full items-center justify-between rounded-lg border bg-background p-4 text-left transition-colors hover:bg-accent/40 ${
            endless ? "border-primary ring-2 ring-primary/20" : ""
          }`}
        >
          <span className="min-w-0">
            <span className="block text-sm font-medium">Endless mode</span>
            <span className="block text-xs text-muted-foreground">
              No end date — for ongoing pickup groups that meet on a recurring basis. Add events forever; cumulative standings keep growing.
            </span>
          </span>
          <span
            aria-hidden
            className={`ml-3 inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors ${
              endless
                ? "border-primary bg-primary"
                : "border-input bg-muted"
            }`}
          >
            <span
              className={`h-5 w-5 rounded-full bg-card shadow-sm transition-transform ${
                endless ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </span>
        </button>
        <div className="space-y-1.5">
          <Label htmlFor="series-desc">Description (optional)</Label>
          <Textarea
            id="series-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Anything you want to remember"
          />
        </div>
      </div>
    </Sheet>
  );
}
