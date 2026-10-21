"use strict";
/* Zik Hunter — site events (settings.event, switched from the admin page). Halloween: the night falls on the site —
   a pumpkin moon, mist, embers, cobwebs in the corners and a few bats now and then. Purely decorative. */
const EVENT = { on: null, timer: 0 };
async function eventCheck() {
  let e = null;
  try { const { data } = await sb.from("settings").select("event").single(); e = data?.event || null; } catch (err) { return; }
  eventApply(e);
}
function eventApply(e) {
  if (e === EVENT.on) return;
  EVENT.on = e;
  document.querySelectorAll("#evLayer,.ev-side,.ev-banner").forEach(x => x.remove()); clearInterval(EVENT.timer);
  if (e) document.documentElement.dataset.event = e; else delete document.documentElement.dataset.event;
  if (e === "halloween") halloween();
}
const BAT = `<svg viewBox="0 0 64 34" aria-hidden="true"><path d="M32 13c-1.6-2.6-3.4-3.6-5-3.4.9 1.2 1 2.6.4 3.8C24 10 19.5 8.4 14 9.3c2.7 1.3 4.4 3.3 4.6 5.6-3.8-1.7-8.7-1.8-13.6.3 3.9.8 6.6 2.9 7.6 5.8 4-2.3 9-2.6 13-.7 1.3.7 2.9 2.2 4.4 4.2 1.5-2 3.1-3.5 4.4-4.2 4-1.9 9-1.6 13 .7 1-2.9 3.7-5 7.6-5.8-4.9-2.1-9.8-2-13.6-.3.2-2.3 1.9-4.3 4.6-5.6-5.5-.9-10 .7-13.4 4.1-.6-1.2-.5-2.6.4-3.8-1.6-.2-3.4.8-5 3.4z"/></svg>`;
const PUMPKIN = (x, y, k) => `<g class="ev-pk" transform="translate(${x} ${y}) scale(${k})">
  <ellipse cx="-8" cy="0" rx="9" ry="10.5" fill="#c94f12"/><ellipse cx="8" cy="0" rx="9" ry="10.5" fill="#c94f12"/><ellipse cx="0" cy="0" rx="10.5" ry="11.5" fill="#e8661c"/>
  <path d="M-1 -11 q1 -5 4 -6" stroke="#3b5a1e" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  <g class="ev-face" fill="#ffd36b"><path d="M-8 -4 l3 -5 l3 5z"/><path d="M2 -4 l3 -5 l3 5z"/><path d="M-1.2 -1 l1.2 -2.4 l1.2 2.4z"/>
  <path d="M-9 3 q9 7 18 0 l-2 1 l-1.5 -2 l-2 2.4 l-2.5 -2.4 l-2.5 2.4 l-2 -2.4 l-1.5 2z"/></g></g>`;
const GRAVEYARD = `<svg viewBox="0 0 236 160" preserveAspectRatio="xMidYMax meet">
  <defs><radialGradient id="evGlow"><stop offset="0" stop-color="#ff9a3a" stop-opacity=".55"/><stop offset="1" stop-color="#ff9a3a" stop-opacity="0"/></radialGradient></defs>
  <g fill="none" stroke="#08050c" stroke-linecap="round">
    <path d="M38 160 C38 128 33 104 40 80 C45 64 38 52 26 42" stroke-width="7"/>
    <path d="M39 96 C50 86 62 82 72 70 M70 72 C76 66 78 60 84 58 M36 112 C24 104 15 101 6 92 M41 80 C45 70 54 63 56 50 M28 46 C20 42 16 34 18 26 M56 52 C62 46 66 40 64 32" stroke-width="3"/>
    <path d="M72 70 C80 72 86 70 92 64 M18 26 C14 22 12 16 14 12 M6 92 C2 90 -2 88 -4 84" stroke-width="1.6"/></g>
  <circle cx="104" cy="138" r="26" fill="url(#evGlow)" class="ev-glow"/><circle cx="196" cy="142" r="20" fill="url(#evGlow)" class="ev-glow g2"/>
  <path d="M0 160 V134 Q50 122 110 130 T236 126 V160 Z" fill="#07040a"/>
  <path d="M138 134 v-26 a13 13 0 0 1 26 0 v26 z" fill="#120b19" stroke="rgba(233,222,247,.12)"/>
  <path d="M146 118 h10 M151 113 v12" stroke="rgba(233,222,247,.18)" stroke-width="1.6"/>
  <path d="M172 136 v-16 h-6 v-5 h6 v-6 h5 v6 h6 v5 h-6 v16 z" fill="#120b19" stroke="rgba(233,222,247,.1)"/>
  <path d="M212 134 v-18 a9 9 0 0 1 18 0 v18 z" fill="#100a16" stroke="rgba(233,222,247,.08)"/>
  ${PUMPKIN(104, 140, 1.15)}${PUMPKIN(196, 143, .9)}
</svg>`;
function web(size, flip) {           // a cobweb in a corner: threads from the corner, and sagging rings between them
  const n = 7, R = size, rings = [.22, .42, .62, .82, .98], ang = i => (Math.PI / 2) * (i / (n - 1));
  const pt = (r, i) => [Math.cos(ang(i)) * r * R, Math.sin(ang(i)) * r * R];
  let d = "";
  for (let i = 0; i < n; i++) { const [x, y] = pt(1.05, i); d += `M0 0L${x.toFixed(1)} ${y.toFixed(1)}`; }
  for (const r of rings) for (let i = 0; i < n - 1; i++) {
    const [x1, y1] = pt(r, i), [x2, y2] = pt(r, i + 1), [mx, my] = pt(r * .9, i + .5);
    d += `M${x1.toFixed(1)} ${y1.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }
  return `<svg class="ev-web${flip ? " r" : ""}" viewBox="0 0 ${R} ${R}" width="${R}" height="${R}" aria-hidden="true"><path d="${d}"/>
    <g class="ev-spider" transform="translate(${(R * .55).toFixed(0)} 0)"><line x1="0" y1="0" x2="0" y2="${(R * .5).toFixed(0)}"/><circle cx="0" cy="${(R * .5 + 4).toFixed(0)}" r="4"/></g></svg>`;
}
function halloween() {
  const L = document.createElement("div"); L.id = "evLayer"; L.className = "ev-layer"; L.setAttribute("aria-hidden", "true");
  const embers = Array.from({ length: 18 }, () => `<i style="--x:${(Math.random() * 100).toFixed(1)}%;--d:${(9 + Math.random() * 10).toFixed(1)}s;--w:${(-Math.random() * 18).toFixed(1)}s;--s:${(.5 + Math.random()).toFixed(2)}"></i>`).join("");
  L.innerHTML = `<div class="ev-moon"></div><div class="ev-fog f1"></div><div class="ev-fog f2"></div><div class="ev-embers">${embers}</div>
    ${web(170, false)}${web(130, true)}<div class="ev-bats"></div>`;
  document.body.appendChild(L);
  // the sidebar: a banner under the logo, and a graveyard at the bottom with two lit pumpkins
  const side = document.querySelector(".sidebar");
  if (side) {
    side.querySelector(".side-logo")?.insertAdjacentHTML("afterend", `<div class="ev-banner"><span aria-hidden="true">🎃</span><div><b>Nuit des Sillons hantés</b><small>Événement Halloween</small></div></div>`);
    side.insertAdjacentHTML("beforeend", `<div class="ev-side" aria-hidden="true">${GRAVEYARD}</div>`);
  }
  const bats = L.querySelector(".ev-bats");
  const flock = () => {                 // a few bats cross the screen now and then
    if (document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const n = 2 + Math.floor(Math.random() * 3), top = 8 + Math.random() * 40, ltr = Math.random() < .5;
    for (let k = 0; k < n; k++) {
      const b = document.createElement("span"); b.className = "ev-bat" + (ltr ? "" : " rtl"); b.innerHTML = BAT;
      b.style.cssText = `--y:${(top + (Math.random() * 10 - 5)).toFixed(1)}vh;--dl:${(k * .35 + Math.random() * .3).toFixed(2)}s;--sz:${(22 + Math.random() * 16).toFixed(0)}px;--dur:${(6 + Math.random() * 3).toFixed(1)}s`;
      bats.appendChild(b); setTimeout(() => b.remove(), 11000);
    }
  };
  setTimeout(flock, 2500); EVENT.timer = setInterval(flock, 16000);
}
eventCheck(); setInterval(eventCheck, 120000);
Object.assign(Online, { eventApply });
