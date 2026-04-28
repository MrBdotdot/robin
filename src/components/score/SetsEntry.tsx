import type { ReactNode } from "react";
import { Stepper } from "./Stepper";

export interface SetScore {
  side_a: number;
  side_b: number;
}

/**
 * Best-of-N sets score entry — one mini stepper pair per set.
 */
export function SetsEntry({
  sideAContent,
  sideBContent,
  sets,
  onChange,
  renderSideHeader,
}: {
  sideAContent: ReactNode;
  sideBContent: ReactNode;
  sets: SetScore[];
  onChange: (sets: SetScore[]) => void;
  renderSideHeader: (content: ReactNode, side: "a" | "b") => ReactNode;
}) {
  const updateSet = (idx: number, patch: Partial<SetScore>) => {
    const next = sets.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    onChange(next);
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3">
        <div>{renderSideHeader(sideAContent, "a")}</div>
        <div>{renderSideHeader(sideBContent, "b")}</div>
      </div>

      <div className="space-y-3">
        {sets.map((set, idx) => (
          <div key={idx} className="rounded-lg border bg-background p-4">
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Set {idx + 1}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stepper
                value={set.side_a}
                onChange={(v) => updateSet(idx, { side_a: v })}
                compact
              />
              <Stepper
                value={set.side_b}
                onChange={(v) => updateSet(idx, { side_b: v })}
                compact
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
