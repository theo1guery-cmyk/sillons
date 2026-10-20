"use strict";
/* Zik Hunter — card grading (with an account). The server rolls the grade, numbers the copy (#001 for the first one
   of that card ever graded) and takes the Streams; this file shows the case, the "Faire grader" and "Casser la boîte"
   buttons in a card's sheet, the Gradation tab, and the reveal of the grade. */

const GRADE_PRICE = [25, 50, 100, 250, 600, 1500];          // by rarity (same as grade_price on the server)
const G = { shiny: undefined, shown: 48, q: "", busy: false };
const bestGraded = c => (c?.copies || []).filter(cp => cp.grade).sort((a, b) => b.grade - a.grade || a.pop - b.pop)[0] || null;
const ungraded = c => (c?.copies || []).filter(cp => !cp.grade);
const rarLabel = c => isArtist(c) ? CERT[c.tier] : RAR[c.tier];

/* ---------- the card sheet: the case instead of the bare card, and the buttons ---------- */
const baseOpenModal = window.openModal;
window.openModal = function (c, shiny) { G.shiny = shiny; return baseOpenModal.apply(this, arguments); };
const baseModalExtras = Online.modalExtras;
Online.modalExtras = c => { baseModalExtras(c); gradeExtras(c); };

function gradeBtn(id, after) {
  let b = document.getElementById(id);
  if (!b) { b = document.createElement("button"); b.className = "btn"; b.id = id; $("#" + after).after(b); }
  return b;
}
function gradeExtras(c) {
  const own = S.c[ck(c)], go = gradeBtn("mGrade", "mLink"), crack = gradeBtn("mCrack", "mGrade");
  go.hidden = crack.hidden = true;
  if (c._grade) { const box = $("#mCard"); box.innerHTML = ""; box.onpointermove = box.onpointerleave = null;     // a graded card from the market
    const slab = slabEl(c, !!c._grade.holo && c.tier >= MYTH, c._grade); slab.classList.add("in-modal"); box.appendChild(slab); tiltSlab(slab); return; }
  if (!Online.active || !own) return;
  const best = bestGraded(own);
  if (best) {                                               // the sheet shows the case of the best graded copy
    const box = $("#mCard"); box.innerHTML = ""; box.onpointermove = box.onpointerleave = null;
    const slab = slabEl(c, !!best.holo && c.tier >= MYTH, best); slab.classList.add("in-modal"); box.appendChild(slab); tiltSlab(slab);
    crack.hidden = false; crack.textContent = "Casser la boîte";
    crack.onclick = () => crackSlab(c, best);
  }
  const free = ungraded(own);
  if (!free.length) return;
  const wantShiny = (G.shiny ?? own.holo > 0) && c.tier >= MYTH;
  const pick = free.find(cp => !!cp.holo === wantShiny) || free[0];
  go.hidden = false; go.classList.add("primary-soft");
  go.textContent = `Faire grader · ${fmt(GRADE_PRICE[c.tier])} Streams`;
  go.onclick = () => gradeCopy(c, pick);
}

async function gradeCopy(c, copy) {
  if (G.busy) return;
  const price = GRADE_PRICE[c.tier];
  if ((S.streams || 0) < price) return toast(`Il te faut ${fmt(price)} Streams pour faire grader cette carte. Tu en as ${fmt(S.streams || 0)}.`);
  G.busy = true;
  try {
    const res = await rpc("grade_card", { p_card: copy.id });
    Object.assign(copy, { grade: res.grade, cert: res.cert, pop: res.pop });
    S.streams = Math.max(0, (S.streams || 0) - price);
    closeModal();
    await gradeReveal(c, !!copy.holo && c.tier >= MYTH, copy);
    loadProfile?.().catch(() => {});
    refreshGradingViews();
  } catch (e) { toast(message(e)); }
  G.busy = false;
}
async function crackSlab(c, copy) {
  if (!confirm(`Casser la boîte ? Ta carte « ${c.t} » redevient une carte normale. Sa note ${copy.grade} et son n° #${String(copy.pop).padStart(3, "0")} sont perdus pour toujours.`)) return;
  try {
    await rpc("crack_slab", { p_card: copy.id });
    copy.grade = copy.cert = copy.pop = null;
    toast(`Boîte cassée : « ${c.t} » est de nouveau une carte normale.`);
    closeModal(); refreshGradingViews();
  } catch (e) { toast(message(e)); }
}
function refreshGradingViews() {
  renderCounters();
  if (!views.grading.hidden) renderGrading();
  if (!views.binder.hidden) renderBinder();
}

/* ---------- the reveal: the card is scanned, sealed, the label is printed, and the grade comes last ---------- */
let gac = null;
const gsfx = () => gac ||= new (window.AudioContext || window.webkitAudioContext)();
function tick(when, f = 1800, gain = .05, dur = .03) {
  try { const a = gsfx(), t = a.currentTime + when, o = a.createOscillator(), g = a.createGain(); o.type = "square"; o.frequency.value = f;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur); o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + .02); } catch {}
}
function thud(when, gain = .5) {
  try { const a = gsfx(), t = a.currentTime + when, o = a.createOscillator(), g = a.createGain(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(40, t + .4);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.001, t + .5); o.connect(g).connect(a.destination); o.start(t); o.stop(t + .55); } catch {}
}
const sleepG = ms => new Promise(r => setTimeout(r, ms));
// the 3D lab: its own file, fetched the first time a card is graded; null if WebGL or the CDN fails
let lab = null, labP = null;
const loadLab = host => labP ??= Promise.all(['900 40px "Unbounded"', '800 40px "Instrument Sans"', '700 40px "Instrument Sans"', '500 20px "DM Mono"'].map(f => document.fonts.load(f)))
  .then(() => import("./grade3d.js?v=15")).then(m => m.create(host)).then(async x => { await x.warmup(); return lab = x; })
  .catch(e => { console.warn("Labo 3D indisponible", e); labP = null; return null; });
const labelOf = (c, holo, g) => ({
  l1: isArtist(c) ? "ZIK HUNTER · ARTISTE" : `${c.y ? c.y + " " : ""}ZIK HUNTER`, l2: c.t.toUpperCase(),
  l3: ((isArtist(c) ? CERT[c.tier] : `${c.a} · ${RAR[c.tier]}`) + (holo ? " · SHINY" : "")).toUpperCase(),
  l4: `#${String(g.pop).padStart(3, "0")}${g.pop === 1 ? " · 1RE AUTHENTIFIÉE" : ""}`, gname: GRADE_NAME[g.grade], grade: g.grade, cert: g.cert });
const cssColor = v => v.startsWith("var(") ? getComputedStyle(document.documentElement).getPropertyValue(v.slice(4, -1)).trim() : v;

async function gradeReveal(c, holo, g) {
  try { gsfx().resume(); } catch {}
  const scr = document.createElement("div"); scr.className = "g-screen"; scr.setAttribute("role", "dialog"); scr.setAttribute("aria-label", "Résultat de la gradation");
  scr.innerHTML = `<div class="g-gl-host" aria-hidden="true"></div><div class="g-stage"></div><div class="g-checks" aria-hidden="true"></div><div class="g-title" aria-live="polite"></div><p class="g-hint"></p>`;
  document.body.appendChild(scr); document.body.classList.add("fx-on");
  void scr.offsetWidth; scr.classList.add("on");
  const host = scr.querySelector(".g-gl-host");
  let L3 = null;
  if (!reduceMotion()) {
    if (lab && !host.contains(lab.canvas)) host.appendChild(lab.canvas);
    const slow = setTimeout(() => { scr.querySelector(".g-hint").textContent = "Chargement…"; }, 1200);
    L3 = await Promise.race([loadLab(host), sleepG(15000)]);
    clearTimeout(slow); scr.querySelector(".g-hint").textContent = "";
    if (L3?.lost) { L3.canvas.remove(); lab = null; labP = null; L3 = null; }
  }
  if (L3) await labReveal(scr, L3, c, holo, g); else await cssReveal(scr, c, holo, g);
  scr.querySelector(".g-hint").textContent = "Touche pour continuer";
  await new Promise(r => { const done = e => { if (e.type === "keydown" && !["Enter", " ", "Escape"].includes(e.key)) return; removeEventListener("keydown", done, true); scr.removeEventListener("click", done); r(); };
    scr.addEventListener("click", done); addEventListener("keydown", done, true); });
  scr.classList.remove("on"); await sleepG(350);
  L3?.stop(); scr.remove(); document.body.classList.remove("fx-on");
}
const gradeTitle = (scr, g) => { scr.classList.add("g" + g.grade);
  scr.querySelector(".g-title").innerHTML = `<b>${GRADE_NAME[g.grade]} ${g.grade}</b><small>${g.pop === 1 ? "1re carte authentifiée · " : ""}n° #${String(g.pop).padStart(3, "0")} · certificat ${g.cert}</small>`; };

// the film in 3D, then the real case (HTML) takes its place
async function labReveal(scr, L3, c, holo, g) {
  scr.classList.add("three");
  const checks = scr.querySelector(".g-checks");
  const small = innerWidth <= 600, w = small ? Math.min(innerWidth * .66, 270) : Math.min((innerHeight - 230) * .63, 320);
  const art = isArtist(c) ? (c.cov || "").replace(/\/\d+x\d+-/, "/1000x1000-") : (c.cov || "").replace(/\/\d+x\d+-/, "/1000x1000-");
  const r = await L3.play({ w, cy: small ? .42 : .44,
    card: { cover: art, title: c.t, artist: isArtist(c) ? "Artiste" : c.a, rarity: rarLabel(c), color: cssColor(isArtist(c) ? CCOL[c.tier] : RCOL[c.tier]), holo },
    label: labelOf(c, holo, g),
    on: { start: () => scr.classList.add("lit"), check: i => checks.insertAdjacentHTML("beforeend", `<span>${["Bords", "Coins", "Surface", "Centrage"][i]} <b>✓</b></span>`),
          land: () => checks.classList.add("out") } });
  const stage = scr.querySelector(".g-stage"), slab = slabEl(c, holo, g);
  Object.assign(stage.style, { position: "absolute", left: r.left + "px", top: r.top + "px", width: r.width + "px", margin: 0 });
  stage.appendChild(slab); tiltSlab(slab); stage.classList.add("g-in");
  gradeTitle(scr, g);                                            // the title comes with the real case, not over the 3D
  await sleepG(600);
}

// the same story in plain CSS (no WebGL, or reduced motion)
async function cssReveal(scr, c, holo, g) {
  const stage = scr.querySelector(".g-stage"), slab = slabEl(c, holo, g); stage.appendChild(slab);
  const num = slab.querySelector(".gr b"), name = slab.querySelector(".gr small");
  num.textContent = "?"; name.textContent = "· · ·";
  const inner = slab.querySelector(".slab"); inner.dataset.g = "";      // no gold before the end: it would give the 10 away
  inner.classList.add("raw");                                    // only the card at first, no case
  const fast = reduceMotion();
  await sleepG(fast ? 100 : 700);
  const checks = scr.querySelector(".g-checks");
  if (!fast) {
    inner.classList.add("scan");
    for (const [i, t] of ["Bords", "Coins", "Surface", "Centrage"].entries()) {
      await sleepG(i ? 420 : 300); checks.insertAdjacentHTML("beforeend", `<span>${t} <b>✓</b></span>`); tick(0, 1400 + i * 120, .04);
    }
    await sleepG(500); inner.classList.remove("scan");
  }
  inner.classList.remove("raw"); inner.classList.add("sealing"); thud(0, .25); checks.classList.add("out");
  await sleepG(fast ? 100 : 900);
  if (!fast) {
    const seq = [];
    for (let i = 0; i < 16; i++) seq.push(4 + Math.floor(Math.random() * 7));
    for (const [i, d] of seq.entries()) { num.textContent = d; tick(0, 2200, .03, .02); await sleepG(45 + i * i * 2.2); }
    await sleepG(380);
  }
  num.textContent = g.grade; name.textContent = GRADE_NAME[g.grade]; inner.dataset.g = g.grade;
  inner.classList.add("landed"); thud(0, g.grade >= 9 ? .7 : .45);
  if (g.grade === 10) { tick(.05, 2600, .05, .25); tick(.15, 3300, .04, .35); }
  gradeTitle(scr, g);
  await sleepG(900);
}

/* ---------- the Gradation tab ---------- */
let gTimer;
$("#gq").addEventListener("input", () => { clearTimeout(gTimer); gTimer = setTimeout(() => { G.q = $("#gq").value.trim().toLowerCase(); G.shown = 48; drawPick(); }, 250); });
$("#gForm").onsubmit = e => { e.preventDefault(); G.q = $("#gq").value.trim().toLowerCase(); drawPick(); };
$("#gMore").onclick = () => { G.shown += 48; drawPick(); };
$("#gPrices").textContent = "Prix : " + RAR.map((r, i) => `${r} ${fmt(GRADE_PRICE[i])}`).join(" · ") + " Streams (même prix pour les artistes, du Démo au Diamant). Touche une carte pour l'envoyer.";

function slabCell(c, copy, caption) {
  const wrap = document.createElement("div"); wrap.className = "slab-cell";
  const slab = slabEl(c, !!copy.holo && c.tier >= MYTH, copy); tiltSlab(slab);
  slab.onclick = () => openModal(c, !!copy.holo);
  wrap.appendChild(slab);
  if (caption) wrap.insertAdjacentHTML("beforeend", `<p class="slab-cap">${caption}</p>`);
  return wrap;
}
async function renderGrading() {
  if (!me) return;
  const mine = $("#gMine"); mine.innerHTML = "";
  const graded = Object.values(S.c).flatMap(c => (c.copies || []).filter(cp => cp.grade).map(cp => [c, cp]))
    .sort((a, b) => b[1].grade - a[1].grade || b[0].tier - a[0].tier || a[1].pop - b[1].pop);
  if (!graded.length) mine.innerHTML = `<div class="empty">Aucune carte gradée pour l'instant. Choisis-en une plus bas.</div>`;
  for (const [c, cp] of graded) mine.appendChild(slabCell(c, cp));
  drawPick();
  try {
    const b = await rpc("grade_board");
    const counts = b.counts || {};
    $("#gCounts").innerHTML = [10, 9, 8, 7, 6, 5, 4].map(n => `<span class="g-count g${n}"><b>${n}</b><small>${fmt(counts[n] || 0)}</small></span>`).join("") + `<span class="g-count-l">notes attribuées à tous les joueurs</span>`;
    const board = $("#gBoard"); board.innerHTML = "";
    if (!b.top?.length) board.innerHTML = `<div class="empty">Personne n'a encore fait grader de carte. Sois le premier : ta carte aura le n° #001.</div>`;
    for (const r of b.top || []) {
      const artist = r.kind === "artist";
      const c = cardFromRow({ kind: r.kind, track_id: r.track_id, artist_id: r.artist_id, tier: r.tier, rank: r.rank },
        artist ? { name: r.artist_name, picture: r.picture, nb_album: r.nb_album } : { title: r.title, artist: r.artist, album: r.album, cover: r.cover, duration: r.duration, bpm: r.bpm, year: r.year, explicit: r.explicit, genre: r.genre });
      board.appendChild(slabCell(c, { grade: r.grade, cert: r.cert, pop: r.pop, holo: r.holo }, `à <b>${esc(r.owner)}</b>`));
    }
  } catch (e) { $("#gBoard").innerHTML = `<div class="empty">${esc(message(e))}</div>`; }
}
function drawPick() {
  const grid = $("#gPick"); grid.innerHTML = "";
  const list = Object.values(S.c).filter(c => ungraded(c).length && (!G.q || (c.t + " " + c.a).toLowerCase().includes(G.q)))
    .sort((a, b) => b.tier - a.tier || b.rank - a.rank);
  if (!list.length) grid.innerHTML = `<div class="empty">${G.q ? "Aucune carte ne correspond." : "Toutes tes cartes sont déjà gradées."}</div>`;
  for (const c of list.slice(0, G.shown)) {
    const b = document.createElement("button"); b.className = "cell";
    b.setAttribute("aria-label", `${c.t}, ${rarLabel(c)} : faire grader pour ${GRADE_PRICE[c.tier]} Streams`);
    b.appendChild(cardEl(c, c.holo > 0 && c.tier >= MYTH));
    b.insertAdjacentHTML("beforeend", `<span class="g-price">${fmt(GRADE_PRICE[c.tier])} <i class="coin" aria-hidden="true"></i></span>`);
    b.onclick = () => openModal(c);
    grid.appendChild(b);
  }
  $("#gMore").hidden = list.length <= G.shown;
}
Object.assign(Online, { renderGrading: () => renderGrading() });

/* ---------- the collection: a small grade tag on the cards that have a graded copy ---------- */
const baseRenderBinder = window.renderBinder;
window.renderBinder = function () {
  baseRenderBinder.apply(this, arguments);
  if (!Online.active || typeof BIND === "undefined") return;
  [...$("#binder").children].forEach((cell, i) => {
    const best = bestGraded(BIND.list?.[i]);
    if (best && !cell.querySelector(".g-tag")) cell.insertAdjacentHTML("beforeend", `<span class="g-tag g${best.grade}" title="Gradée ${best.grade}">${best.grade}</span>`);
  });
};

// local preview only: http://localhost:8765/#gradage plays the reveal on a real card (#gradage-10 forces a 10), without the server
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /^#gradage(-\d+)?$/.test(location.hash)) (async () => {
  const forced = +(location.hash.split("-")[1] || 0);
  window.labSkip = +(new URLSearchParams(location.search).get("labskip") || 0);
  history.replaceState(null, "", location.pathname);
  const raw = await findTrack(-1, forced >= 10 ? LEG : MYTH, new Set()), c = await enrich(raw, -1);
  const grade = forced || [10, 9, 9, 8, 8, 8, 7, 7, 6, 5][Math.floor(Math.random() * 10)];
  await gradeReveal(c, false, { grade, cert: 10000000 + Math.floor(Math.random() * 999), pop: Math.random() < .5 ? 1 : 1 + Math.floor(Math.random() * 30) });
})();
