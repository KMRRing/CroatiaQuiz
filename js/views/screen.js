import { gref, onValue, ensureAuth, serverNow, read } from "../fb.js";
import { QUESTIONS, N_ROUNDS } from "../questions.js";
import { CHARACTERS } from "../characters.js";
import { fmt, board } from "../engine.js";
import { botRoster } from "../bots.js";

const BOTS = Object.fromEntries(botRoster().map((b) => [b.token, b]));

export async function mount(root) {
  await ensureAuth();
  const S = { state: null, players: {}, wealth: {}, betCount: 0, reveal: null, finale: null, timer: null, betsUnsub: null };

  onValue(gref("players"), (s) => { S.players = s.val() || {}; render(); });
  onValue(gref("wealth"), (s) => { S.wealth = s.val() || {}; });
  onValue(gref("state"), async (s) => {
    S.state = s.val(); S.reveal = null;
    if (S.state && S.state.phase === "reveal") S.reveal = await read("reveal", S.state.round);
    if (S.state && S.state.phase === "finished") S.finale = await read("finale");
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
      const bd = board(S.wealth, S.players).slice(0, 10);
      const total = rv.W + rv.L || 1;
      root.innerHTML = `
        <div class="screen">
          <div class="dim">Question ${S.state.round + 1} \u2014 the answer</div>
          <h1 class="qtext">${correctTxt}</h1>
          <div class="poolbar"><div class="poolW" style="width:${(rv.W / total) * 100}%"></div></div>
          <div class="row spread">
            <span>${fmt(rv.W)} right</span>
            <strong class="mult">${rv.rolled ? "ROLLOVER \u2192 " + fmt(rv.pot) : rv.mult.toFixed(2) + "\u00d7"}</strong>
            <span>${fmt(rv.L)} wrong</span>
          </div>
          ${rv.top ? `<p>${nameOf(rv.top.gainT)} +${fmt(rv.top.gainD)} \u00b7 ${nameOf(rv.top.lossT)} \u2212${fmt(Math.abs(rv.top.lossD))}</p>` : ""}
          <div class="cols">
            <div>
              <h2>Board</h2>
              <ol class="board">${bd.map((r) => `<li>${nameOf(r.token)} <span>${fmt(r.w)}</span></li>`).join("")}</ol>
            </div>
            <div>
              <h2>The machines said</h2>
              <ul class="board">${Object.entries(rv.aiAnswers || {}).map(([t, a]) =>
                `<li>${nameOf(t)} <span>${a == null || a === "" ? "\u2014" : a.split("").map((i) => String.fromCharCode(65 + +i)).join("")}</span></li>`).join("")}
              </ul>
              <p class="dim">Their stakes stay sealed until the end.</p>
            </div>
          </div>
        </div>`;
      return;
    }

    if (ph === "finished" && S.finale) {
      const f = S.finale;
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
