import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One row in WinLossEntry's pick list. Uses div + role=button so the player
 * name buttons inside (which trigger substitution) can be nested without
 * violating HTML.
 */
export function PickRow({
  content,
  active,
  onClick,
  subtle,
}: {
  content: ReactNode;
  active: boolean;
  onClick: () => void;
  subtle?: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      aria-pressed={active}
      className={cn(
        "flex w-full cursor-pointer items-center justify-between rounded-lg border bg-background p-4 text-left transition-colors",
        active
          ? "border-primary ring-2 ring-primary/20"
          : "hover:bg-accent/50",
        subtle && "border-dashed",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
    >
      {content}
      {active && <Check className="h-4 w-4 text-primary" />}
    </div>
  );
}
