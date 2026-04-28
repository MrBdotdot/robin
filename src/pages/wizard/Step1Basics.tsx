import { SPORT_PRESETS } from "@/lib/presets";
import type { EventMode } from "@/types/database";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "./FormField";
import type { StepProps } from "./types";

export function Step1Basics({ s, set }: StepProps) {
  const handlePresetChange = (preset: string) => {
    const found = SPORT_PRESETS.find((p) => p.id === preset);
    if (!found) return;
    set("sportPreset", preset);
    if (preset !== "custom") {
      set("sportLabel", found.label);
      set("mode", found.defaultMode);
      set("scoringType", found.scoring.type);
      if (found.scoring.type === "first_to_points") {
        set("pointsTo", found.scoring.points_to);
        set("winBy", found.scoring.win_by);
      }
      if (found.scoring.type === "best_of_sets") {
        set("setsBestOf", found.scoring.sets);
        set("setTo", found.scoring.set_to);
        set("winBy", found.scoring.win_by);
      }
    }
  };

  return (
    <div className="space-y-5">
      <FormField label="Event name" htmlFor="name">
        <Input
          id="name"
          value={s.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Saturday Pickleball Open"
          autoFocus
        />
      </FormField>

      <FormField label="Sport" htmlFor="sport">
        <Select
          id="sport"
          value={s.sportPreset}
          onChange={(e) => handlePresetChange(e.target.value)}
        >
          {SPORT_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
        {s.sportPreset === "custom" && (
          <Input
            value={s.sportLabel}
            onChange={(e) => set("sportLabel", e.target.value)}
            placeholder="Sport name"
            className="mt-2"
          />
        )}
      </FormField>

      <FormField label="Date" htmlFor="date">
        <Input
          id="date"
          type="date"
          value={s.scheduledDate}
          onChange={(e) => set("scheduledDate", e.target.value)}
        />
      </FormField>

      <FormField label="Singles or doubles?" htmlFor="mode">
        <Select
          id="mode"
          value={s.mode}
          onChange={(e) => set("mode", e.target.value as EventMode)}
        >
          <option value="singles">Singles (one vs one)</option>
          <option value="doubles_americano">
            Doubles (partners rotate each round)
          </option>
        </Select>
      </FormField>
    </div>
  );
}
