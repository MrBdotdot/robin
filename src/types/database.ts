/**
 * Hand-written types matching the Supabase schema (migration-001).
 * Keep in sync with the SQL migration. When the schema grows we can
 * regenerate these via `supabase gen types typescript` later.
 */

export type EventStatus = "draft" | "live" | "completed" | "archived";
export type EventMode = "singles" | "doubles_americano";
export type EventFormat = "pure_rr" | "rr_knockout" | "rr_final_bronze";

export type MatchStage = "group_rr" | "knockout" | "bronze" | "final";
export type MatchStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "forfeit_a"
  | "forfeit_b"
  | "walkover"
  | "cancelled";
export type WinnerSide = "a" | "b" | "draw";

export type RatingType = "singles" | "doubles";

export type ScoringTemplate =
  | { type: "win_loss" }
  | { type: "first_to_points"; points_to: number; win_by: number }
  | { type: "best_of_sets"; sets: number; set_to: number; win_by: number }
  | { type: "timed"; minutes: number }
  | { type: "custom"; fields: Array<{ name: string; type: "int" | "decimal" | "bool" }> };

export type EventConfig = {
  num_courts?: number;
  tiebreakers?: Array<"wins" | "h2h" | "point_diff" | "points_for" | "points_against">;
  num_groups?: number;
  advance_per_group?: number;
  knockout_depth?: number; // 1 = final only, 2 = SF+F, 3 = QF+SF+F, ...
  include_bronze?: boolean;
  /** Stagger sub-rounds so a player who just played gets a rest before
   *  their next appearance. Only meaningful when matches per Berger round
   *  exceed numCourts (so rounds get split). */
  avoid_back_to_back?: boolean;
  /** Bias scheduling against pairing players who just played each other or
   *  partnered together. Helps spread out repeat matchups. */
  avoid_recent_matchups?: boolean;
  /** When on, fill empty courts with extra "bonus" matches by pulling in
   *  players who've already played. Reduces idle time at the cost of strict
   *  round-robin fairness (some matchups will repeat). */
  fill_empty_courts?: boolean;
};

export interface Player {
  id: string;
  full_name: string;
  glicko_singles_rating: number;
  glicko_singles_rd: number;
  glicko_singles_vol: number;
  glicko_doubles_rating: number;
  glicko_doubles_rd: number;
  glicko_doubles_vol: number;
  matches_played: number;
  last_played_at: string | null;
  created_at: string;
}

export interface Pair {
  id: string;
  player_a_id: string;
  player_b_id: string;
  pair_rating: number;
  pair_rd: number;
  pair_vol: number;
  matches_played: number;
  last_played_at: string | null;
  created_at: string;
}

export interface EventRow {
  id: string;
  name: string;
  sport: string;
  mode: EventMode;
  format: EventFormat;
  scoring_template: ScoringTemplate;
  config: EventConfig;
  status: EventStatus;
  scheduled_date: string | null;
  notes: string | null;
  series_id: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface Series {
  id: string;
  name: string;
  description: string | null;
  starts_on: string | null;
  ends_on: string | null;
  created_at: string;
}

export interface EventPlayer {
  id: string;
  event_id: string;
  player_id: string;
  seed: number | null;
  joined_at_round: number;
  withdrawn: boolean;
  withdrawn_at_round: number | null;
  final_rank: number | null;
  initial_rating_snapshot: unknown;
  added_at: string;
}

export interface MatchRow {
  id: string;
  event_id: string;
  stage: MatchStage;
  group_label: string | null;
  knockout_round: string | null;
  round: number;
  court: number | null;
  side_a_player_ids: string[];
  side_b_player_ids: string[];
  side_a_pair_id: string | null;
  side_b_pair_id: string | null;
  status: MatchStatus;
  winner_side: WinnerSide | null;
  scores: unknown;
  scheduled_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Minimal Database type for the typed Supabase client. We only need
 * Row / Insert / Update for tables we actually touch from the client.
 */
export type Database = {
  public: {
    Tables: {
      rr_events: {
        Row: EventRow;
        Insert: Omit<EventRow, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<EventRow>;
      };
      rr_players: {
        Row: Player;
        Insert: Omit<Player, "id" | "created_at" | "matches_played"> & {
          id?: string;
          created_at?: string;
          matches_played?: number;
        };
        Update: Partial<Player>;
      };
      rr_event_players: {
        Row: EventPlayer;
        Insert: Omit<EventPlayer, "id" | "added_at"> & {
          id?: string;
          added_at?: string;
        };
        Update: Partial<EventPlayer>;
      };
      rr_matches: {
        Row: MatchRow;
        Insert: Omit<MatchRow, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<MatchRow>;
      };
      rr_series: {
        Row: Series;
        Insert: Omit<Series, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Series>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
