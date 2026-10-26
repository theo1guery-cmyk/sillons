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
// the outline of the block: broken ice — the edge in facets, with chips out of it and crystals sticking out
function gcEdge(seed) {
  const rnd = GC_SEED("edge" + seed), pts = [], W = 63, H = 88, step = 3.2;
  const side = (x0, y0, x1, y1, nx, ny) => {
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.round(len / step);
    for (let k = 0; k < n; k++) {
      const t = k / n, j = rnd() < .14 ? -(1.4 + rnd() * 1.8) : rnd() < .12 ? 1.3 + rnd() * 2.2 : (rnd() - .5) * 1.2;   // a chip, a crystal, or just uneven
      pts.push([x0 + (x1 - x0) * t + nx * j, y0 + (y1 - y0) * t + ny * j]);
    }
  };
  const m = 2.6;
  side(m, m, W - m, m, 0, -1); const top = pts.slice(); side(W - m, m, W - m, H - m, 1, 0); side(W - m, H - m, m, H - m, 0, 1); side(m, H - m, m, m, -1, 0);
  const poly = pts.map(([x, y]) => `${(x / W * 100).toFixed(2)}% ${(y / H * 100).toFixed(2)}%`).join(",");
  const path = "M" + pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L") + "Z";
  // facets: a few lines from the edge inwards, as on a cut block
  const fac = pts.filter((_, i) => i % 5 === 2).map(([x, y]) => { const cx = W / 2, cy = H / 2, f = .12 + rnd() * .1; return `M${x.toFixed(2)} ${y.toFixed(2)}L${(x + (cx - x) * f).toFixed(2)} ${(y + (cy - y) * f).toFixed(2)}`; }).join("");
  return { poly, path, fac, top };
}
// snow lying on the top edge: it follows the broken ice, thick in the middle and thin at the ends, its top soft and
// lumpy, a little overhang that droops at both ends, shaded blue underneath; icicles under it, of uneven lengths
function gcSnow(seed, top) {
  const rnd = GC_SEED("snow" + seed), W = 63, n = top.length;
  const lump = Array.from({ length: n }, () => rnd());
  const up = top.map(([x, y], i) => {
    const t = i / (n - 1), th = 3.3 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, (t - .02) / .96))), .55) + (lump[i] - .5) * .9 + .5;
    return [x, y - Math.max(.4, th)];
  });
  const L = [top[0][0] - 1.4, top[0][1] + 1.6], R = [top[n - 1][0] + 1.6, top[n - 1][1] + 1.4];   // the overhang droops at the ends
  let d = `M${L[0].toFixed(2)} ${L[1].toFixed(2)}Q${(L[0] - .4).toFixed(2)} ${(up[0][1] + .6).toFixed(2)} ${up[0][0].toFixed(2)} ${up[0][1].toFixed(2)}`;
  for (let i = 1; i < n; i++) { const [x0, y0] = up[i - 1], [x1, y1] = up[i]; d += `Q${x0.toFixed(2)} ${(y0 - .5).toFixed(2)} ${((x0 + x1) / 2).toFixed(2)} ${((y0 + y1) / 2 - .25).toFixed(2)}`; if (i === n - 1) d += `T${x1.toFixed(2)} ${y1.toFixed(2)}`; }
  d += `Q${(R[0] + .5).toFixed(2)} ${(up[n - 1][1] + .5).toFixed(2)} ${R[0].toFixed(2)} ${R[1].toFixed(2)}`;
  for (let i = n - 1; i >= 0; i--) { const [x, y] = top[i]; d += `L${x.toFixed(2)} ${(y + .5 + (i % 2) * .35).toFixed(2)}`; }   // the underside, a little ragged
  d += "Z";
  const hi = "M" + up.slice(2, n - 2).map(([x, y]) => `${x.toFixed(2)} ${(y + .55).toFixed(2)}`).join("L");   // the light on the top of the snow
  let ice = "";
  for (let k = 0; k < 9; k++) {
    const i = 1 + (rnd() * (n - 2) | 0), [x, y] = top[i], w = .7 + rnd() * 1.1, h = rnd() < .35 ? 4 + rnd() * 5 : 1.5 + rnd() * 2.5;
    ice += `M${(x - w).toFixed(2)} ${(y + .3).toFixed(2)}Q${(x - w * .3).toFixed(2)} ${(y + h * .55).toFixed(2)} ${x.toFixed(2)} ${(y + h).toFixed(2)}Q${(x + w * .3).toFixed(2)} ${(y + h * .55).toFixed(2)} ${(x + w).toFixed(2)} ${(y + .3).toFixed(2)}Z`;
  }
  const dots = Array.from({ length: 10 }, () => { const i = 2 + (rnd() * (n - 4) | 0), [x, y] = up[i]; return `<circle cx="${(x + (rnd() - .5) * 2).toFixed(2)}" cy="${(y + .8 + rnd() * 1.4).toFixed(2)}" r="${(.12 + rnd() * .16).toFixed(2)}"/>`; }).join("");
  return `<svg class="gc-snow" viewBox="0 0 63 88" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="gcS${seed.length}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#f2f9ff"/><stop offset="1" stop-color="#bcd8f0"/></linearGradient>
      <linearGradient id="gcI${seed.length}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4fbff" stop-opacity=".95"/><stop offset="1" stop-color="#9fd2ff" stop-opacity=".35"/></linearGradient></defs>
    <path class="ice" d="${ice}" fill="url(#gcI${seed.length})"/><path class="cap" d="${d}" fill="url(#gcS${seed.length})"/><path class="hi" d="${hi}"/><g class="glit">${dots}</g></svg>`;
}
function givreCardEl(c) {
  const one = c.of === 1, no = c.no === "?" ? "?" : String(c.no).padStart(String(c.of).length, "0");
  const el = document.createElement("div"); el.className = "gcard" + (one ? " one" : "");
  const edge = gcEdge(c.t + c.a);
  el.style.setProperty("--gc-edge", `polygon(${edge.poly})`);
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
    <svg class="gc-rim" viewBox="0 0 63 88" preserveAspectRatio="none" aria-hidden="true"><path class="r" d="${edge.path}"/><path class="r2" d="${edge.path}"/><path class="fa" d="${edge.fac}"/></svg>
    ${gcSnow(c.t + c.a, edge.top)}
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
