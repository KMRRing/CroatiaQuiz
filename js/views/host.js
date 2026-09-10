import { ensureAuth, gref, onValue, get, update, set, serverNow, serverTimestamp, read } from "../fb.js";
import { QUESTIONS, N_ROUNDS } from "../questions.js";
import { RULES, BUILD, TEST_MODE, GAME_ID } from "../config.js";
import { CHARACTERS } from "../characters.js";

function randomWrong(q) {
  for (let i = 0; i < 40; i++) { const a = randomAnswerFor(q); if (a !== q.correct) return a; }
  return q.correct === "0" ? "1" : "0";
}

function randomAnswerFor(q) {
  if (q.type === "single") return String(Math.floor(Math.random() * q.options.length));
  const picks = [];
  for (let i = 0; i < q.options.length; i++) if (Math.random() < 0.5) picks.push(i);
  if (!picks.length) picks.push(Math.floor(Math.random() * q.options.length));
  return picks.join("");
}
import { settle, clampStake, fmt, board } from "../engine.js";
import { sizingReport, requiredKnowledge } from "../finale.js";
import { botRoster, botConf } from "../bots.js";

const ROSTER = botRoster();
const BOTS = Object.fromEntries(ROSTER.map((b) => [b.token, b]));

export async function mount(root) {
  const user = await ensureAuth();
  const S = { meta: null, state: null, timerSec: RULES.timerSec, players: {}, wealth: {}, betCount: 0, closing: false, closeTimer: null, log: [] };

  onValue(gref("meta"), (s) => { S.meta = s.val(); S.claimTries = 0; render(); });
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
    if (cur && cur.hostUid && cur.hostUid !== user.uid) {
      S.claimTries = (S.claimTries || 0) + 1;
      if (S.claimTries < 3) {
        return log(`Hosted on another device. Press claim ${3 - S.claimTries} more time${S.claimTries === 2 ? "" : "s"} to take over.`);
      }
      S.claimTries = 0;
      await update(gref(), { meta: { hostUid: user.uid, createdAt: serverTimestamp(), rules: RULES, takeover: true } });
      return log("Took over hosting on this device. The other device has been demoted.");
    }
    await update(gref(), { meta: { hostUid: user.uid, createdAt: serverTimestamp(), rules: RULES } });
    log("You are the host on this device. Keep this tab open.");
  }

  async function openLobby() {
    const updates = { state: { phase: "lobby", round: -1, rollover: 0, closesAt: 0 } };
    for (const b of ROSTER) {
      updates["players/" + b.token] = { uid: user.uid, bot: true, name: b.name, emoji: b.emoji, joinedAt: serverTimestamp() };
      updates["wealth/" + b.token] = RULES.start;
    }
    if (TEST_MODE) {
      const idx = [...Array(CHARACTERS.length).keys()];
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      for (let i = 0; i < 20; i++) {
        updates["players/tb_" + i] = { uid: user.uid, bot: true, test: true, ci: idx[i % idx.length], joinedAt: serverTimestamp() };
        updates["wealth/tb_" + i] = RULES.start;
      }
    }
    await update(gref(), updates);
    log("Lobby open. QR is live on the big screen.");
  }

  async function showQuestion(n) {
    const players = (await read("players")) || {};
    const wealth = (await read("wealth")) || {};
    const updates = {};
    for (const t of Object.keys(players)) updates["wealth/" + t] = (wealth[t] != null ? wealth[t] : RULES.start) + RULES.stipend;
    updates["state"] = { phase: "preview", round: n, rollover: (S.state && S.state.rollover) || 0, closesAt: 0, timerSec: S.timerSec };
    await update(gref(), updates);
    log(`Question ${n + 1} on screen. Read it out, then start the timer.`);
  }

  async function startQuestion() {
    if (!S.state || S.state.phase !== "preview") return;
    await update(gref(), { "state/phase": "question", "state/closesAt": serverNow() + (S.timerSec + 1) * 1000, "state/timerSec": S.timerSec });
    log(`Timer running: ${S.timerSec}s.`);
  }

  function nextAction() {
    const ph = S.state ? S.state.phase : null;
    const n = S.state ? S.state.round : -1;
    if (ph === "preview") return startQuestion();
    if ((ph === "lobby" || ph === "reveal") && n + 1 < N_ROUNDS) return showQuestion(n + 1);
  }

  function armAutoClose() {
    clearTimeout(S.closeTimer);
    if (S.state && S.state.phase === "question" && isHost()) {
      const wait = Math.max(0, S.state.closesAt - serverNow()) + 900;
      S.closeTimer = setTimeout(() => closeAndSettle(), wait);
    }
  }

  async function closeAndSettle() {
    if (!isHost()) return;
    if (S.closing || !S.state || S.state.phase !== "question") return;
    S.closing = true;
    try {
      const n = S.state.round;
      const q = QUESTIONS[n];
      const [bets, wealth, players, pastReveals] = await Promise.all([read("bets", n), read("wealth"), read("players"), read("reveal")]);
      // history the AI sizing rules may draw on: pot, carry-in, how many were right, and their own record
      const past = [];
      for (let i = 0; i < n; i++) { const rv = (pastReveals || {})[i]; if (!rv) break; past.push(rv); }
      const nPlayers = Object.keys(players || {}).length;
      const histFor = (t) => past.map((rv, i) => ({
        pot: rv.pot, carry: i > 0 && past[i - 1].rolled ? past[i - 1].pot : 0,
        correct: rv.nRight || 0, myConf: botConf(t, i) || 0,
        myCorrect: ((rv.aiAnswers || {})[t] || "") === rv.correct,
      }));
      const leaderFor = (t) => Object.entries(wealth || {}).reduce((m, [k, v]) => (k === t ? m : Math.max(m, v || 0)), 0);
      const entries = {};
      for (const [t, p] of Object.entries(players || {})) {
        const w = (wealth && wealth[t]) || 0;
        if (p.bot) {
          const bot = BOTS[t];
          let d, stake;
          if (bot) {
            d = bot.decide(q, n, w, { players: nPlayers, round: n + 1, carry: S.state.rollover || 0,
                                      leader: leaderFor(t), history: histFor(t) });
            stake = Math.min(w, Math.max(Math.min(RULES.minStake, w), Math.round(d.stake || 0)));
          } else if (p.test) {
            if (TEST_MODE && n === 0) d = { answer: t === "tb_0" ? randomWrong(q) : q.correct };
            else if (TEST_MODE && n === 1) d = { answer: t === "tb_0" ? q.correct : randomWrong(q) };
            else d = { answer: Math.random() < 0.5 ? q.correct : randomAnswerFor(q) };
            stake = Math.min(w, RULES.minStake + Math.random() * Math.max(0, w - RULES.minStake));
          } else {
            d = { answer: null };
            stake = Math.min(RULES.minStake, w);
          }
          entries[t] = { answer: d.answer, stake };
        } else {
          const b = bets && bets[t];
          const late = b && b.at && S.state.closesAt && b.at > S.state.closesAt + 1500;
          if (b && b.answer != null && !late) entries[t] = { answer: b.answer, stake: clampStake(b.pct || 0, w, RULES.minStake) };
          else entries[t] = { answer: null, stake: Math.min(RULES.minStake, w) };
        }
      }
      const r = settle({ entries, bonus: RULES.bonus, rollover: (S.state.rollover || 0), correct: q.correct });
      const optCount = new Array(q.options.length).fill(0);
      let nAnswered = 0;
      for (const e of Object.values(entries)) {
        if (e.answer == null) continue;
        nAnswered++;
        for (const ch of String(e.answer)) { const i = +ch; if (i >= 0 && i < optCount.length) optCount[i]++; }
      }
      const optShare = optCount.map((c) => (nAnswered ? c / nAnswered : 0));
      const updates = {};
      let gain = null, loss = null;
      const deltas = {}, aiAnswers = {}, stakes = {}, botStakes = {}, answers = {};
      for (const [t, e] of Object.entries(entries)) {
        updates["wealth/" + t] = ((wealth && wealth[t]) || 0) + r.deltas[t];
        if (players[t].bot) { aiAnswers[t] = e.answer == null ? "" : e.answer; botStakes[t] = e.stake; continue; }
        deltas[t] = r.deltas[t]; stakes[t] = e.stake; answers[t] = e.answer == null ? "" : e.answer;
        if (!gain || r.deltas[t] > r.deltas[gain]) gain = t;
        if (!loss || r.deltas[t] < r.deltas[loss]) loss = t;
      }
      const wealthAfter = {};
      for (const t of Object.keys(entries)) wealthAfter[t] = ((wealth && wealth[t]) || 0) + r.deltas[t];
      updates["reveal/" + n] = {
        correct: q.correct, W: r.W, L: r.L, pot: r.pot, mult: r.mult, rolled: r.rolled, wealthAfter,
        nRight: Object.values(r.right).filter(Boolean).length,
        deltas, stakes, aiAnswers, botStakes, answers, optShare, nAnswered,
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
    clearTimeout(S.closeTimer);
    const [wealth, players] = await Promise.all([read("wealth"), read("players")]);
    const all = (await read("reveal")) || {};
    const reveals = [];
    for (let n = 0; n < N_ROUNDS; n++) { if (all[n] == null) break; reveals.push(all[n]); }
    const bd = board(wealth || {}, players || {}).map((r) => ({ token: r.token, w: r.w }));
    const calib = {};
    const isBot = (t) => !!((players || {})[t] && players[t].bot);
    let bestRound = null;
    const win = { h: null, b: null }, loss = { h: null, b: null };
    reveals.forEach((rv, n) => {
      if (!rv) return;
      if (!bestRound || rv.pot > bestRound.pot) bestRound = { n, pot: rv.pot, mult: rv.mult };
      for (const [t, d] of Object.entries(rv.deltas || {})) {
        const k = isBot(t) ? "b" : "h";
        if (!win[k] || d > win[k].d) win[k] = { t, d, n };
        if (!loss[k] || d < loss[k].d) loss[k] = { t, d, n };
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
    const allTokens = bd.map((r) => r.token);
    const rightAt = (rv, t) => (rv.answers && rv.answers[t] === rv.correct) || (rv.aiAnswers && rv.aiAnswers[t] === rv.correct);
    const cur = {}; const stk = { h: null, b: null };
    reveals.forEach((rv, n) => {
      if (!rv) return;
      for (const t of allTokens) {
        cur[t] = rightAt(rv, t) ? (cur[t] || 0) + 1 : 0;
        const k = isBot(t) ? "b" : "h";
        if (cur[t] >= 2 && (!stk[k] || cur[t] > stk[k].len)) stk[k] = { t, len: cur[t], to: n, from: n - cur[t] + 1 };
      }
    });
    const odds = { h: null, b: null };
    reveals.forEach((rv, n) => {
      if (!rv || rv.rolled || !(rv.mult > 1.001)) return;
      const cand = { h: null, b: null }, ps = { h: -1, b: -1 };
      for (const [t, d] of Object.entries(rv.deltas || {})) {
        if (d <= 0) continue;
        const k = isBot(t) ? "b" : "h";
        const st = (rv.stakes && rv.stakes[t]) || (rv.botStakes && rv.botStakes[t]) || 0;
        if (st > ps[k]) { ps[k] = st; cand[k] = t; }
      }
      for (const k of ["h", "b"]) {
        if (cand[k] && (!odds[k] || rv.mult > odds[k].mult)) odds[k] = { t: cand[k], mult: rv.mult, n };
      }
    });
    const headline = (H, B, better) => {
      if (!H) return B;
      const out = { ...H };
      if (B && better(B, H)) out.b = B;
      return out;
    };
    const biggestWin = headline(win.h, win.b, (b2, h2) => b2.d > h2.d);
    const biggestLoss = headline(loss.h, loss.b, (b2, h2) => b2.d < h2.d);
    const bestStreak = headline(stk.h, stk.b, (b2, h2) => b2.len > h2.len);
    const bestOdds = headline(odds.h, odds.b, (b2, h2) => b2.mult > h2.mult);
    const humanTokens = Object.entries(players || {}).filter(([, p]) => !p.bot).map(([t]) => t);
    const sizing = sizingReport(reveals, humanTokens);
    const P = bd.length;
    const medianW = bd.length ? bd[Math.floor(P / 2)].w : 0;
    const meanW = bd.length ? bd.reduce((a, r) => a + r.w, 0) / P : 0;
    const topIdx = Math.max(0, Math.ceil(P * 0.10) - 1);
    const top10W = bd.length ? bd[topIdx].w : 0;
    const thresholds = {
      medianW, top10W,
      kMedian: requiredKnowledge(reveals, medianW),
      kMean: requiredKnowledge(reveals, meanW), meanW,
      kTop10: requiredKnowledge(reveals, top10W),
      Obar: sizing.Obar,
    };
    await update(gref(), {
      finale: { board: bd, aiCalib, bestRound, biggestWin, biggestLoss, streak: bestStreak, bestOdds, sizing: sizing.rows, thresholds, nPlayed: reveals.length },
      state: { phase: "finished", round: N_ROUNDS - 1, rollover: 0, closesAt: 0, finaleStage: 0 },
    });
    log("Finale written. Full time.");
  }

  async function giveUpHost() {
    if (!confirm("Release hosting on this device? Rounds pause until another device claims host.")) return;
    clearTimeout(S.closeTimer);
    await set(gref("meta"), null);
    log("Host released. Any device can now claim.");
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
    if (!S.keysBound) {
      S.keysBound = true;
      window.addEventListener("keydown", (e) => {
        if (e.code !== "Space" || e.repeat) return;
        const t = e.target;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
        e.preventDefault();
        if (isHost()) nextAction();
      });
    }
    root.innerHTML = `
      <div class="card">
        <h1>Host console</h1><p class="dim" style="font-size:.78rem;margin:-6px 0 10px">game ${GAME_ID} \u00b7 ${BUILD}</p>
        <p class="dim">Phase: <strong>${ph}</strong> \u00b7 round ${n + 1}/${N_ROUNDS} \u00b7 ${humans.length} humans${(S.state && S.state.tut) ? " \u00b7 tutorial step " + S.state.tut + "/6 on screen" : ""} \u00b7 rollover ${fmt((S.state && S.state.rollover) || 0)} \u00b7 build ${BUILD}</p>
        ${!isHost() ? `<button class="big" id="claim">Claim host on this device</button>` : `
          <div class="btnrow">
            <button id="show" ${canStartNext ? "" : "disabled"}>Show question ${n + 2}</button>
            <button id="start" ${ph === "preview" ? "" : "disabled"}>Start timer (${S.timerSec}s)</button>
            <button id="close" ${ph === "question" ? "" : "disabled"}>Close betting now</button>
          </div>
          <div class="btnrow">
            <button id="tminus10">\u221210s</button>
            <button id="tminus">\u22121s</button>
            <button id="tplus">+1s</button>
            <button id="tplus10">+10s</button>
          </div>
          <div class="btnrow">
            <button id="lobby">Open lobby</button>
            <button id="tut" ${ph === "lobby" ? "" : "disabled"}>Tutorial: ${((S.state && S.state.tut) || 0) >= 6 ? "end, back to QR" : "show step " + (((S.state && S.state.tut) || 0) + 1) + "/6"}</button>
            <button id="stage" ${ph === "finished" ? "" : "disabled"}>Finale: next screen (now ${(((S.state && S.state.finaleStage) || 0) + 1)}/8)</button>
            <button id="finish" class="${ph === "reveal" && n + 1 >= N_ROUNDS ? "" : "danger"}">Finish \u2192 finale${ph === "reveal" && n + 1 >= N_ROUNDS ? "" : " (early)"}</button>
          </div>
          <div class="btnrow">
            <button id="release" class="danger">Give up host</button>
            <button id="reset" class="danger">Reset game</button>
          </div>
          <p class="dim">Rounds auto-close and settle when the clock runs out. Keep this tab open and awake.</p>`}
        ${(ph === "preview" || ph === "question" || ph === "reveal") && S.state && S.state.round >= 0 ? (() => {
          const q2 = QUESTIONS[S.state.round];
          return `<h2>On screen: Q${S.state.round + 1}</h2>
            <div class="hostq">
              <p class="hqt">${q2.text}</p>
              ${q2.options.map((o, i) => `<div class="hopt${ph === "reveal" && q2.correct.includes(String(i)) ? " hopt-c" : ""}">${String.fromCharCode(65 + i)}. ${o}</div>`).join("")}
            </div>`;
        })() : ""}
        ${isHost() ? `<button id="nextbig" class="nextbig" ${ph === "preview" || ((ph === "lobby" || ph === "reveal") && n + 1 < N_ROUNDS) ? "" : "disabled"}>${
          ph === "preview" ? `Start timer (${S.timerSec}s)` :
          ((ph === "lobby" || ph === "reveal") && n + 1 < N_ROUNDS) ? `Show question ${n + 2}` :
          ph === "question" ? "Round running\u2026" : "\u2026"
        }</button>` : ""}
        <h2>Log</h2>
        <pre class="log">${S.log.join("\n")}</pre>
      </div>`;
    const q = (id) => root.querySelector(id);
    if (q("#claim")) q("#claim").onclick = claim;
    if (q("#lobby")) q("#lobby").onclick = openLobby;
    if (q("#tut")) q("#tut").onclick = async () => {
      const cur = (S.state && S.state.tut) || 0;
      const nx = cur >= 6 ? 0 : cur + 1;
      await update(gref(), { "state/tut": nx });
      log(nx ? `Tutorial step ${nx}/6 on the big screen.` : "Tutorial ended. QR is back on screen.");
    };
    if (q("#show")) q("#show").onclick = () => showQuestion(n + 1);
    if (q("#nextbig")) q("#nextbig").onclick = nextAction;
    if (q("#start")) q("#start").onclick = startQuestion;
    if (q("#tminus")) q("#tminus").onclick = () => { S.timerSec = Math.max(5, S.timerSec - 1); render(); };
    if (q("#tminus10")) q("#tminus10").onclick = () => { S.timerSec = S.timerSec < 15 ? 5 : S.timerSec - 10; render(); };
    if (q("#tplus10")) q("#tplus10").onclick = () => { S.timerSec = Math.min(180, S.timerSec + 10); render(); };
    if (q("#tplus")) q("#tplus").onclick = () => { S.timerSec = Math.min(180, S.timerSec + 1); render(); };
    if (q("#close")) q("#close").onclick = closeAndSettle;
    if (q("#finish")) q("#finish").onclick = () => {
      const finalDone = S.state && S.state.phase === "reveal" && S.state.round + 1 >= N_ROUNDS;
      if (!finalDone && !confirm("End the game now, before the last round is settled?")) return;
      finish();
    };
    if (q("#stage")) q("#stage").onclick = () => {
      const next = (((S.state && S.state.finaleStage) || 0) + 1) % 8;
      update(gref(), { "state/finaleStage": next });
      log("Finale screen " + (next + 1) + " of 8.");
    };
    if (q("#release")) q("#release").onclick = giveUpHost;
    if (q("#reset")) q("#reset").onclick = resetGame;
  }
}
