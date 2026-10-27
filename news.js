"use strict";
/* Zik Hunter — the big announcement of a release, shown once to each player after it (a full screen of what is new,
   and what comes next). The content is here; NEWS.KEY changes with each big release. */
const NEWS = {
  KEY: "zh-news-2026-11-social",
  kick: "Grosse mise à jour · Novembre 2026",
  title: "Zik Hunter devient social",
  sub: "Tes amis, ton profil, ton rang parmi tous les chasseurs. Et ce n'est que le début.",
  feats: [
    { ico: "👥", t: "Joueurs et amis", d: "Un nouvel onglet Joueurs : cherche un pseudo, envoie une demande d'ami, vois qui est en ligne. Entre amis, chacun peut fouiller la collection de l'autre en entier.", c: "#57e389" },
    { ico: "🏆", t: "Ton profil public", d: "Ton score de collection, ton rang parmi tous les joueurs, tes Légendaires, tes Shiny, ta meilleure note… et une vitrine de 6 cartes, choisies par toi, que tout le monde peut admirer.", c: "#e7b14a" },
    { ico: "⚡", t: "Le score de collection", d: "Chaque carte différente compte selon sa rareté. Une Shiny double sa valeur, une note de 10 aussi, et une édition limitée vaut de l'or. Ton score se met à jour tout seul.", c: "#59b8ff" },
    { ico: "🎁", t: "Ton Wrapped 2026", d: "Le 1er décembre, revis ton année sur Zik Hunter en quelques écrans : boosters, plus belle carte, artiste n°1, classement… puis partage-la.", c: "#ff4fa3", tag: "1er décembre" },
  ],
  soon: [
    ["📊", "Classements", "Les meilleurs collectionneurs, chaque semaine et depuis toujours"],
    ["🛡️", "Ligues classées", "De Bronze à Légende : monte, descends, et gagne des récompenses de fin de saison"],
    ["🎯", "Défis de la semaine", "Un objectif pour tous, un podium et de gros lots pour le top 10"],
    ["🏟️", "Tournois", "Des tournois le week-end, un tableau, un vainqueur"],
    ["❓", "Un tout nouveau mode de jeu", "Ta collection va enfin pouvoir se battre. On n'en dit pas plus…"],
  ],
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
      <section class="news-soon"><p class="news-kick">Du lourd arrive</p><h3>Le chantier compétitif est lancé</h3>
        <p class="news-sub sm">Dans les prochaines semaines, Zik Hunter devient une vraie compétition. Prépare ta collection : elle va compter.</p>
        <ul>${NEWS.soon.map(([i, t, d], k) => `<li style="--d:${.7 + k * .1}s"><span aria-hidden="true">${i}</span><div><b>${t}</b><small>${d}</small></div><em>Bientôt</em></li>`).join("")}</ul></section>
      <div class="news-acts"><button class="btn primary" type="button" data-n="profile">Découvrir mon profil</button><button class="btn" type="button" data-n="close">C'est parti !</button></div>
    </div>`;
  document.body.appendChild(el); document.body.classList.add("fx-on");
  requestAnimationFrame(() => el.classList.add("on"));
  const close = () => { try { localStorage.setItem(NEWS.KEY, "1"); } catch (e) {} el.classList.remove("on"); document.body.classList.remove("fx-on"); setTimeout(() => el.remove(), 400); };
  el.querySelector(".news-x").onclick = close; el.querySelector('[data-n="close"]').onclick = close;
  el.querySelector('[data-n="profile"]').onclick = () => { close(); setTimeout(() => me ? window.openProfile?.(me.id) : Online.askSignIn?.(), 420); };
  el.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  el.addEventListener("click", e => { if (e.target === el) close(); });
  setTimeout(() => el.querySelector('[data-n="profile"]').focus({ preventScroll: true }), 100);
}
// once the game is open (signed in, nothing else on screen)
const newsTimer = setInterval(() => {
  if (typeof me === "undefined" || !me || !Online.active || document.body.classList.contains("fx-on") || document.body.classList.contains("landing-on")
      || document.querySelector(".op:not([hidden]), #updCard, .wr")) return;
  clearInterval(newsTimer); setTimeout(newsShow, 1500);
}, 2500);
window.newsShow = newsShow;
