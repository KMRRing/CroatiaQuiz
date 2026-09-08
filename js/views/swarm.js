// Test harness: #swarm?n=25 spawns n fake players that join, answer and bet
// on random timers. Run it in one tab, the big screen in another, host in a third.
import { ensureAuth, gref, onValue, set, serverTimestamp, read, serverNow } from "../fb.js";
import { QUESTIONS } from "../questions.js";
import { CHARACTERS } from "../characters.js";

export async function mount(root) {
  const user = await ensureAuth();
  const n = Math.min(40, parseInt((location.hash.split("?")[1] || "").replace("n=", "")) || 25);
  const agents = Array.from({ length: n }, (_, i) => ({
    token: "sw_" + i + "_" + Math.random().toString(36).slice(2, 6),
    status: "joining", betRound: -1,
  }));
  root.innerHTML = `<div class="card"><h1>Swarm \u00b7 ${n} fake players</h1><pre class="log" id="out"></pre></div>`;
  const out = () => { root.querySelector("#out").textContent = agents.map((a) => a.token + "  " + a.status).join("\n"); };

  const players = (await read("players")) || {};
  const taken = new Set(Object.values(players).map((p) => p.ci));
  for (const a of agents) {
    let ci = Math.floor(Math.random() * CHARACTERS.length), guard = 0;
    while (taken.has(ci) && guard++ < 60) ci = Math.floor(Math.random() * CHARACTERS.length);
    taken.add(ci);
    await set(gref("players", a.token), { uid: user.uid, ci, joinedAt: serverTimestamp() });
    a.status = "joined"; out();
  }

  onValue(gref("state"), (s) => {
    const st = s.val();
    if (!st || st.phase !== "question") return;
    const q = QUESTIONS[st.round];
    for (const a of agents) {
      if (a.betRound === st.round) continue;
      a.betRound = st.round;
      const delay = 500 + Math.random() * Math.max(1000, st.closesAt - serverNow() - 4000);
      setTimeout(() => {
        let answer;
        if (q.type === "single") answer = String(Math.floor(Math.random() * q.options.length));
        else {
          const picks = [];
          for (let i = 0; i < q.options.length; i++) if (Math.random() < 0.5) picks.push(i);
          if (!picks.length) picks.push(0);
          answer = picks.join("");
        }
        const pct = Math.round(10 + Math.random() * 90);
        set(gref("bets", st.round, a.token), { answer, pct, at: serverTimestamp() });
        a.status = `Q${st.round + 1}: ${answer} @ ${pct}%`; out();
      }, delay);
    }
  });
}
