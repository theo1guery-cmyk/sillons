"use strict";
/* Zik Hunter — the leagues of the Bataille de cartes: their page (the ladder, the thresholds, the presents of the end of
   the season, the rules) and the film when a player goes up or down a league, its own for each league. */
const LG_INFO = {
  Bronze: { prize: "500 Streams", ico: "🥉", line: "Le début de l'aventure : chaque victoire te rapproche de l'Argent." },
  Argent: { prize: "3 boosters", ico: "🥈", line: "Tu as fait tes preuves. Les vrais combats commencent." },
  Or: { prize: "1 Grand booster", ico: "🥇", line: "Le cœur de la compétition. Au-dessus de 900 🏆, la fin de saison te fera redescendre à mi-chemin." },
  Platine: { prize: "1 carte Mythique", ico: "💠", line: "Les decks deviennent sérieux. Chaque manche compte." },
  Diamant: { prize: "1 carte Légendaire", ico: "💎", line: "L'élite. Seuls les meilleurs decks tiennent ici." },
  "Légende": { prize: "1 Légendaire Shiny + le titre « Légende »", ico: "👑", line: "Le sommet. Ton nom brille en haut du classement." },
};
const lgOf = n => LEAGUES.slice().reverse().find(l => n >= l[1]) || LEAGUES[0];
const lgKey = () => "zh-league-" + (me?.id || "");
// the league I was in the last time I looked (to tell me if it changed while I was away: a defense lost or won)
const lgSeen = () => { try { return localStorage.getItem(lgKey()); } catch (e) { return null; } };
const lgSave = n => { try { localStorage.setItem(lgKey(), n); } catch (e) {} };

/* ---------------------------------------------------------------- the page */
async function renderLeagues(box) {
  const h = BT.home; if (!h) return;
  let season = null, board = [];
  try { [season, board] = await Promise.all([rpc("my_season").catch(() => null), rpc("battle_leaderboard").catch(() => [])]); } catch (e) {}
  const cur = lgOf(h.trophies), k = LEAGUES.indexOf(cur), next = LEAGUES[k + 1];
  const ends = season?.ends_at ? Date.parse(season.ends_at) : null, days = ends ? Math.max(0, Math.ceil((ends - Date.now()) / 864e5)) : null;
  const top = board.filter(p => p.league === "Légende" || p.league === "Diamant").slice(0, 8);
  box.innerHTML = `<button class="ps-link pf-back" id="lgBack">← Bataille</button>
    <section class="lg-hero" style="--lc:${cur[2]}">
      <div class="lg-hero-e">${btEmblem(cur[0], 130)}</div>
      <div><p class="bt-k">Ta ligue</p><h2>${cur[0]}</h2>
        <p class="lg-tr"><b>${fmt(h.trophies)}</b> trophées · record ${fmt(h.best)}</p>
        ${next ? `<div class="bt-prog lg-prog"><s style="width:${Math.round((h.trophies - cur[1]) / (next[1] - cur[1]) * 100)}%"></s></div><small>${fmt(next[1] - h.trophies)} 🏆 avant ${next[0]}</small>` : `<small>Tu es tout en haut. Reste-y !</small>`}
        <p class="lg-season">${days !== null ? `⏳ Fin de la saison dans <b>${days} jour${days > 1 ? "s" : ""}</b> : tu recevras <b>${LG_INFO[cur[0]].prize}</b> si tu restes en ${cur[0]}.` : "La saison des ligues suit celle du Pass."}</p></div>
    </section>
    <h3>Les 6 ligues</h3>
    <ol class="lg-ladder">${LEAGUES.slice().reverse().map(l => { const i = LEAGUES.indexOf(l), mine = l === cur, above = i > k;
      return `<li class="${mine ? "me" : above ? "up" : "done"}" style="--lc:${l[2]}">
        <div class="lg-e">${btEmblem(l[0], 54)}</div>
        <div class="lg-t"><b>${l[0]}</b><small>${i ? `à partir de ${fmt(l[1])} 🏆` : "dès le premier combat"}</small><p>${LG_INFO[l[0]].line}</p></div>
        <div class="lg-p"><small>Fin de saison</small><b>${LG_INFO[l[0]].ico} ${LG_INFO[l[0]].prize}</b></div>
        ${mine ? `<span class="lg-here">Tu es ici</span>` : ""}</li>`; }).join("")}</ol>
    <section class="lg-rules"><h3>Comment ça marche</h3><ul>
      <li><b>Une victoire</b> en Bataille classée rapporte environ <b>+30 🏆</b>, plus si l'adversaire est mieux classé que toi (jusqu'à +45).</li>
      <li><b>Une défaite</b> coûte environ <b>−20 🏆</b>, moins si l'adversaire était plus fort.</li>
      <li><b>Ton deck défend</b> quand on t'attaque : tu gagnes ou perds quelques trophées même sans jouer. Soigne-le !</li>
      <li><b>Les matchs entre amis</b> (amicale ou en direct) ne changent pas tes trophées.</li>
      <li><b>À la fin de chaque saison</b> (avec le Pass), chacun reçoit le cadeau de sa ligue, puis les trophées au-dessus de 900 redescendent à mi-chemin : 2 000 🏆 deviennent 1 450.</li>
    </ul></section>
    ${top.length ? `<section><h3>L'élite en ce moment</h3><ol class="bt-board">${top.map((p, i) => `<li class="${p.me ? "me" : ""}"><span class="rk">${i + 1}</span>${btEmblem(p.league, 22)}<button class="ps-link" data-p="${p.id}">${esc(p.pseudo)}</button><b>${fmt(p.trophies)} 🏆</b></li>`).join("")}</ol></section>` : ""}
    <p class="lg-replay"><button class="ps-link" id="lgFilm">▶ Revoir l'animation de ma ligue</button></p>`;
  $("#lgBack").onclick = () => { BT.sub = null; renderBattle(); };
  box.querySelectorAll("[data-p]").forEach(b => b.onclick = () => window.openProfile?.(b.dataset.p));
  $("#lgFilm").onclick = () => leagueFilm(LEAGUES[Math.max(0, k - 1)][0], cur[0], true);
}

/* ---------------------------------------------------------------- the film of a change of league */
// going up: the old shield cracks and bursts, the new one comes down in its own light (sparks of silver, a shower of
// gold coins, rings of platinum, shards of diamond, a crown and fire for the Légende). Going down: the shield fades
// and sinks, the lower one appears, quietly.
function leagueFilm(from, to, up) {
  return new Promise(done => {
    const L = btLeague(to), k = LEAGUES.indexOf(L), theme = ["bronze", "argent", "or", "platine", "diamant", "legende"][k];
    const parts = up ? Array.from({ length: k >= 5 ? 60 : 36 }, (_, i) => { const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 45;
      return `<i style="--x:${(Math.cos(a) * r).toFixed(1)}vmin;--y:${(Math.sin(a) * r).toFixed(1)}vmin;--d:${(Math.random() * .5).toFixed(2)}s;--r:${(Math.random() * 720 - 360).toFixed(0)}deg;--s:${(.5 + Math.random()).toFixed(2)}"></i>`; }).join("") : "";
    const el = document.createElement("div"); el.className = `lgf ${up ? "up" : "down"} t-${theme}`; el.style.setProperty("--lc", L[2]);
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", up ? `Promotion en ligue ${to}` : `Retour en ligue ${to}`);
    el.innerHTML = `<div class="lgf-bg"></div>${up ? `<div class="lgf-rays"></div>` : ""}
      <div class="lgf-old">${btEmblem(from, 150)}</div>
      ${up ? `<div class="lgf-flash"></div><div class="lgf-parts">${parts}</div>` : ""}
      ${up && k >= 5 ? `<div class="lgf-crown" aria-hidden="true">👑</div>` : ""}
      <div class="lgf-new">${btEmblem(to, 190)}</div>
      <div class="lgf-txt"><p>${up ? "Promotion !" : "Retour en"}</p><h2>${up ? `Ligue ${to}` : to}</h2>
        <small>${up ? LG_INFO[to].line : "Rien n'est perdu : quelques victoires et tu remontes."}</small>
        <button class="btn primary" type="button">${up ? "Génial !" : "Je remonte"}</button></div>`;
    document.body.appendChild(el); document.body.classList.add("fx-on");
    requestAnimationFrame(() => el.classList.add("go"));
    const close = () => { el.classList.add("out"); document.body.classList.remove("fx-on"); setTimeout(() => { el.remove(); done(); }, 400); };
    el.querySelector(".btn").onclick = close;
    el.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
    setTimeout(() => el.querySelector(".btn")?.focus({ preventScroll: true }), 2600);
  });
}
// a change of league since the last look (a defense lost or won while away): its film, once
async function leagueCheck(trophies) {
  const now = lgOf(trophies)[0], was = lgSeen();
  lgSave(now);
  if (!was || was === now || !LEAGUES.some(l => l[0] === was)) return;
  const up = LEAGUES.findIndex(l => l[0] === now) > LEAGUES.findIndex(l => l[0] === was);
  await leagueFilm(was, now, up);
}
Object.assign(window, { renderLeagues, leagueFilm, leagueCheck, lgSave });
