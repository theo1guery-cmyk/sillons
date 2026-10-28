"use strict";
/* Zik Hunter — the leaderboards: the challenge of the week, the tournament of the weekend, the collection score, the
   trophies of the Bataille de cartes, the Légendaires, the clashes; everyone or my friends; and last week's podiums. */
const RK = { kind: "trophies", friends: false, ready: false, asked: false };
const RK_KINDS = [["trophies", "🏆 Trophées"], ["challenge", "🎯 Défi de la semaine"], ["tournament", "🏟️ Tournoi du week-end"], ["collection", "⚡ Collection"], ["legends", "👑 Légendaires"], ["duel", "⚔️ Clash"]];
const RK_UNIT = { collection: "points", trophies: "🏆", legends: "Légendaires", duel: "pts de clash", tournament: "pts" };
const rkLeft = t => { const s = Math.max(0, (Date.parse(t) - Date.now()) / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return d ? `${d} j ${h} h` : h ? `${h} h ${m} min` : `${m} min`; };

// the trophies of the Bataille de cartes, the main leaderboard: my league, my place, the way to the next league
function rkTrophyHero(d) {
  const t = d.me?.score ?? BT.home?.trophies ?? 0, L = lgOf(t), k = LEAGUES.indexOf(L), next = LEAGUES[k + 1];
  return `<section class="rk-hero rk-tr" style="--lc:${L[2]}"><div class="rk-tr-e">${btEmblem(L[0], 96)}</div>
    <div class="rk-tr-t"><p class="rk-k">${RK.friends ? "Classement entre amis" : `Classement des trophées · ${fmt(d.total)} combattants`}</p><h2>Le classement des trophées</h2>
      <p>Ta ligue : <b style="color:var(--lc)">${L[0]}</b> · <b>${fmt(t)} 🏆</b>${next ? ` · encore <b>${fmt(next[1] - t)} 🏆</b> avant ${next[0]}` : " · tout en haut !"}</p>
      <div class="rk-tr-acts"><button class="btn primary" id="rkFight">⚔️ Combattre</button><button class="btn" id="rkLeagues">Les ligues et leurs cadeaux</button></div></div>
    ${d.me ? `<div class="rk-mine"><b>${d.me.rank}<sup>${d.me.rank === 1 ? "er" : "e"}</sup></b><span>${fmt(d.me.score)} 🏆</span></div>` : `<div class="rk-mine none">Lance ta première bataille pour entrer au classement !</div>`}</section>`;
}

function ranksTab() {
  const t = $("#tab-ranks"); if (!t) return; t.hidden = !Online.active || !RK.ready;
  if (Online.active && me && !RK.asked) { RK.asked = true; rpc("leaderboard", { p_kind: "collection", p_friends: true }).then(() => { RK.ready = true; ranksTab(); }).catch(() => setTimeout(() => { RK.asked = false; }, 60000)); }
}
setInterval(ranksTab, 3000);

async function renderRanks() {
  if (!me) return;
  const box = views.ranks;
  let d; try { d = await rpc("leaderboard", { p_kind: RK.kind, p_friends: RK.friends }); } catch (e) { return toast(message(e)); }
  const unit = RK.kind === "challenge" ? d.challenge.unit : RK_UNIT[RK.kind];
  const head = RK.kind === "challenge" ? `<section class="rk-hero ch"><p class="rk-k">Défi de la semaine · fin dans ${rkLeft(d.challenge.ends)}</p><h2>${esc(d.challenge.label)}</h2>
        <p>Le top 10 de la semaine gagne gros : <b>🥇 1 Légendaire + 5 000 Streams</b>, <b>🥈 1 Mythique + 3 000</b>, <b>🥉 1 Mythique + 2 000</b>, et du 4e au 10e <b>1 Grand booster + 1 000 Streams</b>.</p>
        ${d.me ? `<div class="rk-mine"><b>${d.me.rank}<sup>${d.me.rank === 1 ? "er" : "e"}</sup></b><span>${fmt(d.me.score)} ${esc(unit)}</span></div>` : `<div class="rk-mine none">Pas encore classé cette semaine : à toi de jouer !</div>`}</section>`
    : RK.kind === "tournament" ? `<section class="rk-hero tn"><p class="rk-k">${d.tournament.on ? `En cours · fin dans ${rkLeft(d.tournament.ends)}` : `Commence dans ${rkLeft(d.tournament.starts)} (samedi à minuit)`}</p><h2>Tournoi du week-end</h2>
        <p>Samedi et dimanche, chaque Bataille de cartes compte : <b>3 points par victoire, 1 par défaite</b>. Mêmes lots que le défi pour le top 10.</p>
        ${d.me ? `<div class="rk-mine"><b>${d.me.rank}<sup>${d.me.rank === 1 ? "er" : "e"}</sup></b><span>${fmt(d.me.score)} pts</span></div>` : `<div class="rk-mine none">${d.tournament.on ? "Lance une bataille pour entrer dans le tournoi !" : "Rendez-vous samedi dans l'onglet Bataille."}</div>`}
        <button class="btn primary" id="rkFight">⚔️ Aller à la Bataille</button></section>`
    : RK.kind === "trophies" ? rkTrophyHero(d)
    : `<section class="rk-hero"><p class="rk-k">${RK.friends ? "Entre amis" : `${fmt(d.total)} joueurs classés`}</p><h2>${RK_KINDS.find(k => k[0] === RK.kind)[1].slice(2).trim()}</h2>
        ${d.me ? `<div class="rk-mine"><b>${d.me.rank}<sup>${d.me.rank === 1 ? "er" : "e"}</sup></b><span>${fmt(d.me.score)} ${esc(unit)}</span></div>` : ""}</section>`;
  const top3 = d.rows.slice(0, 3), rest = d.rows.slice(3);
  const podium = top3.length ? `<div class="rk-pod">${[1, 0, 2].map(i => top3[i] ? `<button class="rk-p p${i + 1}${top3[i].me ? " me" : ""}" data-p="${top3[i].id}">
      ${socAvatar(top3[i], true)}${RK.kind === "trophies" && top3[i].league ? `<span class="rk-pe">${btEmblem(top3[i].league, 30)}</span>` : ""}<b>${esc(top3[i].pseudo)}</b><span>${fmt(top3[i].score)} ${esc(unit)}</span><i>${i + 1}</i></button>` : "").join("")}</div>` : "";
  const last = d.last.filter(x => x.kind === (RK.kind === "tournament" ? "tournament" : "challenge"));
  box.innerHTML = `<h2 class="rk-title">Classements</h2>
    <div class="rk-tabs" role="tablist">${RK_KINDS.map(([k, t]) => `<button role="tab" data-k="${k}"${k === "trophies" ? ` class="rk-star"` : ""} aria-selected="${RK.kind === k}">${t}</button>`).join("")}</div>
    <div class="rk-scope"><button data-f="0" aria-pressed="${!RK.friends}">Tous les joueurs</button><button data-f="1" aria-pressed="${RK.friends}">Mes amis</button></div>
    ${head}${podium}
    ${d.rows.length ? `<ol class="rk-list">${rest.map(r => `<li class="${r.me ? "me" : ""}"><span class="rk-r">${r.rank}</span>${socAvatar(r)}<button class="ps-link" data-p="${r.id}">${esc(r.pseudo)}</button>
      ${RK.kind === "trophies" ? `<small class="rk-lg" style="--lc:${btLeague(r.league)[2]}">${btEmblem(r.league, 18)}${r.league}</small>` : r.extra ? `<small>${esc(r.extra)}</small>` : ""}<b>${fmt(r.score)} <em>${esc(unit)}</em></b></li>`).join("")}</ol>`
      : `<p class="empty-line">Personne au classement pour l'instant${RK.friends ? " parmi tes amis" : ""}.</p>`}
    ${(RK.kind === "challenge" || RK.kind === "tournament") && last.length ? `<section class="rk-last"><h3>Podium de la semaine dernière</h3><ol>${last.map(x => `<li><span>${["🥇", "🥈", "🥉"][x.place - 1]}</span><b>${esc(x.pseudo || "?")}</b><small>${fmt(x.score)} · ${esc(x.prize || "")}</small></li>`).join("")}</ol></section>` : ""}`;
  box.querySelectorAll("[data-k]").forEach(b => b.onclick = () => { RK.kind = b.dataset.k; renderRanks(); });
  box.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { RK.friends = b.dataset.f === "1"; renderRanks(); });
  box.querySelectorAll("[data-p]").forEach(b => b.onclick = () => window.openProfile?.(b.dataset.p));
  const f = $("#rkFight"); if (f) f.onclick = () => show("battle");
  const lg = $("#rkLeagues"); if (lg) lg.onclick = () => { BT.sub = "leagues"; show("battle"); };
}
Object.assign(Online, { renderRanks: () => renderRanks() });
