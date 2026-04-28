import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, CalendarPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { EventRow, EventStatus } from "@/types/database";
import { buttonVariants } from "@/components/ui/button";
import { EventCard } from "@/components/EventCard";
import { DeleteEventSheet } from "@/components/DeleteEventSheet";

const STATUS_ORDER: EventStatus[] = ["live", "draft", "completed", "archived"];

export default function EventsList() {
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [playerCounts, setPlayerCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [deleteEventId, setDeleteEventId] = useState<string | null>(null);

  const reload = async () => {
    const { data, error } = await supabase
      .from("rr_events")
      .select("*")
      .order("scheduled_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) {
      setError(error.message);
      toast.error("Couldn't load events", { description: error.message });
      return;
    }
    setEvents(data ?? []);
    const ids = (data ?? []).map((e) => e.id);
    if (ids.length > 0) {
      const { data: rows } = await supabase
        .from("rr_event_players")
        .select("event_id")
        .in("event_id", ids);
      const counts: Record<string, number> = {};
      for (const r of rows ?? []) {
        counts[r.event_id] = (counts[r.event_id] ?? 0) + 1;
      }
      setPlayerCounts(counts);
    } else {
      setPlayerCounts({});
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("rr_events")
        .select("*")
        .order("scheduled_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        setError(error.message);
        toast.error("Couldn't load events", { description: error.message });
        return;
      }
      setEvents(data ?? []);

      // Load player counts for badges on each card
      const ids = (data ?? []).map((e) => e.id);
      if (ids.length > 0) {
        const { data: rows } = await supabase
          .from("rr_event_players")
          .select("event_id")
          .in("event_id", ids);
        if (cancelled) return;
        const counts: Record<string, number> = {};
        for (const r of rows ?? []) {
          counts[r.event_id] = (counts[r.event_id] ?? 0) + 1;
        }
        setPlayerCounts(counts);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = (events ?? []).reduce<Record<EventStatus, EventRow[]>>(
    (acc, e) => {
      acc[e.status].push(e);
      return acc;
    },
    { live: [], draft: [], completed: [], archived: [] }
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl uppercase">Events</h1>
          <p className="text-sm text-muted-foreground">
            Tournaments, past and present
          </p>
        </div>
        {events && events.length > 0 && (
          <Link to="/events/new" className={buttonVariants({ size: "default" })}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New event</span>
            <span className="sm:hidden">New</span>
          </Link>
        )}
      </header>

      {/* Loading */}
      {events === null && !error && (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading events…</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm">
          <p className="font-medium text-destructive">Couldn't load events</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            Check that the migration ran in your Supabase project, and that
            VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.local are correct.
          </p>
        </div>
      )}

      {/* Empty state — explicit, prominent CTA */}
      {events && events.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-muted/30 px-6 py-16 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CalendarPlus className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold">No events yet</h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Create your first tournament to start tracking matches, scores, and
            ratings.
          </p>
          <Link
            to="/events/new"
            className={buttonVariants({ size: "lg", className: "mt-6" })}
          >
            <Plus className="h-5 w-5" />
            Create your first event
          </Link>
        </div>
      )}

      {/* Grouped list */}
      {events && events.length > 0 && (
        <div className="space-y-8">
          {STATUS_ORDER.map((status) => {
            const list = grouped[status];
            if (list.length === 0) return null;
            const isLive = status === "live";
            return (
              <section key={status}>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {labelForStatus(status)} · {list.length}
                </h2>
                {isLive ? (
                  // Bento layout: first live event spans both columns on desktop
                  <div className="grid gap-3 sm:grid-cols-2">
                    {list.map((e, idx) => (
                      <div
                        key={e.id}
                        className={
                          idx === 0 && list.length > 1
                            ? "sm:col-span-2"
                            : ""
                        }
                      >
                        <EventCard
                          event={e}
                          featured={idx === 0}
                          playerCount={playerCounts[e.id]}
                          onDelete={(id) => setDeleteEventId(id)}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {list.map((e) => (
                      <EventCard
                        key={e.id}
                        event={e}
                        playerCount={playerCounts[e.id]}
                        onDelete={(id) => setDeleteEventId(id)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <DeleteEventSheet
        open={deleteEventId !== null}
        onClose={() => setDeleteEventId(null)}
        event={events?.find((e) => e.id === deleteEventId) ?? null}
        onDeleted={reload}
      />
    </div>
  );
}

function labelForStatus(s: EventStatus): string {
  switch (s) {
    case "live":
      return "Live";
    case "draft":
      return "Drafts";
    case "completed":
      return "Completed";
    case "archived":
      return "Archived";
  }
}
