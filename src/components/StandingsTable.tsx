import { Trophy, Medal } from "lucide-react";
import type { PlayerStanding } from "@/lib/standings";
import type { EventPlayer, Player } from "@/types/database";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StandingsTableProps {
  standings: PlayerStanding[];
  playersById: Record<string, Player>;
  eventPlayers: EventPlayer[];
  /** Optional: called when the user taps a player's name. */
  onPlayerClick?: (playerId: string) => void;
}

function rankIcon(rank: number) {
  if (rank === 1)
    return <Trophy className="h-3.5 w-3.5 text-amber-500" aria-label="1st" />;
  if (rank === 2)
    return <Medal className="h-3.5 w-3.5 text-zinc-400" aria-label="2nd" />;
  if (rank === 3)
    return <Medal className="h-3.5 w-3.5 text-amber-700" aria-label="3rd" />;
  return null;
}

export function StandingsTable({
  standings,
  playersById,
  eventPlayers,
  onPlayerClick,
}: StandingsTableProps) {
  if (standings.length === 0) {
    return (
      <Card className="px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          No standings yet. Once scores come in, players will appear here ranked
          by your tiebreaker order.
        </p>
      </Card>
    );
  }

  const withdrawnSet = new Set(
    eventPlayers.filter((ep) => ep.withdrawn).map((ep) => ep.player_id)
  );

  return (
    <Card className="overflow-hidden">
      {/* Header — desktop column labels */}
      <div className="hidden grid-cols-[2.5rem_1fr_3rem_3rem_4.5rem_4.5rem] items-center gap-2 border-b bg-muted/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:grid">
        <span>Rank</span>
        <span>Player</span>
        <span className="text-right" title="Wins">Wins</span>
        <span className="text-right" title="Losses">Losses</span>
        <span
          className="text-right"
          title="Point differential — your points scored minus points conceded"
        >
          Net pts
        </span>
        <span
          className="text-right"
          title="Points scored — total points your side scored across all matches"
        >
          Points
        </span>
      </div>

      <ul className="divide-y">
        {standings.map((s) => {
          const p = playersById[s.playerId];
          const name = p?.full_name ?? "Unknown";
          const withdrawn = withdrawnSet.has(s.playerId);
          const icon = rankIcon(s.rank);

          return (
            <li
              key={s.playerId}
              className={cn(
                "grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 px-4 py-3 sm:grid-cols-[2.5rem_1fr_3rem_3rem_4.5rem_4.5rem]",
                withdrawn && "opacity-60"
              )}
            >
              <span className="flex items-center gap-1 tabular-nums">
                <span className="text-sm font-semibold">#{s.rank}</span>
                {icon}
              </span>
              <span className="min-w-0">
                {onPlayerClick ? (
                  <button
                    type="button"
                    onClick={() => onPlayerClick(s.playerId)}
                    className={cn(
                      "truncate rounded text-left text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      s.rank === 1 && !withdrawn && "font-semibold",
                      withdrawn && "line-through text-muted-foreground"
                    )}
                  >
                    {name}
                  </button>
                ) : (
                  <span
                    className={cn(
                      "truncate text-sm",
                      s.rank === 1 && !withdrawn && "font-semibold",
                      withdrawn && "line-through text-muted-foreground"
                    )}
                  >
                    {name}
                  </span>
                )}
                {withdrawn && (
                  <Badge variant="forfeit" className="ml-2 align-middle">
                    Withdrew
                  </Badge>
                )}
                {/* Mobile-only summary line */}
                <span className="block text-xs tabular-nums text-muted-foreground sm:hidden">
                  {s.wins}–{s.losses}
                  {s.draws > 0 ? `–${s.draws}` : ""} ·{" "}
                  {formatDiff(s.pointDiff)}
                </span>
              </span>

              {/* Desktop columns */}
              <span className="hidden text-right text-sm tabular-nums sm:inline">
                {s.wins}
              </span>
              <span className="hidden text-right text-sm tabular-nums text-muted-foreground sm:inline">
                {s.losses}
              </span>
              <span
                className={cn(
                  "hidden text-right text-sm tabular-nums sm:inline",
                  s.pointDiff > 0 && "text-emerald-700",
                  s.pointDiff < 0 && "text-rose-700"
                )}
              >
                {formatDiff(s.pointDiff)}
              </span>
              <span className="hidden text-right text-sm tabular-nums text-muted-foreground sm:inline">
                {s.pointsFor}
              </span>

              {/* Mobile-only mini summary on the right */}
              <span className="text-right text-xs tabular-nums text-muted-foreground sm:hidden">
                {s.played} played
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function formatDiff(d: number): string {
  if (d > 0) return `+${d}`;
  return String(d);
}
