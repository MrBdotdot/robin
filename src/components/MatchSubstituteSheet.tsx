import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Loader2, Repeat } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { pushPlayerToBack } from "@/lib/scheduleSync";
import type { EventPlayer, MatchRow, Player } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface MatchSubstituteSheetProps {
  open: boolean;
  onClose: () => void;
  match: MatchRow | null;
  /** Which side ("a" or "b") to substitute on, or null to let user pick. */
  side: "a" | "b" | null;
  /** If set, the outgoing player is fixed and the "who's leaving?" step is
   *  skipped — the user just picks who's coming in. */
  outgoingPlayerId?: string | null;
  eventPlayers: EventPlayer[];
  playersById: Record<string, Player>;
  onSaved: () => Promise<void> | void;
}

/**
 * Per-match substitution. Different from the event-wide PlayerSwapSheet:
 * this only changes the chosen match, leaving every other appearance of the
 * outgoing player untouched. Useful for "X tweaked an ankle, sub Y in for
 * just this match".
 */
export function MatchSubstituteSheet({
  open,
  onClose,
  match,
  side,
  outgoingPlayerId,
  eventPlayers,
  playersById,
  onSaved,
}: MatchSubstituteSheetProps) {
  const [outgoingId, setOutgoingId] = useState<string | null>(null);
  const [incomingId, setIncomingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open) {
      setOutgoingId(outgoingPlayerId ?? null);
      setIncomingId(null);
    }
  }, [open, match?.id, side, outgoingPlayerId]);

  const sideIds = useMemo(() => {
    if (!match || !side) return [];
    return side === "a" ? match.side_a_player_ids : match.side_b_player_ids;
  }, [match, side]);

  // Auto-select the outgoing player for singles (one player on the side)
  useEffect(() => {
    if (!open) return;
    if (outgoingPlayerId) return; // already preselected
    if (sideIds.length === 1 && outgoingId === null) {
      setOutgoingId(sideIds[0]);
    }
  }, [open, sideIds, outgoingId, outgoingPlayerId]);

  // Available substitutes: roster members not currently in this match
  const availableSubs = useMemo(() => {
    if (!match) return [];
    const inMatch = new Set([
      ...match.side_a_player_ids,
      ...match.side_b_player_ids,
    ]);
    return eventPlayers
      .filter((ep) => !ep.withdrawn)
      .filter((ep) => !inMatch.has(ep.player_id))
      .map((ep) => playersById[ep.player_id])
      .filter((p): p is Player => Boolean(p))
      .sort((a, b) =>
        a.full_name.localeCompare(b.full_name, undefined, { sensitivity: "base" })
      );
  }, [match, eventPlayers, playersById]);

  if (!match || !side) return null;

  const handleApply = async () => {
    if (!outgoingId || !incomingId || saving) return;
    setSaving(true);
    try {
      const replaceIn = (ids: string[]) =>
        ids.map((id) => (id === outgoingId ? incomingId : id));
      const update: Partial<MatchRow> = {};
      if (side === "a") {
        update.side_a_player_ids = replaceIn(match.side_a_player_ids);
      } else {
        update.side_b_player_ids = replaceIn(match.side_b_player_ids);
      }
      const { error } = await supabase
        .from("rr_matches")
        .update(update)
        .eq("id", match.id);
      if (error) throw error;

      // Push the new player's other scheduled future matches to the back
      // of the queue, swapping with later non-conflicting matches.
      let pushed = 0;
      try {
        const result = await pushPlayerToBack(
          match.event_id,
          incomingId,
          match.id
        );
        pushed = result.swapped;
      } catch {
        // Non-fatal — the substitution itself already saved.
      }

      const incomingName = playersById[incomingId]?.full_name ?? "Player";
      const outgoingName = playersById[outgoingId]?.full_name ?? "Player";
      toast.success("Substitution applied", {
        description:
          pushed > 0
            ? `${outgoingName} → ${incomingName}. ${incomingName}'s other ${
                pushed === 1 ? "match was" : "matches were"
              } pushed to the back of the queue.`
            : `${outgoingName} → ${incomingName} for this match.`,
      });
      onClose();
      await onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Couldn't substitute", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  const sideLabel = side === "a" ? "Side A" : "Side B";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Substitute player"
      description={`${sideLabel} — only this match changes.`}
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
            onClick={handleApply}
            disabled={saving || !outgoingId || !incomingId}
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
        {/* Step 1: Who's leaving? — skipped when an outgoing player is preselected
            or when there's only one player on this side. */}
        {!outgoingPlayerId && sideIds.length > 1 && (
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Who's leaving?
            </label>
            <div className="space-y-2">
              {sideIds.map((id) => {
                const p = playersById[id];
                const active = id === outgoingId;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setOutgoingId(id)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg border bg-background p-3 text-left transition-colors",
                      active
                        ? "border-primary ring-2 ring-primary/20"
                        : "hover:bg-accent/40"
                    )}
                  >
                    <span className="text-sm font-medium">
                      {p?.full_name ?? "Unknown"}
                    </span>
                    {active && <Check className="h-4 w-4 text-primary" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Diff preview when both selected */}
        {outgoingId && incomingId && (
          <div className="flex items-center justify-center gap-3 rounded-md border bg-muted/30 px-3 py-3 text-sm">
            <span className="text-muted-foreground line-through">
              {playersById[outgoingId]?.full_name}
            </span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold">
              {playersById[incomingId]?.full_name}
            </span>
          </div>
        )}

        {/* Step 2: Who's coming in? */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Repeat className="h-3 w-3" />
              Who's coming in?
            </span>
          </label>
          {availableSubs.length === 0 ? (
            <p className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-center text-sm text-muted-foreground">
              No available substitutes — every roster member is already in this match.
            </p>
          ) : (
            <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
              {availableSubs.map((p) => {
                const active = p.id === incomingId;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setIncomingId(p.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors",
                        active
                          ? "bg-accent"
                          : "hover:bg-accent/40"
                      )}
                    >
                      <span className="text-sm">{p.full_name}</span>
                      {active && <Check className="h-4 w-4 text-primary" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          This swap only affects this match. To replace someone in every upcoming match, use the player's profile.
        </p>
      </div>
    </Sheet>
  );
}
