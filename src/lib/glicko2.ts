/**
 * Glicko-2 rating system implementation.
 *
 * Reference: Mark E. Glickman (2012), "Example of the Glicko-2 system"
 * http://www.glicko.net/glicko/glicko2.pdf
 *
 * Standard scale: rating ~ 1500, RD ~ 350 (new player). The implementation
 * converts to/from the internal Glicko-2 scale (μ, φ) for the math.
 */

export interface Rating {
  rating: number; // standard scale, default 1500
  rd: number;     // rating deviation, default 350
  vol: number;    // volatility, default 0.06
}

export interface Outcome {
  opponent: Rating;
  /** 1 = win, 0.5 = draw, 0 = loss */
  score: number;
}

const SCALE = 173.7178;
const MEAN = 1500;
const TAU = 0.5;     // system constant — smaller = ratings change more slowly
const EPSILON = 1e-6;

export const DEFAULT_RATING: Rating = { rating: 1500, rd: 350, vol: 0.06 };

function toG2(r: Rating) {
  return {
    mu: (r.rating - MEAN) / SCALE,
    phi: r.rd / SCALE,
    sigma: r.vol,
  };
}

function fromG2(mu: number, phi: number, sigma: number): Rating {
  return {
    rating: SCALE * mu + MEAN,
    rd: SCALE * phi,
    vol: sigma,
  };
}

function g(phi: number) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function expected(mu: number, muJ: number, phiJ: number) {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

/**
 * Update a single player's rating based on a rating period of outcomes.
 *
 * If outcomes is empty, the player's rating stays the same but their RD
 * grows slightly (uncertainty increases over time without play).
 */
export function updateRating(player: Rating, outcomes: Outcome[]): Rating {
  const { mu, phi, sigma } = toG2(player);

  // No games this period → only RD inflates
  if (outcomes.length === 0) {
    const newPhi = Math.sqrt(phi * phi + sigma * sigma);
    return fromG2(mu, newPhi, sigma);
  }

  // Convert opponents and pre-compute g, E for each
  const items = outcomes.map((o) => {
    const { mu: muJ, phi: phiJ } = toG2(o.opponent);
    const gJ = g(phiJ);
    const e = expected(mu, muJ, phiJ);
    return { gJ, e, s: o.score };
  });

  // Step 3: estimated variance v
  let vInv = 0;
  for (const { gJ, e } of items) vInv += gJ * gJ * e * (1 - e);
  const v = 1 / vInv;

  // Step 4: improvement Δ
  let deltaSum = 0;
  for (const { gJ, e, s } of items) deltaSum += gJ * (s - e);
  const delta = v * deltaSum;

  // Step 5: new volatility via Illinois algorithm
  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const ex = Math.exp(x);
    const numerator = ex * (delta * delta - phi * phi - v - ex);
    const denominator = 2 * Math.pow(phi * phi + v + ex, 2);
    return numerator / denominator - (x - a) / (TAU * TAU);
  };

  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }

  let fA = f(A);
  let fB = f(B);
  let safety = 0;
  while (Math.abs(B - A) > EPSILON && safety < 1000) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
    safety++;
  }

  const newSigma = Math.exp(A / 2);

  // Step 6: φ*
  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);

  // Step 7: φ'
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);

  // Step 8: μ'
  const newMu = mu + newPhi * newPhi * deltaSum;

  return fromG2(newMu, newPhi, newSigma);
}

/**
 * For doubles: compute a "team rating" from two players by averaging their
 * Glicko-2 fields. Used as a single opponent when updating a player's rating
 * in a doubles match.
 *
 * Note: this is a simplification. Full per-pair ratings are tracked separately
 * via updatePairRating.
 */
export function teamRating(a: Rating, b: Rating): Rating {
  return {
    rating: (a.rating + b.rating) / 2,
    rd: Math.sqrt((a.rd * a.rd + b.rd * b.rd) / 2),
    vol: (a.vol + b.vol) / 2,
  };
}
