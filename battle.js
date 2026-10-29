"use strict";
/* Zik Hunter — la Bataille de cartes: my deck of 5 cards against the deck of a player of my level. Each round a stat
   (Flow, Endurance, Hype, Puissance) is drawn, I play a card without seeing his, the higher value wins; 3 rounds and
   the battle is won. Trophies make the leagues. The server draws, answers for the defender and counts everything. */
const BT = { home: null, b: null, busy: false, edit: null };
const LEAGUES = [["Bronze", 0, "#cd8a4a"], ["Argent", 400, "#c9d2de"], ["Or", 900, "#e7b14a"], ["Platine", 1500, "#5fe0cf"], ["Diamant", 2300, "#7aa8ff"], ["Légende", 3200, "#ff5f9e"]];
const BT_STAT = { flow: ["Tempo", "la 1re barre de la carte", "⚡"], endu: ["Endurance", "la durée du morceau", "⏱"], hype: ["Hype", "la popularité sur Deezer", "🔥"], pw: ["Puissance", "la moyenne des trois", "💥"] };
const btLeague = n => LEAGUES.find(l => l[0] === n) || LEAGUES[0];
const btEmblem = (name, size = 64) => { const [, , c] = btLeague(name), k = LEAGUES.findIndex(l => l[0] === name);
  return `<svg class="bt-emb" width="${size}" height="${size * 1.15}" viewBox="0 0 100 115" aria-hidden="true"><defs><linearGradient id="btE${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".35" stop-color="${c}"/><stop offset="1" stop-color="#1a1020"/></linearGradient></defs>
    <path d="M50 4l40 14v38c0 28-18 46-40 55C28 102 10 84 10 56V18z" fill="url(#btE${k})" stroke="${c}" stroke-width="3"/>
    <path d="M50 16l28 10v29c0 20-12 34-28 41-16-7-28-21-28-41V26z" fill="rgba(0,0,0,.35)"/>
    ${k >= 5 ? `<path d="M30 40l10 10 10-18 10 18 10-10-4 26H34z" fill="#ffd36b"/>` : `<g fill="${c}">${Array.from({ length: k + 1 }, (_, i) => `<path transform="translate(${50 - k * 7 + i * 14 - 6} 52)" d="M6 0l1.8 4 4.2.4-3.2 2.8 1 4.2L6 9.2 2.2 11.4l1-4.2L0 4.4 4.2 4z"/>`).join("")}</g>`}</svg>`; };
// a card of the server (battle_card) as a card of the game
const btAsCard = j => ({ id: j.track_id, t: j.title || "?", a: j.artist || "", al: "", cov: j.cover || "", d: j.duration || 0, bpm: j.bpm || 0, rank: j.rank || 0, tier: j.tier, g: AUTRE,
  ...(j.edition ? { ed: j.edition, eno: j.edition_no } : {}) });
const btCardEl = j => cardEl(btAsCard(j), j.holo);
const BT_GRADE = [0, 0, 0, 1, 1, 1, 3, 5, 7, 11, 16];      // the bonus of a grade (on every stat); a 9 or a 10 also wins the ties
// the tactics: the families of genres (Street beats Mainstream beats Live beats Street, +10), the skills of the
// Mythiques and Légendaires (one fired per battle), and the plan my deck defends with
const BT_FAM = [["🎤", "Street", "#ff8a3d", "rap, afro, latino"], ["💖", "Mainstream", "#ff5f9e", "pop, soul, chanson"], ["🎸", "Live", "#59b8ff", "rock, électro, jazz, classique"]];
const BT_FAM_OF = { 0: 0, 7: 0, 8: 0, 1: 1, 4: 1, 5: 1, 2: 2, 3: 2, 6: 2, 9: 2 };
const BT_SKILLS = ["remix", "encore", "refrain", "feat", "larsen", "hymne", "ovation"];
const BT_SK = {
  remix: ["🎛️", "Remix", "La stat de la manche est retirée au sort."],
  encore: ["🔁", "Encore", "Ta carte revient dans ta main après la manche."],
  refrain: ["🎵", "Refrain", "+12 si tu as perdu la manche d'avant."],
  feat: ["🎤", "Featuring", "+10 si un morceau du même artiste a déjà joué de ton côté."],
  larsen: ["📢", "Larsen", "−10 à la carte adverse."],
  hymne: ["🏟️", "Hymne", "+10 sur une balle de match."],
  ovation: ["🔥", "Ovation", "+8 sur cette manche."],
};
const BT_PLAN = {
  aggro: ["⚡", "Agressif", "Il joue ses meilleures cartes d'abord."],
  patient: ["🧘", "Patient", "Il garde ses grosses cartes pour la fin."],
  spec: ["🎯", "Spécialiste", "Il joue la meilleure carte pour chaque stat."],
  random: ["🎲", "Imprévisible", "Un ordre au hasard, impossible à lire."],
};
const btFamOf = c => BT_FAM_OF[c.g] ?? null;
const btSkillOf = (id, tier) => tier >= 4 ? BT_SKILLS[Math.abs(Number(id)) * 7919 % 7] : null;
const btFamChip = f => f == null ? "" : `<span class="bt-chip f" style="--c:${BT_FAM[f][2]}" title="Famille ${BT_FAM[f][1]} : bat ${BT_FAM[(f + 1) % 3][1]}, perd contre ${BT_FAM[(f + 2) % 3][1]}">${BT_FAM[f][0]} ${BT_FAM[f][1]}</span>`;
const btSkChip = k => !k || !BT_SK[k] ? "" : `<span class="bt-chip k" title="Compétence : ${esc(BT_SK[k][2])}">✨ ${BT_SK[k][0]} ${BT_SK[k][1]}</span>`;

// the synergies: the more cards of the deck share an artist, an album, a year or a genre, the stronger they all get
const BT_SYN = { artist: ["🎤", "Même artiste", [0, 0, 4, 8, 12, 16]], album: ["💿", "Même album", [0, 0, 6, 12, 18, 24]], year: ["📅", "Même année", [0, 0, 0, 4, 7, 10]],
  genre: ["🎶", "Même genre", [0, 0, 0, 3, 5, 8]], rainbow: ["🌈", "Arc-en-ciel", [0, 0, 0, 0, 0, 6]] };
const BT_SYN_MAX = 30;
// the same count as the server, for cards of the collection ({ a, al, y, g, tier })
function btSynergy(cards) {
  const cnt = f => { const m = {}; cards.forEach(c => { const k = f(c); if (k != null && k !== "") m[k] = (m[k] || 0) + 1; }); return m; };
  const art = cnt(c => (c.a || "").toLowerCase()), alb = cnt(c => c.al ? (c.a + "|" + c.al).toLowerCase() : null), yr = cnt(c => c.y || null), gen = cnt(c => c.g === AUTRE ? null : c.g);
  const rainbow = new Set(cards.map(c => c.tier)).size >= 5;
  return cards.map(c => { const syns = [], push = (k, n, of) => { const v = BT_SYN[k][2][Math.min(n, 5)]; if (v) syns.push({ k, n, v, of }); };
    push("artist", art[(c.a || "").toLowerCase()] || 0, c.a);
    if (c.al) push("album", alb[(c.a + "|" + c.al).toLowerCase()] || 0, c.al);
    if (c.y) push("year", yr[c.y] || 0, String(c.y));
    if (c.g !== AUTRE && c.g != null) push("genre", gen[c.g] || 0, String(c.g));
    if (rainbow) syns.push({ k: "rainbow", n: 5, v: 6 });
    return { syns, sb: Math.min(BT_SYN_MAX, syns.reduce((t, x) => t + x.v, 0)) }; });
}
const btSynOf = x => x.k === "genre" ? TYPES[+x.of]?.n || "" : x.k === "rainbow" ? "5 raretés" : x.of || "";
// the synergies of a whole deck, each once: "🎤 Ninho ×3 +8"
const btSynList = per => { const seen = new Map(); per.forEach(p => (p.syns || []).forEach(x => { const id = x.k + "|" + x.of; if (!seen.has(id)) seen.set(id, x); })); return [...seen.values()].sort((a, b) => b.v - a.v); };
const btSynHTML = (list, empty) => list.length ? `<div class="bt-syns"><b>🔗 Synergies</b>${list.map(x => `<span class="bt-syn k-${x.k}" title="${BT_SYN[x.k][1]}">${BT_SYN[x.k][0]} ${esc(btSynOf(x))}${x.k === "rainbow" ? "" : ` ×${x.n}`} <em>+${x.v}</em></span>`).join("")}</div>`
  : empty ? `<div class="bt-syns none"><b>🔗 Synergies</b><small>${empty}</small></div>` : "";
const btChips = (j, wide) => { const c = [];
  if (j.skill) c.push(btSkChip(j.skill));
  if (j.fam != null) c.push(btFamChip(j.fam));
  if (j.grade) c.push(`<span class="bt-chip g${j.grade >= 9 ? " gem" : ""}" title="Carte gradée : +${BT_GRADE[j.grade] || 0} à toutes les stats${j.grade >= 9 ? ", et le Sang-froid : elle gagne les égalités" : ""}">${j.grade >= 9 ? "💎" : "🔖"} Note ${j.grade} · +${BT_GRADE[j.grade] || 0}${j.grade >= 9 && wide ? " · Sang-froid" : ""}</span>`);
  if (j.syn && j.star) c.push(`<span class="bt-chip ${j.star ? "s" : "a"}" title="${j.star ? "Morceau de ta Tête d'affiche" : "L'aura de ta Tête d'affiche"}">🎤 +${j.syn}${j.star ? " · " + esc(j.head || "") : ""}</span>`);
  if (j.sb) c.push(`<span class="bt-chip y" title="${(j.syns || []).map(x => `${BT_SYN[x.k][1]} (${btSynOf(x)}) +${x.v}`).join(", ")}${j.sb >= BT_SYN_MAX ? " · plafond atteint" : ""}">🔗 +${j.sb}${wide ? " " + (j.syns || []).map(x => BT_SYN[x.k][0]).join("") : ""}</span>`);
  return c.length ? `<div class="bt-chips">${c.join("")}</div>` : ""; };
const btBars = (j, wide) => btChips(j, wide) + `<ul class="bt-bars">${["flow", "endu", "hype", "pw"].map(s => `<li><span>${BT_STAT[s][0]}</span><i><s style="width:${Math.min(100, j[s])}%"></s></i><b>${j[s]}</b></li>`).join("")}</ul>`;

function battleTab() {      // shown once the server knows the battles
  const t = $("#tab-battle"); if (!t) return; t.hidden = !Online.active || !BT.ready;
  if (Online.active && me && !BT.asked) { BT.asked = true; rpc("battle_home").then(() => { BT.ready = true; battleTab(); }).catch(() => setTimeout(() => { BT.asked = false; }, 60000)); }
}
setInterval(battleTab, 3000);

async function renderBattle() {
  if (!me) return;
  const box = views.battle;
  let h, board;
  try { [h, board, BT.decks] = await Promise.all([rpc("battle_home"), rpc("battle_leaderboard"), rpc("battle_decks_list").catch(() => null)]); } catch (e) { return toast(message(e)); }
  BT.home = h;
  if (BT.sub === "leagues") return renderLeagues(box);
  if (!BT.el) leagueCheck(h.trophies).then(() => { if (h.defenses > 0 && !BT.el) btDefenses(); });   // a league won or lost while away (my deck defends), then how

  const L = btLeague(h.league), k = LEAGUES.indexOf(L), next = LEAGUES[k + 1];
  const pct = next ? Math.round((h.trophies - L[1]) / (next[1] - L[1]) * 100) : 100;
  box.innerHTML = `<section class="bt-hero" style="--lc:${L[2]}">
      <div class="bt-lg">${btEmblem(h.league, 92)}<div><p class="bt-k">Ligue</p><h2>${h.league}</h2>
        <p class="bt-tr"><b>${fmt(h.trophies)}</b> 🏆 · ${h.rank}<sup>${h.rank === 1 ? "er" : "e"}</sup> au classement</p>
        <div class="bt-prog" aria-label="Progression vers la ligue suivante"><s style="width:${pct}%"></s></div>
        <small>${next ? `${fmt(next[1] - h.trophies)} 🏆 avant ${next[0]}` : "Tu es au sommet !"} · record ${fmt(h.best)} 🏆</small>
</div></div>
      <div class="bt-go"><button class="btn primary bt-fight" id="btFight">⚔️ Combattre</button><button class="btn bt-rlive" id="btLive">⚡ Classé en direct</button><button class="btn" id="btFriendsB">👥 Défier un ami</button>
        <small>${h.wins} victoire${h.wins > 1 ? "s" : ""} · ${h.losses} défaite${h.losses > 1 ? "s" : ""}</small>
        <small class="bt-day">Victoires du jour : <b>${Math.min(h.today, 5)} / 5</b> · +100 Streams chacune</small></div>
    </section>
    <button class="bt-lgcta" id="btLeagues" style="--lc:${L[2]}"><span class="bt-lgcta-e">${btEmblem(h.league, 40)}</span>
      <span><b>Les ligues et leurs récompenses</b><small>Ta place, les 6 ligues, le cadeau de fin de saison${next ? ` · ${fmt(next[1] - h.trophies)} 🏆 avant ${next[0]}` : ""}</small></span><em>Voir →</em></button>
    <div class="bt-fbox" id="btFriends" hidden></div>
    <section class="bt-tac"><div class="bt-tac-h"><div><p class="bt-k">Nouveau · les tactiques</p><h3>Quatre façons de prendre l'avantage</h3></div><button class="btn" id="btTuto">❓ Comment ça marche</button></div>
      <ul class="bt-tac-l">
        <li><span>✨</span><b>Les compétences</b><small>Chaque Mythique et Légendaire a un pouvoir. <b class="bt-one">1 seule compétence par combat</b>, même si ton deck en a plusieurs : à toi de choisir laquelle, et quand.</small></li>
        <li><span>🎸</span><b>Les familles</b><small>🎤 Street bat 💖 Mainstream, qui bat 🎸 Live, qui bat 🎤 Street. La carte qui a l'avantage prend <b>+10</b>.</small></li>
        <li><span>🔗</span><b>Les synergies</b><small>Même artiste, même album, même année, même genre : plus ton deck a de morceaux en commun, plus ils sont forts.</small></li>
        <li><span>🛡️</span><b>Ton plan de défense</b><small>Quand on t'attaque, ton deck joue seul. Choisis comment, juste en dessous.</small></li>
      </ul></section>
    <details class="bt-rules"><summary>Comment ça marche ?</summary>
      <p>Ton deck de 5 cartes affronte celui d'un joueur de ton niveau. À chaque manche, une stat est tirée au sort : <b>Tempo</b> (la 1re barre de la carte : Flow, Éclat, Riff…), <b>Endurance</b> (la durée), <b>Hype</b> (la popularité) ou <b>Puissance</b> (la moyenne). Tu choisis quelle carte jouer sans voir la sienne : la plus forte dans cette stat gagne la manche. La rareté, la note et le Shiny donnent un petit bonus. <b>3 manches gagnées et c'est la victoire.</b> Chaque carte ne sert qu'une fois : garde tes meilleures pour le bon moment !</p>
      <p>Tu peux aussi <b>défier un ami</b> : en amicale contre son deck, ou <b>en direct</b> s'il est en ligne (chacun choisit sa carte à chaque manche, 25 secondes pour jouer). Les matchs entre amis ne donnent pas de trophées.</p>
      <p><b>✨ Les compétences</b> : chaque Mythique et Légendaire a la sienne, toujours la même. Quand tu choisis la carte en combat, tu peux l'activer. Attention : <b>1 seule compétence par combat</b>, même si ton deck a plusieurs Mythiques et Légendaires. ${Object.values(BT_SK).map(([i, n, d]) => `${i} <b>${n}</b> : ${d}`).join(" ")}</p>
      <p><b>🎸 Les familles</b> : ${BT_FAM.map(f => `${f[0]} <b>${f[1]}</b> (${f[3]})`).join(", ")}. Street bat Mainstream, Mainstream bat Live, Live bat Street : la carte qui a l'avantage prend +10. Les Inclassables sont neutres.</p>
      <p><b>🛡️ Le plan de défense</b> : quand on t'attaque, ton deck joue seul. ${Object.values(BT_PLAN).map(([i, n, d]) => `${i} <b>${n}</b> : ${d}`).join(" ")}</p>
      <p><b>🔗 Les synergies</b> : plus ton deck a de morceaux en commun, plus ils sont forts. Même artiste (2 : +4 chacun, jusqu'à +16 pour 5), même album (2 : +6, jusqu'à +24), même année (3 : +4, jusqu'à +10), même genre (3 : +3, jusqu'à +8), et l'Arc-en-ciel (5 raretés différentes : +6 à toutes). Elles se cumulent, jusqu'à +30 par carte.</p>
      <p><b>Tes cartes gradées comptent</b> : une note 6 donne +3 à toutes les stats, 7 : +5, 8 : +7, 9 : +11, 10 : +16, et une 9 ou une 10 a le <b>Sang-froid</b> (elle gagne les égalités). <b>Tes cartes artistes aussi</b> : choisis ta <b>Tête d'affiche</b>, ses morceaux dans ton deck prennent un gros bonus (+5, plus 2 par certification, plus 4 si Shiny ou Collector) et les autres une petite aura.</p>
      <p>Les trophées font ta ligue : Bronze, Argent (400), Or (900), Platine (1 500), Diamant (2 300), Légende (3 200). Ton deck défend aussi quand on t'attaque : à ton retour, le <b>journal de défense</b> te dit qui t'a attaqué, et tu as 24 h pour prendre ta <b>revanche</b> sur ceux qui ont gagné (une par joueur, 3 par jour, et une revanche ne se rend pas).</p></details>
    <section class="bt-deck">${btDeckHead(h)}
      ${btHeadBlock(btView(h))}
      ${btSynHTML(btSynList(btView(h).deck), btView(h).deck.length ? "Aucune pour l'instant : mets plusieurs morceaux du même artiste, du même album, de la même année ou du même genre." : "")}
      <div class="bt-row" id="btDeck"></div><div id="btPick"></div>
      ${h.plan !== undefined ? `<div class="bt-plan"><p><b>🛡️ Mon plan de défense</b> : quand on t'attaque, ton deck joue seul, comme ça (et il utilise sa compétence au bon moment).</p>
        <div class="bt-plans">${Object.entries(BT_PLAN).map(([k, [i, n, d]]) => `<button type="button" data-plan="${k}" aria-pressed="${(h.plan || "spec") === k}"><span>${i}</span><b>${n}</b><small>${d}</small></button>`).join("")}</div></div>` : ""}</section>
    <div class="bt-cols">
      <section><h3>Mes dernières batailles</h3>${h.history.length ? `<ul class="bt-hist">${h.history.map(x => `<li class="${x.won ? "w" : "l"}">
        <span class="bt-res">${x.won ? "Victoire" : "Défaite"}</span><span>${x.mode === "live" ? "en direct contre" : x.mode === "friend" ? (x.attack ? "amicale contre" : "amicale, défense contre") : x.attack ? "contre" : "défense contre"} <button class="ps-link" data-p="${x.other_id || ""}">${esc(x.other || "?")}</button> · ${x.score}</span>
        <b>${x.delta > 0 ? "+" : ""}${x.delta ?? 0} 🏆</b>${x.revenge ? `<button class="btn bt-rvb" data-rv="${x.id}">⚔️ Revanche</button>` : ""}</li>`).join("")}</ul>` : `<p class="empty-line">Aucune bataille pour l'instant. Lance ta première !</p>`}</section>
      <section><h3>Classement des batailles</h3><ol class="bt-board">${board.map((p, i) => `<li class="${p.me ? "me" : ""}"><span class="rk">${i + 1}</span>${btEmblem(p.league, 22)}
        <button class="ps-link" data-p="${p.id}">${esc(p.pseudo)}</button><b>${fmt(p.trophies)} 🏆</b></li>`).join("") || `<p class="empty-line">Le classement attend ses premiers combattants.</p>`}</ol></section>
    </div>`;
  const deck = $("#btDeck");
  for (const j of btView(h).deck) { const w = document.createElement("div"); w.className = "bt-dc"; w.appendChild(btCardEl(j)); w.insertAdjacentHTML("beforeend", btBars(j, true)); deck.appendChild(w); }
  $("#btFight").onclick = () => battleStart();
  $("#btLive").onclick = () => btQueue();
  $("#btFriendsB").onclick = () => btFriends();
  $("#btLeagues").onclick = () => { BT.sub = "leagues"; renderBattle(); };
  $("#btTuto").onclick = () => btTuto();
  box.querySelectorAll("[data-plan]").forEach(b => b.onclick = async () => { try { await rpc("set_battle_plan", { p_plan: b.dataset.plan }); toast(`Plan de défense : ${BT_PLAN[b.dataset.plan][0]} ${BT_PLAN[b.dataset.plan][1]}`); renderBattle(); } catch (e) { toast(message(e)); } });
  $("#btEdit").onclick = () => btPick();
  box.querySelectorAll("[data-slot]").forEach(b => b.onclick = () => { BT.slot = +b.dataset.slot; renderBattle(); });
  const nd = $("#btNewDeck"); if (nd) nd.onclick = () => btPick(btFreeSlot());
  const df = $("#btDefDeck"); if (df) df.onclick = async () => { try { await rpc("set_defense_deck", { p_slot: BT.slot }); toast("🛡️ Ce deck défend maintenant quand on t'attaque."); renderBattle(); } catch (e) { toast(message(e)); } };
  const dl = $("#btDelDeck"); if (dl) dl.onclick = async () => { if (!confirm("Supprimer ce deck ?")) return; try { await rpc("delete_battle_deck", { p_slot: BT.slot }); BT.slot = null; renderBattle(); } catch (e) { toast(message(e)); } };
  const he = $("#btHeadEdit"); if (he) he.onclick = () => btPick();
  box.querySelectorAll("[data-p]").forEach(b => b.onclick = () => b.dataset.p && window.openProfile?.(b.dataset.p));
  box.querySelectorAll("[data-rv]").forEach(b => b.onclick = () => battleRevenge(b.dataset.rv));
}

/* ---------------------------------------------------------------- several decks */
// the deck shown: one of my decks (the one picked in the tabs), else the deck that defends
const btSlotOf = n => (BT.decks || []).find(d => d.slot === n);
function btView(h) {
  if (!BT.decks?.length) return h;
  const d = btSlotOf(BT.slot) || BT.decks.find(x => x.defense) || BT.decks[0]; BT.slot = d.slot;
  return { ...h, deck: d.deck, artist: d.artist, artist_chosen: !!d.artist_id, chosen: true, slot: d.slot, name: d.name, defense: d.defense };
}
const btFreeSlot = () => [1, 2, 3, 4, 5].find(n => !btSlotOf(n)) || null;
function btDeckHead(h) {
  if (!BT.decks) return `<h3>Mon deck${h.chosen ? "" : " <small>(automatique : tes 5 cartes les plus fortes)</small>"} <button class="ps-link" id="btEdit">✎ Modifier</button></h3>`;
  const v = btView(h), free = btFreeSlot();
  return `<h3>Mes decks <small>jusqu'à 5 · tu choisis avant chaque combat</small></h3>
    <div class="bt-tabs" role="tablist">${BT.decks.map(d => `<button role="tab" data-slot="${d.slot}" aria-selected="${d.slot === v.slot}">${d.defense ? "🛡️ " : ""}${esc(d.name)}</button>`).join("")}
      ${free ? `<button class="bt-tab-new" id="btNewDeck">＋ Nouveau deck</button>` : ""}</div>
    ${BT.decks.length ? `<div class="bt-dk-acts"><b>${esc(v.name)}</b>${v.defense ? `<span class="bt-dk-def">🛡️ Deck de défense</span>` : ""}
      <button class="ps-link" id="btEdit">✎ Modifier</button>${v.defense ? "" : `<button class="ps-link" id="btDefDeck">🛡️ Utiliser en défense</button><button class="ps-link bt-dk-del" id="btDelDeck">Supprimer</button>`}</div>`
      : `<p class="bt-dk-none">Pour l'instant, ton deck est <b>automatique</b> (tes 5 cartes les plus fortes). Crée tes decks : un pour l'Endurance, un 100 % rap, un pour les synergies… et choisis avant chaque combat.</p>`}`;
}
// before a battle: which deck? (straight away if I have only one)
async function btChooseDeck() {
  if (BT.decks === undefined) BT.decks = await rpc("battle_decks_list").catch(() => null);
  const ds = (BT.decks || []).filter(d => d.ok);
  if (!ds.length) return { slot: null };
  if (ds.length === 1) return { slot: ds[0].slot };
  return new Promise(done => {
    const el = document.createElement("div"); el.className = "bt-tuto bt-pickdk"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Choisis ton deck");
    const avg = d => Math.round(d.deck.reduce((t, j) => t + (j.pw || 0), 0) / Math.max(1, d.deck.length));
    el.innerHTML = `<div class="bt-tin"><button class="news-x" type="button" aria-label="Annuler">×</button><p class="bt-k">Avant le combat</p><h2>Avec quel deck ?</h2>
      <ul class="bt-dkl">${ds.map(d => `<li><button type="button" data-d="${d.slot}" class="${d.slot === BT.lastSlot ? "last" : ""}">
        <span class="bt-dkl-h"><b>${d.defense ? "🛡️ " : ""}${esc(d.name)}</b><small>Puissance moyenne ${avg(d)}${d.artist ? ` · 🎤 ${esc(d.artist.name || "")}` : ""}${d.slot === BT.lastSlot ? " · le dernier utilisé" : ""}</small></span>
        <span class="bt-dkl-c">${d.deck.map(j => `<i>${btCardEl(j).outerHTML}</i>`).join("")}</span></button></li>`).join("")}</ul></div>`;
    document.body.appendChild(el); requestAnimationFrame(() => el.classList.add("on"));
    const close = v => { el.classList.remove("on"); setTimeout(() => el.remove(), 250); done(v); };
    el.querySelector(".news-x").onclick = () => close(null);
    el.addEventListener("keydown", e => { if (e.key === "Escape") close(null); });
    el.querySelectorAll("[data-d]").forEach(b => b.onclick = () => { BT.lastSlot = +b.dataset.d; close({ slot: +b.dataset.d }); });
    (el.querySelector(".last") || el.querySelector("[data-d]")).focus({ preventScroll: true });
  });
}

// the Tête d'affiche of my deck: one of my artist cards, a big bonus to its tracks, a small aura to the others
function btHeadBlock(h) {
  const a = h.artist;
  if (!a) return `<div class="bt-head none"><span class="bt-head-ph" aria-hidden="true">🎤</span><div><p class="bt-k">Tête d'affiche</p><b>Aucune carte artiste pour l'instant</b>
    <small>Trouve des cartes artistes dans les boosters : en Tête d'affiche, elles boostent les morceaux de l'artiste dans ton deck.</small></div></div>`;
  const stars = h.deck.filter(j => j.star).length;
  return `<div class="bt-head${a.holo || a.collector ? " shiny" : ""}" style="--hc:${["#b08d6a", "#d0d0d0", "#c9d2de", "#e7b14a", "#e6edf5", "#9fe8ff"][a.tier] || "#e7b14a"}">
    ${a.picture ? `<img src="${esc(a.picture)}" alt="">` : `<span class="bt-head-ph" aria-hidden="true">🎤</span>`}
    <div><p class="bt-k">Tête d'affiche${h.artist_chosen ? "" : " · choisie pour toi"}</p><b>${esc(a.name || "?")}</b>
      <small><em>+${a.syn}</em> à ses morceaux (${stars} dans ton deck)${a.aura ? ` · <em>+${a.aura}</em> aux autres` : ""}${a.collector ? " · Collector" : a.holo ? " · Shiny" : ""}</small></div>
    <span class="bt-head-cert">${CERT[a.tier] || ""}</span>${h.deck.length ? `<button class="ps-link" id="btHeadEdit">Changer</button>` : ""}</div>`;
}
// my deck: 5 different tracks, the strongest shown first with their stats
async function btPick(newSlot) {
  const box = $("#btPick");
  const multi = !!BT.decks, slot = multi ? (newSlot || BT.slot || 1) : null, cur = multi ? btSlotOf(slot) : null;
  if (BT.editSlot !== slot) { BT.edit = null; BT.art = undefined; BT.editSlot = slot; BT.editName = cur?.name || (BT.decks?.length ? `Deck ${slot}` : "Mon deck"); }
  const list = [];
  for (const c of Object.values(S.c)) { if (isArtist(c) || c.ed) continue; const cp = c.copies.find(x => x.grade) || c.copies.find(x => x.holo) || c.copies[0]; if (cp) list.push([c, cp]); }
  const gb = cp => BT_GRADE[cp.grade || 0] || 0;
  const val = ([c, cp]) => stats(c).pw + c.tier * 3 + gb(cp) + (cp.holo ? 4 : 0);
  const arts = Object.values(S.c).filter(c => isArtist(c) && c.copies?.length).map(c => [c, c.copies.find(x => x.holo) || c.copies[0]]).sort((a, b) => b[0].tier - a[0].tier);
  const synOf = ([a, cp]) => 5 + 2 * a.tier + (cp.holo || a.collector ? 4 : 0), auraOf = ([a]) => Math.floor(a.tier / 2) + (a.collector ? 1 : 0);
  if (BT.art === undefined) BT.art = multi ? (cur?.artist_id || null) : BT.home.artist_chosen ? BT.home.artist?.id : null;
  list.sort((a, b) => val(b) - val(a));
  BT.edit ??= multi ? (cur ? cur.deck.map(j => j.id) : []) : BT.home.chosen ? BT.home.deck.map(j => j.id) : [];
  const draw = () => {
    box.innerHTML = `<div class="pf-picker"><p>Choisis 5 cartes (des morceaux différents). Pense à varier : une carte rapide pour le Tempo, une longue pour l'Endurance, une star pour la Hype. Les cartes gradées, les morceaux de ta Tête d'affiche et les <b>synergies</b> (même artiste, même album, même année, même genre) sont boostés. <b>${BT.edit.length} / 5</b></p>
      ${multi ? `<label class="bt-dk-name">Nom du deck <input id="btDkName" maxlength="24" value="${esc(BT.editName || "")}" placeholder="Ex. : Rap 2021, Endurance…"></label>` : ""}
      <div class="pf-pacts">${multi ? "" : `<button class="btn" id="btAuto">Deck automatique</button>`}<button class="btn" id="btCancel">Annuler</button><button class="btn primary" id="btSave"${BT.edit.length === 5 ? "" : " disabled"}>Enregistrer ${multi ? "ce deck" : "mon deck"}</button></div>
      <div class="bt-arts"><p><b>🎤 Tête d'affiche</b> : ses morceaux dans ton deck prennent un gros bonus, les autres une petite aura.</p>
        <div class="bt-arts-l"><button type="button" class="bt-art${BT.art ? "" : " on"}" data-a=""><span class="bt-art-ph">✨</span><b>Automatique</b><small>la mieux adaptée</small></button>
        ${arts.map(([a, cp]) => { const n = BT.edit.filter(id => list.find(([, x]) => x.id === id)?.[0].a === a.t).length;
          return `<button type="button" class="bt-art${BT.art === cp.id ? " on" : ""}" data-a="${cp.id}">${a.cov ? `<img src="${esc(a.cov)}" alt="">` : `<span class="bt-art-ph">🎤</span>`}<b>${esc(a.t)}</b>
            <small>+${synOf([a, cp])}${n ? ` × ${n} morceau${n > 1 ? "x" : ""}` : ""} · ${CERT[a.tier] || ""}${a.collector ? " · Collector" : cp.holo ? " · Shiny" : ""}</small></button>`; }).join("") || `<p class="empty-line">Pas encore de carte artiste.</p>`}</div></div>
      <div class="bt-sort" role="group" aria-label="Trier les cartes"><span>Trier par</span>${[["best", "⭐ Recommandé"], ["pw", "💥 Puissance"], ["flow", "⚡ Tempo"], ["endu", "⏱ Endurance"], ["hype", "🔥 Hype"]].map(([k, t]) =>
        `<button type="button" data-s="${k}" aria-pressed="${(BT.sort || "best") === k}">${t}</button>`).join("")}</div>
      <div class="bt-find"><input type="search" id="btFindQ" placeholder="🔎 Chercher un titre, un artiste, un album…" value="${esc(BT.q || "")}" aria-label="Chercher une carte">
        <div class="bt-find-f" role="group" aria-label="Filtrer">${[["", "Toutes"], ...BT_FAM.map((f, i) => [String(i), `${f[0]} ${f[1]}`]), ["x", "Inclassables"]].map(([k, t]) =>
          `<button type="button" data-fam="${k}" aria-pressed="${(BT.fam ?? "") === k}">${t}</button>`).join("")}
          <button type="button" data-skf aria-pressed="${!!BT.skf}">✨ Avec compétence</button></div></div>
      <div id="btSynNow"></div>
      <div class="pf-grid" id="btGrid"></div></div>`;
    box.querySelectorAll("[data-s]").forEach(b => b.onclick = () => { BT.sort = b.dataset.s; draw(); });
    box.querySelectorAll("[data-fam]").forEach(b => b.onclick = () => { BT.fam = b.dataset.fam; draw(); });
    box.querySelector("[data-skf]").onclick = () => { BT.skf = !BT.skf; draw(); };
    const fq = $("#btFindQ"); fq.oninput = () => { BT.q = fq.value; const pos = fq.selectionStart; draw(); const f2 = $("#btFindQ"); f2.focus({ preventScroll: true }); f2.setSelectionRange(pos, pos); };
    box.querySelectorAll("[data-a]").forEach(b => b.onclick = () => { BT.art = b.dataset.a || null; draw(); });
    const head = BT.art ? arts.find(([, cp]) => cp.id === BT.art) : null;
    const g = $("#btGrid"), tracks = new Set(BT.edit.map(id => list.find(([, cp]) => cp.id === id)?.[0].id));
    // the values with every bonus (grade, Shiny, rarity, Tête d'affiche), sorted by the chosen stat
    // with the synergies it would have in the deck (the cards picked, plus this one)
    const picked = BT.edit.map(id => list.find(([, cp]) => cp.id === id)?.[0]).filter(Boolean);
    const synIn = c => { const deck = picked.includes(c) ? picked : [...picked, c].slice(-5); return btSynergy(deck)[deck.indexOf(c)]; };
    const vOf = ([c, cp]) => { const st = stats(c), star = head && head[0].t === c.a, syn = head ? star ? synOf(head) : auraOf(head) : 0, sy = synIn(c), b = c.tier * 3 + gb(cp) + (cp.holo ? 4 : 0) + syn + sy.sb;
      return { flow: st.flow + b, endu: st.endu + b, hype: st.hype + b, pw: st.pw + b, grade: cp.grade, syn, star, head: head?.[0].t, sb: sy.sb, syns: sy.syns, fam: btFamOf(c), skill: btSkillOf(c.id, c.tier) }; };
    $("#btSynNow").innerHTML = btSynHTML(btSynList(btSynergy(picked)), picked.length ? "Aucune pour l'instant. Les chiffres des cartes montrent ce qu'elles vaudraient avec ton deck." : "Les chiffres des cartes tiennent compte des synergies avec les cartes déjà choisies.");
    // the search (title, artist, album, without accents) and the filters (family, skill); the cards picked always stay
    const norm = t => (t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const q = norm(BT.q || "").trim(), fam = BT.fam ?? "";
    const keep = ([c, cp]) => BT.edit.includes(cp.id) || ((!q || norm(`${c.t} ${c.a} ${c.al}`).includes(q))
      && (fam === "" || (fam === "x" ? btFamOf(c) == null : btFamOf(c) === +fam)) && (!BT.skf || btSkillOf(c.id, c.tier)));
    const k = BT.sort || "best", shown = list.filter(keep).map(x => [...x, vOf(x)]);   // "Recommandé": the usual order (the strongest cards overall)
    if (k !== "best") shown.sort((a, b) => b[2][k] - a[2][k]);
    if (!shown.length) g.innerHTML = `<p class="empty-line">Aucune carte ne correspond. Essaie un autre mot ou un autre filtre.</p>`;
    for (const [c, cp, v] of shown.slice(0, 240)) {
      const w = document.createElement("button"); w.type = "button"; w.className = "pf-gc pick bt-pk"; const k = BT.edit.indexOf(cp.id);
      if (k >= 0) { w.classList.add("on"); w.dataset.k = k + 1; }
      w.appendChild(cardEl(c, cp.holo)); w.insertAdjacentHTML("beforeend", btBars(v));
      w.onclick = () => { const i = BT.edit.indexOf(cp.id);
        if (i >= 0) BT.edit.splice(i, 1);
        else if (tracks.has(c.id)) return toast("Ce morceau est déjà dans ton deck.");
        else if (BT.edit.length < 5) BT.edit.push(cp.id); else return toast("Le deck prend 5 cartes.");
        draw(); };
      g.appendChild(w);
    }
    const nm = $("#btDkName"); if (nm) nm.oninput = () => { BT.editName = nm.value; };
    const done = () => { BT.edit = null; BT.art = undefined; BT.editSlot = undefined; };
    const save = async ids => { try {
        if (multi) { await rpc("save_battle_deck", { p_slot: slot, p_name: (BT.editName || "").trim() || `Deck ${slot}`, p_cards: ids, p_artist: BT.art || null }); BT.slot = slot; }
        else await rpc("set_battle_deck", { p_cards: ids, p_artist: BT.art || null });
        toast("Deck enregistré !"); done(); renderBattle(); } catch (e) { toast(message(e)); } };
    $("#btSave").onclick = () => save(BT.edit); const au = $("#btAuto"); if (au) au.onclick = () => save([]); $("#btCancel").onclick = () => { done(); box.innerHTML = ""; };
  };
  draw(); box.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------------------------------------------------------------- the tactics in 4 screens */
function btTuto(then) {
  const pages = [
    { i: "✨", t: "Les compétences", d: "Chaque Mythique et Légendaire a un pouvoir, toujours le même (l'étiquette ✨ sous la carte). En combat, choisis ta carte, puis active sa compétence si tu veux.",
      v: `<p class="bt-onebig">✨ 1 seule compétence par combat<small>même si ton deck a plusieurs Mythiques et Légendaires : choisis la bonne, au bon moment</small></p>`+`<ul class="bt-tsk">${Object.values(BT_SK).map(([i, n, d]) => `<li><span>${i}</span><b>${n}</b><small>${d}</small></li>`).join("")}</ul>` },
    { i: "🎸", t: "Les familles", d: "Chaque morceau a une famille. Comme pierre-feuille-ciseaux : si la famille de ta carte bat celle de la sienne, <b>+10</b> pour toi.",
      v: `<div class="bt-tri">${[0, 1, 2, 0].map((f, k) => `${k ? "<i>bat</i>" : ""}<span style="--c:${BT_FAM[f][2]}">${BT_FAM[f][0]}<b>${BT_FAM[f][1]}</b>${k < 3 ? `<small>${BT_FAM[f][3]}</small>` : ""}</span>`).join("")}</div>` },
    { i: "🔗", t: "Les synergies", d: "Plus ton deck a de morceaux en commun, plus ils sont forts. Elles se cumulent, jusqu'à <b>+30</b> par carte. Compose ton deck pour les voir en direct.",
      v: `<ul class="bt-tsk">${Object.values(BT_SYN).map(([i, n, t]) => `<li><span>${i}</span><b>${n}</b><small>${n === "Arc-en-ciel" ? "5 raretés différentes : +6 à toutes" : t.map((v, k) => v ? `${k} : +${v}` : "").filter(Boolean).join(" · ") + " chacune"}</small></li>`).join("")}</ul>` },
    { i: "🛡️", t: "Ton plan de défense", d: "Quand quelqu'un attaque ton deck, il joue seul. Choisis son style dans « Mon deck » : les attaquants devront le deviner.",
      v: `<ul class="bt-tsk">${Object.values(BT_PLAN).map(([i, n, d]) => `<li><span>${i}</span><b>${n}</b><small>${d}</small></li>`).join("")}</ul>` },
    { i: "⚔️", t: "En combat", d: "1. Touche une carte de ta main. 2. Si elle a une compétence, active-la (ou garde-la pour plus tard). 3. Joue ! La valeur affichée tient compte de tout, sauf de la famille de sa carte, que tu découvres à la révélation.",
      v: "" },
  ];
  let k = 0;
  const el = document.createElement("div"); el.className = "bt-tuto"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Les tactiques de la Bataille");
  document.body.appendChild(el); requestAnimationFrame(() => el.classList.add("on"));
  const done = () => { try { localStorage.setItem("zh-bt-tactics", "1"); } catch (e) {} el.classList.remove("on"); setTimeout(() => { el.remove(); then?.(); }, 300); };
  const draw = () => { const x = pages[k], last = k === pages.length - 1;
    el.innerHTML = `<div class="bt-tin"><button class="news-x" type="button" aria-label="Fermer">×</button>
      <p class="bt-k">Les tactiques · ${k + 1} / ${pages.length}</p><div class="bt-ti">${x.i}</div><h2>${x.t}</h2><p>${x.d}</p>${x.v}
      <div class="bt-tdots">${pages.map((_, i) => `<i class="${i === k ? "on" : ""}"></i>`).join("")}</div>
      <div class="bt-acts">${k ? `<button class="btn" data-t="prev">Retour</button>` : ""}<button class="btn primary" data-t="next">${last ? (then ? "Au combat !" : "Compris") : "Suivant"}</button></div></div>`;
    el.querySelector(".news-x").onclick = done;
    el.querySelector('[data-t="next"]').onclick = () => last ? done() : (k++, draw());
    const pv = el.querySelector('[data-t="prev"]'); if (pv) pv.onclick = () => { k--; draw(); };
    el.querySelector('[data-t="next"]').focus({ preventScroll: true }); };
  el.addEventListener("keydown", e => { if (e.key === "Escape") done(); });
  draw();
}
const btTutoSeen = () => { try { return !!localStorage.getItem("zh-bt-tactics"); } catch (e) { return true; } };

/* ---------------------------------------------------------------- the battle */
const BT_MODE = { ranked: "Classée", friend: "Amicale", live: "En direct" };
const btModeName = b => b.mode === "live" && b.ranked ? "Classée en direct" : BT_MODE[b.mode];
function btOpen() {
  BT.sel = null; BT.skOn = false;
  if (BT.el) return BT.el;
  const el = BT.el = document.createElement("div"); el.className = "bt-arena"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Bataille de cartes");
  document.body.appendChild(el); document.body.classList.add("fx-on");
  requestAnimationFrame(() => el.classList.add("on"));
  return el;
}
// ranked (no friend) or friendly (a friend's deck answers for him)
async function battleStart(friend, deck) {
  if (BT.busy) return;
  if (!btTutoSeen()) return btTuto(() => battleStart(friend));
  const dk = deck !== undefined ? { slot: deck } : await btChooseDeck(); if (!dk) return;
  BT.busy = true;
  try { BT.b = await rpc("battle_start", dk.slot ? { p_friend: friend || null, p_deck: dk.slot } : { p_friend: friend || null }); } catch (e) { BT.busy = false; return toast(message(e)); }
  BT.busy = false; BT.again = friend ? { friend, deck: dk.slot } : { deck: dk.slot }; BT.revenge = false;
  btOpen(); btIntro();
}
// the revenge: a ranked battle against the one who beat my deck while I was away (once, within 24 hours)
async function battleRevenge(id) {
  if (BT.busy) return;
  const dk = await btChooseDeck(); if (!dk) return;
  BT.busy = true;
  try { BT.b = await rpc("battle_revenge", dk.slot ? { p_battle: id, p_deck: dk.slot } : { p_battle: id }); } catch (e) { BT.busy = false; return toast(message(e)); }
  BT.busy = false; BT.again = {}; BT.revenge = true;
  btOpen(); btIntro();
}
// the defense log: while I was away my deck was attacked, here is how it went (shown once, then marked seen)
async function btDefenses() {
  if (BT.defShown || document.getElementById("btDef")) return; BT.defShown = true;
  let d; try { d = await rpc("battle_defenses"); } catch (e) { BT.defShown = false; return; }
  if (!d.total) return;
  rpc("battle_defenses_seen").catch(() => {});
  if (BT.home) BT.home.defenses = 0;
  const n = d.total, held = d.held, lost = d.lost, net = d.delta;
  const el = document.createElement("div"); el.id = "btDef"; el.className = "bt-def"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "btDefT");
  const line = held && lost ? `${held} défense${held > 1 ? "s" : ""} tenue${held > 1 ? "s" : ""}, ${lost} perdue${lost > 1 ? "s" : ""}` : lost ? `${lost > 1 ? "toutes perdues" : "perdue"}` : `${held > 1 ? "toutes tenues" : "tenue"}`;
  el.innerHTML = `<div class="bt-def-in ${lost > held ? "l" : "w"}">
      <button class="news-x" type="button" aria-label="Fermer">×</button>
      <div class="bt-def-sh" aria-hidden="true">🛡️</div>
      <p class="bt-k">Journal de défense</p>
      <h2 id="btDefT">Pendant ton absence, ton deck a été attaqué ${n === 1 ? "une fois" : `${n} fois`}</h2>
      <p class="bt-def-sum">${n === 1 ? "Défense" : "Défenses"} : <b>${line}</b> · <b class="${net >= 0 ? "w" : "l"}">${net > 0 ? "+" : ""}${net} 🏆</b></p>
      <ul class="bt-def-list">${d.list.map(x => `<li class="${x.held ? "w" : "l"}" style="--d:${.25 + d.list.indexOf(x) * .08}s">
        <span class="bt-res">${x.held ? "Tenue" : "Perdue"}</span>
        <span class="bt-def-who">${btEmblem(x.league, 20)}<button class="ps-link" data-p="${x.who_id}">${esc(x.who)}</button><small>${x.score} · ${btAgo(x.at)}</small></span>
        <b>${x.delta > 0 ? "+" : ""}${x.delta ?? 0} 🏆</b>
        ${x.revenge ? `<button class="btn primary bt-rvb" data-rv="${x.id}">⚔️ Revanche</button>` : `<span class="bt-rvx"></span>`}</li>`).join("")}</ul>
      ${lost ? `<p class="bt-def-tip">Une revanche, c'est une bataille classée contre ce joueur, avec les trophées en jeu. Une par joueur et 3 par jour, pendant 24 h. Si tu gagnes, il le saura (mais il ne pourra pas te la rendre).</p>` : `<p class="bt-def-tip">Ton deck tient bon. Continue comme ça !</p>`}
      <div class="bt-acts"><button class="btn" type="button" data-x>${lost ? "Plus tard" : "Super"}</button></div></div>`;
  document.body.appendChild(el); document.body.classList.add("fx-on");
  requestAnimationFrame(() => el.classList.add("on"));
  const close = then => { el.classList.remove("on"); document.body.classList.remove("fx-on"); setTimeout(() => { el.remove(); then?.(); }, 300); };
  el.querySelector(".news-x").onclick = () => close(); el.querySelector("[data-x]").onclick = () => close();
  el.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  el.addEventListener("click", e => { if (e.target === el) close(); });
  el.querySelectorAll("[data-p]").forEach(b => b.onclick = () => close(() => window.openProfile?.(b.dataset.p)));
  el.querySelectorAll("[data-rv]").forEach(b => b.onclick = () => close(() => { if (views.battle.hidden) show("battle"); battleRevenge(b.dataset.rv); }));
  setTimeout(() => (el.querySelector("[data-rv]") || el.querySelector("[data-x]")).focus({ preventScroll: true }), 100);
}
const btAgo = t => { const m = Math.max(1, Math.round((Date.now() - Date.parse(t)) / 6e4)); return m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`; };
// when I come back to the game (anywhere, once it is open and nothing else is on screen)
const btDefTimer = setInterval(() => {
  if (!BT.ready || !me || !Online.active || BT.defShown) return;
  if (document.body.classList.contains("fx-on") || document.body.classList.contains("landing-on") || document.querySelector(".op:not([hidden]), #updCard, .wr, #maintScreen, #newsCard")) return;
  if (typeof NEWS !== "undefined") { try { if (!localStorage.getItem(NEWS.KEY)) return; } catch (e) {} }     // the announcement first
  clearInterval(btDefTimer);
  rpc("battle_home").then(h => { if (h.defenses > 0) btDefenses(); }).catch(() => {});
}, 4000);
// the ranked live: the queue of the players online (30 seconds at most, then a battle against a deck)
async function btQueue(deck) {
  if (BT.busy || BT.el) return;
  if (!btTutoSeen()) return btTuto(() => btQueue(deck));
  const dk = deck !== undefined ? { slot: deck } : await btChooseDeck(); if (!dk) return;
  BT.busy = true;
  let r; try { r = await rpc("battle_queue_join", dk.slot ? { p_deck: dk.slot } : {}); } catch (e) { BT.busy = false; return toast(message(e)); }
  BT.busy = false;
  const el = btOpen(), t0 = Date.now(), MAX = 30;
  el.innerHTML = `<button class="bt-quit" aria-label="Annuler">×</button><div class="bt-wait bt-queue"><div class="bt-radar" aria-hidden="true"><i></i><i></i><i></i><span>⚡</span></div>
    <p class="bt-k">Classé en direct</p><h2>Recherche d'un adversaire…</h2><p>Un joueur en ligne de ton niveau, trophées en jeu.</p>
    <small id="btQT">0 s</small><small id="btQO"></small></div>`;
  let done = false;
  const go = m => { done = true; BT.b = m.battle; BT.again = { rlive: true, deck: dk.slot }; BT.revenge = false; btIntro(); };
  el.querySelector(".bt-quit").onclick = async () => { done = true; const x = await rpc("battle_queue_leave").catch(() => null); if (x?.status === "matched") { done = false; return go(x); } btClose(); };
  const poll = async () => {
    if (done || BT.el !== el) return;
    if (r?.status === "matched") return go(r);
    const sec = Math.round((Date.now() - t0) / 1000), t = $("#btQT"), o = $("#btQO");
    if (t) t.textContent = `${sec} s`; if (o && r?.others != null) o.textContent = r.others ? `${r.others} joueur${r.others > 1 ? "s" : ""} en recherche` : "";
    if (sec >= MAX) {
      done = true; const x = await rpc("battle_queue_leave").catch(() => null);
      if (x?.status === "matched") { done = false; return go(x); }
      el.querySelector(".bt-queue").innerHTML = `<h2>Personne en ligne à ton niveau</h2><p>Pas de souci : ton adversaire sera le deck d'un joueur, trophées en jeu comme d'habitude.</p>`;
      await wait(1600); btClose(true); return battleStart(null, dk.slot ?? null);
    }
    try { r = await rpc("battle_queue_poll"); } catch (e) {}
    setTimeout(poll, 2000);
  };
  setTimeout(poll, 600);
}
// live: I invite a friend and wait (2 minutes at most) for him to accept
async function battleInvite(friend, pseudo) {
  if (BT.busy) return;
  const dk = await btChooseDeck(); if (!dk) return;
  BT.busy = true;
  let b; try { b = await rpc("battle_invite", dk.slot ? { p_friend: friend, p_deck: dk.slot } : { p_friend: friend }); } catch (e) { BT.busy = false; return toast(message(e)); }
  BT.busy = false; BT.b = b; BT.again = { live: friend, pseudo };
  const el = btOpen(), t0 = Date.now();
  el.innerHTML = `<button class="bt-quit" aria-label="Annuler">×</button><div class="bt-wait"><div class="bt-spin" aria-hidden="true"></div><h2>Invitation envoyée</h2>
    <p>On attend que <b>${esc(pseudo)}</b> accepte le combat en direct…</p><small id="btWaitT">2:00</small></div>`;
  el.querySelector(".bt-quit").onclick = () => btClose();
  const poll = async () => {
    if (BT.el !== el) return;
    const left = Math.max(0, 120 - Math.round((Date.now() - t0) / 1000)); const w = $("#btWaitT"); if (w) w.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    let r; try { r = await rpc("battle_state", { p_battle: b.id }); } catch (e) { return setTimeout(poll, 2000); }
    if (r.status === "playing") { BT.b = r; return btIntro(); }
    if (r.status === "declined" || r.status === "expired" || !left) { el.querySelector(".bt-wait").innerHTML = `<h2>${r.status === "declined" ? "Combat refusé" : "Pas de réponse"}</h2><p>${esc(pseudo)} ${r.status === "declined" ? "a refusé le combat" : "n'a pas répondu à temps"}. Tu peux lui lancer une bataille amicale contre son deck à la place.</p>
      <div class="bt-acts"><button class="btn primary" id="btAmical">Bataille amicale</button><button class="btn" id="btBack">Retour</button></div>`;
      $("#btAmical").onclick = () => { btClose(true); battleStart(friend); }; $("#btBack").onclick = () => btClose(); return; }
    setTimeout(poll, 1500);
  };
  setTimeout(poll, 1500);
}
// the invitations for me (asked every few seconds while the game is open), and a live battle to resume
async function btInvites() {
  if (!BT.ready || !me || !Online.active || document.hidden) return;
  let d; try { d = await rpc("battle_invites"); } catch (e) { return; }
  if (d.live && !BT.el) { try { BT.b = await rpc("battle_state", { p_battle: d.live }); BT.again = {}; btOpen(); return btDraw(); } catch (e) {} }
  const inv = d.invites.find(x => !BT.seen?.has(x.id)); if (!inv || BT.el || $("#btInv")) return;
  (BT.seen ??= new Set()).add(inv.id);
  const el = document.createElement("aside"); el.id = "btInv"; el.className = "bt-inv"; el.setAttribute("role", "alertdialog"); el.setAttribute("aria-labelledby", "btInvT");
  el.innerHTML = `<span class="bt-inv-i" aria-hidden="true">⚔️</span><div><b id="btInvT">${esc(inv.from)} te défie en direct !</b><small>Bataille de cartes amicale · ton deck contre le sien</small></div>
    <div class="bt-inv-a"><button class="btn primary" data-a="1">Accepter</button><button class="btn" data-a="0">Refuser</button></div>`;
  document.body.appendChild(el); requestAnimationFrame(() => el.classList.add("on"));
  const gone = setTimeout(() => el.remove(), 110000);
  el.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => {
    clearTimeout(gone); el.remove();
    try { const yes = b.dataset.a === "1", dk = yes ? await btChooseDeck() : {}; if (!dk) return rpc("battle_answer", { p_battle: inv.id, p_accept: false }).catch(() => {});
      const r = await rpc("battle_answer", dk.slot ? { p_battle: inv.id, p_accept: yes, p_deck: dk.slot } : { p_battle: inv.id, p_accept: yes }); if (r) { BT.b = r; BT.again = {}; btOpen(); btIntro(); } }
    catch (e) { toast(message(e)); }
  });
}
setInterval(btInvites, 6000);

function btIntro() {
  const b = BT.b, el = BT.el;
  el.innerHTML = `<div class="bt-vs"><p class="bt-mode">${b.revenge || BT.revenge ? "⚔️ Revanche" : btModeName(b)}</p><div class="bt-side bt-me">${btEmblem(b.me.league, 70)}<b>${esc(b.me.pseudo)}</b><small>${fmt(b.me.trophies)} 🏆</small></div>
    <div class="bt-vsx">VS</div><div class="bt-side bt-op">${btEmblem(b.opp.league, 70)}<b>${esc(b.opp.pseudo)}</b><small>${fmt(b.opp.trophies)} 🏆 · ${b.opp.league}</small></div></div>`;
  setTimeout(() => btDraw(), 1900);
}
function btDraw() {
  const b = BT.b, el = BT.el; if (!el) return;
  if (b.status === "done") return btEnd();
  const st = b.stat ? BT_STAT[b.stat] : null, his = b.log.map(x => x.his), live = b.mode === "live";
  el.innerHTML = `<button class="bt-quit" aria-label="Quitter">×</button>
    <div class="bt-top"><div class="bt-who">${btEmblem(b.opp.league, 30)}<b>${esc(b.opp.pseudo)}</b><em class="bt-tag">${btModeName(b)}</em></div>
      <div class="bt-opp">${Array.from({ length: 5 }, (_, i) => his[i] ? `<div class="bt-mini shown">${btCardEl(his[i]).outerHTML}</div>` : `<div class="bt-mini back"><span>?</span></div>`).join("")}</div>
      ${b.opp_skill_used !== undefined ? `<div class="bt-oinfo ${b.opp_skill_used ? "off" : ""}">✨ Sa compétence : <b>${b.opp_skill_used ? "déjà utilisée" : "encore en main"}</b></div>` : ""}</div>
    <div class="bt-mid">
      <div class="bt-score"><b class="bt-me">${b.a_won}</b><span>Manche ${Math.min(b.round + 1, 5)} / 5</span><b class="bt-op">${b.d_won}</b></div>
      ${live ? `<div class="bt-timer"><i><s id="btTime"></s></i><small id="btTimeT"></small></div>` : ""}
      <div class="bt-clash" id="btClash"></div>
      ${st ? `<div class="bt-stat" data-s="${b.stat}"><span>${st[2]}</span><div><b>${st[0]}</b><small>${st[1]} · la plus haute gagne</small></div></div>` : ""}
    </div>
    ${b.skill_used !== undefined && b.mine.some(x => x.skill) ? `<div class="bt-mysk ${b.skill_used ? "off" : ""}">✨ Ta compétence : <b>${b.skill_used ? "0 / 1 · déjà utilisée" : "1 / 1 disponible"}</b><small>1 seule par combat</small></div>` : ""}
    ${btCtrl(b)}
    <div class="bt-hand">${b.mine.map((j, i) => `<button class="bt-card${b.used.includes(i) ? " used" : ""}${BT.sel === i ? " bt-sel" : ""}" data-i="${i}"${b.used.includes(i) || b.status !== "playing" || b.picked ? " disabled" : ""}>
      <div class="bt-cw"></div>${st ? `<span class="bt-val">${j[b.stat] + (BT.sel === i ? btSkAdd(b, j) : 0)}</span>` : ""}${j.skill ? `<span class="bt-hsk" title="${esc(BT_SK[j.skill]?.[1] || "")}">${BT_SK[j.skill]?.[0] || "✨"}</span>` : ""}${j.fam != null ? `<span class="bt-hf">${BT_FAM[j.fam][0]}</span>` : ""}</button>`).join("")}</div>`;
  el.querySelectorAll(".bt-card").forEach((btn, i) => btn.querySelector(".bt-cw").appendChild(btCardEl(b.mine[i])));
  el.querySelector(".bt-quit").onclick = () => {
    if (b.status === "playing" && !confirm(live ? "Quitter le combat ? Tes cartes seront jouées au hasard." : "Abandonner la bataille ? Elle sera comptée comme perdue dans 10 minutes.")) return; btClose(); };
  // a card: picked first (to see its skill and its value), then played
  el.querySelectorAll(".bt-card:not([disabled])").forEach(btn => btn.onclick = () => { const i = +btn.dataset.i;
    if (b.skill_used === undefined) return btPlay(i);                     // an older battle: played at once
    if (BT.sel === i) return btPlay(i);
    BT.sel = i; BT.skOn = false; btDraw(); });
  const sk = $("#btSk"); if (sk) sk.onclick = () => { BT.skOn = !BT.skOn; btDraw(); };
  const go = $("#btGo"); if (go) go.onclick = () => btPlay(BT.sel);
  if (live) { btTimer(); if (b.picked) btWait(); }
}
// what a skill adds to my card for sure (the rest depends on his card)
function btSkAdd(b, j) {
  if (!BT.skOn || !j.skill) return 0;
  const lostPrev = b.log.length && !b.log[b.log.length - 1].won, point = b.a_won === 2 || b.d_won === 2;
  return j.skill === "ovation" ? 8 : j.skill === "refrain" && lostPrev ? 12 : j.skill === "hymne" && point ? 10
    : j.skill === "feat" && b.used.some(u => b.mine[u].artist === j.artist) ? 10 : 0;
}
// under the stat: the card picked, its skill to fire (or not), and the button to play
function btCtrl(b) {
  if (b.skill_used === undefined || b.status !== "playing" || b.picked) return "";
  const j = BT.sel != null && !b.used.includes(BT.sel) ? b.mine[BT.sel] : null;
  if (!j) return `<div class="bt-ctrl"><p class="bt-hint">Touche une carte de ta main pour la choisir${b.mine.some((x, i) => x.skill && !b.used.includes(i)) && !b.skill_used ? " · les cartes ✨ ont une compétence" : ""}.</p></div>`;
  const s = BT_SK[j.skill], can = j.skill && !b.skill_used, add = btSkAdd(b, j), f = j.fam;
  return `<div class="bt-ctrl on"><div class="bt-ctrl-r">
      ${can ? `<button type="button" class="bt-skb${BT.skOn ? " on" : ""}" id="btSk">${s[0]} ${BT.skOn ? "Compétence activée" : "Activer"} : ${s[1]}<small>${s[2]}${BT.skOn ? " · c'est ta seule compétence du combat" : " · 1 seule par combat"}</small></button>`
        : j.skill ? `<span class="bt-skx">✨ Compétence déjà utilisée : 1 seule par combat</span>` : ""}
      <button class="btn primary bt-go2" id="btGo">⚔️ Jouer ${esc(j.title || "")}</button></div>
    <p class="bt-hint">Valeur : <b>${j[b.stat]}</b>${add ? ` + ${add} = <b class="g">${j[b.stat] + add}</b>` : ""}${BT.skOn && j.skill === "larsen" ? " · <b>−10 pour lui</b>" : ""}${BT.skOn && j.skill === "remix" ? " · la stat va être retirée au sort !" : ""}
      ${f != null ? `<small>${BT_FAM[f][0]} +10 si sa carte est ${BT_FAM[(f + 1) % 3][0]} ${BT_FAM[(f + 1) % 3][1]} · +10 pour lui si elle est ${BT_FAM[(f + 2) % 3][0]} ${BT_FAM[(f + 2) % 3][1]}</small>` : ""}</p></div>`;
}
// live: the time left to play this round
function btTimer() {
  clearInterval(BT.tick);
  const end = Date.parse(BT.b.deadline);
  const f = () => { const s = $("#btTime"), t = $("#btTimeT"); if (!s || !BT.el) return clearInterval(BT.tick);
    const left = Math.max(0, (end - Date.now()) / 1000); s.style.width = Math.min(100, left / 25 * 100) + "%"; t.textContent = Math.ceil(left) + " s";
    s.parentElement.classList.toggle("low", left < 6); if (!left && !BT.waiting) btWait(); };
  f(); BT.tick = setInterval(f, 250);
}
// live: my card is down, the other one's is awaited (the server plays one at random after the time)
async function btWait() {
  if (BT.waiting) return; BT.waiting = true;
  const round = BT.b.round, clash = $("#btClash");
  if (clash && BT.b.picked) clash.innerHTML = `<p class="bt-hold">Carte posée · ${esc(BT.b.opp.pseudo)} choisit la sienne…</p>`;
  for (;;) {
    await wait(1200);
    if (!BT.el) { BT.waiting = false; return; }
    let r; try { r = await rpc("battle_state", { p_battle: BT.b.id }); } catch (e) { continue; }
    if (r.round > round || r.status === "done") { BT.waiting = false; clearInterval(BT.tick); return btShow(r.log[round], r); }
  }
}
async function btPlay(i) {
  if (BT.busy) return; BT.busy = true;
  const b = BT.b, el = BT.el;
  el.querySelectorAll(".bt-card").forEach(x => x.disabled = true);
  el.querySelector(`.bt-card[data-i="${i}"]`)?.classList.add("go");
  const skill = !!BT.skOn && !b.skill_used && !!b.mine[i]?.skill; BT.sel = null; BT.skOn = false; el.querySelector(".bt-ctrl")?.remove();
  let r; try { r = await rpc("battle_play", skill ? { p_battle: b.id, p_slot: i, p_skill: true } : { p_battle: b.id, p_slot: i }); } catch (e) { BT.busy = false; toast(message(e)); return btDraw(); }
  BT.busy = false;
  if (!r.last) { BT.b = r; return btWait(); }          // live: the other one has not played yet
  clearInterval(BT.tick);
  return btShow(r.last, r);
}
// the two cards of a round face to face, the values, the winner
async function btShow(x, r) {
  const b = BT.b, clash = $("#btClash"); if (!clash) { BT.b = r; return btDraw(); }
  BT.busy = true;
  const bon = (base, l, sk) => base == null ? "" : `<ul class="bt-bon"><li>Base <b>${base}</b></li>${(l || []).map(y => `<li class="${y.v < 0 ? "neg" : ""}">${esc(y.t)} <b>${y.v > 0 ? "+" : ""}${y.v}</b></li>`).join("")}${sk && BT_SK[sk] ? `<li class="sk">${BT_SK[sk][0]} ${BT_SK[sk][1]}</li>` : ""}</ul>`;
  clash.innerHTML = `${x.stat0 && x.stat !== x.stat0 ? `<p class="bt-remix">🎛️ Remix ! La stat devient <b>${BT_STAT[x.stat][0]}</b></p>` : ""}<div class="bt-duel"><div class="bt-c bt-me"><div class="bt-cw"></div><b class="bt-v" data-v="${x.mv}">0</b>${bon(x.mb, x.mbon, x.msk)}</div>
    <div class="bt-c bt-op"><div class="bt-flip"><div class="bt-back"><span>?</span></div><div class="bt-front"></div></div><b class="bt-v" data-v="${x.hv}">0</b>${bon(x.hb, x.hbon, x.hsk)}</div></div>`;
  clash.querySelector(".bt-me .bt-cw").appendChild(btCardEl(b.mine[x.mine]));
  clash.querySelector(".bt-front").appendChild(btCardEl(x.his));
  await wait(450); clash.querySelector(".bt-flip").classList.add("on");
  await wait(600);
  clash.querySelectorAll(".bt-v").forEach(v => wrCountTo(v, +v.dataset.v));
  await wait(1000);
  clash.querySelector(x.won ? ".bt-c.bt-me" : ".bt-c.bt-op").classList.add("win");
  clash.querySelector(x.won ? ".bt-c.bt-op" : ".bt-c.bt-me").classList.add("lose");
  clash.insertAdjacentHTML("beforeend", `<p class="bt-verdict ${x.won ? "w" : "l"}">${x.won ? "Manche gagnée !" : "Manche perdue"}</p>`);
  await wait(1500);
  BT.b = r; BT.busy = false;
  if (r.status === "done") return btEnd(); else btDraw();
}
function wrCountTo(n, to) {
  const t0 = performance.now();
  const f = t => { const k = Math.min(1, (t - t0) / 700); n.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1 && n.isConnected) requestAnimationFrame(f); };
  requestAnimationFrame(f);
}
async function btEnd() {
  const b = BT.b, el = BT.el, won = b.winner, ranked = b.mode === "ranked" || !!b.ranked, after = b.me.trophies, before = after - (b.delta || 0);
  const lg = n => LEAGUES.slice().reverse().find(l => n >= l[1]) || LEAGUES[0], L = lg(after), up = L !== lg(before);
  if (ranked) { lgSave(L[0]); if (up && !BT.filmed?.has(b.id)) { (BT.filmed ??= new Set()).add(b.id); await leagueFilm(lg(before)[0], L[0], after > before); } }
  el.innerHTML = `<div class="bt-end ${won ? "w" : "l"}"><p class="bt-k">${BT.revenge ? "Revanche" : btModeName(b)} · ${b.a_won} – ${b.d_won} contre ${esc(b.opp.pseudo)}</p><h2>${won ? (BT.revenge ? "Vengé !" : "Victoire !") : "Défaite"}</h2>${BT.revenge && won ? `<p class="bt-friendly">${esc(b.opp.pseudo)} va savoir que tu as pris ta revanche.</p>` : ""}
    ${ranked ? `<div class="bt-delta">${btEmblem(L[0], 110)}<b>${b.delta > 0 ? "+" : ""}${b.delta || 0} 🏆</b><small>${fmt(after)} trophées · ${L[0]}${up ? (won ? " · nouvelle ligue !" : " · tu redescends") : ""}</small></div>`
      : `<p class="bt-friendly">Match amical : pas de trophées en jeu, juste l'honneur.</p>`}
    ${b.reward ? `<p class="bt-rw">+${b.reward} Streams</p>` : ""}
    <div class="bt-oc">${(b.opp_cards || []).map(j => `<div>${btCardEl(j).outerHTML}</div>`).join("")}</div>
    <div class="bt-acts"><button class="btn primary" id="btAgain">${BT.again?.rlive ? "⚡ Nouveau classé en direct" : BT.again?.live ? "⚔️ Revanche en direct" : BT.again?.friend ? "⚔️ Revanche" : "⚔️ Rejouer"}</button><button class="btn" id="btBack">Retour</button></div></div>`;
  $("#btAgain").onclick = () => { const a = BT.again || {}; btClose(true); if (a.rlive) btQueue(a.deck); else if (a.live) battleInvite(a.live, a.pseudo); else battleStart(a.friend, "deck" in a ? a.deck : undefined); };
  $("#btBack").onclick = () => btClose();
  try { loadProfile(); } catch (e) {}
}
function btClose(quiet) {
  clearInterval(BT.tick); BT.revenge = false; BT.waiting = false;
  const el = BT.el; if (!el) return; BT.el = null;
  el.classList.remove("on"); document.body.classList.remove("fx-on"); setTimeout(() => el.remove(), quiet ? 0 : 350);
  if (!quiet && !views.battle.hidden) renderBattle();
}

// a friend to fight: friendly against his deck, or live when he is online
async function btFriends() {
  const box = $("#btFriends"); if (!box) return;
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false; box.innerHTML = `<p class="empty-line">Chargement de tes amis…</p>`;
  let d; try { d = await rpc("my_friends"); } catch (e) { box.innerHTML = ""; return toast(message(e)); }
  const f = d.friends.sort((a, b) => b.online - a.online);
  box.innerHTML = f.length ? `<p class="bt-fr-h">Défie un ami : <b>amicale</b> contre son deck (il reçoit le résultat), ou <b>en direct</b> s'il est en ligne (chacun choisit ses cartes). Sans trophées.</p>
    <ul class="bt-fr">${f.map(p => `<li>${socAvatar(p)}<span class="soc-who">${socName(p)}${socSeen(p)}</span>
      <span class="soc-acts"><button class="btn" data-fa="${p.id}">Amicale</button>${p.online ? `<button class="btn primary" data-fl="${p.id}" data-n="${esc(p.pseudo)}">⚡ En direct</button>` : ""}</span></li>`).join("")}</ul>`
    : `<p class="empty-line">Ajoute des amis dans l'onglet Joueurs pour les défier.</p>`;
  box.querySelectorAll("[data-fa]").forEach(b => b.onclick = () => battleStart(b.dataset.fa));
  box.querySelectorAll("[data-fl]").forEach(b => b.onclick = () => battleInvite(b.dataset.fl, b.dataset.n));
}
window.battleWith = (id, pseudo, live) => { show("battle"); setTimeout(() => live ? battleInvite(id, pseudo) : battleStart(id), 300); };
Object.assign(Online, { renderBattle: () => renderBattle() });
