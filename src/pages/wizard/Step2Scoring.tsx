import { SCORING_TYPE_LABELS } from "@/lib/presets";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "./FormField";
import type { ScoringType, StepProps } from "./types";

export function Step2Scoring({ s, set }: StepProps) {
  return (
    <div className="space-y-5">
      <FormField label="How are matches scored?" htmlFor="scoringType">
        <Select
          id="scoringType"
          value={s.scoringType}
          onChange={(e) => set("scoringType", e.target.value as ScoringType)}
        >
          {(Object.keys(SCORING_TYPE_LABELS) as ScoringType[]).map((t) => (
            <option key={t} value={t}>
              {SCORING_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
      </FormField>

      {s.scoringType === "first_to_points" && (
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Points to win" htmlFor="pointsTo">
            <Input
              id="pointsTo"
              type="number"
              inputMode="numeric"
              min={1}
              value={s.pointsTo}
              onChange={(e) => set("pointsTo", Number(e.target.value))}
            />
          </FormField>
          <FormField label="Must win by" htmlFor="winBy">
            <Input
              id="winBy"
              type="number"
              inputMode="numeric"
              min={1}
              value={s.winBy}
              onChange={(e) => set("winBy", Number(e.target.value))}
            />
          </FormField>
        </div>
      )}

      {s.scoringType === "best_of_sets" && (
        <div className="grid grid-cols-3 gap-4">
          <FormField label="Number of sets" htmlFor="setsBestOf">
            <Input
              id="setsBestOf"
              type="number"
              inputMode="numeric"
              min={1}
              value={s.setsBestOf}
              onChange={(e) => set("setsBestOf", Number(e.target.value))}
            />
          </FormField>
          <FormField label="Points per set" htmlFor="setTo">
            <Input
              id="setTo"
              type="number"
              inputMode="numeric"
              min={1}
              value={s.setTo}
              onChange={(e) => set("setTo", Number(e.target.value))}
            />
          </FormField>
          <FormField label="Must win by" htmlFor="winBy2">
            <Input
              id="winBy2"
              type="number"
              inputMode="numeric"
              min={1}
              value={s.winBy}
              onChange={(e) => set("winBy", Number(e.target.value))}
            />
          </FormField>
        </div>
      )}

      {s.scoringType === "win_loss" && (
        <p className="text-sm text-muted-foreground">
          Each match is just a win or a loss. No scores recorded.
        </p>
      )}

      {s.scoringType === "timed" && (
        <p className="text-sm text-muted-foreground">
          Timed matches aren't fully ready yet — for now, each match is 15 minutes.
        </p>
      )}

      {s.scoringType === "custom" && (
        <p className="text-sm text-muted-foreground">
          Custom scoring is coming soon — you'll be able to set up your own rules.
        </p>
      )}
    </div>
  );
}
