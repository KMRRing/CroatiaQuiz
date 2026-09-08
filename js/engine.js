// Pure parimutuel settlement. No Firebase in here, so it is unit-testable and replayable.
export function settle({ entries, bonus, rollover, correct }) {
  // entries: { token: { answer: string|null, stake: number } }
  let W = 0, L = 0;
  const right = {};
  for (const [t, e] of Object.entries(entries)) {
    right[t] = e.answer != null && e.answer === correct;
    if (right[t]) W += e.stake; else L += e.stake;
  }
  const pot = L + bonus + rollover;
  const mult = W > 0 ? (W + pot) / W : 0;
  const deltas = {};
  for (const [t, e] of Object.entries(entries)) {
    deltas[t] = -e.stake + (right[t] && W > 0 ? e.stake * mult : 0);
  }
  return { W, L, pot, mult, rolled: W === 0, newRollover: W > 0 ? 0 : pot, right, deltas };
}

export function clampStake(pct, wealth, minStake) {
  const raw = (pct / 100) * wealth;
  return Math.min(wealth, Math.max(Math.min(minStake, wealth), raw));
}

export const fmt = (x) => "$" + Math.round(x).toLocaleString("en-US");

export function board(wealth, players) {
  return Object.keys(wealth)
    .map((t) => ({ token: t, w: wealth[t], ...(players[t] || {}) }))
    .sort((a, b) => b.w - a.w);
}
