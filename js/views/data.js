import { ensureAuth, read } from "../fb.js";
import { QUESTIONS } from "../questions.js";
import { CHARACTERS } from "../characters.js";

export async function mount(root) {
  await ensureAuth();
  const [reveal, bets, players] = await Promise.all([read("reveal"), read("bets"), read("players")]);
  const who = (t) => {
    const p = (players || {})[t];
    if (!p) return t;
    if (p.bot) return p.name || t;
    const ch = CHARACTERS.find((c) => c.emoji === p.emoji) || CHARACTERS.find((c) => c.name === p.name);
    return `${p.emoji || ""} ${p.name || (ch ? ch.name : t)}`.trim();
  };
  const label = (o) => {
    if (!o) return "null";
    const out = {};
    for (const [t, v] of Object.entries(o)) out[who(t)] = v;
    return JSON.stringify(out, null, 1);
  };
  const blocks = Object.keys(reveal || {}).sort((a, b) => +a - +b).map((n) => {
    const rv = reveal[n], b = (bets || {})[n] || {};
    const bb = {};
    for (const [t, e] of Object.entries(b)) bb[who(t)] = e;
    return `<h2>Q${+n + 1}: ${QUESTIONS[+n] ? QUESTIONS[+n].text : ""}</h2>
      <pre>correct=${rv.correct}  mult=${rv.mult}  pot=${rv.pot}  rolled=${!!rv.rolled}
stakes: ${label(rv.stakes)}
answers: ${label(rv.answers)}
deltas: ${label(rv.deltas)}
raw bets (with ts): ${JSON.stringify(bb, null, 1)}</pre>`;
  });
  root.innerHTML = `<div class="card"><h1>Round data</h1>
    <p><button id="dl" class="btn">Download everything (JSON)</button></p>
    ${blocks.join("") || "<p>No settled rounds.</p>"}</div>`;
  root.querySelector("#dl").onclick = () => {
    const payload = { exportedAt: new Date().toISOString(), questions: QUESTIONS, players: players || {}, reveal: reveal || {}, bets: bets || {} };
    const blob = new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "croatiaquiz-results.json";
    document.body.appendChild(a); a.click(); a.remove();
  };
}
