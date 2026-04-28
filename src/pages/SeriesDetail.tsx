import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  Loader2,
  Trophy,
  Users as UsersIcon,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type {
  EventPlayer,
  EventRow,
  MatchRow,
  Player,
  Series,
} from "@/types/database";
import { computeStandings, type Tiebreaker } from "@/lib/standings";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn, formatDate } from "@/lib/utils";

type TabKey = "standings" | "events";

interface AggregatedRow {
  playerId: string;
  events: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
}

export default function SeriesDetail() {
  const { id } = useParams<{ id: string }>();
  const [series, setSeries] = useState<Series | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventPlayers, setEventPlayers] = useState<EventPlayer[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [players, setPlayers] = useState<Record<string, Player>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("standings");

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);

    const { data: s, error: sErr } = await supabase
      .from("rr_series")
      .select("*")
      .eq("id", id)
      .single();
    if (sErr || !s) {
      setError(sErr?.message ?? "Series not found");
      setLoading(false);
      return;
    }
    setSeries(s);

    const { data: evs, error: eErr } = await supabase
      .from("rr_events")
      .select("*")
      .eq("series_id", id)
      .order("scheduled_date", { ascending: true, nullsFirst: false });
    if (eErr) {
      setError(eErr.message);
      setLoading(false);
      return;
    }
    setEvents(evs ?? []);

    const eventIds = (evs ?? []).map((e) => e.id);
    if (eventIds.length === 0) {
      setEventPlayers([]);
      setMatches([]);
      setPlayers({});
      setLoading(false);
      return;
    }

    const [{ data: eps }, { data: ms }] = await Promise.all([
      supabase.from("rr_event_players").select("*").in("event_id", eventIds),
      supabase.from("rr_matches").select("*").in("event_id", eventIds),
    ]);
    setEventPlayers(eps ?? []);
    setMatches(ms ?? []);

    const playerIds = new Set<string>();
    for (const ep of eps ?? []) playerIds.add(ep.player_id);
    if (playerIds.size > 0) {
      const { data: ps } = await supabase
        .from("rr_players")
        .select("*")
        .in("id", Array.from(playerIds));
      const map: Record<string, Player> = {};
      for (const p of ps ?? []) map[p.id] = p;
      setPlayers(map);
    } else {
      setPlayers({});
    }

    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Aggregate per-player stats across every event in the series
  const aggregated = useMemo(() => {
    const agg = new Map<string, AggregatedRow>();
    const eventTiebreakers = new Map<string, Tiebreaker[]>();
    for (const e of events) {
      const tb = ((e.config as { tiebreakers?: Tiebreaker[] }).tiebreakers ?? [
        "wins",
        "h2h",
        "point_diff",
        "points_for",
      ]) as Tiebreaker[];
      eventTiebreakers.set(e.id, tb);
    }

    for (const e of events) {
      const epIds = eventPlayers
        .filter((ep) => ep.event_id === e.id)
        .map((ep) => ep.player_id);
      const eMatches = matches.filter((m) => m.event_id === e.id);
      const tb = eventTiebreakers.get(e.id) ?? [
        "wins",
        "h2h",
        "point_diff",
        "points_for",
      ];
      const standings = computeStandings(epIds, eMatches, tb);
      for (const s of standings) {
        const row = agg.get(s.playerId) ?? {
          playerId: s.playerId,
          events: 0,
          wins: 0,
          losses: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        };
        row.events++;
        row.wins += s.wins;
        row.losses += s.losses;
        row.pointsFor += s.pointsFor;
        row.pointsAgainst += s.pointsAgainst;
        agg.set(s.playerId, row);
      }
    }

    // Sort by total wins desc, then point diff desc
    return Array.from(agg.values()).sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      const aDiff = a.pointsFor - a.pointsAgainst;
      const bDiff = b.pointsFor - b.pointsAgainst;
      return bDiff - aDiff;
    });
  }, [events, eventPlayers, matches]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  if (error || !series) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8 md:px-6">
        <Link
          to="/series"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to series
        </Link>
        <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm">
          <p className="font-medium text-destructive">Couldn't load series</p>
          <p className="mt-1 text-muted-foreground">{error ?? "Unknown error"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6 flex items-start gap-3">
        <Link
          to="/series"
          className={buttonVariants({ variant: "ghost", size: "icon" })}
          aria-label="Back to series"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {series.name}
          </h1>
          {series.description && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {series.description}
            </p>
          )}
          <p className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            {series.starts_on && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" />
                {formatDate(series.starts_on)}
                {series.ends_on
                  ? ` – ${formatDate(series.ends_on)}`
                  : " – ongoing"}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Trophy className="h-3.5 w-3.5" />
              {events.length} event{events.length === 1 ? "" : "s"}
            </span>
            {!series.ends_on && (
              <Badge variant="live" className="gap-1">
                Endless
              </Badge>
            )}
          </p>
        </div>
      </header>

      <div className="mb-4 flex gap-1 rounded-md bg-muted p-1">
        <TabButton active={tab === "standings"} onClick={() => setTab("standings")}>
          Cumulative standings
        </TabButton>
        <TabButton active={tab === "events"} onClick={() => setTab("events")}>
          Events
        </TabButton>
      </div>

      {tab === "standings" && (
        <Card className="overflow-hidden">
          {aggregated.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              No standings yet — add events to this series and play some matches.
            </p>
          ) : (
            <ul className="divide-y">
              {aggregated.map((row, idx) => {
                const p = players[row.playerId];
                const diff = row.pointsFor - row.pointsAgainst;
                return (
                  <li
                    key={row.playerId}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="text-sm font-semibold tabular-nums">
                        #{idx + 1}
                      </span>
                      <span className="min-w-0">
                        <Link
                          to={`/players/${row.playerId}`}
                          className="block truncate text-sm font-medium hover:underline"
                        >
                          {p?.full_name ?? "Unknown"}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {row.events} event{row.events === 1 ? "" : "s"}
                        </span>
                      </span>
                    </span>
                    <span className="text-right text-sm tabular-nums">
                      <span className="block font-semibold">
                        {row.wins}–{row.losses}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {diff >= 0 ? "+" : ""}
                        {diff} diff
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {tab === "events" && (
        <Card className="overflow-hidden">
          {events.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              No events in this series yet. Open an event's edit sheet to assign it here.
            </div>
          ) : (
            <ul className="divide-y">
              {events.map((e) => (
                <li key={e.id}>
                  <Link
                    to={`/events/${e.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-accent/30"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {e.name}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {e.sport}
                        {e.scheduled_date && ` · ${formatDate(e.scheduled_date)}`}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {e.status === "live" && <Badge variant="live">Live</Badge>}
                      {e.status === "completed" && (
                        <Badge variant="completed">Done</Badge>
                      )}
                      {e.status === "draft" && <Badge variant="draft">Draft</Badge>}
                      <UsersIcon className="h-4 w-4 text-muted-foreground" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm",
        active
          ? "bg-background shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
