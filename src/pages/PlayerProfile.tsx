import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Loader2,
  Pencil,
  Trophy,
  X as XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type {
  EventPlayer,
  EventRow,
  MatchRow,
  Player,
  Series,
  SeriesRating,
} from "@/types/database";
import { computePlayerStats, formatRecord } from "@/lib/stats";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RatingChart } from "@/components/RatingChart";
import { cn, formatDate } from "@/lib/utils";

interface RatingHistoryRow {
  rating_type: "singles" | "doubles";
  rating_after: number;
  rd_after: number;
  recorded_at: string;
}

type TabKey = "events" | "h2h" | "partners" | "recent" | "rating";

export default function PlayerProfile() {
  const { id } = useParams<{ id: string }>();
  const [player, setPlayer] = useState<Player | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventPlayers, setEventPlayers] = useState<EventPlayer[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [opponentLookup, setOpponentLookup] = useState<Record<string, Player>>({});
  const [ratingHistory, setRatingHistory] = useState<RatingHistoryRow[]>([]);
  const [seriesRatings, setSeriesRatings] = useState<
    Array<{ rating: SeriesRating; series: Series }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<TabKey>("events");

  const loadAll = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);

    // 1. Player + their event memberships
    const [{ data: p, error: pErr }, { data: ep, error: epErr }] = await Promise.all([
      supabase.from("rr_players").select("*").eq("id", id).single(),
      supabase.from("rr_event_players").select("*").eq("player_id", id),
    ]);
    if (pErr || !p) {
      setError(pErr?.message ?? "Player not found");
      setLoading(false);
      return;
    }
    if (epErr) {
      setError(epErr.message);
      setLoading(false);
      return;
    }
    setPlayer(p);
    setName(p.full_name);
    setEventPlayers(ep ?? []);

    // 2. Events the player is in
    const eventIds = (ep ?? []).map((row) => row.event_id);
    if (eventIds.length === 0) {
      setEvents([]);
      setMatches([]);
      setOpponentLookup({});
      setLoading(false);
      return;
    }

    const { data: evs, error: evErr } = await supabase
      .from("rr_events")
      .select("*")
      .in("id", eventIds)
      .order("scheduled_date", { ascending: false, nullsFirst: false });
    if (evErr) {
      setError(evErr.message);
      setLoading(false);
      return;
    }
    setEvents(evs ?? []);

    // 3. All matches involving this player (either side)
    // PostgREST array-contains via .or
    const { data: ms, error: mErr } = await supabase
      .from("rr_matches")
      .select("*")
      .or(`side_a_player_ids.cs.{${id}},side_b_player_ids.cs.{${id}}`)
      .order("round", { ascending: false });
    if (mErr) {
      setError(mErr.message);
      setLoading(false);
      return;
    }
    setMatches(ms ?? []);

    // 4. Lookup for every other player who appeared in any of those matches
    const otherIds = new Set<string>();
    for (const m of ms ?? []) {
      for (const x of m.side_a_player_ids) if (x !== id) otherIds.add(x);
      for (const x of m.side_b_player_ids) if (x !== id) otherIds.add(x);
    }
    if (otherIds.size > 0) {
      const { data: others } = await supabase
        .from("rr_players")
        .select("*")
        .in("id", Array.from(otherIds));
      const map: Record<string, Player> = {};
      for (const o of others ?? []) map[o.id] = o;
      setOpponentLookup(map);
    } else {
      setOpponentLookup({});
    }

    // 5. Rating history rows for the chart
    const { data: rh } = await supabase
      .from("rr_rating_history")
      .select("rating_type, rating_after, rd_after, recorded_at")
      .eq("player_id", id)
      .order("recorded_at", { ascending: true });
    setRatingHistory((rh ?? []) as RatingHistoryRow[]);

    // Per-series ratings — combined with their series rows for display
    const { data: srRows } = await supabase
      .from("rr_series_ratings")
      .select("*")
      .eq("player_id", id);
    const seriesIds = (srRows ?? []).map(
      (r: { series_id: string }) => r.series_id
    );
    let seriesById: Record<string, Series> = {};
    if (seriesIds.length > 0) {
      const { data: sList } = await supabase
        .from("rr_series")
        .select("*")
        .in("id", seriesIds);
      for (const s of (sList ?? []) as Series[]) seriesById[s.id] = s;
    }
    setSeriesRatings(
      ((srRows ?? []) as SeriesRating[])
        .filter((r) => seriesById[r.series_id])
        .map((r) => ({ rating: r, series: seriesById[r.series_id] }))
    );

    setLoading(false);
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const stats = useMemo(
    () => (player ? computePlayerStats(player.id, matches) : null),
    [player, matches]
  );

  const eventsById = useMemo(() => {
    const map: Record<string, EventRow> = {};
    for (const e of events) map[e.id] = e;
    return map;
  }, [events]);

  /**
   * Per-(series, mode) completed match count for this player. Drives:
   *  - whether to render the singles / doubles half of a series card
   *  - the "—" placeholder for default-seeded modes (so a fresh
   *    player who's only ever played doubles in a series doesn't see
   *    a stale 1500 in the singles slot).
   */
  const seriesMatchCounts = useMemo(() => {
    const counts = new Map<
      string,
      { singles: number; doubles: number }
    >();
    for (const m of matches) {
      if (m.status !== "completed" || !m.winner_side) continue;
      const ev = eventsById[m.event_id];
      if (!ev || !ev.series_id) continue;
      const mode: "singles" | "doubles" =
        ev.mode === "singles" ? "singles" : "doubles";
      const cur = counts.get(ev.series_id) ?? { singles: 0, doubles: 0 };
      cur[mode] += 1;
      counts.set(ev.series_id, cur);
    }
    return counts;
  }, [matches, eventsById]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  if (error || !player || !stats) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8 md:px-6">
        <Link
          to="/players"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to players
        </Link>
        <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm">
          <p className="font-medium text-destructive">Couldn't load player</p>
          <p className="mt-1 text-muted-foreground">{error ?? "Unknown error"}</p>
        </div>
      </div>
    );
  }

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === player.full_name) {
      setEditing(false);
      setName(player.full_name);
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("rr_players")
      .update({ full_name: trimmed })
      .eq("id", player.id);
    setSaving(false);
    if (error) {
      toast.error("Couldn't rename", { description: error.message });
      return;
    }
    toast.success("Renamed", {
      description: "Updated everywhere this player appears.",
    });
    setEditing(false);
    await loadAll();
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6 flex items-start gap-3">
        <Link
          to="/players"
          className={buttonVariants({ variant: "ghost", size: "icon" })}
          aria-label="Back to players"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") {
                    setEditing(false);
                    setName(player.full_name);
                  }
                }}
              />
              <Button onClick={saveName} disabled={saving} size="sm">
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setEditing(false);
                  setName(player.full_name);
                }}
                disabled={saving}
                aria-label="Cancel"
              >
                <XIcon className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {player.full_name}
            </h1>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {player.matches_played} match
            {player.matches_played === 1 ? "" : "es"} played across{" "}
            {events.length} event{events.length === 1 ? "" : "s"}
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={buttonVariants({ variant: "outline", size: "icon" })}
            aria-label="Edit name"
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
      </header>

      {/* Ratings */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <RatingCard
          label="Singles rating"
          rating={player.glicko_singles_rating}
          rd={player.glicko_singles_rd}
        />
        <RatingCard
          label="Doubles rating"
          rating={player.glicko_doubles_rating}
          rd={player.glicko_doubles_rd}
        />
      </div>

      {/* Lifetime W-L */}
      <div className="mb-6 grid grid-cols-3 gap-2">
        <StatCell label="Wins" value={stats.totalWins} />
        <StatCell label="Losses" value={stats.totalLosses} />
        <StatCell
          label="Win rate"
          value={
            stats.totalPlayed === 0
              ? "—"
              : `${Math.round((stats.totalWins / stats.totalPlayed) * 100)}%`
          }
        />
      </div>

      {/* Per-series ratings */}
      {seriesRatings.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Series ratings
          </h2>
          <div className="-mx-4 overflow-x-auto px-4 md:-mx-6 md:px-6">
            <div className="flex gap-3 pb-1">
              {seriesRatings.map(({ rating, series }) => {
                const counts = seriesMatchCounts.get(series.id) ?? {
                  singles: 0,
                  doubles: 0,
                };
                const total = counts.singles + counts.doubles;
                // If this player has zero completed matches in either mode
                // in this series we still want to show the card (the
                // rating row exists), but with everything as "—" so they
                // don't read default-seeded numbers as real.
                return (
                  <Link
                    key={rating.id}
                    to={`/series/${series.id}`}
                    className="group min-w-[180px] shrink-0 rounded-lg border bg-card p-3 transition-colors hover:bg-accent/40"
                  >
                    <p className="mb-1 truncate text-sm font-medium group-hover:underline">
                      {series.name}
                    </p>
                    <div
                      className={cn(
                        "grid gap-2 text-xs",
                        counts.singles > 0 && counts.doubles > 0
                          ? "grid-cols-2"
                          : "grid-cols-1"
                      )}
                    >
                      {counts.singles > 0 && (
                        <SeriesCardSide
                          label="Singles"
                          rating={rating.glicko_singles_rating}
                          rd={rating.glicko_singles_rd}
                        />
                      )}
                      {counts.doubles > 0 && (
                        <SeriesCardSide
                          label="Doubles"
                          rating={rating.glicko_doubles_rating}
                          rd={rating.glicko_doubles_rd}
                        />
                      )}
                      {counts.singles === 0 && counts.doubles === 0 && (
                        <span className="text-xs text-muted-foreground">
                          No matches yet
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      {total} match{total === 1 ? "" : "es"} in this series
                    </p>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-md bg-muted p-1">
        <TabButton active={tab === "events"} onClick={() => setTab("events")}>
          Events
        </TabButton>
        <TabButton active={tab === "h2h"} onClick={() => setTab("h2h")}>
          Head to head
        </TabButton>
        <TabButton active={tab === "partners"} onClick={() => setTab("partners")}>
          Partners
        </TabButton>
        <TabButton active={tab === "recent"} onClick={() => setTab("recent")}>
          Recent
        </TabButton>
        <TabButton active={tab === "rating"} onClick={() => setTab("rating")}>
          Rating
        </TabButton>
      </div>

      {tab === "events" && (
        <Card className="overflow-hidden">
          {events.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              Hasn't played in any events yet.
            </p>
          ) : (
            <ul className="divide-y">
              {events.map((e) => {
                const ep = eventPlayers.find((x) => x.event_id === e.id);
                const finalRank = ep?.final_rank ?? null;
                return (
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
                          {e.sport} ·{" "}
                          {e.mode === "singles" ? "Singles" : "Doubles"}
                          {e.scheduled_date && (
                            <>
                              {" · "}
                              {formatDate(e.scheduled_date)}
                            </>
                          )}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {finalRank != null && (
                          <Badge variant="outline" className="gap-1">
                            <Trophy className="h-3 w-3" />#{finalRank}
                          </Badge>
                        )}
                        {ep?.withdrawn && (
                          <Badge variant="forfeit">Withdrew</Badge>
                        )}
                        <EventStatusBadge status={e.status} />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {tab === "h2h" && (
        <Card className="overflow-hidden">
          {stats.h2h.size === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              No completed matches yet.
            </p>
          ) : (
            <ul className="divide-y">
              {Array.from(stats.h2h.entries())
                .sort((a, b) => b[1].played - a[1].played || b[1].wins - a[1].wins)
                .map(([oppId, r]) => (
                  <li
                    key={oppId}
                    className="flex items-center justify-between px-5 py-3 text-sm"
                  >
                    <Link
                      to={`/players/${oppId}`}
                      className="truncate text-rose-700 hover:underline dark:text-rose-300"
                    >
                      {opponentLookup[oppId]?.full_name ?? "Unknown"}
                    </Link>
                    <div className="flex items-center gap-3 tabular-nums">
                      <span className="text-xs text-muted-foreground">
                        {r.played} played
                      </span>
                      <span className="font-semibold text-rose-700 dark:text-rose-300">
                        {formatRecord(r)}
                      </span>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "partners" && (
        <Card className="overflow-hidden">
          {stats.partnerships.size === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              No completed doubles matches yet.
            </p>
          ) : (
            <ul className="divide-y">
              {Array.from(stats.partnerships.entries())
                .sort((a, b) => b[1].played - a[1].played || b[1].wins - a[1].wins)
                .map(([partnerId, r]) => (
                  <li
                    key={partnerId}
                    className="flex items-center justify-between px-5 py-3 text-sm"
                  >
                    <Link
                      to={`/players/${partnerId}`}
                      className="truncate text-emerald-700 hover:underline dark:text-emerald-300"
                    >
                      {opponentLookup[partnerId]?.full_name ?? "Unknown"}
                    </Link>
                    <div className="flex items-center gap-3 tabular-nums">
                      <span className="text-xs text-muted-foreground">
                        {r.played} played together
                      </span>
                      <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                        {formatRecord(r)}
                      </span>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "recent" && (
        <Card className="overflow-hidden">
          {matches.filter((m) => m.status === "completed").length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              No completed matches yet.
            </p>
          ) : (
            <ul className="divide-y">
              {matches
                .filter((m) => m.status === "completed")
                .slice(0, 20)
                .map((m) => {
                  const onA = m.side_a_player_ids.includes(player.id);
                  const won = (onA && m.winner_side === "a") || (!onA && m.winner_side === "b");
                  const opponentIds = onA ? m.side_b_player_ids : m.side_a_player_ids;
                  const partnerIds = (onA ? m.side_a_player_ids : m.side_b_player_ids).filter(
                    (x) => x !== player.id
                  );
                  const ev = eventsById[m.event_id];
                  return (
                    <li key={m.id} className="px-5 py-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0">
                          {partnerIds.length > 0 && (
                            <span className="text-xs text-muted-foreground">
                              with{" "}
                              {partnerIds
                                .map((id) => opponentLookup[id]?.full_name ?? "Unknown")
                                .join(" + ")}{" "}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">vs </span>
                          <span className="text-sm">
                            {opponentIds
                              .map((id) => opponentLookup[id]?.full_name ?? "Unknown")
                              .join(" + ")}
                          </span>
                        </span>
                        <Badge
                          variant={won ? "live" : "completed"}
                          className="shrink-0"
                        >
                          {won ? "Won" : "Lost"}
                        </Badge>
                      </div>
                      {ev && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {ev.name} · Round {m.round}
                        </div>
                      )}
                    </li>
                  );
                })}
            </ul>
          )}
        </Card>
      )}

      {tab === "rating" && (
        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Singles rating over time
            </h3>
            <RatingChart
              points={ratingHistory
                .filter((r) => r.rating_type === "singles")
                .map((r) => ({
                  recordedAt: r.recorded_at,
                  rating: r.rating_after,
                  rd: r.rd_after,
                }))}
            />
          </Card>
          <Card className="p-5">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Doubles rating over time
            </h3>
            <RatingChart
              points={ratingHistory
                .filter((r) => r.rating_type === "doubles")
                .map((r) => ({
                  recordedAt: r.recorded_at,
                  rating: r.rating_after,
                  rd: r.rd_after,
                }))}
            />
          </Card>
        </div>
      )}
    </div>
  );
}

function RatingCard({
  label,
  rating,
  rd,
}: {
  label: string;
  rating: number;
  rd: number;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div className="mt-0.5 text-2xl font-semibold tabular-nums">
            {Math.round(rating)}
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>± {Math.round(rd)}</div>
          <div className="mt-0.5">Glicko-2</div>
        </div>
      </div>
    </div>
  );
}

/**
 * One side (singles / doubles) of a player's per-series rating card.
 * Shows rating + RD so a high-RD seed reads as provisional.
 */
function SeriesCardSide({
  label,
  rating,
  rd,
}: {
  label: string;
  rating: number;
  rd: number;
}) {
  return (
    <span>
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="flex items-baseline gap-1">
        <span className="text-base font-semibold tabular-nums">
          {Math.round(rating)}
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          ± {Math.round(rd)}
        </span>
      </span>
    </span>
  );
}

function StatCell({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border bg-background p-3 text-center">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
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

function EventStatusBadge({ status }: { status: EventRow["status"] }) {
  if (status === "draft") return <Badge variant="draft">Draft</Badge>;
  if (status === "live") return <Badge variant="live">Live</Badge>;
  if (status === "completed") return <Badge variant="completed">Done</Badge>;
  return <Badge variant="outline">Archived</Badge>;
}
