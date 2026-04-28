import { Check, Clock, Flag, Pencil } from "lucide-react";
import type { MatchRow, MatchStatus } from "@/types/database";
import type { Player } from "@/types/database";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface MatchCardProps {
  match: MatchRow;
  playersById: Record<string, Player>;
  onClick?: () => void;
}

export function MatchCard({ match, playersById, onClick }: MatchCardProps) {
  const sideAName = renderSide(match.side_a_player_ids, playersById);
  const sideBName = renderSide(match.side_b_player_ids, playersById);
  const isCompleted = match.status === "completed";
  const isLive = match.status === "in_progress";
  const isForfeit =
    match.status === "forfeit_a" ||
    match.status === "forfeit_b" ||
    match.status === "walkover";

  const winA = match.winner_side === "a";
  const winB = match.winner_side === "b";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group block w-full rounded-xl border bg-card p-4 text-left shadow-sm transition-colors",
        "hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isLive && "border-live/40 bg-live/5",
        isCompleted && "opacity-90",
        isForfeit && "border-forfeit/40"
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Court {match.court ?? "?"}
        </span>
        <StatusBadge status={match.status} />
      </div>

      <div className="space-y-1.5">
        <SideRow
          name={sideAName}
          isWinner={winA}
          isCompleted={isCompleted}
          score={extractSideScore(match, "a")}
        />
        <div className="text-xs font-medium text-muted-foreground">vs</div>
        <SideRow
          name={sideBName}
          isWinner={winB}
          isCompleted={isCompleted}
          score={extractSideScore(match, "b")}
        />
      </div>

      <div className="mt-3 flex items-center justify-end gap-1.5 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
        <Pencil className="h-3 w-3" />
        <span>{isCompleted ? "Edit score" : "Enter score"}</span>
      </div>
    </button>
  );
}

function SideRow({
  name,
  isWinner,
  isCompleted,
  score,
}: {
  name: string;
  isWinner: boolean;
  isCompleted: boolean;
  score: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span
        className={cn(
          "text-sm",
          isWinner && isCompleted && "font-semibold",
          !isWinner && isCompleted && "text-muted-foreground"
        )}
      >
        {name}
      </span>
      {score !== null && (
        <span
          className={cn(
            "tabular-nums text-sm",
            isWinner && "font-semibold",
            !isWinner && isCompleted && "text-muted-foreground"
          )}
        >
          {score}
        </span>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: MatchStatus }) {
  switch (status) {
    case "scheduled":
      return (
        <Badge variant="scheduled" className="gap-1">
          <Clock className="h-3 w-3" />
          Up next
        </Badge>
      );
    case "in_progress":
      return (
        <Badge variant="live" className="gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-live-foreground/90" />
          Playing
        </Badge>
      );
    case "completed":
      return (
        <Badge variant="completed" className="gap-1">
          <Check className="h-3 w-3" />
          Done
        </Badge>
      );
    case "forfeit_a":
    case "forfeit_b":
    case "walkover":
      return (
        <Badge variant="forfeit" className="gap-1">
          <Flag className="h-3 w-3" />
          Forfeit
        </Badge>
      );
    case "cancelled":
      return <Badge variant="outline">Cancelled</Badge>;
  }
}

function renderSide(playerIds: string[], playersById: Record<string, Player>): string {
  return playerIds.map((id) => playersById[id]?.full_name ?? "Unknown").join(" + ");
}

function extractSideScore(match: MatchRow, side: "a" | "b"): string | null {
  const s = match.scores;
  if (!s || typeof s !== "object") return null;
  const scoreObj = s as Record<string, unknown>;
  const key = side === "a" ? "side_a" : "side_b";
  const v = scoreObj[key];
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.join("-");
  return null;
}
