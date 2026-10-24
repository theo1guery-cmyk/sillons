"use strict";
/* Zik Hunter — the "Collection Hantée" (Halloween): 13 sounds, each printed in a few numbered copies only (Thriller 1/1).
   No rarity: they all wear the same card, a sleeve in a haunted-manor window. */
// the night's cards: a full moon rises behind the card, bats cross above it (around the card, never on the sleeve)
const HN_BACK = `<div class="hn-o hn-bigmoon" aria-hidden="true"></div>`, HN_FRONT = `<div class="hn-o hn-flight" aria-hidden="true"><i></i><i></i><i></i></div>`;
function hauntedCardEl(c) {
  const one = c.of === 1, no = c.no === "?" ? "?" : String(c.no).padStart(String(c.of).length, "0");
  const el = document.createElement("div"); el.className = "hcard" + (one ? " one" : "") + (c.nuit ? " nuit" : "");
  // c.nuit: the series of the night of 31 October — pumpkin and black; the sleeve stays clean, the moon and the bats
  // live around the card
  el.innerHTML = `${c.nuit ? HN_BACK : ""}<div class="hc-glow" aria-hidden="true"></div>
    <div class="hc-paper">
      <img class="hc-art" src="${esc(c.cov)}" alt="Pochette de ${esc(c.t)}" loading="lazy" decoding="async">
      <div class="hc-tint" aria-hidden="true"></div><div class="hc-char" aria-hidden="true"></div><div class="hc-smoke" aria-hidden="true"><i></i><i></i></div>
      <div class="hc-head"><span>${c.nuit ? "Nuit d'Halloween" : "Collection hantée"}</span>${one ? `<span class="hc-uniq">Unique</span>` : ""}</div>
      <div class="hc-foot">
        <div class="hc-a">${esc(c.a)}</div>
        <div class="hc-t${c.t.length > 18 ? " xlong" : c.t.length > 10 ? " long" : ""}">${esc(c.t)}</div>
        <div class="hc-row"><span>${c.nuit ? "31 · 10 · 2026" : `Halloween ${c.year || 2026}`}</span><b class="hc-no"><small>N°</small>${no}<em>/${c.of}</em></b></div>
      </div>
    </div>
    <div class="hc-rim" aria-hidden="true"></div>
    <div class="hc-embers" aria-hidden="true">${"<i></i>".repeat(9)}</div>${c.nuit ? HN_FRONT : ""}`;
  const w = document.createElement("div"); w.className = "cq"; w.appendChild(el);
  return w;
}

/* Deezer's preview links expire after a few hours: the one saved with the card is stale, so a fresh one is fetched
   each time (the track is found once by its title and artist, then remembered) */
const HX_TRACK = {};
async function hxPreview(c) {
  const k = c.title + "|" + c.artist, low = x => (x || "").toLowerCase();
  const ed = (HXM.d?.editions || []).find(e => low(e.title) === low(c.title) && low(e.artist) === low(c.artist));
  const fresh = async id => { const t = id && await dz("track/" + id, {}, true).catch(() => null); return t?.preview || null; };
  // 1. the track the server found for this sound (the same way as the other cards' extracts)
  let u = await fresh(c.track_id || ed?.track_id || HX_TRACK[k]);
  if (u) return u;
  // 2. a search by artist and title, then by plain words; a version that has an extract
  for (const q of [`artist:"${c.artist}" track:"${c.title}"`, `${c.artist} ${c.title}`]) {
    const r = await dz("search", { q, limit: 15 }, true).catch(() => null);
    const l = (r?.data || []).filter(x => x.preview);
    const t = l.find(x => low(x.title) === low(c.title) && low(x.artist?.name) === low(c.artist)) || l.find(x => low(x.title).startsWith(low(c.title))) || l[0];
    if (t) { HX_TRACK[k] = t.id; return t.preview; }
  }
  // 3. the link saved with the sound (it may have expired)
  return c.preview || ed?.preview || null;
}

/* the copy found in a booster: the room goes dark, bats cross, the card rises out of the fog with its number */
const Haunted = {
  reveal(card, view = false) {             // view: the card sheet of a card already found (no suspense)
    if (view) return hxView(card);
    return new Promise(done => {
      const el = document.createElement("div"); el.className = "hx-reveal"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
      el.setAttribute("aria-label", "Carte de la Collection Hantée");
      el.innerHTML = `<div class="hx-r-fog"></div><div class="hx-r-bats" aria-hidden="true">${"<i></i>".repeat(7)}</div>
        <p class="hx-r-kick">${view ? hxSeries(card) : "Une présence hante ce booster…"}</p>
        <div class="hx-r-card"></div>
        <div class="hx-r-txt"><b>${hxSeries(card)}</b><span>${esc(card.title)} · N° ${String(card.no).padStart(String(card.of).length, "0")}/${card.of}${card.of === 1 ? " · exemplaire unique !" : ""}</span>
          <button class="btn primary" type="button">Continuer</button></div>`;
      el.querySelector(".hx-r-card").appendChild(hauntedCardEl({ t: card.title, a: card.artist, cov: card.cover, no: card.no, of: card.of, nuit: hxNight(card) }));
      document.body.appendChild(el); document.body.classList.add("fx-on");
      const audio = new Audio(); audio.volume = .7;
      hxPreview(card).then(u => { if (u && el.isConnected) { audio.src = u; audio.play().catch(() => {}); } });
      requestAnimationFrame(() => el.classList.add("on"));
      setTimeout(() => el.classList.add("show"), view ? 60 : 1500);
      const close = () => { audio?.pause(); el.classList.remove("on"); document.body.classList.remove("fx-on"); setTimeout(() => { el.remove(); done(); }, 400); };
      const b = el.querySelector("button"); b.onclick = close; setTimeout(() => b.focus(), view ? 100 : 1600);
      if (view) { b.textContent = "Fermer"; el.addEventListener("click", e => { if (e.target === el) close(); }); }
    });
  },
};
window.Haunted = Haunted;

/* the board at the witch's: the 13 sounds, the copies still to come, who holds which number; and the Pack Hanté */
async function drawHaunted(box) {
  const gone = () => { box.remove(); if (W.sub === "hx") { W.sub = "quests"; wzSub(); } };
  let d; try { d = await rpc("haunted_collection"); HXM.d = d; HXM.at = Date.now(); } catch (e) { gone(); return; }
  if (!d?.editions?.length) { gone(); return; }
  if (d.paused) {
    box.innerHTML = `<h3 id="hxT">Collection Hantée${typeof ADM !== "undefined" && ADM.admin ? ` <button class="ps-link wz-replay" id="hxDemo">🎬 Tester l'apparition (admin)</button>` : ""}</h3><p class="sub">🛠️ La Collection Hantée est en maintenance le temps d'embellir ses cartes. Elle revient très vite, et les cartes déjà trouvées restent à leurs propriétaires.</p>`;
    const demo = box.querySelector("#hxDemo"); if (demo) demo.onclick = () => Haunted.demo();
    return;
  }
  const admin = typeof ADM !== "undefined" && ADM.admin;
  const night = d.editions.filter(e => e.series === 2), first = d.editions.filter(e => e.series !== 2);
  const out = first.reduce((a, e) => a + e.copies.length, 0), all = first.reduce((a, e) => a + e.of, 0);
  const now = Date.parse(d.now) || Date.now(), nOpen = Date.parse(night[0]?.opens_at), nClose = Date.parse(night[0]?.closes_at);
  const nState = !night.length ? null : now < nOpen ? "soon" : now < nClose ? "on" : "over";
  const nOut = night.reduce((a, e) => a + e.copies.length, 0), nAll = night.reduce((a, e) => a + e.of, 0);
  const board = list => `<div class="hx-board">${list.map(e => {
      const mine = e.copies.filter(c => c.mine), left = e.of - e.copies.length;
      return `<div class="hx-slot${mine.length ? " mine" : ""}${left ? "" : " out"}" data-slot="${e.slot}">
        <div class="hx-card"></div>
        <p class="hx-left">${left ? `${left} / ${e.of} à trouver` : "Tous sortis"}</p>
        <ul class="hx-owners">${e.copies.map(c => `<li${c.mine ? ' class="me"' : ""}><button type="button" data-no="${c.no}"><b>N° ${String(c.no).padStart(String(e.of).length, "0")}</b> ${esc(c.pseudo || "?")}${c.grade ? ` <i class="hx-g">${c.grade}</i>` : ""}${c.sale ? ` <em class="hx-price">${fmt(c.sale.price)} Streams</em>` : ""}</button></li>`).join("")}</ul></div>`;
    }).join("")}</div>`;
  // the night's series: shown from midnight on the 31 (admins see it before, to check it)
  const nightHtml = !nState || (nState === "soon" && !admin) ? "" : `<section class="hn-sec" aria-labelledby="hnT">
      <h3 id="hnT">🌕 La Nuit d'Halloween${admin ? ` <button class="ps-link wz-replay" id="hnLook">👁 Voir les cartes (admin)</button> <button class="ps-link wz-replay" id="hnDemo">🎬 Tester l'apparition (admin)</button>` : ""}</h3>
      <p class="sub">${nState === "soon" ? `<b>Aperçu admin :</b> personne d'autre ne voit cette série avant le 31 octobre à minuit. ${night.length} cartes en un seul exemplaire chacune, à trouver dans les boosters du 31 seulement, de minuit à minuit.`
        : nState === "on" ? `Cette nuit seulement, jusqu'à minuit : ${night.length} cartes légendaires, chacune en un seul exemplaire, se cachent dans les boosters. <b>${nOut} / ${nAll}</b> déjà trouvées. <b>Toutes les citrouilles sont doublées.</b>`
        : `La Nuit d'Halloween est finie : <b>${nOut} / ${nAll}</b> cartes ont été trouvées. Les autres ne sortiront jamais.`}</p>
      ${board(night)}</section>`;
  const pk = typeof W !== "undefined" ? W.st?.pumpkins || 0 : 0;
  box.innerHTML = `<h3 id="hxT">Collection Hantée <button class="ps-link wz-replay" id="hxIntro">▶ Revoir l'annonce</button>${typeof ADM !== "undefined" && ADM.admin ? ` <button class="ps-link wz-replay" id="hxDemo">🎬 Tester l'apparition (admin)</button>` : ""}</h3>
    <p class="sub">13 cartes à tirage limité, numérotées, qui n'existeront jamais ailleurs. Elles se cachent dans les boosters jusqu'au 2 novembre à minuit : toutes sortiront avant la fin, à toi de les trouver. <b>Thriller n'existe qu'en un seul exemplaire.</b></p>
    <div class="hx-top">
      <button class="pack hx-pack" id="hxPackArt" aria-label="Ouvrir un Pack Hanté"><span class="pack-shine"></span><canvas class="pack-gl" aria-hidden="true"></canvas><img class="pack-logo" src="brand/zikhunter-icon.svg" alt=""></button>
      <div class="hx-pinfo"><p class="hx-pk">Le Pack Hanté</p>
        <p>5 cartes <b>Rare ou mieux</b>, et <b>20 fois plus de chances</b> qu'un booster de cacher une carte de la Collection Hantée.</p>
        <button class="btn primary hx-buy" id="hxPack"${pk < 100 ? " disabled" : ""}>Ouvrir · 100 🎃</button>
        ${pk < 100 ? `<small>Il te manque ${100 - pk} 🎃 : fais les quêtes ou passe au marché aux citrouilles.</small>` : ""}
        <div class="hx-count"><b>${out}</b> / ${all} cartes Hantées sorties</div></div>
    </div>
    ${nState === "on" ? nightHtml : ""}${board(first)}${nState !== "on" ? nightHtml : ""}`;
  box.querySelectorAll(".hx-slot").forEach(s => {
    const e = d.editions.find(x => x.slot === +s.dataset.slot), mine = e.copies.filter(c => c.mine);
    const w = hauntedCardEl({ t: e.title, a: e.artist, cov: e.cover || "", no: mine.length ? mine[0].no : "?", of: e.of, nuit: e.series === 2 });
    if (!mine.length) w.querySelector(".hcard").classList.add("hc-ghost");
    s.querySelector(".hx-card").appendChild(w);
    const open = cp => hxView(hxCard(e, cp));
    if (e.copies.length) { s.querySelector(".hx-card").onclick = () => open(mine[0] || e.copies.find(c => c.sale) || e.copies[0]); s.querySelector(".hx-card").classList.add("tap"); }
    s.querySelectorAll(".hx-owners button").forEach(b => b.onclick = () => open(e.copies.find(c => c.no === +b.dataset.no)));
  });
  box.querySelector("#hxPack").onclick = () => startOpening(HAUNTED);
  const art = box.querySelector("#hxPackArt"); skin(art, "pack-haunted", { sway: true }); art.onclick = () => pk >= 100 ? startOpening(HAUNTED) : toast(`Il te faut 100 🎃 pour le Pack Hanté.`);
  box.querySelector("#hxIntro").onclick = () => hauntedIntro();
  const demo = box.querySelector("#hxDemo"); if (demo) demo.onclick = () => Haunted.demo(1);
  const nDemo = box.querySelector("#hnDemo"); if (nDemo) nDemo.onclick = () => Haunted.demo(2);
  const look = box.querySelector("#hnLook"); if (look) look.onclick = () => hxGallery(night);
}

/* admins: the night's 13 cards as they will look, with their sound (nothing is drawn nor saved) */
function hxGallery(list) {
  const el = document.createElement("div"); el.className = "hx-reveal hx-view hn-gal"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Aperçu des cartes de la Nuit d'Halloween");
  el.innerHTML = `<p class="hx-r-kick">Aperçu admin · Nuit d'Halloween</p><div class="hn-grid"></div><p class="hn-hint">Touche une carte pour écouter son extrait et vérifier que c'est le bon son.</p><button class="btn hx-close" type="button">Fermer</button>`;
  const grid = el.querySelector(".hn-grid");
  for (const e of list) {
    const b = document.createElement("button"); b.type = "button"; b.className = "hn-c"; b.setAttribute("aria-label", `${e.title}, ${e.artist}`);
    b.appendChild(hauntedCardEl({ t: e.title, a: e.artist, cov: e.cover || "", no: 1, of: e.of, nuit: true }));
    b.insertAdjacentHTML("beforeend", `<small>${e.cover ? "" : "⚠️ pas encore trouvée sur Deezer · "}${e.of === 1 ? "1 exemplaire" : e.of + " exemplaires"}</small>`);
    b.onclick = () => hxView({ track_id: e.track_id, title: e.title, artist: e.artist, cover: e.cover, preview: e.preview, no: 1, of: e.of, slot: e.slot });
    grid.appendChild(b);
  }
  document.body.appendChild(el); document.body.classList.add("fx-on");
  const close = () => { el.classList.remove("on"); document.body.classList.remove("fx-on"); setTimeout(() => el.remove(), 400); };
  el.querySelector(".hx-close").onclick = close;
  el.addEventListener("keydown", e => { if (e.key === "Escape" && !document.querySelector(".hx-view:not(.hn-gal)")) close(); });
  requestAnimationFrame(() => el.classList.add("on", "show"));
}

/* the announcement of the Collection Hantée: stories (event-intro.js), once per player, after the Halloween one */
const HXI = { shown: false, KEY: "zh-haunted-intro-2026-v2" };   // v2: shown again with the new cards
function hauntedIntroMaybe() {
  if (HXI.shown || typeof EVENT === "undefined" || EVENT.on !== "halloween" || !Online.active || !me) return;
  try { if (localStorage.getItem(HXI.KEY) || !localStorage.getItem("zh-event-intro-halloween-2026")) return; } catch (e) { return; }
  if (document.querySelector(".op:not([hidden])") || document.body.classList.contains("fx-on") || document.querySelector(".adm-screen")) return;
  hauntedIntro();
}
setInterval(hauntedIntroMaybe, 4500);
async function hauntedIntro() {
  HXI.shown = true;
  let d = null; try { d = await rpc("haunted_collection"); } catch (e) {}
  if (!d?.editions?.length || d.paused) { HXI.shown = false; return; }
  try { localStorage.setItem(HXI.KEY, "1"); } catch (e) {}
  const ed = s => d.editions.find(e => e.slot === s) || d.editions[0];
  const card = (e, no, cls = "") => { const w = hauntedCardEl({ t: e.title, a: e.artist, cov: e.cover || "", no, of: e.of }); return `<div class="hxi-c ${cls}">${w.innerHTML}</div>`; };
  const word = s => { let k = 0; return s.split(" ").map(w => `<span class="w">${[...w].map(ch => `<span style="--k:${k++}">${esc(ch)}</span>`).join("")}</span>`).join(" "); };
  const all = d.editions.reduce((a, e) => a + e.of, 0);
  const slides = [
    `<div class="si-s"><p class="si-kick">Nouveau · Halloween</p><h2 class="si-big">${word("La Collection")}<br>${word("Hantée")}</h2>
      <div class="hxi-fan">${card(ed(3), 3, "f1")}${card(ed(6), 7, "f2")}${card(ed(13), 1, "f3")}</div>
      <p class="si-line">13 cartes maudites, sur les sons les plus terrifiants. Un seul design, aucune rareté : <b>juste des cartes qui n'existeront jamais ailleurs</b>.</p></div>`,
    `<div class="si-s"><p class="si-kick">Tirage limité</p><h2 class="si-big hxi-count"><span data-c="${all}">0</span></h2>
      <p class="si-line"><b>${all} cartes dans tout le jeu</b>, pour tous les joueurs réunis. Chaque son n'existe qu'en <b>10 exemplaires numérotés</b>, de N° 01 à N° 10. Quand ils sont sortis, c'est fini pour toujours.</p>
      <div class="hxi-nos">${[1, 2, 3, 4, 5].map((n, i) => `<span style="--i:${i}">N° ${String(n).padStart(2, "0")}<em>/10</em></span>`).join("")}</div></div>`,
    `<div class="si-s"><p class="si-kick">L'exemplaire unique</p>
      <div class="hxi-one">${card(ed(1), 1)}</div>
      <p class="si-line"><b>Thriller n'existe qu'une seule fois.</b> Une seule personne l'aura dans sa collection. Il peut se cacher dans n'importe quel booster… mais il est bien caché.</p></div>`,
    `<div class="si-s"><p class="si-kick">Où les trouver</p><h2>Elles hantent les boosters</h2>
      <div class="si-chips">${[["Dans tous les boosters, jusqu'au 2 novembre", "🦇"], ["Le Pack Hanté chez la sorcière : 20 fois plus de chances", "100 🎃"], ["Des citrouilles cachées dans les boosters", "+2 à 4 🎃"], ["De nouvelles quêtes chaque nuit", "jusqu'à 120 🎃"]]
        .map(([t, p], i) => `<span style="--i:${i}">${esc(t)} · <b>${p}</b></span>`).join("")}</div>
      <p class="si-line">Toutes les cartes sortiront avant la fin de l'événement. <b>La question, c'est qui les aura.</b></p></div>`,
    `<div class="si-s"><p class="si-kick">Jusqu'au 2 novembre, minuit</p><h2 class="si-big">${word("La chasse")}<br>${word("est ouverte")}</h2>
      <div class="si-cta"><button class="btn primary" data-go="witch">Voir la collection</button><button class="btn" data-go="shop">Ouvrir un booster</button></div></div>`];
  stories(slides, "ei hxi");
  const counter = () => { const c = document.querySelector(".hxi-count [data-c]"); if (!c || c.dataset.done) return; c.dataset.done = 1;
    const n = +c.dataset.c, t0 = performance.now() + 300; const step = t => { const p = Math.min(1, Math.max(0, (t - t0) / 1400)); c.textContent = Math.round(n * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); };
  const mo = new MutationObserver(counter); const st = document.querySelector(".hxi .si-stage"); if (st) mo.observe(st, { childList: true });
  setTimeout(() => mo.disconnect(), 60000);
}

/* inside the booster: after the last card, a cursed back shakes in the fog; a touch and it burns away into the card */
const hxNo = c => String(c.no).padStart(String(c.of).length, "0");
const hxNight = c => c.series === 2 || c.slot >= NIGHT_FROM;      // a card of the night of the 31
const hxSeries = c => hxNight(c) ? "Nuit d'Halloween" : "Collection Hantée";
// the 3D film (haunt3d.js): fetched ahead, so the film starts at once
const HX_PHONE = Math.min(innerWidth, innerHeight) < 600 || /Android|iPhone|iPad/.test(navigator.userAgent);
function hxFilmLoad() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  if (HX_PHONE) return Promise.resolve({ play: hxCssFilm });          // phones: the same film without 3D, smooth everywhere
  return import("./haunt3d.js?v=28").catch(() => null);
}
/* the graveyard film for phones, in plain HTML and CSS: the graves in the fog under the moon, the ritual circle lights
   up on the ground and turns, the cursed card rises out of it spinning, bats burst out, fire eats the cursed sheet from
   the bottom up and the card shows. Same timing as the 3D film (haunt3d.js). */
function hxCssFilm(host, c, opts = {}) {
  return new Promise(done => {
    const night = hxNight(c), runes = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ";
    const star = [...Array(6)].map((_, k) => { const a = -Math.PI / 2 + k * 4 * Math.PI / 5; return `${(50 + Math.cos(a) * 43).toFixed(1)},${(50 + Math.sin(a) * 43).toFixed(1)}`; }).join(" ");
    const sheet = `<div class="hxc-sheet"><i class="hxc-sig"></i><b>?</b></div>`;
    const el = document.createElement("div"); el.className = "hxc" + (night ? " night" : "");
    el.innerHTML = `<div class="hxc-sky"></div><div class="hxc-moon"></div>
      <svg class="hxc-graves" viewBox="0 0 400 120" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><path d="M20 120V70a22 22 0 0 1 44 0v50zM300 120V62a26 26 0 0 1 52 0v58zM110 120V78h8V60h-14v-8h14V40h8v12h14v8h-14v18h8v42zM210 120V84a16 16 0 0 1 32 0v36zM360 120V88h6V74h-10v-6h10V58h6v10h10v6h-10v14h6v32zM0 112h400v8H0z"/></svg>
      <div class="hxc-fog f1"></div><div class="hxc-fog f2"></div>
      <div class="hxc-floor"><svg class="hxc-ring" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="47" stroke-width="1.2"/><circle cx="50" cy="50" r="43" stroke-width=".5"/><circle cx="50" cy="50" r="30" stroke-width=".8"/><circle cx="50" cy="50" r="27" stroke-width=".4"/>
        <polyline points="${star}" stroke-width=".7"/>
        ${[...runes].map((r, k) => `<text x="50" y="13.2" transform="rotate(${k * 15} 50 50)">${r}</text>`).join("")}</svg></div>
      <div class="hxc-pillar"></div><div class="hxc-embers">${"<i></i>".repeat(14)}</div>
      <div class="hxc-stage"><div class="hxc-card"><div class="hxc-front"><div class="hxc-face"></div>${sheet}<div class="hxc-burnline"></div></div><div class="hxc-rear">${sheet}</div></div></div>
      <div class="hxc-bats">${"<i></i>".repeat(8)}</div>`;
    el.querySelector(".hxc-face").appendChild(hauntedCardEl({ t: c.title, a: c.artist, cov: c.cover || "", no: c.no, of: c.of, nuit: night }));
    host.appendChild(el);
    const t0 = performance.now(); let revealed = false, readied = false;
    const tick = () => {
      if (!host.isConnected) { if (!revealed) opts.onReveal?.(); return done(); }
      const t = (performance.now() - t0) / 1000;
      if (!readied) { readied = true; opts.onReady?.(); el.classList.add("go"); }
      if (t >= 3.6 && !revealed) { revealed = true; try { opts.onReveal?.(); } catch (e) {} }
      if (t >= 6.2) return done();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
// the sound waits for the card. Phones only let a page play sound from a touch, and a muted start does not count: so
// the touch plays a tenth of a second of silence on the very element that will carry the music, which unlocks it; the
// extract is put in it and heard when the fire reveals the card
const HX_SILENCE = (() => {                     // a tiny silent WAV
  const n = 800, b = new Uint8Array(44 + n).fill(128), v = new DataView(b.buffer), w = (o, t) => [...t].forEach((ch, k) => b[o + k] = ch.charCodeAt(0));
  w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, "data"); v.setUint32(40, n, true);
  return URL.createObjectURL(new Blob([b], { type: "audio/wav" }));
})();
function hxMusic(c) {
  const audio = new Audio(); audio.volume = .7;
  let url = null, want = false, started = false;
  const start = () => { want = true; if (started || !url) return; started = true; audio.src = url; audio.currentTime = 0; audio.play().catch(() => {}); };
  const pre = hxPreview(c).then(u => { url = u; if (u && want) start(); return u; }).catch(() => null);
  const arm = () => { if (started) return; audio.src = HX_SILENCE; audio.play().catch(() => {}); };   // inside the touch
  return { audio, pre, arm, start, stop: () => { want = false; audio.pause(); } };
}
async function hxFilm(film, c, onReveal) {     // true once the film has played; onReveal: when the card shows
  const m = film && await Promise.race([film, wait(2500).then(() => null)]);
  if (!m) return false;
  // the film shows only once ready (its pictures loaded, its first frames drawn): until then the cursed back keeps shaking
  const host = document.createElement("div"); host.className = "hx3d"; host.setAttribute("aria-hidden", "true");
  host.innerHTML = `<button class="hx3d-skip" type="button">Passer</button>`;
  document.body.appendChild(host);
  host.querySelector("button").onclick = () => host.remove();
  const onReady = () => { host.classList.add("ready"); document.body.classList.add("fx-on", "hx3d-on"); };
  let shown = false;
  try { await m.play(host, c, { onReady, onReveal }); shown = true; } catch (e) { console.warn("Carte hantée 3D :", e); }
  host.remove(); document.body.classList.remove("fx-on", "hx3d-on");
  return shown;
}
Object.assign(Haunted, {
  inPack(OP) {
    OP.hDone = true;
    const box = $o(".op-cards"), c = OP.haunted;
    box.querySelectorAll(".solo-card").forEach(x => x.remove());
    const el = document.createElement("div"); el.className = "solo-card hx-solo";
    el.innerHTML = `<div class="hx-bk" aria-hidden="true"><b>?</b><i class="hx-sigil"></i></div><div class="hx-front"></div><div class="hx-burn" aria-hidden="true"></div>
      <div class="hx-bats-s" aria-hidden="true">${"<i></i>".repeat(6)}</div>`;
    el.querySelector(".hx-front").appendChild(hauntedCardEl({ t: c.title, a: c.artist, cov: c.cover, no: c.no, of: c.of, nuit: hxNight(c) }));
    box.appendChild(el); op.classList.add("hx-on");
    const film = hxFilmLoad();                   // loads while the back shakes
    $o(".op-sub").textContent = "Carte bonus · " + hxSeries(c);
    opHint("Une présence hante ce booster… touche la carte");
    const music = hxMusic(c); OP.hAudio = music.audio;                              // fetched now, heard when the card shows
    OP.step = async () => {
      opHint("");
      music.arm();
      const shown = await hxFilm(film, c, music.start);
      if (shown) { el.classList.add("burning", "done"); music.start(); }
      else { el.classList.add("burning"); setTimeout(music.start, 900); await wait(1900); el.classList.add("done"); }
      opHint(`${c.title} · N° ${hxNo(c)}/${c.of}${c.of === 1 ? " · exemplaire unique !" : ""} — touche pour voir tout le booster`);
      OP.step = async () => { OP.hAudio?.pause(); OP.hAudio = null; op.classList.remove("hx-on"); el.classList.add("leave"); setTimeout(() => el.remove(), 380);
        if (OP.demo) { OP.demo = false; OP.haunted = null; OP.step = null; closeOpening(); } else opRecap(); };
    };
  },
  // the layout of the whole booster: the haunted copy at the end (its film plays even when "Tout révéler" skipped it)
  async inRecap(OP, rc) {
    const c = OP.haunted, slot = document.createElement("div"); slot.className = "slot hx-rslot";
    slot.appendChild(hauntedCardEl({ t: c.title, a: c.artist, cov: c.cover, no: c.no, of: c.of, nuit: hxNight(c) }));
    slot.onclick = () => hxView({ ...c, mine: !!c.card_id, id: c.card_id });
    if (!OP.hDone) {
      OP.hDone = true;
      const music = hxMusic(c);
      music.arm(); await music.pre;
      if (await hxFilm(hxFilmLoad(), c, music.start)) { music.start(); setTimeout(() => music.stop(), 8000); }
      else { music.stop(); await Haunted.reveal(c); }                    // no 3D: the plain reveal brings its own sound
    }
    rc.appendChild(slot);
  },
});

/* admins: the whole reveal with a sound of the collection, nothing drawn nor saved */
Haunted.demo = async (series = 1) => {
  if (busy || !op.hidden) return;
  let d = HXM.d; try { d = await rpc("haunted_collection"); } catch (e) {}
  const eds = (d?.editions || []).filter(e => e.cover && (e.series || 1) === series); if (!eds.length) return toast("Pas encore de carte à montrer.");
  const e = eds[Math.random() * eds.length | 0];
  Object.assign(OP, { p: HAUNTED, pulls: [], i: 0, seen: -1, haunted: { title: e.title, artist: e.artist, cover: e.cover, preview: e.preview, track_id: e.track_id, slot: e.slot, series: e.series, no: 1, of: e.of }, hDone: false, demo: true });
  $o(".op-title").textContent = "Aperçu · Collection Hantée"; $o(".op-cards").innerHTML = ""; $o(".op-recap").innerHTML = ""; $o(".op-tray").innerHTML = "";
  op.classList.remove("god", "err"); op.hidden = false; document.body.classList.add("op-on"); addEventListener("keydown", opKeys, true);
  opPhase("cards");
  Haunted.inPack(OP);
};

/* admins: a whole Pack Hanté, for show — the sachet, 5 cards of my own collection, a haunted card and its film.
   Nothing goes to the server: no booster used, no card added, no number given. */
const HX_DEMO = { g: -1, n: "Pack Hanté", haunted: true, demo: true };
Haunted.simulate = () => { if (typeof busy !== "undefined" && busy) return; startOpening(HX_DEMO); };
Haunted.demoPulls = async () => {
  let d = null; try { d = await rpc("haunted_collection"); } catch (e) {}
  const eds = (d?.editions || []).filter(e => e.cover);
  const mine = Object.values(S.c).filter(c => !isArtist(c) && c.tier >= 2 && c.tier <= 3);   // Rare and Épique: no hit film before the haunted one
  const pick = [...(mine.length >= 5 ? mine : Object.values(S.c))].sort(() => Math.random() - .5).slice(0, 5);
  const pulls = pick.map(c => ({ c, holo: false, isNew: false })).sort((a, b) => a.c.tier - b.c.tier);
  if (eds.length) { const e = eds[Math.random() * eds.length | 0]; pulls.haunted = { title: e.title, artist: e.artist, cover: e.cover, preview: e.preview, no: 1, of: e.of }; }
  await wait(900);                               // the time a booster takes to come
  return pulls;
};

/* the haunted cards are cards of the collection (filter « Édition limitée »): the board keeps the last state read */
const HXM = { at: 0, d: null };
window.drawMyHaunted = () => { const b = $("#hxMine"); if (b) b.hidden = true; };

/* ---------- a copy on the board: listen to it, see it in my collection, buy it when it is on the market ---------- */
const hxCard = (e, cp) => ({ track_id: e.track_id, title: e.title, artist: e.artist, cover: e.cover, preview: e.preview, no: cp.no, of: e.of, slot: e.slot,
  id: cp.id, mine: cp.mine, pseudo: cp.pseudo, grade: cp.grade, cert: cp.cert, sale: cp.sale });
const hxAsCard = c => ({ id: c.track_id, t: c.title, a: c.artist, al: "", cov: c.cover || "", tier: LEG, rank: 950000, g: AUTRE, ed: c.slot, eno: c.no });
const hxCardOrSlab = c => c.grade ? slabEl(hxAsCard(c), false, { grade: c.grade, cert: c.cert, pop: c.no })
  : hauntedCardEl({ t: c.title, a: c.artist, cov: c.cover || "", no: c.no, of: c.of, nuit: hxNight(c) });
const hxMine = c => Object.values(S.c).find(x => x.ed === c.slot && x.copies?.some(cp => cp.id === c.id));
function hxRefresh() {
  HXM.at = 0;
  const w = $("#hxSec"); if (w && document.body.contains(w)) drawHaunted(w);
}
function hxView(c) {
  return new Promise(done => {
    const el = document.createElement("div"); el.className = "hx-reveal hx-view"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", `${c.title}, ${hxSeries(c)}`);
    el.innerHTML = `<div class="hx-r-fog"></div><p class="hx-r-kick">${hxSeries(c)}</p><div class="hx-r-card"></div>
      <div class="hx-r-txt"><b>${esc(c.title)}</b><span>${esc(c.artist)} · N° ${hxNo(c)}/${c.of}${c.of === 1 ? " · exemplaire unique" : ""}${c.mine ? "" : c.pseudo ? ` · à ${esc(c.pseudo)}` : ""}</span>
        <div class="hx-acts"></div>
        <button class="btn hx-close" type="button">Fermer</button></div>`;
    el.querySelector(".hx-r-card").appendChild(hxCardOrSlab(c));
    document.body.appendChild(el); document.body.classList.add("fx-on");
    const acts = el.querySelector(".hx-acts");
    let audio = null;
    const btn = (label, cls, f) => { const b = document.createElement("button"); b.type = "button"; b.className = "btn " + cls; b.textContent = label; b.onclick = f; acts.appendChild(b); return b; };
    const close = () => { audio?.pause(); el.classList.remove("on"); document.body.classList.remove("fx-on"); setTimeout(() => { el.remove(); done(); }, 400); };
    const PLAY = "▶ Écouter l'extrait";
    audio = new Audio(); audio.preload = "auto"; audio.volume = .8;
    const pre = hxPreview(c).then(u => { if (u) audio.src = u; return u; }).catch(() => null);
    const play = btn(PLAY, "hx-play", async () => {
      if (!audio.paused) { audio.pause(); play.textContent = PLAY; return; }
      if (!audio.src) {
        play.textContent = "Chargement…";
        if (!await pre) { play.textContent = PLAY; return toast("Pas d'extrait disponible pour ce morceau."); }
      }
      if (!el.isConnected) return;
      try { await audio.play(); play.textContent = "⏸ Pause"; }
      catch (e) { play.textContent = PLAY; if (e?.name === "NotAllowedError") toast("Touche encore une fois pour écouter."); else toast("Impossible de lancer l'extrait."); }
    });
    audio.onended = audio.onpause = () => { play.textContent = PLAY; };
    audio.onplay = () => { play.textContent = "⏸ Pause"; };
    if (c.sale) acts.insertAdjacentHTML("beforeend", `<p class="hx-onsale">En vente au marché à <b>${fmt(c.sale.price)} Streams</b></p>`);
    if (c.mine && c.id) {
      const own = hxMine(c);
      if (own) btn("Voir dans ma collection", "primary", () => { close(); setTimeout(() => openModal(own), 420); });
    } else if (c.sale && typeof me !== "undefined" && me) {
      btn(`Acheter · ${fmt(c.sale.price)} Streams`, "primary", async () => {
        if ((S.streams || 0) < c.sale.price) return toast(`Pas assez de Streams : il t'en faut ${fmt(c.sale.price)}, tu en as ${fmt(S.streams || 0)}.`);
        if (!confirm(`Acheter « ${c.title} » N° ${hxNo(c)}/${c.of}${c.grade ? ` (${GRADE_NAME[c.grade]} ${c.grade})` : ""} à ${c.pseudo || "?"} pour ${fmt(c.sale.price)} Streams ?`)) return;
        if (el.dataset.busy) return; el.dataset.busy = 1;
        try {
          const r = await rpc("buy_listing", { p_listing: c.sale.id });
          toast(r?.status === "card_gone" ? "Le vendeur n'a plus cette carte : l'annonce a été retirée." : `🦇 « ${c.title} » est dans ta collection !`);
          close(); await loadAll(); refreshViews(); hxRefresh();
        } catch (e) { toast(message(e)); delete el.dataset.busy; }
      });
    }
    requestAnimationFrame(() => el.classList.add("on"));
    setTimeout(() => el.classList.add("show"), 60);
    const x = el.querySelector(".hx-close"); x.onclick = close; setTimeout(() => x.focus(), 100);
    el.addEventListener("click", e => { if (e.target === el) close(); });
    el.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  });
}
