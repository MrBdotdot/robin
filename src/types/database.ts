/**
 * Hand-written types matching the Supabase schema (migration-001).
 * Keep in sync with the SQL migration. When the schema grows we can
 * regenerate these via `supabase gen types typescript` later.
 */

export type EventStatus = "draft" | "live" | "completed" | "archived";
export type EventMode = "singles" | "doubles_americano" | "doubles_partners";
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
  knockout_depth?: number;
  include_bronze?: boolean;
  avoid_back_to_back?: boolean;
  avoid_recent_matchups?: boolean;
  fill_empty_courts?: boolean;
  /** Optional cap: each player plays at most this many rounds in group
   *  play. When unset, the full N-1 round-robin is generated. Useful for
   *  events that should transition to playoffs after a fixed number of
   *  rounds rather than playing the entire round-robin. */
  min_rounds_per_player?: number;
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

/**
 * Per-series Glicko rating row. One per (player, series). When an event
 * is part of a series, results from that event update this row in
 * addition to the player's global rating on rr_players.
 */
export interface SeriesRating {
  id: string;
  player_id: string;
  series_id: string;
  glicko_singles_rating: number;
  glicko_singles_rd: number;
  glicko_singles_vol: number;
  glicko_doubles_rating: number;
  glicko_doubles_rd: number;
  glicko_doubles_vol: number;
  matches_played: number;
  last_played_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Concrete shape of the JSON stored in rr_event_players.initial_rating_snapshot.
 * `global` is always present; `series` is populated only when the event has a
 * series_id. The replay engine in liveRatings.ts uses these as the starting
 * Glicko states for global and series live recomputation respectively.
 */
export interface InitialRatingSnapshot {
  global: {
    singles: { rating: number; rd: number; vol: number };
    doubles: { rating: number; rd: number; vol: number };
  };
  series?: {
    singles: { rating: number; rd: number; vol: number };
    doubles: { rating: number; rd: number; vol: number };
  } | null;
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
 *
 * NOTE: supabase-js v2.105+ requires a `Relationships: []` field on each
 * table for the type to satisfy `GenericTable` and unlock typed queries.
 */
export type Database = {
  public: {
    Tables: {
      rr_events: {
        Row: EventRow;
        Insert: Partial<EventRow> & {
          name: string;
          sport: string;
          mode: EventMode;
          format: EventFormat;
          scoring_template: ScoringTemplate;
          config: EventConfig;
        };
        Update: Partial<EventRow>;
        Relationships: [];
      };
      rr_players: {
        Row: Player;
        Insert: Partial<Player> & { full_name: string };
        Update: Partial<Player>;
        Relationships: [];
      };
      rr_event_players: {
        Row: EventPlayer;
        Insert: Partial<EventPlayer> & {
          event_id: string;
          player_id: string;
        };
        Update: Partial<EventPlayer>;
        Relationships: [];
      };
      rr_matches: {
        Row: MatchRow;
        Insert: Partial<MatchRow> & {
          event_id: string;
          stage: MatchStage;
          round: number;
          side_a_player_ids: string[];
          side_b_player_ids: string[];
          status: MatchStatus;
        };
        Update: Partial<MatchRow>;
        Relationships: [];
      };
      rr_series: {
        Row: Series;
        Insert: Partial<Series> & { name: string };
        Update: Partial<Series>;
        Relationships: [];
      };
      rr_series_ratings: {
        Row: SeriesRating;
        Insert: Partial<SeriesRating> & {
          player_id: string;
          series_id: string;
        };
        Update: Partial<SeriesRating>;
        Relationships: [];
      };
    };
    Views: {};
    Functions: {};
    Enums: {};
    CompositeTypes: {};
  };
};

// =========================================================================
// Phase 2 — auth, memberships, invites, scorekeeper assignment
// =========================================================================

export type Role = "admin" | "scorekeeper" | "participant";

export interface Membership {
  id: string;
  user_id: string;
  role: Role;
  created_at: string;
}

export interface Invite {
  id: string;
  email: string;
  role: Role;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_by: string;
  created_at: string;
}

/** Result of the lookup_invite RPC (subset of Invite, no token/created_by). */
export interface InviteLookup {
  id: string;
  email: string;
  role: Role;
  expires_at: string;
  accepted_at: string | null;
}

export interface EventCollaborator {
  id: string;
  user_id: string;
  event_id: string;
  granted_by: string;
  granted_at: string;
}

