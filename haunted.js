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

/* the copy found in a booster: the room goes dark, bats cross, the card rises out of the fog with its number */
const Haunted = {
  reveal(card, view = false) {             // view: the big view of a card already owned (no suspense)
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
      const audio = card.preview ? new Audio(card.preview) : null;
      if (audio) { audio.volume = .7; audio.play().catch(() => {}); }
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
  let d; try { d = await rpc("haunted_collection"); } catch (e) { gone(); return; }
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
        <ul class="hx-owners">${e.copies.map(c => `<li${c.mine ? ' class="me"' : ""}><b>N° ${String(c.no).padStart(String(e.of).length, "0")}</b> ${esc(c.pseudo || "?")}</li>`).join("")}</ul></div>`;
    }).join("")}</div>`;
  box.querySelectorAll(".hx-slot").forEach(s => {
    const e = d.editions.find(x => x.slot === +s.dataset.slot), mine = e.copies.filter(c => c.mine);
    const w = hauntedCardEl({ t: e.title, a: e.artist, cov: e.cover || "", no: mine.length ? mine[0].no : "?", of: e.of });
    if (!mine.length) w.querySelector(".hcard").classList.add("hc-ghost");
    s.querySelector(".hx-card").appendChild(w);
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
    const film = matchMedia("(prefers-reduced-motion: reduce)").matches ? null : import("./haunt3d.js?v=9").catch(() => null);   // loads while the back shakes
    $o(".op-sub").textContent = "Carte bonus · Collection Hantée";
    opHint("Une présence hante ce booster… touche la carte");
    OP.step = async () => {
      opHint("");
      const audio = c.preview ? new Audio(c.preview) : null;
      if (audio) { audio.volume = .7; audio.play().catch(() => {}); OP.hAudio = audio; }
      const m = await Promise.race([film, wait(2500).then(() => null)]);
      let shown = false;
      if (m) {
        const host = document.createElement("div"); host.className = "hx3d"; host.setAttribute("aria-hidden", "true");
        host.innerHTML = `<button class="hx3d-skip" type="button">Passer</button>`;
        document.body.appendChild(host); document.body.classList.add("fx-on");
        host.querySelector("button").onclick = () => host.remove();
        try { await m.play(host, c); shown = true; } catch (e) { console.warn("Carte hantée 3D :", e); }
        host.remove(); document.body.classList.remove("fx-on");
      }
      if (shown) el.classList.add("burning", "done");
      else { el.classList.add("burning"); await wait(1900); el.classList.add("done"); }
      opHint(`${c.title} · N° ${hxNo(c)}/${c.of}${c.of === 1 ? " · exemplaire unique !" : ""} — touche pour voir tout le booster`);
      OP.step = async () => { OP.hAudio?.pause(); op.classList.remove("hx-on"); el.classList.add("leave"); setTimeout(() => el.remove(), 380);
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
  const mine = (HXM.d?.editions || []).flatMap(e => e.copies.filter(x => x.mine).map(x => ({ ...e, no: x.no })));
  box.hidden = !mine.length; if (!mine.length) return;
  box.innerHTML = `<h3>🦇 Ta Collection Hantée <small>${mine.length} carte${mine.length > 1 ? "s" : ""} · édition limitée</small></h3><div class="hx-mine-row"></div>`;
  const row = box.querySelector(".hx-mine-row");
  for (const e of mine) {
    const b = document.createElement("button"); b.className = "hx-mine-c"; b.setAttribute("aria-label", `${e.title}, N° ${hxNo(e)}/${e.of}`);
    b.appendChild(hauntedCardEl({ t: e.title, a: e.artist, cov: e.cover || "", no: e.no, of: e.of }));
    b.onclick = () => Haunted.reveal({ title: e.title, artist: e.artist, cover: e.cover, preview: e.preview, no: e.no, of: e.of }, true);
    row.appendChild(b);
  }
}
window.drawMyHaunted = drawMyHaunted;
