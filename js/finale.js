// Finale analytics. Pure functions over the stored reveals — no Firebase in here.
import { RULES } from "./config.js";

// Rebuild each player's wealth series from reveal[n].wealthAfter snapshots.
export function wealthSeries(reveals, tokens) {
  const series = {};
  for (const t of tokens) series[t] = [0];
  reveals.forEach((rv) => {
    for (const t of tokens) {
      const prev = series[t][series[t].length - 1];
      const w = rv && rv.wealthAfter && rv.wealthAfter[t] != null ? rv.wealthAfter[t] : prev;
      series[t].push(w);
    }
  });
  return series;
}

// Per-player realised accuracy and stake sizing vs the parimutuel Kelly fraction.
// Kelly at pool odds O:  f* = p - (1 - p) / (O - 1)
export function sizingReport(reveals, humanTokens) {
  const mults = reveals.filter((r) => r && !r.rolled && r.mult > 1.001).map((r) => r.mult);
  const Obar = mults.length ? mults.reduce((a, b) => a + b, 0) / mults.length : 1.5;
  const rows = [];
  for (const t of humanTokens) {
    let n = 0, right = 0, fSum = 0, fN = 0;
    reveals.forEach((rv) => {
      if (!rv || !rv.deltas || rv.deltas[t] == null) return;
      const d = rv.deltas[t], s = rv.stakes ? rv.stakes[t] : null;
      n++; if (d > 0) right++;
      if (s != null) {
        const wAtBet = (rv.wealthAfter && rv.wealthAfter[t] != null ? rv.wealthAfter[t] : 0) - d;
        if (wAtBet > 0) { fSum += s / wAtBet; fN++; }
      }
    });
    if (!n) continue;
    const pHat = right / n;
    const fStar = Math.max(0, pHat - (1 - pHat) / (Obar - 1));
    const fAvg = fN ? fSum / fN : 0;
    rows.push({ token: t, pHat, fAvg, fStar, ratio: fStar > 0.01 ? fAvg / fStar : null });
  }
  rows.sort((a, b) => b.pHat - a.pHat);
  return { Obar, rows };
}

// Accuracy a perfectly-sized (Kelly) outsider needed to end above `target`,
// replaying this game's realised multiples. Expected-wealth recursion + bisection.
export function requiredAccuracy(reveals, target) {
  const rounds = reveals.map((r) => (r && !r.rolled && r.mult > 1.001 ? r.mult : null));
  const finalW = (p) => {
    let w = 0;
    for (const O of rounds) {
      w += RULES.stipend;
      if (O == null) continue;
      const f = Math.max(0, p - (1 - p) / (O - 1));
      w = w * (1 + f * (p * O - 1));
    }
    return w;
  };
  if (finalW(0.99) < target) return null; // not reachable even at 99%
  let lo = 0.01, hi = 0.99;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    (finalW(mid) >= target ? (hi = mid) : (lo = mid));
  }
  return hi;
}

// Minimal SVG line chart. series: {token: [w0..wN]}, style: {token:{color,width,dash,label}}
export function svgWealthChart(series, style, width, height) {
  const tokens = Object.keys(series);
  if (!tokens.length) return "<svg></svg>";
  const N = series[tokens[0]].length - 1;
  let maxW = 10;
  tokens.forEach((t) => series[t].forEach((w) => { if (w > maxW) maxW = w; }));
  const padL = 46, padB = 26, padT = 12, padR = 8;
  const X = (i) => padL + (i / N) * (width - padL - padR);
  const Y = (w) => padT + (1 - w / maxW) * (height - padT - padB);
  let g = `<line x1="${padL}" y1="${Y(0)}" x2="${width - padR}" y2="${Y(0)}" stroke="#E3E6EF"/>`;
  for (const gv of [0.25, 0.5, 0.75, 1]) {
    const v = Math.round(maxW * gv);
    g += `<line x1="${padL}" y1="${Y(v)}" x2="${width - padR}" y2="${Y(v)}" stroke="#F0F2F8"/>` +
         `<text x="${padL - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="#5A6070">$${v}</text>`;
  }
  g += `<text x="${width - padR}" y="${height - 6}" text-anchor="end" font-size="11" fill="#5A6070">round ${N}</text>`;
  const sorted = tokens.slice().sort((a, b) => ((style[a] && style[a].width) || 1) - ((style[b] && style[b].width) || 1));
  for (const t of sorted) {
    const st = style[t] || {};
    const pts = series[t].map((w, i) => `${X(i).toFixed(1)},${Y(w).toFixed(1)}`).join(" ");
    g += `<polyline points="${pts}" fill="none" stroke="${st.color || "#D7DBE6"}" stroke-width="${st.width || 1.2}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ""}/>`;
    if (st.label) {
      const last = series[t][N];
      g += `<text x="${X(N) - 4}" y="${Y(last) - 5}" text-anchor="end" font-size="12" font-weight="700" fill="${st.color}">${st.label}</text>`;
    }
  }
  return `<svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto">${g}</svg>`;
}

export const AI_COLORS = ["#0000FF", "#8200DE", "#FF6432", "#0CA6FF", "#0A0ABA", "#C79A00"];
export const KELLY_FORMULA_HTML = `
  <div class="formula">f\u2009* = p \u2212 (1 \u2212 p) / (O \u2212 1)</div>
  <p class="dim">The growth-optimal stake, as a fraction of your stack: p is your probability of being right,
  O the pool's gross payout multiple. Bet your edge over the room \u2014 when the crowd's money is as accurate
  as you are, p\u00b7O \u2248 1 and the right stake is zero.</p>`;
