import { TIEBREAKER_LABELS } from "@/lib/presets";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "./FormField";
import type { StepProps, WizardState } from "./types";

interface ToggleRowProps {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
  className?: string;
}

function ToggleRow({ active, onClick, title, desc, className }: ToggleRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between rounded-lg border bg-background p-4 text-left transition-colors hover:bg-accent/40",
        active && "border-primary ring-2 ring-primary/20",
        className
      )}
    >
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{desc}</span>
      </span>
      <span
        aria-hidden
        className={cn(
          "ml-3 inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors",
          active ? "border-primary bg-primary" : "border-input bg-muted"
        )}
      >
        <span
          className={cn(
            "h-5 w-5 rounded-full bg-card shadow-sm transition-transform",
            active ? "translate-x-4" : "translate-x-0.5"
          )}
        />
      </span>
    </button>
  );
}

export function Step4Settings({ s, set }: StepProps) {
  const moveTiebreaker = (idx: number, dir: -1 | 1) => {
    const next = [...s.tiebreakers];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    set("tiebreakers", next);
  };

  return (
    <div className="space-y-5">
      <FormField label="How many courts or tables?" htmlFor="courts">
        <Input
          id="courts"
          type="number"
          inputMode="numeric"
          min={1}
          value={s.numCourts}
          onChange={(e) => set("numCourts", Number(e.target.value))}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          More courts means more matches happen at the same time.
        </p>
      </FormField>

      <FormField
        label="Cap on group-play rounds (optional)"
        htmlFor="min-rounds"
      >
        <Input
          id="min-rounds"
          type="number"
          inputMode="numeric"
          min={0}
          value={s.minRoundsPerPlayer || ""}
          onChange={(e) =>
            set("minRoundsPerPlayer", Math.max(0, Number(e.target.value) || 0))
          }
          placeholder="Leave blank for full round-robin"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Sets a maximum number of group-play rounds before the playoffs.
          Useful for big rosters where a full round-robin would take too long.
          Leave blank or set to 0 to play the entire round-robin.
        </p>
      </FormField>

      <FormField label="Smart scheduling">
        <ToggleRow
          active={s.avoidBackToBack}
          onClick={() => set("avoidBackToBack", !s.avoidBackToBack)}
          title="Avoid back-to-back matches"
          desc="When more matches than courts are needed, players who just played get pushed to a later sub-round so they aren't immediately on again."
        />
        <ToggleRow
          active={s.avoidRecentMatchups}
          onClick={() => set("avoidRecentMatchups", !s.avoidRecentMatchups)}
          title="Avoid recent matchups"
          desc="Bias scheduling against pairing players who just played each other or were just partners. Helps spread out repeats."
          className="mt-2"
        />
        <ToggleRow
          active={s.fillEmptyCourts}
          onClick={() => set("fillEmptyCourts", !s.fillEmptyCourts)}
          title="Fill empty courts"
          desc='When a round can&apos;t fill every court, pull in already-played players so courts stay busy. Some matchups will repeat — turn off if you want strict "everyone plays everyone exactly once."'
          className="mt-2"
        />
      </FormField>

      <FormField label="How should players be ordered?" htmlFor="seeding">
        <Select
          id="seeding"
          value={s.seedingStrategy}
          onChange={(e) =>
            set(
              "seedingStrategy",
              e.target.value as WizardState["seedingStrategy"]
            )
          }
        >
          <option value="rating">By rating — balanced matches</option>
          <option value="random">Random</option>
          <option value="order">In the order I added them</option>
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">
          {s.seedingStrategy === "rating" &&
            "Higher-rated players are spread across the schedule, so early rounds tend to mix skill levels."}
          {s.seedingStrategy === "random" &&
            "Pairings are shuffled. Different every time you create an event."}
          {s.seedingStrategy === "order" &&
            "Players are seeded in the order you added them in step 5."}
        </p>
      </FormField>

      <FormField label="Tiebreakers">
        <p className="mb-2 text-xs text-muted-foreground">
          If two players have the same wins, these decide who's ahead. The top
          of the list is checked first.
        </p>
        <div className="space-y-1.5">
          {s.tiebreakers.map((tb, idx) => (
            <div
              key={tb}
              className="flex items-center justify-between rounded-md border bg-background px-3 py-2"
            >
              <span className="text-sm">
                {idx + 1}. {TIEBREAKER_LABELS[tb] ?? tb}
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => moveTiebreaker(idx, -1)}
                  disabled={idx === 0}
                  className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveTiebreaker(idx, 1)}
                  disabled={idx === s.tiebreakers.length - 1}
                  className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
                  aria-label="Move down"
                >
                  ↓
                </button>
              </div>
            </div>
          ))}
        </div>
      </FormField>
    </div>
  );
}
