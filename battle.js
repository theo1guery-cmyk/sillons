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
const btBars = j => `<ul class="bt-bars">${["flow", "endu", "hype", "pw"].map(s => `<li><span>${BT_STAT[s][0]}</span><i><s style="width:${Math.min(100, j[s])}%"></s></i><b>${j[s]}</b></li>`).join("")}</ul>`;

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
  if (!BT.el) leagueCheck(h.trophies);             // a league won or lost while away (my deck defends)
  const L = btLeague(h.league), k = LEAGUES.indexOf(L), next = LEAGUES[k + 1];
  const pct = next ? Math.round((h.trophies - L[1]) / (next[1] - L[1]) * 100) : 100;
  box.innerHTML = `<section class="bt-hero" style="--lc:${L[2]}">
      <div class="bt-lg">${btEmblem(h.league, 92)}<div><p class="bt-k">Ligue</p><h2>${h.league}</h2>
        <p class="bt-tr"><b>${fmt(h.trophies)}</b> 🏆 · ${h.rank}<sup>${h.rank === 1 ? "er" : "e"}</sup> au classement</p>
        <div class="bt-prog" aria-label="Progression vers la ligue suivante"><s style="width:${pct}%"></s></div>
        <small>${next ? `${fmt(next[1] - h.trophies)} 🏆 avant ${next[0]}` : "Tu es au sommet !"} · record ${fmt(h.best)} 🏆</small>
        <button class="ps-link bt-lglink" id="btLeagues">🛡️ Les ligues et leurs récompenses →</button></div></div>
      <div class="bt-go"><button class="btn primary bt-fight" id="btFight">⚔️ Combattre</button><button class="btn" id="btFriendsB">👥 Défier un ami</button>
        <small>${h.wins} victoire${h.wins > 1 ? "s" : ""} · ${h.losses} défaite${h.losses > 1 ? "s" : ""}</small>
        <small class="bt-day">Victoires du jour : <b>${Math.min(h.today, 5)} / 5</b> · +100 Streams chacune</small></div>
    </section>
    <div class="bt-fbox" id="btFriends" hidden></div>
    <details class="bt-rules"><summary>Comment ça marche ?</summary>
      <p>Ton deck de 5 cartes affronte celui d'un joueur de ton niveau. À chaque manche, une stat est tirée au sort : <b>Tempo</b> (la 1re barre de la carte : Flow, Éclat, Riff…), <b>Endurance</b> (la durée), <b>Hype</b> (la popularité) ou <b>Puissance</b> (la moyenne). Tu choisis quelle carte jouer sans voir la sienne : la plus forte dans cette stat gagne la manche. La rareté, la note et le Shiny donnent un petit bonus. <b>3 manches gagnées et c'est la victoire.</b> Chaque carte ne sert qu'une fois : garde tes meilleures pour le bon moment !</p>
      <p>Tu peux aussi <b>défier un ami</b> : en amicale contre son deck, ou <b>en direct</b> s'il est en ligne (chacun choisit sa carte à chaque manche, 25 secondes pour jouer). Les matchs entre amis ne donnent pas de trophées.</p>
      <p>Les trophées font ta ligue : Bronze, Argent (400), Or (900), Platine (1 500), Diamant (2 300), Légende (3 200). Ton deck défend aussi quand on t'attaque.</p></details>
    <section class="bt-deck"><h3>Mon deck${h.chosen ? "" : " <small>(automatique : tes 5 cartes les plus fortes)</small>"} <button class="ps-link" id="btEdit">✎ Modifier</button></h3>
      <div class="bt-row" id="btDeck"></div><div id="btPick"></div></section>
    <div class="bt-cols">
      <section><h3>Mes dernières batailles</h3>${h.history.length ? `<ul class="bt-hist">${h.history.map(x => `<li class="${x.won ? "w" : "l"}">
        <span class="bt-res">${x.won ? "Victoire" : "Défaite"}</span><span>${x.mode === "live" ? "en direct contre" : x.mode === "friend" ? (x.attack ? "amicale contre" : "amicale, défense contre") : x.attack ? "contre" : "défense contre"} <button class="ps-link" data-p="${x.other_id || ""}">${esc(x.other || "?")}</button> · ${x.score}</span>
        <b>${x.delta > 0 ? "+" : ""}${x.delta ?? 0} 🏆</b></li>`).join("")}</ul>` : `<p class="empty-line">Aucune bataille pour l'instant. Lance ta première !</p>`}</section>
      <section><h3>Classement des batailles</h3><ol class="bt-board">${board.map((p, i) => `<li class="${p.me ? "me" : ""}"><span class="rk">${i + 1}</span>${btEmblem(p.league, 22)}
        <button class="ps-link" data-p="${p.id}">${esc(p.pseudo)}</button><b>${fmt(p.trophies)} 🏆</b></li>`).join("") || `<p class="empty-line">Le classement attend ses premiers combattants.</p>`}</ol></section>
    </div>`;
  const deck = $("#btDeck");
  for (const j of h.deck) { const w = document.createElement("div"); w.className = "bt-dc"; w.appendChild(btCardEl(j)); w.insertAdjacentHTML("beforeend", btBars(j)); deck.appendChild(w); }
  $("#btFight").onclick = () => battleStart();
  $("#btFriendsB").onclick = () => btFriends();
  $("#btLeagues").onclick = () => { BT.sub = "leagues"; renderBattle(); };
  $("#btEdit").onclick = () => btPick();
  box.querySelectorAll("[data-p]").forEach(b => b.onclick = () => b.dataset.p && window.openProfile?.(b.dataset.p));
}

// my deck: 5 different tracks, the strongest shown first with their stats
async function btPick() {
  const box = $("#btPick");
  const list = [];
  for (const c of Object.values(S.c)) { if (isArtist(c) || c.ed) continue; const cp = c.copies.find(x => x.grade) || c.copies.find(x => x.holo) || c.copies[0]; if (cp) list.push([c, cp]); }
  const val = ([c, cp]) => stats(c).pw + c.tier * 3 + (cp.grade || 0) + (cp.holo ? 4 : 0);
  list.sort((a, b) => val(b) - val(a));
  BT.edit ??= BT.home.chosen ? BT.home.deck.map(j => j.id) : [];
  const draw = () => {
    box.innerHTML = `<div class="pf-picker"><p>Choisis 5 cartes (des morceaux différents). Pense à varier : une carte rapide pour le Tempo, une longue pour l'Endurance, une star pour la Hype. <b>${BT.edit.length} / 5</b></p>
      <div class="pf-pacts"><button class="btn" id="btAuto">Deck automatique</button><button class="btn" id="btCancel">Annuler</button><button class="btn primary" id="btSave"${BT.edit.length === 5 ? "" : " disabled"}>Enregistrer mon deck</button></div>
      <div class="pf-grid" id="btGrid"></div></div>`;
    const g = $("#btGrid"), tracks = new Set(BT.edit.map(id => list.find(([, cp]) => cp.id === id)?.[0].id));
    for (const [c, cp] of list.slice(0, 240)) {
      const w = document.createElement("button"); w.type = "button"; w.className = "pf-gc pick bt-pk"; const k = BT.edit.indexOf(cp.id);
      if (k >= 0) { w.classList.add("on"); w.dataset.k = k + 1; }
      w.appendChild(cardEl(c, cp.holo)); const s = stats(c), bonus = c.tier * 3 + (cp.grade || 0) + (cp.holo ? 4 : 0);
      w.insertAdjacentHTML("beforeend", btBars({ flow: s.flow + bonus, endu: s.endu + bonus, hype: s.hype + bonus, pw: s.pw + bonus }));
      w.onclick = () => { const i = BT.edit.indexOf(cp.id);
        if (i >= 0) BT.edit.splice(i, 1);
        else if (tracks.has(c.id)) return toast("Ce morceau est déjà dans ton deck.");
        else if (BT.edit.length < 5) BT.edit.push(cp.id); else return toast("Le deck prend 5 cartes.");
        draw(); };
      g.appendChild(w);
    }
    const save = async ids => { try { await rpc("set_battle_deck", { p_cards: ids }); toast("Deck enregistré !"); BT.edit = null; renderBattle(); } catch (e) { toast(message(e)); } };
    $("#btSave").onclick = () => save(BT.edit); $("#btAuto").onclick = () => save([]); $("#btCancel").onclick = () => { BT.edit = null; box.innerHTML = ""; };
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
  BT.busy = false; BT.again = friend ? { friend } : {};
  btOpen(); btIntro();
}
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
  el.innerHTML = `<div class="bt-vs"><p class="bt-mode">${BT_MODE[b.mode]}</p><div class="bt-side bt-me">${btEmblem(b.me.league, 70)}<b>${esc(b.me.pseudo)}</b><small>${fmt(b.me.trophies)} 🏆</small></div>
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
  el.innerHTML = `<div class="bt-end ${won ? "w" : "l"}"><p class="bt-k">${BT_MODE[b.mode]} · ${b.a_won} – ${b.d_won} contre ${esc(b.opp.pseudo)}</p><h2>${won ? "Victoire !" : "Défaite"}</h2>
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
  clearInterval(BT.tick); BT.waiting = false;
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
