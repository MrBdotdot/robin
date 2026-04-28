import type { EventFormat } from "@/types/database";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { FormField } from "./FormField";
import { describeKnockoutDepth, type StepProps } from "./types";

const FORMAT_OPTIONS = [
  {
    v: "pure_rr",
    label: "Round robin only",
    desc: "Everyone plays everyone. The most wins takes 1st place.",
  },
  {
    v: "rr_final_bronze",
    label: "Round robin, then a final",
    desc: "After everyone plays, the top 2 play for 1st place. 3rd and 4th play for 3rd place.",
  },
  {
    v: "rr_knockout",
    label: "Round robin, then knockout",
    desc: "After group play, the best players advance. Lose once and you're out.",
  },
] as const;

export function Step3Format({ s, set }: StepProps) {
  return (
    <div className="space-y-5">
      <FormField label="How should the tournament run?">
        <div className="grid gap-2">
          {FORMAT_OPTIONS.map(({ v, label, desc }) => (
            <button
              key={v}
              type="button"
              onClick={() => set("format", v as EventFormat)}
              className={cn(
                "rounded-lg border bg-background p-4 text-left transition-colors",
                s.format === v
                  ? "border-primary ring-2 ring-primary/20"
                  : "hover:bg-accent"
              )}
            >
              <div className="font-medium">{label}</div>
              <div className="mt-0.5 text-sm text-muted-foreground">{desc}</div>
            </button>
          ))}
        </div>
      </FormField>

      {s.format === "rr_knockout" && (
        <>
          <FormField
            label={`Knockout size: ${describeKnockoutDepth(s.knockoutDepth)}`}
          >
            <Slider
              value={s.knockoutDepth}
              min={1}
              max={4}
              onChange={(v) => set("knockoutDepth", v)}
              aria-label="Knockout size"
            />
            <div className="mt-1 flex justify-between text-xs text-muted-foreground">
              <span>Top 2</span>
              <span>Top 4</span>
              <span>Top 8</span>
              <span>Top 16</span>
            </div>
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Number of groups" htmlFor="groups">
              <Input
                id="groups"
                type="number"
                inputMode="numeric"
                min={1}
                value={s.numGroups}
                onChange={(e) => set("numGroups", Number(e.target.value))}
              />
            </FormField>
            <FormField label="How many advance per group" htmlFor="advance">
              <Input
                id="advance"
                type="number"
                inputMode="numeric"
                min={1}
                value={s.advancePerGroup}
                onChange={(e) =>
                  set("advancePerGroup", Number(e.target.value))
                }
              />
            </FormField>
          </div>
        </>
      )}
    </div>
  );
}
