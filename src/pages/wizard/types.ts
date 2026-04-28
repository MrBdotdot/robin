import type { EventFormat, EventMode, ScoringTemplate } from "@/types/database";
import { DEFAULT_TIEBREAKERS } from "@/lib/presets";

export type ScoringType = ScoringTemplate["type"];

export interface WizardState {
  // Step 1
  name: string;
  sportPreset: string;
  sportLabel: string;
  scheduledDate: string;
  mode: EventMode;
  // Step 2
  scoringType: ScoringType;
  pointsTo: number;
  winBy: number;
  setsBestOf: number;
  setTo: number;
  // Step 3
  format: EventFormat;
  knockoutDepth: number;
  numGroups: number;
  advancePerGroup: number;
  // Step 4
  numCourts: number;
  tiebreakers: string[];
  notes: string;
  seedingStrategy: "rating" | "random" | "order";
  avoidBackToBack: boolean;
  avoidRecentMatchups: boolean;
  fillEmptyCourts: boolean;
  /** 0 = full round-robin (no cap). Otherwise the per-player round cap. */
  minRoundsPerPlayer: number;
  // Step 5
  playerNames: string[];
}

export const STEPS = [
  { id: 1, label: "Basics" },
  { id: 2, label: "Scoring" },
  { id: 3, label: "Format" },
  { id: 4, label: "Settings" },
  { id: 5, label: "Players" },
] as const;

export const initialWizardState = (): WizardState => ({
  name: "",
  sportPreset: "pickleball",
  sportLabel: "Pickleball",
  scheduledDate: new Date().toISOString().slice(0, 10),
  mode: "doubles_americano",
  scoringType: "first_to_points",
  pointsTo: 11,
  winBy: 2,
  setsBestOf: 3,
  setTo: 21,
  format: "pure_rr",
  knockoutDepth: 2,
  numGroups: 1,
  advancePerGroup: 4,
  numCourts: 2,
  tiebreakers: [...DEFAULT_TIEBREAKERS],
  notes: "",
  seedingStrategy: "rating",
  avoidBackToBack: true,
  avoidRecentMatchups: true,
  fillEmptyCourts: true,
  minRoundsPerPlayer: 0,
  playerNames: [],
});

export interface StepProps {
  s: WizardState;
  set: <K extends keyof WizardState>(key: K, value: WizardState[K]) => void;
}

export function describeKnockoutDepth(d: number): string {
  if (d <= 1) return "Just the final (top 2)";
  if (d === 2) return "Semifinals + final (top 4)";
  if (d === 3) return "Quarterfinals onward (top 8)";
  return "Round of 16 onward (top 16)";
}
