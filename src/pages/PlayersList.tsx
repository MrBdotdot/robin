import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownUp,
  ChevronRight,
  Loader2,
  Search,
  Users as UsersIcon,
  Heart,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { Player } from "@/types/database";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type SortKey = "name" | "singles" | "doubles" | "matches";
type RatingMode = "singles" | "doubles";

export default function PlayersList() {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [ratingMode, setRatingMode] = useState<RatingMode>("singles");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("rr_players").select("*");
      if (cancelled) return;
      if (error) {
        setError(error.message);
        toast.error("Couldn't load players", { description: error.message });
        return;
      }
      setPlayers(data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!players) return [];
    const q = query.trim().toLowerCase();
    let list = q
      ? players.filter((p) => p.full_name.toLowerCase().includes(q))
      : [...players];

    switch (sortKey) {
      case "name":
        list.sort((a, b) =>
          a.full_name.localeCompare(b.full_name, undefined, { sensitivity: "base" })
        );
        break;
      case "singles":
        list.sort((a, b) => b.glicko_singles_rating - a.glicko_singles_rating);
        break;
      case "doubles":
        list.sort((a, b) => b.glicko_doubles_rating - a.glicko_doubles_rating);
        break;
      case "matches":
        list.sort((a, b) => b.matches_played - a.matches_played);
        break;
    }
    return list;
  }, [players, query, sortKey]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl uppercase">Players</h1>
          <p className="text-sm text-muted-foreground">
            Everyone you've added, with their ratings across all events.
          </p>
        </div>
        <Link
          to="/players/pairs"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <Heart className="h-4 w-4" />
          <span className="hidden sm:inline">Pair leaderboard</span>
          <span className="sm:hidden">Pairs</span>
        </Link>
      </header>

      {/* Filters */}
      {/* Rating mode toggle */}
      <div className="mb-3 inline-flex rounded-md bg-muted p-1">
        {(["singles", "doubles"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setRatingMode(m);
              // Sync the sort to match if currently sorting by the other mode's rating
              if (m === "singles" && sortKey === "doubles") setSortKey("singles");
              if (m === "doubles" && sortKey === "singles") setSortKey("doubles");
            }}
            className={`rounded px-4 py-1.5 text-xs font-medium capitalize transition-colors ${
              ratingMode === m
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name"
            className="pl-9"
          />
        </div>
        <div className="relative sm:w-56">
          <ArrowDownUp className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="pl-9"
            aria-label="Sort players by"
          >
            <option value="name">Sort by name</option>
            <option value="singles">Sort by singles rating</option>
            <option value="doubles">Sort by doubles rating</option>
            <option value="matches">Sort by matches played</option>
          </Select>
        </div>
      </div>

      {/* Loading */}
      {players === null && !error && (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading players…</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm">
          <p className="font-medium text-destructive">Couldn't load players</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
        </div>
      )}

      {/* Empty (no players at all) */}
      {players && players.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-muted/30 px-6 py-16 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UsersIcon className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold">No players yet</h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Players are added when you create events. Come back here once you've run a few.
          </p>
        </div>
      )}

      {/* Empty (filter)*/}
      {players && players.length > 0 && filtered.length === 0 && (
        <p className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          No matches for "{query}".
        </p>
      )}

      {/* List */}
      {filtered.length > 0 && (
        <Card className="overflow-hidden">
          <ul className="divide-y">
            {filtered.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/players/${p.id}`}
                  className="group flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-accent/30"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {p.full_name}
                  </span>
                  <span className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span
                      className="tabular-nums"
                      title={
                        ratingMode === "singles"
                          ? "Singles rating"
                          : "Doubles rating"
                      }
                    >
                      {Math.round(
                        ratingMode === "singles"
                          ? p.glicko_singles_rating
                          : p.glicko_doubles_rating
                      )}
                    </span>
                    <span className="hidden tabular-nums md:inline">
                      {p.matches_played} played
                    </span>
                    <ChevronRight
                      className={cn(
                        "h-4 w-4 transition-transform",
                        "group-hover:translate-x-0.5"
                      )}
                    />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {filtered.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Showing {ratingMode} ratings. Tap a player for the full profile.
        </p>
      )}
    </div>
  );
}
