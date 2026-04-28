/**
 * Schedule generators for round-robin tournaments.
 *
 * - Singles: Berger / circle method (well-known, optimal for round robin).
 * - Doubles Americano: reuses Berger to generate partnership rounds, then
 *   pairs partnerships into matches. Cleanest when player count is a
 *   multiple of 4. For 4k+2 player counts, one partnership sits out per
 *   round (rotated automatically by the Berger algorithm).
 *
 * All functions are pure and deterministic given the input order.
 */

export interface ScheduledMatch {
  round: number;          // 1-based — the SUB-ROUND number (after court splitting)
  /** The original Berger round before any court-driven splitting. When the
   *  number of matches exceeds available courts, a single Berger round is
   *  split into multiple sub-rounds; bergerRound lets the UI group them
   *  visually so users see "round 1 (set 1 of 2)" rather than two
   *  unrelated rounds. */
  bergerRound: number;
  court: number;          // 1-based, cycles within a round
  sideA: string[];        // length 1 for singles, 2 for doubles
  sideB: string[];
}

interface SchedulerOptions {
  numCourts?: number;     // for assigning court numbers to matches
  /** When true, prefer to schedule matches with players who haven't played
   *  recently — minimises back-to-back appearances when rounds are split
   *  due to court overflow. */
  avoidBackToBack?: boolean;
  /** When true, prefer matches whose pairs (partners + opponents) haven't
   *  played together recently. Helps spread out repeat matchups when the
   *  schedule gets regenerated mid-event. */
  avoidRecentMatchups?: boolean;
  /** When true, fill empty court slots with extra "bonus" matches by pulling
   *  in players who've already played. Reduces idle time at the cost of
   *  strict round-robin uniqueness (some matchups will repeat). */
  fillEmptyCourts?: boolean;
  /** Optional hard cap on rounds. When set, the schedule is truncated to
   *  this many rounds (kept in source order) so every player plays at
   *  most that many group-stage rounds. */
  minRoundsPerPlayer?: number;
}

const BYE = "__BYE__";

/**
 * Generate the partnership/opponent schedule for a round-robin where every
 * player meets every other player exactly once. Uses the standard "circle"
 * method: fix the first player, rotate the rest.
 *
 * Returns rounds of pairings — each pairing is an unordered pair of player ids.
 * Players are NOT guaranteed to be in input order.
 */
function bergerPairings(playerIds: string[]): { round: number; pairings: [string, string][] }[] {
  const arr = [...playerIds];
  if (arr.length % 2 === 1) arr.push(BYE);
  const n = arr.length;
  const rounds = n - 1;
  const half = n / 2;

  const result: { round: number; pairings: [string, string][] }[] = [];
  for (let r = 0; r < rounds; r++) {
    const pairings: [string, string][] = [];
    for (let i = 0; i < half; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== BYE && b !== BYE) {
        pairings.push([a, b]);
      }
    }
    result.push({ round: r + 1, pairings });

    // Rotate: keep arr[0] fixed, rotate the rest by one position
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop() as string);
    for (let i = 0; i < rest.length; i++) arr[i + 1] = rest[i];
    arr[0] = fixed;
  }
  return result;
}

function assignCourts<
  T extends { round: number; sideA: string[]; sideB: string[] }
>(
  matches: T[],
  numCourts: number,
  avoidBackToBack: boolean = false,
  avoidRecentMatchups: boolean = false
): (T & { court: number; round: number; bergerRound: number })[] {
  // Each Berger round has N/2 matches (N = padded player count). When that
  // count exceeds numCourts, we split the round into multiple "sub-rounds"
  // so every output round respects the court limit AND no court number
  // appears twice in the same round.
  //
  // When avoidBackToBack is on, within each Berger round we pick matches
  // for each chunk by least-recently-played: players who already played
  // in the previous sub-round get pushed to a later one, giving them rest.
  //
  // Ordering preserves the original Berger round sequence — round 1's
  // chunks become new rounds 1, 2, 3...; round 2's chunks pick up from
  // there. Within a chunk, courts are 1..K.
  const byRound = new Map<number, T[]>();
  for (const m of matches) {
    const list = byRound.get(m.round) ?? [];
    list.push(m);
    byRound.set(m.round, list);
  }

  const sortedOriginalRounds = Array.from(byRound.keys()).sort((a, b) => a - b);
  const result: (T & { court: number; round: number; bergerRound: number })[] = [];
  let nextRound = 1;
  const lastPlayedRound = new Map<string, number>();
  const lastPairRound = new Map<string, number>();

  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  // All unordered pairs of players in a match (partners + opponents).
  const pairsInMatch = (m: T): [string, string][] => {
    const ids = [...m.sideA, ...m.sideB];
    const out: [string, string][] = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        out.push([ids[i], ids[j]]);
      }
    }
    return out;
  };

  for (const origRound of sortedOriginalRounds) {
    let remaining = [...(byRound.get(origRound) ?? [])];

    while (remaining.length > 0) {
      let chunk: T[];

      if (avoidBackToBack || avoidRecentMatchups) {
        // Score each candidate by how recently its players / pairs have been on
        // court. Lower score = more rested / staler matchup → preferred earlier.
        const scored = remaining.map((m) => {
          let score = 0;
          if (avoidBackToBack) {
            const ids = [...m.sideA, ...m.sideB];
            const maxPlayer = ids.reduce(
              (max, id) => Math.max(max, lastPlayedRound.get(id) ?? 0),
              0
            );
            score += maxPlayer;
          }
          if (avoidRecentMatchups) {
            const maxPair = pairsInMatch(m).reduce(
              (max, [a, b]) => Math.max(max, lastPairRound.get(pairKey(a, b)) ?? 0),
              0
            );
            // Weight pair recency slightly higher so an exact repeat matchup
            // gets pushed out before a single shared player.
            score += maxPair * 2;
          }
          return { m, score };
        });
        scored.sort((a, b) => a.score - b.score);
        chunk = scored.slice(0, numCourts).map((s) => s.m);
        const chunkSet = new Set(chunk);
        remaining = remaining.filter((m) => !chunkSet.has(m));
      } else {
        chunk = remaining.slice(0, numCourts);
        remaining = remaining.slice(numCourts);
      }

      chunk.forEach((m, idx) => {
        // Preserve the original (pre-split) Berger round so the UI can
        // group sub-rounds together. m.round is already the Berger round
        // at this point — `nextRound` is the post-split sub-round.
        result.push({
          ...m,
          bergerRound: (m as unknown as { bergerRound?: number }).bergerRound ?? m.round,
          round: nextRound,
          court: idx + 1,
        });
        for (const id of [...m.sideA, ...m.sideB]) {
          lastPlayedRound.set(id, nextRound);
        }
        for (const [a, b] of pairsInMatch(m)) {
          lastPairRound.set(pairKey(a, b), nextRound);
        }
      });
      nextRound++;
    }
  }

  return result.sort((a, b) => a.round - b.round || a.court - b.court);
}

/**
 * For events that allow it, fill empty courts in any under-filled rounds
 * with bonus matches. Idle players are preferred; the rest is filled with
 * already-played players (least-played first, to spread the extra workload).
 *
 * Bonus matches are appended to the round in question. They count as real
 * matches in every other respect (rated, in standings, etc.), so a borrowed
 * player ends up playing more games than they otherwise would.
 */
function applyRefill<
  T extends { round: number; sideA: string[]; sideB: string[] }
>(
  matches: T[],
  allPlayerIds: string[],
  numCourts: number,
  mode: "singles" | "doubles_americano"
): T[] {
  const playersPerSide = mode === "singles" ? 1 : 2;
  const playersPerMatch = playersPerSide * 2;

  // Group by Berger round
  const byRound = new Map<number, T[]>();
  for (const m of matches) {
    const list = byRound.get(m.round) ?? [];
    list.push(m);
    byRound.set(m.round, list);
  }
  const sortedRounds = Array.from(byRound.keys()).sort((a, b) => a - b);

  const playCount = new Map<string, number>();
  for (const id of allPlayerIds) playCount.set(id, 0);

  const out: T[] = [];

  for (const r of sortedRounds) {
    const roundMatches = byRound.get(r) ?? [];
    const playing = new Set<string>();
    for (const m of roundMatches) {
      for (const id of [...m.sideA, ...m.sideB]) playing.add(id);
    }

    while (roundMatches.length < numCourts) {
      const idle = allPlayerIds.filter((id) => !playing.has(id));
      const played = allPlayerIds.filter((id) => playing.has(id));
      // Sort played by play count ascending (least played first)
      played.sort(
        (a, b) => (playCount.get(a) ?? 0) - (playCount.get(b) ?? 0)
      );

      // Compose: idle first, fill remainder from played
      const candidates = [...idle, ...played];
      if (candidates.length < playersPerMatch) break;

      const chosen = candidates.slice(0, playersPerMatch);
      // Pair into sides — first half vs second half preserves any leftover
      // partnership (idle pair) on side A.
      const sideA = chosen.slice(0, playersPerSide);
      const sideB = chosen.slice(playersPerSide, playersPerMatch);

      const newMatch = { round: r, sideA, sideB } as T;
      roundMatches.push(newMatch);
      for (const id of chosen) playing.add(id);
    }

    // Update play counts for everything in this round (real + bonus)
    for (const m of roundMatches) {
      for (const id of [...m.sideA, ...m.sideB]) {
        playCount.set(id, (playCount.get(id) ?? 0) + 1);
      }
    }

    out.push(...roundMatches);
  }

  return out;
}

/**
 * Generate a singles round robin schedule.
 * Each player faces every other player exactly once.
 *
 * @param playerIds Ordered list of player IDs (order acts as initial seed).
 * @param opts.numCourts How many courts/tables are available (default 1).
 */
export function generateSinglesSchedule(
  playerIds: string[],
  opts: SchedulerOptions = {}
): ScheduledMatch[] {
  if (playerIds.length < 2) {
    throw new Error("Need at least 2 players for singles");
  }
  const numCourts = Math.max(1, opts.numCourts ?? 1);
  const rounds = bergerPairings(playerIds);

  let matches: { round: number; sideA: string[]; sideB: string[] }[] = [];
  for (const { round, pairings } of rounds) {
    for (const [a, b] of pairings) {
      matches.push({ round, sideA: [a], sideB: [b] });
    }
  }

  if (opts.fillEmptyCourts) {
    matches = applyRefill(matches, playerIds, numCourts, "singles");
  }

  return assignCourts(
    matches,
    numCourts,
    opts.avoidBackToBack ?? false,
    opts.avoidRecentMatchups ?? false
  );
}

/**
 * Generate a doubles Americano schedule with rotating partners.
 *
 * Uses Berger to generate N-1 rounds of partnerships such that every pair of
 * players partners exactly once. Then within each round, partnerships are
 * paired sequentially into matches (pair 0 vs pair 1, pair 2 vs pair 3, …).
 *
 * - Cleanest for player counts that are multiples of 4.
 * - For 4k+2 player counts (e.g. 6, 10): an odd number of partnerships per
 *   round means the last partnership sits out that round. Rotation across
 *   rounds keeps it fair over the full schedule.
 * - For odd player counts: the algorithm pads with a bye, so one player sits
 *   out per round.
 *
 * @param playerIds Ordered list of player IDs.
 * @param opts.numCourts Courts available (default 1).
 */
export function generateDoublesAmericano(
  playerIds: string[],
  opts: SchedulerOptions = {}
): ScheduledMatch[] {
  if (playerIds.length < 4) {
    throw new Error("Need at least 4 players for doubles");
  }
  const numCourts = Math.max(1, opts.numCourts ?? 1);
  const rounds = bergerPairings(playerIds);

  let matches: { round: number; sideA: string[]; sideB: string[] }[] = [];
  for (const { round, pairings } of rounds) {
    // Pair up partnerships sequentially. Odd partnership at the end sits out.
    for (let i = 0; i + 1 < pairings.length; i += 2) {
      const sideA = pairings[i];
      const sideB = pairings[i + 1];
      matches.push({ round, sideA: [...sideA], sideB: [...sideB] });
    }
  }

  if (opts.fillEmptyCourts) {
    matches = applyRefill(matches, playerIds, numCourts, "doubles_americano");
  }

  return assignCourts(
    matches,
    numCourts,
    opts.avoidBackToBack ?? false,
    opts.avoidRecentMatchups ?? false
  );
}

/**
 * Generate just enough matches for every active player to play at least once.
 *
 * For singles with even player count: 1 Berger round (N/2 matches).
 * For singles with odd player count: 2 Berger rounds (one player sits out
 *   each round; rotation ensures everyone plays by round 2).
 * For doubles where N is divisible by 4: typically 1 Berger round.
 * For doubles where N is not divisible by 4: 2 Berger rounds (the leftover
 *   partnership / bye player rotates each round).
 *
 * Honors the same `avoidBackToBack`, `avoidRecentMatchups`, and
 * `fillEmptyCourts` options as the full schedule.
 */
export function generateOneRotation(
  mode: "singles" | "doubles_americano",
  playerIds: string[],
  opts: SchedulerOptions = {}
): ScheduledMatch[] {
  const min = mode === "doubles_americano" ? 4 : 2;
  if (playerIds.length < min) {
    throw new Error(`Need at least ${min} players for ${mode}`);
  }
  const numCourts = Math.max(1, opts.numCourts ?? 1);
  const rounds = bergerPairings(playerIds);

  let matches: { round: number; sideA: string[]; sideB: string[] }[] = [];
  const playedAtLeastOnce = new Set<string>();
  const target = playerIds.length;

  for (const r of rounds) {
    if (mode === "singles") {
      for (const [a, b] of r.pairings) {
        matches.push({ round: r.round, sideA: [a], sideB: [b] });
        playedAtLeastOnce.add(a);
        playedAtLeastOnce.add(b);
      }
    } else {
      for (let i = 0; i + 1 < r.pairings.length; i += 2) {
        const sideA = r.pairings[i];
        const sideB = r.pairings[i + 1];
        matches.push({ round: r.round, sideA: [...sideA], sideB: [...sideB] });
        for (const id of [...sideA, ...sideB]) playedAtLeastOnce.add(id);
      }
    }
    if (playedAtLeastOnce.size >= target) break;
  }

  if (opts.fillEmptyCourts) {
    matches = applyRefill(matches, playerIds, numCourts, mode);
  }

  return assignCourts(
    matches,
    numCourts,
    opts.avoidBackToBack ?? false,
    opts.avoidRecentMatchups ?? false
  );
}

/**
 * Convenience entry point — picks the right algorithm based on event mode.
 */
export function generateScheduleForMode(
  mode: "singles" | "doubles_americano",
  playerIds: string[],
  opts: SchedulerOptions = {}
): ScheduledMatch[] {
  const all =
    mode === "singles"
      ? generateSinglesSchedule(playerIds, opts)
      : generateDoublesAmericano(playerIds, opts);
  // If the user set a min/cap on rounds, truncate. Each player plays at most
  // `minRoundsPerPlayer` rounds in group play before transitioning to
  // playoffs (which the user triggers manually).
  const cap = opts.minRoundsPerPlayer;
  if (cap && cap > 0) {
    return all.filter((m) => m.round <= cap);
  }
  return all;
}

/**
 * Helper: how many rounds will a schedule have for the given mode + size?
 * Useful for showing a preview before generating.
 */
export function estimateRoundCount(_mode: "singles" | "doubles_americano", numPlayers: number): number {
  if (numPlayers < 2) return 0;
  // Berger always produces N-1 rounds (or N if padded with a bye, but the bye round
  // produces no real matches so we can still report N-1).
  const padded = numPlayers + (numPlayers % 2 === 1 ? 1 : 0);
  return padded - 1;
}
