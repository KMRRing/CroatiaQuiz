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
  ["bot_grok", "Grok", "\u{1F916}"],
  ["bot_chatgpt", "ChatGPT", "\u{1F7E2}"],
  ["bot_deepseek", "DeepSeek", "\u{1F433}"],
  ["bot_claude", "Claude", "\u{1F7E0}"],
  ["bot_mistral", "Mistral", "\u{1F32C}\uFE0F"],
  ["bot_gemini", "Gemini", "\u{264A}"],
];

const rnd = Math.random;
function randomAnswer(q) {
  if (q.type === "single") return String(Math.floor(rnd() * q.options.length));
  const picks = [];
  for (let i = 0; i < q.options.length; i++) if (rnd() < 0.5) picks.push(i);
  if (!picks.length) picks.push(Math.floor(rnd() * q.options.length));
  return picks.join("");
}
function randomWrong(q) {
  let a = randomAnswer(q);
  let guard = 0;
  while (a === q.correct && guard++ < 20) a = randomAnswer(q);
  return a;
}

// stake helpers -----------------------------------------------------
const kellyEvens = (c) => Math.max(0, 2 * c - 1);
const oddsKelly = (p, room) => Math.max(0, Math.min(0.9, p - ((1 - p) * room) / (1 - room)));

export function botRoster() {
  const bots = AI_META.map(([token, name, emoji]) => ({
    token, name, emoji, kind: "ai",
    decide(q, qi, wealth) {
      const e = AI_ANSWERS[token][qi];
      if (!e) return { answer: null, frac: 0, conf: null };
      return { answer: e.a, frac: kellyEvens(e.c), conf: e.c };
    },
  }));
  bots.push({
    token: "bot_edu", name: "Educated Monkey", emoji: "\u{1F9E0}\u{1F412}", kind: "monkey",
    p: 0.65,
    decide(q, qi, wealth) {
      const hit = rnd() < this.p;
      return {
        answer: hit ? q.correct : randomWrong(q),
        frac: oddsKelly(this.p, q.roomP),
        conf: this.p,
      };
    },
  });
  bots.push({
    token: "bot_gambler", name: "Gambler Monkey", emoji: "\u{1F3B0}\u{1F412}", kind: "monkey",
    decide(q, qi, wealth) {
      const bomb = q.roomP < 0.5; // all-in only where the room is worse than a coin
      return { answer: randomAnswer(q), frac: bomb ? 1 : 0, conf: null };
    },
  });
  return bots;
}

// Confidence lookup for the finale calibration board only (never shown mid-game).
export function botConf(token, qi) {
  if (token === "bot_edu") return 0.65;
  const e = AI_ANSWERS[token] && AI_ANSWERS[token][qi];
  return e ? e.c : null;
}
