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

// Claude: half-Kelly against an estimated parimutuel multiple, solved as a fixed
// point because its own stake dilutes that multiple, with an endgame overlay in
// the last two rounds (protect a lead, or stake to overtake).
export function claudeStake(input) {
  const HOUSE = RULES.bonus, MIN = RULES.minStake, STIPEND = RULES.stipend;
  const { players: N, round: r, history = [], carry = 0, leader = 0 } = input;
  const B = input.balance;
  let c = input.c;
  if (!(B > MIN) || !(N > 0)) return clamp(MIN, B);

  // average stake ratio: mean stake / stipend, default 1.5 before any history
  const ratios = history.map((h) => (h.pot - HOUSE - (h.carry || 0)) / (STIPEND * N));
  const s = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 1.5;

  // calibration haircut once six rounds are in the book
  if (history.length >= 6) {
    const acc = history.filter((h) => h.myCorrect).length / history.length;
    const meanConf = history.reduce((a, h) => a + (h.myConf || 0), 0) / history.length;
    if (acc < meanConf - 0.15) c = 0.85 * c;
  }

  const q = 0.20 + 0.50 * c;                      // crowd accuracy proxy
  const othersPool = STIPEND * N * Math.max(1, s);
  const correctPool = q * othersPool;
  const multiple = (stake) => Math.max(1.05, (othersPool + HOUSE + carry + stake) / (correctPool + stake));

  let stake = MIN;
  for (let i = 0; i < 25; i++) {
    const m = multiple(stake);
    const fStar = (c * m - 1) / (m - 1);
    const f = fStar <= 0 ? 0 : Math.min(0.5 * fStar, 0.5);
    stake = Math.round(f * B);
  }
  const mFinal = multiple(stake);

  if (r <= 18) return clamp(stake, B);
  if (B >= leader) return clamp(Math.min(stake, 0.25 * B), B);   // protect the lead
  if (c >= 0.5) {
    const needed = Math.ceil((leader - B + STIPEND) / Math.max(0.05, mFinal - 1));
    return clamp(Math.max(stake, needed), B);
  }
  return clamp(MIN, B);
}

// DeepSeek: confidence measured against the crowd's observed accuracy, ramped by
// round index. Note it reads the ROOM's accuracy, not its own, so a room doing
// badly widens its perceived edge rather than narrowing it.
export function deepseekStake(input) {
  const { c, balance: B, players: N, round = 1, history = [] } = input;
  const p = history.length
    ? history.reduce((a, h) => a + (h.correct || 0) / Math.max(1, N), 0) / history.length
    : 0.5;
  let f = Math.max(0.10, Math.min(1.00, 0.20 + 1.50 * (c - p) + 0.02 * round));
  if (c < 0.55) f = 0.10;
  return clamp(RULES.minStake + f * (B - RULES.minStake), B);
}

// Grok: quadratic in confidence, ramped down as rounds run out, and cut hard when
// the previous round showed the room doing well.
export function grokStake(input) {
  const { c, balance: B, players: N, round = 1, history = [] } = input;
  const last = history.length ? history[history.length - 1] : null;
  const share = last ? (last.correct || 0) / Math.max(1, N) : 0.5;
  const crowd = share < 0.35 ? 1 : share < 0.55 ? 0.7 : 0.45;
  return clamp(B * 0.12 * c * c * (1 + 0.03 * (20 - round)) * crowd, B);
}

// Gemini: a flat fraction of stack equal to confidence, eased only slightly as the
// game runs down. At typical confidences this stakes most of the stack every round.
export function geminiStake(input) {
  const { c, balance: B, round = 1 } = input;
  const remaining = Math.max(0, 20 - round);
  return clamp(Math.floor(B * c * (0.8 + 0.2 * (remaining / 20))), B);
}

// Mistral: confidence times stack, ramping UP as the game runs on, so the last
// rounds are effectively all-in at any decent confidence.
export function mistralStake(input) {
  const { c, balance: B, round = 1 } = input;
  return clamp(B * c * (0.8 + 0.02 * (round - 1)), B);
}

export const SIZING = {
  bot_claude: claudeStake,
  bot_deepseek: deepseekStake,
  bot_grok: grokStake,
  bot_gemini: geminiStake,
  bot_mistral: mistralStake,
};
