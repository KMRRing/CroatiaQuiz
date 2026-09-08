import { ensureAuth, gref, onValue, set, serverNow, serverTimestamp, read } from "../fb.js";
import { QUESTIONS, N_ROUNDS } from "../questions.js";
import { RULES, GAME_ID } from "../config.js";
import { CHARACTERS } from "../characters.js";
import { clampStake, fmt } from "../engine.js";
import { wealthSeries, svgWealthChart } from "../finale.js";

const TOKEN_KEY = "cq_token_" + GAME_ID;

export async function mount(root) {
  const user = await ensureAuth();
  let token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    token = "p_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(TOKEN_KEY, token);
  }

  const S = {
    me: null, state: null, wealth: 0,
    round: -1, answer: new Set(), pct: 0, saved: false,
    reveal: null, finale: null, timer: null,
  };

  onValue(gref("players", token), (s) => {
    S.me = s.val();
    if (!S.me && !S.joining) { S.joining = true; join().catch(() => { S.joining = false; }); }
    render();
  });
  onValue(gref("state"), (s) => {
    const st = s.val();
    const newRound = st && st.round !== (S.state && S.state.round);
    S.state = st;
    if (st && (st.phase === "question" || st.phase === "preview") && (newRound || S.round !== st.round)) {
      S.round = st.round; S.answer = new Set(); S.pct = 0; S.saved = false; S.reveal = null;
    }
    if (st && st.phase === "reveal") loadReveal(st.round);
    if (st && st.phase === "finished") loadFinale();
    render();
  });
  onValue(gref("wealth", token), (s) => {
    const w = s.val() || 0;
    const wasLocked = S.wealth <= RULES.minStake, isLocked = w <= RULES.minStake;
    S.wealth = w;
    if (S.state && S.state.phase === "question" && wasLocked !== isLocked) render();
    else patchWealth();
  });

  async function loadReveal(r) { S.reveal = await read("reveal", r); render(); }
  async function loadFinale() { S.finale = await read("finale"); S.reveals = await read("reveal"); render(); }

  async function join() {
    for (let attempt = 0; attempt < 4; attempt++) {
      const players = (await read("players")) || {};
      const taken = new Set(Object.entries(players).filter(([t2]) => t2 !== token).map(([, pl]) => pl.ci));
      const free = CHARACTERS.map((_, i) => i).filter((i) => !taken.has(i));
      const ci = free.length ? free[Math.floor(Math.random() * free.length)] : Math.floor(Math.random() * CHARACTERS.length);
      await set(gref("players", token), { uid: user.uid, ci, joinedAt: serverTimestamp() });
      const again = (await read("players")) || {};
      const clash = Object.entries(again).filter(([t2, pl]) => t2 !== token && pl.ci === ci);
      if (!clash.length || !clash.some(([t2]) => t2 < token)) return; // we keep it; any later token re-rolls
    }
  }

  function saveBet() {
    if (!S.state || S.state.phase !== "question") return;
    if (serverNow() > S.state.closesAt) return;
    const q = QUESTIONS[S.state.round];
    const ans = S.answer.size
      ? (q.type === "single" ? String([...S.answer][0]) : [...S.answer].sort((a, b) => a - b).join(""))
      : null;
    set(gref("bets", S.state.round, token), { answer: ans, pct: S.pct, at: serverTimestamp() });
    S.saved = true; patchStatus();
  }

  function pickOption(i, type) {
    if (type === "single") { S.answer = new Set([i]); }
    else { S.answer.has(i) ? S.answer.delete(i) : S.answer.add(i); }
    saveBet(); render();
  }

  /* ---------- rendering ---------- */
  function barHtml(me, withClock) {
    const [emoji, name] = me;
    return `<div class="bar">
      <span id="wealth">${fmt(S.wealth)}</span>
      <span class="clockcell">${withClock ? `
        <svg class="ring" viewBox="0 0 44 44">
          <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#0000FF"/><stop offset=".55" stop-color="#8200DE"/><stop offset="1" stop-color="#FF6432"/>
          </linearGradient></defs>
          <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(10,10,20,.12)" stroke-width="4"/>
          <circle id="ringfg" cx="22" cy="22" r="18" fill="none" stroke="url(#rg)" stroke-width="4"
            pathLength="100" stroke-dasharray="100" stroke-dashoffset="0" stroke-linecap="round"
            transform="rotate(-90 22 22)"/>
          <text id="clocknum" x="22" y="27" text-anchor="middle" font-size="14" font-weight="700" fill="#0A0A14"></text>
        </svg>` : ""}</span>
      <span class="barname">${emoji} ${name}</span>
    </div>`;
  }

  function charOf(p) { return p ? CHARACTERS[p.ci] || ["\u{1F3AD}", "Mystery"] : null; }


  function stopParty() {
    clearInterval(S.partyTimer); clearInterval(S.partyTimer2);
    const l = document.querySelector(".confetti-layer"); if (l) l.remove();
  }
  function startParty() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let layer = document.querySelector(".confetti-layer");
    if (!layer) { layer = document.createElement("div"); layer.className = "confetti-layer"; document.body.appendChild(layer); }
    const COLORS = ["#0000FF", "#8200DE", "#FF6432", "#FFD359", "#0CA6FF"];
    const conf = () => {
      for (let k = 0; k < 10; k++) {
        const isE = Math.random() < 0.25;
        const d = document.createElement(isE ? "span" : "div");
        if (isE) { d.textContent = ["\u{1F389}", "\u2728", "\u{1F38A}"][k % 3]; d.style.fontSize = (12 + Math.random() * 14) + "px"; }
        else { d.style.width = "9px"; d.style.height = (8 + Math.random() * 8) + "px"; d.style.background = COLORS[k % COLORS.length]; }
        d.className = "cf"; d.style.left = Math.random() * 100 + "vw";
        d.style.animationDuration = (2.6 + Math.random() * 2.2) + "s";
        layer.appendChild(d); setTimeout(() => d.remove(), 5200);
      }
    };
    const boom = () => {
      const tx = 22 + Math.random() * 56, ty = 10 + Math.random() * 40;
      const fromLeft = Math.random() < 0.5;
      const sy = 55 + Math.random() * 35;
      const r0 = document.createElement("div"); r0.className = "rocket";
      r0.style.left = (fromLeft ? -2 : 102) + "vw"; r0.style.top = sy + "vh";
      r0.style.background = COLORS[(Math.random() * COLORS.length) | 0];
      r0.style.setProperty("--tx", (tx - (fromLeft ? -2 : 102)) + "vw");
      r0.style.setProperty("--ty", (ty - sy) + "vh");
      layer.appendChild(r0);
      setTimeout(() => {
        r0.remove();
        for (let k = 0; k < 16; k++) {
          const q2 = document.createElement("div"); q2.className = "fw";
          q2.style.left = tx + "vw"; q2.style.top = ty + "vh"; q2.style.background = COLORS[k % COLORS.length];
          const a = (k / 16) * 2 * Math.PI, r = 90 + Math.random() * 70;
          q2.style.setProperty("--dx", Math.cos(a) * r + "px"); q2.style.setProperty("--dy", Math.sin(a) * r + "px");
          layer.appendChild(q2); setTimeout(() => q2.remove(), 1200);
        }
      }, 650);
    };
    conf(); boom();
    S.partyTimer = setInterval(conf, 650); S.partyTimer2 = setInterval(boom, 2200);
  }

  function render() {
    stopParty();
    document.body.classList.remove("urgent");
    clearInterval(S.timer);
    if (!S.me) {
      root.innerHTML = `<div class="card center"><div class="avatar">\u2026</div><p class="dim">Dealing you a character\u2026</p></div>`;
      return;
    }
    const [emoji, name] = charOf(S.me);
    const ph = S.state ? S.state.phase : "lobby";

    if (!S.state || ph === "lobby") {
      root.innerHTML = `
        ${barHtml([emoji, name], false)}
        <div class="card center">
          <div class="avatar">${emoji}</div>
          <h1>You are ${name}</h1>
          <p class="dim">Waiting for the host to start. You get ${fmt(RULES.stipend)} every round; minimum stake ${fmt(RULES.minStake)}.</p>
        </div>`;
      return;
    }

    if (ph === "question" || ph === "preview") {
      const previewing = ph === "preview";
      const q = QUESTIONS[S.state.round];
      const locked = S.wealth <= RULES.minStake;
      if (locked) { S.pct = 100; S.pctForced = true; }
      else if (S.pctForced) { S.pct = 0; S.pctForced = false; if (S.answer.size) saveBet(); }
      const stake = clampStake(S.pct, S.wealth, RULES.minStake);
      root.innerHTML = `
        ${barHtml([emoji, name], true)}
        <div class="card">
          <h2>${q.text}</h2>
          <div id="opts">${q.options.map((o, i) =>
            `<button class="opt ${S.answer.has(i) ? "sel" : ""}" data-i="${i}">${o}</button>`).join("")}
          </div>
          <div class="stakebox">
            <div class="pctbig" id="pctbig">${S.pct}%</div>
            <input id="slider" type="range" min="0" max="100" step="5" value="${S.pct}" ${locked || previewing ? "disabled" : ""} />
            <div class="row"><span class="dim">${locked ? "stack at the minimum" : "minimum " + fmt(RULES.minStake)}</span><strong id="stake">${fmt(stake)}</strong><span class="dim">all in</span></div>
            <div id="status" class="dim">${statusLine()}</div>
          </div>
        </div>`;
      root.querySelectorAll(".opt").forEach((b) => { b.disabled = previewing; b.onclick = () => pickOption(+b.dataset.i, q.type); });
      const slider = root.querySelector("#slider");
      let deb = null;
      slider.oninput = () => {
        S.pct = +slider.value;
        root.querySelector("#pctbig").textContent = S.pct + "%";
        root.querySelector("#stake").textContent = fmt(clampStake(S.pct, S.wealth, RULES.minStake));
        clearTimeout(deb); deb = setTimeout(saveBet, 250);
      };
      if (previewing) {
        const num = root.querySelector("#clocknum");
        if (num) num.textContent = (S.state.timerSec || RULES.timerSec);
      } else { S.timer = setInterval(tick, 250); tick(); }
      return;
    }

    if (ph === "reveal") {
      const q = QUESTIONS[S.state.round];
      const rv = S.reveal;
      const mineAns = rv && rv.answers && rv.answers[token] != null
        ? rv.answers[token]
        : (S.answer.size ? [...S.answer].sort((a, b) => a - b).join("") : "");
      const mineSet = new Set(mineAns.split("").map((c) => +c));
      const d = rv && rv.deltas ? rv.deltas[token] : null;
      root.innerHTML = `
        ${barHtml([emoji, name], false)}
        <div class="card">
          <h2>${q.text}</h2>
          <div>${q.options.map((o, i) => {
            const isC = q.correct.includes(String(i));
            const cls = isC ? "res-c" : (mineSet.has(i) ? "res-w" : "");
            return `<button class="opt ${cls}" disabled>${o}</button>`;
          }).join("")}</div>
          <div class="stakebox resultbox">
            ${rv ? `
              <p class="delta ${d >= 0 ? "up" : "down"}">${d == null ? "" : (d >= 0 ? "+" : "\u2212") + fmt(Math.abs(d))}</p>
              ${rv.rolled ? `<p class="dim">Nobody had it. The pot rolls over.</p>` : ""}
            ` : `<p class="dim">Settling\u2026</p>`}
          </div>
        </div>`;
      return;
    }

    if (ph === "finished") {
      const f = S.finale;
      const stage = (S.state && S.state.finaleStage) || 0;
      const pc = (x) => x == null ? "\u00b7" : (x * 100).toFixed(0) + "%";
      if (stage >= 1 && stage <= 4 && f && S.reveals) {
        const nP = f.nPlayed || N_ROUNDS; const revArr = []; for (let i = 0; i < nP; i++) revArr.push(S.reveals[i]);
        const tokens = (f.board || []).map((r) => r.token);
        const series = wealthSeries(revArr, tokens);
        const style = {};
        tokens.forEach((t) => { style[t] = { color: "rgba(255,255,255,.35)", width: 1 }; });
        style[token] = { color: "#FFD359", width: 3, label: "you" };
        const qrows = revArr.map((rv, i) => {
          if (!rv) return "";
          const d = rv.deltas ? rv.deltas[token] : null;
          const a = rv.answers ? rv.answers[token] : null;
          const mark = d == null ? "\u00b7" : (d > 0 ? "\u2713" : (a === "" || a == null ? "\u00b7" : "\u2717"));
          const dTxt = d == null ? "" : (d >= 0 ? "+" : "\u2212") + fmt(Math.abs(d));
          return `<div class="qsrow"><span>Q${i + 1} ${mark}</span><span class="${d >= 0 ? "up" : "down"}">${dTxt}</span></div>`;
        }).join("");
        root.innerHTML = `${barHtml([emoji, name], false)}
          <div class="card">${svgWealthChart(series, style, 620, 340, 1, null, true)}</div>
          <div class="card"><div class="qsummary">${qrows}</div></div>`;
        return;
      }
      if (stage === 5 && f && f.sizing) {
        const mine = f.sizing.find((r) => r.token === token);
        root.innerHTML = `${barHtml([emoji, name], false)}<div class="card"><h2>Your sizing</h2>
          ${mine ? `
          <div class="statrow"><span>Accuracy</span><strong>${pc(mine.pHat)}</strong></div>
          <div class="statrow"><span>Average stake</span><strong>${pc(mine.fAvg)}</strong></div>
          <div class="statrow"><span>The right stake at your accuracy and this game's odds</span><strong>${pc(mine.fStar)}</strong></div>
          ` : `<p class="dim">No settled rounds on your record.</p>`}
        </div>`;
        return;
      }

      let mine = "", won = false;
      if (f && f.board) {
        const idx = f.board.findIndex((r) => r.token === token);
        won = idx === 0;
        if (idx >= 0) mine = won
          ? `<h2>\u{1F3C6} You won the night: ${fmt(f.board[idx].w)}</h2>`
          : `<h2>You finished ${idx + 1}${["st","nd","rd"][idx] || "th"} with ${fmt(f.board[idx].w)}</h2>`;
      }
      root.innerHTML = `
        ${barHtml([emoji, name], false)}
        <div class="card center">
          <div class="avatar${won ? " winner" : ""}">${emoji}${won ? `
            <svg class="hat" viewBox="0 0 200 210" aria-hidden="true">
              <defs><linearGradient id="hg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#0000FF"/><stop offset=".55" stop-color="#8200DE"/><stop offset="1" stop-color="#FF6432"/>
              </linearGradient></defs>
              <path d="M 153.9 38.1 L 72.8 97.2 A 54 54 0 0 0 136.4 136.9 Z" fill="url(#hg)"/>
              <circle cx="153.9" cy="38.1" r="6" fill="#FFD359"/>
            </svg>` : ""}</div>
          ${mine || "<h2>Full time.</h2>"}
          ${won ? `<p class="dim">Take a bow.</p>` : ""}
        </div>`;
      if (won) startParty();
      return;
    }
  }

  function statusLine() { return ""; }
  function patchStatus() { const el = root.querySelector("#status"); if (el) el.textContent = statusLine(); }
  function patchWealth() {
    const el = root.querySelector("#wealth"); if (el) el.textContent = fmt(S.wealth);
    const st = root.querySelector("#stake");
    if (st) st.textContent = fmt(clampStake(S.pct, S.wealth, RULES.minStake));
  }
  function tick() {
    const num = root.querySelector("#clocknum");
    const fg = root.querySelector("#ringfg");
    if (!num || !S.state || !S.state.closesAt) return;
    const total = ((S.state && S.state.timerSec) || RULES.timerSec) * 1000;
    const left = Math.max(0, S.state.closesAt - serverNow());
    num.textContent = Math.ceil(left / 1000);
    const low = left > 0 && left <= 5000;
    if (fg) {
      fg.style.strokeDashoffset = String(100 * (1 - left / total));
      fg.setAttribute("stroke", low ? "#D93636" : "url(#rg)");
    }
    num.setAttribute("fill", low ? "#D93636" : "#0A0A14");
    const urgent = left > 0 && left <= 5000 && !S.answer.size;
    document.body.classList.toggle("urgent", urgent);
    if (left <= 0) {
      root.querySelectorAll(".opt,#slider").forEach((n) => (n.disabled = true));
      document.body.classList.remove("urgent");
    }
  }
}
