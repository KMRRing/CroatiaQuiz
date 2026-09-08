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

// Fraction of the answers an outsider needed to KNOW (certain, Kelly-capped all-in on
// those; no bet on the rest) to end above `target`, replaying this game's multiples.
export function requiredKnowledge(reveals, target) {
  const rounds = reveals.map((r) => (r && !r.rolled && r.mult > 1.001 ? r.mult : null));
  const finalW = (k) => {
    let w = 0;
    for (const O of rounds) {
      w += RULES.stipend;
      if (O == null) continue;
      w = w * (k * (1 + 0.9 * (O - 1)) + (1 - k));
    }
    return w;
  };
  if (finalW(1) < target) return null;
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    (finalW(mid) >= target ? (hi = mid) : (lo = mid));
  }
  return hi;
}

// Minimal SVG line chart. series: {token: [w0..wN]}, style: {token:{color,width,dash,label}}
export function svgWealthChart(series, style, width, height, fscale = 1, icons = null, dark = false) {
  const gMajor = dark ? "rgba(255,255,255,.30)" : "#E3E6EF";
  const gMinor = dark ? "rgba(255,255,255,.16)" : "#F0F2F8";
  const txt = dark ? "rgba(255,255,255,.92)" : "#5A6070";
  const tokens = Object.keys(series);
  if (!tokens.length) return "<svg></svg>";
  const N = series[tokens[0]].length - 1;
  let maxW = 10;
  tokens.forEach((t) => series[t].forEach((w) => { if (w > maxW) maxW = w; }));
  const padL = Math.round(46 * (fscale > 1 ? fscale * 0.95 : 1)), padB = 26, padT = 12;
  let padR = icons ? 122 : 8;
  const Y = (w) => padT + (1 - w / maxW) * (height - padT - padB);
  const iconS = Math.round(19 * fscale);
  let placements = null;
  if (icons) {
    // beeswarm: every icon at its true final height; collisions shunt right, filling from the left
    const colStep = Math.round(iconS * 1.05);
    const ends = tokens
      .filter((t) => icons[t])
      .map((t) => ({ t, y: Y(series[t][N]) }))
      .sort((a, b) => a.y - b.y);
    const cols = [];
    placements = ends.map((e) => {
      let c = 0;
      while (cols[c] && cols[c].some((y) => Math.abs(y - e.y) < iconS * 0.95)) c++;
      (cols[c] = cols[c] || []).push(e.y);
      return { t: e.t, y: e.y, c };
    });
    const maxC = placements.length ? Math.max(...placements.map((p) => p.c)) : 0;
    const span = Math.min(maxC * colStep, 4 * iconS);
    placements.colStep = maxC ? span / maxC : 0;
    padR = 16 + span + iconS;
  }
  const X = (i) => padL + (i / N) * (width - padL - padR);
  let g = `<line x1="${padL}" y1="${Y(0)}" x2="${width - padR}" y2="${Y(0)}" stroke="${gMajor}"/>`;
  for (const gv of [0.25, 0.5, 0.75, 1]) {
    const v = Math.round(maxW * gv);
    g += `<line x1="${padL}" y1="${Y(v)}" x2="${width - padR}" y2="${Y(v)}" stroke="${gMinor}"/>` +
         `<text x="${padL - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="${Math.round(11 * fscale)}" fill="${txt}">$${v}</text>`;
  }
  g += `<text x="${width - padR}" y="${height - 6}" text-anchor="end" font-size="${Math.round(11 * fscale)}" fill="${txt}">round ${N}</text>`;
  const sorted = tokens.slice().sort((a, b) => ((style[a] && style[a].width) || 1) - ((style[b] && style[b].width) || 1));
  for (const t of sorted) {
    const st = style[t] || {};
    const pts = series[t].map((w, i) => `${X(i).toFixed(1)},${Y(w).toFixed(1)}`).join(" ");
    g += `<polyline points="${pts}" fill="none" stroke="${st.color || "#D7DBE6"}" stroke-width="${st.width || 1.2}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ""}/>`;
    if (st.label && !icons) {
      const last = series[t][N];
      g += `<text x="${X(N) - 4}" y="${Y(last) - 5}" text-anchor="end" font-size="${Math.round(12 * fscale)}" font-weight="700" fill="${st.color}">${st.label}</text>`;
    }
  }
  if (icons && placements) {
    const colStep = placements.colStep || 0;
    const x0 = width - padR + 12 + Math.round(iconS / 2);
    for (const p of placements) {
      const ic = icons[p.t], x = x0 + p.c * colStep;
      g += ic.img
        ? `<image href="${ic.img}" x="${(x - iconS / 2).toFixed(0)}" y="${(p.y - iconS / 2).toFixed(0)}" width="${iconS}" height="${iconS}"/>`
        : `<text x="${x.toFixed(0)}" y="${(p.y + iconS * 0.32).toFixed(0)}" text-anchor="middle" font-size="${Math.round(iconS * 0.9)}">${ic.emoji}</text>`;
    }
  }
  return `<svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto">${g}</svg>`;
}

export const AI_COLORS = ["#0000FF", "#8200DE", "#FF6432", "#0CA6FF", "#0A0ABA", "#C79A00"];
export const KELLY_FORMULA_HTML = `
  <div class="krow">
    <div>
      <div class="klabel">Kelly, fixed odds</div>
      <div class="formula">f\u2009* = p \u2212 (1 \u2212 p) / b</div>
      <p class="dim">p is your chance of being right. b is the net odds. Bet your edge over the price.</p>
    </div>
    <div>
      <div class="klabel">Kelly, in a parimutuel pool</div>
      <div class="formula">f\u2009* = p \u2212 (1 \u2212 p) / (O \u2212 1)</div>
      <p class="dim">Here O is set by the crowd: roughly 1 over the share of money on the right answer.
      Your own stake pushes it down. If the crowd is as accurate as you, the right stake is zero.</p>
    </div>
  </div>`;
