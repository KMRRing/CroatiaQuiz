// Executes potScene in isolation against real-game shapes: catches runtime faults
// (TDZ, undefined refs) that `node --check` cannot see. Run: node tools_potsmoke.mjs
import { readFileSync } from "fs";
import { RULES } from "./js/config.js";
import { N_ROUNDS } from "./js/questions.js";
import { fmt } from "./js/engine.js";

const src = readFileSync("./js/views/screen.js", "utf8");
const a = src.indexOf("  function potScene(");
const b = src.indexOf("  // Shared option rows");
if (a < 0 || b < 0) { console.error("potSmoke: could not locate potScene"); process.exit(1); }

const stub = `
  const svgIcon = (t, x, y, size, delay) => \`<text data-t="\${t}" data-size="\${size}"/>\`;
  ${src.slice(a, b)}
  return potScene;`;
const potScene = new Function("RULES", "N_ROUNDS", "fmt", stub)(RULES, N_ROUNDS, fmt);

const q = { options: ["A", "B"], correct: "0" };
const cases = {
  "game reveal (winners + losers)": { stakes: { p1: 40, p2: 10, p3: 30 }, botStakes: { bot_claude: 20 },
    aiAnswers: { bot_claude: "0" }, deltas: { p1: 56, p2: -10, p3: -30 }, pot: 120, mult: 2.4, rolled: false, correct: "0" },
  "lone winner": { stakes: { p1: 10, p2: 10 }, botStakes: {}, deltas: { p1: 30, p2: -10 }, pot: 40, mult: 4, rolled: false, correct: "0" },
  "lone loser": { stakes: { p1: 10, p2: 10 }, botStakes: {}, deltas: { p1: 10, p2: -10 }, pot: 30, mult: 1.5, rolled: false, correct: "0" },
  "rolled (no winners)": { stakes: { p1: 10, p2: 20 }, botStakes: {}, deltas: { p1: -10, p2: -20 }, pot: 130, mult: 1, rolled: true, correct: "0" },
  "bots only": { stakes: {}, botStakes: { bot_claude: 10, bot_grok: 10 }, aiAnswers: { bot_claude: "0", bot_grok: "1" },
    deltas: {}, pot: 120, mult: 2, rolled: false, correct: "0" },
  "tutorial skin (overrides)": { stakes: { t_fox: 40, t_oct: 10 }, botStakes: {}, deltas: { t_fox: 120, t_oct: 30 },
    pot: 200, mult: 4, rolled: false, correct: "0", yTop: 26, yBot: 26, fs: 23, icon: 42, potFs: 1.25,
    labels: { t_fox: "$40 on B" }, green: ["t_fox"] },
};

let fail = 0;
for (const [name, rv] of Object.entries(cases)) {
  for (const [mode, args] of [["wall", [1200, 560, false, 3]], ["compact", [760, 300, true, 9]]]) {
    try {
      const out = potScene(rv, q, ...args);
      if (!out.includes("<svg") || !out.includes(fmt(rv.pot))) throw new Error("output missing svg or pot total");
      if (/undefined|NaN/.test(out)) throw new Error("output contains undefined/NaN");
    } catch (e) { fail++; console.error(`potSmoke FAIL [${name} / ${mode}]: ${e.message}`); }
  }
}
console.log(fail ? `potSmoke: ${fail} failure(s)` : "potSmoke: all checks green");
process.exit(fail ? 1 : 0);
