import type { MatchRow, Player } from "@/types/database";
import { MatchCard } from "@/components/MatchCard";
import { Card } from "@/components/ui/card";
import { Trophy } from "lucide-react";

interface BracketViewProps {
  matches: MatchRow[];
  playersById: Record<string, Player>;
  onMatchClick: (id: string) => void;
}

const ROUND_ORDER = ["r16", "qf", "sf", "f", "bronze"] as const;

const ROUND_LABEL: Record<string, string> = {
  r16: "Round of 16",
  qf: "Quarterfinals",
  sf: "Semifinals",
  f: "Final",
  bronze: "Bronze match",
};

export function BracketView({
  matches,
  playersById,
  onMatchClick,
}: BracketViewProps) {
  // Filter to knockout/bronze/final matches
  const ko = matches.filter((m) => m.stage !== "group_rr");

  if (ko.length === 0) {
    return (
      <Card className="px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          The playoffs haven't started yet.
        </p>
      </Card>
    );
  }

  // Group by knockout_round
  const byRound = new Map<string, MatchRow[]>();
  for (const m of ko) {
    const k = m.knockout_round ?? "f";
    const arr = byRound.get(k) ?? [];
    arr.push(m);
    byRound.set(k, arr);
  }

  // Sort each round's matches by court (we use court for position)
  for (const arr of byRound.values()) {
    arr.sort((a, b) => (a.court ?? 0) - (b.court ?? 0));
  }

  return (
    <div className="space-y-6">
      {ROUND_ORDER.map((round) => {
        const list = byRound.get(round);
        if (!list || list.length === 0) return null;
        return (
          <section key={round}>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {round === "f" || round === "bronze" ? (
                <Trophy className="h-3 w-3" />
              ) : null}
              {ROUND_LABEL[round]}
            </h3>
            <div className="space-y-2">
              {list.map((m, idx) => {
                const tbdA =
                  m.side_a_player_ids.length === 0 &&
                  (m.status === "scheduled" || m.status === "in_progress");
                const tbdB =
                  m.side_b_player_ids.length === 0 &&
                  (m.status === "scheduled" || m.status === "in_progress");

                if (tbdA || tbdB) {
                  return (
                    <TBDCard
                      key={m.id}
                      label={`${ROUND_LABEL[round]} match ${idx + 1}`}
                      tbdA={tbdA}
                      tbdB={tbdB}
                    />
                  );
                }

                return (
                  <MatchCard
                    key={m.id}
                    match={m}
                    playersById={playersById}
                    onClick={() => onMatchClick(m.id)}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TBDCard({
  label,
  tbdA,
  tbdB,
}: {
  label: string;
  tbdA: boolean;
  tbdB: boolean;
}) {
  return (
    <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-4 text-sm">
      <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="space-y-1.5 text-muted-foreground">
        <div>{tbdA ? "Awaiting earlier-round winner" : "Side A"}</div>
        <div className="text-xs">vs</div>
        <div>{tbdB ? "Awaiting earlier-round winner" : "Side B"}</div>
      </div>
    </div>
  );
}
