import { gref, onValue, ensureAuth, serverNow, read } from "../fb.js";
import { QUESTIONS, N_ROUNDS } from "../questions.js";
import { CHARACTERS } from "../characters.js";
import { fmt, board } from "../engine.js";
import { botRoster } from "../bots.js";
import { wealthSeries, svgWealthChart, AI_COLORS, KELLY_FORMULA_HTML } from "../finale.js";

const BOTS = Object.fromEntries(botRoster().map((b) => [b.token, b]));

export async function mount(root) {
  await ensureAuth();
  const S = { state: null, players: {}, wealth: {}, betCount: 0, reveal: null, finale: null, timer: null, betsUnsub: null };

  onValue(gref("players"), (s) => { S.players = s.val() || {}; render(); });
  onValue(gref("wealth"), (s) => { S.wealth = s.val() || {}; });
  onValue(gref("state"), async (s) => {
    S.state = s.val(); S.reveal = null;
    if (S.state && S.state.phase === "reveal") S.reveal = await read("reveal", S.state.round);
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

  const nameOf = (t) => {
    if (BOTS[t]) return BOTS[t].emoji + " " + BOTS[t].name;
    const p = S.players[t];
    const c = p ? CHARACTERS[p.ci] || ["\u{1F3AD}", "?"] : ["\u{1F3AD}", "?"];
    return c[0] + " " + c[1];
  };
  const humanCount = () => Object.entries(S.players).filter(([t]) => !BOTS[t]).length;
  const lockLine = () => `${S.betCount} of ${humanCount()} locked in`;


  function potScene(rv, q) {
    const mkIn = [], mkOut = [];
    for (const [t, st] of Object.entries(rv.stakes || {})) mkIn.push({ t, v: st, bot: false });
    for (const [t, st] of Object.entries(rv.botStakes || {})) mkIn.push({ t, v: st, bot: true });
    mkIn.sort((a, b) => b.v - a.v);
    for (const e of mkIn) {
      const right = e.bot ? (rv.aiAnswers && rv.aiAnswers[e.t] === rv.correct) : (rv.deltas && rv.deltas[e.t] > 0);
      if (right && !rv.rolled && rv.mult > 0) mkOut.push({ t: e.t, v: e.v * rv.mult, bot: e.bot });
    }
    mkOut.sort((a, b) => b.v - a.v);
    const totalIn = mkIn.reduce((a, e) => a + e.v, 0) + (rv.pot - rv.L);
    const vmax = Math.max(1, mkIn[0] ? mkIn[0].v : 1, mkOut[0] ? mkOut[0].v : 1);
    const wOf = (v) => (1.5 + 12 * Math.sqrt(v / vmax)).toFixed(1);
    const spread = (n, i) => 90 + (n <= 1 ? 190 : (i / (n - 1)) * 380);
    let g = "";
    mkIn.forEach((e, i) => {
      const sy = spread(mkIn.length, i);
      const a = Math.PI * (150 + (mkIn.length <= 1 ? 30 : (i / (mkIn.length - 1)) * 60)) / 180;
      const ex = 600 + 118 * Math.cos(a), ey = 300 + 118 * Math.sin(a);
      g += `<path class="arrow" pathLength="100" style="animation-delay:${(i * 70)}ms" d="M 80 ${sy} C 300 ${sy}, ${ex - 150} ${ey}, ${ex.toFixed(0)} ${ey.toFixed(0)}" stroke-width="${wOf(e.v)}" marker-end="url(#ain)"/>`;
      if (i < 3) g += `<text class="lbl" style="animation-delay:${(i * 70)}ms" x="80" y="${sy - 10}" font-size="19" font-weight="700" fill="#0A0ABA">${nameOf(e.t)}${e.bot ? "" : " " + fmt(e.v)}</text>`;
    });
    const outDelay = mkIn.length * 70 + 700;
    mkOut.forEach((e, i) => {
      const ey2 = spread(mkOut.length, i);
      const a = Math.PI * (-30 + (mkOut.length <= 1 ? 30 : (i / (mkOut.length - 1)) * 60)) / 180;
      const sx = 600 + 118 * Math.cos(a), sy2 = 300 + 118 * Math.sin(a);
      g += `<path class="arrow" pathLength="100" style="animation-delay:${(outDelay + i * 90)}ms" d="M ${sx.toFixed(0)} ${sy2.toFixed(0)} C ${sx + 150} ${sy2}, 900 ${ey2}, 1120 ${ey2}" stroke-width="${wOf(e.v)}" marker-end="url(#aout)"/>`;
      if (i < 3) g += `<text class="lbl" style="animation-delay:${(outDelay + i * 90)}ms" x="1120" y="${ey2 - 10}" text-anchor="end" font-size="19" font-weight="700" fill="#B4400F">${nameOf(e.t)} ${fmt(e.v)}</text>`;
    });
    const potHead = rv.rolled
      ? `<text x="600" y="120" text-anchor="middle" font-size="30" font-weight="700" fill="#8200DE" font-family="Century Gothic,Questrial,Poppins,Arial">NOBODY RIGHT \u2014 ${fmt(rv.pot)} ROLLS OVER</text>`
      : `<text x="600" y="120" text-anchor="middle" font-size="40" font-weight="700" fill="#0000FF" font-family="Century Gothic,Questrial,Poppins,Arial">${fmt(totalIn)} in the pot</text>`;
    return `
    <svg class="flow" viewBox="0 0 1200 560" style="width:100%;height:auto">
      <defs>
        <linearGradient id="tgw" x1="0" y1="0" x2="1200" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#0000FF"/><stop offset="0.5" stop-color="#8200DE"/><stop offset="1" stop-color="#FF6432"/>
        </linearGradient>
        <marker id="ain" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#8200DE"/></marker>
        <marker id="aout" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#FF6432"/></marker>
      </defs>
      ${potHead}
      <g class="potring" style="transform-origin:600px 300px">
        <circle cx="600" cy="300" r="118" fill="#fff" stroke="url(#tgw)" stroke-width="5"/>
        <text x="600" y="292" text-anchor="middle" font-size="46" font-weight="700" fill="#8200DE" font-family="Century Gothic,Questrial,Poppins,Arial">${rv.rolled ? "\u21bb" : "\u00d7" + rv.mult.toFixed(2)}</text>
        <text x="600" y="330" text-anchor="middle" font-size="17" fill="#5A6070">${rv.rolled ? "carried to next round" : "paid to the right side"}</text>
      </g>
      ${g}
    </svg>`;
  }

  function joinUrl() {
    return location.origin + location.pathname + location.search + "#join";
  }

  function render() {
    clearInterval(S.timer);
    const ph = S.state ? S.state.phase : "lobby";

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
      const q = QUESTIONS[S.state.round];
      root.innerHTML = `
        <div class="screen">
          <div class="row spread">
            <span class="dim">Question ${S.state.round + 1} / ${N_ROUNDS} \u00b7 ${q.tag}</span>
            <span id="clock" class="clock big-clock"></span>
          </div>
          <h1 class="qtext">${q.text}</h1>
          <div class="optgrid">${q.options.map((o, i) => `<div class="opt-s">${String.fromCharCode(65 + i)}. ${o}</div>`).join("")}</div>
          <p class="dim">${q.type === "multi" ? "Select all that apply." : "Pick one."} Minimum stake rides either way.</p>
          <h2 id="locked">${lockLine()}</h2>
        </div>`;
      S.timer = setInterval(() => {
        const el = root.querySelector("#clock"); if (!el) return;
        const left = Math.max(0, S.state.closesAt - serverNow());
        el.textContent = Math.ceil(left / 1000);
        if (left <= 0) el.textContent = "\u23F3 settling";
      }, 250);
      return;
    }

    if (ph === "reveal" && S.reveal) {
      const q = QUESTIONS[S.state.round];
      const rv = S.reveal;
      const correctTxt = q.correct.split("").map((i) => String.fromCharCode(65 + +i) + ". " + q.options[+i]).join("  \u00b7  ");
      const bd = board(S.wealth, S.players).slice(0, 5);
      root.innerHTML = `
        <div class="screen">
          <div class="dim">Question ${S.state.round + 1} \u2014 the answer</div>
          <h1 class="qtext">${correctTxt}</h1>
          ${(rv.stakes && Object.keys(rv.stakes).length) ? potScene(rv, q) : `<p class="dim">This round was settled by an older host build \u2014 pot animation available from the next round.</p>`}
          <div class="strip">
            <div><h2>The machines said</h2>
              <div class="grid" style="justify-content:flex-start">${Object.entries(rv.aiAnswers || {}).map(([t, a]) =>
                `<span class="chip">${nameOf(t)} \u00b7 ${a == null || a === "" ? "\u2014" : a.split("").map((i) => String.fromCharCode(65 + +i)).join("")}</span>`).join("")}
              </div></div>
            <div><h2>Top 5</h2>
              <ol class="board">${bd.map((r) => `<li>${nameOf(r.token)} <span>${fmt(r.w)}</span></li>`).join("")}</ol></div>
          </div>
        </div>`;
      return;
    }

    if (ph === "finished" && S.finale) {
      const f = S.finale;
      const stage = (S.state && S.state.finaleStage) || 0;
      const pc = (x) => x == null ? "\u2014" : (x * 100).toFixed(0) + "%";
      const stageFoot = `<p class="dim">Finale screen ${stage + 1} of 4 \u2014 the host advances.</p>`;
      if (stage === 1 && S.reveals) {
        const nP = f.nPlayed || N_ROUNDS; const revArr = []; for (let i = 0; i < nP; i++) revArr.push(S.reveals[i]);
        const tokens = Object.keys(S.players);
        const series = wealthSeries(revArr, tokens);
        const style = {};
        tokens.forEach((t) => { style[t] = { color: "#C9D0E2", width: 1.3 }; });
        let k = 0;
        for (const t of tokens) if (BOTS[t]) { style[t] = { color: AI_COLORS[k % AI_COLORS.length], width: 2, dash: "5 3", label: BOTS[t].name }; k++; }
        if (f.board && f.board.length) {
          const win = f.board[0].token;
          style[win] = { color: "#0000FF", width: 3, label: nameOf(win).split(" ").slice(1).join(" ") };
        }
        root.innerHTML = `
          <div class="screen">
            <h1>The money, round by round</h1>
            <p class="dim">Humans in grey, machines dashed, the winner in blue. Everyone sees their own line on their phone.</p>
            ${svgWealthChart(series, style, 1040, 460)}
            ${stageFoot}
          </div>`;
        return;
      }
      if (stage === 2 && f.sizing) {
        root.innerHTML = `
          <div class="screen">
            <h1>The right size, in one line</h1>
            ${KELLY_FORMULA_HTML}
            <p class="dim">This game's average pool multiple: O\u0304 = ${f.thresholds ? f.thresholds.Obar.toFixed(2) : "?"}\u00d7.
            Below: your realised accuracy, your average stake, and what the formula said it should have been.</p>
            <table class="sizing"><tr><th></th><th>accuracy</th><th>avg stake</th><th>Kelly says</th><th>verdict</th></tr>
            ${f.sizing.map((r) => `<tr><td>${nameOf(r.token)}</td><td>${pc(r.pHat)}</td><td>${pc(r.fAvg)}</td><td>${pc(r.fStar)}</td>
              <td>${r.ratio == null ? "no positive-edge stake existed" : r.ratio.toFixed(1) + "\u00d7 Kelly " + (r.ratio > 1.2 ? "\u2014 overcommitted" : r.ratio < 0.8 ? "\u2014 timid" : "\u2014 on the money")}</td></tr>`).join("")}
            </table>
            ${stageFoot}
          </div>`;
        return;
      }
      if (stage === 3 && f.thresholds) {
        const t = f.thresholds;
        root.innerHTML = `
          <div class="screen center">
            <h1>What would it have taken?</h1>
            <p class="big-p">An outsider betting the formula perfectly at this game's realised odds needed\u2026</p>
            <div class="cols">
              <div class="thresh"><div class="mult">${t.pMedian == null ? ">99%" : pc(t.pMedian)}</div><p>accuracy to beat the median (${fmt(t.medianW)})</p></div>
              <div class="thresh"><div class="mult">${t.pTop10 == null ? ">99%" : pc(t.pTop10)}</div><p>accuracy to crack the top 10% (${fmt(t.top10W)})</p></div>
            </div>
            <p class="dim">Perfect sizing buys surprisingly little without the accuracy to back it \u2014 and past the pool's own accuracy, every extra point compounds.</p>
            ${stageFoot}
          </div>`;
        return;
      }
      root.innerHTML = `
        <div class="screen">
          <h1>Full time</h1>
          <div class="cols">
            <div>
              <h2>Final board</h2>
              <ol class="board">${(f.board || []).slice(0, 12).map((r) => `<li>${nameOf(r.token)} <span>${fmt(r.w)}</span></li>`).join("")}</ol>
            </div>
            <div>
              <h2>Machine calibration (Brier \u2014 lower is better)</h2>
              <ol class="board">${(f.aiCalib || []).map((r) => `<li>${nameOf(r.token)} <span>${r.brier.toFixed(3)} \u00b7 ${r.right}/${r.n}</span></li>`).join("")}</ol>
              ${f.bestRound ? `<p>Biggest pot: question ${f.bestRound.n + 1} \u2014 ${fmt(f.bestRound.pot)} at ${f.bestRound.mult.toFixed(2)}\u00d7</p>` : ""}
              ${f.biggestWin ? `<p>Best single round: ${nameOf(f.biggestWin.t)} +${fmt(f.biggestWin.d)} (Q${f.biggestWin.n + 1})</p>` : ""}
              ${f.biggestLoss ? `<p>Worst beat: ${nameOf(f.biggestLoss.t)} \u2212${fmt(Math.abs(f.biggestLoss.d))} (Q${f.biggestLoss.n + 1})</p>` : ""}
            </div>
          </div>
          <p class="dim">Finale screen 1 of 4 \u2014 the host advances.</p>
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
