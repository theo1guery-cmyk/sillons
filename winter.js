"use strict";
/* Zik Hunter — Saison 2 · Tournée d'Hiver: the snowstorms (a quarter of an hour, at a surprise time, the boosters
   give better cards) and the snowman everyone builds together (each booster opened adds snow; each step finished
   gives a present to every player of the season). The server decides; this file shows. */
const WINTER = { storm: null, man: null, timer: 0 };
const SNOW_STEPS = [
  { k: "base", n: "La base", gift: "2 boosters" }, { k: "body", n: "Le corps", gift: "2 000 Streams" }, { k: "head", n: "La tête", gift: "1 Grand booster" },
  { k: "face", n: "Les yeux et la carotte", gift: "60 Vinyles" }, { k: "scarf", n: "L'écharpe", gift: "1 carte Mythique" }, { k: "hat", n: "Le chapeau", gift: "1 carte Légendaire" }];

/* the banner of a storm, on top of every page while it lasts, with snow falling over the screen */
function winterStorm(ends) {
  let el = document.getElementById("wStorm");
  if (!ends || Date.parse(ends) <= Date.now()) { el?.remove(); document.body.classList.remove("w-storm"); clearInterval(WINTER.timer); return; }
  if (!el) {
    el = document.createElement("div"); el.id = "wStorm"; el.className = "w-storm"; el.setAttribute("role", "status");
    el.innerHTML = `<div class="w-snow" aria-hidden="true">${"<i></i>".repeat(28)}</div>
      <div class="w-bar"><span class="w-ico" aria-hidden="true">🌨️</span><b>Tempête de neige !</b><span class="w-what">Chances de Mythique et de Légendaire doublées · +50 % d'XP de Pass</span><span class="w-left"></span></div>`;
    document.body.appendChild(el); document.body.classList.add("w-storm");
  }
  const tick = () => {
    const s = Math.max(0, Math.round((Date.parse(ends) - Date.now()) / 1000));
    el.querySelector(".w-left").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    if (!s) winterStorm(null);
  };
  clearInterval(WINTER.timer); WINTER.timer = setInterval(tick, 1000); tick();
}

/* the snowman of everyone, on the Pass page: it grows step by step, each step lights up its present */
function winterSnowman(box, d) {
  const step = d.steps.findIndex(s => d.packs < s), cur = step < 0 ? SNOW_STEPS.length : step;
  const from = cur ? d.steps[cur - 1] : 0, to = d.steps[cur] || d.steps[d.steps.length - 1];
  const pct = cur >= SNOW_STEPS.length ? 100 : Math.min(100, (d.packs - from) / (to - from) * 100);
  box.innerHTML = `<div class="w-man">
      <svg class="w-fig" viewBox="0 0 220 280" aria-hidden="true" data-step="${cur}">
        <defs>
          <radialGradient id="wSnowG" cx=".36" cy=".3" r=".8"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#eef7ff"/><stop offset=".85" stop-color="#c3dcf2"/><stop offset="1" stop-color="#9fbedb"/></radialGradient>
          <radialGradient id="wDrift" cx=".5" cy=".2" r=".7"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#b9d4ec"/></radialGradient>
          <linearGradient id="wCarrot" x1="0" x2="1"><stop offset="0" stop-color="#ffb04a"/><stop offset="1" stop-color="#e2611c"/></linearGradient>
          <linearGradient id="wHat" x1="0" x2="1"><stop offset="0" stop-color="#1b1b26"/><stop offset=".35" stop-color="#3a3a4c"/><stop offset=".55" stop-color="#1f1f2b"/><stop offset="1" stop-color="#0d0d14"/></linearGradient>
          <pattern id="wKnit" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#d42f45"/><rect width="10" height="4" fill="#f4f1ea"/><path d="M0 7 l2.5 2 l2.5 -2 l2.5 2 l2.5 -2" stroke="#a51f33" stroke-width="1" fill="none"/></pattern>
        </defs>
        <ellipse class="w-shadow" cx="110" cy="262" rx="78" ry="9"/>
        <path class="w-drift" d="M6 266 q30 -22 64 -10 q22 -16 50 -4 q30 -14 58 2 q24 -8 36 12 z"/>
        <g class="p base"><circle cx="110" cy="214" r="50"/><path class="w-lump" d="M68 236 q16 14 42 14 q26 0 42 -14"/></g>
        <g class="p arms"><path d="M76 146 l-40 -22 M52 132 l-8 -14 M54 133 l-14 2" /><path d="M144 146 l40 -24 M168 132 l6 -15 M170 131 l13 4"/></g>
        <g class="p body"><circle cx="110" cy="146" r="38"/><circle class="coal" cx="110" cy="132" r="3.6"/><circle class="coal" cx="110" cy="148" r="3.6"/><circle class="coal" cx="110" cy="164" r="3.6"/></g>
        <g class="p head"><circle cx="110" cy="90" r="28"/></g>
        <g class="p face"><circle class="coal" cx="100" cy="84" r="3.4"/><circle class="coal" cx="120" cy="84" r="3.4"/>
          <circle class="glint" cx="101.2" cy="82.8" r="1"/><circle class="glint" cx="121.2" cy="82.8" r="1"/>
          <path class="carrot" d="M108 92 q2 -4 6 -3 l26 8 q2 1 0 2 l-28 2 q-4 -2 -4 -9z"/><path class="carrot-l" d="M118 92 l1 5 M126 94 l1 4"/>
          <g class="coal">${[[98,101],[103,104],[109,105],[115,104],[120,101]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="1.9"/>`).join("")}</g></g>
        <g class="p scarf"><path d="M80 112 q30 16 60 0 l2 12 q-32 18 -64 0z" fill="url(#wKnit)"/><path d="M126 118 l10 44 l-14 2 l-6 -42z" fill="url(#wKnit)"/>
          <path class="fringe" d="M122 164 l-1 7 M126 164 l0 7 M130 163 l1 7 M134 162 l2 7"/></g>
        <g class="p hat"><ellipse cx="110" cy="66" rx="34" ry="7" fill="url(#wHat)"/><path d="M90 66 l3 -44 q17 -6 34 0 l3 44 q-20 5 -40 0z" fill="url(#wHat)"/>
          <path class="band" d="M91 56 q19 5 38 0 l-.6 -8 q-18.4 5 -36.8 0z"/><path class="holly" d="M122 50 q6 -6 10 0 q-6 4 -10 0z M122 50 q2 -8 8 -9 q-1 7 -8 9z"/><circle class="berry" cx="121" cy="51" r="2.4"/></g>
        <g class="w-sparks"><path d="M30 60 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2z"/><path d="M190 40 l1.5 4.5 4.5 1.5 -4.5 1.5 -1.5 4.5 -1.5 -4.5 -4.5 -1.5 4.5 -1.5z"/><path d="M186 176 l1.5 4.5 4.5 1.5 -4.5 1.5 -1.5 4.5 -1.5 -4.5 -4.5 -1.5 4.5 -1.5z"/></g>
      </svg>
      <div class="w-info">
        <p class="w-kick">Le bonhomme de neige de tout le monde</p>
        <h3>${cur >= SNOW_STEPS.length ? "Il est fini, bravo à tous ! ⛄" : `Étape ${cur + 1} / ${SNOW_STEPS.length} · ${SNOW_STEPS[cur].n}`}</h3>
        <div class="w-meter"><s style="width:${pct.toFixed(1)}%"></s></div>
        <p class="w-count"><b>${fmt(d.packs)}</b> boosters ouverts par tous les joueurs${cur < SNOW_STEPS.length ? ` · encore <b>${fmt(to - d.packs)}</b> pour ${SNOW_STEPS[cur].n.toLowerCase()}` : ""}</p>
        <ol class="w-gifts">${SNOW_STEPS.map((s, i) => `<li class="${i < cur ? "done" : i === cur ? "now" : ""}"><span>${i < cur ? "✓" : i + 1}</span><b>${s.n}</b><small>${s.gift}${i < cur && d.claimed?.includes(i + 1) ? " · reçu" : ""}</small></li>`).join("")}</ol>
        <p class="w-fine">Chaque booster ouvert par n'importe quel joueur ajoute de la neige. À chaque étape, tous les joueurs qui ont ouvert au moins un booster pendant la saison reçoivent le cadeau.</p>
      </div></div>`;
}
/* the presents of the steps finished, taken once a session (and when the pass page opens): told with a toast */
async function winterClaim() {
  let got = [];
  try { got = await rpc("winter_claim") || []; } catch (e) { return; }
  if (!got.length) return;
  toast(`⛄ Le bonhomme de neige avance ! Cadeau${got.length > 1 ? "x" : ""} reçu${got.length > 1 ? "s" : ""} : ${got.map(k => SNOW_STEPS[k - 1].gift).join(", ")}.`);
  try { await loadProfile(); renderCounters?.(); } catch (e) {}
}
window.Winter = { storm: winterStorm, snowman: winterSnowman, claim: winterClaim, STEPS: SNOW_STEPS };
