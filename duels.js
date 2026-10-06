"use strict";
/* Zik Hunter — blind-test duels (with an account). The server picks the rounds, keeps the right answer,
   times every answer and counts the points; this file only plays the extract and shows the choices. */

const DUEL = { deck: [], artist: null, auto: false, editing: false, pick: new Set(), pickArtist: null, q: "", duels: [] };

// what a card does in a duel (same formulas as the server)
function duelEffects(c) {
  const st = stats(c);
  return {
    extract: Math.round((20000 - st.flow / 99 * 12000) / 100) / 10,   // seconds
    shield: Math.round(st.endu / 2),                                 // % fewer points for the opponent
    diff: Math.round((2 - st.hype / 100) * 100) / 100,               // points multiplier for whoever finds it
    dmg: st.pw * 5,                                                   // points if the opponent fails
  };
}
const effectLine = c => { const e = duelEffects(c); return `Extrait ${String(e.extract).replace(".", ",")} s · Bouclier −${e.shield} % · Difficulté ×${String(e.diff).replace(".", ",")} · Dégâts ${e.dmg}`; };
const ARTIST_BONUS = t => `+${5 * (t + 1)} % sur tous tes points, +50 % sur ses morceaux`;
const copyToCard = id => Object.values(S.c).find(c => c.copies?.some(cp => cp.id === id));

Object.assign(Online, {
  renderDuels: () => renderDuels(),
  updateDuelsBadge: () => updateDuelsBadge(),
});

/* ---------- the duels tab ---------- */
async function renderDuels() {
  if (!me) return;
  try {
    const [deck, duels, board] = await Promise.all([rpc("my_deck"), rpc("my_duels"), rpc("duel_leaderboard")]);
    DUEL.auto = !deck.cards?.length;
    DUEL.deck = (deck.cards?.length ? deck.cards : deck.auto || []).filter(Boolean);
    DUEL.artist = deck.artist_card;
    DUEL.duels = duels;
    drawDeck(); drawDuelLists(); drawBoard(board); updateDuelsBadge();
  } catch (e) { toast(message(e)); }
}
function updateDuelsBadge() {
  const n = DUEL.duels.filter(d => d.me === "b" && d.status === "waiting_b").length;
  $("#duelsBadge").hidden = !n; $("#duelsBadge").textContent = n || "";
}

function drawDeck() {
  const box = $("#duelDeck");
  if (DUEL.editing) return drawDeckEditor();
  const cards = DUEL.deck.map(copyToCard).filter(Boolean);
  const artist = DUEL.artist ? copyToCard(DUEL.artist) : null;
  box.innerHTML = `<p class="cat-status">${DUEL.auto ? "Deck automatique : tes 5 cartes les plus rares. Compose ton propre deck pour choisir tes armes de clash." : "Tes 5 armes, plus ta carte d'artiste en bonus."}</p>
    <div class="deck-row"></div>
    <div class="btns"><button class="btn" id="deckEdit">Modifier mon deck</button></div>`;
  const row = box.querySelector(".deck-row");
  for (const c of cards) {
    const el = document.createElement("div"); el.className = "deck-slot";
    el.appendChild(miniCard(c, false));
    const e = duelEffects(c);
    el.insertAdjacentHTML("beforeend", `<ul class="fx-list"><li><span>Extrait</span><b>${String(e.extract).replace(".", ",")} s</b></li><li><span>Bouclier</span><b>−${e.shield} %</b></li><li><span>Difficulté</span><b>×${String(e.diff).replace(".", ",")}</b></li><li><span>Dégâts</span><b>${e.dmg}</b></li></ul>`);
    el.querySelector(".mini").onclick = () => openModal(c);
    row.appendChild(el);
  }
  const slot = document.createElement("div"); slot.className = "deck-slot artist-slot";
  if (artist) { slot.appendChild(miniCard(artist, false)); slot.insertAdjacentHTML("beforeend", `<ul class="fx-list"><li class="wide">${ARTIST_BONUS(artist.tier)}</li></ul>`); }
  else slot.innerHTML = `<div class="empty-slot">Carte d'artiste<br><small>bonus optionnel</small></div>`;
  row.appendChild(slot);
  $("#deckEdit").onclick = () => {
    DUEL.editing = true; DUEL.pick = new Set(DUEL.deck); DUEL.pickArtist = DUEL.artist; DUEL.q = ""; drawDeck();
  };
}

function drawDeckEditor() {
  const box = $("#duelDeck");
  const tracks = Object.values(S.c).filter(c => !isArtist(c) && c.copies?.length);
  const artists = Object.values(S.c).filter(c => isArtist(c) && c.copies?.length);
  const q = DUEL.q.toLowerCase();
  const list = tracks.filter(c => !q || (c.t + " " + c.a).toLowerCase().includes(q))
    .sort((a, b) => duelEffects(a).diff - duelEffects(b).diff < 0 ? 1 : -1).slice(0, 120);
  box.innerHTML = `<div class="deck-editor">
      <p class="cat-status">Choisis 5 morceaux (${DUEL.pick.size}/5). Astuce : un morceau peu écouté et rapide est très dur à reconnaître.</p>
      <input class="mini-search" id="deckQ" type="search" placeholder="Chercher dans ta collection" value="${esc(DUEL.q)}" aria-label="Chercher dans ta collection">
      <div class="pick-grid" id="deckPick"></div>
      ${artists.length ? `<p class="cat-status">Carte d'artiste en bonus (optionnelle)</p><div class="pick-grid small" id="deckArtists"></div>` : ""}
      <div class="btns"><button class="btn" id="deckCancel">Annuler</button><button class="btn primary" id="deckSave" ${DUEL.pick.size === 5 ? "" : "disabled"}>Enregistrer le deck</button></div>
    </div>`;
  const grid = $("#deckPick");
  for (const c of list) {
    const cp = c.copies[0].id, on = c.copies.some(x => DUEL.pick.has(x.id));
    const b = document.createElement("button"); b.className = "pick" + (on ? " on" : "");
    b.setAttribute("aria-pressed", on); b.setAttribute("aria-label", `${c.t}, ${effectLine(c)}`);
    b.title = effectLine(c);
    b.appendChild(miniCard(c, false));
    b.onclick = () => {
      const chosen = c.copies.find(x => DUEL.pick.has(x.id));
      if (chosen) DUEL.pick.delete(chosen.id);
      else if (DUEL.pick.size < 5) DUEL.pick.add(cp);
      else return toast("5 cartes maximum : retires-en une d'abord.");
      drawDeckEditor();
    };
    grid.appendChild(b);
  }
  const ag = $("#deckArtists");
  if (ag) for (const c of artists) {
    const cp = c.copies[0].id, on = c.copies.some(x => x.id === DUEL.pickArtist);
    const b = document.createElement("button"); b.className = "pick" + (on ? " on" : "");
    b.setAttribute("aria-pressed", on); b.title = ARTIST_BONUS(c.tier);
    b.appendChild(miniCard(c, false));
    b.onclick = () => { DUEL.pickArtist = on ? null : cp; drawDeckEditor(); };
    ag.appendChild(b);
  }
  const qi = $("#deckQ");
  qi.oninput = () => { clearTimeout(qi._t); qi._t = setTimeout(() => { DUEL.q = qi.value; drawDeckEditor(); const n = $("#deckQ"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  $("#deckCancel").onclick = () => { DUEL.editing = false; drawDeck(); };
  $("#deckSave").onclick = async () => {
    try {
      await rpc("set_deck", { p_cards: [...DUEL.pick], p_artist: DUEL.pickArtist });
      DUEL.deck = [...DUEL.pick]; DUEL.artist = DUEL.pickArtist; DUEL.auto = false; DUEL.editing = false;
      toast("Deck enregistré."); drawDeck();
    } catch (e) { toast(message(e)); }
  };
}

function drawDuelLists() {
  const incoming = DUEL.duels.filter(d => d.me === "b" && d.status === "waiting_b");
  const waiting = DUEL.duels.filter(d => d.me === "a" && d.status === "waiting_b");
  const done = DUEL.duels.filter(d => ["done", "declined", "expired"].includes(d.status)).slice(0, 15);
  const betTxt = (d, mineFirst) => d.bet ? `<p class="bet">🎲 Pari : ${mineFirst ? "ta carte" : "sa carte"} « ${esc((mineFirst ? d.bet_mine : d.bet_theirs)?.title || "?")} » contre ${mineFirst ? "sa carte" : "ta carte"} « ${esc((mineFirst ? d.bet_theirs : d.bet_mine)?.title || "?")} »</p>` : "";
  const inBox = $("#duelsIn"); inBox.innerHTML = incoming.length ? "" : `<p class="empty-line">Aucun clash reçu pour l'instant.</p>`;
  for (const d of incoming) {
    const el = document.createElement("article"); el.className = "duel-card incoming";
    el.innerHTML = `<header><b>⚔️ ${esc(d.other)}${d.other_title ? ` <small>${esc(d.other_title)}</small>` : ""} te lance un clash</b><span>${new Date(d.created_at).toLocaleDateString("fr-FR")}</span></header>
      ${d.bet ? `<p class="bet">🎲 Il mise sa carte « ${esc(d.bet_theirs?.title || "?")} » contre ta carte « ${esc(d.bet_mine?.title || "?")} ». Le perdant donne sa carte au gagnant.</p>
        <label class="bet-accept"><input type="checkbox" id="bet-${d.id}"> J'accepte le pari (sinon, on joue sans pari)</label>` : ""}
      <div class="btns"><button class="btn primary">Jouer mes 6 manches</button><button class="btn">Refuser</button></div>`;
    const [play, no] = el.querySelectorAll(".btn");
    play.onclick = async () => {
      play.disabled = true;
      try { await rpc("accept_duel", { p_duel: d.id, p_accept_bet: !!el.querySelector(`#bet-${d.id}`)?.checked }); startPlay(d.id, "duel", d.other); }
      catch (e) { toast(message(e)); play.disabled = false; }
    };
    no.onclick = async () => { try { await rpc("decline_duel", { p_duel: d.id }); toast("Défi refusé."); renderDuels(); } catch (e) { toast(message(e)); } };
    inBox.appendChild(el);
  }
  const wBox = $("#duelsWait"); wBox.innerHTML = waiting.length ? "" : `<p class="empty-line">Aucun clash en attente.</p>`;
  for (const d of waiting) {
    const el = document.createElement("article"); el.className = "duel-card";
    el.innerHTML = `<header><b>Contre ${esc(d.other)}</b><span>ton score : ${fmt(d.score_me ?? 0)} ?</span></header>${betTxt(d, true)}<p class="empty-line">${esc(d.other)} n'a pas encore joué. Le clash expire au bout de 3 jours.</p>`;
    el.querySelector("header span").textContent = "en attente";
    wBox.appendChild(el);
  }
  const dBox = $("#duelsDone"); dBox.innerHTML = done.length ? "" : `<p class="empty-line">Pas encore de clash terminé.</p>`;
  for (const d of done) {
    const res = d.status === "declined" ? "Refusé" : d.status === "expired" ? "Expiré" : d.draw ? "Égalité" : d.won ? "Victoire" : "Défaite";
    const el = document.createElement("article"); el.className = "duel-card done " + (d.won ? "won" : d.status === "done" && !d.draw ? "lost" : "");
    el.innerHTML = `<header><b>${res} contre ${esc(d.other)}</b><span>${d.status === "done" ? `${fmt(d.score_me)} – ${fmt(d.score_other)}` : ""}</span></header>
      ${d.bet && d.bet_accepted && d.bet_moved ? `<p class="bet">${d.won ? `🎲 Tu gagnes « ${esc(d.bet_theirs?.title || "?")} » !` : `🎲 Tu perds « ${esc(d.bet_mine?.title || "?")} ».`}</p>` : ""}`;
    dBox.appendChild(el);
  }
}

function drawBoard(board) {
  const box = $("#duelBoard");
  if (!board.length) { box.innerHTML = `<p class="empty-line">Personne n'a encore lancé de clash. Sois le premier !</p>`; return; }
  box.innerHTML = `<ol class="board">${board.map((p, i) => `<li class="${p.me ? "me" : ""}"><span class="rk">${i + 1}</span><b>${esc(p.pseudo)}</b>${p.title ? `<small>${esc(p.title)}</small>` : ""}<span class="rt">${p.rating}</span><span class="wl">${p.wins} V · ${p.losses} D</span></li>`).join("")}</ol>`;
}

/* ---------- challenge a friend (with an optional bet) ---------- */
const CH = { player: null, theirs: null, mine: null, take: null, bet: false };
$("#duelChallenge").onclick = () => {
  const box = $("#duelNew"); box.hidden = false; CH.player = null; CH.bet = false; CH.mine = CH.take = null;
  box.innerHTML = `<div class="trade-new"><h3>Lancer un clash</h3>
    <form class="search" id="chForm" role="search"><label class="sr" for="chQ">Pseudo</label><input id="chQ" type="search" placeholder="Pseudo de ton ami" autocomplete="off"></form>
    <div class="players" id="chPlayers"></div><div id="chSetup"></div></div>`;
  let t;
  $("#chQ").oninput = () => { clearTimeout(t); t = setTimeout(findChallengers, 300); };
  $("#chForm").onsubmit = e => { e.preventDefault(); findChallengers(); };
  $("#chQ").focus();
};
async function findChallengers() {
  const q = $("#chQ").value.trim(), box = $("#chPlayers");
  if (q.length < 2) { box.innerHTML = ""; return; }
  const { data } = await sb.from("profiles").select("id,pseudo,title").ilike("pseudo", q.replace(/[%_]/g, "") + "%").neq("id", me.id).limit(8);
  box.innerHTML = (data || []).length ? "" : `<p class="empty-line">Aucun joueur avec ce pseudo.</p>`;
  for (const p of data || []) {
    const b = document.createElement("button"); b.className = "chip player"; b.textContent = p.pseudo + (p.title ? " · " + p.title : "");
    b.onclick = () => { CH.player = p; CH.theirs = null; drawChallengeSetup(); };
    box.appendChild(b);
  }
}
async function drawChallengeSetup() {
  const box = $("#chSetup"), p = CH.player;
  box.innerHTML = `<p class="cat-status">Contre <b>${esc(p.pseudo)}</b>. Tu joues tes 6 manches tout de suite, ${esc(p.pseudo)} jouera les mêmes quand il voudra.</p>
    <label class="bet-accept"><input type="checkbox" id="chBet" ${CH.bet ? "checked" : ""}> 🎲 Parier une carte : le perdant donne sa carte au gagnant (${esc(p.pseudo)} devra accepter)</label>
    <div id="chBetPick"></div>
    <div class="btns"><button class="btn" id="chCancel">Annuler</button><button class="btn primary" id="chGo">Lancer le clash</button></div>`;
  $("#chCancel").onclick = () => { $("#duelNew").hidden = true; };
  $("#chBet").onchange = e => { CH.bet = e.target.checked; drawChallengeSetup(); };
  if (CH.bet) {
    if (!CH.theirs) { $("#chBetPick").innerHTML = `<p class="empty-line">Chargement de sa collection…</p>`; CH.theirs = await fetchCards(p.id, true); }
    const pickOne = (map, current, label, onPick) => {
      const wrap = document.createElement("div");
      wrap.innerHTML = `<p class="cat-status">${label}</p>`;
      const g = document.createElement("div"); g.className = "pick-grid small";
      for (const c of Object.values(map).filter(c => c.copies?.some(x => x.tradeable)).sort((a, b) => b.tier - a.tier || b.rank - a.rank).slice(0, 60)) {
        const cp = c.copies.find(x => x.tradeable).id, on = current === cp;
        const b = document.createElement("button"); b.className = "pick" + (on ? " on" : ""); b.setAttribute("aria-pressed", on);
        b.appendChild(miniCard(c, false)); b.onclick = () => { onPick(on ? null : cp); drawChallengeSetup(); };
        g.appendChild(b);
      }
      wrap.appendChild(g); return wrap;
    };
    const bp = $("#chBetPick"); bp.innerHTML = "";
    bp.appendChild(pickOne(S.c, CH.mine, "Ta carte en jeu", id => CH.mine = id));
    bp.appendChild(pickOne(CH.theirs, CH.take, `La carte de ${esc(p.pseudo)} que tu veux gagner`, id => CH.take = id));
  }
  $("#chGo").onclick = async () => {
    if (CH.bet && (!CH.mine || !CH.take)) return toast("Choisis ta carte et la sienne pour le pari.");
    $("#chGo").disabled = true;
    try {
      const id = await rpc("create_duel", { p_opponent: p.id, p_bet_mine: CH.bet ? CH.mine : null, p_bet_theirs: CH.bet ? CH.take : null });
      $("#duelNew").hidden = true;
      startPlay(id, "duel", p.pseudo);
    } catch (e) { toast(message(e)); $("#chGo").disabled = false; }
  };
}

$("#duelTrain").onclick = async () => {
  try { const id = await rpc("start_training"); startPlay(id, "training", null); }
  catch (e) { toast(message(e)); }
};

/* ---------- playing: extract, 4 choices, the server's verdict ---------- */
const P = { id: null, kind: null, other: null, total: 6, round: null, timer: null, audio: new Audio(), score: 0, answered: false };
const dp = $("#duelPlay");
function startPlay(id, kind, other) {
  Object.assign(P, { id, kind, other, score: 0, round: null });
  dp.hidden = false;
  $("#dpBody").innerHTML = `<h3 id="dpTitle">${kind === "training" ? "Entraînement blind test" : "Clash contre " + esc(other)}</h3>
    <p class="sub">${kind === "training" ? "Des morceaux de ta collection. Réponds vite : plus tu es rapide, plus tu marques." : "Reconnais chaque morceau parmi 4 réponses. Plus tu es rapide, plus tu marques. Le chrono tourne dès que la manche démarre."}</p>
    <div class="btns"><button class="btn primary big" id="dpStart">Lancer la manche 1</button></div>`;
  $("#dpStart").onclick = nextRound;
}
function stopAudio() { P.audio.pause(); clearInterval(P.timer); }
async function nextRound() {
  stopAudio();
  const body = $("#dpBody");
  body.innerHTML = `<p class="empty-line">Chargement de l'extrait…</p>`;
  let r;
  try { r = await rpc("duel_round", { p_duel: P.id }); }
  catch (e) { if (String(e.message).includes("duel_over")) return finishPlay(); body.innerHTML = `<p class="err">${message(e)}</p>${closeBtn()}`; bindClose(); return; }
  P.round = r; P.total = r.total; P.answered = false;
  body.innerHTML = `<div class="dp-head"><b>Manche ${r.n} / ${r.total}</b><span class="dp-side">${r.mine === null ? "Ta collection" : r.mine ? "Un morceau de ton deck" : "Un morceau du deck adverse"}</span><span class="dp-score">${fmt(P.score)} pts</span></div>
    <div class="dp-bar"><s id="dpBar"></s></div><p class="dp-time" id="dpTime"></p>
    <div class="dp-choices">${r.choices.map((c, i) => `<button class="dp-choice" data-i="${i}">${esc(c)}</button>`).join("")}</div>
    <div id="dpResult"></div>`;
  body.querySelectorAll(".dp-choice").forEach(b => b.onclick = () => answer(+b.dataset.i));
  // the extract stops when its time is up; the server's clock started when this round was served
  const started = performance.now() - (r.elapsed_ms || 0);
  if (r.preview) { window.dispatchEvent(new Event("zh:sound")); P.audio.src = r.preview; P.audio.currentTime = 0; P.audio.play().catch(() => toast("Clique sur la page pour autoriser le son.")); }
  else toast("Pas d'extrait pour ce morceau : réponds à l'aveugle !");
  P.timer = setInterval(() => {
    const left = Math.max(0, r.extract_ms - (performance.now() - started));
    $("#dpBar").style.width = (left / r.extract_ms * 100) + "%";
    $("#dpTime").textContent = left > 0 ? `${Math.ceil(left / 1000)} s` : "Temps écoulé…";
    if (left <= 0) P.audio.pause();
    if (performance.now() - started > r.extract_ms + 2500 && !P.answered) answer(-1);   // out of time
  }, 100);
}
async function answer(i) {
  if (P.answered) return;
  P.answered = true; stopAudio();
  const body = $("#dpBody");
  body.querySelectorAll(".dp-choice").forEach(b => b.disabled = true);
  let res;
  try { res = await rpc("duel_answer", { p_duel: P.id, p_choice: i }); }
  catch (e) { toast(message(e)); return; }
  P.score += res.points;
  body.querySelectorAll(".dp-choice").forEach((b, k) => { if (k === res.correct_index) b.classList.add("right"); else if (k === i) b.classList.add("wrong"); });
  $(".dp-score").textContent = `${fmt(P.score)} pts`;
  const c = res.card;
  const card = { id: c.track_id, t: c.title, a: c.artist, al: c.album, cov: c.cover, d: c.duration, rank: c.rank, bpm: c.bpm, y: c.year, x: c.explicit ? 1 : 0, g: c.genre, tier: c.tier };
  const msg = res.correct ? `✅ Bien vu en ${String(Math.round(res.ms / 100) / 10).replace(".", ",")} s : <b>+${fmt(res.points)}</b>`
    : i < 0 ? `⏱ Temps écoulé.` : `❌ Raté.`;
  const hit = !res.correct && res.mine === false ? `<br><small>💥 Sa carte te touche : +${fmt(res.damage)} pour ${esc(P.other || "ton adversaire")}.</small>` : "";
  $("#dpResult").innerHTML = `<div class="dp-reveal"><div class="dp-card"></div><div><p class="dp-msg">${msg}${hit}</p>
    <p class="cat-status">${res.mine === null ? "" : res.mine ? "Une carte de ton deck" : "Une carte du deck adverse"} · Extrait ${String(Math.round(c.extract_ms / 100) / 10).replace(".", ",")} s · Bouclier −${Math.round(c.endu / 2)} % · Dégâts ${c.pw * 5}</p>
    <div class="btns"><button class="btn primary" id="dpNext">${res.last ? "Voir le résultat" : "Manche suivante"}</button></div></div></div>`;
  $(".dp-card").appendChild(miniCard(card, false));
  $("#dpNext").onclick = () => res.last ? finishPlay() : nextRound();
  $("#dpNext").focus();
}
async function finishPlay() {
  stopAudio();
  const body = $("#dpBody");
  await loadProfile(); renderCounters();
  if (P.kind === "training") {
    body.innerHTML = `<h3>Entraînement terminé</h3><p class="dp-big">${fmt(P.score)} points</p>
      <p class="sub">Tu gagnes des Streams selon ton score (5 entraînements récompensés par jour).</p>${closeBtn()}`;
  } else {
    const duels = await rpc("my_duels").catch(() => []);
    const d = duels.find(x => x.id === P.id);
    if (!d || d.status !== "done") {
      body.innerHTML = `<h3>Tes 6 manches sont jouées</h3><p class="dp-big">${fmt(P.score)} points</p>
        <p class="sub">C'est au tour de ${esc(P.other || "ton adversaire")}. Ses cartes qui t'ont touché lui ajouteront des points. Tu seras prévenu du résultat.</p>${closeBtn()}`;
    } else {
      const res = d.draw ? "Égalité !" : d.won ? "Victoire !" : "Défaite";
      body.innerHTML = `<h3>${res}</h3><p class="dp-big">${fmt(d.score_me)} – ${fmt(d.score_other)}</p>
        <p class="sub">${d.won ? "+50 Streams" : d.draw ? "+25 Streams" : "+10 Streams"} (10 clashs récompensés par jour).${d.bet && d.bet_accepted ? (d.won ? ` 🎲 Tu gagnes « ${esc(d.bet_theirs?.title || "?")} » !` : d.draw ? " 🎲 Égalité : chacun garde sa carte." : ` 🎲 Tu perds « ${esc(d.bet_mine?.title || "?")} ».`) : ""}</p>${closeBtn()}`;
      if (d.bet && d.bet_moved) await loadAll();
    }
  }
  bindClose();
  updateDefisBadge?.();
}
const closeBtn = () => `<div class="btns"><button class="btn primary" id="dpClose">Fermer</button></div>`;
function bindClose() { const b = $("#dpClose"); if (b) { b.onclick = () => { dp.hidden = true; stopAudio(); renderDuels(); }; b.focus(); } }
addEventListener("keydown", e => { if (e.key === "Escape" && !dp.hidden && $("#dpClose")) { dp.hidden = true; stopAudio(); renderDuels(); } });
