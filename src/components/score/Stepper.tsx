import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Score stepper used in PointsEntry and SetsEntry. Big +/- buttons for
 * thumb-friendly nudging, plus a tappable number input for direct entry.
 */
export function Stepper({
  value,
  onChange,
  className,
  compact,
}: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <button
        type="button"
        onClick={() => onChange(Math.max(0, value - 1))}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md border bg-background text-foreground hover:bg-accent active:scale-95 transition",
          compact ? "h-10 w-10" : "h-12 w-12"
        )}
        aria-label="Decrease"
      >
        <Minus className={compact ? "h-4 w-4" : "h-5 w-5"} />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange(0);
            return;
          }
          const n = parseInt(raw, 10);
          if (!Number.isNaN(n)) onChange(Math.max(0, n));
        }}
        onFocus={(e) => e.target.select()}
        aria-label="Score"
        className={cn(
          "flex-1 min-w-0 bg-transparent text-center font-semibold tabular-nums outline-none",
          "rounded-md focus:bg-accent/40",
          // Hide native spinner buttons — keep our +/- buttons as the primary nudge
          "appearance-none [appearance:textfield]",
          "[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0",
          "[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0",
          compact ? "text-2xl py-1" : "text-4xl py-1"
        )}
      />
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md border bg-background text-foreground hover:bg-accent active:scale-95 transition",
          compact ? "h-10 w-10" : "h-12 w-12"
        )}
        aria-label="Increase"
      >
        <Plus className={compact ? "h-4 w-4" : "h-5 w-5"} />
      </button>
    </div>
  );
}
