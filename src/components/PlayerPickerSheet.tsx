import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { EventMode, Player } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface PlayerPickerSheetProps {
  open: boolean;
  onClose: () => void;
  /** Names already added to the wizard — these are pre-checked + skipped on add. */
  alreadySelectedNames: string[];
  /** Which rating to display (matches event mode). */
  mode: EventMode;
  /** Called when user taps "Add selected" — receives the picked names. */
  onAdd: (names: string[]) => void;
}

export function PlayerPickerSheet({
  open,
  onClose,
  alreadySelectedNames,
  mode,
  onAdd,
}: PlayerPickerSheetProps) {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());

  // Load the player list whenever the sheet opens
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setPickedIds(new Set());
    setPlayers(null);
    setLoadError(null);

    (async () => {
      const { data, error } = await supabase
        .from("rr_players")
        .select("*")
        .order("full_name");
      if (error) {
        setLoadError(error.message);
        toast.error("Couldn't load players", { description: error.message });
        return;
      }
      setPlayers(data ?? []);
    })();
  }, [open]);

  const alreadySet = useMemo(
    () =>
      new Set(alreadySelectedNames.map((n) => n.trim().toLowerCase())),
    [alreadySelectedNames]
  );

  const filtered = useMemo(() => {
    if (!players) return [];
    const q = query.trim().toLowerCase();
    if (!q) return players;
    return players.filter((p) => p.full_name.toLowerCase().includes(q));
  }, [players, query]);

  const togglePick = (id: string) => {
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pickedCount = pickedIds.size;

  const handleAdd = () => {
    if (!players || pickedCount === 0) return;
    const picked = players
      .filter((p) => pickedIds.has(p.id))
      .map((p) => p.full_name);
    onAdd(picked);
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Pick existing players"
      description={
        players
          ? `${players.length} player${players.length === 1 ? "" : "s"} in your database`
          : undefined
      }
      footer={
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={handleAdd}
            disabled={pickedCount === 0}
            className="flex-1"
          >
            <UserPlus className="h-4 w-4" />
            {pickedCount === 0
              ? "Add selected"
              : `Add ${pickedCount} player${pickedCount === 1 ? "" : "s"}`}
          </Button>
        </div>
      }
    >
      {/* Search */}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name"
          className="pl-9"
        />
      </div>

      {/* States */}
      {loadError && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {loadError}
        </p>
      )}

      {players === null && !loadError && (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      )}

      {players !== null && players.length === 0 && (
        <p className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          No players in your database yet. Add a few by typing names below.
        </p>
      )}

      {players !== null && players.length > 0 && filtered.length === 0 && (
        <p className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          No matches for "{query}".
        </p>
      )}

      {/* List */}
      {filtered.length > 0 && (
        <ul className="divide-y rounded-md border">
          {filtered.map((p) => {
            const already = alreadySet.has(p.full_name.toLowerCase());
            const picked = pickedIds.has(p.id);
            const rating =
              mode === "singles"
                ? p.glicko_singles_rating
                : p.glicko_doubles_rating;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => !already && togglePick(p.id)}
                  disabled={already}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors",
                    already && "cursor-not-allowed opacity-50",
                    !already && "hover:bg-accent/40"
                  )}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                        picked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background"
                      )}
                      aria-hidden
                    >
                      {picked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate text-sm">{p.full_name}</span>
                  </span>
                  <span className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="tabular-nums" title="Glicko-2 rating">
                      {Math.round(rating)}
                    </span>
                    {already && <span>Already added</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
