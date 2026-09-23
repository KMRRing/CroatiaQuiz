// Per-model bet sizing. Each AI competitor submitted its own deterministic rule;
// this is where those rules live. A model with no rule here falls back to
// defaultStake. Every rule is pure: same inputs -> same stake, no randomness.
//
// ctx passed to a rule:
//   c        stated confidence for this question, 0..1
//   balance  the model's balance AFTER this round's stipend
//   players  number of players including AIs
//   round    1-based round index
//   leader   highest balance among the OTHER players (0 if unknown)
//   carry    carry-in to THIS round from a previous no-winner round
//   history  [{ pot, carry, correct, myConf, myCorrect }] for completed rounds
import { RULES } from "./config.js";

const clamp = (stake, B) => Math.max(Math.min(RULES.minStake, B), Math.min(B, Math.round(stake)));

// Fallback: stake max(0, 2c - 1) of stack (Kelly at evens).
export function defaultStake({ c, balance }) {
  return clamp(Math.max(0, 2 * c - 1) * balance, balance);
}

// Gemini (growth brief): quarter-Kelly against a fixed room model. The room is
// 27 players each staking 1.5x the round stipend (the rule said $15 on a $10
// stipend) at 50% accuracy, the payout multiple is estimated at the minimum
// stake, and the Kelly fraction from that multiple is scaled by 0.25. The rule
// fixes the player count at 27 regardless of the room, as written.
// The model's own example stakes (10 / 32.15 / 112.40 / 42.10) do not reproduce
// from its rule; tools_bots asserts the rule's arithmetic instead.
export function geminiStake(input) {
  const { c, balance: B, carry = 0 } = input;
  const sOthers = 1.5 * RULES.stipend * 27, cOthers = sOthers * 0.5;
  const cc = Math.min(0.99, Math.max(0.05, c));
  const M = (RULES.minStake + sOthers + RULES.bonus + carry) / (RULES.minStake + cOthers);
  const f = Math.max(0, (cc * M - 1) / (M - 1));
  return clamp(0.25 * f * B, B);
}

// Qwen (growth brief): half-Kelly against a fixed room model - 70% of the others
// correct, each staking about what this model holds up to $100 - with no use of
// history and no self-dilution term. Conservative by construction.
export function qwenStake(input) {
  const { c, balance: B, players, carry = 0 } = input;
  const N = players || 27;
  const A = Math.max(RULES.minStake, Math.min(B, 100));
  const Cothers = (N - 1) * 0.7 * A;
  const P = N * A + RULES.bonus + carry;
  const b = P / Cothers - 1;
  const fstar = b > 0 ? Math.max(0, c - (1 - c) / b) : 0;
  return clamp(Math.round(B * 0.5 * fstar), B);
}

// Claude (growth brief): exact log-utility (Kelly) sizing on the parimutuel payoff, self-dilution included,
// with a room model learned from history: the others' stake rate (phi), the share of
// their stakes that were correct (kap), and a calibration of own certainty against
// own record. Solved by bisection on the derivative of the expected log. Submitted
// under the growth-rate brief; applied identically in every round.
export function logKellyStake(input) {
  const HOUSE = RULES.bonus, MIN = RULES.minStake;
  const { c, balance: B, players, round: r = 1, carry: X = 0, othersBal = 0, history = [] } = input;
  const N = Math.max(1, (players || 1) - 1);
  if (!(B > MIN)) return clamp(MIN, B);
  const n = history.length;
  const E = history.reduce((a, h) => a + (h.myConf || 0), 0);
  const H = history.filter((h) => h.myCorrect).length;
  const p = Math.min(0.90, Math.max(0.05, c - (E - H) / (n + 5)));
  const othersStake = (h) => h.pot - HOUSE - (h.carry || 0) - (h.myStake || 0);
  const rates = history.slice(-3).map((h) => (h.othersBal > 0 ? othersStake(h) / h.othersBal : null))
    .filter((v) => v != null && Number.isFinite(v));
  const phi = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0.75;
  const T = Math.max(MIN * N, phi * othersBal);
  let K = 0, m = 0;
  for (const h of history) {
    if (!h.myCorrect || !(h.mult > 0)) continue;
    const Tj = othersStake(h);
    if (Tj > 0) { K += (h.pot / h.mult - (h.myStake || 0)) / Tj; m++; }
  }
  const kap = Math.min(0.85, Math.max(0.15, (1.5 + K) / (3 + m)));
  const A = T + HOUSE + X, C = kap * T, W = A - C;
  if (p * A <= C) return clamp(MIN, B);
  const Fp = (s) => p * (W * C / ((C + s) * (C + s))) / (B + s * W / (C + s)) - (1 - p) / (B - s);
  if (Fp(MIN) <= 0) return clamp(MIN, B);
  let lo = MIN, hi = B;
  for (let i = 0; i < 48; i++) { const mid = (lo + hi) / 2; if (Fp(mid) > 0) lo = mid; else hi = mid; }
  return clamp(Math.floor(lo), B);
}

export const SIZING = {
  bot_claude: logKellyStake,
  bot_gemini: geminiStake,
  bot_qwen: qwenStake,
};
