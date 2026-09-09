import { ensureAuth, gref, onValue, set, serverNow, serverTimestamp, read } from "../fb.js";
import { QUESTIONS, N_ROUNDS } from "../questions.js";
import { RULES, GAME_ID, BUILD } from "../config.js";
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
    if (!S.me && !S.joining) { S.joining = true; join().catch((e) => { S.joining = false; S.joinErr = ((e || {}).message) || String(e); render(); }); }
    render();
  });
  onValue(gref("state"), (s) => {
    const st = s.val();
    const newRound = st && st.round !== (S.state && S.state.round);
    const prevPhase = S.state && S.state.phase;
    S.state = st;
    if (prevPhase === "preview" && st && st.phase === "question" && st.round === S.round && (S.answer.size || S.pct > 0)) saveBet();
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
      const foot = `<p class="dim" style="font-size:.72rem;opacity:.6;margin-top:14px">game ${GAME_ID} \u00b7 ${BUILD}</p>`;
      root.innerHTML = S.joinErr
        ? `<div class="dealwrap"><div class="bigdisc"><div class="demoji">!</div><p class="dim">Couldn\u2019t join: ${S.joinErr}</p></div><button id="rejoin" style="margin-top:16px">Try again</button>${foot}</div>`
        : `<div class="dealwrap"><div class="bigdisc dealpulse"><div class="demoji">\u2026</div><p class="dim">Dealing you a character\u2026</p></div>${foot}</div>`;
      const rj = root.querySelector("#rejoin");
      if (rj) rj.onclick = () => { S.joinErr = null; S.joining = true; render(); join().catch((e) => { S.joining = false; S.joinErr = ((e || {}).message) || String(e); render(); }); };
      return;
    }
    const [emoji, name] = charOf(S.me);
    const ph = S.state ? S.state.phase : "lobby";

    if (!S.state || ph === "lobby") {
      root.innerHTML = `
        ${barHtml([emoji, name], false)}
        <div class="dealwrap" style="min-height:calc(100svh - 150px)">
          <div class="bigdisc">
            <div class="demoji">${emoji}</div>
            <h1>You are ${"AEIOU".includes(name[0]) ? "an" : "a"} ${name}</h1>
            <p class="dim">Waiting for the host to start. You get ${fmt(RULES.stipend)} every round; minimum stake ${fmt(RULES.minStake)}.</p>
          </div>
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
      const effPct = S.wealth > 0 ? Math.round(100 * stake / S.wealth) : 0;
      root.innerHTML = `
        ${barHtml([emoji, name], true)}
        <div class="card">
          <h2>${q.text}</h2>
          ${q.type === "multi" ? `<p class="dim multihint">Select all that apply</p>` : ""}
          <div id="opts">${q.options.map((o, i) =>
            `<button class="opt ${S.answer.has(i) ? "sel" : ""}" data-i="${i}">${o}</button>`).join("")}
          </div>
          <div class="stakebox">
            <div class="pctbig" id="pctbig">${effPct}%</div>
            <input id="slider" type="range" min="0" max="100" step="5" value="${S.pct}" ${locked ? "disabled" : ""} />
            <div class="row"><button class="stakelink" id="minBtn" ${locked ? "disabled" : ""}>${fmt(RULES.minStake)}</button><strong id="stake">${fmt(stake)}</strong><button class="stakelink" id="allinBtn" ${locked ? "disabled" : ""}>all in</button></div>
            <div id="status" class="dim">${statusLine()}</div>
          </div>
        </div>`;
      root.querySelectorAll(".opt").forEach((b) => { b.onclick = () => pickOption(+b.dataset.i, q.type); });
      const slider = root.querySelector("#slider");
      let deb = null;
      const showStake = () => {
        const st2 = clampStake(S.pct, S.wealth, RULES.minStake);
        const ep = S.wealth > 0 ? Math.round(100 * st2 / S.wealth) : 0;
        const pb = root.querySelector("#pctbig"); if (pb) pb.textContent = ep + "%";
        const se = root.querySelector("#stake"); if (se) se.textContent = fmt(st2);
      };
      slider.oninput = () => {
        S.pct = +slider.value;
        showStake();
        clearTimeout(deb); deb = setTimeout(saveBet, 250);
      };
      const minBtn = root.querySelector("#minBtn"), allBtn = root.querySelector("#allinBtn");
      if (minBtn) minBtn.onclick = () => {
        S.pct = S.wealth > 0 ? Math.min(100, Math.ceil(100 * RULES.minStake / S.wealth)) : 0;
        slider.value = String(S.pct); showStake(); saveBet();
      };
      if (allBtn) allBtn.onclick = () => { S.pct = 100; slider.value = "100"; showStake(); saveBet(); };
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
      if (stage >= 1 && stage <= 6 && f && S.reveals) {
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
      if (stage === 7 && f && f.sizing) {
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
        const topHuman = f.board.find((r) => !["grok","chatgpt","deepseek","claude","mistral","gemini"].includes(r.token) && !r.token.startsWith("tb_"));
        won = !!(topHuman && topHuman.token === token);
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
    const pb = root.querySelector("#pctbig");
    if (pb && S.wealth > 0) pb.textContent = Math.round(100 * clampStake(S.pct, S.wealth, RULES.minStake) / S.wealth) + "%";
  }
  function tick() {
    const num = root.querySelector("#clocknum");
    const fg = root.querySelector("#ringfg");
    if (!num || !S.state || !S.state.closesAt) return;
    const total = ((S.state && S.state.timerSec) || RULES.timerSec) * 1000;
    const real = S.state.closesAt - serverNow();
    const dLeft = Math.max(0, real - 1000);
    num.textContent = Math.ceil(dLeft / 1000);
    const low = dLeft > 0 && dLeft <= 5000;
    if (fg) {
      fg.style.strokeDashoffset = String(100 * (1 - Math.min(1, dLeft / total)));
      fg.setAttribute("stroke", low || dLeft === 0 ? "#D93636" : "url(#rg)");
    }
    num.setAttribute("fill", low || dLeft === 0 ? "#D93636" : "#0A0A14");
    document.body.classList.toggle("urgent", dLeft > 0 && dLeft <= 5000 && !S.answer.size);
    if (real <= 0) {
      root.querySelectorAll(".opt,#slider").forEach((n) => (n.disabled = true));
      document.body.classList.remove("urgent");
    }
  }
}
