import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownUp, Loader2, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { Pair, Player } from "@/types/database";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type SortKey = "rating" | "matches" | "recent";

interface PairWithPlayers extends Pair {
  player_a: Player | null;
  player_b: Player | null;
}

export default function PairLeaderboard() {
  const [pairs, setPairs] = useState<PairWithPlayers[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("rating");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: pairRows, error: pErr } = await supabase
        .from("rr_pairs")
        .select("*");
      if (pErr) {
        if (!cancelled) {
          setError(pErr.message);
          toast.error("Couldn't load pairs", { description: pErr.message });
        }
        return;
      }
      if (cancelled) return;

      const playerIds = new Set<string>();
      for (const p of pairRows ?? []) {
        playerIds.add(p.player_a_id);
        playerIds.add(p.player_b_id);
      }

      let playersById: Record<string, Player> = {};
      if (playerIds.size > 0) {
        const { data: ps } = await supabase
          .from("rr_players")
          .select("*")
          .in("id", Array.from(playerIds));
        if (cancelled) return;
        for (const p of ps ?? []) playersById[p.id] = p;
      }

      const enriched: PairWithPlayers[] = (pairRows ?? []).map((p) => ({
        ...p,
        player_a: playersById[p.player_a_id] ?? null,
        player_b: playersById[p.player_b_id] ?? null,
      }));
      setPairs(enriched);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!pairs) return [];
    const q = query.trim().toLowerCase();
    let list = q
      ? pairs.filter((p) => {
          const a = p.player_a?.full_name.toLowerCase() ?? "";
          const b = p.player_b?.full_name.toLowerCase() ?? "";
          return a.includes(q) || b.includes(q);
        })
      : [...pairs];

    switch (sortKey) {
      case "rating":
        list.sort((a, b) => b.pair_rating - a.pair_rating);
        break;
      case "matches":
        list.sort((a, b) => b.matches_played - a.matches_played);
        break;
      case "recent":
        list.sort((a, b) => {
          const ta = a.last_played_at ? new Date(a.last_played_at).getTime() : 0;
          const tb = b.last_played_at ? new Date(b.last_played_at).getTime() : 0;
          return tb - ta;
        });
        break;
    }
    return list;
  }, [pairs, query, sortKey]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6">
        <h1 className="text-3xl uppercase">Pair leaderboard</h1>
        <p className="text-sm text-muted-foreground">
          Top doubles partnerships, ranked by Glicko-2 pair rating.
        </p>
      </header>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by player name"
            className="pl-9"
          />
        </div>
        <div className="relative sm:w-56">
          <ArrowDownUp className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="pl-9"
            aria-label="Sort pairs by"
          >
            <option value="rating">Sort by rating</option>
            <option value="matches">Sort by matches together</option>
            <option value="recent">Sort by most recent</option>
          </Select>
        </div>
      </div>

      {pairs === null && !error && (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading pairs…</span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm">
          <p className="font-medium text-destructive">Couldn't load pairs</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
        </div>
      )}

      {pairs && pairs.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-muted/30 px-6 py-16 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Users className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold">No partnerships yet</h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Pair ratings populate after a doubles event is finalized.
          </p>
        </div>
      )}

      {pairs && pairs.length > 0 && filtered.length === 0 && (
        <p className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          No matches for "{query}".
        </p>
      )}

      {filtered.length > 0 && (
        <Card className="overflow-hidden">
          <ul className="divide-y">
            {filtered.map((p, idx) => {
              const aName = p.player_a?.full_name ?? "Unknown";
              const bName = p.player_b?.full_name ?? "Unknown";
              return (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      #{idx + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        <Link
                          to={`/players/${p.player_a_id}`}
                          className="hover:underline"
                        >
                          {aName}
                        </Link>
                        <span className="mx-1 text-muted-foreground">+</span>
                        <Link
                          to={`/players/${p.player_b_id}`}
                          className="hover:underline"
                        >
                          {bName}
                        </Link>
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {p.matches_played} match
                        {p.matches_played === 1 ? "" : "es"} together
                      </span>
                    </span>
                  </span>
                  <span className="text-right text-sm tabular-nums">
                    <span className="block font-semibold">
                      {Math.round(p.pair_rating)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      ± {Math.round(p.pair_rd)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
