import { useEffect, useMemo, useState, Fragment, type ReactNode } from "react";
import {
  Check,
  Flag,
  Loader2,
  Trash2,
  FastForward,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type {
  MatchRow,
  MatchStatus,
  Player,
  ScoringTemplate,
  WinnerSide,
} from "@/types/database";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { WinLossEntry } from "@/components/score/WinLossEntry";
import { PointsEntry } from "@/components/score/PointsEntry";
import { SetsEntry, type SetScore } from "@/components/score/SetsEntry";

interface ScoreSheetProps {
  open: boolean;
  onClose: () => void;
  match: MatchRow | null;
  scoring: ScoringTemplate;
  playersById: Record<string, Player>;
  onSaved: () => Promise<void> | void;
  /** All event matches — used to detect player conflicts when bringing
   *  a future match forward to play now. */
  allMatches?: MatchRow[];
  /** Earliest round that still has incomplete matches. */
  liveRound?: number | null;
  /** Triggered when the user wants to substitute a specific player out of
   *  this match. The outgoing player ID is passed so the substitute sheet
   *  can skip the "who's leaving?" step. */
  onSubstituteClick?: (side: "a" | "b", outgoingPlayerId: string) => void;
  /** When false, render the sheet read-only: hide save/clear/forfeit/play-now,
   *  disable score inputs, and don't expose the substitute-player action.
   *  Non-scorers can still open the sheet to view the score. Defaults to true. */
  canScore?: boolean;
}

interface DraftScores {
  // Used by first_to_points and timed
  pointsA: number;
  pointsB: number;
  // Used by best_of_sets
  sets: SetScore[];
  // win_loss only — explicit pick
  winLossPick: WinnerSide | null;
}

function emptyDraft(scoring: ScoringTemplate): DraftScores {
  if (scoring.type === "best_of_sets") {
    return {
      pointsA: 0,
      pointsB: 0,
      sets: Array.from({ length: scoring.sets }, () => ({ side_a: 0, side_b: 0 })),
      winLossPick: null,
    };
  }
  return { pointsA: 0, pointsB: 0, sets: [], winLossPick: null };
}

/** Read scores out of a stored match into the draft shape, if present. */
function draftFromMatch(match: MatchRow, scoring: ScoringTemplate): DraftScores {
  const empty = emptyDraft(scoring);
  const s = match.scores;
  if (!s || typeof s !== "object") {
    if (scoring.type === "win_loss") empty.winLossPick = match.winner_side;
    return empty;
  }
  const obj = s as Record<string, unknown>;

  if (scoring.type === "best_of_sets") {
    const stored = Array.isArray(obj.sets) ? (obj.sets as SetScore[]) : [];
    const merged = empty.sets.map(
      (slot, i) => stored[i] ?? slot
    );
    return { ...empty, sets: merged };
  }

  if (scoring.type === "first_to_points" || scoring.type === "timed") {
    return {
      ...empty,
      pointsA: typeof obj.side_a === "number" ? obj.side_a : 0,
      pointsB: typeof obj.side_b === "number" ? obj.side_b : 0,
    };
  }

  if (scoring.type === "win_loss") {
    return { ...empty, winLossPick: match.winner_side };
  }

  return empty;
}

/** Determine winner_side and a JSONB scores blob from the draft. */
function resolveOutcome(
  draft: DraftScores,
  scoring: ScoringTemplate
): { winner: WinnerSide | null; scores: Record<string, unknown> | null } {
  if (scoring.type === "win_loss") {
    return { winner: draft.winLossPick, scores: null };
  }

  if (scoring.type === "first_to_points" || scoring.type === "timed") {
    const a = draft.pointsA;
    const b = draft.pointsB;
    let winner: WinnerSide | null = null;
    if (a > b) winner = "a";
    else if (b > a) winner = "b";
    else if (a > 0 || b > 0) winner = "draw";
    return { winner, scores: { side_a: a, side_b: b } };
  }

  if (scoring.type === "best_of_sets") {
    let setsA = 0;
    let setsB = 0;
    for (const set of draft.sets) {
      if (set.side_a > set.side_b) setsA++;
      else if (set.side_b > set.side_a) setsB++;
    }
    let winner: WinnerSide | null = null;
    if (setsA > setsB) winner = "a";
    else if (setsB > setsA) winner = "b";
    return {
      winner,
      scores: {
        side_a: setsA,
        side_b: setsB,
        sets: draft.sets,
      },
    };
  }

  return { winner: null, scores: null };
}

export function ScoreSheet({
  open,
  onClose,
  match,
  scoring,
  playersById,
  onSaved,
  allMatches,
  liveRound,
  onSubstituteClick,
  canScore = true,
}: ScoreSheetProps) {
  const [draft, setDraft] = useState<DraftScores>(() => emptyDraft(scoring));
  const [saving, setSaving] = useState(false);
  const [confirmingForfeit, setConfirmingForfeit] = useState<"a" | "b" | null>(
    null
  );
  const [movingForward, setMovingForward] = useState(false);

  useEffect(() => {
    if (open && match) {
      setDraft(draftFromMatch(match, scoring));
      setConfirmingForfeit(null);
    }
  }, [open, match, scoring]);

  const sideAName = useMemo(
    () =>
      match
        ? renderSide(match.side_a_player_ids, playersById)
        : "",
    [match, playersById]
  );
  const sideBName = useMemo(
    () =>
      match
        ? renderSide(match.side_b_player_ids, playersById)
        : "",
    [match, playersById]
  );

  if (!match) return null;

  const isCompleted = match.status === "completed";
  const isFutureScheduled =
    match.status === "scheduled" &&
    liveRound != null &&
    match.round > liveRound;

  // Detect conflicts before allowing "Play now" — if any of this match's
  // players are already in a current-round match, we can't pull this one
  // forward without overlapping bookings.
  const playNowConflicts = (() => {
    if (!isFutureScheduled || !allMatches || liveRound == null) return [];
    const here = new Set([
      ...match.side_a_player_ids,
      ...match.side_b_player_ids,
    ]);
    return allMatches.filter((m) => {
      if (m.id === match.id) return false;
      if (m.round !== liveRound) return false;
      if (m.status !== "scheduled" && m.status !== "in_progress") return false;
      const players = [...m.side_a_player_ids, ...m.side_b_player_ids];
      return players.some((p) => here.has(p));
    });
  })();

  const handleMoveToCurrent = async () => {
    if (movingForward || !match || liveRound == null) return;
    if (playNowConflicts.length > 0) {
      toast.error("Can't move yet — players are double-booked", {
        description: `${playNowConflicts.length} match${
          playNowConflicts.length === 1 ? "" : "es"
        } in round ${liveRound} already use one of these players.`,
      });
      return;
    }
    setMovingForward(true);
    try {
      const { error } = await supabase
        .from("rr_matches")
        .update({ round: liveRound })
        .eq("id", match.id);
      if (error) throw error;
      toast.success("Pulled forward to current round", {
        description: "Tap the match to enter the score when it's done.",
      });
      onClose();
      await onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Couldn't move match", { description: msg });
    } finally {
      setMovingForward(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    const { winner, scores } = resolveOutcome(draft, scoring);
    if (!winner) {
      toast.error("Pick a winner first.");
      return;
    }
    setSaving(true);
    try {
      const before = { ...match };
      const { error } = await supabase
        .from("rr_matches")
        .update({
          status: "completed" as MatchStatus,
          winner_side: winner,
          scores,
          completed_at: new Date().toISOString(),
        })
        .eq("id", match.id);
      if (error) throw error;

      toast.success("Score saved", {
        action: {
          label: "Undo",
          onClick: async () => {
            await supabase
              .from("rr_matches")
              .update({
                status: before.status,
                winner_side: before.winner_side,
                scores: before.scores,
                completed_at: before.completed_at,
              })
              .eq("id", before.id);
            toast.info("Score reverted");
            await onSaved();
          },
        },
      });
      onClose();
      await onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Couldn't save score", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleForfeit = async (forfeitedSide: "a" | "b") => {
    if (saving) return;
    setSaving(true);
    try {
      const before = { ...match };
      const newStatus: MatchStatus = forfeitedSide === "a" ? "forfeit_a" : "forfeit_b";
      const winner: WinnerSide = forfeitedSide === "a" ? "b" : "a";
      const { error } = await supabase
        .from("rr_matches")
        .update({
          status: newStatus,
          winner_side: winner,
          scores: null,
          completed_at: new Date().toISOString(),
        })
        .eq("id", match.id);
      if (error) throw error;
      toast.success("Forfeit recorded", {
        description: "Forfeits don't affect ratings.",
        action: {
          label: "Undo",
          onClick: async () => {
            await supabase
              .from("rr_matches")
              .update({
                status: before.status,
                winner_side: before.winner_side,
                scores: before.scores,
                completed_at: before.completed_at,
              })
              .eq("id", before.id);
            toast.info("Forfeit reverted");
            await onSaved();
          },
        },
      });
      onClose();
      await onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Couldn't record forfeit", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const before = { ...match };
      const { error } = await supabase
        .from("rr_matches")
        .update({
          status: "scheduled" as MatchStatus,
          winner_side: null,
          scores: null,
          completed_at: null,
        })
        .eq("id", match.id);
      if (error) throw error;
      toast.success("Score cleared", {
        action: {
          label: "Undo",
          onClick: async () => {
            await supabase
              .from("rr_matches")
              .update({
                status: before.status,
                winner_side: before.winner_side,
                scores: before.scores,
                completed_at: before.completed_at,
              })
              .eq("id", before.id);
            toast.info("Restored");
            await onSaved();
          },
        },
      });
      onClose();
      await onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Couldn't clear score", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  // Side header rendering helper
  const SideName = ({
    content,
    side,
  }: {
    content: ReactNode;
    side: "a" | "b";
  }) => (
    <div className="flex items-center justify-between gap-2">
      {content}
      {canScore && confirmingForfeit === null && (
        <button
          type="button"
          onClick={() => setConfirmingForfeit(side)}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Forfeit
        </button>
      )}
    </div>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Round ${match.round} · Court ${match.court ?? "?"}`}
      description={
        scoring.type === "win_loss"
          ? "Pick the winner."
          : scoring.type === "first_to_points"
          ? `First to ${scoring.points_to}, win by ${scoring.win_by}.`
          : scoring.type === "best_of_sets"
          ? `Best of ${scoring.sets} sets to ${scoring.set_to}.`
          : scoring.type === "timed"
          ? `${scoring.minutes}-minute match — record final scores.`
          : "Custom scoring"
      }
      footer={
        !canScore ? null : confirmingForfeit !== null ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => setConfirmingForfeit(null)}
              disabled={saving}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleForfeit(confirmingForfeit)}
              disabled={saving}
              className="flex-1"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Flag className="h-4 w-4" />
              )}
              Confirm forfeit
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            {isCompleted && (
              <Button
                variant="outline"
                onClick={handleClear}
                disabled={saving}
                className="sm:flex-1"
              >
                <Trash2 className="h-4 w-4" />
                Clear score
              </Button>
            )}
            <Button onClick={handleSave} disabled={saving} className="flex-1">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {isCompleted ? "Save changes" : "Save"}
            </Button>
          </div>
        )
      }
    >
      {confirmingForfeit !== null ? (
        <div className="space-y-3">
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-medium">
              Forfeit {confirmingForfeit === "a" ? sideAName : sideBName}?
            </p>
            <p className="mt-1 text-muted-foreground">
              The other side wins this match. Forfeits don't affect Glicko-2 ratings.
            </p>
          </div>
        </div>
      ) : (
        <>
          {canScore && isFutureScheduled && (
            <div
              className={cn(
                "mb-4 flex flex-col gap-3 rounded-lg border p-3 text-sm sm:flex-row sm:items-center sm:justify-between",
                playNowConflicts.length > 0
                  ? "border-forfeit/40 bg-forfeit/5"
                  : "border-primary/30 bg-accent"
              )}
            >
              <div className="min-w-0">
                <p className="font-medium">
                  This match is in round {match.round}.
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {playNowConflicts.length > 0
                    ? `Can't move yet — ${playNowConflicts.length} round-${liveRound} match${
                        playNowConflicts.length === 1 ? "" : "es"
                      } already use one of these players.`
                    : `Pull it forward to round ${liveRound} if a court is free.`}
                </p>
              </div>
              <Button
                size="sm"
                variant={playNowConflicts.length > 0 ? "outline" : "default"}
                onClick={handleMoveToCurrent}
                disabled={movingForward || playNowConflicts.length > 0}
                className="shrink-0"
              >
                {movingForward ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FastForward className="h-4 w-4" />
                )}
                Play now
              </Button>
            </div>
          )}
          {!canScore && (
            <div className="mb-4 rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
              You don't have permission to enter scores on this event. An organizer can assign you as a scorekeeper.
            </div>
          )}
          <fieldset disabled={!canScore} className={cn(!canScore && "opacity-90")}>
          {(() => {
            // Tappable player names — tap to open the substitute sheet for
            // exactly that player on exactly that side. We skip wiring up
            // the buttons when the match is completed or no callback exists.
            const renderPlayers = (
              ids: string[],
              side: "a" | "b"
            ): ReactNode => (
              <span className="inline-flex flex-wrap items-baseline gap-0.5">
                {ids.map((id, i) => {
                  const name = playersById[id]?.full_name ?? "Unknown";
                  const interactive = canScore && onSubstituteClick && !isCompleted;
                  return (
                    <Fragment key={id}>
                      {i > 0 && (
                        <span className="text-xs text-muted-foreground">+</span>
                      )}
                      {interactive ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSubstituteClick!(side, id);
                          }}
                          className="rounded px-1 py-0.5 text-sm font-medium underline decoration-dotted decoration-muted-foreground/50 underline-offset-4 hover:bg-accent hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          title={`Substitute ${name}`}
                        >
                          {name}
                        </button>
                      ) : (
                        <span className="text-sm font-medium">{name}</span>
                      )}
                                      </Fragment>
                  );
                })}
              </span>
            );

            const sideAContent = renderPlayers(match.side_a_player_ids, "a");
            const sideBContent = renderPlayers(match.side_b_player_ids, "b");

            if (scoring.type === "win_loss") {
              return (
                <WinLossEntry
                  sideAContent={sideAContent}
                  sideBContent={sideBContent}
                  pick={draft.winLossPick}
                  onPick={(p) => setDraft({ ...draft, winLossPick: p })}
                />
              );
            }
            if (
              scoring.type === "first_to_points" ||
              scoring.type === "timed"
            ) {
              return (
                <PointsEntry
                  sideAContent={sideAContent}
                  sideBContent={sideBContent}
                  a={draft.pointsA}
                  b={draft.pointsB}
                  onA={(v) => setDraft({ ...draft, pointsA: v })}
                  onB={(v) => setDraft({ ...draft, pointsB: v })}
                  renderSideHeader={(content, side) => (
                    <SideName content={content} side={side} />
                  )}
                />
              );
            }
            if (scoring.type === "best_of_sets") {
              return (
                <SetsEntry
                  sideAContent={sideAContent}
                  sideBContent={sideBContent}
                  sets={draft.sets}
                  onChange={(sets) => setDraft({ ...draft, sets })}
                  renderSideHeader={(content, side) => (
                    <SideName content={content} side={side} />
                  )}
                />
              );
            }
            return (
              <p className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                Custom scoring isn't ready yet. Coming soon.
              </p>
            );
          })()}
          </fieldset>
        </>
      )}
    </Sheet>
  );
}

function renderSide(playerIds: string[], playersById: Record<string, Player>): string {
  return playerIds.map((id) => playersById[id]?.full_name ?? "Unknown").join(" + ");
}
