"use strict";
/* Zik Hunter — the announcement of an event: full screen "stories" that play by themselves (tap to go on), shown once
   to each player when the event starts. Halloween: the night, the pumpkins, the cauldron and the elixir. */
const EI = { shown: false, KEY: "zh-event-intro-halloween-2026" };
function eventIntroMaybe() {
  if (EI.shown || EVENT.on !== "halloween" || !Online.active || !me) return;
  try { if (localStorage.getItem(EI.KEY)) return; } catch (e) {}
  if (document.querySelector(".op:not([hidden])") || document.body.classList.contains("fx-on") || document.querySelector(".adm-screen")) return;   // later
  halloweenIntro();
}
setInterval(eventIntroMaybe, 4000);

const BAT_SVG = `<svg viewBox="0 0 64 34"><path d="M32 13c-1.6-2.6-3.4-3.6-5-3.4.9 1.2 1 2.6.4 3.8C24 10 19.5 8.4 14 9.3c2.7 1.3 4.4 3.3 4.6 5.6-3.8-1.7-8.7-1.8-13.6.3 3.9.8 6.6 2.9 7.6 5.8 4-2.3 9-2.6 13-.7 1.3.7 2.9 2.2 4.4 4.2 1.5-2 3.1-3.5 4.4-4.2 4-1.9 9-1.6 13 .7 1-2.9 3.7-5 7.6-5.8-4.9-2.1-9.8-2-13.6-.3.2-2.3 1.9-4.3 4.6-5.6-5.5-.9-10 .7-13.4 4.1-.6-1.2-.5-2.6.4-3.8-1.6-.2-3.4.8-5 3.4z"/></svg>`;
function halloweenIntro() {
  EI.shown = true;
  try { localStorage.setItem(EI.KEY, "1"); } catch (e) {}
  // letters that drop one by one, but a word never breaks in the middle
  const word = s => { let k = 0; return s.split(" ").map(w => `<span class="w">${[...w].map(ch => `<span style="--k:${k++}">${esc(ch)}</span>`).join("")}</span>`).join(" "); };
  const quests = [["Ouvre 10 boosters", 15], ["Ouvre 30 boosters", 20], ["Tire une Épique ou mieux", 10], ["Réussis tes 3 défis du jour", 15], ["Gagne un clash blind test", 10]];
  const slides = [
    `<div class="si-s"><p class="si-kick">Événement Halloween</p><h2 class="si-big">${word("La Nuit")}<br>${word("des Sillons hantés")}</h2>
      <p class="si-line">Pour quelques nuits seulement, le site s'habille de noir et d'orange… et une sorcière ouvre son chaudron.</p>
      <div class="ei-bats">${Array.from({ length: 6 }, (_, i) => `<i style="--i:${i}">${BAT_SVG}</i>`).join("")}</div></div>`,
    `<div class="si-s"><p class="si-kick">Les quêtes de la nuit</p><h2>Gagne des citrouilles 🎃</h2>
      <div class="ei-quests">${quests.map(([t, n], i) => `<div style="--i:${i}"><span>${esc(t)}</span><b data-n="${n}">+0</b><em>🎃</em></div>`).join("")}</div>
      <p class="si-line">Jusqu'à <b>70 citrouilles par nuit</b>. Les quêtes reviennent chaque jour à minuit.</p></div>`,
    `<div class="si-s"><p class="si-kick">Chez la sorcière</p><h2>Le chaudron de transmutation</h2>
      <div class="ei-pot"><div class="ei-falls">${Array.from({ length: 5 }, (_, i) => `<i style="--i:${i}"></i>`).join("")}</div><div class="ei-cauldron"><span></span></div></div>
      <div class="si-chips">${[["5 Rares → une Épique", "20 🎃"], ["5 Épiques → une Mythique", "40 🎃"], ["5 Mythiques → une Légendaire (1 chance sur 2)", "80 🎃"]]
        .map(([t, p], i) => `<span style="--i:${i}">${esc(t)} · <b>${p}</b></span>`).join("")}</div></div>`,
    `<div class="si-s"><p class="si-kick">Chez la sorcière</p><h2>L'élixir de restauration</h2>
      <div class="ei-elix"><div class="ei-bottle"></div><div class="ei-drops"><i></i><i></i><i></i></div><div class="ei-grade"><b>8</b><b>9</b></div></div>
      <p class="si-line">Verse-le sur une carte gradée : elle tente de gagner <b>+1 à sa note</b>, jusqu'à 9. Si ça rate, tu ne perds que les citrouilles. <b>30 🎃</b> la fiole.</p></div>`,
    `<div class="si-s"><p class="si-kick">Attention</p><h2 class="si-big">${word("La magie")}<br>${word("ne dure pas")}</h2>
      <p class="si-line">À la fin de l'événement, le chaudron s'éteint et les citrouilles disparaissent : utilise-les avant !</p>
      <div class="si-cta"><button class="btn primary" data-go="witch">Ouvrir le chaudron</button><button class="btn" data-go="close">Plus tard</button></div></div>`];
  stories(slides, "ei");
}

// the stories player: progress bars, a slide every few seconds, tap on the right to go on, on the left to go back
function stories(slides, cls) {
  const el = document.createElement("div"); el.className = "si " + cls; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Annonce");
  el.innerHTML = `<div class="si-bg" aria-hidden="true"><i class="b1"></i><i class="b2"></i><i class="b3"></i><span class="si-moon"></span><span class="si-fog"></span></div>
    <div class="si-bars">${slides.map(() => `<span><i></i></span>`).join("")}</div>
    <button class="si-x" aria-label="Fermer">✕</button><div class="si-stage"></div><p class="si-tap">Touche pour continuer</p>`;
  document.body.appendChild(el); document.body.classList.add("fx-on");
  const stage = el.querySelector(".si-stage"), bars = [...el.querySelectorAll(".si-bars i")];
  let i = -1, timer = 0;
  const DUR = 6500;
  const close = () => { clearTimeout(timer); el.classList.add("out"); removeEventListener("keydown", keys, true); setTimeout(() => { el.remove(); document.body.classList.remove("fx-on"); }, 400); };
  const go = n => {
    if (n < 0) n = 0;
    if (n >= slides.length) return;
    i = n; clearTimeout(timer);
    bars.forEach((b, k) => { b.style.transition = "none"; b.style.width = k < i ? "100%" : "0%"; });
    stage.innerHTML = slides[i]; el.dataset.last = i === slides.length - 1 ? "1" : "";
    if (i < slides.length - 1) { requestAnimationFrame(() => requestAnimationFrame(() => { bars[i].style.transition = `width ${DUR}ms linear`; bars[i].style.width = "100%"; })); timer = setTimeout(() => go(i + 1), DUR); }
    else bars[i].style.width = "100%";
    stage.querySelectorAll("[data-n]").forEach((b, k) => {       // the numbers count up
      const n = +b.dataset.n, t0 = performance.now() + 400 + k * 180;
      const step = t => { const p = Math.min(1, Math.max(0, (t - t0) / 600)); b.textContent = "+" + Math.round(n * p); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
    stage.querySelectorAll("[data-go]").forEach(b => b.onclick = e => { e.stopPropagation(); close(); if (b.dataset.go !== "close") show(b.dataset.go); });
  };
  const keys = e => { if (e.key === "Escape") close(); else if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); go(i + 1); } else if (e.key === "ArrowLeft") go(i - 1); };
  el.addEventListener("click", e => { if (e.target.closest(".si-x")) return close(); if (e.target.closest("button")) return; e.clientX < innerWidth * .3 ? go(i - 1) : go(i + 1); });
  addEventListener("keydown", keys, true);
  go(0);
}
Object.assign(Online, { halloweenIntro: () => halloweenIntro() });
