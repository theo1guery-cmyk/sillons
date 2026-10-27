"use strict";
/* Zik Hunter — the big announcement of a release, shown once to each player after it (a full screen of what is new,
   and what comes next). The content is here; NEWS.KEY changes with each big release. */
const NEWS = {
  KEY: "zh-news-2026-11-compet",
  kick: "Mise à jour · Le compétitif est là",
  title: "Que la bataille commence",
  sub: "Ta collection devient ton armée. Monte de Bronze à Légende, grimpe dans les classements et rafle des lots chaque semaine.",
  feats: [
    { ico: "⚔️", t: "La Bataille de cartes", d: "Ton deck de 5 cartes contre celui d'un joueur de ton niveau. À chaque manche, une stat tirée au sort (Tempo, Endurance, Hype ou Puissance) : joue la bonne carte au bon moment. 3 manches et c'est gagné, avec 100 Streams pour tes 5 premières victoires du jour.", c: "#e7b14a" },
    { ico: "🛡️", t: "Les ligues classées", d: "Chaque victoire rapporte des trophées : Bronze, Argent, Or, Platine, Diamant, puis Légende. Ton deck défend aussi quand on t'attaque. À la fin de la saison, un cadeau selon ta ligue, jusqu'à une Légendaire Shiny.", c: "#ff5f9e" },
    { ico: "👥", t: "Défie tes amis", d: "Une bataille amicale contre le deck d'un ami, ou un vrai combat en direct s'il est en ligne : chacun choisit sa carte en même temps, 25 secondes par manche.", c: "#57e389" },
    { ico: "📊", t: "Les classements", d: "Collection, trophées, Légendaires, clash, défi de la semaine, tournoi : six classements, entre tous les joueurs ou seulement entre amis.", c: "#59b8ff" },
    { ico: "🎯", t: "Le défi de la semaine", d: "Chaque lundi, un nouvel objectif pour tout le monde. Le top 10 gagne gros : une Légendaire et 5 000 Streams pour le premier.", c: "#ff8a3d", tag: "Chaque semaine" },
    { ico: "🏟️", t: "Le tournoi du week-end", d: "Samedi et dimanche, chaque Bataille compte : 3 points par victoire, 1 par défaite. Mêmes lots pour le top 10, podium annoncé sur le Discord.", c: "#a78bfa", tag: "Samedi et dimanche" },
  ],
  soonKick: "Et ce n'est pas fini", soonTitle: "Décembre s'annonce chargé",
  soonSub: "Prépare ton deck, monte en ligue… et garde un œil sur le calendrier.",
  soon: [
    ["🎁", "Ton Wrapped 2026", "Revis ton année sur Zik Hunter et partage-la", "1er décembre"],
    ["❄️", "Une surprise givrée pour Noël", "Quelque chose de très rare se prépare au pôle Nord… On n'en dit pas plus.", "1er décembre"],
  ],
  cta: ["Aller à la Bataille", () => show("battle")],
};
function newsShow(force) {
  if (!force) { try { if (localStorage.getItem(NEWS.KEY)) return; } catch (e) { return; } }
  if (document.getElementById("newsCard")) return;
  const el = document.createElement("div"); el.id = "newsCard"; el.className = "news"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "newsT");
  el.innerHTML = `<div class="news-in">
      <button class="news-x" type="button" aria-label="Fermer">×</button>
      <header class="news-head"><div class="news-burst" aria-hidden="true"></div><p class="news-kick">${NEWS.kick}</p><h2 id="newsT">${NEWS.title}</h2><p class="news-sub">${NEWS.sub}</p></header>
      <div class="news-feats">${NEWS.feats.map((f, i) => `<article class="news-f" style="--c:${f.c};--d:${.15 + i * .12}s"><span class="news-ico" aria-hidden="true">${f.ico}</span>
        <div><h3>${f.t}${f.tag ? ` <em>${f.tag}</em>` : ""}</h3><p>${f.d}</p></div></article>`).join("")}</div>
      <section class="news-soon"><p class="news-kick">${NEWS.soonKick}</p><h3>${NEWS.soonTitle}</h3>
        <p class="news-sub sm">${NEWS.soonSub}</p>
        <ul>${NEWS.soon.map(([i, t, d, w], k) => `<li style="--d:${.7 + k * .1}s"><span aria-hidden="true">${i}</span><div><b>${t}</b><small>${d}</small></div><em>${w || "Bientôt"}</em></li>`).join("")}</ul></section>
      <div class="news-acts"><button class="btn primary" type="button" data-n="profile">${NEWS.cta[0]}</button><button class="btn" type="button" data-n="close">C'est parti !</button></div>
    </div>`;
  document.body.appendChild(el); document.body.classList.add("fx-on");
  requestAnimationFrame(() => el.classList.add("on"));
  const close = () => { try { localStorage.setItem(NEWS.KEY, "1"); } catch (e) {} el.classList.remove("on"); document.body.classList.remove("fx-on"); setTimeout(() => el.remove(), 400); };
  el.querySelector(".news-x").onclick = close; el.querySelector('[data-n="close"]').onclick = close;
  el.querySelector('[data-n="profile"]').onclick = () => { close(); setTimeout(() => me ? NEWS.cta[1]() : Online.askSignIn?.(), 420); };
  el.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  el.addEventListener("click", e => { if (e.target === el) close(); });
  setTimeout(() => el.querySelector('[data-n="profile"]').focus({ preventScroll: true }), 100);
}
// once the game is open (signed in, nothing else on screen)
const newsTimer = setInterval(() => {
  if (typeof me === "undefined" || !me || !Online.active || typeof SOC === "undefined" || !SOC.ready || typeof BT === "undefined" || !BT.ready || document.body.classList.contains("fx-on") || document.body.classList.contains("landing-on")
      || document.querySelector(".op:not([hidden]), #updCard, .wr, #maintScreen")) return;   // never behind the maintenance screen
  clearInterval(newsTimer); setTimeout(newsShow, 1500);
}, 2500);
window.newsShow = newsShow;
