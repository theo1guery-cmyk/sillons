"use strict";
/* Zik Hunter — the "Collection Hantée" (Halloween): 13 sounds, each printed in a few numbered copies only (Thriller 1/1).
   No rarity: they all wear the same card, a sleeve in a haunted-manor window. */
function hauntedCardEl(c) {
  const one = c.of === 1, no = c.no === "?" ? "?" : String(c.no).padStart(String(c.of).length, "0");
  const el = document.createElement("div"); el.className = "hcard" + (one ? " one" : "");
  el.innerHTML = `<div class="hc-in">
      <div class="hc-sky"></div>
      <div class="hc-win"><img class="hc-art" src="${esc(c.cov)}" alt="Pochette de ${esc(c.t)}" loading="lazy" decoding="async"><div class="hc-fog"></div></div>
      <div class="hc-bats" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="hc-web l" aria-hidden="true"></div><div class="hc-web r" aria-hidden="true"></div>
      <div class="hc-head"><span>Collection hantée</span><span class="hc-pk" aria-hidden="true">🎃</span></div>
      <div class="hc-foot">
        <div class="hc-a">${esc(c.a)}</div>
        <div class="hc-t">${esc(c.t)}</div>
        <div class="hc-row"><span>Halloween ${c.year || 2026}</span><b class="hc-no"><small>N°</small>${no}<em>/${c.of}</em></b></div>
      </div>
    </div>`;
  const w = document.createElement("div"); w.className = "cq"; w.appendChild(el);
  return w;
}

/* the copy found in a booster: the room goes dark, bats cross, the card rises out of the fog with its number */
const Haunted = {
  reveal(card) {
    return new Promise(done => {
      const el = document.createElement("div"); el.className = "hx-reveal"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
      el.setAttribute("aria-label", "Carte de la Collection Hantée");
      el.innerHTML = `<div class="hx-r-fog"></div><div class="hx-r-bats" aria-hidden="true">${"<i></i>".repeat(7)}</div>
        <p class="hx-r-kick">Une présence hante ce booster…</p>
        <div class="hx-r-card"></div>
        <div class="hx-r-txt"><b>Collection Hantée</b><span>${esc(card.title)} · N° ${String(card.no).padStart(String(card.of).length, "0")}/${card.of}${card.of === 1 ? " · exemplaire unique !" : ""}</span>
          <button class="btn primary" type="button">Continuer</button></div>`;
      el.querySelector(".hx-r-card").appendChild(hauntedCardEl({ t: card.title, a: card.artist, cov: card.cover, no: card.no, of: card.of }));
      document.body.appendChild(el); document.body.classList.add("fx-on");
      const audio = card.preview ? new Audio(card.preview) : null;
      if (audio) { audio.volume = .7; audio.play().catch(() => {}); }
      requestAnimationFrame(() => el.classList.add("on"));
      setTimeout(() => el.classList.add("show"), 1500);
      const close = () => { audio?.pause(); el.classList.remove("on"); document.body.classList.remove("fx-on"); setTimeout(() => { el.remove(); done(); }, 400); };
      const b = el.querySelector("button"); b.onclick = close; setTimeout(() => b.focus(), 1600);
    });
  },
};
window.Haunted = Haunted;

/* the board at the witch's: the 13 sounds, the copies still to come, who holds which number; and the Pack Hanté */
async function drawHaunted(box) {
  let d; try { d = await rpc("haunted_collection"); } catch (e) { box.remove(); return; }
  if (!d?.editions?.length) { box.remove(); return; }
  const out = d.editions.reduce((a, e) => a + e.copies.length, 0), all = d.editions.reduce((a, e) => a + e.of, 0);
  const pk = typeof W !== "undefined" ? W.st?.pumpkins || 0 : 0;
  box.innerHTML = `<h3 id="hxT">Collection Hantée</h3>
    <p class="sub">13 cartes à tirage limité, numérotées, qui n'existeront jamais ailleurs. Elles se cachent dans les boosters jusqu'au 2 novembre à minuit : toutes sortiront avant la fin, à toi de les trouver. <b>Thriller n'existe qu'en un seul exemplaire.</b></p>
    <div class="hx-bar"><div><b>${out}</b> / ${all} cartes sorties</div>
      <button class="btn primary hx-buy" id="hxPack"${pk < 100 ? " disabled" : ""}>🦇 Ouvrir un Pack Hanté · 100 🎃</button>
      <small>5 cartes Rare ou mieux · 20 fois plus de chances de trouver une carte Hantée</small></div>
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
}
