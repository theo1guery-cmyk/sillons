"use strict";
/* Zik Hunter — the big announcement of a release, shown once to each player after it (a full screen of what is new,
   and what comes next). The content is here; NEWS.KEY changes with each big release. */
const NEWS = {
  KEY: "zh-news-2026-10-panne",
  cls: "news-gift",
  kick: "Désolé pour la panne",
  title: "10 boosters offerts",
  sub: "Le jeu a été coupé quelques heures à cause d'un gros bug. C'est réparé, et pour se faire pardonner, on t'offre de quoi ouvrir.",
  hero: () => `<div class="ng-hero" aria-hidden="true"><div class="ng-packs">${[0, 1, 2].map(i => `<span style="--i:${i}"></span>`).join("")}</div>
    <p class="ng-n">+<b data-to="10">0</b></p><p class="ng-l">boosters dans ton stock</p></div>`,
  feats: [
    { ico: "🎁", t: "Déjà dans ton stock", d: "Les 10 boosters s'ajoutent à ceux que tu as, même au-delà de 10. Rien à réclamer.", c: "#ffd166" },
    { ico: "🛠️", t: "Le jeu est réparé", d: "La base de données était saturée par une tâche en arrière-plan. On l'a retirée : tout doit être fluide à nouveau.", c: "#57e389" },
    { ico: "💾", t: "Ta collection ne risque rien", d: "Cartes, trophées, decks : rien n'a été perdu pendant la panne.", c: "#7aa8ff" },
  ],
  cta: ["🎁 Ouvrir mes boosters", () => show("shop")],
  close: "Merci !",
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
