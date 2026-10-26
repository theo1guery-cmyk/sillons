"use strict";
/* Zik Hunter — Noël (1 to 25 December): the Cartes Givrées (Christmas sounds in a few numbered copies, one of them a
   1/1), the Advent calendar (a door a day), the snowflakes (the currency of the event) and the Pack de Noël. The
   server decides everything; this file shows. */

/* a Carte Givrée: the sleeve under a pane of frost, icicles hanging from the top, a rim of ice that glints; the 1/1
   wears a red ribbon and gold */
function givreCardEl(c) {
  const one = c.of === 1, no = c.no === "?" ? "?" : String(c.no).padStart(String(c.of).length, "0");
  const el = document.createElement("div"); el.className = "gcard" + (one ? " one" : "");
  el.innerHTML = `<div class="gc-glow" aria-hidden="true"></div>
    <div class="gc-paper">
      <img class="gc-art" src="${esc(c.cov)}" alt="Pochette de ${esc(c.t)}" loading="lazy" decoding="async">
      <div class="gc-tint" aria-hidden="true"></div><div class="gc-frost" aria-hidden="true"></div>
      <div class="gc-head"><span>Édition givrée</span>${one ? `<span class="gc-uniq">Unique</span>` : ""}</div>
      <div class="gc-foot">
        <div class="gc-a">${esc(c.a)}</div>
        <div class="gc-t${c.t.length > 18 ? " xlong" : c.t.length > 10 ? " long" : ""}">${esc(c.t)}</div>
        <div class="gc-row"><span>Noël 2026</span><b class="gc-no"><small>N°</small>${no}<em>/${c.of}</em></b></div>
      </div>
    </div>
    <div class="gc-rim" aria-hidden="true"></div>
    <svg class="gc-icicles" viewBox="0 0 100 14" preserveAspectRatio="none" aria-hidden="true"><path d="M0 0H100V2 L97 2 95.5 9 94 2 90 2 88.8 6 87.5 2 82 2 80 12 78 2 73 2 72 5.5 71 2 66 2 64.5 8 63 2 58 2 57 4.5 56 2 50 2 48.2 11 46.5 2 41 2 40 6 39 2 34 2 32.6 8.5 31.2 2 26 2 25 4.5 24 2 19 2 17.5 10 16 2 11 2 10 5 9 2 5 2 3.8 7.5 2.6 2 0 2Z"/></svg>
    ${one ? `<div class="gc-ribbon" aria-hidden="true"><i></i><b></b></div>` : ""}
    <div class="gc-spark" aria-hidden="true">${"<i></i>".repeat(6)}</div>`;
  const w = document.createElement("div"); w.className = "cq"; w.appendChild(el);
  return w;
}
window.givreCardEl = givreCardEl;

/* the Advent calendar: 24 wooden doors in a frame, opened ones show their present; today's glows */
const ADVENT = Array.from({ length: 24 }, (_, i) => i + 1);
function adventEl(st) {   // st: { today, opened: [days], gifts: { day: label } }
  const el = document.createElement("div"); el.className = "adv";
  el.innerHTML = `<div class="adv-top"><b>Calendrier de l'Avent</b><small>une porte par jour, du 1er au 24 décembre</small></div>
    <div class="adv-grid">${[3, 17, 8, 22, 1, 12, 19, 6, 14, 24, 10, 4, 20, 15, 7, 11, 23, 2, 16, 9, 21, 5, 18, 13].map(d => {
      const open = st.opened.includes(d), today = d === st.today, late = d < st.today && !open, soon = d > st.today;
      return `<button class="adv-d${open ? " open" : ""}${today ? " today" : ""}${late ? " late" : ""}${soon ? " soon" : ""}${d === 24 ? " big" : ""}" data-d="${d}" ${soon ? "disabled" : ""}>
        <span class="adv-in">${open ? `<em>${esc(st.gifts[d] || "")}</em>` : ""}</span><span class="adv-door"><b>${d}</b>${d === 24 ? "<i>🎁</i>" : ""}</span></button>`;
    }).join("")}</div>`;
  return el;
}
window.Noel = { card: givreCardEl, advent: adventEl };
