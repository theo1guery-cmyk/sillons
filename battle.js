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
  try { [h, board] = await Promise.all([rpc("battle_home"), rpc("battle_leaderboard")]); } catch (e) { return toast(message(e)); }
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
      <div class="bt-go"><button class="btn primary bt-fight" id="btFight">⚔️ Combattre</button><button class="btn" id="btFriendsB">👥 Défier un ami</button>
        <small>${h.wins} victoire${h.wins > 1 ? "s" : ""} · ${h.losses} défaite${h.losses > 1 ? "s" : ""}</small>
        <small class="bt-day">Victoires du jour : <b>${Math.min(h.today, 5)} / 5</b> · +100 Streams chacune</small></div>
    </section>
    <button class="bt-lgcta" id="btLeagues" style="--lc:${L[2]}"><span class="bt-lgcta-e">${btEmblem(h.league, 40)}</span>
      <span><b>Les ligues et leurs récompenses</b><small>Ta place, les 6 ligues, le cadeau de fin de saison${next ? ` · ${fmt(next[1] - h.trophies)} 🏆 avant ${next[0]}` : ""}</small></span><em>Voir →</em></button>
    <div class="bt-fbox" id="btFriends" hidden></div>
    <details class="bt-rules"><summary>Comment ça marche ?</summary>
      <p>Ton deck de 5 cartes affronte celui d'un joueur de ton niveau. À chaque manche, une stat est tirée au sort : <b>Tempo</b> (la 1re barre de la carte : Flow, Éclat, Riff…), <b>Endurance</b> (la durée), <b>Hype</b> (la popularité) ou <b>Puissance</b> (la moyenne). Tu choisis quelle carte jouer sans voir la sienne : la plus forte dans cette stat gagne la manche. La rareté, la note et le Shiny donnent un petit bonus. <b>3 manches gagnées et c'est la victoire.</b> Chaque carte ne sert qu'une fois : garde tes meilleures pour le bon moment !</p>
      <p>Tu peux aussi <b>défier un ami</b> : en amicale contre son deck, ou <b>en direct</b> s'il est en ligne (chacun choisit sa carte à chaque manche, 25 secondes pour jouer). Les matchs entre amis ne donnent pas de trophées.</p>
      <p><b>🔗 Les synergies</b> : plus ton deck a de morceaux en commun, plus ils sont forts. Même artiste (2 : +4 chacun, jusqu'à +16 pour 5), même album (2 : +6, jusqu'à +24), même année (3 : +4, jusqu'à +10), même genre (3 : +3, jusqu'à +8), et l'Arc-en-ciel (5 raretés différentes : +6 à toutes). Elles se cumulent, jusqu'à +30 par carte.</p>
      <p><b>Tes cartes gradées comptent</b> : une note 6 donne +3 à toutes les stats, 7 : +5, 8 : +7, 9 : +11, 10 : +16, et une 9 ou une 10 a le <b>Sang-froid</b> (elle gagne les égalités). <b>Tes cartes artistes aussi</b> : choisis ta <b>Tête d'affiche</b>, ses morceaux dans ton deck prennent un gros bonus (+5, plus 2 par certification, plus 4 si Shiny ou Collector) et les autres une petite aura.</p>
      <p>Les trophées font ta ligue : Bronze, Argent (400), Or (900), Platine (1 500), Diamant (2 300), Légende (3 200). Ton deck défend aussi quand on t'attaque : à ton retour, le <b>journal de défense</b> te dit qui t'a attaqué, et tu as 24 h pour prendre ta <b>revanche</b> sur ceux qui ont gagné (une par joueur, 3 par jour, et une revanche ne se rend pas).</p></details>
    <section class="bt-deck"><h3>Mon deck${h.chosen ? "" : " <small>(automatique : tes 5 cartes les plus fortes)</small>"} <button class="ps-link" id="btEdit">✎ Modifier</button></h3>
      ${btHeadBlock(h)}
      ${btSynHTML(btSynList(h.deck), h.deck.length ? "Aucune pour l'instant : mets plusieurs morceaux du même artiste, du même album, de la même année ou du même genre." : "")}
      <div class="bt-row" id="btDeck"></div><div id="btPick"></div></section>
    <div class="bt-cols">
      <section><h3>Mes dernières batailles</h3>${h.history.length ? `<ul class="bt-hist">${h.history.map(x => `<li class="${x.won ? "w" : "l"}">
        <span class="bt-res">${x.won ? "Victoire" : "Défaite"}</span><span>${x.mode === "live" ? "en direct contre" : x.mode === "friend" ? (x.attack ? "amicale contre" : "amicale, défense contre") : x.attack ? "contre" : "défense contre"} <button class="ps-link" data-p="${x.other_id || ""}">${esc(x.other || "?")}</button> · ${x.score}</span>
        <b>${x.delta > 0 ? "+" : ""}${x.delta ?? 0} 🏆</b>${x.revenge ? `<button class="btn bt-rvb" data-rv="${x.id}">⚔️ Revanche</button>` : ""}</li>`).join("")}</ul>` : `<p class="empty-line">Aucune bataille pour l'instant. Lance ta première !</p>`}</section>
      <section><h3>Classement des batailles</h3><ol class="bt-board">${board.map((p, i) => `<li class="${p.me ? "me" : ""}"><span class="rk">${i + 1}</span>${btEmblem(p.league, 22)}
        <button class="ps-link" data-p="${p.id}">${esc(p.pseudo)}</button><b>${fmt(p.trophies)} 🏆</b></li>`).join("") || `<p class="empty-line">Le classement attend ses premiers combattants.</p>`}</ol></section>
    </div>`;
  const deck = $("#btDeck");
  for (const j of h.deck) { const w = document.createElement("div"); w.className = "bt-dc"; w.appendChild(btCardEl(j)); w.insertAdjacentHTML("beforeend", btBars(j, true)); deck.appendChild(w); }
  $("#btFight").onclick = () => battleStart();
  $("#btFriendsB").onclick = () => btFriends();
  $("#btLeagues").onclick = () => { BT.sub = "leagues"; renderBattle(); };
  window.b2Panel?.(box);                           // the Bataille 2.0 in simulation (admins only)
  $("#btEdit").onclick = () => btPick();
  const he = $("#btHeadEdit"); if (he) he.onclick = () => btPick();
  box.querySelectorAll("[data-p]").forEach(b => b.onclick = () => b.dataset.p && window.openProfile?.(b.dataset.p));
  box.querySelectorAll("[data-rv]").forEach(b => b.onclick = () => battleRevenge(b.dataset.rv));
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
async function btPick() {
  const box = $("#btPick");
  const list = [];
  for (const c of Object.values(S.c)) { if (isArtist(c) || c.ed) continue; const cp = c.copies.find(x => x.grade) || c.copies.find(x => x.holo) || c.copies[0]; if (cp) list.push([c, cp]); }
  const gb = cp => BT_GRADE[cp.grade || 0] || 0;
  const val = ([c, cp]) => stats(c).pw + c.tier * 3 + gb(cp) + (cp.holo ? 4 : 0);
  const arts = Object.values(S.c).filter(c => isArtist(c) && c.copies?.length).map(c => [c, c.copies.find(x => x.holo) || c.copies[0]]).sort((a, b) => b[0].tier - a[0].tier);
  const synOf = ([a, cp]) => 5 + 2 * a.tier + (cp.holo || a.collector ? 4 : 0), auraOf = ([a]) => Math.floor(a.tier / 2) + (a.collector ? 1 : 0);
  if (BT.art === undefined) BT.art = BT.home.artist_chosen ? BT.home.artist?.id : null;
  list.sort((a, b) => val(b) - val(a));
  BT.edit ??= BT.home.chosen ? BT.home.deck.map(j => j.id) : [];
  const draw = () => {
    box.innerHTML = `<div class="pf-picker"><p>Choisis 5 cartes (des morceaux différents). Pense à varier : une carte rapide pour le Tempo, une longue pour l'Endurance, une star pour la Hype. Les cartes gradées, les morceaux de ta Tête d'affiche et les <b>synergies</b> (même artiste, même album, même année, même genre) sont boostés. <b>${BT.edit.length} / 5</b></p>
      <div class="pf-pacts"><button class="btn" id="btAuto">Deck automatique</button><button class="btn" id="btCancel">Annuler</button><button class="btn primary" id="btSave"${BT.edit.length === 5 ? "" : " disabled"}>Enregistrer mon deck</button></div>
      <div class="bt-arts"><p><b>🎤 Tête d'affiche</b> : ses morceaux dans ton deck prennent un gros bonus, les autres une petite aura.</p>
        <div class="bt-arts-l"><button type="button" class="bt-art${BT.art ? "" : " on"}" data-a=""><span class="bt-art-ph">✨</span><b>Automatique</b><small>la mieux adaptée</small></button>
        ${arts.map(([a, cp]) => { const n = BT.edit.filter(id => list.find(([, x]) => x.id === id)?.[0].a === a.t).length;
          return `<button type="button" class="bt-art${BT.art === cp.id ? " on" : ""}" data-a="${cp.id}">${a.cov ? `<img src="${esc(a.cov)}" alt="">` : `<span class="bt-art-ph">🎤</span>`}<b>${esc(a.t)}</b>
            <small>+${synOf([a, cp])}${n ? ` × ${n} morceau${n > 1 ? "x" : ""}` : ""} · ${CERT[a.tier] || ""}${a.collector ? " · Collector" : cp.holo ? " · Shiny" : ""}</small></button>`; }).join("") || `<p class="empty-line">Pas encore de carte artiste.</p>`}</div></div>
      <div class="bt-sort" role="group" aria-label="Trier les cartes"><span>Trier par</span>${[["best", "⭐ Recommandé"], ["pw", "💥 Puissance"], ["flow", "⚡ Tempo"], ["endu", "⏱ Endurance"], ["hype", "🔥 Hype"]].map(([k, t]) =>
        `<button type="button" data-s="${k}" aria-pressed="${(BT.sort || "best") === k}">${t}</button>`).join("")}</div>
      <div id="btSynNow"></div>
      <div class="pf-grid" id="btGrid"></div></div>`;
    box.querySelectorAll("[data-s]").forEach(b => b.onclick = () => { BT.sort = b.dataset.s; draw(); });
    box.querySelectorAll("[data-a]").forEach(b => b.onclick = () => { BT.art = b.dataset.a || null; draw(); });
    const head = BT.art ? arts.find(([, cp]) => cp.id === BT.art) : null;
    const g = $("#btGrid"), tracks = new Set(BT.edit.map(id => list.find(([, cp]) => cp.id === id)?.[0].id));
    // the values with every bonus (grade, Shiny, rarity, Tête d'affiche), sorted by the chosen stat
    // with the synergies it would have in the deck (the cards picked, plus this one)
    const picked = BT.edit.map(id => list.find(([, cp]) => cp.id === id)?.[0]).filter(Boolean);
    const synIn = c => { const deck = picked.includes(c) ? picked : [...picked, c].slice(-5); return btSynergy(deck)[deck.indexOf(c)]; };
    const vOf = ([c, cp]) => { const st = stats(c), star = head && head[0].t === c.a, syn = head ? star ? synOf(head) : auraOf(head) : 0, sy = synIn(c), b = c.tier * 3 + gb(cp) + (cp.holo ? 4 : 0) + syn + sy.sb;
      return { flow: st.flow + b, endu: st.endu + b, hype: st.hype + b, pw: st.pw + b, grade: cp.grade, syn, star, head: head?.[0].t, sb: sy.sb, syns: sy.syns }; };
    $("#btSynNow").innerHTML = btSynHTML(btSynList(btSynergy(picked)), picked.length ? "Aucune pour l'instant. Les chiffres des cartes montrent ce qu'elles vaudraient avec ton deck." : "Les chiffres des cartes tiennent compte des synergies avec les cartes déjà choisies.");
    const k = BT.sort || "best", shown = list.map(x => [...x, vOf(x)]);   // "Recommandé": the usual order (the strongest cards overall)
    if (k !== "best") shown.sort((a, b) => b[2][k] - a[2][k]);
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
    const save = async ids => { try { await rpc("set_battle_deck", { p_cards: ids, p_artist: BT.art || null }); toast("Deck enregistré !"); BT.edit = null; BT.art = undefined; renderBattle(); } catch (e) { toast(message(e)); } };
    $("#btSave").onclick = () => save(BT.edit); $("#btAuto").onclick = () => save([]); $("#btCancel").onclick = () => { BT.edit = null; BT.art = undefined; box.innerHTML = ""; };
  };
  draw(); box.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------------------------------------------------------------- the battle */
const BT_MODE = { ranked: "Classée", friend: "Amicale", live: "En direct" };
function btOpen() {
  if (BT.el) return BT.el;
  const el = BT.el = document.createElement("div"); el.className = "bt-arena"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Bataille de cartes");
  document.body.appendChild(el); document.body.classList.add("fx-on");
  requestAnimationFrame(() => el.classList.add("on"));
  return el;
}
// ranked (no friend) or friendly (a friend's deck answers for him)
async function battleStart(friend) {
  if (BT.busy) return; BT.busy = true;
  try { BT.b = await rpc("battle_start", { p_friend: friend || null }); } catch (e) { BT.busy = false; return toast(message(e)); }
  BT.busy = false; BT.again = friend ? { friend } : {}; BT.revenge = false;
  btOpen(); btIntro();
}
// the revenge: a ranked battle against the one who beat my deck while I was away (once, within 24 hours)
async function battleRevenge(id) {
  if (BT.busy) return; BT.busy = true;
  try { BT.b = await rpc("battle_revenge", { p_battle: id }); } catch (e) { BT.busy = false; return toast(message(e)); }
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
// live: I invite a friend and wait (2 minutes at most) for him to accept
async function battleInvite(friend, pseudo) {
  if (BT.busy) return; BT.busy = true;
  let b; try { b = await rpc("battle_invite", { p_friend: friend }); } catch (e) { BT.busy = false; return toast(message(e)); }
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
    try { const r = await rpc("battle_answer", { p_battle: inv.id, p_accept: b.dataset.a === "1" }); if (r) { BT.b = r; BT.again = {}; btOpen(); btIntro(); } }
    catch (e) { toast(message(e)); }
  });
}
setInterval(btInvites, 6000);

function btIntro() {
  const b = BT.b, el = BT.el;
  el.innerHTML = `<div class="bt-vs"><p class="bt-mode">${b.revenge || BT.revenge ? "⚔️ Revanche" : BT_MODE[b.mode]}</p><div class="bt-side bt-me">${btEmblem(b.me.league, 70)}<b>${esc(b.me.pseudo)}</b><small>${fmt(b.me.trophies)} 🏆</small></div>
    <div class="bt-vsx">VS</div><div class="bt-side bt-op">${btEmblem(b.opp.league, 70)}<b>${esc(b.opp.pseudo)}</b><small>${fmt(b.opp.trophies)} 🏆 · ${b.opp.league}</small></div></div>`;
  setTimeout(() => btDraw(), 1900);
}
function btDraw() {
  const b = BT.b, el = BT.el; if (!el) return;
  if (b.status === "done") return btEnd();
  const st = b.stat ? BT_STAT[b.stat] : null, his = b.log.map(x => x.his), live = b.mode === "live";
  el.innerHTML = `<button class="bt-quit" aria-label="Quitter">×</button>
    <div class="bt-top"><div class="bt-who">${btEmblem(b.opp.league, 30)}<b>${esc(b.opp.pseudo)}</b><em class="bt-tag">${BT_MODE[b.mode]}</em></div>
      <div class="bt-opp">${Array.from({ length: 5 }, (_, i) => his[i] ? `<div class="bt-mini shown">${btCardEl(his[i]).outerHTML}</div>` : `<div class="bt-mini back"><span>?</span></div>`).join("")}</div></div>
    <div class="bt-mid">
      <div class="bt-score"><b class="bt-me">${b.a_won}</b><span>Manche ${Math.min(b.round + 1, 5)} / 5</span><b class="bt-op">${b.d_won}</b></div>
      ${live ? `<div class="bt-timer"><i><s id="btTime"></s></i><small id="btTimeT"></small></div>` : ""}
      <div class="bt-clash" id="btClash"></div>
      ${st ? `<div class="bt-stat" data-s="${b.stat}"><span>${st[2]}</span><div><b>${st[0]}</b><small>${st[1]} · la plus haute gagne</small></div></div>` : ""}
    </div>
    <div class="bt-hand">${b.mine.map((j, i) => `<button class="bt-card${b.used.includes(i) ? " used" : ""}" data-i="${i}"${b.used.includes(i) || b.status !== "playing" || b.picked ? " disabled" : ""}>
      <div class="bt-cw"></div>${st ? `<span class="bt-val">${j[b.stat]}</span>` : ""}</button>`).join("")}</div>`;
  el.querySelectorAll(".bt-card").forEach((btn, i) => btn.querySelector(".bt-cw").appendChild(btCardEl(b.mine[i])));
  el.querySelector(".bt-quit").onclick = () => {
    if (b.status === "playing" && !confirm(live ? "Quitter le combat ? Tes cartes seront jouées au hasard." : "Abandonner la bataille ? Elle sera comptée comme perdue dans 10 minutes.")) return; btClose(); };
  el.querySelectorAll(".bt-card:not([disabled])").forEach(btn => btn.onclick = () => btPlay(+btn.dataset.i));
  if (live) { btTimer(); if (b.picked) btWait(); }
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
  let r; try { r = await rpc("battle_play", { p_battle: b.id, p_slot: i }); } catch (e) { BT.busy = false; toast(message(e)); return btDraw(); }
  BT.busy = false;
  if (!r.last) { BT.b = r; return btWait(); }          // live: the other one has not played yet
  clearInterval(BT.tick);
  return btShow(r.last, r);
}
// the two cards of a round face to face, the values, the winner
async function btShow(x, r) {
  const b = BT.b, clash = $("#btClash"); if (!clash) { BT.b = r; return btDraw(); }
  BT.busy = true;
  clash.innerHTML = `<div class="bt-duel"><div class="bt-c bt-me"><div class="bt-cw"></div><b class="bt-v" data-v="${x.mv}">0</b></div>
    <div class="bt-c bt-op"><div class="bt-flip"><div class="bt-back"><span>?</span></div><div class="bt-front"></div></div><b class="bt-v" data-v="${x.hv}">0</b></div></div>`;
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
  const b = BT.b, el = BT.el, won = b.winner, ranked = b.mode === "ranked", after = b.me.trophies, before = after - (b.delta || 0);
  const lg = n => LEAGUES.slice().reverse().find(l => n >= l[1]) || LEAGUES[0], L = lg(after), up = L !== lg(before);
  if (ranked) { lgSave(L[0]); if (up && !BT.filmed?.has(b.id)) { (BT.filmed ??= new Set()).add(b.id); await leagueFilm(lg(before)[0], L[0], after > before); } }
  el.innerHTML = `<div class="bt-end ${won ? "w" : "l"}"><p class="bt-k">${BT.revenge ? "Revanche" : BT_MODE[b.mode]} · ${b.a_won} – ${b.d_won} contre ${esc(b.opp.pseudo)}</p><h2>${won ? (BT.revenge ? "Vengé !" : "Victoire !") : "Défaite"}</h2>${BT.revenge && won ? `<p class="bt-friendly">${esc(b.opp.pseudo)} va savoir que tu as pris ta revanche.</p>` : ""}
    ${ranked ? `<div class="bt-delta">${btEmblem(L[0], 110)}<b>${b.delta > 0 ? "+" : ""}${b.delta || 0} 🏆</b><small>${fmt(after)} trophées · ${L[0]}${up ? (won ? " · nouvelle ligue !" : " · tu redescends") : ""}</small></div>`
      : `<p class="bt-friendly">Match amical : pas de trophées en jeu, juste l'honneur.</p>`}
    ${b.reward ? `<p class="bt-rw">+${b.reward} Streams</p>` : ""}
    <div class="bt-oc">${(b.opp_cards || []).map(j => `<div>${btCardEl(j).outerHTML}</div>`).join("")}</div>
    <div class="bt-acts"><button class="btn primary" id="btAgain">${BT.again?.live ? "⚔️ Revanche en direct" : BT.again?.friend ? "⚔️ Revanche" : "⚔️ Rejouer"}</button><button class="btn" id="btBack">Retour</button></div></div>`;
  $("#btAgain").onclick = () => { const a = BT.again || {}; btClose(true); if (a.live) battleInvite(a.live, a.pseudo); else battleStart(a.friend); };
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
