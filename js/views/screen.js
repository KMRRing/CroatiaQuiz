import { gref, onValue, ensureAuth, serverNow, read } from "../fb.js";
import { QUESTIONS, N_ROUNDS } from "../questions.js";
import { RULES } from "../config.js";
import { CHARACTERS } from "../characters.js";
import { fmt, board } from "../engine.js";
import { botRoster } from "../bots.js";
import { wealthSeries, svgWealthChart, AI_COLORS, KELLY_FORMULA_HTML } from "../finale.js";

const BOTS = Object.fromEntries(botRoster().map((b) => [b.token, b]));

export async function mount(root) {
  await ensureAuth();
  const S = { state: null, players: {}, wealth: {}, betCount: 0, reveal: null, finale: null, timer: null, betsUnsub: null };

  onValue(gref("players"), (s) => { S.players = s.val() || {}; render(); });
  onValue(gref("wealth"), (s) => { S.wealth = s.val() || {}; if (S.state && S.state.phase === "question") renderBoard(S.wealth, null); });
  onValue(gref("state"), async (s) => {
    S.state = s.val(); S.reveal = null;
    if (S.state && S.state.phase === "reveal") {
      S.reveal = await read("reveal", S.state.round);
      S.prevReveal = S.state.round > 0 ? await read("reveal", S.state.round - 1) : null;
    }
    if (S.state && S.state.phase === "finished") { S.finale = await read("finale"); S.reveals = await read("reveal"); }
    watchBets(); render();
  });

  function watchBets() {
    if (S.betsUnsub) { S.betsUnsub(); S.betsUnsub = null; }
    if (S.state && S.state.phase === "question") {
      S.betsUnsub = onValue(gref("bets", S.state.round), (s) => {
        S.betCount = s.val() ? Object.keys(s.val()).length : 0;
        const el = root.querySelector("#locked"); if (el) el.textContent = lockLine();
      });
    }
  }

  const iconOf = (t) => {
    if (BOTS[t]) return BOTS[t].emoji;
    const p = S.players[t];
    return (p && CHARACTERS[p.ci] ? CHARACTERS[p.ci][0] : "\u{1F3AD}");
  };
  const plainName = (t) => {
    if (BOTS[t]) return BOTS[t].name;
    const p = S.players[t];
    return (p && CHARACTERS[p.ci] ? CHARACTERS[p.ci][1] : "?");
  };
  const iconHtml = (t) => BOTS[t] && BOTS[t].img
    ? `<img class="boticon" src="${BOTS[t].img}" alt="${BOTS[t].name}">`
    : `<span class="lbicon">${iconOf(t)}</span>`;
  const svgIcon = (t, x, y, size, delay) => BOTS[t] && BOTS[t].img
    ? `<image class="lbl" style="animation-delay:${delay}ms" href="${BOTS[t].img}" x="${(x - size / 2).toFixed(0)}" y="${(y - size / 2).toFixed(0)}" width="${size}" height="${size}"/>`
    : `<text class="lbl" style="animation-delay:${delay}ms" x="${x.toFixed(0)}" y="${(y + size * 0.32).toFixed(0)}" text-anchor="middle" font-size="${size * 0.92}">${iconOf(t)}</text>`;
  const nameOf = (t) => {
    if (BOTS[t]) return BOTS[t].emoji + " " + BOTS[t].name;
    const p = S.players[t];
    const c = p ? CHARACTERS[p.ci] || ["\u{1F3AD}", "?"] : ["\u{1F3AD}", "?"];
    return c[0] + " " + c[1];
  };
  const humanCount = () => Object.entries(S.players).filter(([, p]) => !p.bot).length;
  const lockLine = () => `${S.betCount} of ${humanCount()} locked in`;


  function potScene(rv, q, W = 1200, H = 560, compact = false, roundIdx = 0) {
    const prog = Math.min(1, (roundIdx + 1) / N_ROUNDS);
    const cx = W / 2, cy = H * 0.54, R = compact ? Math.round(46 + 52 * prog) : Math.round(96 + 44 * prog);
    // losers pay in on the left; winners draw their net winnings on the right
    const mkIn = [], mkOut = [];
    const all = [];
    for (const [t, st] of Object.entries(rv.stakes || {})) all.push({ t, v: st, bot: false });
    for (const [t, st] of Object.entries(rv.botStakes || {})) all.push({ t, v: st, bot: true });
    for (const e of all) {
      const right = e.bot ? (rv.aiAnswers && rv.aiAnswers[e.t] === rv.correct) : (rv.deltas && rv.deltas[e.t] > 0);
      if (right && !rv.rolled && rv.mult > 1) mkOut.push({ t: e.t, v: e.v * (rv.mult - 1), bot: e.bot });
      else mkIn.push(e);
    }
    mkIn.sort((a, b) => b.v - a.v);
    mkOut.sort((a, b) => b.v - a.v);
    const totalIn = rv.pot;
    let vm = Math.max(RULES.minStake + 1, mkOut[0] ? mkOut[0].v : 1);
    const MINW = compact ? 1.6 : 2, SPAN = compact ? 9 : 13;
    const wOf = (v) => (MINW + SPAN * Math.sqrt(Math.max(0, v - RULES.minStake) / Math.max(1, vm - RULES.minStake))).toFixed(1);
    const yTop = compact ? 66 : 90, yBot = H - (compact ? 16 : 50);
    const spread = (n, i) => yTop + (n <= 1 ? (yBot - yTop) / 2 : (i / (n - 1)) * (yBot - yTop));
    const fs = compact ? 13 : 19, hf = compact ? 21 : 40;
    let g = "";
    const bow = compact ? 16 : 24;
    const bowOff = (n, i) => bow * (1 - (n <= 1 ? 0 : Math.sin(Math.PI * (i / (n - 1)))));
    // top 3 losing stakes individually; the rest piled into one arrow per wrong answer chosen
    const top3 = mkIn.slice(0, 3);
    const rest = mkIn.slice(3);
    const groups = {};
    for (const e of rest) {
      const raw = e.bot ? (rv.aiAnswers ? rv.aiAnswers[e.t] : "") : (rv.answers ? rv.answers[e.t] : null);
      const key = raw == null ? "?" : (raw === "" ? "\u2205" : raw);
      (groups[key] = groups[key] || { key, v: 0, members: [] });
      groups[key].v += e.v; groups[key].members.push(e.t);
    }
    let gl = Object.values(groups).sort((x, y) => y.v - x.v);
    if (gl.length > 6) {
      const keep = gl.slice(0, 5), misc = gl.slice(5);
      keep.push({ key: "\u2026", v: misc.reduce((a2, g2) => a2 + g2.v, 0), members: misc.flatMap((g2) => g2.members) });
      gl = keep;
    }
    const inRows = top3.map((e) => ({ kind: "one", e })).concat(gl.map((grp) => ({ kind: "grp", grp })));
    const nIn = inRows.length;
    inRows.forEach((r) => { vm = Math.max(vm, r.kind === "one" ? r.e.v : r.grp.v); });
    inRows.forEach((row, i) => {
      const sy = spread(nIn, i);
      const ix = (compact ? 20 : 60) + bowOff(nIn, i);
      const ax = ix + (compact ? 16 : 36);
      const t2 = nIn <= 1 ? 0.5 : i / (nIn - 1);
      const ang = Math.PI * (210 - (30 + t2 * 60) * (nIn <= 1 ? 1 : 1)) / 180;
      const a2 = Math.PI * (210 - (nIn <= 1 ? 30 : t2 * 60)) / 180;
      const ex = cx + R * Math.cos(a2), ey = cy + R * Math.sin(a2);
      const v = row.kind === "one" ? row.e.v : row.grp.v;
      // final control point sits on the radial line, so the visible approach and the
      // auto-oriented head both point into the centre of the pot
      const dxr = cx - ex, dyr = cy - ey, dl = Math.hypot(dxr, dyr) || 1;
      const L2 = compact ? 46 : 92;
      const c2x = ex - (dxr / dl) * L2, c2y = ey - (dyr / dl) * L2;
      g += `<path class="arrow" pathLength="100" style="animation-delay:${(i * 70)}ms" d="M ${ax.toFixed(0)} ${sy.toFixed(0)} C ${cx * 0.5} ${sy.toFixed(0)}, ${c2x.toFixed(0)} ${c2y.toFixed(0)}, ${ex.toFixed(0)} ${ey.toFixed(0)}" stroke-width="${wOf(v)}"/>`;
      if (row.kind === "one") {
        g += `<text class="lbl" style="animation-delay:${(i * 70)}ms" x="${ix.toFixed(0)}" y="${(sy + 6).toFixed(0)}" text-anchor="middle" font-size="${compact ? 30 : 38}">${iconOf(row.e.t)}</text>`;
        if (!row.e.bot) g += `<text class="lbl" style="animation-delay:${(i * 70)}ms" x="${(ix + (compact ? 26 : 34)).toFixed(0)}" y="${(sy - 14).toFixed(0)}" font-size="${fs}" font-weight="700" fill="#0A0ABA">${fmt(row.e.v)}</text>`;
      } else {
        const shown = row.grp.members.slice(0, 7);
        shown.forEach((m, j) => {
          const dx = (j % 4) * (compact ? 17 : 22) - (compact ? 8 : 10);
          const dy = Math.floor(j / 4) * (compact ? 18 : 23) - (compact ? 20 : 27) - ((j * 5) % 6);
          g += `<text class="lbl" style="animation-delay:${(i * 70 + j * 40)}ms" x="${(ix + dx).toFixed(0)}" y="${(sy + dy).toFixed(0)}" text-anchor="middle" font-size="${compact ? 22 : 28}">${iconOf(m)}</text>`;
        });
        if (row.grp.members.length > 7) g += `<text class="lbl" style="animation-delay:${(i * 70)}ms" x="${(ix + (compact ? 34 : 44)).toFixed(0)}" y="${(sy + 4).toFixed(0)}" font-size="${fs}" fill="#5A6070">+${row.grp.members.length - 7}</text>`;
        const tag = row.grp.key === "\u2205" ? "\u2014" : (row.grp.key === "\u2026" ? "\u2026" : row.grp.key.split("").map((c) => String.fromCharCode(65 + +c)).join(""));
        g += `<text class="lbl" style="animation-delay:${(i * 70)}ms" x="${ix.toFixed(0)}" y="${(sy + (compact ? 28 : 35)).toFixed(0)}" text-anchor="middle" font-size="${compact ? 12 : 15}" fill="#5A6070">${tag}</text>`;
      }
    });
    const outDelay = nIn * 60 + 700;
    mkOut.forEach((e, i) => {
      const ey2 = spread(mkOut.length, i);
      const obow = bowOff(mkOut.length, i);
      const a = Math.PI * (-30 + (mkOut.length <= 1 ? 30 : (i / (mkOut.length - 1)) * 60)) / 180;
      const sx = cx + R * Math.cos(a), sy2 = cy + R * Math.sin(a);
      g += `<path class="arrow" pathLength="100" style="animation-delay:${(outDelay + i * 80)}ms" d="M ${sx.toFixed(0)} ${sy2.toFixed(0)} C ${(sx + (compact ? 60 : 150)).toFixed(0)} ${sy2.toFixed(0)}, ${(W * 0.75).toFixed(0)} ${ey2.toFixed(0)}, ${(W - (compact ? 86 : 156) - obow).toFixed(0)} ${ey2.toFixed(0)}" stroke-width="${wOf(e.v)}"/>`;
      g += `<text class="lbl" style="animation-delay:${(outDelay + i * 80)}ms" x="${(W - (compact ? 70 : 120) - obow).toFixed(0)}" y="${(ey2 + 6).toFixed(0)}" text-anchor="middle" font-size="${compact ? 30 : 38}">${iconOf(e.t)}</text>`;
      g += `<text class="lbl" style="animation-delay:${(outDelay + i * 80)}ms" x="${(W - (compact ? 54 : 98) - obow).toFixed(0)}" y="${(ey2 - (compact ? 12 : 16)).toFixed(0)}" text-anchor="start" font-size="${fs}" font-weight="700" fill="#B4400F">${fmt(e.v)}</text>`;
    });
    const f1 = Math.round(compact ? Math.max(19, R * 0.42) : Math.max(30, R * 0.36));
    const f2 = Math.round(f1 * 0.52);
    return `
    <svg class="flow" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
      <defs>
        <linearGradient id="tgw" x1="0" y1="0" x2="${W}" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#0000FF"/><stop offset="0.5" stop-color="#8200DE"/><stop offset="1" stop-color="#FF6432"/>
        </linearGradient>
      </defs>
      ${g}
      <g class="potring" style="transform-origin:${cx}px ${cy}px">
        <circle cx="${cx}" cy="${cy}" r="${R}" fill="#fff" stroke="url(#tgw)" stroke-width="${compact ? 3.5 : 5}"/>
        <text x="${cx}" y="${cy - f2 * 0.35}" text-anchor="middle" font-size="${f1}" font-weight="700" fill="#0000FF" font-family="Century Gothic,Questrial,Poppins,Arial">${fmt(totalIn)}</text>
        <text x="${cx}" y="${cy + f2 * 1.15}" text-anchor="middle" font-size="${f2}" font-weight="700" fill="#8200DE" font-family="Century Gothic,Questrial,Poppins,Arial">${rv.rolled ? "\u21bb rolls over" : "\u00d7" + rv.mult.toFixed(2)}</text>
      </g>
    </svg>`;
  }

  // Shared option rows: plain during the question, knockout-bar treatment at reveal.
  function optionRows(q, rv) {
    const shares = rv && rv.optShare ? rv.optShare : null;
    const n = q.options.length;
    const maxLen = Math.max(...q.options.map((o) => o.length));
    const twoCol = n >= 4 && maxLen <= (n >= 6 ? 62 : 95);
    return `<div class="optrows${twoCol ? " cols2" : ""}">` + q.options.map((o, i) => {
      const isC = q.correct.includes(String(i));
      const letter = String.fromCharCode(65 + i);
      const label = `${letter}. ${o}`;
      if (!rv) return `<div class="optrow plain"><span class="optlabel">${label}</span></div>`;
      const share = shares ? Math.round(shares[i] * 100) : null;
      return `<div class="optrow ${isC ? "right" : "wrong"}">
        <span class="optlabel">${label}</span>${share == null ? "" : `<span class="optpct">${share}%</span>`}
        <div class="optfillwrap" style="--w:${share == null ? 0 : share}%">
          <div class="optfill"><span class="optlabel">${label}</span>${share == null ? "" : `<span class="optpct">${share}%</span>`}</div>
        </div>
      </div>`;
    }).join("") + `</div>`;
  }


  function renderBoard(wm, prevWm, deltas) {
    const el = root.querySelector("#lbList");
    if (!el || !wm) return;
    const rank = (m) => Object.keys(m).sort((a, b) => m[b] - m[a]);
    const after = rank(wm);
    const prevIdx = {};
    if (prevWm) rank(prevWm).forEach((t, i) => { prevIdx[t] = i; });
    const rowH = 40;
    el.innerHTML = after.slice(0, 10).map((t, i) => {
      const badge = deltas && deltas[t] != null && Math.abs(deltas[t]) >= 0.5
        ? `<span class="delta-badge ${deltas[t] >= 0 ? "pos" : "neg"}" style="animation-delay:${i * 70}ms">${deltas[t] >= 0 ? "+" : "\u2212"}${fmt(Math.abs(deltas[t]))}</span>` : "";
      if (!prevWm) return `<li class="lbrow-static">${badge}${iconHtml(t)}<span>${fmt(wm[t])}</span></li>`;
      const pi = prevIdx[t] != null ? prevIdx[t] : 12;
      const enter = pi > 9;
      return `<li class="lbrow${enter ? " enter" : ""}" style="--dy:${enter ? 110 : (pi - i) * rowH}px; animation-delay:${i * 70}ms">
        ${badge}${iconHtml(t)}<span>${fmt(wm[t])}</span></li>`;
    }).join("");
  }

  function buildStage(q, phase, rv) {
    root.innerHTML = `
      <div class="stage">
        <div class="zone-q qcard">
          <div class="row spread">
            <span class="qmeta">Question ${S.state.round + 1} / ${N_ROUNDS} \u00b7 ${q.tag} \u00b7 ${q.type === "multi" ? "select all that apply" : "pick one"} \u00b7 <span id="locked">${lockLine()}</span></span>
            <span class="qmeta" id="qres"></span>
          </div>
          <h1 class="qtext" id="qtext">${q.text}</h1>
          <div id="optbox">${optionRows(q, null)}</div>
        </div>
        <div class="zone-l">
          <div id="clockwrap" class="fade show center">
            <div id="clock" class="clock hugeclock"></div>
          </div>
          <div id="potwrap" class="fade"></div>
        </div>
        <div class="zone-r" id="zoneR"><ol class="board lb biglb" id="lbList"></ol></div>
      </div>`;
    S.stageRound = S.state.round; S.revealApplied = false;
    renderBoard(phase === "reveal" && rv && rv.wealthAfter ? rv.wealthAfter : S.wealth, null);
    if (phase === "question") { S.timer = setInterval(tick, 250); tick(); }
    else if (rv) applyReveal(rv);
  }

  function applyReveal(rv) {
    S.revealApplied = true;
    clearInterval(S.timer);
    const q = QUESTIONS[S.state.round];
    const res = root.querySelector("#qres");
    if (res) {
      const letters = q.correct.split("").map((i) => String.fromCharCode(65 + +i)).join(" + ");
      res.innerHTML = `answer <strong>${letters}</strong>${rv.nAnswered ? ` \u00b7 ${rv.nRight} of ${rv.nAnswered} right` : ""} \u00b7 <strong>${rv.rolled ? "rollover" : "\u00d7" + rv.mult.toFixed(2)}</strong>`;
    }
    const rows = root.querySelectorAll("#optbox .optrow");
    rows.forEach((row, i) => {
      const isC = q.correct.includes(String(i));
      row.classList.remove("plain");
      row.classList.add(isC ? "right" : "wrong");
      const share = rv.optShare ? Math.round(rv.optShare[i] * 100) : null;
      const label = row.querySelector(".optlabel") ? row.querySelector(".optlabel").textContent : "";
      if (share != null) row.insertAdjacentHTML("beforeend",
        `<span class="optpct">${share}%</span><div class="optfillwrap" style="--w:${share}%"><div class="optfill"><span class="optlabel">${label}</span><span class="optpct">${share}%</span></div></div>`);
    });
    const cw = root.querySelector("#clockwrap"), pw = root.querySelector("#potwrap");
    if (cw) cw.classList.remove("show");
    if (pw) {
      pw.innerHTML = (rv.stakes && Object.keys(rv.stakes).length)
        ? potScene(rv, q, 780, 470, true, S.state.round)
        : `<p class="dim">Settled on an older build \u2014 no flow data for this round.</p>`;
      requestAnimationFrame(() => pw.classList.add("show"));
    }
    // deltas for everyone (bot deltas derived from stakes + rightness)
    const wAfter = rv.wealthAfter || S.wealth;
    const deltas = Object.assign({}, rv.deltas || {});
    for (const [t, st] of Object.entries(rv.botStakes || {})) {
      const right = rv.aiAnswers && rv.aiAnswers[t] === rv.correct;
      deltas[t] = right && !rv.rolled && rv.mult > 0 ? st * (rv.mult - 1) : -st;
    }
    const wBefore = {};
    for (const t of Object.keys(wAfter)) wBefore[t] = wAfter[t] - (deltas[t] || 0);
    clearTimeout(S.lbTimer);
    setTimeout(() => renderBoard(wBefore, null, deltas), 350);
    S.lbTimer = setTimeout(() => renderBoard(wAfter, wBefore, null), 2300);
  }

  function joinUrl() {
    return location.origin + location.pathname + location.search + "#join";
  }

  function render() {
    const ph = S.state ? S.state.phase : "lobby";
    if ((ph === "question" || ph === "reveal") && S.state && S.stageRound === S.state.round && root.querySelector(".stage")) {
      if (ph === "question") { const el = root.querySelector("#locked"); if (el) el.textContent = lockLine(); return; }
      if (ph === "reveal") { if (!S.revealApplied && S.reveal) applyReveal(S.reveal); return; }
    }
    clearInterval(S.timer);
    if (!S.state || ph === "lobby") {
      const humans = Object.entries(S.players).filter(([t]) => !BOTS[t]);
      root.innerHTML = `
        <div class="screen center">
          <h1>Croatia Quiz</h1>
          <p class="dim big-p">Scan to join \u2014 the house deals you a character.</p>
          <div id="qr" class="qr"></div>
          <p class="dim">${joinUrl()}</p>
          <div class="grid">${humans.map(([t]) => `<span class="chip">${nameOf(t)}</span>`).join("")}</div>
          <p class="dim">${humans.length} in the room \u00b7 ${Object.keys(BOTS).length} machines waiting</p>
        </div>`;
      drawQr(root.querySelector("#qr"), joinUrl());
      return;
    }

    if (ph === "question") {
      buildStage(QUESTIONS[S.state.round], "question");
      return;
    }

    if (ph === "reveal" && S.reveal) {
      buildStage(QUESTIONS[S.state.round], "reveal", S.reveal);
      return;
    }

    if (ph === "finished" && S.finale) {
      const f = S.finale;
      const stage = (S.state && S.state.finaleStage) || 0;
      const pc = (x) => x == null ? "\u2014" : (x * 100).toFixed(0) + "%";
      if (stage === 1 && S.reveals) {
        const nP = f.nPlayed || N_ROUNDS; const revArr = []; for (let i = 0; i < nP; i++) revArr.push(S.reveals[i]);
        const tokens = Object.keys(S.players);
        const series = wealthSeries(revArr, tokens);
        const style = {};
        tokens.forEach((t) => { style[t] = { color: "rgba(255,255,255,.45)", width: 2 }; });
        for (const t of tokens) if (BOTS[t]) style[t] = { color: "#FFFFFF", width: 3.2, dash: "7 4" };
        if (f.board && f.board.length) style[f.board[0].token] = { color: "#FFD359", width: 5 };
        const icons = {};
        for (const t of tokens) icons[t] = BOTS[t] && BOTS[t].img ? { img: BOTS[t].img } : { emoji: iconOf(t) };
        const chart = svgWealthChart(series, style, 1760, 760, 1.9, icons, true)
          .replace('style="width:100%;height:auto"', 'style="width:100%;height:100%"');
        root.innerHTML = `
          <div class="chartstage">
            <div class="cwrap">${chart}</div>
          </div>`;
        return;
      }
      if (stage === 2 && f.sizing) {
        const t = f.thresholds || {};
        const kM = t.kMedian != null ? t.kMedian : t.pMedian;
        const kA = t.kMean;
        const kT = t.kTop10 != null ? t.kTop10 : t.pTop10;
        const cell = (k, label, w) => `<div class="thresh"><div class="mult">${k == null ? ">100%" : pc(k)}</div><p>needs to know ${k == null ? "more than all" : pc(k)} of the answers to beat the ${label} (${fmt(w)})</p></div>`;
        const rows = f.sizing.map((r) => `<tr><td>${nameOf(r.token)}</td><td>${pc(r.pHat)}</td><td>${pc(r.fAvg)}</td><td>${pc(r.fStar)}</td>
              <td>${r.ratio == null ? "no edge" : r.ratio.toFixed(1) + "\u00d7 Kelly"}</td></tr>`);
        const half = Math.ceil(rows.length / 2);
        const thead = `<tr><th></th><th>accuracy</th><th>avg stake</th><th>Kelly says</th><th>verdict</th></tr>`;
        const tbl = (rs) => `<table class="sizing">${thead}${rs.join("")}</table>`;
        root.innerHTML = `
          <div class="kstage">
            <div class="kcard">
            <h1>The right size, in one line</h1>
            ${KELLY_FORMULA_HTML}
            <div class="cols" style="gap:2.5vw; margin:.4em 0 1em;">
              ${tbl(rows.slice(0, half))}${tbl(rows.slice(half))}
            </div>
            <h1>What would it have taken?</h1>
            <div class="cols tcenter" style="grid-template-columns:${kA != null ? "1fr 1fr 1fr" : "1fr 1fr"}">
              ${cell(kM, "median player", t.medianW)}
              ${kA != null ? cell(kA, "mean player", t.meanW) : ""}
              ${cell(kT, "top 10%", t.top10W)}
            </div>
            </div>
          </div>`;
        return;
      }
      const bd = f.board || [];
      const cols = bd.length > 16 ? 2 : 1;
      const acc = {};
      (f.sizing || []).forEach((r) => { acc[r.token] = r.pHat; });
      (f.aiCalib || []).forEach((r) => { if (r.n) acc[r.token] = r.right / r.n; });
      root.innerHTML = `
        <div class="kstage">
        <div class="tcenter">
          <div class="finalboard">
            <h1>Final leaderboard</h1>
            <ol class="board finallb" style="columns:${cols}">
              ${bd.map((r, i) => `<li><span>${i + 1}. ${iconHtml(r.token)} ${plainName(r.token)}</span><span class="lbacc">${acc[r.token] != null ? pc(acc[r.token]) : "\u2014"}</span><span>${fmt(r.w)}</span></li>`).join("")}
            </ol>
          </div>
          <p class="dim">${[
            f.bestRound ? `Biggest pot: Q${f.bestRound.n + 1}, ${fmt(f.bestRound.pot)} at ${f.bestRound.mult.toFixed(2)}\u00d7` : "",
            f.biggestWin ? `Best single round: ${nameOf(f.biggestWin.t)} +${fmt(f.biggestWin.d)} (Q${f.biggestWin.n + 1})` : "",
            f.biggestLoss ? `Worst beat: ${nameOf(f.biggestLoss.t)} \u2212${fmt(Math.abs(f.biggestLoss.d))} (Q${f.biggestLoss.n + 1})` : "",
          ].filter(Boolean).join(" \u00b7 ")}</p>
        </div>
        </div>`;
      return;
    }
    root.innerHTML = `<div class="screen center"><h1>\u2026</h1></div>`;
  }

  function drawQr(el, text) {
    if (!el) return;
    const go = () => { el.innerHTML = ""; new window.QRCode(el, { text, width: 240, height: 240 }); };
    if (window.QRCode) return go();
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
    s.onload = go; document.head.appendChild(s);
  }
}
