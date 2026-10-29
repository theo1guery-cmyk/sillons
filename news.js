"use strict";
/* Zik Hunter — the big announcement of a release, shown once to each player after it (a full screen of what is new,
   and what comes next). The content is here; NEWS.KEY changes with each big release. */
const NEWS = {
  KEY: "zh-news-2026-10-tactiques",
  cls: "news-bt",
  kick: "Mise à jour · Bataille de cartes",
  title: "Place à la stratégie",
  sub: "Ton deck ne se résume plus à ses meilleures cartes : bien le construire et bien le jouer, ça change tout.",
  feats: [
    { ico: "✨", t: "Les compétences", d: "Chaque Mythique et Légendaire a son pouvoir : Remix, Encore, Larsen, Hymne… Mais attention : 1 seule compétence par combat. À toi de choisir la bonne, au bon moment.", c: "#a78bfa", tag: "Nouveau" },
    { ico: "🎸", t: "Les familles", d: "🎤 Street bat 💖 Mainstream, qui bat 🎸 Live, qui bat 🎤 Street. La carte qui a l'avantage prend +10.", c: "#ff8a3d", tag: "Nouveau" },
    { ico: "🔗", t: "Les synergies", d: "Même artiste, même album, même année, même genre : plus ton deck a de morceaux en commun, plus ils sont forts, jusqu'à +30 par carte.", c: "#57e389", tag: "Nouveau" },
    { ico: "🛡️", t: "Ton plan de défense", d: "Agressif, Patient, Spécialiste ou Imprévisible : choisis comment ton deck se défend quand on l'attaque.", c: "#5fe0cf", tag: "Nouveau" },
    { ico: "💎", t: "Tes cartes gradées comptent", d: "Jusqu'à +16 sur toutes les stats selon la note, et les 9 et 10 ont le Sang-froid : elles gagnent les égalités.", c: "#7aa8ff" },
    { ico: "🎤", t: "Ta Tête d'affiche", d: "Mets une carte artiste en tête d'affiche : ses morceaux dans ton deck prennent un gros bonus.", c: "#ff5f9e" },
  ],
  cta: ["⚔️ Essayer maintenant", () => show("battle")],
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
