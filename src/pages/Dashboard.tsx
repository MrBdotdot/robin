import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Layers, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { EventRow } from "@/types/database";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EventCard } from "@/components/EventCard";
import { cn, formatDate } from "@/lib/utils";

const RECENT_LIMIT = 4;

export default function Dashboard() {
  const [liveEvents, setLiveEvents] = useState<EventRow[] | null>(null);
  const [recentEvents, setRecentEvents] = useState<EventRow[] | null>(null);
  const [draftCount, setDraftCount] = useState<number | null>(null);
  const [playerCounts, setPlayerCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [liveRes, recentRes, draftRes] = await Promise.all([
        supabase
          .from("rr_events")
          .select("*")
          .eq("status", "live")
          .order("started_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false }),
        supabase
          .from("rr_events")
          .select("*")
          .eq("status", "completed")
          .order("completed_at", { ascending: false, nullsFirst: false })
          .limit(RECENT_LIMIT),
        supabase
          .from("rr_events")
          .select("id", { count: "exact", head: true })
          .eq("status", "draft"),
      ]);

      if (cancelled) return;

      if (liveRes.error || recentRes.error || draftRes.error) {
        const msg =
          liveRes.error?.message ??
          recentRes.error?.message ??
          draftRes.error?.message ??
          "Unknown error";
        setError(msg);
        toast.error("Couldn't load dashboard", { description: msg });
        return;
      }

      const live = liveRes.data ?? [];
      const recent = recentRes.data ?? [];
      setLiveEvents(live);
      setRecentEvents(recent);
      setDraftCount(draftRes.count ?? 0);

      const ids = [...live, ...recent].map((e) => e.id);
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

  const loading =
    liveEvents === null || recentEvents === null || draftCount === null;
  const isEmpty =
    !loading &&
    (liveEvents?.length ?? 0) === 0 &&
    (recentEvents?.length ?? 0) === 0 &&
    (draftCount ?? 0) === 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6">
        <h1 className="text-3xl uppercase">Round Robin</h1>
        <p className="text-sm text-muted-foreground">
          {loading
            ? "Loading…"
            : isEmpty
              ? "Spin up your first tournament to get started."
              : "Pick up where you left off."}
        </p>
      </header>

      {error && (
        <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm">
          <p className="font-medium text-destructive">Couldn't load dashboard</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
        </div>
      )}

      {loading && !error && (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Quick actions */}
          <div className="mb-8 flex flex-col gap-2 sm:flex-row">
            <Link
              to="/events/new"
              className={cn(
                buttonVariants({ size: "lg" }),
                "flex-1 sm:flex-[2]"
              )}
            >
              <Plus className="h-5 w-5" />
              New event
            </Link>
            <Link
              to="/events"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "flex-1"
              )}
            >
              <CalendarDays className="h-4 w-4" />
              All events
            </Link>
            <Link
              to="/series"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "flex-1"
              )}
            >
              <Layers className="h-4 w-4" />
              All series
            </Link>
          </div>

          {/* Live now */}
          <section className="mb-8">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Live now
                {liveEvents && liveEvents.length > 0
                  ? ` · ${liveEvents.length}`
                  : ""}
              </h2>
            </div>
            {liveEvents && liveEvents.length === 0 ? (
              <div className="rounded-xl border border-dashed bg-muted/30 px-5 py-6 text-center text-sm text-muted-foreground">
                Nothing in progress.{" "}
                {draftCount && draftCount > 0 ? (
                  <Link to="/events" className="text-primary hover:underline">
                    {draftCount} draft{draftCount === 1 ? "" : "s"} ready to start →
                  </Link>
                ) : (
                  <Link to="/events/new" className="text-primary hover:underline">
                    Create one →
                  </Link>
                )}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {liveEvents?.map((e, idx) => (
                  <div
                    key={e.id}
                    className={
                      idx === 0 && (liveEvents?.length ?? 0) > 1
                        ? "sm:col-span-2"
                        : ""
                    }
                  >
                    <EventCard
                      event={e}
                      featured={idx === 0}
                      playerCount={playerCounts[e.id]}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Recently finished */}
          {recentEvents && recentEvents.length > 0 && (
            <section className="mb-8">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Recently finished
                </h2>
                <Link
                  to="/events"
                  className="text-xs font-medium text-primary hover:underline"
                >
                  All events →
                </Link>
              </div>
              <ul className="divide-y rounded-xl border bg-card">
                {recentEvents.map((e) => (
                  <li key={e.id}>
                    <Link
                      to={`/events/${e.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {e.name}
                          </span>
                          <Badge variant="completed">Done</Badge>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {e.sport}
                          {playerCounts[e.id]
                            ? ` · ${playerCounts[e.id]} players`
                            : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {e.completed_at ? formatDate(e.completed_at) : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
