import type { ReactNode } from "react";
import type { WinnerSide } from "@/types/database";
import { PickRow } from "./PickRow";

/**
 * Win-or-lose pick UI — three rows: Side A wins, Side B wins, Draw.
 * Each side's content is passed in so the parent can render player names
 * with their own (substitute) buttons.
 */
export function WinLossEntry({
  sideAContent,
  sideBContent,
  pick,
  onPick,
}: {
  sideAContent: ReactNode;
  sideBContent: ReactNode;
  pick: WinnerSide | null;
  onPick: (p: WinnerSide) => void;
}) {
  return (
    <div className="space-y-2">
      <PickRow
        content={sideAContent}
        active={pick === "a"}
        onClick={() => onPick("a")}
      />
      <PickRow
        content={sideBContent}
        active={pick === "b"}
        onClick={() => onPick("b")}
      />
      <PickRow
        content={<span className="text-sm font-medium">Draw</span>}
        active={pick === "draw"}
        onClick={() => onPick("draw")}
        subtle
      />
    </div>
  );
}
