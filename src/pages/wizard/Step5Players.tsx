import { GripVertical, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "./FormField";
import type { StepProps } from "./types";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface Step5PlayersProps extends StepProps {
  playerInput: string;
  setPlayerInput: (s: string) => void;
  onOpenPicker: () => void;
}

export function Step5Players({
  s,
  set,
  playerInput,
  setPlayerInput,
  onOpenPicker,
}: Step5PlayersProps) {
  const min = s.mode === "doubles_americano" ? 4 : 2;
  const reorderable = s.seedingStrategy === "order";
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const addPlayer = () => {
    const name = playerInput.trim();
    if (!name) return;
    if (s.playerNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
      toast.error("Already added", {
        description: `${name} is already in the list.`,
      });
      return;
    }
    set("playerNames", [...s.playerNames, name]);
    setPlayerInput("");
  };

  const removePlayer = (n: string) => {
    set(
      "playerNames",
      s.playerNames.filter((x) => x !== n)
    );
  };

  const reorder = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
    const next = [...s.playerNames];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    set("playerNames", next);
  };

  return (
    <div className="space-y-5">
      <FormField label={`Add players (at least ${min})`}>
        <div className="flex gap-2">
          <Input
            value={playerInput}
            onChange={(e) => setPlayerInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addPlayer();
              }
            }}
            placeholder="Full name"
          />
          <Button onClick={addPlayer} type="button">
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Press Enter to add. If a name matches someone you've added before,
          that player will be reused.
        </p>
      </FormField>

      <Button
        type="button"
        variant="outline"
        onClick={onOpenPicker}
        className="w-full"
      >
        <Users className="h-4 w-4" />
        Pick from existing players
      </Button>

      {s.playerNames.length === 0 ? (
        <p className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
          No players added yet.
        </p>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{s.playerNames.length} added</span>
            {s.playerNames.length > 0 && (
              <button
                type="button"
                onClick={() => set("playerNames", [])}
                className="hover:text-destructive hover:underline"
              >
                Clear all
              </button>
            )}
          </div>

          {reorderable && s.playerNames.length > 1 && (
            <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 p-3 text-xs text-foreground/80">
              <strong className="font-semibold">Tip — drag to seed.</strong>{" "}
              Because you set seeding to "in the order I added them," the order
              below = seeding order. Drag the grip handle to rank players.
            </div>
          )}

          {s.playerNames.map((n, idx) => {
            const isDragging = draggingIdx === idx;
            const isHover = hoverIdx === idx && draggingIdx !== idx;
            return (
              <div
                key={n}
                draggable={reorderable}
                onDragStart={(e) => {
                  if (!reorderable) return;
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(idx));
                  setDraggingIdx(idx);
                }}
                onDragOver={(e) => {
                  if (!reorderable || draggingIdx === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setHoverIdx(idx);
                }}
                onDragLeave={() => {
                  if (hoverIdx === idx) setHoverIdx(null);
                }}
                onDrop={(e) => {
                  if (!reorderable || draggingIdx === null) return;
                  e.preventDefault();
                  reorder(draggingIdx, idx);
                  setDraggingIdx(null);
                  setHoverIdx(null);
                }}
                onDragEnd={() => {
                  setDraggingIdx(null);
                  setHoverIdx(null);
                }}
                className={cn(
                  "flex items-center justify-between rounded-md border bg-background px-3 py-2 transition-colors",
                  isDragging && "opacity-40",
                  isHover && "border-t-2 border-primary"
                )}
              >
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  {reorderable && (
                    <span
                      className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
                      aria-hidden
                      title="Drag to reorder"
                    >
                      <GripVertical className="h-4 w-4" />
                    </span>
                  )}
                  <span className="text-muted-foreground">{idx + 1}.</span>{" "}
                  <span className="truncate">{n}</span>
                </span>
                <button
                  type="button"
                  onClick={() => removePlayer(n)}
                  className="rounded p-1 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${n}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        You can change this list anytime later.
      </p>
    </div>
  );
}
