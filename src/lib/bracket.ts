/**
 * Single-elimination bracket generator.
 *
 * Given an ordered list of qualifiers (1st, 2nd, 3rd, … from RR standings)
 * and a bracket size (2/4/8/16), produce a flat list of bracket matches with
 * stage / knockout_round labels and seed-based pairings.
 *
 * Standard tennis-style seeding: top seed never meets second seed before the
 * final, top quarter never meets second quarter before semis, etc.
 *
 * Non-power-of-2 advancers (e.g. 6, 10) are padded to the next power of 2 with
 * "byes". Top seeds get the byes — their R1 match is auto-completed and they
 * advance to the next round directly.
 */

export type KnockoutRound = "r16" | "qf" | "sf" | "f" | "bronze";

export interface BracketMatchSpec {
  knockout_round: KnockoutRound;
  /** 1-based position within its round (qf1, qf2, qf3, qf4, sf1, sf2, …) */
  position: number;
  /** Seed of the player on side A, or null if TBD */
  side_a_seed: number | null;
  /** Seed of the player on side B, or null if TBD */
  side_b_seed: number | null;
  /** Bye flag — A or B is a phantom bye and the other side auto-advances */
  bye_a?: boolean;
  bye_b?: boolean;
  /** When advancing, which previous-round positions feed into this match */
  feeds_from?: { a?: number; b?: number };
}

/**
 * Recursive seed-position generator. Produces the standard bracket order
 * for n positions, e.g. n=8 → [1, 8, 5, 4, 3, 6, 7, 2].
 *
 * Why this works: in a properly seeded bracket the i-th and (n+1-i)-th seeds
 * are placed in opposite halves so they only meet in the final.
 */
function seedOrder(n: number): number[] {
  if (n === 1) return [1];
  const half = seedOrder(n / 2);
  const out: number[] = [];
  for (const s of half) {
    out.push(s);
    out.push(n + 1 - s);
  }
  return out;
}

function roundLabelForSize(size: number): KnockoutRound {
  if (size === 16) return "r16";
  if (size === 8) return "qf";
  if (size === 4) return "sf";
  return "f";
}

/**
 * Generate the bracket given the number of qualifying seeds and whether to
 * include a bronze (3rd-place) match.
 */
export function generateBracket(
  numAdvancing: number,
  includeBronze: boolean
): BracketMatchSpec[] {
  if (numAdvancing < 2) return [];

  // Round up to next power of 2 (cap at 16 for v1)
  const sizes = [2, 4, 8, 16];
  const bracketSize = sizes.find((s) => s >= numAdvancing) ?? 16;

  const order = seedOrder(bracketSize);
  // order is e.g. [1,8,4,5,2,7,3,6] — pairs are (order[0], order[1]), (order[2], order[3]), …

  const matches: BracketMatchSpec[] = [];

  // Round 1
  const r1 = roundLabelForSize(bracketSize);
  for (let i = 0; i < bracketSize; i += 2) {
    const aSeed = order[i];
    const bSeed = order[i + 1];
    const byeA = aSeed > numAdvancing;
    const byeB = bSeed > numAdvancing;
    matches.push({
      knockout_round: r1,
      position: i / 2 + 1,
      side_a_seed: byeA ? null : aSeed,
      side_b_seed: byeB ? null : bSeed,
      bye_a: byeA,
      bye_b: byeB,
    });
  }

  // Subsequent rounds — empty pairings, just structure
  let prevSize = bracketSize;
  let prevLabel = r1;
  while (prevSize > 2) {
    const nextSize = prevSize / 2;
    const nextLabel = roundLabelForSize(nextSize);
    const numNext = nextSize / 2;
    for (let i = 0; i < numNext; i++) {
      matches.push({
        knockout_round: nextLabel,
        position: i + 1,
        side_a_seed: null,
        side_b_seed: null,
        feeds_from: { a: i * 2 + 1, b: i * 2 + 2 },
      });
    }
    prevSize = nextSize;
    prevLabel = nextLabel;
  }

  // Bronze (loser of SF1 vs loser of SF2)
  if (includeBronze && bracketSize >= 4) {
    matches.push({
      knockout_round: "bronze",
      position: 1,
      side_a_seed: null,
      side_b_seed: null,
      feeds_from: { a: 1, b: 2 },
    });
  }

  void prevLabel;
  return matches;
}

/**
 * Compute the next round label given the current one (for advancing winners).
 */
export function nextRound(r: KnockoutRound): KnockoutRound | null {
  switch (r) {
    case "r16":
      return "qf";
    case "qf":
      return "sf";
    case "sf":
      return "f";
    case "f":
    case "bronze":
      return null;
  }
}

/**
 * Compute the previous-round positions that feed into (round, position).
 * E.g. SF1 fed by QF1 + QF2; SF2 fed by QF3 + QF4.
 */
export function feederPositions(position: number): { a: number; b: number } {
  return { a: position * 2 - 1, b: position * 2 };
}
