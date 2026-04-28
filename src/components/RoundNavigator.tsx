import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface RoundNavigatorProps {
  current: number;
  total: number;
  /** Earliest round that has any scheduled or in-progress match. */
  liveRound?: number | null;
  /** Whether the live round has any match actively in progress. */
  liveRoundIsPlaying?: boolean;
  onChange: (round: number) => void;
}

export function RoundNavigator({
  current,
  total,
  liveRound,
  liveRoundIsPlaying,
  onChange,
}: RoundNavigatorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  if (total === 0) return null;

  const onLiveRound = liveRound != null && current === liveRound;
  const isPastRound = liveRound != null && current < liveRound;
  const isFutureRound = liveRound != null && current > liveRound;
  const allDone = liveRound == null;

  const startEdit = () => {
    setDraft(String(current));
    setEditing(true);
  };
  const commit = () => {
    const n = parseInt(draft, 10);
    if (!Number.isNaN(n)) {
      const clamped = Math.max(1, Math.min(total, n));
      if (clamped !== current) onChange(clamped);
    }
    setEditing(false);
  };

  return (
    <div className="sticky top-0 z-20 -mx-4 mb-4 border-b bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onChange(Math.max(1, current - 1))}
          disabled={current <= 1}
          aria-label="Previous round"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>

        <div className="flex flex-1 flex-col items-center">
          <div className="flex items-center gap-2 text-sm font-medium">
            {editing ? (
              <span className="inline-flex items-baseline gap-1">
                <span>Round</span>
                <input
                  ref={inputRef}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={total}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit();
                    if (e.key === "Escape") setEditing(false);
                  }}
                  className="w-12 rounded border bg-card px-1.5 py-0.5 text-center text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  aria-label="Jump to round"
                />
                <span>of {total}</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={startEdit}
                className="rounded px-1.5 py-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title="Tap to jump to a round"
              >
                Round {current} of {total}
              </button>
            )}
            {onLiveRound && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  liveRoundIsPlaying
                    ? "bg-live text-live-foreground"
                    : "bg-scheduled text-scheduled-foreground"
                )}
              >
                <Circle className="h-1.5 w-1.5 fill-current" />
                {liveRoundIsPlaying ? "Now playing" : "Current"}
              </span>
            )}
            {isPastRound && (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                Past
              </span>
            )}
            {isFutureRound && (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                Upcoming
              </span>
            )}
            {allDone && current === total && (
              <span className="inline-flex items-center rounded-full bg-completed px-2 py-0.5 text-[11px] font-semibold text-completed-foreground">
                Final
              </span>
            )}
          </div>
          {liveRound != null && liveRound !== current && (
            <button
              type="button"
              onClick={() => onChange(liveRound)}
              className="mt-0.5 inline-flex items-center gap-1 text-xs text-live hover:underline"
            >
              <Circle className="h-2 w-2 fill-current" />
              Jump to current round ({liveRound})
            </button>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => onChange(Math.min(total, current + 1))}
          disabled={current >= total}
          aria-label="Next round"
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {/* Round dots — gives at-a-glance progress */}
      <div className="mt-2 flex items-center justify-center gap-1.5">
        {Array.from({ length: total }, (_, i) => {
          const round = i + 1;
          const isActive = round === current;
          const isLive = round === liveRound;
          const isPast = liveRound != null && round < liveRound;
          return (
            <button
              key={round}
              type="button"
              onClick={() => onChange(round)}
              className={cn(
                "h-1.5 rounded-full transition-all",
                isActive ? "w-6" : "w-1.5",
                isActive && isLive
                  ? "bg-live"
                  : isActive
                  ? "bg-primary"
                  : isLive
                  ? "bg-live"
                  : isPast
                  ? "bg-muted-foreground/40"
                  : "bg-muted"
              )}
              aria-label={`Round ${round}`}
            />
          );
        })}
      </div>
    </div>
  );
}
