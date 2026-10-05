"use strict";
/* Sillons TCG — accounts, server-checked boosters and trades (Supabase).
   Without an account the game keeps working as before, in this browser only. */

const SUPABASE_URL = "https://gvqlxsofrkqnniuhiiyf.supabase.co";
const SUPABASE_KEY = "sb_publishable_46l4-zXXY1WswsqKMUm_QQ_x68Zt52G";   // publishable key: meant to be public
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const backHere = () => location.origin + location.pathname;

const MESSAGES = {
  not_signed_in: "Connecte-toi pour faire ça.",
  no_stock: "Plus de booster pour l'instant. Le prochain arrive bientôt.",
  too_many_open_packs: "Trop de boosters en cours d'ouverture. Attends quelques secondes.",
  pack_not_found: "Ce booster a expiré. Ouvre-en un autre.",
  need_five_tracks: "Le booster n'a pas pu être rempli. Réessaie.",
  account_too_new: "Ton compte doit avoir 48 h avant de pouvoir échanger.",
  target_too_new: "Le compte de ce joueur a moins de 48 h : il ne peut pas encore échanger.",
  give_not_owned: "Une des cartes que tu proposes n'est plus dans ta collection, ou ne s'échange pas.",
  take_not_owned: "Une des cartes demandées n'est plus chez ce joueur.",
  too_many_offers: "Tu as déjà 20 offres en attente. Attends des réponses ou annules-en.",
  one_to_five_cards: "Choisis de 1 à 5 cartes de chaque côté.",
  offer_closed: "Cette offre n'est plus en attente.",
  offer_not_found: "Cette offre n'existe plus.",
  player_not_found: "Ce joueur n'existe pas.",
  self_trade: "Tu ne peux pas échanger avec toi-même.",
  already_imported: "Ta collection a déjà été importée.",
  already_claimed: "Déjà récupéré.",
  not_done: "Pas encore terminé.",
  not_today: "Ce défi n'est plus disponible aujourd'hui.",
  keep_one: "Tu dois garder au moins un exemplaire de chaque carte.",
  title_not_earned: "Tu n'as pas encore gagné ce titre.",
  not_enough_streams: "Pas assez de Streams.",
  card_listed: "Cette carte est en vente au marché. Retire-la de la vente d'abord.",
  card_in_offer: "Cette carte fait partie d'une offre d'échange en attente.",
  card_not_owned: "Cette carte n'est plus dans ta collection.",
  price_too_low: "Prix trop bas : au minimum ce que la banque en donne.",
  price_too_high: "Prix trop élevé (10 millions de Streams maximum).",
  too_many_listings: "Tu as déjà 50 cartes en vente.",
  listing_not_found: "Cette annonce n'existe plus.",
  listing_closed: "Cette carte n'est plus en vente.",
  own_listing: "C'est ta propre annonce.",
};
function message(e) {
  const raw = (e && (e.message || e.code)) || "";
  for (const k in MESSAGES) if (raw.includes(k)) return MESSAGES[k];
  if (/network|fetch/i.test(raw)) return "Connexion impossible. Vérifie ton réseau puis réessaie.";
  return "Une erreur est survenue. Réessaie.";
}
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw error;
  return data;
}

/* ---------- account state ---------- */
let me = null;                // { id, email, pseudo, created_at, imported, ... }
let guestS = S;               // the browser collection, kept aside while signed in

// one database card row (with its track) → the card shape the game draws
function cardFromRow(r, t) {
  return {
    id: r.track_id, t: t.title, a: t.artist, al: t.album, cov: t.cover, d: t.duration, rank: r.rank,
    bpm: t.bpm, y: t.year, x: t.explicit ? 1 : 0, g: t.genre, tier: r.tier,
  };
}
// the collection groups copies by track; each copy keeps its own id for trades
function addCopy(map, r, t) {
  const c = map[r.track_id] || (map[r.track_id] = { ...cardFromRow(r, t), n: 0, holo: 0, locked: 0, copies: [], at: Date.parse(r.pulled_at) });
  c.n++; if (r.holo) c.holo++; if (!r.tradeable) c.locked++;
  if (r.tier > c.tier) { c.tier = r.tier; c.rank = r.rank; }
  c.copies.push({ id: r.id, tier: r.tier, holo: r.holo, tradeable: r.tradeable });
  return c;
}
async function fetchCards(owner, onlyTradeable) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from("cards").select("id,track_id,tier,rank,holo,tradeable,pulled_at,tracks(title,artist,album,cover,duration,bpm,year,explicit,genre)")
      .eq("owner", owner).order("pulled_at").range(from, from + 999);
    if (onlyTradeable) q = q.eq("tradeable", true);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const map = {};
  for (const r of rows) if (r.tracks) addCopy(map, r, r.tracks);
  return map;
}
async function loadProfile() {
  const { data, error } = await sb.from("profiles").select("*").eq("id", me.id).single();
  if (error) throw error;
  Object.assign(me, data);
  S.opened = data.opened; S.dry = data.dry; S.gods = data.gods;
  S.stock = data.stock; S.stockAt = Date.parse(data.stock_at);
  S.streams = data.streams;
}
async function loadAll() {
  const [{ data: settings }, cards] = await Promise.all([sb.from("settings").select("*").single(), fetchCards(me.id)]);
  if (settings) TEST_MODE = settings.test_mode;
  S = { c: cards, opened: 0, dry: 0, stock: STOCK_MAX, stockAt: Date.now() };
  await loadProfile();
}
function refreshViews() {
  renderCounters(); renderStock(); renderAccount(); renderImport(); renderDiscard();
  if (!views.defis.hidden) renderDefis();
  if (!views.market.hidden) renderMarket();
  if (!views.binder.hidden) renderBinder();
  if (!views.catalog.hidden && CAT.loaded) renderCatalog();
  if (!views.trades.hidden) renderTrades();
}

async function enterAccount(user) {
  if (me && me.id === user.id) return;
  me = { id: user.id, email: user.email };
  guestS = Online.active ? guestS : S;
  try {
    await loadAll();
    Online.active = true;
    $("#tab-trades").hidden = false; $("#tab-defis").hidden = false; $("#tab-market").hidden = false;
    $("#table").hidden = true; $("#deal").innerHTML = "";
    refreshViews();
    pollOffers(); updateDefisBadge();
  } catch (e) {
    me = null; toast(message(e));
  }
}
function leaveAccount() {
  me = null; Online.active = false;
  try { const p = JSON.parse(localStorage.getItem(LS)); S = p && p.c ? p : { c: {}, opened: 0, stock: STOCK_MAX, stockAt: Date.now(), dry: 0 }; }
  catch (e) { S = guestS; }
  TEST_MODE = true;
  $("#tab-trades").hidden = true; $("#tradeBadge").hidden = true;
  $("#tab-defis").hidden = true; $("#defisBadge").hidden = true; $("#tab-market").hidden = true;
  if (!views.trades.hidden || !views.defis.hidden || !views.market.hidden) show("shop");
  $("#table").hidden = true; $("#deal").innerHTML = "";
  refreshViews();
}

/* ---------- boosters with an account ---------- */
Object.assign(Online, {
  message,
  async startPack(p) {
    const d = await rpc("start_pack", { p_kind: p.g >= 0 ? "genre" : "booster", p_genre: p.g >= 0 ? p.g : null });
    return d;
  },
  async abandon(pk) { try { await rpc("abandon_pack", { p_pack: pk.id }); await loadProfile(); } catch (e) {} },
  // the browser finds tracks for the rarities the server rolled; the server checks them on Deezer
  async drawPack(p, pk) {
    const used = new Set(), raws = [];
    for (const tier of pk.slots) {
      const t = await findTrack(p.g, tier, used);
      if (t) { used.add(t.id); raws.push(t); }
    }
    if (raws.length < 5) throw { code: "short" };
    const res = await rpc("finish_pack", { p_pack: pk.id, p_tracks: raws.map(t => t.id) });
    const ids = res.map(r => r.track);
    const { data: tracks, error } = await sb.from("tracks").select("*").in("id", ids);
    if (error) throw error;
    const byId = Object.fromEntries(tracks.map(t => [t.id, t]));
    const pulls = res.map(r => {
      const row = { id: r.card, track_id: r.track, tier: r.tier, rank: r.rank, holo: r.holo, tradeable: true, pulled_at: new Date().toISOString() };
      addCopy(S.c, row, byId[r.track]);
      return { c: cardFromRow(row, byId[r.track]), holo: r.holo, isNew: r.new, wanted: r.wanted };
    }).sort((a, b) => a.c.tier - b.c.tier || a.c.rank - b.c.rank);
    await loadProfile();
    updateDefisBadge();
    return pulls;
  },
  async reset() {
    await rpc("reset_collection");
    await loadAll();
  },
  renderTrades: () => renderTrades(),
  renderDefis: () => renderDefis(),
  renderDiscard: () => renderDiscard(),
  modalExtras: c => { modalExtras(c); marketExtras(c); },
  renderMarket: () => renderMarket(),
  askSignIn: () => openAuth("in"),
});

/* ---------- header account area ---------- */
function renderAccount() {
  const box = $("#account");
  if (!me) {
    box.innerHTML = `<button class="btn primary" id="signIn">Se connecter</button>`;
    $("#signIn").onclick = () => openAuth("in");
  } else {
    box.innerHTML = `<button class="btn" id="myAccount" aria-label="Mon compte">${esc(me.pseudo || "Mon compte")}${me.title ? `<small class="title-tag">${esc(me.title)}</small>` : ""}</button>`;
    $("#myAccount").onclick = () => openAuth("account");
  }
}

/* ---------- sign-in / sign-up / password / account dialog ---------- */
const authModal = $("#authModal");
let authLastFocus = null;
function openAuth(mode) {
  authLastFocus = document.activeElement;
  authModal.hidden = false;
  renderAuth(mode);
}
function closeAuth() { authModal.hidden = true; authLastFocus?.focus?.(); }
$("#authClose").onclick = closeAuth;
authModal.addEventListener("click", e => { if (e.target === authModal) closeAuth(); });
addEventListener("keydown", e => { if (e.key === "Escape" && !authModal.hidden) closeAuth(); });

function field(id, label, type, extra = "") {
  return `<label class="field" for="${id}"><span>${label}</span><input id="${id}" type="${type}" ${extra}></label>`;
}
function renderAuth(mode, note = "") {
  const title = $("#authTitle"), body = $("#authBody");
  const say = (msg, ok) => { const p = body.querySelector(".form-msg"); p.textContent = msg; p.classList.toggle("ok", !!ok); };
  if (mode === "in") {
    title.textContent = "Connexion";
    body.innerHTML = `<form id="fIn" class="form">${field("inEmail", "E-mail", "email", 'autocomplete="email" required')}
      ${field("inPass", "Mot de passe", "password", 'autocomplete="current-password" required')}
      <p class="form-msg" role="status">${esc(note)}</p>
      <button class="btn primary" type="submit">Se connecter</button>
      <p class="form-links"><button type="button" class="linkish" id="toForgot">Mot de passe oublié ?</button>
      <button type="button" class="linkish" id="toUp">Pas de compte ? Crée-le</button></p></form>`;
    $("#toForgot").onclick = () => renderAuth("forgot");
    $("#toUp").onclick = () => renderAuth("up");
    $("#fIn").onsubmit = async e => {
      e.preventDefault(); say("Connexion…");
      const { error } = await sb.auth.signInWithPassword({ email: $("#inEmail").value.trim(), password: $("#inPass").value });
      if (error) return say(/confirm/i.test(error.message) ? "Ton adresse n'est pas encore vérifiée : clique sur le lien reçu par e-mail."
        : /invalid/i.test(error.message) ? "E-mail ou mot de passe incorrect." : message(error));
      closeAuth(); toast("Connecté.");
    };
    $("#inEmail").focus();
  } else if (mode === "up") {
    title.textContent = "Créer un compte";
    body.innerHTML = `<form id="fUp" class="form">${field("upPseudo", "Pseudo (3 à 20 lettres, chiffres, . _ -)", "text", 'autocomplete="username" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_.\\-]{3,20}"')}
      <small class="hint" id="pseudoHint"></small>
      ${field("upEmail", "E-mail", "email", 'autocomplete="email" required')}
      ${field("upPass", "Mot de passe (8 caractères minimum)", "password", 'autocomplete="new-password" required minlength="8"')}
      <p class="form-msg" role="status"></p>
      <button class="btn primary" type="submit">Créer mon compte</button>
      <p class="form-fine">En créant un compte, tu acceptes que ton pseudo, ton e-mail et ta collection soient enregistrés pour faire fonctionner le jeu. <button type="button" class="linkish" id="upPrivacy">Confidentialité</button></p>
      <p class="form-links"><button type="button" class="linkish" id="toIn">Déjà un compte ? Connecte-toi</button></p></form>`;
    $("#toIn").onclick = () => renderAuth("in");
    $("#upPrivacy").onclick = () => renderAuth("privacy", "up");
    let t;
    $("#upPseudo").oninput = () => {
      clearTimeout(t);
      const v = $("#upPseudo").value.trim();
      $("#pseudoHint").textContent = "";
      if (!/^[A-Za-z0-9_.-]{3,20}$/.test(v)) return;
      t = setTimeout(async () => {
        try { const free = await rpc("pseudo_available", { p: v }); $("#pseudoHint").textContent = free ? "Pseudo disponible." : "Pseudo déjà pris."; }
        catch (e) {}
      }, 350);
    };
    $("#fUp").onsubmit = async e => {
      e.preventDefault();
      const pseudo = $("#upPseudo").value.trim();
      if (!/^[A-Za-z0-9_.-]{3,20}$/.test(pseudo)) return say("Le pseudo doit faire 3 à 20 caractères : lettres, chiffres, point, tiret ou _.");
      say("Création du compte…");
      try { if (!(await rpc("pseudo_available", { p: pseudo }))) return say("Ce pseudo est déjà pris, choisis-en un autre."); } catch (e2) {}
      const email = $("#upEmail").value.trim();
      const { error } = await sb.auth.signUp({ email, password: $("#upPass").value, options: { data: { pseudo }, emailRedirectTo: backHere() } });
      if (error) return say(/already/i.test(error.message) ? "Un compte existe déjà avec cette adresse. Connecte-toi."
        : /rate limit/i.test(error.message) ? "Trop d'e-mails envoyés pour l'instant. Réessaie dans une heure."
        : /password/i.test(error.message) ? "Mot de passe trop faible : 8 caractères minimum."
        : /database error/i.test(error.message) ? "Ce pseudo vient d'être pris, choisis-en un autre." : message(error));
      body.innerHTML = `<p class="form-done">Compte créé. Clique sur le lien envoyé à <b>${esc(email)}</b> pour l'activer, puis reviens te connecter.</p>
        <p class="form-fine">Pas d'e-mail ? Regarde dans les indésirables.</p>`;
    };
    $("#upPseudo").focus();
  } else if (mode === "forgot") {
    title.textContent = "Mot de passe oublié";
    body.innerHTML = `<form id="fForgot" class="form">${field("fgEmail", "E-mail du compte", "email", 'autocomplete="email" required')}
      <p class="form-msg" role="status"></p>
      <button class="btn primary" type="submit">Recevoir un lien</button>
      <p class="form-links"><button type="button" class="linkish" id="toIn">Retour à la connexion</button></p></form>`;
    $("#toIn").onclick = () => renderAuth("in");
    $("#fForgot").onsubmit = async e => {
      e.preventDefault(); say("Envoi…");
      const { error } = await sb.auth.resetPasswordForEmail($("#fgEmail").value.trim(), { redirectTo: backHere() });
      if (error) return say(/rate limit/i.test(error.message) ? "Trop d'e-mails envoyés pour l'instant. Réessaie dans une heure." : message(error));
      say("Si un compte existe avec cette adresse, un lien vient d'être envoyé.", true);
    };
    $("#fgEmail").focus();
  } else if (mode === "newpass") {
    title.textContent = "Nouveau mot de passe";
    body.innerHTML = `<form id="fNew" class="form">${field("npPass", "Nouveau mot de passe (8 caractères minimum)", "password", 'autocomplete="new-password" required minlength="8"')}
      <p class="form-msg" role="status"></p><button class="btn primary" type="submit">Enregistrer</button></form>`;
    $("#fNew").onsubmit = async e => {
      e.preventDefault(); say("Enregistrement…");
      const { error } = await sb.auth.updateUser({ password: $("#npPass").value });
      if (error) return say(message(error));
      closeAuth(); toast("Mot de passe changé.");
    };
    $("#npPass").focus();
  } else if (mode === "account") {
    title.textContent = "Mon compte";
    body.innerHTML = `<dl class="acct"><dt>Pseudo</dt><dd>${esc(me.pseudo)}</dd><dt>E-mail</dt><dd>${esc(me.email || "")}</dd>
      <dt>Inscrit le</dt><dd>${new Date(me.created_at).toLocaleDateString("fr-FR")}</dd></dl>
      <div class="btns"><button class="btn" id="signOut">Se déconnecter</button><button class="btn" id="accPrivacy">Confidentialité</button></div>
      <div class="danger-zone"><button class="btn danger" id="delAsk">Supprimer mon compte</button>
        <div id="delConfirm" hidden class="reset-confirm" role="alertdialog" aria-labelledby="delQ">
          <p id="delQ"><b>Supprimer ton compte ?</b> Ton pseudo, ton e-mail, toutes tes cartes et tes échanges seront effacés définitivement.</p>
          <div class="btns"><button class="btn" id="delNo">Annuler</button><button class="btn danger solid" id="delYes">Oui, supprimer</button></div>
        </div></div>`;
    $("#signOut").onclick = async () => { await sb.auth.signOut(); closeAuth(); toast("Déconnecté."); };
    $("#accPrivacy").onclick = () => renderAuth("privacy", "account");
    $("#delAsk").onclick = () => { $("#delConfirm").hidden = false; $("#delAsk").hidden = true; $("#delNo").focus(); };
    $("#delNo").onclick = () => { $("#delConfirm").hidden = true; $("#delAsk").hidden = false; };
    $("#delYes").onclick = async () => {
      try { await rpc("delete_account"); await sb.auth.signOut(); closeAuth(); toast("Compte supprimé."); }
      catch (e) { toast(message(e)); }
    };
  } else if (mode === "privacy") {
    title.textContent = "Confidentialité";
    body.innerHTML = `<div class="privacy">
      <p><b>Ce qui est enregistré.</b> Sans compte : ta collection, seulement dans ce navigateur. Avec un compte : ton pseudo, ton e-mail, ton mot de passe (chiffré, illisible pour nous), tes cartes, tes boosters ouverts et tes échanges.</p>
      <p><b>Pourquoi.</b> Pour te connecter, garder ta collection d'un appareil à l'autre et permettre les échanges. Rien n'est vendu ni utilisé pour de la publicité.</p>
      <p><b>Qui voit quoi.</b> Les autres joueurs connectés voient ton pseudo et ta collection. Ton e-mail n'est jamais affiché.</p>
      <p><b>Où.</b> Chez Supabase, sur des serveurs en Europe (Paris). Les morceaux, pochettes et extraits viennent de l'API publique Deezer.</p>
      <p><b>Tes droits.</b> Tu peux supprimer ton compte à tout moment depuis « Mon compte » : tout est effacé.</p></div>
      ${note ? `<button class="btn" id="privBack">Retour</button>` : ""}`;
    if (note) $("#privBack").onclick = () => renderAuth(note);
  }
}
$("#privacyLink").onclick = () => openAuth("privacy");

/* ---------- import of the guest collection (once, cards stay untradeable) ---------- */
function renderImport() {
  const box = $("#importBox");
  const local = (() => { try { return JSON.parse(localStorage.getItem(LS)); } catch (e) { return null; } })();
  const cards = local && local.c ? Object.values(local.c) : [];
  if (!me || me.imported || !cards.length) { box.hidden = true; return; }
  const copies = cards.reduce((a, c) => a + (c.n || 1), 0);
  box.hidden = false;
  box.innerHTML = `<p><b>Tu as ${fmt(copies)} cartes jouées sans compte sur cet appareil.</b> Tu peux les ajouter à ton compte pour les retrouver partout et les échanger.</p>
    <div class="btns"><button class="btn primary" id="doImport">Ajouter à mon compte</button></div>`;
  $("#doImport").onclick = async () => {
    $("#doImport").disabled = true; $("#doImport").textContent = "Import…";
    try {
      const n = await rpc("import_collection", { p_cards: cards, p_opened: local.opened || 0 });
      await loadAll(); refreshViews(); toast(fmt(n) + " cartes ajoutées à ton compte.");
    } catch (e) { toast(message(e)); $("#doImport").disabled = false; $("#doImport").textContent = "Ajouter à mon compte"; }
  };
}

/* ---------- trades ---------- */
const OFFER_SELECT = "id,status,created_at,decided_at,from_user,to_user,from:profiles!offers_from_user_fkey(pseudo),to:profiles!offers_to_user_fkey(pseudo)," +
  "offer_items(side,card_id,cards(track_id,tier,rank,holo,tracks(title,artist,album,cover,duration,bpm,year,explicit,genre)))";
const ED = { player: null, theirs: null, give: new Map(), take: new Map(), qMine: "", qTheirs: "" };
let pollTimer = null;

async function pollOffers() {
  clearTimeout(pollTimer);
  if (!me) return;
  try {
    const { count } = await sb.from("offers").select("id", { count: "exact", head: true }).eq("to_user", me.id).eq("status", "pending");
    $("#tradeBadge").hidden = !count; $("#tradeBadge").textContent = count || "";
  } catch (e) {}
  pollTimer = setTimeout(pollOffers, 30000);
}

function miniCard(c, holo) { const w = document.createElement("div"); w.className = "mini"; w.appendChild(cardEl(c, holo)); return w; }
function offerCards(o, side) {
  const wrap = document.createElement("div"); wrap.className = "mini-row";
  for (const it of o.offer_items.filter(i => i.side === side)) {
    if (!it.cards) continue;
    const c = cardFromRow({ track_id: it.cards.track_id, tier: it.cards.tier, rank: it.cards.rank }, it.cards.tracks);
    const m = miniCard(c, it.cards.holo); m.tabIndex = 0; m.setAttribute("role", "button");
    m.setAttribute("aria-label", c.t + " de " + c.a); m.onclick = () => openModal(c);
    wrap.appendChild(m);
  }
  return wrap;
}
const STATUS = { accepted: "Accepté", refused: "Refusé", cancelled: "Annulé", expired: "Expiré (une carte n'était plus disponible)" };

async function renderTrades() {
  if (!me) return;
  try {
    const wait = await rpc("my_trade_wait");
    const box = $("#tradeWait");
    box.hidden = !wait;
    if (wait) {
      const h = Math.ceil(wait / 3600);
      box.innerHTML = `<p><b>Tu pourras échanger dans ${h > 1 ? h + " heures" : "moins d'une heure"}.</b> Un compte doit avoir 48 h avant d'échanger, pour éviter les faux comptes. En attendant, tu peux déjà voir les collections des autres et recevoir des offres.</p>`;
    }
    const { data, error } = await sb.from("offers").select(OFFER_SELECT).order("created_at", { ascending: false }).limit(60);
    if (error) throw error;
    const inBox = $("#offersIn"), outBox = $("#offersOut"), doneBox = $("#offersDone");
    inBox.innerHTML = outBox.innerHTML = doneBox.innerHTML = "";
    const pend = data.filter(o => o.status === "pending");
    const received = pend.filter(o => o.to_user === me.id), sent = pend.filter(o => o.from_user === me.id);
    const done = data.filter(o => o.status !== "pending").slice(0, 20);
    if (!received.length) inBox.innerHTML = `<p class="empty-line">Aucune offre reçue pour l'instant.</p>`;
    if (!sent.length) outBox.innerHTML = `<p class="empty-line">Aucune offre envoyée en attente.</p>`;
    if (!done.length) doneBox.innerHTML = `<p class="empty-line">Pas encore d'échange terminé.</p>`;
    for (const o of received) inBox.appendChild(offerEl(o, "in"));
    for (const o of sent) outBox.appendChild(offerEl(o, "out"));
    for (const o of done) doneBox.appendChild(offerEl(o, "done"));
    $("#tradeBadge").hidden = !received.length; $("#tradeBadge").textContent = received.length || "";
  } catch (e) { toast(message(e)); }
}

function offerEl(o, kind) {
  const mine = o.from_user === me.id;
  const other = mine ? o.to?.pseudo : o.from?.pseudo;
  const el = document.createElement("article"); el.className = "offer-card" + (kind === "done" ? " done" : "");
  const when = new Date(o.decided_at || o.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  el.innerHTML = `<header><b>${kind === "in" ? esc(other) + " te propose un échange" : mine ? "Ton offre à " + esc(other) : esc(other) + " t'a proposé"}</b>
    <span>${kind === "done" ? STATUS[o.status] + " · " : ""}${when}</span></header>
    <div class="sides"><div><h4>${mine ? "Tu donnes" : esc(other) + " donne"}</h4></div><div class="arrow" aria-hidden="true">⇄</div><div><h4>${mine ? "Tu reçois" : "Tu donnes"}</h4></div></div>`;
  const cols = el.querySelectorAll(".sides > div:not(.arrow)");
  cols[0].appendChild(offerCards(o, "give"));
  cols[1].appendChild(offerCards(o, "take"));
  const btns = document.createElement("div"); btns.className = "btns";
  const act = (label, cls, fn) => { const b = document.createElement("button"); b.className = "btn " + cls; b.textContent = label; b.onclick = async () => {
    btns.querySelectorAll("button").forEach(x => x.disabled = true);
    try { await fn(); } catch (e) { toast(message(e)); }
    btns.querySelectorAll("button").forEach(x => x.disabled = false);
  }; btns.appendChild(b); };
  if (kind === "in") {
    act("Accepter", "primary", async () => {
      const r = await rpc("accept_offer", { p_offer: o.id });
      if (r === "cards_moved") toast("Échange impossible : une des cartes a déjà changé de main. L'offre a expiré.");
      else toast("Échange fait ! Les cartes sont dans ta collection.");
      await loadAll(); refreshViews();
    });
    act("Refuser", "", async () => { await rpc("refuse_offer", { p_offer: o.id }); toast("Offre refusée."); renderTrades(); });
    act("Contre-proposer", "", async () => {
      await rpc("refuse_offer", { p_offer: o.id });
      const theirs = o.offer_items.filter(i => i.side === "give").map(i => i.card_id);
      const minesAsked = o.offer_items.filter(i => i.side === "take").map(i => i.card_id);
      await openEditor({ id: o.from_user, pseudo: o.from?.pseudo }, minesAsked, theirs);
      toast("Offre refusée. Modifie-la puis renvoie ta contre-proposition.");
      renderTrades();
    });
  } else if (kind === "out") {
    act("Annuler l'offre", "", async () => { await rpc("cancel_offer", { p_offer: o.id }); toast("Offre annulée."); renderTrades(); });
  }
  if (btns.children.length) el.appendChild(btns);
  return el;
}

/* player search → trade editor */
let playerTimer;
$("#playerQ").addEventListener("input", () => { clearTimeout(playerTimer); playerTimer = setTimeout(findPlayers, 300); });
$("#playerForm").onsubmit = e => { e.preventDefault(); clearTimeout(playerTimer); findPlayers(); };
async function findPlayers() {
  const q = $("#playerQ").value.trim(), box = $("#players");
  if (q.length < 2) { box.innerHTML = ""; return; }
  const { data, error } = await sb.from("profiles").select("id,pseudo,title,created_at").ilike("pseudo", q.replace(/[%_]/g, "") + "%").neq("id", me.id).limit(8);
  if (error) return toast(message(error));
  box.innerHTML = data.length ? "" : `<p class="empty-line">Aucun joueur avec ce pseudo.</p>`;
  for (const p of data) {
    const b = document.createElement("button"); b.className = "chip player"; b.textContent = p.pseudo + (p.title ? " · " + p.title : "");
    b.onclick = () => openEditor(p);
    box.appendChild(b);
  }
}

async function openEditor(player, preGive = [], preTake = []) {
  const ed = $("#editor");
  ed.hidden = false;
  ed.innerHTML = `<p class="empty-line">Chargement de la collection de ${esc(player.pseudo)}…</p>`;
  ED.player = player; ED.give = new Map(); ED.take = new Map(); ED.qMine = ""; ED.qTheirs = "";
  try { ED.theirs = await fetchCards(player.id, true); } catch (e) { ed.innerHTML = ""; return toast(message(e)); }
  // preselect copies by id (used by counter-offers)
  const pre = (map, ids, sel) => { for (const c of Object.values(map)) for (const cp of c.copies) if (ids.includes(cp.id) && sel.size < 5) sel.set(cp.id, c); };
  pre(S.c, preGive, ED.give); pre(ED.theirs, preTake, ED.take);
  renderEditor();
  ed.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
}

function pickGrid(map, sel, query, label) {
  const grid = document.createElement("div"); grid.className = "pick-grid";
  const q = query.toLowerCase();
  const list = Object.values(map)
    .filter(c => c.copies.some(cp => cp.tradeable))
    .filter(c => !q || (c.t + " " + c.a).toLowerCase().includes(q))
    .sort((a, b) => b.tier - a.tier || b.rank - a.rank).slice(0, 120);
  if (!list.length) { grid.innerHTML = `<p class="empty-line">${query ? "Aucune carte ne correspond." : label}</p>`; return grid; }
  for (const c of list) {
    const free = c.copies.filter(cp => cp.tradeable && !sel.has(cp.id));
    const chosen = c.copies.filter(cp => sel.has(cp.id)).length;
    const b = document.createElement("button"); b.className = "pick" + (chosen ? " on" : "");
    b.setAttribute("aria-pressed", chosen > 0);
    b.setAttribute("aria-label", `${c.t} de ${c.a}, ${RAR[c.tier]}${chosen ? ", choisie" : ""}`);
    b.appendChild(miniCard(c, c.holo > 0));
    const tradeable = c.copies.filter(cp => cp.tradeable).length;
    if (tradeable > 1 || chosen) { const n = document.createElement("span"); n.className = "cnt"; n.textContent = chosen ? chosen + "/" + tradeable : "×" + tradeable; b.appendChild(n); }
    b.onclick = () => {
      if (free.length && sel.size < 5) sel.set(free[0].id, c);
      else if (chosen) { const id = c.copies.find(cp => sel.has(cp.id)).id; sel.delete(id); }
      else return toast("5 cartes maximum de chaque côté.");
      renderEditor();
    };
    grid.appendChild(b);
  }
  return grid;
}

function renderEditor() {
  const ed = $("#editor"), p = ED.player;
  ed.innerHTML = `<div class="editor-head"><h4>Échange avec ${esc(p.pseudo)}</h4><button class="btn" id="edClose">Fermer</button></div>
    <div class="editor-cols">
      <div class="col"><h5>Tu donnes <small>${ED.give.size}/5</small></h5>
        <input class="mini-search" id="edMineQ" type="search" placeholder="Chercher dans ta collection" value="${esc(ED.qMine)}" aria-label="Chercher dans ta collection"><div id="edMine"></div></div>
      <div class="col"><h5>Tu reçois <small>${ED.take.size}/5</small></h5>
        <input class="mini-search" id="edTheirsQ" type="search" placeholder="Chercher chez ${esc(p.pseudo)}" value="${esc(ED.qTheirs)}" aria-label="Chercher dans sa collection"><div id="edTheirs"></div></div>
    </div>
    <div class="editor-foot"><p id="edSummary"></p><button class="btn primary" id="edSend">Envoyer l'offre</button></div>`;
  $("#edMine").appendChild(pickGrid(S.c, ED.give, ED.qMine, "Tu n'as pas encore de carte. Ouvre un booster pour en tirer."));
  $("#edTheirs").appendChild(pickGrid(ED.theirs, ED.take, ED.qTheirs, p.pseudo + " n'a pas de carte échangeable pour l'instant."));
  $("#edSummary").textContent = ED.give.size && ED.take.size
    ? `${ED.give.size} carte${ED.give.size > 1 ? "s" : ""} contre ${ED.take.size} carte${ED.take.size > 1 ? "s" : ""}.`
    : "Choisis au moins une carte de chaque côté.";
  $("#edSend").disabled = !ED.give.size || !ED.take.size;
  $("#edClose").onclick = () => { $("#editor").hidden = true; $("#editor").innerHTML = ""; };
  const search = (id, key) => { const inp = $(id); inp.oninput = () => { ED[key] = inp.value; clearTimeout(inp._t); inp._t = setTimeout(() => { renderEditor(); const n = $(id); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); }; };
  search("#edMineQ", "qMine"); search("#edTheirsQ", "qTheirs");
  $("#edSend").onclick = async () => {
    $("#edSend").disabled = true;
    try {
      await rpc("create_offer", { p_to: p.id, p_give: [...ED.give.keys()], p_take: [...ED.take.keys()] });
      toast("Offre envoyée à " + p.pseudo + ".");
      $("#editor").hidden = true; $("#editor").innerHTML = "";
      renderTrades();
    } catch (e) { toast(message(e)); $("#edSend").disabled = false; }
  };
}

/* ---------- start ---------- */
renderAccount();
sb.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY") { openAuth("newpass"); }
  if (session?.user) setTimeout(() => enterAccount(session.user), 0);   // outside the auth callback, as supabase-js asks
  else if (event === "SIGNED_OUT" || (event === "INITIAL_SESSION" && me)) leaveAccount();
});


/* ---------- Streams: discarding duplicates ---------- */
const DISCARD = [1, 1, 1, 10, 50, 100];   // same values as discard_value() on the server
// the copies "tout défausser" would remove: all but the best copy of each track (holo, then rarity)
function duplicateCopies() {
  const out = [];
  for (const c of Object.values(S.c)) {
    if (!c.copies || c.copies.length < 2) continue;
    const sorted = [...c.copies].sort((a, b) => (b.holo - a.holo) || (b.tier - a.tier));
    out.push(...sorted.slice(1));
  }
  return out;
}
function renderDiscard() {
  const box = $("#discardBox");
  if (!me) { box.hidden = true; return; }
  const dups = duplicateCopies(), gain = dups.reduce((a, cp) => a + DISCARD[cp.tier], 0);
  box.hidden = !dups.length;
  if (!dups.length) return;
  box.innerHTML = `<p><b>${fmt(dups.length)} doublon${dups.length > 1 ? "s" : ""}</b> dans ta collection. Défausse-les pour gagner <b>${fmt(gain)} Streams</b> : 1 par Commune, Peu commune ou Rare, 10 par Épique, 50 par Mythique, 100 par Légendaire. Tu gardes toujours un exemplaire de chaque carte (le plus beau).</p>
    <div class="btns"><button class="btn primary" id="discardAsk">Défausser mes doublons</button></div>
    <div class="reset-confirm" id="discardConfirm" hidden role="alertdialog" aria-labelledby="discardQ">
      <p id="discardQ"><b>Défausser ${fmt(dups.length)} cartes contre ${fmt(gain)} Streams ?</b> Les doublons qui font partie d'une offre d'échange en attente ne sont pas touchés.</p>
      <div class="btns"><button class="btn" id="discardNo">Annuler</button><button class="btn primary" id="discardYes">Oui, défausser</button></div>
    </div>`;
  $("#discardAsk").onclick = () => { $("#discardConfirm").hidden = false; $("#discardAsk").hidden = true; $("#discardNo").focus(); };
  $("#discardNo").onclick = () => { $("#discardConfirm").hidden = true; $("#discardAsk").hidden = false; };
  $("#discardYes").onclick = async () => {
    $("#discardYes").disabled = true;
    try {
      const r = await rpc("discard_all_duplicates");
      await loadAll(); refreshViews(); renderBinder(); updateDefisBadge();
      toast(`${fmt(r.removed)} doublons défaussés : +${fmt(r.gained)} Streams.`);
    } catch (e) { toast(message(e)); $("#discardYes").disabled = false; }
  };
}
// in the card details: discard one spare copy (never the last one, never the holo when a plain copy exists)
function modalExtras(c) {
  const btn = $("#mDiscard"), own = S.c[c.id];
  btn.hidden = !(Online.active && own && own.copies && own.copies.length > 1);
  if (btn.hidden) return;
  const spare = [...own.copies].sort((a, b) => (a.holo - b.holo) || (a.tier - b.tier))[0];
  btn.textContent = `Défausser un doublon (+${DISCARD[spare.tier]} Stream${DISCARD[spare.tier] > 1 ? "s" : ""})`;
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const r = await rpc("discard_cards", { p_cards: [spare.id] });
      await loadAll(); refreshViews(); if (!views.binder.hidden) renderBinder(); updateDefisBadge();
      toast(`Doublon défaussé : +${r.gained} Stream${r.gained > 1 ? "s" : ""}.`);
      if (S.c[c.id]) openModal(S.c[c.id]);
    } catch (e) { toast(message(e)); }
    btn.disabled = false;
  };
}

/* ---------- Défis: login streak, daily challenges, achievements ---------- */
const MEDALS = ["Bronze", "Argent", "Or"];
async function updateDefisBadge() {
  if (!me) return;
  try {
    const [daily, ach] = await Promise.all([rpc("daily_state"), rpc("achievements_state")]);
    const n = (daily.login.claimed ? 0 : 1)
      + daily.challenges.filter(c => !c.claimed && c.progress >= c.goal).length
      + ach.filter(a => a.goals.some((g, i) => a.value >= g && !a.claimed.includes(i + 1))).length;
    $("#defisBadge").hidden = !n; $("#defisBadge").textContent = n || "";
  } catch (e) {}
}
async function claim(fn, args, okText) {
  try {
    const r = await rpc(fn, args);
    await loadProfile(); renderCounters();
    toast(okText(r));
    renderDefis(); updateDefisBadge();
  } catch (e) { toast(message(e)); }
}
async function renderDefis() {
  if (!me) return;
  $("#walletStreams").textContent = fmt(S.streams || 0);
  let daily, ach;
  try { [daily, ach] = await Promise.all([rpc("daily_state"), rpc("achievements_state")]); }
  catch (e) { return toast(message(e)); }

  // login streak
  const L = daily.login, lb = $("#loginBox");
  const days = Array.from({ length: 7 }, (_, i) => {
    const reward = [5, 10, 15, 20, 25, 30, 50][i];
    const reached = L.claimed ? i < Math.min(L.streak, 7) : i < Math.min(L.streak, 6);
    return `<li class="${reached ? "on" : ""}"><span>J${i + 1}</span><b>${reward}</b></li>`;
  }).join("");
  lb.innerHTML = `<div><b>Prime de connexion</b><small>${L.claimed ? `Récupérée. Série de ${L.streak} jour${L.streak > 1 ? "s" : ""}, reviens demain.` : `Série actuelle : ${L.streak} jour${L.streak > 1 ? "s" : ""}. Aujourd'hui : +${L.next} Streams.`}</small></div>
    <ol class="streak" aria-label="Récompenses de la série">${days}</ol>
    ${L.claimed ? "" : `<button class="btn primary" id="claimLogin">Récupérer +${L.next}</button>`}`;
  if (!L.claimed) $("#claimLogin").onclick = () => claim("claim_login", {}, r => `+${r.reward} Streams. Série de ${r.streak} jour${r.streak > 1 ? "s" : ""} !`);

  // daily challenges
  const dl = $("#dailies"); dl.innerHTML = "";
  for (const c of daily.challenges) {
    const done = c.progress >= c.goal;
    const el = document.createElement("div"); el.className = "daily" + (c.claimed ? " claimed" : done ? " ready" : "");
    el.innerHTML = `<div class="d-head"><b>${esc(c.label)}</b><span class="reward">+${c.reward}</span></div>
      <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="${c.goal}" aria-valuenow="${c.progress}"><s style="width:${c.progress / c.goal * 100}%"></s></div>
      <div class="d-foot"><small>${c.progress} / ${c.goal}</small>${c.claimed ? `<small class="ok">Récupéré</small>` : done ? `<button class="btn primary">Récupérer</button>` : ""}</div>`;
    const b = el.querySelector("button");
    if (b) b.onclick = () => claim("claim_daily", { p_key: c.key }, r => `Défi réussi : +${r} Streams.`);
    dl.appendChild(el);
  }
  const reset = document.createElement("p"); reset.className = "empty-line"; reset.textContent = "De nouveaux défis arrivent chaque jour à minuit.";
  dl.appendChild(reset);

  // achievements, grouped by category
  const box = $("#achievements"); box.innerHTML = "";
  const earnedTitles = [];
  let cat = null, grid = null;
  for (const a of ach) {
    if (a.category !== cat) {
      cat = a.category;
      const h = document.createElement("h4"); h.className = "ach-cat"; h.textContent = cat; box.appendChild(h);
      grid = document.createElement("div"); grid.className = "ach-grid"; box.appendChild(grid);
    }
    a.claimed.forEach(t => earnedTitles.push(a.titles[t - 1]));
    const next = a.goals.findIndex((g, i) => !a.claimed.includes(i + 1));
    const ready = a.goals.some((g, i) => a.value >= g && !a.claimed.includes(i + 1));
    const target = next < 0 ? a.goals[a.goals.length - 1] : a.goals[next];
    const single = a.goals.length === 1;
    const el = document.createElement("div"); el.className = "ach" + (next < 0 ? " complete" : "") + (ready ? " ready" : "");
    el.innerHTML = `<div class="a-head"><b>${esc(a.label)}</b>
        <span class="medals" aria-label="${a.claimed.length} palier${a.claimed.length > 1 ? "s" : ""} sur ${a.goals.length}">${a.goals.map((g, i) => `<i class="m${single ? 2 : i} ${a.claimed.includes(i + 1) ? "on" : ""}" title="${single ? "Succès" : MEDALS[i]} : ${fmt(g)}"></i>`).join("")}</span></div>
      <small>${esc(a.description)}</small>
      <div class="meter"><s style="width:${Math.min(100, a.value / target * 100)}%"></s></div>
      <div class="d-foot"><small>${fmt(Math.min(a.value, target))} / ${fmt(target)}${next < 0 ? " · terminé" : ` · ${single ? "" : MEDALS[next] + " : "}+${a.rewards[next]}`}</small>${ready ? `<button class="btn primary">Récupérer</button>` : ""}</div>`;
    const b = el.querySelector("button");
    if (b) b.onclick = () => claim("claim_achievement", { p_key: a.key }, r => `Succès « ${a.label} » : +${r} Streams.`);
    grid.appendChild(el);
  }

  // title under the pseudo
  const tp = $("#titlePick");
  tp.innerHTML = earnedTitles.length
    ? `<label for="titleSel">Titre affiché sous ton pseudo</label> <select id="titleSel"><option value="">Aucun</option>${earnedTitles.map(t => `<option ${t === me.title ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`
    : `<p class="empty-line">Chaque palier de succès débloque un titre à afficher à côté de ton pseudo.</p>`;
  const sel = $("#titleSel");
  if (sel) sel.onchange = async () => {
    try { await rpc("set_title", { p_title: sel.value || null }); me.title = sel.value || null; renderAccount(); toast(sel.value ? `Titre « ${sel.value} » affiché.` : "Titre retiré."); }
    catch (e) { toast(message(e)); }
  };
}


/* ---------- market: La Bourse aux disques ---------- */
const MK = { q: "", tier: -1, genre: -1, sort: "recent", page: 0, items: [], more: false, seq: 0, sellTrack: null };
const LISTING_SELECT = "id,seller,card_id,track_id,tier,holo,title,artist,genre,price,created_at,expires_at," +
  "seller_p:profiles!listings_seller_fkey(pseudo,title),tracks(album,cover,duration,bpm,year,explicit),cards(rank)";
const nowIso = () => new Date().toISOString();
function listingCard(l) {
  const t = l.tracks || {};
  return { id: l.track_id, t: l.title, a: l.artist, al: t.album || "", cov: t.cover || "", d: t.duration || 0, rank: l.cards?.rank || 0,
    bpm: t.bpm || 0, y: t.year || 0, x: t.explicit ? 1 : 0, g: l.genre, tier: l.tier };
}
const streamsTxt = n => `${fmt(n)} Stream${n > 1 ? "s" : ""}`;

function renderMarketFilters() {
  const g = $("#mGenre");
  if (!g.options.length) {
    g.innerHTML = `<option value="-1">Tous les genres</option>` + TYPES.map((t, i) => `<option value="${i}">${t.n}</option>`).join("");
    g.onchange = () => { MK.genre = +g.value; loadMarket(true); };
    $("#mSort").onchange = () => { MK.sort = $("#mSort").value; loadMarket(true); };
    let t;
    $("#mq").oninput = () => { clearTimeout(t); t = setTimeout(() => { MK.q = $("#mq").value.trim(); loadMarket(true); }, 350); };
    $("#marketForm").onsubmit = e => { e.preventDefault(); MK.q = $("#mq").value.trim(); loadMarket(true); };
    $("#mMore").onclick = () => loadMarket(false);
    $("#sellOpen").onclick = () => openSell(null);
  }
  $("#mFilters").innerHTML = [-1, ...RAR.keys()].map(r => `<button class="chip" data-r="${r}" aria-pressed="${MK.tier === r}">${r < 0 ? "Toutes raretés" : `<i style="background:${RCOL[r]}"></i>${RAR[r]}`}</button>`).join("");
  $("#mFilters").querySelectorAll(".chip").forEach(b => b.onclick = () => { MK.tier = +b.dataset.r; renderMarketFilters(); loadMarket(true); });
}

async function renderMarket() {
  if (!me) return;
  $("#marketStreams").textContent = fmt(S.streams || 0);
  renderMarketFilters();
  loadMarket(true);
  loadMine();
}

async function loadMarket(reset) {
  const seq = ++MK.seq;
  if (reset) { MK.page = 0; MK.items = []; }
  $("#mStatus").textContent = "Chargement des annonces…";
  let q = sb.from("listings").select(LISTING_SELECT, { count: "exact" }).eq("status", "active").gt("expires_at", nowIso());
  if (MK.q) { const s = MK.q.replace(/[%,()*]/g, " ").trim(); if (s) q = q.or(`title.ilike.*${s}*,artist.ilike.*${s}*`); }
  if (MK.tier >= 0) q = q.eq("tier", MK.tier);
  if (MK.genre >= 0) q = q.eq("genre", MK.genre);
  q = MK.sort === "cheap" ? q.order("price", { ascending: true }) : MK.sort === "dear" ? q.order("price", { ascending: false })
    : MK.sort === "rare" ? q.order("tier", { ascending: false }).order("price", { ascending: true }) : q.order("created_at", { ascending: false });
  const from = MK.page * 48;
  const { data, error, count } = await q.range(from, from + 47);
  if (seq !== MK.seq) return;
  if (error) { $("#mStatus").textContent = message(error); return; }
  MK.items.push(...data); MK.page++;
  MK.more = MK.items.length < (count || 0);
  $("#mStatus").textContent = count ? `${fmt(count)} carte${count > 1 ? "s" : ""} en vente` : (MK.q || MK.tier >= 0 || MK.genre >= 0 ? "Aucune carte en vente avec ces filtres." : "Personne n'a encore mis de carte en vente. Lance-toi avec « Vendre une carte ».");
  $("#mMore").hidden = !MK.more;
  const grid = $("#marketGrid"); grid.innerHTML = "";
  for (const l of MK.items) grid.appendChild(listingEl(l));
}

function listingEl(l) {
  const mine = l.seller === me.id, c = listingCard(l);
  const el = document.createElement("div"); el.className = "listing";
  const cardBtn = document.createElement("button"); cardBtn.className = "cell"; cardBtn.setAttribute("aria-label", `${c.t} de ${c.a}`);
  cardBtn.appendChild(cardEl(c, l.holo)); cardBtn.onclick = () => openModal(c);
  const days = Math.max(0, Math.ceil((Date.parse(l.expires_at) - Date.now()) / 86400000));
  const foot = document.createElement("div"); foot.className = "l-foot";
  foot.innerHTML = `<b class="price">${streamsTxt(l.price)}</b><small>${mine ? "ta vente" : "par " + esc(l.seller_p?.pseudo || "?")} · ${days} j</small>`;
  const btn = document.createElement("button"); btn.className = "btn " + (mine ? "" : "primary");
  btn.textContent = mine ? "Retirer" : "Acheter";
  btn.onclick = async () => {
    if (mine) {
      btn.disabled = true;
      try { await rpc("cancel_listing", { p_listing: l.id }); toast("Annonce retirée."); renderMarket(); } catch (e) { toast(message(e)); btn.disabled = false; }
      return;
    }
    if ((S.streams || 0) < l.price) return toast(`Pas assez de Streams : il t'en faut ${fmt(l.price)}, tu en as ${fmt(S.streams || 0)}.`);
    // confirmation inside the card's footer
    const yes = document.createElement("button"); yes.className = "btn primary"; yes.textContent = `Confirmer · ${fmt(l.price)}`;
    const no = document.createElement("button"); no.className = "btn"; no.textContent = "Annuler";
    btn.replaceWith(yes); yes.after(no); yes.focus();
    no.onclick = () => { yes.remove(); no.replaceWith(btn); };
    yes.onclick = async () => {
      yes.disabled = no.disabled = true;
      try {
        const r = await rpc("buy_listing", { p_listing: l.id });
        if (r.status === "card_gone") toast("Le vendeur n'a plus cette carte : l'annonce a été retirée.");
        else toast(`« ${c.t} » est à toi pour ${streamsTxt(r.price)} !`);
        await loadAll(); refreshViews(); updateDefisBadge();
      } catch (e) { toast(message(e)); yes.disabled = no.disabled = false; }
    };
  };
  foot.appendChild(btn);
  el.append(cardBtn, foot);
  return el;
}

async function loadMine() {
  const [{ data: active }, { data: hist }] = await Promise.all([
    sb.from("listings").select(LISTING_SELECT).eq("seller", me.id).eq("status", "active").gt("expires_at", nowIso()).order("created_at", { ascending: false }),
    sb.from("listings").select("id,title,artist,price,status,seller,buyer,closed_at,expires_at").or(`seller.eq.${me.id},buyer.eq.${me.id}`)
      .neq("status", "active").order("closed_at", { ascending: false }).limit(20),
  ]);
  const mine = $("#myListings"); mine.innerHTML = "";
  if (!active?.length) mine.innerHTML = `<p class="empty-line">Tu n'as aucune carte en vente.</p>`;
  for (const l of active || []) mine.appendChild(listingEl(l));
  const h = $("#marketHistory"); h.innerHTML = "";
  if (!hist?.length) { h.innerHTML = `<p class="empty-line">Pas encore de vente ni d'achat.</p>`; return; }
  const ul = document.createElement("ul"); ul.className = "history";
  for (const l of hist) {
    const sold = l.status === "sold", iBought = l.buyer === me.id;
    const what = sold ? (iBought ? "Acheté" : "Vendu") : l.status === "expired" ? "Annonce expirée" : "Annonce retirée";
    const net = sold && !iBought ? l.price - Math.floor(l.price * 5 / 100) : null;
    const li = document.createElement("li");
    li.innerHTML = `<span class="h-what ${sold ? (iBought ? "buy" : "sell") : ""}">${what}</span><span class="h-card">${esc(l.title)} <small>${esc(l.artist)}</small></span>
      <span class="h-price">${sold ? (iBought ? "−" : "+") + fmt(iBought ? l.price : net) : fmt(l.price)}</span>
      <small class="h-date">${new Date(l.closed_at || l.expires_at).toLocaleDateString("fr-FR")}</small>`;
    ul.appendChild(li);
  }
  h.appendChild(ul);
}

/* selling: choose a card (or come from its details), see its cote, set a price */
async function openSell(trackId) {
  if (!me) return;
  const panel = $("#sellPanel");
  panel.hidden = false;
  MK.sellTrack = trackId;
  const { data: listed } = await sb.from("listings").select("card_id").eq("seller", me.id).eq("status", "active").gt("expires_at", nowIso());
  const listedIds = new Set((listed || []).map(l => l.card_id));
  const sellable = c => (c.copies || []).filter(cp => cp.tradeable && !listedIds.has(cp.id));
  if (trackId && S.c[trackId] && sellable(S.c[trackId]).length) return renderSellForm(S.c[trackId], sellable(S.c[trackId]));
  // card picker
  panel.innerHTML = `<div class="editor-head"><h4>Quelle carte veux-tu vendre ?</h4><button class="btn" id="sellClose">Fermer</button></div>
    <input class="mini-search" id="sellQ" type="search" placeholder="Chercher dans ta collection" aria-label="Chercher dans ta collection"><div id="sellPick"></div>`;
  $("#sellClose").onclick = closeSell;
  const draw = () => {
    const q = $("#sellQ").value.toLowerCase();
    const list = Object.values(S.c).filter(c => sellable(c).length && (!q || (c.t + " " + c.a).toLowerCase().includes(q)))
      .sort((a, b) => b.tier - a.tier || b.rank - a.rank).slice(0, 120);
    const grid = document.createElement("div"); grid.className = "pick-grid";
    if (!list.length) grid.innerHTML = `<p class="empty-line">${q ? "Aucune carte ne correspond." : "Tu n'as pas de carte à vendre."}</p>`;
    for (const c of list) {
      const b = document.createElement("button"); b.className = "pick"; b.setAttribute("aria-label", `Vendre ${c.t} de ${c.a}`);
      b.appendChild(miniCard(c, c.holo > 0));
      b.onclick = () => renderSellForm(c, sellable(c));
      grid.appendChild(b);
    }
    $("#sellPick").innerHTML = ""; $("#sellPick").appendChild(grid);
  };
  let t; $("#sellQ").oninput = () => { clearTimeout(t); t = setTimeout(draw, 200); };
  draw();
  panel.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
}
function closeSell() { $("#sellPanel").hidden = true; $("#sellPanel").innerHTML = ""; }

async function renderSellForm(c, copies) {
  const panel = $("#sellPanel");
  // sell the plainest copy first (keep holos and higher rarities unless it's the only one)
  const copy = [...copies].sort((a, b) => (a.holo - b.holo) || (a.tier - b.tier))[0];
  const floor = DISCARD[copy.tier];
  panel.innerHTML = `<div class="editor-head"><h4>Vendre « ${esc(c.t)} »</h4><button class="btn" id="sellClose">Fermer</button></div>
    <div class="sell-form"><div class="sell-card" id="sellCard"></div>
      <div class="sell-side"><dl class="acct" id="sellCote"><dt>Cote</dt><dd>Chargement…</dd></dl>
        <label class="field" for="sellPrice"><span>Ton prix en Streams (minimum ${fmt(floor)})</span><input id="sellPrice" type="number" min="${floor}" max="10000000" step="1" inputmode="numeric"></label>
        <p class="form-fine" id="sellNet"></p>
        <div class="btns"><button class="btn primary" id="sellGo">Mettre en vente</button></div>
        <p class="form-fine">${copy.holo ? "Tu vends ta copie Holo. " : ""}${(S.c[c.id]?.copies?.length || 1) === 1 ? "C'est ton seul exemplaire de cette carte." : `Tu en gardes ${S.c[c.id].copies.length - 1}.`}</p>
      </div></div>`;
  $("#sellCard").appendChild(miniCard({ ...c, tier: copy.tier }, copy.holo));
  $("#sellClose").onclick = closeSell;
  const price = $("#sellPrice"), net = $("#sellNet");
  const showNet = () => { const p = Math.floor(+price.value || 0); net.textContent = p >= floor ? `Tu recevras ${streamsTxt(p - Math.floor(p * 5 / 100))} après la taxe de 5 %.` : `Le prix doit être d'au moins ${fmt(floor)}.`; };
  price.oninput = showNet;
  try {
    const st = await rpc("price_stats", { p_track: c.id });
    $("#sellCote").innerHTML = st.sales
      ? `<dt>Dernière vente</dt><dd>${streamsTxt(st.last)}</dd><dt>Moyenne</dt><dd>${streamsTxt(st.avg)} (${st.sales} vente${st.sales > 1 ? "s" : ""})</dd>${st.lowest_listing ? `<dt>En vente dès</dt><dd>${streamsTxt(st.lowest_listing)}</dd>` : ""}`
      : `<dt>Cote</dt><dd>Jamais vendue${st.lowest_listing ? ` · en vente dès ${streamsTxt(st.lowest_listing)}` : ""}</dd>`;
    price.value = st.avg || st.lowest_listing || Math.max(floor, [5, 15, 50, 200, 800, 3000][copy.tier]);
  } catch (e) { price.value = Math.max(floor, [5, 15, 50, 200, 800, 3000][copy.tier]); }
  showNet(); price.focus();
  $("#sellGo").onclick = async () => {
    const p = Math.floor(+price.value || 0);
    if (p < floor) return toast(`Le prix doit être d'au moins ${fmt(floor)} Streams.`);
    $("#sellGo").disabled = true;
    try {
      await rpc("create_listing", { p_card: copy.id, p_price: p });
      toast(`« ${c.t} » est en vente pour ${streamsTxt(p)}.`);
      closeSell(); renderMarket();
    } catch (e) { toast(message(e)); $("#sellGo").disabled = false; }
  };
  panel.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
}

/* card details: the cote, and a shortcut to sell */
async function marketExtras(c) {
  const btn = $("#mSell"), own = S.c[c.id];
  btn.hidden = !(Online.active && own && own.copies?.some(cp => cp.tradeable));
  btn.onclick = () => { closeModal(); show("market"); openSell(c.id); };
  if (!Online.active) return;
  try {
    const st = await rpc("price_stats", { p_track: c.id });
    if ($("#mTitle").textContent !== c.t) return;     // another card was opened meanwhile
    const dl = $("#mDl");
    dl.querySelector(".cote")?.remove();
    const wrap = document.createElement("div"); wrap.className = "cote"; wrap.style.display = "contents";
    wrap.innerHTML = `<dt>Cote</dt><dd>${st.sales ? `${streamsTxt(st.avg)} (moyenne de ${st.sales} vente${st.sales > 1 ? "s" : ""})` : "jamais vendue"}${st.lowest_listing ? ` · en vente dès ${streamsTxt(st.lowest_listing)}` : ""}</dd>`;
    dl.appendChild(wrap);
  } catch (e) {}
}
