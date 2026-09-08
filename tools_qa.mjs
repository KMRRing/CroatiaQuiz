import { settle, clampStake } from "./js/engine.js";
import { wealthSeries, sizingReport } from "./js/finale.js";
import { RULES } from "./js/config.js";
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error("FAIL:", msg); } };
const rnd = (() => { let s = 42; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; })();
function runGame() {
  const nP = 26, late = 12, wipe = 3;
  const toks = Array.from({ length: nP }, (_, i) => "t" + i);
  const wealth = {};
  toks.forEach((t, i) => { if (i < nP - 1) wealth[t] = RULES.start; });
  let rollover = 0;
  const reveals = [];
  for (let n = 0; n < 25; n++) {
    if (n === late) wealth[toks[nP - 1]] = RULES.start;
    for (const t of Object.keys(wealth)) wealth[t] += RULES.stipend;
    const totBefore = Object.values(wealth).reduce((a, b) => a + b, 0) + rollover;
    const correct = "0";
    const entries = {};
    Object.keys(wealth).forEach((t, i) => {
      const wipeRound = n === wipe && i === 0;
      const right = n === 7 ? true : rnd() < 0.45;
      const pct = wipeRound ? 100 : Math.floor(rnd() * 20) * 5;
      const stake = clampStake(pct, wealth[t], RULES.minStake);
      let answer = right ? correct : "1";
      if (wipeRound) answer = "1";
      if (n === 9) answer = "1";
      if (n === 5 && i % 4 !== 0) answer = null;
      entries[t] = { answer, stake };
    });
    const res = settle({ entries, bonus: RULES.bonus, rollover, correct });
    const sumD = Object.values(res.deltas).reduce((a, b) => a + b, 0);
    ok(Math.abs(sumD - (RULES.bonus + rollover - res.newRollover)) < 1e-6, `delta ledger r${n}`);
    for (const [t, d] of Object.entries(res.deltas)) { wealth[t] += d; ok(wealth[t] > -1e-9, `negative wealth ${t} r${n}`); }
    if (res.rolled) {
      ok(res.newRollover === res.pot, `rollover carries pot r${n}`);
      Object.entries(entries).forEach(([t, e]) => ok(Math.abs(res.deltas[t] + e.stake) < 1e-9, `rolled deltas are pure losses r${n}`));
    }
    if (n === 7) ok(res.mult >= 1, "all-right round pays at least evens");
    if (n === wipe) ok(wealth[toks[0]] < 1e-9, "all-in wrong wipes to zero");
    rollover = res.newRollover;
    const totAfter = Object.values(wealth).reduce((a, b) => a + b, 0) + rollover;
    ok(Math.abs(totAfter - (totBefore + RULES.bonus)) < 1e-6, `money conservation r${n}`);
    const answers = {}; Object.entries(entries).forEach(([t, e]) => { answers[t] = e.answer == null ? "" : e.answer; });
    reveals.push({ correct, stakes: Object.fromEntries(Object.entries(entries).map(([t, e]) => [t, e.stake])), deltas: res.deltas, wealthAfter: { ...wealth }, mult: res.mult, rolled: res.rolled, pot: res.pot, answers });
  }
  return { reveals, toks };
}
const { reveals, toks } = runGame();
ok(reveals.length === 25, "25 rounds simulated");
const series = wealthSeries(reveals, toks.slice(0, 5));
ok(series[toks[0]].length === 26, "wealth series spans start plus every round");
const rep = sizingReport(reveals, toks.slice(0, 25));
ok(rep.rows.length > 0, "sizing rows produced");
ok(rep.rows.every((r) => r.fAvg >= 0 && r.fAvg <= 1.0001 && r.pHat >= 0 && r.pHat <= 1), "sizing bounds sane");
const rv2 = []; let w = 500, wPoor = RULES.minStake;
for (let n = 0; n < 6; n++) {
  const poorStake = Math.min(RULES.minStake, wPoor);
  rv2.push({ correct: "0", stakes: { rich: RULES.minStake, poor: poorStake }, deltas: { rich: -RULES.minStake, poor: -poorStake },
    wealthAfter: { rich: (w -= RULES.minStake), poor: (wPoor = wPoor - poorStake + RULES.stipend) }, mult: 2, rolled: false, pot: 50, answers: { rich: "1", poor: "1" } });
}
const rep2 = sizingReport(rv2, ["rich", "poor"]);
const rich = rep2.rows.find((r) => r.token === "rich"), poor = rep2.rows.find((r) => r.token === "poor");
ok(rich && rich.fAvg === 0, "floor bet with a stack counts as zero edge");
ok(poor && poor.fAvg === 0, "floor-equals-stack rounds excluded from the average");
console.log(fails ? `QA: ${fails} failures` : "QA: all checks green");
process.exitCode = fails ? 1 : 0;
