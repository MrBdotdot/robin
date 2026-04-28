import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Check,
  Loader2,
  Pencil,
  Repeat,
  Trash2,
  Users as UsersIcon,
  Swords,
  X as XIcon,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { computePlayerStats, formatRecord, type H2HRecord } from "@/lib/stats";
import type {
  EventPlayer,
  EventRow,
  MatchRow,
  Player,
} from "@/types/database";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";

interface PlayerDetailSheetProps {
  open: boolean;
  onClose: () => void;
  event: EventRow;
  eventPlayer: EventPlayer | null;
  player: Player | null;
  matches: MatchRow[];
  playersById: Record<string, Player>;
  liveRound: number | null;
  onChanged: () => Promise<void> | void;
  /** Optional: triggered when user wants to swap this player out for someone else. */
  onSwapClick?: (playerId: string) => void;
}

export function PlayerDetailSheet({
  open,
  onClose,
  event,
  eventPlayer,
  player,
  matches,
  playersById,
  liveRound,
  onChanged,
  onSwapClick,
}: PlayerDetailSheetProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Reset transient UI state whenever the sheet target changes
  useEffect(() => {
    if (player) setName(player.full_name);
    setEditing(false);
    setConfirmingDelete(false);
  }, [player?.id, open]);

  const stats = useMemo(
    () => (player ? computePlayerStats(player.id, matches) : null),
    [player, matches]
  );

  if (!player || !eventPlayer || !stats) return null;

  const isDoubles = event.mode === "doubles_americano";
  const eventCompleted = event.status === "completed" || event.status === "archived";
  const hasMatches = matches.length > 0;
  // If there are no matches yet (draft event), "delete" actually removes the row.
  // Otherwise, withdrawing forfeits future matches.
  const willHardDelete = !hasMatches;

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Name can't be empty");
      return;
    }
    if (trimmed === player.full_name) {
      setEditing(false);
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
      description: "This player's name is updated everywhere they appear.",
    });
    setEditing(false);
    await onChanged();
  };

  const removeOrWithdraw = async () => {
    setSaving(true);
    try {
      if (willHardDelete) {
        // No matches yet — just remove from event
        const { error } = await supabase
          .from("rr_event_players")
          .delete()
          .eq("id", eventPlayer.id);
        if (error) throw error;
        toast.success("Removed from event");
      } else {
        // Mark withdrawn
        const { error: epErr } = await supabase
          .from("rr_event_players")
          .update({
            withdrawn: true,
            withdrawn_at_round: liveRound ?? null,
          })
          .eq("id", eventPlayer.id);
        if (epErr) throw epErr;

        // Forfeit all future scheduled / in-progress matches involving them
        const future = matches.filter(
          (m) =>
            (m.status === "scheduled" || m.status === "in_progress") &&
            (m.side_a_player_ids.includes(player.id) ||
              m.side_b_player_ids.includes(player.id))
        );

        for (const m of future) {
          const onSideA = m.side_a_player_ids.includes(player.id);
          await supabase
            .from("rr_matches")
            .update({
              status: onSideA ? "forfeit_a" : "forfeit_b",
              winner_side: onSideA ? "b" : "a",
              completed_at: new Date().toISOString(),
            })
            .eq("id", m.id);
        }

        toast.success("Player withdrawn", {
          description:
            future.length === 0
              ? "No future matches were affected."
              : `${future.length} future match${
                  future.length === 1 ? "" : "es"
                } forfeited.`,
        });
      }
      onClose();
      await onChanged();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Couldn't remove player", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? "Edit player" : player.full_name}
      description={
        editing
          ? "Renaming this player updates them in every event they're in."
          : seedAndStatusLine(eventPlayer)
      }
      footer={
        eventCompleted ? null : confirmingDelete ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => setConfirmingDelete(false)}
              disabled={saving}
              className="flex-1"
            >
              <XIcon className="h-4 w-4" />
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={removeOrWithdraw}
              disabled={saving}
              className="flex-1"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {willHardDelete ? "Remove player" : "Confirm withdraw"}
            </Button>
          </div>
        ) : editing ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => {
                setEditing(false);
                setName(player.full_name);
              }}
              disabled={saving}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button onClick={saveName} disabled={saving} className="flex-1">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Save
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                onClick={() => setEditing(true)}
                className="flex-1"
                disabled={eventPlayer.withdrawn}
              >
                <Pencil className="h-4 w-4" />
                Edit name
              </Button>
              {hasMatches && onSwapClick && !eventPlayer.withdrawn && (
                <Button
                  variant="outline"
                  onClick={() => onSwapClick(player.id)}
                  className="flex-1"
                >
                  <Repeat className="h-4 w-4" />
                  Swap
                </Button>
              )}
            </div>
            <Button
              variant="destructive"
              onClick={() => setConfirmingDelete(true)}
              className="w-full"
              disabled={eventPlayer.withdrawn}
            >
              <Trash2 className="h-4 w-4" />
              {willHardDelete ? "Remove from event" : "Withdraw"}
            </Button>
          </div>
        )
      }
    >
      {editing ? (
        <div className="space-y-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="Full name"
            onKeyDown={(e) => {
              if (e.key === "Enter") saveName();
            }}
          />
          <p className="text-xs text-muted-foreground">
            Their match history and ratings will follow the new name.
          </p>
        </div>
      ) : confirmingDelete ? (
        <ConfirmDeleteContent
          willHardDelete={willHardDelete}
          futureMatchesCount={
            matches.filter(
              (m) =>
                (m.status === "scheduled" || m.status === "in_progress") &&
                (m.side_a_player_ids.includes(player.id) ||
                  m.side_b_player_ids.includes(player.id))
            ).length
          }
        />
      ) : (
        <PlayerStatsContent
          player={player}
          stats={stats}
          isDoubles={isDoubles}
          playersById={playersById}
        />
      )}
    </Sheet>
  );
}

function seedAndStatusLine(ep: EventPlayer): string {
  const parts: string[] = [];
  if (ep.seed != null) parts.push(`Seed #${ep.seed}`);
  if (ep.withdrawn) parts.push("Withdrawn");
  if (ep.joined_at_round && ep.joined_at_round > 0) {
    parts.push(`Joined round ${ep.joined_at_round}`);
  }
  return parts.join(" · ");
}

// =================== Sub-views ===================

function PlayerStatsContent({
  player,
  stats,
  isDoubles,
  playersById,
}: {
  player: Player;
  stats: ReturnType<typeof computePlayerStats>;
  isDoubles: boolean;
  playersById: Record<string, Player>;
}) {
  const rating = isDoubles
    ? player.glicko_doubles_rating
    : player.glicko_singles_rating;
  const rd = isDoubles ? player.glicko_doubles_rd : player.glicko_singles_rd;

  return (
    <div className="space-y-6">
      {/* Rating */}
      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {isDoubles ? "Doubles rating" : "Singles rating"}
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

      {/* Total record */}
      <div className="grid grid-cols-3 gap-2">
        <StatCell label="Wins" value={stats.totalWins} />
        <StatCell label="Losses" value={stats.totalLosses} />
        <StatCell label="Upcoming" value={stats.upcoming} />
      </div>

      {stats.forfeited > 0 && (
        <p className="text-xs text-muted-foreground">
          {stats.forfeited} match{stats.forfeited === 1 ? "" : "es"} were forfeited or walked over.
        </p>
      )}

      {/* H2H */}
      <Section
        icon={<Swords className="h-4 w-4" />}
        title="Head to head"
        empty={stats.h2h.size === 0 ? "No completed matches yet." : null}
      >
        {stats.h2h.size > 0 && (
          <RecordList
            records={stats.h2h}
            playersById={playersById}
            colorClass="text-rose-700 dark:text-rose-300"
          />
        )}
      </Section>

      {/* Partnerships (doubles only) */}
      {isDoubles && (
        <Section
          icon={<UsersIcon className="h-4 w-4" />}
          title="Partner record"
          empty={
            stats.partnerships.size === 0
              ? "No completed doubles matches yet."
              : null
          }
        >
          {stats.partnerships.size > 0 && (
            <RecordList
              records={stats.partnerships}
              playersById={playersById}
              colorClass="text-emerald-700 dark:text-emerald-300"
            />
          )}
        </Section>
      )}
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-background p-3 text-center">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Section({
  icon,
  title,
  empty,
  children,
}: {
  icon: ReactNode;
  title: string;
  empty: string | null;
  children?: ReactNode;
}) {
  return (
    <div>
      <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
      </h4>
      {empty ? (
        <p className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        children
      )}
    </div>
  );
}

function RecordList({
  records,
  playersById,
  colorClass,
}: {
  records: Map<string, H2HRecord>;
  playersById: Record<string, Player>;
  colorClass?: string;
}) {
  // Sort: most matches played first, then by wins
  const entries = Array.from(records.entries()).sort((a, b) => {
    if (b[1].played !== a[1].played) return b[1].played - a[1].played;
    return b[1].wins - a[1].wins;
  });

  return (
    <ul className="divide-y rounded-md border">
      {entries.map(([id, r]) => (
        <li
          key={id}
          className="flex items-center justify-between px-3 py-2 text-sm"
        >
          <span className={`truncate ${colorClass ?? ""}`}>
            {playersById[id]?.full_name ?? "Unknown"}
          </span>
          <div className="flex items-center gap-3 tabular-nums">
            <span className="text-muted-foreground">{r.played} played</span>
            <span className={`font-semibold ${colorClass ?? ""}`}>
              {formatRecord(r)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ConfirmDeleteContent({
  willHardDelete,
  futureMatchesCount,
}: {
  willHardDelete: boolean;
  futureMatchesCount: number;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="text-sm">
          {willHardDelete ? (
            <>
              <p className="font-medium">Remove this player from the event?</p>
              <p className="mt-1 text-muted-foreground">
                No matches have been generated yet, so they'll just be taken off the roster. Their match history from other events stays untouched.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium">Withdraw this player from the event?</p>
              <p className="mt-1 text-muted-foreground">
                Past completed matches stay as they are.{" "}
                {futureMatchesCount === 0
                  ? "They have no upcoming matches to forfeit."
                  : `Their ${futureMatchesCount} upcoming match${
                      futureMatchesCount === 1 ? "" : "es"
                    } will be marked as forfeits, with the win going to the other side.`}
              </p>
              <p className="mt-2 text-muted-foreground">
                Forfeits don't affect ratings.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
