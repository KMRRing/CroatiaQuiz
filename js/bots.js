import { QUESTIONS } from "./questions.js";

// ------------------------------------------------------------------
// AI COMPETITORS.
// Fill each AI's `answers` from your pre-computed run: one entry per
// question, { a: "<sorted option indices>", c: <confidence 0..1> }.
// Example: { a: "1", c: 0.9 }  or for select-all  { a: "01234", c: 0.55 }.
// null = the AI abstains that round (minimum stake, no answer).
// Stakes are computed at settlement and never written to the database,
// so players see WHAT the AIs answered but never how much they bet.
// Sizing rule for AIs: stake fraction = max(0, 2c - 1) of stack.
// ------------------------------------------------------------------
const AI_ANSWERS = {
  bot_grok:    Array(QUESTIONS.length).fill(null),
  bot_chatgpt: Array(QUESTIONS.length).fill(null),
  bot_deepseek:Array(QUESTIONS.length).fill(null),
  bot_claude:  Array(QUESTIONS.length).fill(null),
  bot_mistral: Array(QUESTIONS.length).fill(null),
  bot_gemini:  Array(QUESTIONS.length).fill(null),
};

const AI_META = [
  ["bot_grok", "Grok", "\u{1F916}", "assets/bots/grok.png"],
  ["bot_chatgpt", "ChatGPT", "\u{1F7E2}", "assets/bots/chatgpt.png"],
  ["bot_deepseek", "DeepSeek", "\u{1F433}", "assets/bots/deepseek.png"],
  ["bot_claude", "Claude", "\u{1F7E0}", "assets/bots/claude.png"],
  ["bot_mistral", "Mistral", "\u{1F32C}\uFE0F", "assets/bots/mistral.png"],
  ["bot_gemini", "Gemini", "\u{264A}", "assets/bots/gemini.png"],
];

// stake helpers -----------------------------------------------------
const kellyEvens = (c) => Math.max(0, 2 * c - 1);

export function botRoster() {
  const bots = AI_META.map(([token, name, emoji, img]) => ({
    token, name, emoji, img, kind: "ai",
    decide(q, qi, wealth) {
      const e = AI_ANSWERS[token][qi];
      if (!e) return { answer: null, frac: 0, conf: null };
      return { answer: e.a, frac: kellyEvens(e.c), conf: e.c };
    },
  }));
  return bots;
}

// Confidence lookup for the finale calibration board only (never shown mid-game).
export function botConf(token, qi) {
  const e = AI_ANSWERS[token] && AI_ANSWERS[token][qi];
  return e ? e.c : null;
}
