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
  bot_grok: [
    { a: "C", c: 0.95 }, { a: "C", c: 0.88 }, { a: "A", c: 0.82 }, { a: "B", c: 0.97 },
    { a: "AE", c: 0.92 }, { a: "B", c: 0.85 }, { a: "D", c: 0.75 }, { a: "A", c: 0.90 },
    { a: "CD", c: 0.70 }, { a: "A", c: 0.80 }, { a: "B", c: 0.78 }, { a: "C", c: 0.72 },
    { a: "B", c: 0.65 }, { a: "BD", c: 0.68 }, { a: "B", c: 0.80 }, { a: "ABC", c: 0.70 },
    { a: "C", c: 0.75 }, { a: "E", c: 0.78 }, { a: "ACD", c: 0.65 }, { a: "E", c: 0.70 },
  ],
  bot_chatgpt: [
    { a: "C", c: 0.90 }, { a: "C", c: 0.95 }, { a: "A", c: 0.90 }, { a: "B", c: 0.95 },
    { a: "AE", c: 0.90 }, { a: "B", c: 0.85 }, { a: "D", c: 0.95 }, { a: "A", c: 0.90 },
    { a: "BCD", c: 0.75 }, { a: "A", c: 0.95 }, { a: "A", c: 0.80 }, { a: "A", c: 0.75 },
    { a: "B", c: 0.70 }, { a: "C", c: 0.90 }, { a: "B", c: 0.80 }, { a: "AD", c: 0.85 },
    { a: "C", c: 0.60 }, { a: "E", c: 0.70 }, { a: "ABC", c: 0.80 }, { a: "BE", c: 0.90 },
  ],
  bot_deepseek: [
    { a: "C", c: 0.99 }, { a: "C", c: 0.99 }, { a: "A", c: 0.94 }, { a: "A", c: 0.99 },
    { a: "AD", c: 0.99 }, { a: "B", c: 0.99 }, { a: "C", c: 0.90 }, { a: "A", c: 0.98 },
    { a: "ACD", c: 0.84 }, { a: "B", c: 0.92 }, { a: "A", c: 0.88 }, { a: "C", c: 0.90 },
    { a: "A", c: 0.68 }, { a: "AD", c: 0.86 }, { a: "B", c: 0.84 }, { a: "ABCD", c: 0.90 },
    { a: "C", c: 0.90 }, { a: "E", c: 0.98 }, { a: "ABCD", c: 0.76 }, { a: "E", c: 0.92 },
  ],
  bot_claude: [
    { a: "C", c: 0.96 }, { a: "C", c: 0.95 }, { a: "A", c: 0.8 },  { a: "B", c: 0.9 },
    { a: "AE", c: 0.9 }, { a: "B", c: 0.85 }, { a: "D", c: 0.7 },  { a: "A", c: 0.85 },
    { a: "CD", c: 0.75 }, { a: "A", c: 0.85 }, { a: "B", c: 0.75 }, { a: "B", c: 0.45 },
    { a: "A", c: 0.6 },  { a: "A", c: 0.55 }, { a: "B", c: 0.65 }, { a: "BCE", c: 0.35 },
    { a: "C", c: 0.8 },  { a: "E", c: 0.85 }, { a: "BCD", c: 0.3 }, { a: "E", c: 0.6 },
  ],
  bot_mistral: [
    { a: "C", c: 0.95 }, { a: "C", c: 0.95 }, { a: "A", c: 0.85 }, { a: "B", c: 0.95 },
    { a: "AE", c: 0.9 }, { a: "B", c: 0.9 },  { a: "D", c: 0.85 }, { a: "A", c: 0.95 },
    { a: "CD", c: 0.85 }, { a: "A", c: 0.8 }, { a: "A", c: 0.85 }, { a: "B", c: 0.85 },
    { a: "A", c: 0.75 }, { a: "AC", c: 0.9 }, { a: "B", c: 0.85 }, { a: "BCDE", c: 0.8 },
    { a: "C", c: 0.75 }, { a: "E", c: 0.8 }, { a: "C", c: 0.7 },  { a: "E", c: 0.8 },
  ],
  bot_gemini: [
    { a: "C", c: 0.95 }, { a: "C", c: 0.95 }, { a: "B", c: 0.85 }, { a: "C", c: 0.9 },
    { a: "ACF", c: 0.7 }, { a: "A", c: 0.8 }, { a: "C", c: 0.75 }, { a: "B", c: 0.8 },
    { a: "ABC", c: 0.75 }, { a: "C", c: 0.8 }, { a: "B", c: 0.85 }, { a: "C", c: 0.8 },
    { a: "B", c: 0.85 }, { a: "ABD", c: 0.7 }, { a: "A", c: 0.85 }, { a: "ABCD", c: 0.75 },
    { a: "C", c: 0.8 }, { a: "E", c: 0.8 }, { a: "ACD", c: 0.75 }, { a: "C", c: 0.8 },
  ],
  bot_qwen: [
    { a: "C", c: 0.95 }, { a: "D", c: 0.93 }, { a: "A", c: 0.63 }, { a: "D", c: 0.59 },
    { a: "BD", c: 0.69 }, { a: "A", c: 0.79 }, { a: "D", c: 0.86 }, { a: "A", c: 0.74 },
    { a: "ABCD", c: 0.64 }, { a: "B", c: 0.82 }, { a: "B", c: 0.71 }, { a: "D", c: 0.59 },
    { a: "A", c: 0.77 }, { a: "BC", c: 0.62 }, { a: "B", c: 0.56 }, { a: "ABCD", c: 0.64 },
    { a: "C", c: 0.79 }, { a: "E", c: 0.64 }, { a: "BCD", c: 0.70 }, { a: "C", c: 0.81 },
  ],
};

const AI_META = [
  ["bot_grok", "Grok", "\u{1F916}", "assets/bots/grok.png", "Grok 4.5"],
  ["bot_chatgpt", "ChatGPT", "\u{1F7E2}", "assets/bots/chatgpt.png", "GPT-5.6 Luna"],
  ["bot_deepseek", "DeepSeek", "\u{1F433}", "assets/bots/deepseek.png", "DeepSeek-V3"],
  ["bot_claude", "Claude", "\u{1F7E0}", "assets/bots/claude.png", "Fable 5.1 Max"],
  ["bot_mistral", "Mistral", "\u{1F32C}\uFE0F", "assets/bots/mistral.png", "Medium 3.5"],
  ["bot_gemini", "Gemini", "\u{264A}", "assets/bots/gemini.png", "3.6 Flash Extended"],
  ["bot_qwen", "Qwen", "\u{1F537}", "assets/bots/qwen.png", "Qwen3.7 Deep-Research-Mini"],
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
