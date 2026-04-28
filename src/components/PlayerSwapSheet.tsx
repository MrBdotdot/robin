import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Loader2, Plus, Repeat, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { EventPlayer, MatchRow, Player } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface PlayerSwapSheetProps {
  open: boolean;
  onClose: () => void;
  /** Player who's being swapped out. */
  fromPlayerId: string | null;
  /** Event id — needed when swapping in a player who isn't on the roster yet. */
  eventId: string;
  eventPlayers: EventPlayer[];
  matches: MatchRow[];
  playersById: Record<string, Player>;
  onSwapped: () => Promise<void> | void;
}

/**
 * Replace every appearance of `fromPlayerId` in upcoming and in-progress
 * matches with another player. The replacement may be:
 *   - Already on the event roster.
 *   - In the database but not on this roster (auto-added with a snapshot).
 *   - Brand new (created on the fly, then added to the roster).
 *
 * Past, completed, and forfeit matches are not touched.
 */
export function PlayerSwapSheet({
  open,
  onClose,
  fromPlayerId,
  eventId,
  eventPlayers,
  matches,
  playersById,
  onSwapped,
}: PlayerSwapSheetProps) {
  // Hooks always run, regardless of fromPlayerId — order must stay stable.
  const [allDbPlayers, setAllDbPlayers] = useState<Player[]>([]);
  const [query, setQuery] = useState("");
  const [pickedExistingId, setPickedExistingId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  // Reload db players + reset state on open
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setPickedExistingId(null);
    setNewName("");
    (async () => {
      const { data } = await supabase
        .from("rr_players")
        .select("*")
        .order("full_name");
      setAllDbPlayers(data ?? []);
    })();
  }, [open, fromPlayerId]);

  const fromPlayer = fromPlayerId ? playersById[fromPlayerId] : null;

  // Affected matches: scheduled or currently in progress, involving `fromPlayerId`.
  const affected = useMemo(() => {
    if (!fromPlayerId) return [];
    return matches.filter(
      (m) =>
        (m.status === "scheduled" || m.status === "in_progress") &&
        (m.side_a_player_ids.includes(fromPlayerId) ||
          m.side_b_player_ids.includes(fromPlayerId))
    );
  }, [matches, fromPlayerId]);

  // Filtered candidate list — exclude only the outgoing player; everything
  // else (rostered or not) is fair game.
  const filteredCandidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allDbPlayers
      .filter((p) => p.id !== fromPlayerId)
      .filter((p) => (q ? p.full_name.toLowerCase().includes(q) : true));
  }, [allDbPlayers, query, fromPlayerId]);

  const onRosterIds = useMemo(
    () => new Set(eventPlayers.map((ep) => ep.player_id)),
    [eventPlayers]
  );

  // Conflict check: replacement already in another match in the same round
  const conflicts = useMemo(() => {
    if (!pickedExistingId) return [];
    return affected.filter(
      (m) =>
        m.side_a_player_ids.includes(pickedExistingId) ||
        m.side_b_player_ids.includes(pickedExistingId)
    );
  }, [affected, pickedExistingId]);

  if (!fromPlayerId || !fromPlayer) return null;

  const handleSwap = async () => {
    if (saving) return;
    if (!pickedExistingId && !newName.trim()) {
      toast.error("Pick a player or type a new name first.");
      return;
    }
    if (pickedExistingId && conflicts.length > 0) {
      toast.error("That player is already in one of these matches.");
      return;
    }
    setSaving(true);
    try {
      let toPlayerId = pickedExistingId;

      // 1. If the user typed a new name, create the player + add to roster
      if (!toPlayerId && newName.trim()) {
        const trimmed = newName.trim();
        // Maybe this name already exists in DB
        const { data: existingByName } = await supabase
          .from("rr_players")
          .select("*")
          .ilike("full_name", trimmed)
          .limit(1);
        let player: Player | null = existingByName?.[0] ?? null;
        if (!player) {
          const { data: created, error: cErr } = await supabase
            .from("rr_players")
            .insert({ full_name: trimmed })
            .select("*")
            .single();
          if (cErr) throw cErr;
          player = created as Player;
        }
        toPlayerId = player.id;
      }

      if (!toPlayerId) throw new Error("No replacement chosen");

      // 2. Ensure replacement is on the event roster (with snapshot)
      if (!onRosterIds.has(toPlayerId)) {
        const player =
          allDbPlayers.find((p) => p.id === toPlayerId) ??
          (await (async () => {
            const { data } = await supabase
              .from("rr_players")
              .select("*")
              .eq("id", toPlayerId!)
              .single();
            return data as Player | null;
          })());
        const snapshot = player
          ? {
              singles: {
                rating: player.glicko_singles_rating,
                rd: player.glicko_singles_rd,
                vol: player.glicko_singles_vol,
              },
              doubles: {
                rating: player.glicko_doubles_rating,
                rd: player.glicko_doubles_rd,
                vol: player.glicko_doubles_vol,
              },
            }
          : null;
        const { error: epErr } = await supabase
          .from("rr_event_players")
          .insert({
            event_id: eventId,
            player_id: toPlayerId,
            joined_at_round: 0,
            initial_rating_snapshot: snapshot,
          });
        if (epErr) throw epErr;
      }

      // 3. Replace in upcoming/in-progress matches
      for (const m of affected) {
        const newA = m.side_a_player_ids.map((id) =>
          id === fromPlayerId ? toPlayerId! : id
        );
        const newB = m.side_b_player_ids.map((id) =>
          id === fromPlayerId ? toPlayerId! : id
        );
        const { error: upErr } = await supabase
          .from("rr_matches")
          .update({ side_a_player_ids: newA, side_b_player_ids: newB })
          .eq("id", m.id);
        if (upErr) throw upErr;
      }

      toast.success("Swapped", {
        description: `${affected.length} match${
          affected.length === 1 ? "" : "es"
        } updated.`,
      });
      onClose();
      await onSwapped();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Couldn't swap", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Swap player"
      description={`Replace ${fromPlayer.full_name} in upcoming and in-progress matches.`}
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
            onClick={handleSwap}
            disabled={
              saving ||
              affected.length === 0 ||
              (!pickedExistingId && !newName.trim()) ||
              (!!pickedExistingId && conflicts.length > 0)
            }
            className="flex-1"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Apply
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Picker — any DB player */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Pick replacement
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

          {filteredCandidates.length === 0 ? (
            <p className="rounded-md border border-dashed bg-muted/30 px-3 py-3 text-center text-sm text-muted-foreground">
              {query ? `No matches for "${query}".` : "No saved players."}
            </p>
          ) : (
            <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">
              {filteredCandidates.map((p) => {
                const isPicked = p.id === pickedExistingId;
                const onRoster = onRosterIds.has(p.id);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setPickedExistingId(p.id);
                        setNewName("");
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/40",
                        isPicked && "bg-accent"
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                            isPicked
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input bg-background"
                          )}
                          aria-hidden
                        >
                          {isPicked && <Check className="h-3 w-3" />}
                        </span>
                        <span className="truncate text-sm">{p.full_name}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {onRoster ? "On roster" : "Not on roster yet"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Add new player by name */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Or add a new player
          </label>
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                if (e.target.value.trim()) setPickedExistingId(null);
              }}
              placeholder="Full name"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            They'll be added to the roster and slotted into the affected matches.
          </p>
        </div>

        {/* Diff preview */}
        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Repeat className="h-3 w-3" />
            Matches that will change
          </h4>
          {affected.length === 0 ? (
            <p className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-center text-sm text-muted-foreground">
              No upcoming or in-progress matches involve this player.
            </p>
          ) : (
            <ul className="space-y-2">
              {affected.map((m) => {
                const onA = m.side_a_player_ids.includes(fromPlayerId);
                const beforeA = m.side_a_player_ids
                  .map((id) => playersById[id]?.full_name ?? "Unknown")
                  .join(" + ");
                const beforeB = m.side_b_player_ids
                  .map((id) => playersById[id]?.full_name ?? "Unknown")
                  .join(" + ");
                const after = onA ? beforeA : beforeB;
                const otherAfter = onA ? beforeB : beforeA;
                const replacedName = pickedExistingId
                  ? playersById[pickedExistingId]?.full_name ??
                    allDbPlayers.find((p) => p.id === pickedExistingId)
                      ?.full_name ??
                    "?"
                  : newName.trim() || "?";
                const newAfter = after.replace(fromPlayer.full_name, replacedName);
                const conflict = conflicts.includes(m);
                return (
                  <li
                    key={m.id}
                    className={cn(
                      "rounded-lg border bg-background p-3 text-sm",
                      conflict && "border-destructive/40 bg-destructive/5"
                    )}
                  >
                    <div className="text-xs text-muted-foreground">
                      Round {m.round} · Court {m.court ?? "?"}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-muted-foreground line-through">
                        {after}
                      </span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <span className="font-medium">{newAfter}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      vs {otherAfter}
                    </div>
                    {conflict && (
                      <p className="mt-2 text-xs text-destructive">
                        That player is already in this match — pick someone else.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Past and completed matches stay as-is. The new player is added to the roster automatically if they aren't already.
        </p>
        {newName.trim() && (
          <p className="rounded-md border bg-accent/30 px-3 py-2 text-xs">
            <Plus className="mr-1 inline h-3 w-3" />
            <span className="font-medium">{newName.trim()}</span> will be created and added to this event.
          </p>
        )}
      </div>
    </Sheet>
  );
}
