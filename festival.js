"use strict";
/* Zik Hunter — le Festival (prototype, admins only): a new Bataille de cartes. Three stages are drawn, each judged on a
   stat (Tempo, Endurance, Hype, Puissance) and with its own rule. Four turns; turn N gives N energy; each card costs
   energy by its rarity. Both sides place their cards at the same time, then everything is revealed. Win 2 stages of 3.
   The strategy: where to play (a card is strong in one stat and weak in another), when (cheap cards early, stars at the
   end), and reading what the other side did. Here against a training bot, entirely in the browser. */
const FV_STAT = { flow: ["Tempo", "⚡"], endu: ["Endurance", "⏱"], hype: ["Hype", "🔥"], pw: ["Puissance", "💥"] };
const FV_COST = [1, 1, 2, 2, 3, 4];                 // by rarity: Commune … Légendaire
const FV_MAX = 4;                                    // cards per side on a stage
const FV_STAGES = [
  { k: "club", n: "Le Club", s: "flow", d: "Pas de règle : le meilleur son gagne.", c: "#7c5cff" },
  { k: "stade", n: "Le Stade", s: "hype", d: "La foule : chaque carte y prend +1 par carte de son camp déjà sur scène.", c: "#ff5f9e" },
  { k: "acou", n: "La Salle acoustique", s: "endu", d: "Intimiste : 2 cartes maximum par camp.", c: "#e7b14a", max: 2 },
  { k: "plein", n: "Le Festival en plein air", s: "pw", d: "Les cartes jouées au dernier tour y prennent +3.", c: "#57e389" },
  { k: "cave", n: "La Cave", s: "flow", d: "Underground : seules les cartes à 1 ou 2 énergie peuvent y jouer.", c: "#c27b4a", cheap: true },
  { k: "roof", n: "Le Rooftop", s: "hype", d: "Les cartes Shiny et les notes 9 ou 10 y prennent +4.", c: "#59b8ff" },
  { k: "after", n: "L'Afterparty", s: "endu", d: "N'ouvre qu'au tour 3.", c: "#a78bfa", opens: 3 },
  { k: "kara", n: "Le Karaoké", s: "flow", d: "Le monde à l'envers : les morceaux les plus lents y brillent.", c: "#ff8a3d", flip: true },
  { k: "studio", n: "Le Studio", s: "pw", d: "Les featurings : +3 à chaque carte d'un artiste déjà présent dans son camp ici.", c: "#5fe0cf" },
];
const FV = { on: false };

// a card of the collection as a Festival card: its cost, and its value in each stat (small numbers, easy to add up)
function fvCard(c, cp, k) {
  const s = stats(c), gb = typeof BT_GRADE !== "undefined" ? BT_GRADE[cp.grade || 0] || 0 : 0;
  const v = x => Math.max(1, Math.round((x + gb + (cp.holo ? 4 : 0)) / 10) + Math.floor(c.tier / 2));
  return { k, c, cp, cost: FV_COST[c.tier] || 1, flow: v(s.flow), endu: v(s.endu), hype: v(s.hype), pw: v(s.pw), raw: s,
    holo: !!cp.holo, gem: (cp.grade || 0) >= 9, artist: c.a, name: c.t };
}
// what a card brings on a stage, with the stage's rule
function fvPower(card, lane, side, idx) {
  const st = FV.stages[lane]; let p = st.flip ? Math.max(1, 11 - Math.round(card.raw.flow / 10)) : card[st.s];
  if (st.k === "stade") p += idx;
  if (st.k === "plein" && card.turn === 4) p += 3;
  if (st.k === "roof" && (card.holo || card.gem)) p += 4;
  if (st.k === "studio" && FV.board[side][lane].slice(0, idx).some(o => o.artist === card.artist)) p += 3;
  return p;
}
const fvTotal = (side, lane, extra = []) => [...FV.board[side][lane], ...extra].reduce((t, c, i) => t + fvPower(c, lane, side, i), 0);
const fvRoom = (side, lane, extra = 0) => { const st = FV.stages[lane]; return FV.board[side][lane].length + extra < (st.max || FV_MAX); };
const fvOpen = lane => FV.turn >= (FV.stages[lane].opens || 1);
const fvCan = (side, card, lane, extra = 0) => fvOpen(lane) && fvRoom(side, lane, extra) && !(FV.stages[lane].cheap && card.cost > 2);

function fvShuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------------------------------------------------------------- a game */
function festivalDemo() {
  const pool = [];
  for (const c of Object.values(S.c)) { if (isArtist(c) || c.ed) continue; const cp = c.copies.find(x => x.grade) || c.copies.find(x => x.holo) || c.copies[0]; if (cp) pool.push([c, cp]); }
  if (pool.length < 16) return toast("Il faut au moins 16 morceaux différents pour tester le Festival.");
  const val = ([c, cp]) => stats(c).pw + c.tier * 3 + (cp.holo ? 4 : 0);
  pool.sort((a, b) => val(b) - val(a));
  // my deck: a good mix (the 12 best, 8 of them drawn), the bot's: 8 others of the same strength
  const mine = fvShuffle(pool.slice(0, 12)).slice(0, 8), rest = pool.filter(x => !mine.includes(x));
  const his = fvShuffle(rest.slice(0, Math.max(12, Math.min(rest.length, 20)))).slice(0, 8);
  Object.assign(FV, { on: true, turn: 1, stages: fvShuffle(FV_STAGES.slice()).slice(0, 3), board: { me: [[], [], []], op: [[], [], []] }, pending: [], sel: null, busy: false,
    deck: fvShuffle(mine.map(([c, cp], i) => fvCard(c, cp, "m" + i))), odeck: fvShuffle(his.map(([c, cp], i) => fvCard(c, cp, "o" + i))), hand: [], ohand: [] });
  FV.hand = FV.deck.splice(0, 4); FV.ohand = FV.odeck.splice(0, 4);
  const el = FV.el = document.createElement("div"); el.className = "fv"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Le Festival");
  document.body.appendChild(el); document.body.classList.add("fx-on");
  requestAnimationFrame(() => el.classList.add("on"));
  fvIntro();
}
function fvClose() { const el = FV.el; FV.on = false; FV.el = null; if (!el) return; el.classList.remove("on"); document.body.classList.remove("fx-on"); setTimeout(() => el.remove(), 350); }

function fvIntro() {
  FV.el.innerHTML = `<button class="fv-x" aria-label="Quitter">×</button><div class="fv-intro"><p class="fv-k">Prototype · contre le bot d'entraînement</p><h2>Le Festival</h2>
    <p class="fv-lead">Trois scènes, quatre tours. <b>Remporte 2 scènes sur 3.</b></p>
    <div class="fv-stages">${FV.stages.map((s, i) => `<div class="fv-st" style="--c:${s.c};--d:${.15 + i * .15}s"><small>${FV_STAT[s.s][1]} ${s.flip ? "Tempo inversé" : FV_STAT[s.s][0]}</small><b>${s.n}</b><p>${s.d}</p></div>`).join("")}</div>
    <ul class="fv-how"><li><b>Au tour N, tu as N énergie</b> (1, puis 2, 3, 4). Une carte coûte selon sa rareté : Commune et Peu commune 1, Rare et Épique 2, Mythique 3, Légendaire 4.</li>
      <li><b>Chaque scène juge une stat.</b> Une carte rapide brille au Club, une longue en Salle acoustique, une star au Stade : place-la au bon endroit.</li>
      <li><b>Vous jouez en même temps</b>, tout est révélé à la fin du tour. Lis ce que l'autre a posé, et réponds au tour suivant.</li></ul>
    <button class="btn primary fv-go">Monter sur scène</button></div>`;
  FV.el.querySelector(".fv-x").onclick = fvClose; FV.el.querySelector(".fv-go").onclick = () => fvDraw();
}

const fvCardHTML = (card, lane, side, idx, cls = "") => {
  const p = lane === undefined ? null : fvPower(card, lane, side, idx);
  return `<div class="fv-c ${cls}" data-k="${card.k}">${cardEl(card.c, card.holo).outerHTML}${p !== null ? `<span class="fv-p">${p}</span>` : ""}</div>`;
};
const fvMini = card => `<span class="fv-cost">${card.cost}</span><span class="fv-sv">${["flow", "endu", "hype"].map(s => `<i title="${FV_STAT[s][0]}">${FV_STAT[s][1]}${card[s]}</i>`).join("")}</span>`;

function fvDraw() {
  const el = FV.el, spent = FV.pending.reduce((t, p) => t + p.card.cost, 0), left = FV.turn - spent;
  const laneHTML = (st, i) => {
    const mineP = FV.pending.filter(p => p.lane === i).map(p => p.card), me = fvTotal("me", i, mineP), op = fvTotal("op", i);
    const lead = me > op ? "me" : op > me ? "op" : "eq", closed = !fvOpen(i);
    const canHere = FV.sel && fvCan("me", FV.sel, i, mineP.length);
    return `<section class="fv-lane${closed ? " closed" : ""}${canHere ? " can" : ""}" data-lane="${i}" style="--c:${st.c}">
      <div class="fv-row fv-op">${FV.board.op[i].map((c, j) => fvCardHTML(c, i, "op", j, c.fresh ? "rev" : "")).join("")}</div>
      <div class="fv-stage"><b class="fv-sc fv-op ${lead === "op" ? "lead" : ""}">${op}</b>
        <div class="fv-sn"><small>${FV_STAT[st.s][1]} ${st.flip ? "Tempo inversé" : FV_STAT[st.s][0]}</small><b>${st.n}</b><p>${closed ? `🔒 Ouvre au tour ${st.opens}` : st.d}</p></div>
        <b class="fv-sc fv-me ${lead === "me" ? "lead" : ""}">${me}</b></div>
      <div class="fv-row fv-me">${FV.board.me[i].map((c, j) => fvCardHTML(c, i, "me", j)).join("")}${mineP.map((c, j) => fvCardHTML(c, i, "me", FV.board.me[i].length + j, "pend")).join("")}</div></section>`;
  };
  el.innerHTML = `<button class="fv-x" aria-label="Quitter">×</button>
    <header class="fv-top"><span class="fv-who">🤖 Bot</span><span class="fv-turn">Tour <b>${FV.turn}</b> / 4</span><span class="fv-left">${FV.ohand.length} cartes en main</span></header>
    <div class="fv-lanes">${FV.stages.map(laneHTML).join("")}</div>
    <footer class="fv-bot"><div class="fv-en" aria-label="Énergie"><b>${left}</b><small>énergie</small></div>
      <div class="fv-hand">${FV.hand.map(c => { const placed = FV.pending.some(p => p.card === c), afford = c.cost <= left;
        return placed ? "" : `<button type="button" class="fv-h${FV.sel === c ? " sel" : ""}${afford ? "" : " poor"}" data-h="${c.k}">${fvCardHTML(c)}${fvMini(c)}</button>`; }).join("")}</div>
      <button class="btn primary fv-end"${FV.busy ? " disabled" : ""}>${FV.pending.length ? "Jouer ▶" : "Passer ▶"}</button></footer>
    <p class="fv-tip">${FV.sel ? `Touche une scène pour y poser <b>${esc(FV.sel.name)}</b>.` : FV.pending.length ? "Touche une carte posée pour la reprendre." : "Choisis une carte de ta main, puis une scène."}</p>`;
  el.querySelector(".fv-x").onclick = fvClose;
  el.querySelectorAll("[data-h]").forEach(b => b.onclick = () => { const c = FV.hand.find(x => x.k === b.dataset.h);
    if (c.cost > left) return toast(`Pas assez d'énergie : il en faut ${c.cost}.`); FV.sel = FV.sel === c ? null : c; fvDraw(); });
  el.querySelectorAll(".fv-lane").forEach(l => l.onclick = e => {
    const pc = e.target.closest(".fv-c.pend"); if (pc) { FV.pending = FV.pending.filter(p => p.card.k !== pc.dataset.k); return fvDraw(); }
    if (!FV.sel) return; const i = +l.dataset.lane, n = FV.pending.filter(p => p.lane === i).length;
    if (!fvOpen(i)) return toast(`Cette scène ouvre au tour ${FV.stages[i].opens}.`);
    if (!fvRoom("me", i, n)) return toast("Plus de place sur cette scène.");
    if (FV.stages[i].cheap && FV.sel.cost > 2) return toast("La Cave n'accepte que les cartes à 1 ou 2 énergie.");
    FV.sel.turn = FV.turn; FV.pending.push({ card: FV.sel, lane: i }); FV.sel = null; fvDraw(); });
  el.querySelector(".fv-end").onclick = () => fvEndTurn();
  FV.board.op.flat().forEach(c => delete c.fresh);
}

// the bot: tries every way to spend its energy and keeps the one that wins the most stages (it sees what I played before)
function fvBot() {
  const hand = FV.ohand, en = FV.turn, best = { v: -1e9, plays: [] };
  const lanesWin = extra => [0, 1, 2].reduce((t, i) => { const d = fvTotal("op", i, extra[i]) - fvTotal("me", i); return t + Math.tanh(d / 4) + d * .02; }, 0);
  const rec = (k, left, extra, plays) => {
    if (k === hand.length) { const v = lanesWin(extra) + Math.random() * .15; if (v > best.v) { best.v = v; best.plays = plays.slice(); } return; }
    rec(k + 1, left, extra, plays);
    const c = hand[k]; if (c.cost > left) return;
    for (let i = 0; i < 3; i++) if (fvCan("op", c, i, extra[i].length)) {
      c.turn = FV.turn; extra[i].push(c); plays.push([c, i]);
      rec(k + 1, left - c.cost, extra, plays);
      extra[i].pop(); plays.pop();
    }
  };
  rec(0, en, [[], [], []], []);
  return best.plays;
}

async function fvEndTurn() {
  if (FV.busy) return; FV.busy = true; FV.sel = null;
  const bot = fvBot();
  for (const p of FV.pending) { p.card.turn = FV.turn; FV.board.me[p.lane].push(p.card); FV.hand = FV.hand.filter(c => c !== p.card); }
  FV.pending = [];
  for (const [c, i] of bot) { c.turn = FV.turn; c.fresh = true; FV.board.op[i].push(c); FV.ohand = FV.ohand.filter(x => x !== c); }
  fvDraw(); FV.el.classList.add("reveal");
  await new Promise(r => setTimeout(r, 1300)); FV.el?.classList.remove("reveal");
  if (!FV.on) return;
  if (FV.turn >= 4) return fvEnd();
  FV.turn++; if (FV.deck.length) FV.hand.push(FV.deck.shift()); if (FV.odeck.length) FV.ohand.push(FV.odeck.shift());
  FV.busy = false; fvDraw();
}

function fvEnd() {
  const res = [0, 1, 2].map(i => { const me = fvTotal("me", i), op = fvTotal("op", i); return { me, op, w: me > op ? 1 : op > me ? -1 : 0 }; });
  const wins = res.filter(r => r.w > 0).length, losses = res.filter(r => r.w < 0).length;
  const tm = res.reduce((t, r) => t + r.me, 0), to = res.reduce((t, r) => t + r.op, 0);
  const won = wins > losses || (wins === losses && tm > to), draw = wins === losses && tm === to;
  const end = document.createElement("div"); end.className = `fv-endc ${won ? "w" : draw ? "d" : "l"}`;
  end.innerHTML = `<div><p class="fv-k">${wins} scène${wins > 1 ? "s" : ""} sur 3${wins === losses && !draw ? " · départagé au total (" + tm + " – " + to + ")" : ""}</p><h2>${draw ? "Égalité" : won ? "Victoire !" : "Défaite"}</h2>
    <ul>${res.map((r, i) => `<li class="${r.w > 0 ? "w" : r.w < 0 ? "l" : ""}"><b>${FV.stages[i].n}</b><span>${r.me} – ${r.op}</span></li>`).join("")}</ul>
    <div class="fv-acts"><button class="btn primary" data-a="again">Rejouer</button><button class="btn" data-a="close">Fermer</button></div></div>`;
  FV.el.appendChild(end); requestAnimationFrame(() => end.classList.add("on"));
  end.querySelector('[data-a="again"]').onclick = () => { fvClose(); setTimeout(festivalDemo, 380); };
  end.querySelector('[data-a="close"]').onclick = fvClose;
}
window.festivalDemo = festivalDemo;
