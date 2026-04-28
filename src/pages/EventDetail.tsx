import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  Loader2,
  Play,
  Users,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { cn, formatDate } from "@/lib/utils";
import { generateScheduleForMode } from "@/lib/scheduler";
import type {
  EventConfig,
  EventPlayer,
  EventRow,
  MatchRow,
  Player,
} from "@/types/database";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MatchCard } from "@/components/MatchCard";
import { RoundNavigator } from "@/components/RoundNavigator";
import { PlayerDetailSheet } from "@/components/PlayerDetailSheet";
import { ScoreSheet } from "@/components/ScoreSheet";
import { EventEditSheet } from "@/components/EventEditSheet";
import { RosterAddSheet } from "@/components/RosterAddSheet";
import { FinalizeEventSheet } from "@/components/FinalizeEventSheet";
import { StandingsTable } from "@/components/StandingsTable";
import { BracketView } from "@/components/BracketView";
import { StartKnockoutSheet } from "@/components/StartKnockoutSheet";
import { PlayerSwapSheet } from "@/components/PlayerSwapSheet";
import { MatchSubstituteSheet } from "@/components/MatchSubstituteSheet";
import { Pencil, UserPlus, Sparkles, Swords, GripVertical } from "lucide-react";
import { advanceKnockoutWinners } from "@/lib/startKnockout";
import { recomputeLiveRatings } from "@/lib/liveRatings";
import type { ScoringTemplate } from "@/types/database";
import { computeStandings, type Tiebreaker } from "@/lib/standings";
import { regenerateFutureSchedule, appendOneRotation } from "@/lib/scheduleSync";

type Tab = "schedule" | "standings" | "bracket" | "roster";

export default function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [eventPlayers, setEventPlayers] = useState<EventPlayer[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("schedule");
  const [generating, setGenerating] = useState(false);
  const [currentRound, setCurrentRound] = useState(1);
  const [openPlayerEpId, setOpenPlayerEpId] = useState<string | null>(null);
  const [openMatchId, setOpenMatchId] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState(false);
  const [addingPlayer, setAddingPlayer] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [startingKnockout, setStartingKnockout] = useState(false);
  const [swappingPlayerId, setSwappingPlayerId] = useState<string | null>(null);
  const [subbingMatchId, setSubbingMatchId] = useState<string | null>(null);
  const [subbingSide, setSubbingSide] = useState<"a" | "b" | null>(null);
  const [subbingOutgoingId, setSubbingOutgoingId] = useState<string | null>(null);
  const [draggingEpId, setDraggingEpId] = useState<string | null>(null);
  const [hoverEpId, setHoverEpId] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<"above" | "below" | null>(null);
  const [addingRounds, setAddingRounds] = useState(false);

  const loadAll = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const [{ data: ev, error: evErr }, { data: ep, error: epErr }] =
      await Promise.all([
        supabase.from("rr_events").select("*").eq("id", id).single(),
        supabase.from("rr_event_players").select("*").eq("event_id", id),
      ]);

    if (evErr || !ev) {
      setError(evErr?.message ?? "Event not found");
      setLoading(false);
      return;
    }
    if (epErr) {
      setError(epErr.message);
      setLoading(false);
      return;
    }

    setEvent(ev);
    setEventPlayers(ep ?? []);

    const playerIds = (ep ?? []).map((row) => row.player_id);
    if (playerIds.length > 0) {
      const { data: ps, error: psErr } = await supabase
        .from("rr_players")
        .select("*")
        .in("id", playerIds);
      if (psErr) {
        setError(psErr.message);
        setLoading(false);
        return;
      }
      setPlayers(ps ?? []);
    } else {
      setPlayers([]);
    }

    const { data: ms, error: msErr } = await supabase
      .from("rr_matches")
      .select("*")
      .eq("event_id", id)
      .order("round")
      .order("court");
    if (msErr) {
      setError(msErr.message);
      setLoading(false);
      return;
    }
    setMatches(ms ?? []);
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleScoreSaved = async () => {
    if (event) {
      try {
        await advanceKnockoutWinners(event.id);
      } catch {
        // non-fatal — just keep the bracket as-is
      }
      try {
        await recomputeLiveRatings(event.id);
      } catch {
        // non-fatal — ratings will be recomputed next time something changes
      }
    }
    await loadAll();
  };

  const handleRosterOrSettingsChanged = async () => {
    if (!event) {
      await loadAll();
      return;
    }
    try {
      const r = await regenerateFutureSchedule(event.id);
      if (r.created > 0 || r.deleted > 0) {
        toast.success("Schedule updated", { description: r.message });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Couldn't refresh schedule", { description: msg });
    } finally {
      await loadAll();
    }
  };

  const playersById = useMemo(() => {
    const map: Record<string, Player> = {};
    for (const p of players) map[p.id] = p;
    return map;
  }, [players]);

  const totalRounds = useMemo(() => {
    if (matches.length === 0) return 0;
    return Math.max(...matches.map((m) => m.round));
  }, [matches]);

  // Per-round completion summary for the chip strip — only counts group-stage
  // round-robin matches (knockout matches live in their own tab). Also captures
  // each round's Berger group id so the strip can visually group sub-rounds
  // that came from the same logical Berger round (split because of court
  // count).
  //
  // For matches with explicit `group_label` (events generated after the
  // tracking landed), we use that directly. For older events that don't have
  // the column populated, we derive a synthetic grouping: two consecutive
  // rounds whose player sets are disjoint must be sub-rounds of the same
  // Berger round (in Berger, every player plays at most once per round).
  const roundSummaries = useMemo(() => {
    if (totalRounds === 0) return [];
    type Row = {
      total: number;
      done: number;
      inProgress: number;
      bergerGroup: string | null;
      players: Set<string>;
    };
    const arr: Row[] = Array.from({ length: totalRounds }, () => ({
      total: 0,
      done: 0,
      inProgress: 0,
      bergerGroup: null,
      players: new Set(),
    }));
    for (const m of matches) {
      if (m.stage !== "group_rr") continue;
      const idx = m.round - 1;
      if (idx < 0 || idx >= arr.length) continue;
      arr[idx].total += 1;
      if (arr[idx].bergerGroup == null && m.group_label) {
        arr[idx].bergerGroup = m.group_label;
      }
      for (const id of m.side_a_player_ids) arr[idx].players.add(id);
      for (const id of m.side_b_player_ids) arr[idx].players.add(id);
      if (
        m.status === "completed" ||
        m.status === "forfeit_a" ||
        m.status === "forfeit_b" ||
        m.status === "walkover" ||
        m.status === "cancelled"
      ) {
        arr[idx].done += 1;
      } else if (m.status === "in_progress") {
        arr[idx].inProgress += 1;
      }
    }

    // Derive a synthetic Berger grouping if the data is missing. Walk the
    // rounds and start a new group whenever the next round's player set
    // intersects with the current. Disjoint = same Berger round.
    const allMissing = arr.every((r) => r.bergerGroup == null);
    if (allMissing) {
      let groupId = 0;
      for (let i = 0; i < arr.length; i++) {
        if (i === 0) {
          arr[i].bergerGroup = `b${groupId}`;
          continue;
        }
        const prev = arr[i - 1].players;
        const cur = arr[i].players;
        let intersects = false;
        for (const p of cur) {
          if (prev.has(p)) {
            intersects = true;
            break;
          }
        }
        if (intersects) groupId += 1;
        arr[i].bergerGroup = `b${groupId}`;
      }
    }

    // Strip the players set from the public row shape — it was just used
    // for the heuristic above.
    return arr.map(({ players: _players, ...rest }) => rest);
  }, [matches, totalRounds]);

  const liveRound = useMemo(() => {
    const incomplete = matches
      .filter(
        (m) => m.status === "scheduled" || m.status === "in_progress"
      )
      .map((m) => m.round);
    if (incomplete.length === 0) return null;
    return Math.min(...incomplete);
  }, [matches]);

  const liveRoundIsPlaying = useMemo(() => {
    if (liveRound == null) return false;
    return matches.some(
      (m) => m.round === liveRound && m.status === "in_progress"
    );
  }, [matches, liveRound]);

  useEffect(() => {
    if (liveRound != null) setCurrentRound(liveRound);
    else if (totalRounds > 0) setCurrentRound(1);
  }, [liveRound, totalRounds]);

  const matchesInCurrentRound = useMemo(
    () => matches.filter((m) => m.round === currentRound),
    [matches, currentRound]
  );

  const handleGenerate = async () => {
    if (!event || generating) return;
    if (eventPlayers.length < (event.mode === "singles" ? 2 : 4)) {
      toast.error("Not enough players to generate a schedule.");
      return;
    }
    if (
      event.mode === "doubles_partners" &&
      eventPlayers.length % 2 !== 0
    ) {
      toast.error("Fixed-partner doubles needs an even number of players.");
      return;
    }
    setGenerating(true);
    try {
      const playerIds = [...eventPlayers]
        .sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999))
        .map((ep) => ep.player_id);
      const cfg = event.config as EventConfig;
      const numCourts = cfg.num_courts ?? 1;
      const avoidBackToBack = cfg.avoid_back_to_back ?? false;
      const avoidRecentMatchups = cfg.avoid_recent_matchups ?? false;
      const fillEmptyCourts = cfg.fill_empty_courts ?? false;

      const schedule = generateScheduleForMode(event.mode, playerIds, {
        numCourts,
        avoidBackToBack,
        avoidRecentMatchups,
        fillEmptyCourts,
        minRoundsPerPlayer: cfg.min_rounds_per_player,
      });

      const rows = schedule.map((m) => ({
        event_id: event.id,
        stage: "group_rr" as const,
        round: m.round,
        court: m.court,
        side_a_player_ids: m.sideA,
        side_b_player_ids: m.sideB,
        status: "scheduled" as const,
        group_label: String(m.bergerRound),
      }));

      const [{ error: insErr }, { error: upErr }] = await Promise.all([
        supabase.from("rr_matches").insert(rows),
        supabase
          .from("rr_events")
          .update({ status: "live", started_at: new Date().toISOString() })
          .eq("id", event.id),
      ]);

      if (insErr) throw insErr;
      if (upErr) throw upErr;

      toast.success("Schedule generated", {
        description: `${rows.length} matches across ${
          new Set(rows.map((r) => r.round)).size
        } rounds.`,
      });
      await loadAll();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Couldn't generate schedule", { description: msg });
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8 md:px-6">
        <Link
          to="/events"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to events
        </Link>
        <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm">
          <p className="font-medium text-destructive">Couldn't load event</p>
          <p className="mt-1 text-muted-foreground">{error ?? "Unknown error"}</p>
        </div>
      </div>
    );
  }

  const matchesExist = matches.length > 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      {/* Header — stacks on mobile, two-column on sm+ */}
      <header className="mb-6">
        <div className="mb-3 flex items-center gap-2">
          <Link
            to="/events"
            className={buttonVariants({ variant: "ghost", size: "icon" })}
            aria-label="Back to events"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <button
            type="button"
            onClick={() => setEditingEvent(true)}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "ml-auto"
            )}
          >
            <Pencil className="h-4 w-4" />
            Edit
          </button>
          {event.status === "live" && (
            <button
              type="button"
              onClick={() => setFinalizing(true)}
              className={buttonVariants({ variant: "default", size: "sm" })}
              title="End event and finalize ratings"
            >
              <Sparkles className="h-4 w-4" />
              End event
            </button>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="break-words text-2xl uppercase tracking-tight sm:text-3xl">
              {event.name}
            </h1>
            <EventStatusBadge status={event.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {event.sport} ·{" "}
            {event.mode === "singles"
              ? "Singles"
              : event.mode === "doubles_partners"
              ? "Doubles (fixed partners)"
              : "Doubles (rotating)"}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {event.scheduled_date && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" />
                {formatDate(event.scheduled_date)}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {eventPlayers.length}{" "}
              {eventPlayers.length === 1 ? "player" : "players"}
            </span>
          </p>
        </div>
      </header>

      <div className="mb-4 flex gap-1 rounded-md bg-muted p-1">
        <TabButton active={tab === "schedule"} onClick={() => setTab("schedule")}>
          Schedule
        </TabButton>
        <TabButton active={tab === "standings"} onClick={() => setTab("standings")}>
          Standings
        </TabButton>
        {(event.format !== "pure_rr") && (
          <TabButton active={tab === "bracket"} onClick={() => setTab("bracket")}>
            Bracket
          </TabButton>
        )}
        <TabButton active={tab === "roster"} onClick={() => setTab("roster")}>
          Roster
        </TabButton>
      </div>

      {tab === "schedule" && (
        <>
          {!matchesExist ? (
            <Card className="flex flex-col items-center px-6 py-12 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Wand2 className="h-6 w-6" />
              </div>
              <h2 className="text-lg font-semibold">No schedule yet</h2>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                Generate the round-robin schedule based on the players you've added.
              </p>
              <Button
                size="lg"
                className="mt-6"
                onClick={handleGenerate}
                disabled={generating}
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    Generate schedule
                  </>
                )}
              </Button>
              <p className="mt-3 text-xs text-muted-foreground">
                {eventPlayers.length}{" "}
                {eventPlayers.length === 1 ? "player" : "players"} ready
              </p>
            </Card>
          ) : (
            <>
              <RoundNavigator
                current={currentRound}
                total={totalRounds}
                liveRound={liveRound}
                liveRoundIsPlaying={liveRoundIsPlaying}
                onChange={setCurrentRound}
                roundSummaries={roundSummaries}
              />

              <div className="space-y-3">
                {matchesInCurrentRound.length === 0 ? (
                  <p className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                    No matches in this round.
                  </p>
                ) : (
                  matchesInCurrentRound.map((m) => (
                    <MatchCard
                      key={m.id}
                      match={m}
                      playersById={playersById}
                      onClick={() => setOpenMatchId(m.id)}
                    />
                  ))
                )}

                {event.status === "live" &&
                  totalRounds > 0 &&
                  currentRound === totalRounds && (
                    <div className="rounded-lg border border-dashed bg-muted/20 p-3 text-sm">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="font-medium">Need more play?</div>
                          <div className="text-xs text-muted-foreground">
                            Adds just enough matches for everyone to play once more. Tap again to keep going.
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={addingRounds}
                          onClick={async () => {
                            if (!event) return;
                            setAddingRounds(true);
                            try {
                              const r = await appendOneRotation(event.id);
                              if (r.matchesAdded > 0) {
                                toast.success("Rounds added", {
                                  description: `${r.matchesAdded} new match${
                                    r.matchesAdded === 1 ? "" : "es"
                                  } across ${r.rounds - totalRounds} round${
                                    r.rounds - totalRounds === 1 ? "" : "s"
                                  }.`,
                                });
                                await loadAll();
                              } else {
                                toast.info("Nothing to add — no eligible players.");
                              }
                            } catch (err) {
                              const msg =
                                err instanceof Error
                                  ? err.message
                                  : "Unknown error";
                              toast.error("Couldn't add rounds", {
                                description: msg,
                              });
                            } finally {
                              setAddingRounds(false);
                            }
                          }}
                        >
                          {addingRounds ? "Adding…" : "Play another round"}
                        </Button>
                      </div>
                    </div>
                  )}

                {(() => {
                  const playingIds = new Set<string>();
                  for (const m of matchesInCurrentRound) {
                    for (const id of m.side_a_player_ids) playingIds.add(id);
                    for (const id of m.side_b_player_ids) playingIds.add(id);
                  }
                  const byes = eventPlayers
                    .filter((ep) => !ep.withdrawn)
                    .filter((ep) => !playingIds.has(ep.player_id))
                    .map(
                      (ep) => playersById[ep.player_id]?.full_name ?? "Unknown"
                    )
                    .sort((a, b) =>
                      a.localeCompare(b, undefined, { sensitivity: "base" })
                    );
                  if (byes.length === 0) return null;
                  return (
                    <div className="rounded-lg border border-dashed bg-muted/30 p-3">
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Bye this round · {byes.length}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {byes.join(", ")}
                      </p>
                    </div>
                  );
                })()}
              </div>
            </>
          )}
        </>
      )}

      {tab === "standings" && (
        <>
          <StandingsTable
            standings={computeStandings(
              eventPlayers.map((ep) => ep.player_id),
              matches,
              ((event.config as { tiebreakers?: Tiebreaker[] }).tiebreakers ?? [
                "wins",
                "h2h",
                "point_diff",
                "points_for",
              ]) as Tiebreaker[]
            )}
            playersById={playersById}
            eventPlayers={eventPlayers}
            onPlayerClick={(playerId) => {
              const ep = eventPlayers.find((x) => x.player_id === playerId);
              if (ep) setOpenPlayerEpId(ep.id);
            }}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            Tiebreakers (in order):{" "}
            {(
              ((event.config as { tiebreakers?: string[] }).tiebreakers ?? [
                "wins",
                "h2h",
                "point_diff",
                "points_for",
              ]) as string[]
            )
              .map(tiebreakerLabel)
              .join(" → ")}
          </p>
        </>
      )}

      {tab === "bracket" && (
        <>
          {(() => {
            const hasKnockout = matches.some((m) => m.stage !== "group_rr");
            if (!hasKnockout) {
              return (
                <Card className="flex flex-col items-center px-6 py-12 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Swords className="h-6 w-6" />
                  </div>
                  <h2 className="text-lg font-semibold">Playoffs not started</h2>
                  <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                    Once enough round-robin matches are done, you can end group play and start the bracket.
                  </p>
                  {event.status === "live" && (
                    <Button
                      size="lg"
                      className="mt-6"
                      onClick={() => setStartingKnockout(true)}
                    >
                      <Sparkles className="h-4 w-4" />
                      Start playoffs
                    </Button>
                  )}
                </Card>
              );
            }
            return (
              <BracketView
                matches={matches}
                playersById={playersById}
                onMatchClick={(id) => setOpenMatchId(id)}
              />
            );
          })()}
        </>
      )}

      {tab === "roster" && (() => {
        const reorderable = matches.every(
          (m) => m.status === "scheduled" || m.status === "cancelled"
        );

        const sorted = [...eventPlayers].map((ep) => ({
          ep,
          name: playersById[ep.player_id]?.full_name ?? "Unknown",
        }));
        if (reorderable) {
          sorted.sort((a, b) => (a.ep.seed ?? 999) - (b.ep.seed ?? 999));
        } else {
          sorted.sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
          );
        }

        // Optimistic reorder: update eventPlayers state immediately so the
        // list visibly settles in place, then fire DB updates in parallel.
        // No `loadAll()` afterward — that would reset scroll + re-fetch
        // unnecessarily.
        const applyReorder = (fromIdx: number, toIdx: number) => {
          if (fromIdx === toIdx) return;
          const orderedIds = sorted.map((s) => s.ep.id);
          const [moved] = orderedIds.splice(fromIdx, 1);
          // After splice removal, an insertion at toIdx places the item just
          // before the row that was originally at toIdx. We want "drop above
          // row N" to land AT N (above), and "drop below row N" to land at
          // N+1. The caller passes the desired final index directly.
          const clamped = Math.max(0, Math.min(toIdx, orderedIds.length));
          orderedIds.splice(clamped, 0, moved);

          // Optimistic local state update — assign new seeds 1..N.
          setEventPlayers((prev) => {
            const byId: Record<string, EventPlayer> = {};
            for (const p of prev) byId[p.id] = p;
            const result: EventPlayer[] = [];
            orderedIds.forEach((id, i) => {
              const ep = byId[id];
              if (ep) result.push({ ...ep, seed: i + 1 });
            });
            return result;
          });

          // Fire-and-forget bulk DB write (parallel)
          Promise.all(
            orderedIds.map((id, i) =>
              supabase.from("rr_event_players").update({ seed: i + 1 }).eq("id", id)
            )
          ).catch((err) => {
            const msg = err instanceof Error ? err.message : "Unknown error";
            toast.error("Couldn't save reorder", { description: msg });
            void loadAll();
          });
        };

        return (
          <>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {eventPlayers.length} player{eventPlayers.length === 1 ? "" : "s"}
                {!reorderable && " · alphabetical"}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAddingPlayer(true)}
              >
                <UserPlus className="h-4 w-4" />
                Add player
              </Button>
            </div>
            <Card className="overflow-hidden">
              {eventPlayers.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                  No players yet. Tap "Add player" above to get started.
                </p>
              ) : (
                <ul className="divide-y">
                  {sorted.map(({ ep, name }, idx) => {
                    const isDragging = draggingEpId === ep.id;
                    const hoverState = hoverEpId === ep.id ? hoverEdge : null;
                    return (
                    <li
                      key={ep.id}
                      draggable={reorderable}
                      onDragStart={(e) => {
                        if (!reorderable) return;
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", ep.id);
                        setDraggingEpId(ep.id);
                      }}
                      onDragOver={(e) => {
                        if (!reorderable || !draggingEpId) return;
                        if (draggingEpId === ep.id) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        // Use cursor Y vs row midpoint to pick "above" or "below"
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const midY = rect.top + rect.height / 2;
                        const edge: "above" | "below" = e.clientY < midY ? "above" : "below";
                        if (hoverEpId !== ep.id || hoverEdge !== edge) {
                          setHoverEpId(ep.id);
                          setHoverEdge(edge);
                        }
                      }}
                      onDragLeave={() => {
                        if (hoverEpId === ep.id) {
                          setHoverEpId(null);
                          setHoverEdge(null);
                        }
                      }}
                      onDrop={(e) => {
                        if (!reorderable || !draggingEpId) return;
                        e.preventDefault();
                        const fromIdx = sorted.findIndex(
                          (s) => s.ep.id === draggingEpId
                        );
                        if (fromIdx >= 0) {
                          // Edge "above" → land at idx; "below" → land at idx + 1.
                          // Then if we removed a row before that target, decrement
                          // the target by 1 to keep the visual landing position.
                          let target = hoverEdge === "below" ? idx + 1 : idx;
                          if (fromIdx < target) target -= 1;
                          applyReorder(fromIdx, target);
                        }
                        setDraggingEpId(null);
                        setHoverEpId(null);
                        setHoverEdge(null);
                      }}
                      onDragEnd={() => {
                        setDraggingEpId(null);
                        setHoverEpId(null);
                        setHoverEdge(null);
                      }}
                      className={cn(
                        "group flex items-center gap-2 px-3 py-2 transition-colors",
                        isDragging && "opacity-40",
                        hoverState === "above" && "border-t-2 border-primary",
                        hoverState === "below" && "border-b-2 border-primary"
                      )}
                    >
                      {reorderable && (
                        <span
                          className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
                          aria-hidden
                          title="Drag to reorder"
                        >
                          <GripVertical className="h-4 w-4" />
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setOpenPlayerEpId(ep.id)}
                        className="flex flex-1 items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {reorderable && (
                            <span className="text-xs tabular-nums text-muted-foreground">
                              #{ep.seed ?? "—"}
                            </span>
                          )}
                          <span
                            className={cn(
                              "truncate text-sm",
                              ep.withdrawn && "text-muted-foreground line-through"
                            )}
                          >
                            {name}
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          {ep.withdrawn && (
                            <Badge variant="forfeit">Withdrawn</Badge>
                          )}
                          <span
                            aria-hidden
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors group-hover:bg-accent group-hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </span>
                        </span>
                      </button>
                    </li>
                    );
                  })}
                </ul>
              )}
            </Card>
            <p className="mt-3 text-xs text-muted-foreground">
              {reorderable
                ? "Drag the grip handle to reorder seeding. Higher in the list = top seed. Locked once any match is played."
                : "Sorted alphabetically. Seeding is locked once any match has been played."}
            </p>
          </>
        );
      })()}

      {(() => {
        const ep = eventPlayers.find((x) => x.id === openPlayerEpId) ?? null;
        const p = ep ? playersById[ep.player_id] ?? null : null;
        return (
          <PlayerDetailSheet
            open={openPlayerEpId !== null}
            onClose={() => setOpenPlayerEpId(null)}
            event={event}
            eventPlayer={ep}
            player={p}
            matches={matches}
            playersById={playersById}
            liveRound={liveRound}
            onChanged={loadAll}
            onSwapClick={(pid) => {
              setOpenPlayerEpId(null);
              setSwappingPlayerId(pid);
            }}
          />
        );
      })()}

      {(() => {
        const m = matches.find((x) => x.id === openMatchId) ?? null;
        return (
          <ScoreSheet
            open={openMatchId !== null}
            onClose={() => setOpenMatchId(null)}
            match={m}
            scoring={event.scoring_template as ScoringTemplate}
            playersById={playersById}
            onSaved={handleScoreSaved}
            allMatches={matches}
            liveRound={liveRound}
            onSubstituteClick={(side, outgoingPlayerId) => {
              if (m) {
                setSubbingMatchId(m.id);
                setSubbingSide(side);
                setSubbingOutgoingId(outgoingPlayerId);
                setOpenMatchId(null);
              }
            }}
          />
        );
      })()}

      <EventEditSheet
        open={editingEvent}
        onClose={() => setEditingEvent(false)}
        event={event}
        hasMatches={matches.length > 0}
        hasScores={matches.some(
          (m) => m.status === "completed" || m.scores != null
        )}
        onSaved={handleRosterOrSettingsChanged}
      />

      <RosterAddSheet
        open={addingPlayer}
        onClose={() => setAddingPlayer(false)}
        eventId={event.id}
        eventMode={event.mode}
        hasSchedule={matches.length > 0}
        existingPlayerIds={eventPlayers.map((ep) => ep.player_id)}
        liveRound={liveRound}
        onAdded={handleRosterOrSettingsChanged}
      />

      <FinalizeEventSheet
        open={finalizing}
        onClose={() => setFinalizing(false)}
        event={event}
        matches={matches}
        onFinalized={loadAll}
      />

      <StartKnockoutSheet
        open={startingKnockout}
        onClose={() => setStartingKnockout(false)}
        event={event}
        matches={matches}
        eventPlayers={eventPlayers}
        playersById={playersById}
        onStarted={loadAll}
      />

      <PlayerSwapSheet
        open={swappingPlayerId !== null}
        onClose={() => setSwappingPlayerId(null)}
        fromPlayerId={swappingPlayerId}
        eventId={event.id}
        eventPlayers={eventPlayers}
        matches={matches}
        playersById={playersById}
        onSwapped={handleRosterOrSettingsChanged}
      />

      {(() => {
        const subMatch =
          matches.find((x) => x.id === subbingMatchId) ?? null;
        return (
          <MatchSubstituteSheet
            open={subbingMatchId !== null && subbingSide !== null}
            onClose={() => {
              setSubbingMatchId(null);
              setSubbingSide(null);
              setSubbingOutgoingId(null);
            }}
            match={subMatch}
            side={subbingSide}
            outgoingPlayerId={subbingOutgoingId}
            eventPlayers={eventPlayers}
            playersById={playersById}
            onSaved={loadAll}
          />
        );
      })()}
    </div>
  );
}

function TabButton({
  children,
  active,
  onClick,
}: {
  children: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-background shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function tiebreakerLabel(tb: string): string {
  switch (tb) {
    case "wins":
      return "Wins";
    case "h2h":
      return "Head-to-head";
    case "point_diff":
      return "Point diff";
    case "points_for":
      return "Points scored";
    case "points_against":
      return "Points conceded";
    default:
      return tb;
  }
}

function EventStatusBadge({ status }: { status: EventRow["status"] }) {
  if (status === "draft") return <Badge variant="draft">Draft</Badge>;
  if (status === "live") return <Badge variant="live">Live</Badge>;
  if (status === "completed") return <Badge variant="completed">Completed</Badge>;
  return <Badge variant="outline">Archived</Badge>;
}
