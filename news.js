"use strict";
/* Zik Hunter — the big announcement of a release, shown once to each player after it (a full screen of what is new,
   and what comes next). The content is here; NEWS.KEY changes with each big release. */
const NEWS = {
  KEY: "zh-news-2026-10-bataille",
  cls: "news-bt",
  kick: "Bataille de cartes · Saison classée",
  title: "Grimpe jusqu'à la Légende",
  sub: "Six ligues, un seul sommet. Chaque victoire te fait monter, chaque défaite te fait glisser… et plus tu montes, plus ça se mérite.",
  // the climb: the six shields light up one after the other while the trophies count up to the Légende
  hero: () => `<div class="nb-climb" aria-hidden="true"><div class="nb-glow"></div>
      <ol>${LEAGUES.map((l, i) => `<li style="--lc:${l[2]};--i:${i}"><div class="nb-e">${btEmblem(l[0], i === 5 ? 84 : 52 + i * 4)}</div><b>${l[0]}</b><small>${i ? fmt(l[1]) + " 🏆" : "Départ"}</small></li>`).join("")}</ol>
      <div class="nb-line"><s></s></div>
      <p class="nb-count"><b data-to="3200">0</b> 🏆</p></div>`,
  feats: [
    { ico: "📈", t: "Plus tu montes, plus c'est dur", d: "En Bronze, une victoire rapporte +36 🏆. En Légende, seulement +15, et une défaite coûte −40. Arriver au sommet, c'est bien. Y rester, c'est autre chose.", c: "#ff5f9e" },
    { ico: "🎁", t: "Un cadeau à chaque fin de saison", d: "Selon ta ligue : des boosters, des Mythiques, des Légendaires… et pour les Légendes, une Légendaire Shiny, le Médaillon, le Dos de carte et le titre Légende.", c: "#e7b14a", tag: "Fin de saison" },
    { ico: "🛡️", t: "Le journal de défense", d: "Ton deck se bat même quand tu n'es pas là. À ton retour, tu sais qui t'a attaqué, quelles défenses ont tenu et combien de trophées ça t'a coûté.", c: "#5fe0cf", tag: "Nouveau" },
    { ico: "⚔️", t: "La revanche", d: "Quelqu'un t'a battu ? Tu as 24 h pour aller le chercher, en classé, trophées en jeu. Et si tu gagnes, il le saura.", c: "#ff6b7a", tag: "Nouveau" },
    { ico: "🎬", t: "Chaque ligue a son entrée", d: "Monte d'une ligue et regarde : éclats d'argent, pluie d'or, anneaux de platine, diamants… et une couronne de feu pour la Légende.", c: "#7aa8ff" },
    { ico: "🔄", t: "Chaque saison, tout se rejoue", d: "À la fin de la saison, les trophées sont divisés par deux. Personne ne reste en haut sans se battre.", c: "#a78bfa" },
  ],
  cta: ["⚔️ Combattre maintenant", () => show("battle")],
  close: "Plus tard",
};
function newsShow(force) {
  if (!force) { try { if (localStorage.getItem(NEWS.KEY)) return; } catch (e) { return; } }
  if (document.getElementById("newsCard")) return;
  const el = document.createElement("div"); el.id = "newsCard"; el.className = "news" + (NEWS.cls ? " " + NEWS.cls : ""); el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "newsT");
  el.innerHTML = `<div class="news-in">
      <button class="news-x" type="button" aria-label="Fermer">×</button>
      <header class="news-head"><div class="news-burst" aria-hidden="true"></div><p class="news-kick">${NEWS.kick}</p><h2 id="newsT">${NEWS.title}</h2><p class="news-sub">${NEWS.sub}</p></header>${NEWS.hero ? NEWS.hero() : ""}
      <div class="news-feats">${NEWS.feats.map((f, i) => `<article class="news-f" style="--c:${f.c};--d:${.15 + i * .12}s"><span class="news-ico" aria-hidden="true">${f.ico}</span>
        <div><h3>${f.t}${f.tag ? ` <em>${f.tag}</em>` : ""}</h3><p>${f.d}</p></div></article>`).join("")}</div>
      ${NEWS.soon ? `<section class="news-soon"><p class="news-kick">${NEWS.soonKick}</p><h3>${NEWS.soonTitle}</h3>
        <p class="news-sub sm">${NEWS.soonSub}</p>
        <ul>${NEWS.soon.map(([i, t, d, w], k) => `<li style="--d:${.7 + k * .1}s"><span aria-hidden="true">${i}</span><div><b>${t}</b><small>${d}</small></div><em>${w || "Bientôt"}</em></li>`).join("")}</ul></section>` : ""}
      <div class="news-acts"><button class="btn primary" type="button" data-n="profile">${NEWS.cta[0]}</button><button class="btn" type="button" data-n="close">${NEWS.close || "C'est parti !"}</button></div>
    </div>`;
  document.body.appendChild(el); document.body.classList.add("fx-on");
  requestAnimationFrame(() => el.classList.add("on"));
  el.querySelectorAll("[data-to]").forEach(n => { const to = +n.dataset.to, t0 = performance.now() + 500, D = 3200;
    const step = t => { const k = Math.min(1, Math.max(0, (t - t0) / D)); n.textContent = fmt(Math.round(to * k)); if (k < 1 && el.isConnected) requestAnimationFrame(step); };
    requestAnimationFrame(step); });
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
