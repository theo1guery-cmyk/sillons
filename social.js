"use strict";
/* Zik Hunter — players: my friends (requests sent, received, accepted), find a player, the public profile of everyone
   (collection score and rank, stats, a showcase of 6 cards) and the whole collection of a friend. The server keeps
   the friendships and the scores; this file shows them. */
const SOC = { view: "list", data: null, prof: null, coll: null, cq: "", ct: -1, limit: 120, pick: null };
const socAvatar = (p, big) => { const a = p.cosmetics?.avatar, l = esc((p.pseudo || "?").slice(0, 1).toUpperCase());
  return `<span class="avatar${big ? " big" : ""}${a ? " av-" + esc(a) : ""}" aria-hidden="true">${a ? `<span>${l}</span><i></i><i></i><i></i><i></i>` : l}</span>`; };
const socName = p => `<b${p.cosmetics?.name ? ` class="${esc(p.cosmetics.name)}"` : ""}>${esc(p.pseudo)}</b>`;
const socSeen = p => p.online ? `<span class="soc-on">en ligne</span>` : p.seen_at ? `<span class="soc-off">vu ${ago(p.seen_at)}</span>` : "";
// a card of the server (card_json) as the collection shows it
const socCard = j => { const r = { ...j }, c = cardFromRow(r, (j.kind === "artist" ? j.artist : j.track) || {});
  return j.grade ? slabEl(c, j.holo, { grade: j.grade, cert: j.grade_cert, pop: j.grade_pop }) : cardEl(c, j.holo); };

function playersTab() {
  const t = $("#tab-players"); if (!t) return; t.hidden = !Online.active || !SOC.ready;   // shown once the server knows friends
  if (Online.active && me && !SOC.badged) { SOC.badged = true; rpc("my_friends").then(d => { SOC.ready = true; updatePlayersBadge(d.incoming.length); playersTab(); }).catch(() => { setTimeout(() => { SOC.badged = false; }, 60000); }); }
}
setInterval(playersTab, 3000);

async function renderPlayers() {
  if (!me) return;
  if (SOC.view === "profile" && SOC.prof) return drawProfile();
  const box = views.players;
  try { SOC.data = await rpc("my_friends"); } catch (e) { return toast(message(e)); }
  const d = SOC.data, row = (p, acts = "") => `<div class="soc-row" data-id="${p.id}">${socAvatar(p)}
      <span class="soc-who">${socName(p)}${p.title ? `<small>${esc(p.title)}</small>` : ""}${socSeen(p)}</span>
      <span class="soc-score"><b>${fmt(p.score || 0)}</b><small>points</small></span>${acts}</div>`;
  box.innerHTML = `<h2>Joueurs</h2>
    <p class="sub">Ajoute tes amis pour voir leur collection en entier. Le profil de chaque joueur montre son score de collection, son rang et sa vitrine.</p>
    <div class="soc-me">${socAvatar(me, true)}<div><p class="soc-k">Mon profil</p>${socName(me)}</div><button class="btn" id="socMine">Voir mon profil</button></div>
    <form class="search soc-find" id="socForm" role="search"><label class="sr" for="socQ">Pseudo</label><input id="socQ" type="search" placeholder="Chercher un joueur par son pseudo" autocomplete="off"></form>
    <div class="soc-list" id="socFound"></div>
    ${d.incoming.length ? `<h3>Demandes reçues <span class="soc-n">${d.incoming.length}</span></h3><div class="soc-list">${d.incoming.map(p => row(p, `<span class="soc-acts"><button class="btn primary" data-yes="${p.id}">Accepter</button><button class="btn" data-no="${p.id}">Refuser</button></span>`)).join("")}</div>` : ""}
    <h3>Mes amis <span class="soc-n">${d.friends.length}</span></h3>
    ${d.friends.length ? `<div class="soc-list">${d.friends.sort((a, b) => b.online - a.online || b.score - a.score).map(p => row(p)).join("")}</div>`
      : `<p class="empty-line">Pas encore d'amis : cherche un pseudo juste au-dessus et envoie une demande.</p>`}
    ${d.outgoing.length ? `<h3>Demandes envoyées</h3><div class="soc-list">${d.outgoing.map(p => row(p, `<span class="soc-acts"><button class="btn" data-undo="${p.id}">Annuler</button></span>`)).join("")}</div>` : ""}`;
  socWire(box);
  $("#socMine").onclick = () => openProfile(me.id);
  let t; $("#socQ").oninput = () => { clearTimeout(t); t = setTimeout(socFind, 300); };
  $("#socForm").onsubmit = e => { e.preventDefault(); socFind(); };
  updatePlayersBadge(d.incoming.length);
}
function socWire(box) {
  box.querySelectorAll(".soc-row").forEach(r => r.onclick = e => { if (!e.target.closest("button")) openProfile(r.dataset.id); });
  const act = (sel, fn, ok) => box.querySelectorAll(sel).forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { await fn(b); if (ok) toast(ok); renderPlayers(); } catch (e) { toast(message(e)); b.disabled = false; }
  });
  act("[data-yes]", b => rpc("friend_respond", { p_user: b.dataset.yes, p_accept: true }), "Vous êtes maintenant amis !");
  act("[data-no]", b => rpc("friend_respond", { p_user: b.dataset.no, p_accept: false }));
  act("[data-undo]", b => rpc("friend_remove", { p_user: b.dataset.undo }));
  act("[data-add]", b => rpc("friend_request", { p_user: b.dataset.add }), "Demande d'ami envoyée.");
}
async function socFind() {
  const q = $("#socQ").value.trim(), box = $("#socFound");
  if (q.length < 2) { box.innerHTML = ""; return; }
  let list = []; try { list = await rpc("find_players", { p_q: q }); } catch (e) { return toast(message(e)); }
  list = list.filter(p => p.id !== me.id);
  box.innerHTML = list.length ? list.map(p => `<div class="soc-row" data-id="${p.id}">${socAvatar(p)}<span class="soc-who">${socName(p)}${p.title ? `<small>${esc(p.title)}</small>` : ""}${socSeen(p)}</span>
      <span class="soc-score"><b>${fmt(p.score || 0)}</b><small>points</small></span>
      <span class="soc-acts">${p.friend === "friends" ? `<em>Ami</em>` : p.friend === "pending_out" ? `<em>Demande envoyée</em>` : p.friend === "pending_in" ? `<button class="btn primary" data-yes="${p.id}">Accepter</button>` : `<button class="btn" data-add="${p.id}">+ Ajouter</button>`}</span></div>`).join("")
    : `<p class="empty-line">Aucun joueur avec ce pseudo.</p>`;
  socWire(box);
}
function updatePlayersBadge(n) { const b = $("#playersBadge"); if (b) { b.hidden = !n; b.textContent = n || ""; } }

/* ---------------------------------------------------------------- a profile */
async function openProfile(id) {
  if (!me) return Online.askSignIn?.();
  SOC.view = "profile"; SOC.coll = null; SOC.cq = ""; SOC.ct = -1; SOC.limit = 120; SOC.pick = null;
  if (views.players.hidden) show("players");
  views.players.innerHTML = `<p class="empty-line">Chargement du profil…</p>`;
  try { SOC.prof = await rpc("player_profile", { p_user: id }); } catch (e) { SOC.view = "list"; toast(message(e)); return renderPlayers(); }
  drawProfile();
}
function drawProfile() {
  const p = SOC.prof, s = p.stats, mine = p.friend === "me", box = views.players;
  const since = new Date(p.created_at).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const tiers = s.tiers || [0, 0, 0, 0, 0, 0], tot = Math.max(1, tiers.reduce((a, b) => a + b, 0));
  const action = { me: "", friends: `<button class="btn" id="pfRemove">Amis ✓</button>`, pending_out: `<button class="btn" id="pfUndo">Demande envoyée · annuler</button>`,
    pending_in: `<button class="btn primary" id="pfAccept">Accepter sa demande</button>`, none: `<button class="btn primary" id="pfAdd">+ Ajouter en ami</button>` }[p.friend];
  const tile = (v, k, cls = "") => `<div class="pf-tile ${cls}"><b>${v}</b><small>${k}</small></div>`;
  box.innerHTML = `<button class="ps-link pf-back" id="pfBack">← Joueurs</button>
    <section class="pf-hero">
      <div class="pf-id">${socAvatar(p, true)}<div><h2>${socName(p)}</h2>${p.title ? `<p class="pf-title">${esc(p.title)}</p>` : ""}
        <p class="pf-meta">${socSeen(p)}<span>Joueur depuis ${since}</span><span>${p.friends} ami${p.friends > 1 ? "s" : ""}</span></p></div></div>
      <div class="pf-score"><small>Score de collection</small><b>${fmt(s.score)}</b><span>${p.rank <= 3 ? ["🥇", "🥈", "🥉"][p.rank - 1] + " " : ""}${p.rank}<sup>${p.rank === 1 ? "er" : "e"}</sup> sur ${fmt(p.players)} joueurs</span></div>
      <div class="pf-acts">${action}${mine && typeof wrOpen === "function" && wrOpen() ? `<button class="btn primary" id="pfWrapped">🎁 Mon Wrapped 2026</button>` : ""}${mine ? "" : `<button class="btn" id="pfTrade">Proposer un échange</button><button class="btn" id="pfDuel">⚔️ Lancer un clash</button>`}</div>
    </section>
    <div class="pf-tiles">${tile(fmt(s.distinct), "cartes différentes")}${tile(fmt(tiers[5]), "Légendaires", "r5")}${tile(fmt(tiers[4]), "Mythiques", "r4")}
      ${tile(fmt(s.shiny), "Shiny")}${tile(s.best_grade ? s.best_grade + "/10" : "—", "meilleure note")}${tile(fmt(s.limited), "éditions limitées", "ed")}
      ${tile(fmt(s.opened), "boosters ouverts")}${tile(s.duel_played ? fmt(s.duel_rating) : "—", s.duel_played ? `clash · ${s.duel_wins} V / ${s.duel_losses} D` : "clash")}</div>
    <div class="pf-bar" aria-label="Cartes différentes par rareté">${tiers.map((n, t) => n ? `<i style="flex:${Math.max(n / tot, .015)};background:${RCOL[t]}" title="${RAR[t]} : ${fmt(n)}"></i>` : "").join("")}</div>
    <div class="pf-legend">${tiers.map((n, t) => `<span><i style="background:${RCOL[t]}"></i>${RAR[t]} <b>${fmt(n)}</b></span>`).join("")}</div>
    <section class="pf-show"><h3>Vitrine${mine ? ` <button class="ps-link" id="pfEdit">✎ Choisir mes 6 cartes</button>` : ""}</h3>
      ${!p.chosen ? `<p class="sub">${mine ? "Tes 6 meilleures cartes, choisies automatiquement. Tu peux choisir celles que tout le monde verra." : "Ses 6 meilleures cartes."}</p>` : ""}
      <div class="pf-cards" id="pfCards"></div><div id="pfPick"></div></section>
    <section class="pf-coll"><h3>Collection</h3><div id="pfColl">${mine || p.friend === "friends"
      ? `<button class="btn" id="pfOpen">Voir ${mine ? "ma" : "sa"} collection (${fmt(s.total)} cartes)</button>`
      : `<p class="empty-line">🔒 Deviens ami avec ${esc(p.pseudo)} pour voir toute sa collection.</p>`}</div></section>`;
  const cards = $("#pfCards");
  if (!p.showcase.length) cards.innerHTML = `<p class="empty-line">Pas encore de carte.</p>`;
  for (const j of p.showcase) { const w = document.createElement("div"); w.className = "pf-card"; w.appendChild(socCard(j)); cards.appendChild(w); }
  $("#pfBack").onclick = () => { SOC.view = "list"; SOC.prof = null; renderPlayers(); };
  const go = (sel, fn, ok) => { const b = box.querySelector(sel); if (b) b.onclick = async () => { b.disabled = true; try { await fn(); if (ok) toast(ok); openProfile(p.id); } catch (e) { toast(message(e)); b.disabled = false; } }; };
  go("#pfAdd", () => rpc("friend_request", { p_user: p.id }), "Demande d'ami envoyée.");
  go("#pfAccept", () => rpc("friend_respond", { p_user: p.id, p_accept: true }), "Vous êtes maintenant amis !");
  go("#pfUndo", () => rpc("friend_remove", { p_user: p.id }));
  const rm = $("#pfRemove"); if (rm) rm.onclick = async () => { if (!confirm(`Retirer ${p.pseudo} de tes amis ?`)) return; try { await rpc("friend_remove", { p_user: p.id }); openProfile(p.id); } catch (e) { toast(message(e)); } };
  const tr = $("#pfTrade"); if (tr) tr.onclick = () => { show("trades"); openEditor({ id: p.id, pseudo: p.pseudo, title: p.title, cosmetics: p.cosmetics }); };
  const du = $("#pfDuel"); if (du) du.onclick = () => { show("duels"); setTimeout(() => { $("#duelChallenge")?.onclick?.(); CH.player = { id: p.id, pseudo: p.pseudo, title: p.title }; CH.theirs = null; drawChallengeSetup(); }, 300); };
  const wr = $("#pfWrapped"); if (wr) wr.onclick = () => wrappedOpen();
  const op = $("#pfOpen"); if (op) op.onclick = () => socCollection();
  const ed = $("#pfEdit"); if (ed) ed.onclick = () => socPick();
}

// the whole collection (a friend's, or mine): rarity chips, a search, the best first
async function socCollection() {
  const p = SOC.prof, box = $("#pfColl");
  if (!SOC.coll) {
    box.innerHTML = `<p class="empty-line">Chargement de la collection…</p>`;
    try { SOC.coll = p.id === me.id ? S.c : await fetchCards(p.id, false); } catch (e) { box.innerHTML = ""; return toast(message(e)); }
  }
  const all = Object.values(SOC.coll), q = SOC.cq.toLowerCase();
  const list = all.filter(c => (SOC.ct < 0 || c.tier === SOC.ct) && (!q || (c.t + " " + c.a).toLowerCase().includes(q)))
    .sort((a, b) => (!!b.ed - !!a.ed) || b.tier - a.tier || b.rank - a.rank);
  box.innerHTML = `<div class="pf-filt"><input type="search" id="pfQ" placeholder="Titre ou artiste" value="${esc(SOC.cq)}" aria-label="Chercher dans la collection">
      <div class="pf-chips"><button data-t="-1" aria-pressed="${SOC.ct < 0}">Toutes</button>${RAR.map((r, t) => `<button data-t="${t}" aria-pressed="${SOC.ct === t}" style="--c:${RCOL[t]}">${r}</button>`).join("")}</div></div>
    <p class="pf-count">${fmt(list.length)} carte${list.length > 1 ? "s" : ""} différente${list.length > 1 ? "s" : ""}</p><div class="pf-grid" id="pfGrid"></div>
    ${list.length > SOC.limit ? `<button class="btn pf-more" id="pfMore">Afficher plus</button>` : ""}`;
  const grid = $("#pfGrid");
  for (const c of list.slice(0, SOC.limit)) {
    const w = document.createElement("div"); w.className = "pf-gc";
    const g = c.copies.find(cp => cp.grade);
    w.appendChild(g ? slabEl(c, g.holo, { grade: g.grade, cert: g.cert, pop: g.pop }) : cardEl(c, c.holo > 0));
    if (c.n > 1) w.insertAdjacentHTML("beforeend", `<span class="pf-n">×${c.n}</span>`);
    grid.appendChild(w);
  }
  let t; $("#pfQ").oninput = e => { clearTimeout(t); t = setTimeout(() => { SOC.cq = e.target.value; SOC.limit = 120; socCollection(); $("#pfQ").focus(); }, 250); };
  box.querySelectorAll("[data-t]").forEach(b => b.onclick = () => { SOC.ct = +b.dataset.t; SOC.limit = 120; socCollection(); });
  const more = $("#pfMore"); if (more) more.onclick = () => { SOC.limit += 240; socCollection(); };
}

// my showcase: pick up to 6 of my cards (one copy each), in the order picked
function socPick() {
  const box = $("#pfPick"), copies = [];
  for (const c of Object.values(S.c)) { const cp = c.copies.find(x => x.grade) || c.copies.find(x => x.holo) || c.copies[0]; if (cp) copies.push([c, cp]); }
  copies.sort((a, b) => (!!b[0].ed - !!a[0].ed) || b[0].tier - a[0].tier || (b[1].grade || 0) - (a[1].grade || 0) || b[0].rank - a[0].rank);
  SOC.pick ??= SOC.prof.chosen ? SOC.prof.showcase.map(j => j.id) : [];
  const draw = () => {
    box.innerHTML = `<div class="pf-picker"><p>Touche jusqu'à 6 cartes, dans l'ordre où tu veux les montrer. <b>${SOC.pick.length} / 6</b></p>
      <div class="pf-pacts"><button class="btn" id="pfPAuto">Mes 6 meilleures, automatiquement</button><button class="btn" id="pfPCancel">Annuler</button><button class="btn primary" id="pfPSave">Enregistrer ma vitrine</button></div>
      <div class="pf-grid" id="pfPGrid"></div></div>`;
    const g = $("#pfPGrid");
    for (const [c, cp] of copies.slice(0, 300)) {
      const w = document.createElement("button"); w.type = "button"; w.className = "pf-gc pick"; const k = SOC.pick.indexOf(cp.id);
      if (k >= 0) { w.classList.add("on"); w.dataset.k = k + 1; }
      w.appendChild(cp.grade ? slabEl(c, cp.holo, { grade: cp.grade, cert: cp.cert, pop: cp.pop }) : cardEl(c, cp.holo));
      w.onclick = () => { const i = SOC.pick.indexOf(cp.id); if (i >= 0) SOC.pick.splice(i, 1); else if (SOC.pick.length < 6) SOC.pick.push(cp.id); else return toast("La vitrine prend 6 cartes."); draw(); };
      g.appendChild(w);
    }
    const save = async ids => { try { await rpc("set_showcase", { p_cards: ids }); toast("Vitrine enregistrée !"); openProfile(me.id); } catch (e) { toast(message(e)); } };
    $("#pfPSave").onclick = () => save(SOC.pick);
    $("#pfPAuto").onclick = () => save([]);
    $("#pfPCancel").onclick = () => { SOC.pick = null; box.innerHTML = ""; };
  };
  draw();
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}
window.openProfile = openProfile;
Object.assign(Online, { renderPlayers: () => renderPlayers(), openProfile, updatePlayersBadge });
