"use strict";
/* Zik Hunter — the "Collection Hantée" (Halloween): 13 sounds, each printed in a few numbered copies only (Thriller 1/1).
   No rarity: they all wear the same card, a sleeve in a haunted-manor window. */
function hauntedCardEl(c) {
  const one = c.of === 1, no = c.no === "?" ? "?" : String(c.no).padStart(String(c.of).length, "0");
  const el = document.createElement("div"); el.className = "hcard" + (one ? " one" : "");
  el.innerHTML = `<div class="hc-glow" aria-hidden="true"></div>
    <div class="hc-paper">
      <img class="hc-art" src="${esc(c.cov)}" alt="Pochette de ${esc(c.t)}" loading="lazy" decoding="async">
      <div class="hc-tint" aria-hidden="true"></div><div class="hc-char" aria-hidden="true"></div><div class="hc-smoke" aria-hidden="true"><i></i><i></i></div>
      <div class="hc-head"><span>Collection hantée</span>${one ? `<span class="hc-uniq">Unique</span>` : ""}</div>
      <div class="hc-foot">
        <div class="hc-a">${esc(c.a)}</div>
        <div class="hc-t${c.t.length > 18 ? " xlong" : c.t.length > 10 ? " long" : ""}">${esc(c.t)}</div>
        <div class="hc-row"><span>Halloween ${c.year || 2026}</span><b class="hc-no"><small>N°</small>${no}<em>/${c.of}</em></b></div>
      </div>
    </div>
    <div class="hc-rim" aria-hidden="true"></div>
    <div class="hc-embers" aria-hidden="true">${"<i></i>".repeat(9)}</div>`;
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
        <p class="hx-r-kick">${view ? "Collection Hantée" : "Une présence hante ce booster…"}</p>
        <div class="hx-r-card"></div>
        <div class="hx-r-txt"><b>Collection Hantée</b><span>${esc(card.title)} · N° ${String(card.no).padStart(String(card.of).length, "0")}/${card.of}${card.of === 1 ? " · exemplaire unique !" : ""}</span>
          <button class="btn primary" type="button">Continuer</button></div>`;
      el.querySelector(".hx-r-card").appendChild(hauntedCardEl({ t: card.title, a: card.artist, cov: card.cover, no: card.no, of: card.of }));
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
  const out = d.editions.reduce((a, e) => a + e.copies.length, 0), all = d.editions.reduce((a, e) => a + e.of, 0);
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
    <div class="hx-board">${d.editions.map(e => {
      const mine = e.copies.filter(c => c.mine), left = e.of - e.copies.length;
      return `<div class="hx-slot${mine.length ? " mine" : ""}${left ? "" : " out"}" data-slot="${e.slot}">
        <div class="hx-card"></div>
        <p class="hx-left">${left ? `${left} / ${e.of} à trouver` : "Tous sortis"}</p>
        <ul class="hx-owners">${e.copies.map(c => `<li${c.mine ? ' class="me"' : ""}><button type="button" data-no="${c.no}"><b>N° ${String(c.no).padStart(String(e.of).length, "0")}</b> ${esc(c.pseudo || "?")}${c.grade ? ` <i class="hx-g">${c.grade}</i>` : ""}${c.sale ? ` <em class="hx-price">${fmt(c.sale.price)} Streams</em>` : ""}</button></li>`).join("")}</ul></div>`;
    }).join("")}</div>`;
  box.querySelectorAll(".hx-slot").forEach(s => {
    const e = d.editions.find(x => x.slot === +s.dataset.slot), mine = e.copies.filter(c => c.mine);
    const w = hauntedCardEl({ t: e.title, a: e.artist, cov: e.cover || "", no: mine.length ? mine[0].no : "?", of: e.of });
    if (!mine.length) w.querySelector(".hcard").classList.add("hc-ghost");
    s.querySelector(".hx-card").appendChild(w);
    const open = cp => hxView(hxCard(e, cp));
    if (e.copies.length) { s.querySelector(".hx-card").onclick = () => open(mine[0] || e.copies.find(c => c.sale) || e.copies[0]); s.querySelector(".hx-card").classList.add("tap"); }
    s.querySelectorAll(".hx-owners button").forEach(b => b.onclick = () => open(e.copies.find(c => c.no === +b.dataset.no)));
  });
  box.querySelector("#hxPack").onclick = () => startOpening(HAUNTED);
  const art = box.querySelector("#hxPackArt"); skin(art, "pack-haunted", { sway: true }); art.onclick = () => pk >= 100 ? startOpening(HAUNTED) : toast(`Il te faut 100 🎃 pour le Pack Hanté.`);
  box.querySelector("#hxIntro").onclick = () => hauntedIntro();
  const demo = box.querySelector("#hxDemo"); if (demo) demo.onclick = () => Haunted.demo();
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
Object.assign(Haunted, {
  inPack(OP) {
    OP.hDone = true;
    const box = $o(".op-cards"), c = OP.haunted;
    box.querySelectorAll(".solo-card").forEach(x => x.remove());
    const el = document.createElement("div"); el.className = "solo-card hx-solo";
    el.innerHTML = `<div class="hx-bk" aria-hidden="true"><b>?</b><i class="hx-sigil"></i></div><div class="hx-front"></div><div class="hx-burn" aria-hidden="true"></div>
      <div class="hx-bats-s" aria-hidden="true">${"<i></i>".repeat(6)}</div>`;
    el.querySelector(".hx-front").appendChild(hauntedCardEl({ t: c.title, a: c.artist, cov: c.cover, no: c.no, of: c.of }));
    box.appendChild(el); op.classList.add("hx-on");
    const film = matchMedia("(prefers-reduced-motion: reduce)").matches ? null : import("./haunt3d.js?v=23").catch(() => null);   // loads while the back shakes
    if (film) { const m = Math.min(innerWidth, innerHeight) < 600 || /Android|iPhone|iPad/.test(navigator.userAgent);   // the turntable too, so the film starts at once
      (m ? ["turntable-1k.gltf?v=2", "turntable.bin", "base-1k.jpg?v=2", "mr-1k.jpg?v=2", "normal-1k.jpg?v=2"] : ["turntable.gltf?v=2", "turntable.bin", "base.jpg?v=2", "mr.jpg?v=2", "normal.jpg?v=2"])
        .forEach(f => fetch("brand/3d/" + f).catch(() => {})); }
    $o(".op-sub").textContent = "Carte bonus · Collection Hantée";
    opHint("Une présence hante ce booster… touche la carte");
    const audio = new Audio(); audio.preload = "auto"; audio.volume = .7; OP.hAudio = audio;     // fetched now: played inside the touch
    const pre = hxPreview(c).then(u => { if (u) audio.src = u; return u; }).catch(() => null);
    OP.step = async () => {
      opHint("");
      if (audio.src) audio.play().catch(() => {});
      else pre.then(u => { if (u && OP.hAudio === audio) audio.play().catch(() => {}); });
      const m = await Promise.race([film, wait(2500).then(() => null)]);
      let shown = false;
      if (m) {
        const host = document.createElement("div"); host.className = "hx3d"; host.setAttribute("aria-hidden", "true");
        host.innerHTML = `<button class="hx3d-skip" type="button">Passer</button>`;
        document.body.appendChild(host); document.body.classList.add("fx-on", "hx3d-on");
        host.querySelector("button").onclick = () => host.remove();
        try { await m.play(host, c); shown = true; } catch (e) { console.warn("Carte hantée 3D :", e); }
        host.remove(); document.body.classList.remove("fx-on", "hx3d-on");
      }
      if (shown) el.classList.add("burning", "done");
      else { el.classList.add("burning"); await wait(1900); el.classList.add("done"); }
      opHint(`${c.title} · N° ${hxNo(c)}/${c.of}${c.of === 1 ? " · exemplaire unique !" : ""} — touche pour voir tout le booster`);
      OP.step = async () => { OP.hAudio?.pause(); OP.hAudio = null; op.classList.remove("hx-on"); el.classList.add("leave"); setTimeout(() => el.remove(), 380);
        if (OP.demo) { OP.demo = false; OP.haunted = null; OP.step = null; closeOpening(); } else opRecap(); };
    };
  },
  // the layout of the whole booster: the haunted copy at the end (burnt in front of you if skipped with "Tout révéler")
  async inRecap(OP, rc) {
    const c = OP.haunted, slot = document.createElement("div"); slot.className = "slot hx-rslot";
    slot.appendChild(hauntedCardEl({ t: c.title, a: c.artist, cov: c.cover, no: c.no, of: c.of }));
    slot.onclick = () => Haunted.reveal(c, true);
    if (!OP.hDone) { OP.hDone = true; await Haunted.reveal(c); }
    rc.appendChild(slot);
  },
});

/* admins: the whole reveal with a sound of the collection, nothing drawn nor saved */
Haunted.demo = async () => {
  if (busy || !op.hidden) return;
  let d = HXM.d; try { d = await rpc("haunted_collection"); } catch (e) {}
  const eds = (d?.editions || []).filter(e => e.cover); if (!eds.length) return toast("Pas encore de carte à montrer.");
  const e = eds[Math.random() * eds.length | 0];
  Object.assign(OP, { p: HAUNTED, pulls: [], i: 0, seen: -1, haunted: { title: e.title, artist: e.artist, cover: e.cover, preview: e.preview, no: 1, of: e.of }, hDone: false, demo: true });
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

/* the collection page: my haunted cards on top (refreshed at most every 30 s) */
const HXM = { at: 0, d: null, busy: false };
async function drawMyHaunted() {
  const box = $("#hxMine"); if (!box || typeof me === "undefined" || !me) return;
  if (!HXM.busy && Date.now() - HXM.at > 30000) {
    HXM.busy = true;
    try { HXM.d = await rpc("haunted_collection"); HXM.at = Date.now(); } catch (e) {}
    HXM.busy = false;
  }
  const mine = (HXM.d?.editions || []).flatMap(e => e.copies.filter(x => x.mine).map(x => hxCard(e, x)));
  box.hidden = !mine.length; if (!mine.length) return;
  box.innerHTML = `<h3>🦇 Ta Collection Hantée <small>${mine.length} carte${mine.length > 1 ? "s" : ""} · édition limitée</small></h3><div class="hx-mine-row"></div>`;
  const row = box.querySelector(".hx-mine-row");
  for (const e of mine) {
    const b = document.createElement("button"); b.className = "hx-mine-c"; b.setAttribute("aria-label", `${e.title}, N° ${hxNo(e)}/${e.of}`);
    b.appendChild(hxCardOrSlab(e));
    if (e.sale) b.insertAdjacentHTML("beforeend", `<span class="hx-tag">En vente · ${fmt(e.sale.price)}</span>`);
    b.onclick = () => hxView(e);
    row.appendChild(b);
  }
}
window.drawMyHaunted = drawMyHaunted;

/* ---------- graded, listened to, sold ---------- */
const HX_GRADE = 600;                          // Streams (haunted_grade on the server)
const hxCard = (e, cp) => ({ track_id: e.track_id, title: e.title, artist: e.artist, cover: e.cover, preview: e.preview, no: cp.no, of: e.of, slot: e.slot,
  id: cp.id, mine: cp.mine, pseudo: cp.pseudo, grade: cp.grade, cert: cp.cert, sale: cp.sale });
// the card in its case, like the graded cards: the label says the sound, the collection, the number and the grade
function hxSlabEl(c) {
  const box = document.createElement("div"); box.className = "slab-box hx-slab";
  box.innerHTML = `<div class="slab" data-g="${c.grade}"><div class="pocket"><div class="lbl">
      <div class="txt"><span class="l1">HALLOWEEN 2026 ZIK HUNTER</span><b class="l2">${esc(c.title)}</b><span class="l3">${esc(c.artist)} · COLLECTION HANTÉE</span>
        <span class="l4"><b>N° ${hxNo(c)}/${c.of}</b>${c.of === 1 ? " · EXEMPLAIRE UNIQUE" : ""}</span></div>
      <div class="mark"><img src="brand/zikhunter-icon.svg" alt=""></div>
      <div class="gr"><small>${GRADE_NAME[c.grade]}</small><b>${c.grade}</b><span class="bar" aria-hidden="true"></span><span class="cert">${esc(c.cert)}</span></div>
    </div></div><div class="grip" aria-hidden="true"></div><div class="well"></div><div class="glare" aria-hidden="true"></div></div>`;
  box.querySelector(".well").appendChild(hauntedCardEl({ t: c.title, a: c.artist, cov: c.cover || "", no: c.no, of: c.of }));
  if (typeof tiltSlab === "function") tiltSlab(box);
  return box;
}
const hxCardOrSlab = c => c.grade ? hxSlabEl(c) : hauntedCardEl({ t: c.title, a: c.artist, cov: c.cover || "", no: c.no, of: c.of });
function hxRefresh() {
  HXM.at = 0; drawMyHaunted();
  const w = $("#hxSec"); if (w && document.body.contains(w)) drawHaunted(w);
  loadProfile?.().catch(() => {});
}

// the sheet of one copy: listen to its preview; mine: grade it, crack its case, put it on sale or take it back; someone
// else's on sale: buy it
function hxView(c) {
  return new Promise(done => {
    const el = document.createElement("div"); el.className = "hx-reveal hx-view"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", `${c.title}, Collection Hantée`);
    el.innerHTML = `<div class="hx-r-fog"></div><p class="hx-r-kick">Collection Hantée</p><div class="hx-r-card"></div>
      <div class="hx-r-txt"><b>${esc(c.title)}</b><span>${esc(c.artist)} · N° ${hxNo(c)}/${c.of}${c.of === 1 ? " · exemplaire unique" : ""}${c.mine ? "" : c.pseudo ? ` · à ${esc(c.pseudo)}` : ""}</span>
        <div class="hx-acts"></div><div class="hx-sellf" hidden></div>
        <button class="btn hx-close" type="button">Fermer</button></div>`;
    el.querySelector(".hx-r-card").appendChild(hxCardOrSlab(c));
    document.body.appendChild(el); document.body.classList.add("fx-on");
    const acts = el.querySelector(".hx-acts"), sellf = el.querySelector(".hx-sellf");
    let audio = null;
    const btn = (label, cls, f) => { const b = document.createElement("button"); b.type = "button"; b.className = "btn " + cls; b.textContent = label; b.onclick = f; acts.appendChild(b); return b; };
    const close = () => { audio?.pause(); el.classList.remove("on"); document.body.classList.remove("fx-on"); setTimeout(() => { el.remove(); done(); }, 400); };
    const run = async (f, ok) => { if (el.dataset.busy) return; el.dataset.busy = 1; try { await f(); ok && toast(ok); close(); hxRefresh(); } catch (e) { toast(message(e)); } delete el.dataset.busy; };
    // the link is fetched as soon as the sheet opens, so the touch on the button starts the sound at once: phones only
    // let a page play sound right inside the touch, not after waiting for Deezer
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
    if (c.mine && c.id) {
      if (c.sale) {
        acts.insertAdjacentHTML("beforeend", `<p class="hx-onsale">En vente à <b>${fmt(c.sale.price)} Streams</b></p>`);
        btn("Retirer de la vente", "", () => run(() => rpc("haunted_unsell", { p_card: c.id }), "Ta carte n'est plus en vente."));
      } else {
        if (!c.grade) btn(`Faire grader · ${fmt(HX_GRADE)} Streams`, "primary-soft", async () => {
          if ((S.streams || 0) < HX_GRADE) return toast(`Il te faut ${fmt(HX_GRADE)} Streams pour faire grader cette carte. Tu en as ${fmt(S.streams || 0)}.`);
          if (el.dataset.busy) return; el.dataset.busy = 1;
          try { const r = await rpc("haunted_grade", { p_card: c.id }); S.streams = Math.max(0, (S.streams || 0) - HX_GRADE);
            Object.assign(c, { grade: r.grade, cert: r.cert }); close(); hxRefresh();
            await wait(450); toast(`${GRADE_NAME[r.grade]} ${r.grade} ! « ${c.title} » est dans sa boîte.`); hxView(c);
          } catch (e) { toast(message(e)); delete el.dataset.busy; }
        });
        else btn("Casser la boîte", "", () => { if (confirm(`Casser la boîte ? « ${c.title} » redevient une carte sans note. Sa note ${c.grade} est perdue pour toujours.`)) run(() => rpc("haunted_crack", { p_card: c.id }), "Boîte cassée."); });
        btn("Mettre en vente", "primary", () => {
          sellf.hidden = false; sellf.innerHTML = `<label>Prix en Streams <input type="number" min="100" step="100" inputmode="numeric" value="${c.of === 1 ? 100000 : 10000}"></label>
            <small>Les autres joueurs la verront sur le tableau de la Collection Hantée. La banque garde ${HXM.d?.fee ?? 5} % à la vente.</small>
            <button class="btn primary" type="button">Confirmer la vente</button>`;
          const inp = sellf.querySelector("input"); inp.focus(); inp.select();
          sellf.querySelector("button").onclick = () => { const p = Math.round(+inp.value); if (!(p >= 100)) return toast("Prix minimum : 100 Streams.");
            run(() => rpc("haunted_sell", { p_card: c.id, p_price: p }), `« ${c.title} » est en vente à ${fmt(p)} Streams.`); };
        });
      }
    } else if (c.sale && typeof me !== "undefined" && me) {
      btn(`Acheter · ${fmt(c.sale.price)} Streams`, "primary", () => {
        if ((S.streams || 0) < c.sale.price) return toast(`Pas assez de Streams : il t'en faut ${fmt(c.sale.price)}, tu en as ${fmt(S.streams || 0)}.`);
        if (!confirm(`Acheter « ${c.title} » N° ${hxNo(c)}/${c.of}${c.grade ? ` (${GRADE_NAME[c.grade]} ${c.grade})` : ""} à ${esc(c.pseudo || "?")} pour ${fmt(c.sale.price)} Streams ?`)) return;
        run(() => rpc("haunted_buy", { p_listing: c.sale.id }), `🦇 « ${c.title} » est dans ta collection !`);
      });
    }
    requestAnimationFrame(() => el.classList.add("on"));
    setTimeout(() => el.classList.add("show"), 60);
    const x = el.querySelector(".hx-close"); x.onclick = close; setTimeout(() => x.focus(), 100);
    el.addEventListener("click", e => { if (e.target === el) close(); });
    el.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  });
}
