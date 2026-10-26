"use strict";
/* Zik Hunter — Noël (1 to 25 December): the Cartes Givrées (Christmas sounds in a few numbered copies, one of them a
   1/1), the Advent calendar (a door a day), the snowflakes (the currency of the event) and the Pack de Noël. The
   server decides everything; this file shows. */

/* a Carte Givrée: the sleeve sealed in a block of ice — a thick bevelled pane, frost ferns grown from the corners,
   a crack or two, snow fallen on the top edge with icicles under it; the 1/1 is tied with a red ribbon and gold */
const GC_SEED = s => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296; };
function gcFern(rnd, x, y, a, len, depth, out) {        // a frost fern: a stem that throws shorter twins at 60°
  const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
  out.push(`M${x.toFixed(2)} ${y.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}`);
  if (depth <= 0 || len < .9) return;
  const n = 2 + (rnd() * 3 | 0);
  for (let k = 1; k <= n; k++) {
    const f = k / (n + 1), bx = x + (x2 - x) * f, by = y + (y2 - y) * f, l = len * (.42 + rnd() * .2) * (1 - f * .5);
    gcFern(rnd, bx, by, a + Math.PI / 3, l, depth - 1, out); gcFern(rnd, bx, by, a - Math.PI / 3, l, depth - 1, out);
  }
  if (rnd() < .6) gcFern(rnd, x2, y2, a + (rnd() - .5) * .5, len * .55, depth - 1, out);
}
function gcFrost(seed) {
  const rnd = GC_SEED(seed), d = [];
  for (const [x, y, a0, big] of [[0, 0, .75, 1], [63, 0, 2.39, 1], [0, 88, -.75, .45], [63, 88, -2.39, .35]])   // light at the bottom: the title and the N° stay clear
    for (let k = 0; k < 3; k++) gcFern(rnd, x, y, a0 + (rnd() - .5) * 1.1, (9 + rnd() * 9) * big, big < 1 ? 2 : 3, d);
  const cracks = [];
  for (let k = 0; k < 2; k++) {                          // a crack across the ice, zigzag
    let x = rnd() * 63, y = rnd() < .5 ? 0 : 88; const dir = y ? -1 : 1; let p = `M${x.toFixed(1)} ${y}`;
    for (let s = 0; s < 6; s++) { x += (rnd() - .5) * 10; y += dir * (3 + rnd() * 5); p += `L${x.toFixed(1)} ${y.toFixed(1)}`; }
    cracks.push(p);
  }
  return `<svg class="gc-ferns" viewBox="0 0 63 88" preserveAspectRatio="none" aria-hidden="true"><path class="f" d="${d.join("")}"/><path class="c" d="${cracks.join("")}"/></svg>`;
}
function givreCardEl(c) {
  const one = c.of === 1, no = c.no === "?" ? "?" : String(c.no).padStart(String(c.of).length, "0");
  const el = document.createElement("div"); el.className = "gcard" + (one ? " one" : "");
  el.innerHTML = `<div class="gc-glow" aria-hidden="true"></div>
    <div class="gc-block">
      <div class="gc-paper">
        <img class="gc-art" src="${esc(c.cov)}" alt="Pochette de ${esc(c.t)}" loading="lazy" decoding="async">
        <div class="gc-cold" aria-hidden="true"></div>${gcFrost(c.t + c.a)}<div class="gc-sheen" aria-hidden="true"></div>
        <div class="gc-head"><span class="gc-flake" aria-hidden="true">❄</span><span>Édition givrée</span>${one ? `<span class="gc-uniq">Unique</span>` : ""}</div>
        <div class="gc-foot">
          <div class="gc-a">${esc(c.a)}</div>
          <div class="gc-t${c.t.length > 18 ? " xlong" : c.t.length > 10 ? " long" : ""}">${esc(c.t)}</div>
          <div class="gc-row"><span>Noël 2026</span><b class="gc-no"><small>N°</small>${no}<em>/${c.of}</em></b></div>
        </div>
      </div>
    </div>
    <svg class="gc-snow" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
      <path class="ice" d="M4 9 L7 9 8.2 17 9.4 9 15 9 16 13.5 17 9 26 9 27.6 19 29.2 9 37 9 38 12.5 39 9 47 9 48.5 16 50 9 58 9 59 13 60 9 69 9 70.8 18.5 72.6 9 80 9 81 12 82 9 89 9 90.4 15 91.8 9 96 9Z"/>
      <path class="cap" d="M1 11 C2 5 6 3 11 4 C15 1 22 2 26 4 C31 0 40 1 44 4 C49 1 57 1 61 4 C66 0 75 2 78 4 C83 1 92 2 95 5 C98 6 99.5 8 99 11 C70 9.5 30 9.5 1 11Z"/>
    </svg>
    ${one ? `<div class="gc-ribbon" aria-hidden="true"><i class="v"></i><i class="h"></i><b></b></div>` : ""}
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
