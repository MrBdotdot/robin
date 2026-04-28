import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface RoundSummary {
  total: number;
  done: number; // completed | forfeit_a | forfeit_b | walkover | cancelled
  inProgress: number;
}

interface RoundNavigatorProps {
  current: number;
  total: number;
  liveRound?: number | null;
  liveRoundIsPlaying?: boolean;
  onChange: (round: number) => void;
  /** Optional per-round progress info — used by the chip strip to color
   *  each chip based on match completion. Provide an array of length
   *  `total` where index 0 = round 1. */
  roundSummaries?: RoundSummary[];
}

export function RoundNavigator({
  current,
  total,
  liveRound,
  liveRoundIsPlaying,
  onChange,
  roundSummaries,
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

  // Overall progression summary derived from per-round info
  const overall = useMemo(() => {
    if (!roundSummaries) return null;
    let done = 0;
    let totalMatches = 0;
    let inProgress = 0;
    for (const r of roundSummaries) {
      done += r.done;
      totalMatches += r.total;
      inProgress += r.inProgress;
    }
    return { done, totalMatches, inProgress };
  }, [roundSummaries]);

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
              className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Circle className="h-2 w-2 fill-current" aria-hidden />
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

      {/* Overall progression line — shows total match completion */}
      {overall && overall.totalMatches > 0 && (
        <p className="mt-2 text-center text-xs tabular-nums text-muted-foreground">
          {overall.done} of {overall.totalMatches} matches done
          {overall.inProgress > 0 && (
            <span className="ml-1">· {overall.inProgress} in progress</span>
          )}
        </p>
      )}

      {/* Round chip strip — horizontally scrollable timeline of every round.
          Each chip shows the round number plus a status color (live = Sun
          Glare, done = darker neutral, future = muted) AND a fill indicator
          for match completion within that round. */}
      <RoundChipStrip
        total={total}
        current={current}
        liveRound={liveRound ?? null}
        liveRoundIsPlaying={!!liveRoundIsPlaying}
        onChange={onChange}
        roundSummaries={roundSummaries}
      />
    </div>
  );
}

interface RoundChipStripProps {
  total: number;
  current: number;
  liveRound: number | null;
  liveRoundIsPlaying: boolean;
  onChange: (round: number) => void;
  roundSummaries?: RoundSummary[];
}

/**
 * Horizontally scrollable chip strip — one chip per round. Auto-scrolls
 * the active chip into view when `current` changes. Each chip optionally
 * shows a per-round completion fraction underneath the round number.
 */
function RoundChipStrip({
  total,
  current,
  liveRound,
  liveRoundIsPlaying,
  onChange,
  roundSummaries,
}: RoundChipStripProps) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const node = activeRef.current;
    const parent = stripRef.current;
    if (!node || !parent) return;
    const left =
      node.offsetLeft - parent.clientWidth / 2 + node.clientWidth / 2;
    parent.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [current]);

  return (
    <div className="-mx-4 mt-3 md:-mx-6">
      <div
        ref={stripRef}
        role="tablist"
        aria-label="Round timeline"
        className="flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:thin] md:px-6"
      >
        {Array.from({ length: total }, (_, i) => {
          const round = i + 1;
          const summary = roundSummaries?.[i];
          const isActive = round === current;
          const isLive = liveRound != null && round === liveRound;
          const isPast = liveRound != null && round < liveRound;
          const isFinal = liveRound == null && round === total;
          const isFullyDone =
            summary != null && summary.total > 0 && summary.done === summary.total;
          const hasInProgress = summary != null && summary.inProgress > 0;

          // Tone — keeps WCAG AA contrast for the inner text
          const tone = isActive
            ? isLive
              ? "bg-live text-live-foreground border-live"
              : isPast || isFullyDone
              ? "bg-foreground text-background border-foreground"
              : "bg-primary text-primary-foreground border-primary"
            : isLive
            ? hasInProgress || liveRoundIsPlaying
              ? "bg-live/30 text-foreground border-live"
              : "bg-live/15 text-foreground border-live/60"
            : isPast || isFullyDone
            ? "bg-muted text-muted-foreground border-border"
            : isFinal
            ? "bg-completed text-completed-foreground border-completed"
            : "bg-card text-muted-foreground border-border hover:bg-accent/40 hover:text-foreground";

          // Per-round completion fraction (e.g. "2/4")
          const showFraction =
            summary != null && summary.total > 0 && !isFullyDone;
          const ariaLabel = summary
            ? `Round ${round}, ${summary.done} of ${summary.total} matches done${
                summary.inProgress > 0
                  ? `, ${summary.inProgress} in progress`
                  : ""
              }${isLive ? " (current)" : isPast ? " (past)" : ""}`
            : `Round ${round}${isLive ? " (current)" : isPast ? " (past)" : ""}`;

          return (
            <button
              key={round}
              ref={isActive ? activeRef : undefined}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={ariaLabel}
              onClick={() => onChange(round)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                tone,
                isActive && "scale-[1.05]"
              )}
            >
              <span>{round}</span>
              {showFraction && (
                <span className="text-[10px] font-medium opacity-80">
                  {summary!.done}/{summary!.total}
                </span>
              )}
              {isFullyDone && !isActive && (
                <span className="text-[10px] opacity-70" aria-hidden>
                  ✓
                </span>
              )}
              {isLive && (
                <Circle
                  className={cn(
                    "h-1.5 w-1.5 fill-current",
                    liveRoundIsPlaying && "animate-pulse"
                  )}
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
