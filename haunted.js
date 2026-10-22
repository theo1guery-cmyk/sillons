"use strict";
/* Zik Hunter — the "Collection Hantée" (Halloween): 13 sounds, each printed in a few numbered copies only (Thriller 1/1).
   No rarity: they all wear the same card, a sleeve in a haunted-manor window. */
function hauntedCardEl(c) {
  const one = c.of === 1, no = String(c.no).padStart(String(c.of).length, "0");
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
