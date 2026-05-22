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
  SeriesRating,
} from "@/types/database";
import { computeStandings, type Tiebreaker } from "@/lib/standings";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn, formatDate } from "@/lib/utils";
import { AssignEventsSheet } from "@/components/AssignEventsSheet";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useMembership } from "@/lib/membership";
import { isAdmin } from "@/lib/permissions";

type TabKey = "standings" | "ratings" | "events";

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
  const [tab, setTab] = useState<TabKey>("events");
  const [assigning, setAssigning] = useState(false);
  const [seriesRatings, setSeriesRatings] = useState<SeriesRating[]>([]);
  const { membership } = useMembership();
  const showEditChrome = isAdmin(membership);

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

    // Load per-series ratings for the leaderboard tab
    const { data: srs } = await supabase
      .from("rr_series_ratings")
      .select("*")
      .eq("series_id", id);
    setSeriesRatings((srs ?? []) as SeriesRating[]);

    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /**
   * Per-mode match counts for the series. Two layers:
   *  - seriesHasMode: does this series have ANY completed singles /
   *    doubles matches? Drives whether we render the column at all.
   *  - perPlayerCounts: per-(player, mode) completed match count.
   *    Drives the "—" fallback for individual rows where a player has
   *    a default-seeded rating because they've never played that mode
   *    in this series.
   *
   * Computed from already-loaded `events` + `matches` — no extra query.
   */
  const matchCounts = useMemo(() => {
    const eventModeById = new Map<string, "singles" | "doubles">();
    for (const e of events) {
      eventModeById.set(e.id, e.mode === "singles" ? "singles" : "doubles");
    }
    const seriesHasMode = { singles: 0, doubles: 0 };
    const perPlayer = new Map<
      string,
      { singles: number; doubles: number }
    >();
    const bump = (id: string, mode: "singles" | "doubles") => {
      const cur = perPlayer.get(id) ?? { singles: 0, doubles: 0 };
      cur[mode] += 1;
      perPlayer.set(id, cur);
    };
    for (const m of matches) {
      if (m.status !== "completed" || !m.winner_side) continue;
      const mode = eventModeById.get(m.event_id);
      if (!mode) continue;
      seriesHasMode[mode] += 1;
      for (const id of m.side_a_player_ids) bump(id, mode);
      for (const id of m.side_b_player_ids) bump(id, mode);
    }
    return {
      hasSingles: seriesHasMode.singles > 0,
      hasDoubles: seriesHasMode.doubles > 0,
      // Mode with the most completed matches in this series, used as the
      // primary sort key for the leaderboard. If neither, defaults to
      // doubles (the empty-state path renders before this is read).
      primaryMode:
        seriesHasMode.doubles >= seriesHasMode.singles
          ? ("doubles" as const)
          : ("singles" as const),
      perPlayer,
    };
  }, [events, matches]);

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
        <TabButton active={tab === "events"} onClick={() => setTab("events")}>
          Events
        </TabButton>
        <TabButton active={tab === "standings"} onClick={() => setTab("standings")}>
          Cumulative standings
        </TabButton>
        <TabButton active={tab === "ratings"} onClick={() => setTab("ratings")}>
          Ratings
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

      {tab === "ratings" && (
        <Card className="overflow-hidden">
          {seriesRatings.length === 0 ||
          (!matchCounts.hasSingles && !matchCounts.hasDoubles) ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              No ratings yet — ratings appear here once players complete matches in this series.
            </p>
          ) : (
            <ul className="divide-y">
              {/* Sort by whichever mode the series uses most. Ties
                  broken by the other mode's rating. */}
              {[...seriesRatings]
                .sort((a, b) => {
                  const primary = matchCounts.primaryMode;
                  const secondary =
                    primary === "doubles" ? "singles" : "doubles";
                  const ap =
                    primary === "doubles"
                      ? a.glicko_doubles_rating
                      : a.glicko_singles_rating;
                  const bp =
                    primary === "doubles"
                      ? b.glicko_doubles_rating
                      : b.glicko_singles_rating;
                  if (bp !== ap) return bp - ap;
                  const as =
                    secondary === "doubles"
                      ? a.glicko_doubles_rating
                      : a.glicko_singles_rating;
                  const bs =
                    secondary === "doubles"
                      ? b.glicko_doubles_rating
                      : b.glicko_singles_rating;
                  return bs - as;
                })
                .map((sr, idx) => {
                  const p = players[sr.player_id];
                  const counts = matchCounts.perPlayer.get(sr.player_id) ?? {
                    singles: 0,
                    doubles: 0,
                  };
                  return (
                    <li
                      key={sr.id}
                      className="flex items-center justify-between gap-3 px-5 py-3"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="text-sm font-semibold tabular-nums">
                          #{idx + 1}
                        </span>
                        <span className="min-w-0">
                          <Link
                            to={`/players/${sr.player_id}`}
                            className="block truncate text-sm font-medium hover:underline"
                          >
                            {p?.full_name ?? "Unknown"}
                          </Link>
                          <span className="block text-xs text-muted-foreground">
                            {sr.matches_played} match
                            {sr.matches_played === 1 ? "" : "es"} in this series
                          </span>
                        </span>
                      </span>
                      <span className="flex items-center gap-4 text-right text-xs tabular-nums">
                        {matchCounts.hasSingles && (
                          <RatingPill
                            label="Singles"
                            rating={sr.glicko_singles_rating}
                            rd={sr.glicko_singles_rd}
                            played={counts.singles}
                          />
                        )}
                        {matchCounts.hasDoubles && (
                          <RatingPill
                            label="Doubles"
                            rating={sr.glicko_doubles_rating}
                            rd={sr.glicko_doubles_rd}
                            played={counts.doubles}
                          />
                        )}
                      </span>
                    </li>
                  );
                })}
            </ul>
          )}
          <p className="border-t bg-muted/30 px-5 py-2 text-[11px] text-muted-foreground">
            These ratings only reflect matches played within this series.
            Each player’s global rating may be different.
          </p>
        </Card>
      )}

      {tab === "events" && (
        <>
          {showEditChrome && (
            <div className="mb-3 flex items-center justify-end">
              <Button size="sm" onClick={() => setAssigning(true)}>
                <Plus className="h-4 w-4" />
                Manage events
              </Button>
            </div>
          )}
          <Card className="overflow-hidden">
            {events.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                {showEditChrome
                  ? 'No events in this series yet. Tap "Manage events" above to add some.'
                  : "No events in this series yet."}
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
        </>
      )}

      {showEditChrome && (
        <AssignEventsSheet
          open={assigning}
          onClose={() => setAssigning(false)}
          seriesId={series.id}
          seriesName={series.name}
          assignedEventIds={events.map((e) => e.id)}
          onAssigned={load}
        />
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

/**
 * One side's rating in the series leaderboard. Renders "—" when the
 * player has 0 matches in this mode in the series, signalling that the
 * displayed rating is just a default seed (or seed-from-global) and
 * shouldn't be read as a real rating.
 */
function RatingPill({
  label,
  rating,
  rd,
  played,
}: {
  label: string;
  rating: number;
  rd: number;
  played: number;
}) {
  return (
    <span title={`Series ${label.toLowerCase()} rating`}>
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {played === 0 ? (
        <span className="block text-sm font-semibold text-muted-foreground/70">
          —
        </span>
      ) : (
        <span className="block">
          <span className="text-sm font-semibold">
            {Math.round(rating)}
          </span>
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            ± {Math.round(rd)}
          </span>
        </span>
      )}
    </span>
  );
}
