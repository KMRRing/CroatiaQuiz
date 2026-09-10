// Validates the AI entries and exercises every sizing rule. Run: node tools_bots.mjs
import { QUESTIONS } from "./js/questions.js";
import { RULES } from "./js/config.js";
import { botRoster, botConf } from "./js/bots.js";
import { SIZING, defaultStake } from "./js/sizing.js";

let fail = 0;
const bad = (m) => { fail++; console.error("FAIL: " + m); };

// 1. answers parse to valid option indices for their question
for (const b of botRoster()) {
  let filled = 0;
  QUESTIONS.forEach((q, i) => {
    const d = b.decide(q, i, 100, { players: 32, round: i + 1, carry: 0, leader: 0, history: [] });
    if (d.answer == null) return;
    filled++;
    const idx = [...d.answer].map(Number);
    if (!idx.every((n) => n >= 0 && n < q.options.length)) bad(`${b.name} Q${q.id}: option out of range (${d.answer})`);
    if ([...idx].sort((x, y) => x - y).join("") !== d.answer) bad(`${b.name} Q${q.id}: indices unsorted`);
    if (q.type === "single" && idx.length > 1) bad(`${b.name} Q${q.id}: multiple answers on a single-choice question`);
    if (!(d.conf >= 0 && d.conf <= 1)) bad(`${b.name} Q${q.id}: confidence out of range`);
  });
  console.log(`${b.name.padEnd(9)} ${filled}/${QUESTIONS.length} answered  ${filled ? "" : "(placeholder)"}`);
}

// 2. every sizing rule returns a legal stake across a wide grid
const rules = { ...SIZING, __default: defaultStake };
for (const [name, rule] of Object.entries(rules)) {
  for (const balance of [10, 11, 20, 55, 300, 4000]) {
    for (const c of [0, 0.3, 0.5, 0.75, 0.96, 1]) {
      for (const round of [1, 7, 19, 20]) {
        for (const hist of [[], Array.from({ length: 8 }, (_, i) => ({ pot: 600 + i * 50, carry: 0, correct: 9, myConf: 0.8, myCorrect: i % 3 !== 0 }))]) {
          for (const leader of [0, 250, 9000]) {
            const s = rule({ c, balance, players: 32, round, leader, carry: round === 7 ? 700 : 0, history: hist });
            if (!Number.isFinite(s)) { bad(`${name}: non-finite stake (c=${c} B=${balance} r=${round})`); continue; }
            if (s > balance) bad(`${name}: stake ${s} exceeds balance ${balance}`);
            if (s < Math.min(RULES.minStake, balance)) bad(`${name}: stake ${s} under the floor (B=${balance})`);
            if (!Number.isInteger(s)) bad(`${name}: non-integer stake ${s}`);
          }
        }
      }
    }
  }
  console.log(`${name.padEnd(12)} sizing rule: legal across grid`);
}

// 3. what Claude actually stakes in a few situations
const show = (label, ctx) => console.log("  " + label.padEnd(34) + "$" + SIZING.bot_claude(ctx));
console.log("\nClaude stake examples (32 players):");
show("R1, c=0.96, B=$20", { c: 0.96, balance: 20, players: 32, round: 1, leader: 0, carry: 0, history: [] });
show("R5, c=0.85, B=$300", { c: 0.85, balance: 300, players: 32, round: 5, leader: 0, carry: 0, history: [] });
show("R5, c=0.35, B=$300", { c: 0.35, balance: 300, players: 32, round: 5, leader: 0, carry: 0, history: [] });
show("R5, c=0.85, B=$300, $900 carry", { c: 0.85, balance: 300, players: 32, round: 5, leader: 0, carry: 900, history: [] });
show("R20 leading, c=0.7, B=$280", { c: 0.7, balance: 280, players: 32, round: 20, leader: 200, carry: 0, history: [] });
show("R20 trailing, c=0.7, B=$200", { c: 0.7, balance: 200, players: 32, round: 20, leader: 280, carry: 0, history: [] });

console.log(fail ? `\ntools_bots: ${fail} failure(s)` : "\ntools_bots: all checks green");
process.exit(fail ? 1 : 0);
