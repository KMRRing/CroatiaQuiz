import { ensureAuth, gref, onValue, set, serverNow, serverTimestamp, read } from "../fb.js";
import { QUESTIONS, N_ROUNDS } from "../questions.js";
import { RULES, GAME_ID } from "../config.js";
import { CHARACTERS } from "../characters.js";
import { clampStake, fmt } from "../engine.js";

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

  onValue(gref("players", token), (s) => { S.me = s.val(); render(); });
  onValue(gref("state"), (s) => {
    const st = s.val();
    const newRound = st && st.round !== (S.state && S.state.round);
    S.state = st;
    if (st && st.phase === "question" && (newRound || S.round !== st.round)) {
      S.round = st.round; S.answer = new Set(); S.pct = 0; S.saved = false; S.reveal = null;
    }
    if (st && st.phase === "reveal") loadReveal(st.round);
    if (st && st.phase === "finished") loadFinale();
    render();
  });
  onValue(gref("wealth", token), (s) => { S.wealth = s.val() || 0; patchWealth(); });

  async function loadReveal(r) { S.reveal = await read("reveal", r); render(); }
  async function loadFinale() { S.finale = await read("finale"); render(); }

  async function join() {
    const players = (await read("players")) || {};
    const taken = new Set(Object.values(players).map((p) => p.ci));
    const free = CHARACTERS.map((_, i) => i).filter((i) => !taken.has(i));
    const ci = free.length ? free[Math.floor(Math.random() * free.length)] : Math.floor(Math.random() * CHARACTERS.length);
    await set(gref("players", token), { uid: user.uid, ci, joinedAt: serverTimestamp() });
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
  function charOf(p) { return p ? CHARACTERS[p.ci] || ["\u{1F3AD}", "Mystery"] : null; }

  function render() {
    clearInterval(S.timer);
    if (!S.me) {
      root.innerHTML = `
        <div class="card center">
          <img class="logo" src="assets/trafigura.svg" alt="Trafigura" />
          <h1>Croatia Quiz</h1>
          <p class="dim">Tap below and the house deals you a character. That's you for the night.</p>
          <button class="big" id="joinBtn">Deal me a character</button>
        </div>`;
      root.querySelector("#joinBtn").onclick = join;
      return;
    }
    const [emoji, name] = charOf(S.me);
    const ph = S.state ? S.state.phase : "lobby";

    if (!S.state || ph === "lobby") {
      root.innerHTML = `
        <div class="card center">
          <img class="logo" src="assets/trafigura.svg" alt="Trafigura" />
          <div class="avatar">${emoji}</div>
          <h1>You are ${name}</h1>
          <p class="dim">Waiting for the host to start. You get ${fmt(RULES.stipend)} every round; minimum stake ${fmt(RULES.minStake)}.</p>
        </div>`;
      return;
    }

    if (ph === "question") {
      const q = QUESTIONS[S.state.round];
      const stake = clampStake(S.pct, S.wealth, RULES.minStake);
      root.innerHTML = `
        <div class="bar">
          <span>${emoji} ${name}</span>
          <span id="wealth">${fmt(S.wealth)}</span>
          <span id="clock" class="clock"></span>
        </div>
        <div class="card">
          <div class="dim">Question ${S.state.round + 1} of ${N_ROUNDS} \u00b7 ${q.tag} \u00b7 ${q.type === "multi" ? "select all that apply" : "pick one"}</div>
          <h2>${q.text}</h2>
          <div id="opts">${q.options.map((o, i) =>
            `<button class="opt ${S.answer.has(i) ? "sel" : ""}" data-i="${i}">${o}</button>`).join("")}
          </div>
          <div class="stakebox">
            <div class="row"><span>Your stake</span><strong id="stake">${fmt(stake)}</strong></div>
            <input id="slider" type="range" min="0" max="100" value="${S.pct}" />
            <div class="row dim"><span>minimum ${fmt(RULES.minStake)}</span><span>all in</span></div>
            <div id="status" class="dim">${statusLine()}</div>
          </div>
        </div>`;
      root.querySelectorAll(".opt").forEach((b) => (b.onclick = () => pickOption(+b.dataset.i, q.type)));
      const slider = root.querySelector("#slider");
      let deb = null;
      slider.oninput = () => {
        S.pct = +slider.value;
        root.querySelector("#stake").textContent = fmt(clampStake(S.pct, S.wealth, RULES.minStake));
        clearTimeout(deb); deb = setTimeout(saveBet, 250);
      };
      S.timer = setInterval(tick, 250); tick();
      return;
    }

    if (ph === "reveal") {
      const q = QUESTIONS[S.state.round];
      const rv = S.reveal;
      const d = rv && rv.deltas ? rv.deltas[token] : null;
      root.innerHTML = `
        <div class="bar"><span>${emoji} ${name}</span><span>${fmt(S.wealth)}</span></div>
        <div class="card">
          <div class="dim">Question ${S.state.round + 1} \u2014 the answer</div>
          <h2>${q.type === "single" ? q.options[+q.correct] : q.correct.split("").map((i) => q.options[+i]).join(" \u00b7 ")}</h2>
          ${rv ? `
            <p>${rv.rolled ? "Nobody had it \u2014 the pot rolls over." :
              `${rv.nRight} right \u00b7 winners paid ${rv.mult.toFixed(2)}\u00d7`}</p>
            <p class="delta ${d >= 0 ? "up" : "down"}">${d == null ? "" : (d >= 0 ? "+" : "\u2212") + fmt(Math.abs(d))}</p>
          ` : `<p class="dim">Settling\u2026</p>`}
          <p class="dim">Watch the big screen \u2014 next question shortly.</p>
        </div>`;
      return;
    }

    if (ph === "finished") {
      const f = S.finale;
      let mine = "";
      if (f && f.board) {
        const idx = f.board.findIndex((r) => r.token === token);
        if (idx >= 0) mine = `<h2>You finished ${idx + 1}${["st","nd","rd"][idx] || "th"} with ${fmt(f.board[idx].w)}</h2>`;
      }
      root.innerHTML = `
        <div class="card center">
          <div class="avatar">${emoji}</div>
          ${mine || "<h2>Full time.</h2>"}
          <p class="dim">Final boards are on the big screen. Thanks for playing.</p>
        </div>`;
      return;
    }
  }

  function statusLine() {
    if (!S.answer.size) return "Pick an answer \u2014 no answer means the minimum stake is lost.";
    return S.saved ? "Locked in \u2014 you can still change it until the clock runs out." : "";
  }
  function patchStatus() { const el = root.querySelector("#status"); if (el) el.textContent = statusLine(); }
  function patchWealth() {
    const el = root.querySelector("#wealth"); if (el) el.textContent = fmt(S.wealth);
    const st = root.querySelector("#stake");
    if (st) st.textContent = fmt(clampStake(S.pct, S.wealth, RULES.minStake));
  }
  function tick() {
    const el = root.querySelector("#clock");
    if (!el || !S.state || !S.state.closesAt) return;
    const left = Math.max(0, S.state.closesAt - serverNow());
    el.textContent = Math.ceil(left / 1000) + "s";
    if (left <= 0) {
      root.querySelectorAll(".opt,#slider").forEach((n) => (n.disabled = true));
      el.textContent = "closed";
    }
  }
}
