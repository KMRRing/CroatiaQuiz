import { QUESTIONS } from "./questions.js";
import { SIZING, defaultStake } from "./sizing.js";

// ------------------------------------------------------------------
// AI COMPETITORS.
// Paste each model's run straight in: one entry per question, as the model
// gave it, { a: "<option letters>", c: <confidence 0..1> }.
// Example: { a: "C", c: 0.9 }  or for select-all  { a: "AE", c: 0.55 }.
// Letters are converted to option indices at load; order does not matter.
// null = the AI abstains that round (minimum stake, no answer).
// Stakes are computed at settlement and never written to the database,
// so players see WHAT the AIs answered but never how much they bet.
// Bet sizing is per model, in sizing.js; models without a rule use defaultStake.
// ------------------------------------------------------------------
const AI_ANSWERS = {
  bot_claude: [
    { a: "C", c: 0.96 }, { a: "C", c: 0.95 }, { a: "D", c: 0.92 }, { a: "B", c: 0.9 },
    { a: "B", c: 0.9 },  { a: "C", c: 0.5 },  { a: "B", c: 0.85 }, { a: "C", c: 0.88 },
    { a: "C", c: 0.78 }, { a: "A", c: 0.85 }, { a: "B", c: 0.7 },  { a: "AC", c: 0.3 },
    { a: "A", c: 0.88 }, { a: "C", c: 0.82 }, { a: "A", c: 0.8 },  { a: "D", c: 0.9 },
    { a: "B", c: 0.9 },  { a: "D", c: 0.75 }, { a: "A", c: 0.7 },  { a: "A", c: 0.62 },
  ],
  bot_gemini: Array(QUESTIONS.length).fill(null),
  bot_qwen: [
    { a: "C", c: 0.99 }, { a: "C", c: 0.99 }, { a: "D", c: 0.99 }, { a: "B", c: 0.99 },
    { a: "B", c: 0.95 }, { a: "C", c: 0.85 }, { a: "B", c: 0.95 }, { a: "C", c: 0.99 },
    { a: "B", c: 0.90 }, { a: "A", c: 0.99 }, { a: "B", c: 0.95 }, { a: "ABCD", c: 0.85 },
    { a: "A", c: 0.95 }, { a: "D", c: 0.85 }, { a: "A", c: 0.98 }, { a: "D", c: 0.98 },
    { a: "B", c: 0.99 }, { a: "C", c: 0.95 }, { a: "A", c: 0.95 }, { a: "A", c: 0.90 },
  ],
};

const AI_META = [
  ["bot_claude", "Claude", "\u{1F7E0}", "assets/bots/claude.png", "Fable 5.1 Max"],
  ["bot_gemini", "Gemini", "\u{264A}", "assets/bots/gemini.png", "3.6 Flash Extended"],
  ["bot_qwen", "Qwen", "\u{1F537}", "assets/bots/qwen.png", "Qwen 3.7"],
];

// stake helpers -----------------------------------------------------
const kellyEvens = (c) => Math.max(0, 2 * c - 1);

// "BCE" -> "124": option letters to sorted option indices.
const toIdx = (a) => [...String(a).toUpperCase()].map((ch) => ch.charCodeAt(0) - 65).sort((x, y) => x - y).join("");
const ANSWERS = Object.fromEntries(Object.entries(AI_ANSWERS)
  .map(([t, arr]) => [t, arr.map((e) => (e ? { a: toIdx(e.a), c: e.c } : null))]));

export function botRoster() {
  return AI_META.map(([token, name, emoji, img, version]) => ({
    token, name, emoji, img, version, kind: "ai",
    decide(q, qi, wealth, ctx) {
      const e = ANSWERS[token][qi];
      if (!e) return { answer: null, stake: null, conf: null };
      const rule = SIZING[token] || defaultStake;
      return { answer: e.a, stake: rule(Object.assign({}, ctx, { c: e.c, balance: wealth })), conf: e.c };
    },
  }));
}

// Confidence lookup for the finale calibration board only (never shown mid-game).
export function botConf(token, qi) {
  const e = ANSWERS[token] && ANSWERS[token][qi];
  return e ? e.c : null;
}
