import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Loader2,
  Plus,
  Search,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { EventMode, Player } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface RosterAddSheetProps {
  open: boolean;
  onClose: () => void;
  eventId: string;
  eventMode: EventMode;
  hasSchedule: boolean;
  /** Player IDs already in the event roster — they'll be greyed out. */
  existingPlayerIds: string[];
  /** Used to set joined_at_round on the new event_player row. 0 if event hasn't started. */
  liveRound: number | null;
  onAdded: () => Promise<void> | void;
}

export function RosterAddSheet({
  open,
  onClose,
  eventId,
  eventMode,
  hasSchedule,
  existingPlayerIds,
  liveRound,
  onAdded,
}: RosterAddSheetProps) {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [newNames, setNewNames] = useState<string[]>([]);
  const [newInput, setNewInput] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset + fetch whenever the sheet opens
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setPickedIds(new Set());
    setNewNames([]);
    setNewInput("");
    setPlayers(null);
    setLoadError(null);

    (async () => {
      const { data, error } = await supabase
        .from("rr_players")
        .select("*")
        .order("full_name");
      if (error) {
        setLoadError(error.message);
        return;
      }
      setPlayers(data ?? []);
    })();
  }, [open]);

  const existingSet = useMemo(
    () => new Set(existingPlayerIds),
    [existingPlayerIds]
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

  const addNewName = () => {
    const trimmed = newInput.trim();
    if (!trimmed) return;
    if (
      newNames.some((n) => n.toLowerCase() === trimmed.toLowerCase()) ||
      players?.some((p) => p.full_name.toLowerCase() === trimmed.toLowerCase())
    ) {
      toast.error("That name is already on the list", {
        description: "Pick them from the list above instead.",
      });
      return;
    }
    setNewNames([...newNames, trimmed]);
    setNewInput("");
  };

  const removeNewName = (n: string) => {
    setNewNames(newNames.filter((x) => x !== n));
  };

  const totalToAdd = pickedIds.size + newNames.length;

  const handleSave = async () => {
    if (saving || totalToAdd === 0) return;
    setSaving(true);
    try {
      // 1. Create any brand-new players first
      let newlyCreatedIds: string[] = [];
      if (newNames.length > 0) {
        const { data: created, error: cErr } = await supabase
          .from("rr_players")
          .insert(newNames.map((full_name) => ({ full_name })))
          .select("id");
        if (cErr) throw cErr;
        newlyCreatedIds = (created ?? []).map((p) => p.id);
      }

      // 2. Build event_player rows with rating snapshots. joined_at_round
      //    signals late additions; the snapshot is the player's rating right
      //    now so live recompute has a baseline.
      const allIds = [...pickedIds, ...newlyCreatedIds];
      const joinedAt = hasSchedule ? Math.max(1, liveRound ?? 1) : 0;

      // Reload these players' full Glicko fields for the snapshot
      const { data: snapPlayers } = await supabase
        .from("rr_players")
        .select(
          "id, glicko_singles_rating, glicko_singles_rd, glicko_singles_vol, glicko_doubles_rating, glicko_doubles_rd, glicko_doubles_vol"
        )
        .in("id", allIds);
      const snapBy = new Map((snapPlayers ?? []).map((p) => [p.id, p]));

      const rows = allIds.map((player_id) => {
        const p = snapBy.get(player_id);
        const snapshot = p
          ? {
              singles: {
                rating: p.glicko_singles_rating,
                rd: p.glicko_singles_rd,
                vol: p.glicko_singles_vol,
              },
              doubles: {
                rating: p.glicko_doubles_rating,
                rd: p.glicko_doubles_rd,
                vol: p.glicko_doubles_vol,
              },
            }
          : null;
        return {
          event_id: eventId,
          player_id,
          joined_at_round: joinedAt,
          initial_rating_snapshot: snapshot,
        };
      });

      const { error: epErr } = await supabase
        .from("rr_event_players")
        .insert(rows);
      if (epErr) throw epErr;

      toast.success(`Added ${totalToAdd} player${totalToAdd === 1 ? "" : "s"}`);
      onClose();
      await onAdded();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Couldn't add players", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  const minPlayers = eventMode === "singles" ? 2 : 4;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add players"
      description={
        hasSchedule
          ? "New players will be slotted into future rounds — already-played matches stay as-is."
          : `Add ${minPlayers}+ players, then generate the schedule.`
      }
      footer={
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={saving}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={totalToAdd === 0 || saving}
            className="flex-1"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            {totalToAdd === 0
              ? "Add"
              : `Add ${totalToAdd} player${totalToAdd === 1 ? "" : "s"}`}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Search existing */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Pick from existing
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search players"
              className="pl-9"
            />
          </div>

          {loadError && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {loadError}
            </p>
          )}

          {players === null && !loadError && (
            <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading…</span>
            </div>
          )}

          {players !== null && players.length === 0 && (
            <p className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
              No saved players yet — add one by name below.
            </p>
          )}

          {players !== null && players.length > 0 && filtered.length === 0 && (
            <p className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
              No matches for "{query}".
            </p>
          )}

          {filtered.length > 0 && (
            <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
              {filtered.map((p) => {
                const already = existingSet.has(p.id);
                const picked = pickedIds.has(p.id);
                const rating =
                  eventMode === "singles"
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
                        {already && <span>On roster</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Add new by name */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Or add a new player
          </label>
          <div className="flex gap-2">
            <Input
              value={newInput}
              onChange={(e) => setNewInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addNewName();
                }
              }}
              placeholder="Full name"
            />
            <Button onClick={addNewName} type="button">
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>

          {newNames.length > 0 && (
            <ul className="space-y-1.5">
              {newNames.map((n) => (
                <li
                  key={n}
                  className="flex items-center justify-between rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <span>{n}</span>
                  <button
                    type="button"
                    onClick={() => removeNewName(n)}
                    className="rounded p-1 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${n}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Sheet>
  );
}
