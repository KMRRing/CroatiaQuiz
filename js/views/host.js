import { ensureAuth, gref, onValue, get, update, set, serverNow, serverTimestamp, read } from "../fb.js";
import { QUESTIONS, N_ROUNDS } from "../questions.js";
import { RULES } from "../config.js";
import { CHARACTERS } from "../characters.js";
import { settle, clampStake, fmt, board } from "../engine.js";
import { sizingReport, requiredAccuracy } from "../finale.js";
import { botRoster, botConf } from "../bots.js";

const ROSTER = botRoster();
const BOTS = Object.fromEntries(ROSTER.map((b) => [b.token, b]));

export async function mount(root) {
  const user = await ensureAuth();
  const S = { meta: null, state: null, players: {}, wealth: {}, betCount: 0, closing: false, closeTimer: null, log: [] };

  onValue(gref("meta"), (s) => { S.meta = s.val(); render(); });
  onValue(gref("players"), (s) => { S.players = s.val() || {}; render(); });
  onValue(gref("wealth"), (s) => { S.wealth = s.val() || {}; });
  onValue(gref("state"), (s) => {
    S.state = s.val();
    armAutoClose();
    render();
  });

  const isHost = () => S.meta && S.meta.hostUid === user.uid;
  const log = (m) => { S.log.unshift(new Date().toLocaleTimeString() + "  " + m); S.log = S.log.slice(0, 12); render(); };

  async function claim() {
    const cur = await read("meta");
    if (cur && cur.hostUid && cur.hostUid !== user.uid) return log("Already hosted by another device.");
    await update(gref(), { meta: { hostUid: user.uid, createdAt: serverTimestamp(), rules: RULES } });
    log("You are the host on this device. Keep this tab open.");
  }

  async function openLobby() {
    const updates = { state: { phase: "lobby", round: -1, rollover: 0, closesAt: 0 } };
    for (const b of ROSTER) {
      updates["players/" + b.token] = { uid: user.uid, bot: true, name: b.name, emoji: b.emoji, joinedAt: serverTimestamp() };
      updates["wealth/" + b.token] = 0;
    }
    await update(gref(), updates);
    log("Lobby open \u2014 QR is live on the big screen.");
  }

  async function startRound(n) {
    const players = (await read("players")) || {};
    const wealth = (await read("wealth")) || {};
    const updates = {};
    for (const t of Object.keys(players)) updates["wealth/" + t] = (wealth[t] || 0) + RULES.stipend;
    updates["state"] = { phase: "question", round: n, rollover: (S.state && S.state.rollover) || 0, closesAt: serverNow() + RULES.timerSec * 1000 };
    await update(gref(), updates);
    log(`Question ${n + 1} open \u2014 ${RULES.timerSec}s.`);
  }

  function armAutoClose() {
    clearTimeout(S.closeTimer);
    if (S.state && S.state.phase === "question" && isHost()) {
      const wait = Math.max(0, S.state.closesAt - serverNow()) + 900;
      S.closeTimer = setTimeout(() => closeAndSettle(), wait);
    }
  }

  async function closeAndSettle() {
    if (S.closing || !S.state || S.state.phase !== "question") return;
    S.closing = true;
    try {
      const n = S.state.round;
      const q = QUESTIONS[n];
      const [bets, wealth, players] = await Promise.all([read("bets", n), read("wealth"), read("players")]);
      const entries = {};
      for (const [t, p] of Object.entries(players || {})) {
        const w = (wealth && wealth[t]) || 0;
        if (p.bot) {
          const bot = BOTS[t];
          const d = bot ? bot.decide(q, n, w) : { answer: null, frac: 0, conf: null };
          entries[t] = { answer: d.answer, stake: Math.min(w, Math.max(Math.min(RULES.minStake, w), d.frac * w)) };
        } else {
          const b = bets && bets[t];
          const late = b && b.at && S.state.closesAt && b.at > S.state.closesAt + 1500;
          if (b && b.answer != null && !late) entries[t] = { answer: b.answer, stake: clampStake(b.pct || 0, w, RULES.minStake) };
          else entries[t] = { answer: null, stake: Math.min(RULES.minStake, w) };
        }
      }
      const r = settle({ entries, bonus: RULES.bonus, rollover: (S.state.rollover || 0), correct: q.correct });
      const updates = {};
      let gain = null, loss = null;
      const deltas = {}, aiAnswers = {}, stakes = {};
      for (const [t, e] of Object.entries(entries)) {
        updates["wealth/" + t] = ((wealth && wealth[t]) || 0) + r.deltas[t];
        if (players[t].bot) { aiAnswers[t] = e.answer == null ? "" : e.answer; continue; }
        deltas[t] = r.deltas[t]; stakes[t] = e.stake;
        if (!gain || r.deltas[t] > r.deltas[gain]) gain = t;
        if (!loss || r.deltas[t] < r.deltas[loss]) loss = t;
      }
      const wealthAfter = {};
      for (const t of Object.keys(entries)) wealthAfter[t] = ((wealth && wealth[t]) || 0) + r.deltas[t];
      updates["reveal/" + n] = {
        correct: q.correct, W: r.W, L: r.L, pot: r.pot, mult: r.mult, rolled: r.rolled, wealthAfter,
        nRight: Object.values(r.right).filter(Boolean).length,
        deltas, stakes, aiAnswers,
        top: gain ? { gainT: gain, gainD: r.deltas[gain], lossT: loss, lossD: r.deltas[loss] } : null,
      };
      updates["state"] = { phase: "reveal", round: n, rollover: r.newRollover, closesAt: 0 };
      await update(gref(), updates);
      log(`Q${n + 1} settled: ${r.rolled ? "rollover " + fmt(r.pot) : r.mult.toFixed(2) + "\u00d7, " + fmt(r.pot) + " moved"}.`);
    } catch (e) {
      log("Settle failed: " + e.message);
    } finally { S.closing = false; }
  }

  async function finish() {
    const [wealth, players] = await Promise.all([read("wealth"), read("players")]);
    const reveals = [];
    for (let n = 0; n < N_ROUNDS; n++) reveals.push(await read("reveal", n));
    const bd = board(wealth || {}, players || {}).map((r) => ({ token: r.token, w: r.w }));
    const calib = {};
    let bestRound = null, biggestWin = null, biggestLoss = null;
    reveals.forEach((rv, n) => {
      if (!rv) return;
      if (!bestRound || rv.pot > bestRound.pot) bestRound = { n, pot: rv.pot, mult: rv.mult };
      for (const [t, d] of Object.entries(rv.deltas || {})) {
        if (!biggestWin || d > biggestWin.d) biggestWin = { t, d, n };
        if (!biggestLoss || d < biggestLoss.d) biggestLoss = { t, d, n };
      }
      for (const [t, a] of Object.entries(rv.aiAnswers || {})) {
        const c = botConf(t, n);
        if (c == null || a === "") continue;
        const right = a === rv.correct ? 1 : 0;
        calib[t] = calib[t] || { token: t, n: 0, right: 0, sq: 0 };
        calib[t].n++; calib[t].right += right; calib[t].sq += (c - right) * (c - right);
      }
    });
    const aiCalib = Object.values(calib).map((r) => ({ token: r.token, n: r.n, right: r.right, brier: r.sq / r.n }))
      .sort((a, b) => a.brier - b.brier);
    const humanTokens = Object.entries(players || {}).filter(([, p]) => !p.bot).map(([t]) => t);
    const sizing = sizingReport(reveals, humanTokens);
    const P = bd.length;
    const medianW = bd.length ? bd[Math.floor(P / 2)].w : 0;
    const topIdx = Math.max(0, Math.ceil(P * 0.10) - 1);
    const top10W = bd.length ? bd[topIdx].w : 0;
    const thresholds = {
      medianW, top10W,
      pMedian: requiredAccuracy(reveals, medianW),
      pTop10: requiredAccuracy(reveals, top10W),
      Obar: sizing.Obar,
    };
    await update(gref(), {
      finale: { board: bd, aiCalib, bestRound, biggestWin, biggestLoss, sizing: sizing.rows, thresholds },
      state: { phase: "finished", round: N_ROUNDS - 1, rollover: 0, closesAt: 0, finaleStage: 0 },
    });
    log("Finale written. Full time.");
  }

  async function resetGame() {
    if (!confirm("Wipe the whole game (players, wealth, bets, reveals)?")) return;
    await set(gref(), { meta: { hostUid: user.uid, createdAt: serverTimestamp(), rules: RULES } });
    log("Game wiped. Open the lobby to start again.");
  }

  function render() {
    const ph = S.state ? S.state.phase : "(no game)";
    const n = S.state ? S.state.round : -1;
    const humans = Object.entries(S.players).filter(([, p]) => !p.bot);
    const canStartNext = isHost() && S.state && (ph === "lobby" || ph === "reveal") && n + 1 < N_ROUNDS;
    root.innerHTML = `
      <div class="card">
        <h1>Host console</h1>
        <p class="dim">Phase: <strong>${ph}</strong> \u00b7 round ${n + 1}/${N_ROUNDS} \u00b7 ${humans.length} humans \u00b7 rollover ${fmt((S.state && S.state.rollover) || 0)}</p>
        ${!isHost() ? `<button class="big" id="claim">Claim host on this device</button>` : `
          <div class="btnrow">
            <button id="lobby">Open lobby</button>
            <button id="next" ${canStartNext ? "" : "disabled"}>Start question ${n + 2}</button>
            <button id="close" ${ph === "question" ? "" : "disabled"}>Close betting now</button>
            <button id="finish" ${ph === "reveal" && n + 1 >= N_ROUNDS ? "" : "disabled"}>Finish \u2192 finale</button>
            <button id="reset" class="danger">Reset game</button>
          </div>
          <p class="dim">Rounds auto-close and settle when the clock runs out \u2014 keep this tab open and awake.</p>`}
        <h2>Log</h2>
        <pre class="log">${S.log.join("\n")}</pre>
      </div>`;
    const q = (id) => root.querySelector(id);
    if (q("#claim")) q("#claim").onclick = claim;
    if (q("#lobby")) q("#lobby").onclick = openLobby;
    if (q("#next")) q("#next").onclick = () => startRound(n + 1);
    if (q("#close")) q("#close").onclick = closeAndSettle;
    if (q("#finish")) q("#finish").onclick = finish;
    if (q("#stage")) q("#stage").onclick = () => {
      const next = (((S.state && S.state.finaleStage) || 0) + 1) % 4;
      update(gref(), { "state/finaleStage": next });
      log("Finale screen " + (next + 1) + " of 4.");
    };
    if (q("#reset")) q("#reset").onclick = resetGame;
  }
}
