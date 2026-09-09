import { gref, onValue, ensureAuth, serverNow, read } from "../fb.js";
import { QUESTIONS, N_ROUNDS } from "../questions.js";
import { RULES, GAME_ID } from "../config.js";
import { CHARACTERS } from "../characters.js";
import { fmt, board } from "../engine.js";
import { botRoster } from "../bots.js";
import { wealthSeries, svgWealthChart, AI_COLORS, KELLY_FORMULA_HTML } from "../finale.js";

const BOTS = Object.fromEntries(botRoster().map((b) => [b.token, b]));

export async function mount(root) {
  await ensureAuth();
  const S = { state: null, players: {}, wealth: {}, betCount: 0, reveal: null, finale: null, timer: null, betsUnsub: null };

  onValue(gref("players"), (s) => { S.players = s.val() || {}; render(); });
  onValue(gref("wealth"), (s) => { S.wealth = s.val() || {}; if (S.state && S.state.phase === "question" && S.state.closesAt && serverNow() < S.state.closesAt - 250 && root.querySelector("#lbList")) renderBoard(S.wealth); });
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
    // no clustering: every loser pays in on their own arrow
    const inRows = mkIn.map((e) => ({ kind: "one", e }));
    const nIn = inRows.length;
    inRows.forEach((r) => { vm = Math.max(vm, r.kind === "one" ? r.e.v : r.grp.v); });
    inRows.forEach((row, i) => {
      const sy = nIn === 1 ? cy : spread(nIn, i);  // lone loser: dead-straight into the pot equator
      const ix = (compact ? 96 : 150) + bowOff(nIn, i);
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
        g += svgIcon(row.e.t, ix, sy, compact ? 32 : 42, i * 70);
        g += `<text class="lbl" style="animation-delay:${(i * 70)}ms" x="${(ix - (compact ? 16 : 22)).toFixed(0)}" y="${(sy + (compact ? 5 : 7)).toFixed(0)}" text-anchor="end" font-size="${fs}" font-weight="700" fill="#0A0ABA">${fmt(row.e.v)}</text>`;
      } else {
        const mem = row.grp.members;
        if (mem.length === 1) {
          g += svgIcon(mem[0], ix, sy, compact ? 32 : 42, i * 70);
        } else {
          const shown = mem.slice(0, 7);
          const step = compact ? 18 : 23, rowStep = compact ? 19 : 24;
          const nRows = Math.ceil(shown.length / 4);
          const perRow = Math.ceil(shown.length / nRows);
          shown.forEach((m, j) => {
            const r = Math.floor(j / perRow);
            const inRow = (r === nRows - 1) ? shown.length - perRow * (nRows - 1) : perRow;
            const c = j - r * perRow;
            const dx = (c - (inRow - 1) / 2) * step;
            const dy = (r - (nRows - 1) / 2) * rowStep;
            g += svgIcon(m, ix + dx, sy + dy, compact ? 22 : 28, i * 70 + j * 40);
          });
        }
        g += `<text class="lbl" style="animation-delay:${(i * 70)}ms" x="${(ix - (mem.length === 1 ? (compact ? 16 : 22) : (compact ? 46 : 58))).toFixed(0)}" y="${(sy + (compact ? 5 : 7)).toFixed(0)}" text-anchor="end" font-size="${fs}" font-weight="700" fill="#0A0ABA">${fmt(row.grp.v)}</text>`;
      }
    });
    const outDelay = nIn * 60 + 700;
    mkOut.forEach((e, i) => {
      const ey2 = mkOut.length === 1 ? cy : spread(mkOut.length, i);  // lone winner: dead-straight out
      const obow = bowOff(mkOut.length, i);
      const a = Math.PI * (-30 + (mkOut.length <= 1 ? 30 : (i / (mkOut.length - 1)) * 60)) / 180;
      const sx = cx + R * Math.cos(a), sy2 = cy + R * Math.sin(a);
      g += `<path class="arrow" pathLength="100" style="animation-delay:${(outDelay + i * 80)}ms" d="M ${sx.toFixed(0)} ${sy2.toFixed(0)} C ${(sx + (compact ? 60 : 150)).toFixed(0)} ${sy2.toFixed(0)}, ${(W * 0.75).toFixed(0)} ${ey2.toFixed(0)}, ${(W - (compact ? 112 : 186) - obow).toFixed(0)} ${ey2.toFixed(0)}" stroke-width="${wOf(e.v)}"/>`;
      g += svgIcon(e.t, W - (compact ? 96 : 150) - obow, ey2, compact ? 32 : 42, outDelay + i * 80);
      g += `<text class="lbl" style="animation-delay:${(outDelay + i * 80)}ms" x="${(W - (compact ? 80 : 128) - obow).toFixed(0)}" y="${(ey2 + (compact ? 5 : 7)).toFixed(0)}" text-anchor="start" font-size="${fs}" font-weight="700" fill="#B4400F">${fmt(e.v)}</text>`;
    });
    const f1 = Math.round(compact ? Math.max(19, R * 0.42) : Math.max(30, R * 0.36));
    const f2 = Math.round(f1 * 0.52);
    return `
    <svg class="flow" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%">
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


  function rowHtml(t, i, w) {
    return `<li data-t="${t}"><span class="lbleft"><span class="lbrank">${i + 1}</span>${iconHtml(t)}</span><span class="lbmoney">${fmt(w)}</span></li>`;
  }
  function boardOrder(wm) { return Object.keys(wm).sort((a, b) => wm[b] - wm[a]); }
  function renderBoard(wm) {
    const el = root.querySelector("#lbList");
    if (!el || !wm) return;
    el.innerHTML = boardOrder(wm).slice(0, 10).map((t, i) => rowHtml(t, i, wm[t])).join("");
  }
  function addBadges(deltas) {
    const el = root.querySelector("#lbList");
    if (!el) return;
    [...el.children].forEach((li, i) => {
      if (li.querySelector(".delta-badge")) return;
      const d = deltas[li.dataset.t];
      if (d == null || Math.abs(d) < 0.5) return;
      li.insertAdjacentHTML("afterbegin",
        `<span class="delta-badge ${d >= 0 ? "pos" : "neg"}" style="animation-delay:${i * 70}ms">${d >= 0 ? "+" : "\u2212"}${fmt(Math.abs(d))}</span>`);
    });
  }
  function flipBoard(wAfter) {
    const el = root.querySelector("#lbList");
    if (!el || !wAfter) return;
    const order = boardOrder(wAfter).slice(0, 10);
    const oldRows = new Map([...el.children].map((li) => [li.dataset.t, li]));
    const oldTops = new Map([...el.children].map((li) => [li.dataset.t, li.offsetTop]));
    const listH = el.offsetHeight;
    for (const [t, li] of oldRows) {
      if (order.includes(t)) continue;
      li.style.position = "absolute"; li.style.top = oldTops.get(t) + "px";
      li.style.left = "0"; li.style.right = "0"; li.style.margin = "0 0 0 auto";
      li.classList.add("leave");
      requestAnimationFrame(() => {
        li.style.transform = `translateY(${Math.max(40, listH - oldTops.get(t))}px)`;
        li.style.opacity = "0";
      });
      setTimeout(() => li.remove(), 950);
      oldRows.delete(t);
    }
    const entrants = [];
    order.forEach((t, i) => {
      let li = oldRows.get(t);
      if (!li) {
        el.insertAdjacentHTML("beforeend", rowHtml(t, i, wAfter[t]));
        li = el.lastElementChild;
        li.classList.add("enter");
        entrants.push(li);
      } else {
        const rankEl = li.querySelector(".lbrank"), monEl = li.querySelector(".lbmoney");
        if (rankEl) rankEl.textContent = String(i + 1);
        if (monEl) monEl.textContent = fmt(wAfter[t]);
      }
      el.appendChild(li);
    });
    [...el.children].forEach((li) => {
      if (li.classList.contains("leave") || li.classList.contains("enter")) return;
      const prev = oldTops.get(li.dataset.t);
      if (prev == null) return;
      const dy = prev - li.offsetTop;
      if (!dy) return;
      li.classList.add("flipset");
      li.style.transform = `translateY(${dy}px)`;
      void li.offsetHeight;
      li.classList.remove("flipset");
      li.style.transform = "";
    });
    setTimeout(() => {
      root.querySelectorAll("#lbList .delta-badge").forEach((b) => b.classList.add("fadeout"));
      setTimeout(() => root.querySelectorAll("#lbList .delta-badge").forEach((b) => b.remove()), 600);
    }, 1600);
    requestAnimationFrame(() => entrants.forEach((li, k) => {
      li.style.transitionDelay = (0.35 + k * 0.12) + "s";
      li.classList.add("enter-in");
      setTimeout(() => { li.classList.remove("enter", "enter-in"); li.style.transitionDelay = ""; }, 1600);
    }));
  }


  function tick() {
    const num = root.querySelector("#clocknum2");
    const fg = root.querySelector("#ringfg2");
    if (!num || !S.state || !S.state.closesAt) return;
    const total = ((S.state && S.state.timerSec) || RULES.timerSec) * 1000;
    const dLeft = Math.max(0, S.state.closesAt - serverNow() - 1000);
    num.textContent = Math.ceil(dLeft / 1000);
    const low = dLeft <= 5000;
    if (fg) {
      fg.style.strokeDashoffset = String(100 * (1 - Math.min(1, dLeft / total)));
      fg.setAttribute("stroke", low ? "#D93636" : "url(#rg2)");
    }
    num.setAttribute("fill", low ? "#D93636" : "#0A0A14");
  }

  function fitQ() {
    // scale the question card contents so the card never exceeds ~the top half,
    // leaving the rest of the column to the pot/clock zone
    const zq = root.querySelector(".zone-q"), inner = root.querySelector("#qinner");
    if (!zq || !inner) return;
    zq.style.height = ""; inner.style.transform = "";
    const pad = zq.offsetHeight - inner.offsetHeight;
    const nat = inner.offsetHeight;
    const avail = Math.round(window.innerHeight * 0.46) - pad;
    const sc = Math.min(1, avail / Math.max(1, nat));
    if (sc < 1) {
      inner.style.transformOrigin = "top center";
      inner.style.transform = `scale(${sc})`;
      zq.style.height = Math.round(nat * sc + pad) + "px";
    }
  }
  window.addEventListener("resize", () => fitQ());

  function buildStage(q, phase, rv) {
    root.innerHTML = `
      <div class="stage">
        <div class="colmid">
        <div class="zone-q qcard">
          <div id="qinner">
          <div class="row spread">
            <span class="qmeta">Question ${S.state.round + 1} / ${N_ROUNDS}</span>
          </div>
          <h1 class="qtext" id="qtext">${q.text}</h1>
          <div id="optbox">${optionRows(q, null)}</div>
          </div>
        </div>
        <div class="zone-c">
          <div id="clockwrap" class="fade show center">
            <svg class="bigring" viewBox="0 0 44 44">
              <defs><linearGradient id="rg2" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#0000FF"/><stop offset=".55" stop-color="#8200DE"/><stop offset="1" stop-color="#FF6432"/>
              </linearGradient></defs>
              <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(10,10,20,.10)" stroke-width="3.4"/>
              <circle id="ringfg2" cx="22" cy="22" r="18" fill="none" stroke="url(#rg2)" stroke-width="3.4"
                pathLength="100" stroke-dasharray="100" stroke-dashoffset="0" stroke-linecap="round"
                transform="rotate(-90 22 22)"/>
              <text id="clocknum2" x="22" y="27.5" text-anchor="middle" font-size="15" font-weight="700" fill="#0A0A14" font-family="Century Gothic,Questrial,Poppins,Arial"></text>
            </svg>
          </div>
          <div id="potwrap" class="fade"></div>
        </div>
        </div>
        <div class="zone-r" id="zoneR"><ol class="board lb biglb" id="lbList"></ol></div>
      </div>`;
    S.stageRound = S.state.round; S.revealApplied = false; S.stagePhase = phase;
    fitQ();
    renderBoard(phase === "reveal" && rv && rv.wealthAfter ? rv.wealthAfter : S.wealth);
    if (phase === "question") { S.timer = setInterval(tick, 250); tick(); }
    else if (phase === "preview") {
      const num = root.querySelector("#clocknum2"), fg = root.querySelector("#ringfg2");
      if (num) num.textContent = (S.state.timerSec || RULES.timerSec);
      if (fg) fg.style.strokeDashoffset = "0";
    }
    else if (rv) applyReveal(rv);
  }

  function deriveFlow(rv) {
    // Rebuild the pot scene for rounds settled before the flow schema existed
    // (no stakes/botStakes in the reveal record). Deltas are enough: a loser
    // paid in -delta; a winner drew +delta, which is stake*(mult-1) exactly.
    const d = rv.deltas || {};
    const toks = Object.keys(d).filter((t) => d[t]);
    if (!toks.length) return null;
    const mult = rv.mult > 1 ? rv.mult : 2;
    const stakes = {};
    for (const t of toks) stakes[t] = d[t] < 0 ? -d[t] : d[t] / (mult - 1);
    const pot = rv.pot != null ? rv.pot : Object.values(d).reduce((s, x) => s + (x < 0 ? -x : 0), 0);
    return Object.assign({}, rv, { stakes, botStakes: rv.botStakes || {}, mult, pot });
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
    fitQ();
    const cw = root.querySelector("#clockwrap"), pw = root.querySelector("#potwrap");
    const num = root.querySelector("#clocknum2"), fg = root.querySelector("#ringfg2");
    if (num) { num.textContent = "0"; num.setAttribute("fill", "#D93636"); }
    if (fg) { fg.style.strokeDashoffset = "100"; fg.setAttribute("stroke", "#D93636"); }
    clearTimeout(S.potTimer);
    S.potTimer = setTimeout(() => {
      if (cw) cw.classList.add("morph");
      if (pw) {
        const rv2 = ((rv.stakes && Object.keys(rv.stakes).length) || (rv.botStakes && Object.keys(rv.botStakes).length))
          ? rv : deriveFlow(rv);
        pw.innerHTML = rv2
          ? potScene(rv2, q, 780, 470, true, S.state.round)
          : `<p class="dim">No money moved this round.</p>`;
        requestAnimationFrame(() => pw.classList.add("show"));
      }
    }, 3000);
    // deltas for everyone (bot deltas derived from stakes + rightness)
    const wAfter = rv.wealthAfter || S.wealth;
    const deltas = Object.assign({}, rv.deltas || {});
    for (const [t, st] of Object.entries(rv.botStakes || {})) {
      const right = rv.aiAnswers && rv.aiAnswers[t] === rv.correct;
      deltas[t] = right && !rv.rolled && rv.mult > 0 ? st * (rv.mult - 1) : -st;
    }
    clearTimeout(S.lbTimer); clearTimeout(S.lbTimer2);
    S.lbTimer = setTimeout(() => addBadges(deltas), 4500);
    S.lbTimer2 = setTimeout(() => flipBoard(wAfter), 5500);
  }

  function joinUrl() {
    return location.origin + location.pathname + location.search + "#join";
  }

  function render() {
    const ph = S.state ? S.state.phase : "lobby";
    if ((!S.state || ph === "lobby") && root.querySelector(".lobbystage")) {
      const el = root.querySelector(".lobbyicons");
      if (el) {
        const humans = Object.entries(S.players).filter(([, p]) => !p.bot);
        el.innerHTML = humans.map(([t], i) =>
          `<span class="joinicon" style="animation-delay:${Math.min(i, 8) * 40}ms">${nameOf(t).split(" ")[0]}</span>`).join("");
      }
      return;
    }
    if ((ph === "question" || ph === "reveal" || ph === "preview") && S.state && S.stageRound === S.state.round && root.querySelector(".stage")) {
      if (ph === "preview") return;
      if (ph === "question") {
        if (S.stagePhase !== "question") { S.stagePhase = "question"; clearInterval(S.timer); S.timer = setInterval(tick, 250); tick(); }
        const el = root.querySelector("#locked"); if (el) el.textContent = lockLine(); return;
      }
      if (ph === "reveal") { if (!S.revealApplied && S.reveal) applyReveal(S.reveal); return; }
    }
    clearInterval(S.timer);
    if (!S.state || ph === "lobby") {
      const humans = Object.entries(S.players).filter(([, p]) => !p.bot);
      root.innerHTML = `
        <div class="lobbystage">
          <div id="qr" class="qr"></div>
          <p class="dim" style="font-size:.8rem;opacity:.5;margin:6px 0 0">game ${GAME_ID}</p>
          <div class="grid lobbyicons">${humans.map(([t], i) =>
            `<span class="joinicon" style="animation-delay:${i * 50}ms">${nameOf(t).split(" ")[0]}</span>`).join("")}
          </div>
        </div>`;
      drawQr(root.querySelector("#qr"), joinUrl(), Math.round(window.innerHeight * 0.62));
      return;
    }

    if (ph === "question" || ph === "preview") {
      buildStage(QUESTIONS[S.state.round], ph);
      return;
    }

    if (ph === "reveal" && S.reveal) {
      buildStage(QUESTIONS[S.state.round], "reveal", S.reveal);
      return;
    }

    if (ph === "finished" && S.finale) {
      const f = S.finale;
      const stage = (S.state && S.state.finaleStage) || 0;
      const pc = (x) => x == null ? "\u00b7" : (x * 100).toFixed(0) + "%";
      if (stage >= 1 && stage <= 6 && S.reveals) {
        const nP = f.nPlayed || N_ROUNDS; const revArr = []; for (let i = 0; i < nP; i++) revArr.push(S.reveals[i]);
        const tokens = Object.keys(S.players);
        const series = wealthSeries(revArr, tokens);
        const style = {};
        tokens.forEach((t) => { style[t] = { color: "rgba(255,255,255,.45)", width: 2 }; });
        for (const t of tokens) if (BOTS[t]) style[t] = { color: "#FFFFFF", width: 3.2, dash: "7 4" };
        if (f.board && f.board.length) {
          const topHuman = f.board.find((r) => { const pl = S.players[r.token]; return !(pl && pl.bot); }) || f.board[0];
          style[topHuman.token] = { color: "#FFD359", width: 5 };
        }
        const icons = {};
        for (const t of tokens) icons[t] = BOTS[t] && BOTS[t].img ? { img: BOTS[t].img } : { emoji: iconOf(t) };
        const chart = svgWealthChart(series, style, 1760, 760, 1.9, icons, true)
          .replace('style="width:100%;height:auto"', 'style="width:100%;height:100%"');
        root.innerHTML = `
          <div class="chartstage">
            <div class="cwrap">${chart}</div>
            <div class="hlstack onchart">
              ${[
                f.bestRound ? `<div class="hlcard"><div class="hlt">Biggest pot</div><div class="hlv">Q${f.bestRound.n + 1} \u00b7 ${fmt(f.bestRound.pot)} at ${f.bestRound.mult.toFixed(2)}\u00d7</div></div>` : null,
                f.biggestWin ? `<div class="hlcard"><div class="hlt">Best single round</div><div class="hlv">${iconHtml(f.biggestWin.t)} ${plainName(f.biggestWin.t)} \u00b7 +${fmt(f.biggestWin.d)} (Q${f.biggestWin.n + 1})</div>${f.biggestWin.b ? `<div class="hlsub">(${plainName(f.biggestWin.b.t)}: +${fmt(f.biggestWin.b.d)}, Q${f.biggestWin.b.n + 1})</div>` : ""}</div>` : null,
                f.biggestLoss ? `<div class="hlcard"><div class="hlt">Worst beat</div><div class="hlv">${iconHtml(f.biggestLoss.t)} ${plainName(f.biggestLoss.t)} \u00b7 \u2212${fmt(Math.abs(f.biggestLoss.d))} (Q${f.biggestLoss.n + 1})</div>${f.biggestLoss.b ? `<div class="hlsub">(${plainName(f.biggestLoss.b.t)}: \u2212${fmt(Math.abs(f.biggestLoss.b.d))}, Q${f.biggestLoss.b.n + 1})</div>` : ""}</div>` : null,
                f.streak ? `<div class="hlcard"><div class="hlt">Longest streak</div><div class="hlv">${iconHtml(f.streak.t)} ${plainName(f.streak.t)} \u00b7 ${f.streak.len} in a row (Q${f.streak.from + 1} to Q${f.streak.to + 1})</div>${f.streak.b ? `<div class="hlsub">(${plainName(f.streak.b.t)}: ${f.streak.b.len} in a row)</div>` : ""}</div>` : null,
                f.bestOdds ? `<div class="hlcard"><div class="hlt">Best odds</div><div class="hlv">${iconHtml(f.bestOdds.t)} ${plainName(f.bestOdds.t)} \u00b7 won at ${f.bestOdds.mult.toFixed(2)}\u00d7 (Q${f.bestOdds.n + 1})</div>${f.bestOdds.b ? `<div class="hlsub">(${plainName(f.bestOdds.b.t)}: ${f.bestOdds.b.mult.toFixed(2)}\u00d7)</div>` : ""}</div>` : null,
              ].filter(Boolean).slice(0, Math.max(0, stage - 1)).join("")}
            </div>
          </div>`;
        return;
      }
      if (stage === 7 && f.sizing) {
        const t = f.thresholds || {};
        const kM = t.kMedian != null ? t.kMedian : t.pMedian;
        const kA = t.kMean;
        const kT = t.kTop10 != null ? t.kTop10 : t.pTop10;
        const cell = (k, label, w) => `<div class="thresh"><div class="mult">${k == null ? ">100%" : pc(k)}</div><p>needs to know ${k == null ? "more than all" : pc(k)} of the answers to beat the ${label} (${fmt(w)})</p></div>`;
        root.innerHTML = `
          <div class="kstage">
            <div class="kcard">
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
      const twoCol = bd.length > 16;
      const acc = {};
      (f.sizing || []).forEach((r) => { acc[r.token] = r.pHat; });
      (f.aiCalib || []).forEach((r) => { if (r.n) acc[r.token] = r.right / r.n; });
      root.innerHTML = `
        <div class="kstage">
        <div class="tcenter">
          <div class="finalboard">
            <h1>Final leaderboard</h1>
            ${(() => {
              const row = (r, i) => `<li><span>${i + 1}. ${iconHtml(r.token)} ${plainName(r.token)}</span><span class="lbacc">${acc[r.token] != null ? pc(acc[r.token]) : "\u00b7"}</span><span>${fmt(r.w)}</span></li>`;
              const rows = bd.map(row);
              if (!twoCol) return `<ol class="board finallb">${rows.join("")}</ol>`;
              const half = Math.ceil(rows.length / 2);
              return `<div class="fbcols"><ol class="board finallb">${rows.slice(0, half).join("")}</ol><ol class="board finallb">${rows.slice(half).join("")}</ol></div>`;
            })()}
          </div>
        </div>
        </div>`;
      return;
    }
    root.innerHTML = `<div class="screen center"><h1>\u2026</h1></div>`;
  }

  function drawQr(el, text, size = 240) {
    if (!el) return;
    const go = () => { el.innerHTML = ""; new window.QRCode(el, { text, width: size, height: size }); };
    if (window.QRCode) return go();
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
    s.onload = go; document.head.appendChild(s);
  }
}
