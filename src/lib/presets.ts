import type { ScoringTemplate } from "@/types/database";

/**
 * Sport presets — pre-fills the wizard with sensible defaults. The user can
 * still customize anything after picking a preset.
 */
export interface SportPreset {
  id: string;
  label: string;
  defaultMode: "singles" | "doubles_americano" | "doubles_partners";
  scoring: ScoringTemplate;
}

export const SPORT_PRESETS: SportPreset[] = [
  {
    id: "pickleball",
    label: "Pickleball",
    defaultMode: "doubles_americano",
    scoring: { type: "first_to_points", points_to: 11, win_by: 2 },
  },
  {
    id: "table_tennis",
    label: "Table Tennis",
    defaultMode: "singles",
    scoring: { type: "best_of_sets", sets: 5, set_to: 11, win_by: 2 },
  },
  {
    id: "tennis",
    label: "Tennis",
    defaultMode: "singles",
    scoring: { type: "best_of_sets", sets: 3, set_to: 6, win_by: 2 },
  },
  {
    id: "badminton",
    label: "Badminton",
    defaultMode: "singles",
    scoring: { type: "best_of_sets", sets: 3, set_to: 21, win_by: 2 },
  },
  {
    id: "cornhole",
    label: "Cornhole",
    defaultMode: "doubles_americano",
    scoring: { type: "first_to_points", points_to: 21, win_by: 1 },
  },
  {
    id: "chess",
    label: "Chess",
    defaultMode: "singles",
    scoring: { type: "win_loss" },
  },
  {
    id: "custom",
    label: "Custom (set everything yourself)",
    defaultMode: "singles",
    scoring: { type: "win_loss" },
  },
];

export const SCORING_TYPE_LABELS: Record<ScoringTemplate["type"], string> = {
  win_loss: "Just win or lose",
  first_to_points: "First to a number of points",
  best_of_sets: "Best of several sets",
  timed: "Timed match",
  custom: "Custom",
};

export const DEFAULT_TIEBREAKERS = [
  "wins",
  "h2h",
  "point_diff",
  "points_for",
] as const;

export const TIEBREAKER_LABELS: Record<string, string> = {
  wins: "Match wins",
  h2h: "Head-to-head",
  point_diff: "Point differential",
  points_for: "Points scored",
  points_against: "Points conceded",
};
