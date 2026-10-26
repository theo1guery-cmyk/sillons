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
      <svg class="w-fig" viewBox="0 0 200 260" aria-hidden="true" data-step="${cur}">
        <ellipse class="w-ground" cx="100" cy="246" rx="92" ry="12"/>
        <circle class="p base" cx="100" cy="200" r="48"/>
        <circle class="p body" cx="100" cy="132" r="36"/>
        <circle class="p head" cx="100" cy="80" r="26"/>
        <g class="p face"><circle cx="91" cy="74" r="3.4"/><circle cx="109" cy="74" r="3.4"/><path d="M100 82 l20 5 -20 3z" class="carrot"/><circle cx="100" cy="122" r="3"/><circle cx="100" cy="136" r="3"/><circle cx="100" cy="150" r="3"/></g>
        <g class="p scarf"><path d="M72 100 q28 14 56 0 l0 10 q-28 14 -56 0z"/><path d="M114 104 l8 40 -12 -2z"/></g>
        <g class="p hat"><rect x="74" y="50" width="52" height="7" rx="2"/><rect x="82" y="16" width="36" height="36" rx="3"/><rect x="82" y="42" width="36" height="6" class="band"/></g>
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
window.Winter = { storm: winterStorm, snowman: winterSnowman, STEPS: SNOW_STEPS };
