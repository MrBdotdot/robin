import type { ReactNode } from "react";
import { Stepper } from "./Stepper";

/**
 * "First to N" / timed-match score entry — one stepper per side.
 */
export function PointsEntry({
  sideAContent,
  sideBContent,
  a,
  b,
  onA,
  onB,
  renderSideHeader,
}: {
  sideAContent: ReactNode;
  sideBContent: ReactNode;
  a: number;
  b: number;
  onA: (v: number) => void;
  onB: (v: number) => void;
  renderSideHeader: (content: ReactNode, side: "a" | "b") => ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div>
        {renderSideHeader(sideAContent, "a")}
        <Stepper value={a} onChange={onA} className="mt-2" />
      </div>
      <div>
        {renderSideHeader(sideBContent, "b")}
        <Stepper value={b} onChange={onB} className="mt-2" />
      </div>
    </div>
  );
}
