"use strict";
/* Zik Hunter — accounts, server-checked boosters and trades (Supabase).
   Without an account the game keeps working as before, in this browser only. */

const SUPABASE_URL = "https://gvqlxsofrkqnniuhiiyf.supabase.co";
const SUPABASE_KEY = "sb_publishable_46l4-zXXY1WswsqKMUm_QQ_x68Zt52G";   // publishable key: meant to be public
// the session goes to localStorage; if the browser refuses (storage full with a big guest collection, private
// mode), it is kept in memory instead, so signing in still works for this visit
const memStore = new Map();
const authStorage = {
  getItem: k => { if (memStore.has(k)) return memStore.get(k); try { return localStorage.getItem(k); } catch (e) { return null; } },
  setItem: (k, v) => { memStore.set(k, v); try { localStorage.setItem(k, v); } catch (e) {} },
  removeItem: k => { memStore.delete(k); try { localStorage.removeItem(k); } catch (e) {} },
};
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { storage: authStorage } });
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
  album_incomplete: "Il te manque encore des titres de cet album.",
  collector_card: "Une carte Collector ne se défausse pas.",
  wishlist_full: "Ta liste de souhaits est pleine (300 cartes).",
  deck_needs_five: "Il faut 5 morceaux dans ton deck de clash.",
  deck_bad_cards: "Une carte de ton deck n'est plus dans ta collection.",
  self_duel: "Tu ne peux pas te lancer un clash à toi-même.",
  too_many_duels: "Tu as déjà 10 clashs en cours.",
  opponent_no_cards: "Ce joueur n'a pas encore assez de cartes pour un clash.",
  bet_needs_two_cards: "Pour parier, choisis ta carte et la sienne.",
  card_in_duel: "Cette carte est en jeu dans un pari de clash.",
  duel_not_found: "Ce clash n'est plus disponible.",
  bet_card_gone: "Une des cartes du pari n'est plus disponible.",
  not_enough_cards: "Il te faut au moins 4 cartes pour un entraînement.",
  too_many_tags: "40 étiquettes maximum.",
  tag_exists: "Tu as déjà une étiquette avec ce nom.",
  album_not_found: "Cet album n'est pas disponible.",
  discography_incomplete: "Il te manque encore des albums de cet artiste.",
  artist_not_found: "Cet artiste n'est pas disponible.",
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

// one database card row (with its track, or its artist) → the card shape the game draws
function cardFromRow(r, t) {
  if (r.kind === "artist") {
    return { kind: "artist", id: "a" + r.artist_id, aid: r.artist_id, t: t.name, a: "Artiste", al: "", cov: t.picture || "",
      rank: r.rank, albums: t.nb_album || 0, tier: r.tier, collector: !!r.collector, g: null };
  }
  return {
    id: r.track_id, t: t.title, a: t.artist, al: t.album, cov: t.cover, d: t.duration, rank: r.rank,
    bpm: t.bpm, y: t.year, x: t.explicit ? 1 : 0, g: t.genre, tier: r.tier,
  };
}
// the collection groups copies by track; each copy keeps its own id for trades
const cardKey = r => (r.kind === "artist" ? "a" + r.artist_id : r.track_id) + "#" + r.tier;   // a track in one rarity
function addCopy(map, r, t) {
  const k = cardKey(r);
  const c = map[k] || (map[k] = { ...cardFromRow(r, t), n: 0, holo: 0, locked: 0, copies: [], at: Date.parse(r.pulled_at) });
  c.n++; if (r.holo) c.holo++; if (!r.tradeable && !r.collector) c.locked++;
  if (r.collector) c.collector = true;
  c.copies.push({ id: r.id, tier: r.tier, holo: r.holo, tradeable: r.tradeable, collector: !!r.collector });
  return c;
}
async function fetchCards(owner, onlyTradeable) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from("cards").select("id,kind,track_id,artist_id,collector,tier,rank,holo,tradeable,pulled_at,tracks(title,artist,album,cover,duration,bpm,year,explicit,genre),artists(name,picture,fans,nb_album)")
      .eq("owner", owner).order("pulled_at").order("id").range(from, from + 999);   // id breaks ties: an import pulls thousands of cards at the same instant, and without it pages skipped or repeated cards
    if (onlyTradeable) q = q.eq("tradeable", true);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const map = {};
  for (const r of rows) { const t = r.kind === "artist" ? r.artists : r.tracks; if (t) addCopy(map, r, t); }
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
  const [{ data: settings }, cards] = await Promise.all([sb.from("settings").select("*").single(), fetchCards(me.id), loadWishAndTags()]);
  if (settings) TEST_MODE = settings.test_mode;
  S = { c: cards, opened: 0, dry: 0, stock: STOCK_MAX, stockAt: Date.now() };
  await loadProfile();
}
function refreshViews() {
  renderCounters(); renderStock(); renderAccount(); renderImport(); renderDiscard();
  if (!views.defis.hidden) renderDefis();
  if (!views.market.hidden) renderMarket();
  if (!views.albums.hidden) renderAlbums();
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
    $("#tab-trades").hidden = false; $("#tab-defis").hidden = false; $("#tab-market").hidden = false; $("#tab-albums").hidden = false; $("#tab-duels").hidden = false; $("#navCommunity").hidden = false;
    unseatTable();                       // closes the opening table and puts the booster back on its shelf
    refreshViews();
    pollOffers(); updateDefisBadge();
  } catch (e) {
    me = null; toast(message(e));
  }
}
function leaveAccount() {
  me = null; Online.active = false;
  WISH.clear(); TAGS.length = 0; CARD_TAGS.clear(); F.tag = null;
  $("#tagBar").hidden = true; $("#marketBadge").hidden = true;
  try { const p = JSON.parse(localStorage.getItem(LS)); S = p && p.c ? p : { c: {}, opened: 0, stock: STOCK_MAX, stockAt: Date.now(), dry: 0 }; }
  catch (e) { S = guestS; }
  TEST_MODE = true;
  $("#tab-trades").hidden = true; $("#tradeBadge").hidden = true;
  $("#tab-defis").hidden = true; $("#defisBadge").hidden = true; $("#tab-market").hidden = true; $("#tab-albums").hidden = true; $("#albumsBadge").hidden = true;
  $("#tab-duels").hidden = true; $("#duelsBadge").hidden = true; $("#navCommunity").hidden = true;
  if (!views.trades.hidden || !views.defis.hidden || !views.market.hidden || !views.albums.hidden || !views.duels.hidden) show("shop");
  unseatTable();
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
    const used = new Set(), usedArtists = new Set(), raws = [];
    for (const [i, tier] of pk.slots.entries()) {
      if (pk.artists?.[i]) {                     // an artist card: the server checks its fans on Deezer
        const a = await findArtist(tier, usedArtists);
        if (a) { usedArtists.add(a.id); raws.push({ id: a.id }); }
      } else {
        const t = await findTrack(p.g, tier, used);
        if (t) { used.add(t.id); raws.push(t); }
      }
    }
    if (raws.length < 5) throw { code: "short" };
    const res = await rpc("finish_pack", { p_pack: pk.id, p_tracks: raws.map(t => t.id) });
    const trackIds = res.filter(r => r.kind !== "artist").map(r => r.track);
    const artistIds = res.filter(r => r.kind === "artist").map(r => r.track);
    const [tq, aq] = await Promise.all([
      trackIds.length ? sb.from("tracks").select("*").in("id", trackIds) : { data: [] },
      artistIds.length ? sb.from("artists").select("id,name,picture,fans,nb_album").in("id", artistIds) : { data: [] },
    ]);
    if (tq.error || aq.error) throw tq.error || aq.error;
    const byTrack = Object.fromEntries(tq.data.map(t => [t.id, t])), byArtist = Object.fromEntries(aq.data.map(a => [a.id, a]));
    const pulls = res.map(r => {
      const artist = r.kind === "artist";
      const row = { id: r.card, kind: r.kind || "track", track_id: artist ? null : r.track, artist_id: artist ? r.track : null,
        tier: r.tier, rank: r.rank, holo: r.holo, tradeable: true, pulled_at: new Date().toISOString() };
      const meta = artist ? byArtist[r.track] : byTrack[r.track];
      addCopy(S.c, row, meta);
      return { c: cardFromRow(row, meta), holo: r.holo, isNew: r.new, wanted: r.wanted };
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
  modalExtras: c => { modalExtras(c); marketExtras(c); wishExtras(c); tagExtras(c); },
  tagsOf: c => tagsOf(c),
  renderTagBar: () => renderTagBar(),
  renderMarket: () => renderMarket(),
  renderAlbums: () => renderAlbums(),
  askSignIn: () => openAuth("in"),
});

/* ---------- header account area ---------- */
function renderAccount() {
  const box = $("#account");
  if (!me) {
    box.innerHTML = `<button class="btn primary" id="signIn">Se connecter</button>`;
    $("#signIn").onclick = () => openAuth("in");
  } else {
    box.innerHTML = `<button class="player" id="myAccount" aria-label="Mon compte"><span class="avatar" aria-hidden="true">${esc((me.pseudo || "?").slice(0, 1).toUpperCase())}</span><span class="who"><b>${esc(me.pseudo || "Mon compte")}</b>${me.title ? `<small>${esc(me.title)}</small>` : `<small>Joueur</small>`}</span></button>`;
    $("#myAccount").onclick = () => openAuth("account");
  }
}

/* ---------- sign-in / sign-up / password / account dialog ---------- */
const authModal = $("#authModal");
let authLastFocus = null;
// the sign-in forms render either in the dialog or on the welcome page
const AUTH_DIALOG = { title: $("#authTitle"), body: $("#authBody"), done: () => closeAuth() };
let AUTH = AUTH_DIALOG;
function openAuth(mode) {
  authLastFocus = document.activeElement;
  AUTH = AUTH_DIALOG;
  authModal.hidden = false;
  renderAuth(mode);
}
function closeAuth() {
  authModal.hidden = true; authLastFocus?.focus?.();
  if (!$("#landing").hidden) AUTH = { title: $("#landAuthTitle"), body: $("#landAuthBody"), done: () => {} };   // back to the welcome page's forms
}
$("#authClose").onclick = closeAuth;
authModal.addEventListener("click", e => { if (e.target === authModal) closeAuth(); });
addEventListener("keydown", e => { if (e.key === "Escape" && !authModal.hidden) closeAuth(); });

function field(id, label, type, extra = "") {
  return `<label class="field" for="${id}"><span>${label}</span><input id="${id}" type="${type}" ${extra}></label>`;
}
function renderAuth(mode, note = "") {
  const title = AUTH.title, body = AUTH.body;
  document.querySelectorAll(".land-tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.mode === mode));
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
      const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
      // when the server is slow, say so and keep waiting; give up only after 90 s
      const patience = setTimeout(() => say("Le serveur est lent en ce moment, la connexion peut prendre jusqu'à une minute. Ne recharge pas la page…"), 8000);
      const slow = new Promise(r => setTimeout(() => r({ error: { message: "timeout" } }), 90000));
      let error;
      try { ({ error } = await Promise.race([sb.auth.signInWithPassword({ email: $("#inEmail").value.trim(), password: $("#inPass").value }), slow])); }
      catch (err) { error = err; }
      clearTimeout(patience);
      btn.disabled = false;
      if (error?.message === "timeout") return say("Le serveur ne répond pas pour l'instant. Réessaie dans quelques minutes.");
      if (error) return say(/confirm/i.test(error.message) ? "Ton adresse n'est pas encore vérifiée : clique sur le lien reçu par e-mail."
        : /invalid/i.test(error.message) ? "E-mail ou mot de passe incorrect." : message(error));
      AUTH.done(); toast("Connecté.");
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
      AUTH.done(); toast("Mot de passe changé.");
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
  "offer_items(side,card_id,cards(kind,track_id,artist_id,collector,tier,rank,holo,tracks(title,artist,album,cover,duration,bpm,year,explicit,genre),artists(name,picture,fans,nb_album)))";
const ED = { player: null, theirs: null, give: new Map(), take: new Map(), qMine: "", qTheirs: "" };
let pollTimer = null;

async function pollOffers() {
  clearTimeout(pollTimer);
  if (!me) return;
  try {
    const { count } = await sb.from("offers").select("id", { count: "exact", head: true }).eq("to_user", me.id).eq("status", "pending");
    $("#tradeBadge").hidden = !count; $("#tradeBadge").textContent = count || "";
  } catch (e) {}
  checkNotifications();
  pollTimer = setTimeout(pollOffers, 30000);
}

function miniCard(c, holo) { const w = document.createElement("div"); w.className = "mini"; w.appendChild(cardEl(c, holo)); return w; }
function offerCards(o, side) {
  const wrap = document.createElement("div"); wrap.className = "mini-row";
  for (const it of o.offer_items.filter(i => i.side === side)) {
    if (!it.cards) continue;
    const meta = it.cards.kind === "artist" ? it.cards.artists : it.cards.tracks;
    if (!meta) continue;
    const c = cardFromRow(it.cards, meta);
    const m = miniCard(c, it.cards.holo); m.tabIndex = 0; m.setAttribute("role", "button");
    m.setAttribute("aria-label", c.t + " de " + c.a); m.onclick = () => openModal(c, it.cards.holo);
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

/* ---------- start: the welcome page for visitors, the game for players ---------- */
renderAccount();
sb.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY") { showGame(); openAuth("newpass"); }
  if (session?.user) { try { localStorage.removeItem(GUEST); } catch (e) {} showGame(); setTimeout(() => enterAccount(session.user), 0); }   // outside the auth callback, as supabase-js asks
  else if (event === "SIGNED_OUT") { leaveAccount(); showLanding(); }
  else if (event === "INITIAL_SESSION") { if (me) leaveAccount(); wantsGame() ? showGame() : showLanding(); }
});
setTimeout(() => { if (document.body.classList.contains("booting")) showGame(); }, 5000);   // if the account service is unreachable


/* ---------- Streams: discarding duplicates ---------- */
const DISCARD = [1, 1, 1, 10, 50, 100];   // same values as discard_value() on the server
// the copies "tout défausser" would remove: all but the best copy of each track (holo, then rarity)
function duplicateCopies() {
  const out = [];
  for (const c of Object.values(S.c)) {
    if (!c.copies || c.copies.length < 2) continue;
    const sorted = [...c.copies].sort((a, b) => (b.collector - a.collector) || (b.holo - a.holo) || (b.tier - a.tier));
    out.push(...sorted.slice(1).filter(cp => !cp.collector));
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
  const btn = $("#mDiscard"), own = S.c[ck(c)];
  const spares = own?.copies?.filter(cp => !cp.collector) || [];
  btn.hidden = !(Online.active && own?.copies && own.copies.length > 1 && spares.length && (spares.length > 1 || own.copies.length > spares.length));
  if (btn.hidden) return;
  const spare = [...spares].sort((a, b) => (a.holo - b.holo) || (a.tier - b.tier))[0];
  btn.textContent = `Défausser un doublon (+${DISCARD[spare.tier]} Stream${DISCARD[spare.tier] > 1 ? "s" : ""})`;
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const r = await rpc("discard_cards", { p_cards: [spare.id] });
      await loadAll(); refreshViews(); if (!views.binder.hidden) renderBinder(); updateDefisBadge();
      toast(`Doublon défaussé : +${r.gained} Stream${r.gained > 1 ? "s" : ""}.`);
      if (S.c[ck(c)]) openModal(S.c[ck(c)]);
    } catch (e) { toast(message(e)); }
    btn.disabled = false;
  };
}

/* ---------- Défis: login streak, daily challenges, achievements ---------- */
const MEDALS = ["Bronze", "Argent", "Or"];
// the badge only asks for the daily state (light); achievements are heavy with big collections, so they are
// computed when the Défis tab opens and their count is remembered here
let achReady = 0;
async function updateDefisBadge() {
  if (!me) return;
  try {
    const daily = await rpc("daily_state");
    const n = (daily.login.claimed ? 0 : 1)
      + daily.challenges.filter(c => !c.claimed && c.progress >= c.goal).length + achReady;
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
  try {
    [daily, ach] = await Promise.all([rpc("daily_state"), rpc("achievements_state")]);
    achReady = ach.filter(a => a.goals.some((g, i) => a.value >= g && !a.claimed.includes(i + 1))).length;
  }
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
const LISTING_SELECT = "id,seller,card_id,kind,track_id,artist_id,picture,tier,holo,title,artist,genre,price,created_at,expires_at," +
  "seller_p:profiles!listings_seller_fkey(pseudo,title),tracks(album,cover,duration,bpm,year,explicit),artists(nb_album),cards(rank,collector)";
const nowIso = () => new Date().toISOString();
function listingCard(l) {
  if (l.kind === "artist") return { kind: "artist", id: "a" + l.artist_id, aid: l.artist_id, t: l.title, a: "Artiste", al: "", cov: l.picture,
    rank: l.cards?.rank || 0, albums: l.artists?.nb_album || 0, tier: l.tier, g: null };
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
  renderWishList();
  rpc("notifications_read").then(() => { $("#marketBadge").hidden = true; }).catch(() => {});
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
  q = q.order("id");                      // same price or rarity: a stable order, so scrolling never skips or repeats a listing
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
  cardBtn.appendChild(cardEl(c, l.holo)); cardBtn.onclick = () => openModal(c, l.holo);
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
async function openSell(trackId) {           // trackId: the key of a card ("<id>#<tier>"), or null to pick one
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
        <p class="form-fine">${copy.holo && copy.tier >= MYTH ? "Tu vends ta copie Shiny. " : ""}${(S.c[ck(c)]?.copies?.length || 1) === 1 ? "C'est ton seul exemplaire de cette carte." : `Tu en gardes ${S.c[ck(c)].copies.length - 1}.`}</p>
      </div></div>`;
  $("#sellCard").appendChild(miniCard({ ...c, tier: copy.tier }, copy.holo));
  $("#sellClose").onclick = closeSell;
  const price = $("#sellPrice"), net = $("#sellNet");
  const showNet = () => { const p = Math.floor(+price.value || 0); net.textContent = p >= floor ? `Tu recevras ${streamsTxt(p - Math.floor(p * 5 / 100))} après la taxe de 5 %.` : `Le prix doit être d'au moins ${fmt(floor)}.`; };
  price.oninput = showNet;
  try {
    const st = await rpc("price_stats", isArtist(c) ? { p_artist: c.aid } : { p_track: c.id });
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
  const btn = $("#mSell"), own = S.c[ck(c)];
  btn.hidden = !(Online.active && own && own.copies?.some(cp => cp.tradeable));
  btn.onclick = () => { closeModal(); show("market"); openSell(ck(c)); };
  if (!Online.active) return;
  try {
    const st = await rpc("price_stats", isArtist(c) ? { p_artist: c.aid } : { p_track: c.id });
    if ($("#mTitle").textContent !== c.t) return;     // another card was opened meanwhile
    const dl = $("#mDl");
    dl.querySelector(".cote")?.remove();
    const wrap = document.createElement("div"); wrap.className = "cote"; wrap.style.display = "contents";
    wrap.innerHTML = `<dt>Cote</dt><dd>${st.sales ? `${streamsTxt(st.avg)} (moyenne de ${st.sales} vente${st.sales > 1 ? "s" : ""})` : "jamais vendue"}${st.lowest_listing ? ` · en vente dès ${streamsTxt(st.lowest_listing)}` : ""}</dd>`;
    dl.appendChild(wrap);
  } catch (e) {}
}


/* ---------- albums and discographies ---------- */
const AL = { list: [], shown: 60, q: "", filter: "progress", tab: "albums", discos: [], fetchingArtists: false };
let albumsBusy = false;

async function renderAlbums() {
  if (!me || albumsBusy) return;
  albumsBusy = true;
  $("#aStatus").textContent = "Chargement de tes albums…";
  try {
    AL.list = await rpc("my_albums");
    const pending = await sb.from("cards").select("id,tracks!inner(album_id)", { count: "exact", head: true })
      .eq("owner", me.id).is("tracks.album_id", null);
    const sync = $("#albumsSync");
    sync.hidden = !pending.count;
    if (pending.count) sync.innerHTML = `<p>On retrouve encore l'album de <b>${fmt(pending.count)}</b> de tes cartes : certains albums n'apparaissent pas encore. Repasse dans quelques minutes.</p>`;
  } catch (e) { $("#aStatus").textContent = message(e); albumsBusy = false; return; }
  albumsBusy = false;
  bindAlbumControls();
  drawAlbums();
  updateAlbumsBadge();
  if (AL.tab === "discos") renderDiscos();
}

function bindAlbumControls() {
  if (bindAlbumControls.done) return;
  bindAlbumControls.done = true;
  const tab = t => { AL.tab = t; $("#atAlbums").setAttribute("aria-pressed", t === "albums"); $("#atDiscos").setAttribute("aria-pressed", t === "discos");
    $("#albumsPane").hidden = t !== "albums"; $("#discosPane").hidden = t !== "discos"; if (t === "discos") renderDiscos(); };
  $("#atAlbums").onclick = () => tab("albums");
  $("#atDiscos").onclick = () => tab("discos");
  let t;
  $("#aq").oninput = () => { clearTimeout(t); t = setTimeout(() => { AL.q = $("#aq").value.trim().toLowerCase(); AL.shown = 60; drawAlbums(); }, 250); };
  $("#albumForm").onsubmit = e => { e.preventDefault(); AL.q = $("#aq").value.trim().toLowerCase(); drawAlbums(); };
  $("#aFilter").onchange = () => { AL.filter = $("#aFilter").value; AL.shown = 60; drawAlbums(); };
  $("#aMore").onclick = () => { AL.shown += 60; drawAlbums(); };
}

const albumReady = a => !a.claimed && a.complete && a.total > 0 && a.owned >= a.total;
function drawAlbums() {
  let list = AL.list.filter(a => !AL.q || (a.title + " " + a.artist).toLowerCase().includes(AL.q));
  if (AL.filter === "progress") list = list.filter(a => !a.claimed);
  if (AL.filter === "ready") list = list.filter(albumReady);
  if (AL.filter === "claimed") list = list.filter(a => a.claimed);
  list.sort((a, b) => (albumReady(b) - albumReady(a)) || (b.pct - a.pct) || (a.total - a.owned) - (b.total - b.owned));
  const done = AL.list.filter(a => a.claimed).length, ready = AL.list.filter(albumReady).length;
  $("#aStatus").textContent = `${fmt(AL.list.length)} album${AL.list.length > 1 ? "s" : ""} commencé${AL.list.length > 1 ? "s" : ""} · ${fmt(done)} complété${done > 1 ? "s" : ""}${ready ? ` · ${ready} prêt${ready > 1 ? "s" : ""} à récupérer` : ""}`;
  const box = $("#albumList"); box.innerHTML = "";
  if (!list.length) box.innerHTML = `<p class="empty-line">${AL.list.length ? "Aucun album ne correspond." : "Ouvre des boosters : chaque carte commence un album."}</p>`;
  for (const a of list.slice(0, AL.shown)) box.appendChild(albumRow(a));
  $("#aMore").hidden = list.length <= AL.shown;
}

function albumRow(a) {
  const el = document.createElement("article");
  el.className = "album" + (a.claimed ? " claimed" : albumReady(a) ? " ready" : "");
  el.innerHTML = `<button class="al-cover" aria-label="Voir les titres de ${esc(a.title)}">${a.cover ? `<img src="${esc(a.cover.replace(/\/\d+x\d+-/, "/250x250-"))}" alt="" loading="lazy">` : ""}${a.claimed ? `<span class="gold" aria-hidden="true">★</span>` : ""}</button>
    <div class="al-info"><b>${esc(a.title)}</b><small>${esc(a.artist)}${a.year ? " · " + a.year : ""}${a.type === "ep" ? " · EP" : ""}</small>
      <div class="meter"><s style="width:${a.pct}%"></s></div>
      <div class="d-foot"><small>${a.owned} / ${a.total} titres${a.complete ? "" : " (liste en chargement)"}</small>
        ${a.claimed ? `<small class="ok">Complété</small>` : albumReady(a) ? `<button class="btn primary">Récupérer +${a.reward}</button>` : `<small>+${a.reward}</small>`}</div></div>`;
  el.querySelector(".al-cover").onclick = () => openAlbum(a);
  const b = el.querySelector(".d-foot .btn");
  if (b) b.onclick = () => claimAlbum(a, b);
  return el;
}

async function claimAlbum(a, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await rpc("claim_album", { p_album: a.id });
    await loadProfile(); renderCounters();
    toast(`Album « ${a.title} » complété : +${r} Streams !`);
    closeAlbum(); renderAlbums(); updateDefisBadge();
  } catch (e) { toast(message(e)); if (btn) btn.disabled = false; }
}

/* album details: the tracklist, owned or missing */
const albumModal = $("#albumModal");
function closeAlbum() { albumModal.hidden = true; }
$("#alClose").onclick = closeAlbum;
albumModal.addEventListener("click", e => { if (e.target === albumModal) closeAlbum(); });
addEventListener("keydown", e => { if (e.key === "Escape" && !albumModal.hidden) closeAlbum(); });
async function openAlbum(a) {
  albumModal.hidden = false;
  $("#alHead").innerHTML = `${a.cover ? `<img src="${esc(a.cover)}" alt="">` : ""}<div><h3 id="alTitle">${esc(a.title)}</h3><p>${esc(a.artist)}${a.year ? " · " + a.year : ""}</p>
    <p class="al-count">${a.owned} / ${a.total} titres · ${a.claimed ? "complété" : "+" + a.reward + " Streams une fois complet"}</p></div>`;
  $("#alTracks").innerHTML = `<li class="empty-line">Chargement des titres…</li>`;
  $("#alBtns").innerHTML = "";
  if (!a.complete) { try { await rpc("ensure_album", { p_album: a.id }); } catch (e) {} }
  const { data } = await sb.from("albums").select("tracks").eq("id", a.id).single();
  const tracks = data?.tracks || [];
  $("#alTracks").innerHTML = tracks.length ? "" : `<li class="empty-line">La liste des titres n'est pas encore disponible. Réessaie dans quelques minutes.</li>`;
  for (const t of tracks) {
    const own = bestOwned(t.id);
    const li = document.createElement("li"); li.className = own ? "own" : "missing";
    li.innerHTML = `<span class="mark" aria-hidden="true">${own ? "✓" : ""}</span><span class="t">${esc(t.title)}</span>
      <span class="rar"><i style="background:${RCOL[tierOf(t.rank || 0)]}"></i>${RAR[tierOf(t.rank || 0)]}</span>
      ${own ? `<button class="linkish">Voir</button>` : `<button class="linkish">Chercher au marché</button><button class="wish-heart" aria-pressed="${WISH.has("track:" + t.id)}" aria-label="Liste de souhaits : ${esc(t.title)}">${WISH.has("track:" + t.id) ? "♥" : "♡"}</button>`}`;
    li.querySelector("button").onclick = () => {
      if (own) { closeAlbum(); openModal(own); }
      else { closeAlbum(); show("market"); $("#mq").value = t.title; MK.q = t.title; loadMarket(true); }
    };
    li.querySelector(".mark").setAttribute("aria-label", own ? "possédé" : "manquant");
    const heart = li.querySelector(".wish-heart");
    if (heart) heart.onclick = async () => {
      heart.disabled = true;
      try {
        const added = await rpc("wish_toggle", { p_kind: "track", p_ref: t.id, p_title: t.title, p_artist: a.artist, p_cover: a.cover || "" });
        if (added) WISH.set("track:" + t.id, { kind: "track", ref: t.id, title: t.title, artist: a.artist, cover: a.cover || "" }); else WISH.delete("track:" + t.id);
        heart.textContent = added ? "♥" : "♡"; heart.setAttribute("aria-pressed", added);
        toast(added ? `« ${t.title} » ajoutée à ta liste de souhaits.` : `« ${t.title} » retirée de ta liste de souhaits.`);
      } catch (e) { toast(message(e)); }
      heart.disabled = false;
    };
    $("#alTracks").appendChild(li);
  }
  if (albumReady(a)) {
    const b = document.createElement("button"); b.className = "btn primary"; b.textContent = `Récupérer +${a.reward} Streams`;
    b.onclick = () => claimAlbum(a, b); $("#alBtns").appendChild(b);
  }
}

async function updateAlbumsBadge() {
  const n = AL.list.filter(albumReady).length + AL.discos.filter(d => !d.claimed && d.total > 0 && d.done >= d.total).length;
  $("#albumsBadge").hidden = !n; $("#albumsBadge").textContent = n || "";
}

/* discographies: artists you own 5+ tracks of, or completed an album of */
async function renderDiscos() {
  $("#dStatus").textContent = "Chargement des discographies…";
  try { AL.discos = await rpc("my_discographies"); } catch (e) { $("#dStatus").textContent = message(e); return; }
  drawDiscos();
  // fetch a few more artists in the background, then refresh
  if (AL.fetchingArtists) return;
  AL.fetchingArtists = true;
  try {
    const missing = (await rpc("my_missing_artists")).slice(0, 8);
    for (const id of missing) { try { await rpc("ensure_artist", { p_artist: id }); } catch (e) {} }
    // studio albums never seen in any booster: fetch their title and cover
    const unknown = AL.discos.flatMap(d => d.albums.filter(x => x.title === "…").map(x => x.id)).slice(0, 15);
    for (const id of unknown) { try { await rpc("ensure_album", { p_album: id }); } catch (e) {} }
    if (missing.length || unknown.length) { AL.discos = await rpc("my_discographies"); drawDiscos(); }
  } catch (e) {}
  AL.fetchingArtists = false;
}
function drawDiscos() {
  const list = AL.discos.filter(d => d.total > 0);
  const done = list.filter(d => d.claimed).length;
  $("#dStatus").textContent = list.length
    ? `${fmt(list.length)} artiste${list.length > 1 ? "s" : ""} suivi${list.length > 1 ? "s" : ""} · ${done} discographie${done > 1 ? "s" : ""} complète${done > 1 ? "s" : ""}`
    : "Une discographie apparaît dès que tu as 5 titres d'un même artiste, ou un de ses albums complet.";
  const box = $("#discoList"); box.innerHTML = "";
  for (const d of list) {
    const ready = !d.claimed && d.done >= d.total;
    const el = document.createElement("article"); el.className = "disco" + (d.claimed ? " claimed" : ready ? " ready" : "");
    el.innerHTML = `<div class="dh">${d.picture ? `<img src="${esc(d.picture.replace(/\/\d+x\d+-/, "/250x250-"))}" alt="" loading="lazy">` : `<span class="ph-artist" aria-hidden="true">${esc(initials(d.name))}</span>`}
        <div><b>${esc(d.name)}</b><small>${fmt(d.fans)} fans Deezer</small>
        <div class="meter"><s style="width:${d.done / d.total * 100}%"></s></div>
        <div class="d-foot"><small>${d.done} / ${d.total} albums studio</small>
          ${d.claimed ? `<small class="ok">Discographie complète</small>` : ready ? `<button class="btn primary">Récupérer +${d.reward}</button>` : `<small>+${d.reward}</small>`}</div></div></div>
      <div class="covers">${d.albums.map(x => `<span class="${x.claimed ? "on" : ""}" title="${esc(x.title)}${x.claimed ? " · complété" : ""}">${x.cover ? `<img src="${esc(x.cover.replace(/\/\d+x\d+-/, "/120x120-"))}" alt="${esc(x.title)}" loading="lazy">` : `<em>${esc(x.title)}</em>`}</span>`).join("")}</div>`;
    const b = el.querySelector(".btn");
    if (b) b.onclick = async () => {
      b.disabled = true;
      try { const r = await rpc("claim_discography", { p_artist: d.id }); await loadProfile(); renderCounters(); toast(`Discographie de ${d.name} complète : +${r} Streams !`); renderDiscos(); updateDefisBadge(); }
      catch (e) { toast(message(e)); b.disabled = false; }
    };
    box.appendChild(el);
  }
}


/* ---------- wishlist + tags ---------- */
const WISH = new Map();          // "track:123" / "artist:27" → wishlist row
const TAGS = [];                 // your tags {id, name, color}
const CARD_TAGS = new Map();     // "track:123" → Set of tag ids
const keyParts = c => isArtist(c) ? ["artist", c.aid] : ["track", c.id];
const wishKey = c => keyParts(c).join(":");
const TAG_COLORS = ["#e7b14a", "#ff4d6a", "#4f9cff", "#5fc48a", "#b071ff", "#4fb8b0", "#f08a24", "#e6eef8"];
let seenNotes = new Set();

async function loadWishAndTags() {
  const [w, t, ct] = await Promise.all([
    sb.from("wishlist").select("*").order("created_at", { ascending: false }),
    sb.from("tags").select("id,name,color").order("created_at"),
    sb.from("card_tags").select("tag_id,kind,ref").range(0, 49999),
  ]);
  WISH.clear(); for (const r of w.data || []) WISH.set(r.kind + ":" + r.ref, r);
  TAGS.length = 0; TAGS.push(...(t.data || []));
  CARD_TAGS.clear(); for (const r of ct.data || []) { const k = r.kind + ":" + r.ref; if (!CARD_TAGS.has(k)) CARD_TAGS.set(k, new Set()); CARD_TAGS.get(k).add(r.tag_id); }
}
function tagsOf(c) { const set = CARD_TAGS.get(wishKey(c)); return set ? TAGS.filter(t => set.has(t.id)) : []; }

/* the ♡ button in a card's details (for cards you don't own) */
function wishExtras(c) {
  const btn = $("#mWish");
  const owned = ownsTrack(c.id);
  btn.hidden = !Online.active || owned || c.collector;
  if (btn.hidden) return;
  const on = WISH.has(wishKey(c));
  btn.textContent = on ? "♥ Dans ta liste de souhaits" : "♡ Ajouter à ma liste de souhaits";
  btn.setAttribute("aria-pressed", on);
  btn.classList.toggle("wished", on);
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const [kind, ref] = keyParts(c);
      const added = await rpc("wish_toggle", { p_kind: kind, p_ref: ref, p_title: c.t, p_artist: isArtist(c) ? "Artiste" : c.a, p_cover: c.cov || "" });
      if (added) WISH.set(kind + ":" + ref, { kind, ref, title: c.t, artist: isArtist(c) ? "Artiste" : c.a, cover: c.cov || "" });
      else WISH.delete(kind + ":" + ref);
      toast(added ? `« ${c.t} » ajoutée à ta liste de souhaits. Tu seras prévenu si elle arrive au marché.` : `« ${c.t} » retirée de ta liste de souhaits.`);
      wishExtras(c);
      if (!views.market.hidden) renderWishList();
    } catch (e) { toast(message(e)); }
    btn.disabled = false;
  };
}

/* tags in a card's details (for cards you own) */
function tagExtras(c) {
  const box = $("#mTags");
  box.hidden = !Online.active || !ownsTrack(c.id);
  if (box.hidden) return;
  const mine = new Set(tagsOf(c).map(t => t.id));
  box.innerHTML = `<b>Étiquettes</b><div class="chips">${TAGS.map(t => `<button class="chip tagchip" data-id="${t.id}" aria-pressed="${mine.has(t.id)}" style="--tc:${t.color}"><i></i>${esc(t.name)}</button>`).join("")}
    <form class="newtag" id="newTag"><label class="sr" for="newTagName">Nouvelle étiquette</label><input id="newTagName" maxlength="24" placeholder="+ Nouvelle étiquette" autocomplete="off"></form></div>`;
  box.querySelectorAll(".tagchip").forEach(b => b.onclick = async () => {
    b.disabled = true;
    try {
      const [kind, ref] = keyParts(c), k = kind + ":" + ref;
      const on = await rpc("tag_toggle", { p_tag: b.dataset.id, p_kind: kind, p_ref: ref });
      if (!CARD_TAGS.has(k)) CARD_TAGS.set(k, new Set());
      on ? CARD_TAGS.get(k).add(b.dataset.id) : CARD_TAGS.get(k).delete(b.dataset.id);
      tagExtras(c); if (!views.binder.hidden) renderBinder();
    } catch (e) { toast(message(e)); b.disabled = false; }
  });
  $("#newTag").onsubmit = async e => {
    e.preventDefault();
    const name = $("#newTagName").value.trim(); if (!name) return;
    try {
      const color = TAG_COLORS[TAGS.length % TAG_COLORS.length];
      const id = await rpc("tag_create", { p_name: name, p_color: color });
      TAGS.push({ id, name, color });
      const [kind, ref] = keyParts(c), k = kind + ":" + ref;
      await rpc("tag_toggle", { p_tag: id, p_kind: kind, p_ref: ref });
      if (!CARD_TAGS.has(k)) CARD_TAGS.set(k, new Set()); CARD_TAGS.get(k).add(id);
      toast(`Étiquette « ${name} » créée et posée sur la carte.`);
      tagExtras(c); if (!views.binder.hidden) renderBinder();
      $("#newTagName")?.focus();
    } catch (e2) { toast(message(e2)); }
  };
}

/* the tag filter above the collection */
function renderTagBar() {
  const bar = $("#tagBar");
  bar.hidden = !Online.active || !TAGS.length;
  if (bar.hidden) return;
  const count = id => [...CARD_TAGS.entries()].filter(([k, set]) => set.has(id) && ownsTrack(k.startsWith("artist:") ? "a" + k.slice(7) : +k.slice(6))).length;
  bar.innerHTML = `<span class="tb-label">Étiquettes</span>` +
    `<button class="chip" data-id="" aria-pressed="${!F.tag}">Toutes</button>` +
    TAGS.map(t => `<button class="chip tagchip" data-id="${t.id}" aria-pressed="${F.tag === t.id}" style="--tc:${t.color}"><i></i>${esc(t.name)} <small>${count(t.id)}</small></button>`).join("") +
    (F.tag ? `<button class="linkish" id="tagDelete">Supprimer « ${esc(TAGS.find(t => t.id === F.tag)?.name || "")} »</button>` : "");
  bar.querySelectorAll(".chip").forEach(b => b.onclick = () => { F.tag = b.dataset.id || null; renderBinder(); });
  const del = $("#tagDelete");
  if (del) del.onclick = async () => {
    const t = TAGS.find(x => x.id === F.tag);
    // the confirmation is the second click
    if (del.dataset.armed !== "1") { del.dataset.armed = "1"; del.textContent = `Confirmer la suppression de « ${t.name} » (les cartes restent)`; return; }
    try {
      await rpc("tag_delete", { p_tag: t.id });
      TAGS.splice(TAGS.indexOf(t), 1); for (const set of CARD_TAGS.values()) set.delete(t.id);
      F.tag = null; toast(`Étiquette « ${t.name} » supprimée.`); renderBinder();
    } catch (e) { toast(message(e)); }
  };
}

/* the wishlist, in the market tab: is each card on sale, and from what price */
async function renderWishList() {
  const box = $("#wishList");
  if (!me) return;
  if (!WISH.size) { box.innerHTML = `<p class="empty-line">Ta liste de souhaits est vide.</p>`; return; }
  const rows = [...WISH.values()];
  const tracks = rows.filter(r => r.kind === "track").map(r => r.ref), artists = rows.filter(r => r.kind === "artist").map(r => r.ref);
  const [lt, la] = await Promise.all([
    tracks.length ? sb.from("listings").select("track_id,price").eq("status", "active").gt("expires_at", nowIso()).in("track_id", tracks) : { data: [] },
    artists.length ? sb.from("listings").select("artist_id,price").eq("status", "active").eq("kind", "artist").gt("expires_at", nowIso()).in("artist_id", artists) : { data: [] },
  ]);
  const best = new Map();
  for (const l of lt.data || []) { const k = "track:" + l.track_id; best.set(k, Math.min(best.get(k) ?? Infinity, l.price)); }
  for (const l of la.data || []) { const k = "artist:" + l.artist_id; best.set(k, Math.min(best.get(k) ?? Infinity, l.price)); }
  rows.sort((a, b) => (best.has(b.kind + ":" + b.ref) - best.has(a.kind + ":" + a.ref)));
  box.innerHTML = "";
  for (const r of rows) {
    const k = r.kind + ":" + r.ref, price = best.get(k);
    const el = document.createElement("div"); el.className = "wish" + (price ? " onsale" : "");
    el.innerHTML = `${r.cover ? `<img src="${esc(r.cover.replace(/\/\d+x\d+-/, "/120x120-"))}" alt="" loading="lazy">` : `<span class="ph"></span>`}
      <div class="w-info"><b>${esc(r.title)}</b><small>${esc(r.artist)}</small></div>
      <div class="w-side">${price ? `<span class="w-price">En vente dès ${streamsTxt(price)}</span><button class="btn primary">Voir</button>` : `<small>Pas en vente</small>`}
        <button class="linkish w-remove" aria-label="Retirer ${esc(r.title)} de la liste">Retirer</button></div>`;
    const see = el.querySelector(".btn");
    if (see) see.onclick = () => { $("#mq").value = r.title; MK.q = r.title; MK.tier = -1; renderMarketFilters(); loadMarket(true); $("#marketGrid").scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth" }); };
    el.querySelector(".w-remove").onclick = async () => {
      try { await rpc("wish_toggle", { p_kind: r.kind, p_ref: r.ref, p_title: r.title }); WISH.delete(k); renderWishList(); }
      catch (e) { toast(message(e)); }
    };
    box.appendChild(el);
  }
}

/* alerts: a wished card was just put on the market */
async function checkNotifications() {
  if (!me) return;
  const { data } = await sb.from("notifications").select("id,type,title,price,created_at").eq("read", false).order("created_at", { ascending: false }).limit(20);
  const wishes = (data || []).filter(x => x.type === "wish_listed").length;
  $("#marketBadge").hidden = !wishes; $("#marketBadge").textContent = wishes || "";
  for (const x of data || []) {
    if (seenNotes.has(x.id)) continue;
    seenNotes.add(x.id);
    if (x.type === "wish_listed") toast(`♥ « ${x.title} », de ta liste de souhaits, est en vente pour ${streamsTxt(x.price)} !`);
    else if (x.type === "duel_challenge") toast(`⚔️ ${x.title} te lance un clash blind test ! Va dans l'onglet Clashs.`);
    else if (x.type === "duel_result") toast(`⚔️ ${x.title} a joué votre clash : le résultat est dans l'onglet Clashs.`);
    else if (x.type === "duel_declined") toast(`${x.title} a refusé ton clash.`);
    else if (x.type === "prank") showPrank(x);
  }
  if ((data || []).some(x => x.type.startsWith("duel"))) Online.updateDuelsBadge?.();
}

// a joke from a friend: a very serious "account blocked" screen that takes the whole page for one minute, then
// says it was a joke (shown once: the notification is marked read at the end)
function showPrank(x) {
  const el = document.createElement("div");
  el.setAttribute("role", "alertdialog"); el.setAttribute("aria-modal", "true"); el.tabIndex = -1;
  el.style.cssText = "position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:24px;background:rgba(8,4,6,.94);backdrop-filter:blur(8px);color:#f3e9ea;font-family:var(--body);cursor:not-allowed";
  el.innerHTML = `<div style="max-width:480px;text-align:center">
      <div style="width:76px;height:76px;margin:0 auto 22px;border-radius:50%;display:grid;place-items:center;background:#3a0f16;box-shadow:0 0 0 2px #c8323f,0 0 40px rgba(200,50,63,.45)">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#ff6b78" stroke-width="2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></div>
      <h2 style="margin:0 0 12px;font-family:var(--display);font-size:1.6rem;color:#ff6b78">Compte bloqué</h2>
      <p style="margin:0 0 8px;line-height:1.55">Une activité anormale a été détectée sur ton compte (ouverture massive de boosters). Par sécurité, ton compte et ta collection sont <b>gelés</b> le temps d'une vérification.</p>
      <p style="margin:0 0 22px;color:#b9a7aa;font-size:.88rem">Ne ferme pas cette page. Référence du dossier : ZH-${String(x.id).padStart(6, "0")}</p>
      <div style="height:6px;border-radius:3px;background:#2a1418;overflow:hidden"><s style="display:block;height:100%;width:0;background:#c8323f;transition:width 60s linear"></s></div>
      <p class="pk-t" style="margin:10px 0 0;font-family:var(--mono);font-size:.8rem;color:#b9a7aa">Vérification en cours… 60 s</p></div>`;
  const stop = e => { e.preventDefault(); e.stopPropagation(); };
  const keys = e => { if (document.body.contains(el)) stop(e); };
  addEventListener("keydown", keys, true);
  el.addEventListener("click", stop); el.addEventListener("contextmenu", stop);
  document.body.appendChild(el); el.focus();
  requestAnimationFrame(() => { el.querySelector("s").style.width = "100%"; });
  let left = 60;
  const t = setInterval(() => {
    left--; el.querySelector(".pk-t").textContent = `Vérification en cours… ${left} s`;
    if (left > 0) return;
    clearInterval(t); removeEventListener("keydown", keys, true); el.style.cursor = "default";
    el.firstElementChild.innerHTML = `<div style="font-size:3rem;margin-bottom:10px">😄</div>
      <h2 style="margin:0 0 12px;font-family:var(--display);font-size:1.6rem;color:#ffe2a0">C'était une blague !</h2>
      <p style="margin:0 0 22px;line-height:1.55">Ton compte va très bien, ta collection aussi. Bisous de la part de ${esc(x.title)}.</p>
      <button class="btn primary">Reprendre la partie</button>`;
    el.querySelector("button").onclick = () => el.remove();
    rpc("notification_seen", { p_id: x.id }).catch(() => {});
  }, 1000);
}

/* ---------- welcome page ---------- */
const GUEST = "zh-guest";
const wantsGame = () => {
  try { if (localStorage.getItem(GUEST) === "1") return true; } catch (e) {}
  return /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /^#(god|demo|shiny|galerie|platine|diamant|platine-shiny|diamant-shiny)$/.test(location.hash);   // local previews
};
function showGame() {
  document.body.classList.remove("booting", "landing-on");
  $("#landing").hidden = true;
}
function showLanding() {
  document.body.classList.remove("booting");
  document.body.classList.add("landing-on");
  $("#landing").hidden = false;
  AUTH = { title: $("#landAuthTitle"), body: $("#landAuthBody"), done: () => {} };
  landTab("in");
  buildWall();
}
function landTab(mode) {
  AUTH = { title: $("#landAuthTitle"), body: $("#landAuthBody"), done: () => {} };
  document.querySelectorAll(".land-tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.mode === mode));
  renderAuth(mode);
}
document.querySelectorAll(".land-tabs button").forEach(b => b.onclick = () => landTab(b.dataset.mode));
$("#landGuest").onclick = () => { try { localStorage.setItem(GUEST, "1"); } catch (e) {} showGame(); };
$("#landPrivacy").onclick = () => openAuth("privacy");

// the wall: real cards drifting in three columns
let wallBuilt = false;
async function buildWall() {
  if (wallBuilt) return;
  wallBuilt = true;
  const cols = [...document.querySelectorAll(".wall-col")];
  const fill = (col, nodes) => {
    const track = document.createElement("div"); track.className = "wall-track";
    for (const n of nodes) track.appendChild(n);
    for (const n of nodes) { const copy = n.cloneNode(true); copy.setAttribute("aria-hidden", "true"); track.appendChild(copy); }   // twice, for a seamless loop
    col.innerHTML = ""; col.appendChild(track);
  };
  cols.forEach(col => fill(col, Array.from({ length: 5 }, () => { const w = document.createElement("div"); w.className = "wall-card"; w.appendChild(backEl()); return w; })));
  try {
    const picked = [], seen = new Set();
    for (const g of [0, 1, 3, 2, 7, 4, 5, 8]) {
      const pool = (await genrePool(g, 0).catch(() => [])).filter(t => t.album?.cover_big && !seen.has(t.id));
      pool.sort(() => Math.random() - .5);
      for (const t of pool.slice(0, 4)) {
        seen.add(t.id);
        picked.push({ id: t.id, t: t.title_short || t.title, a: t.artist?.name || "?", al: t.album?.title || "", cov: t.album.cover_big.replace("http:", "https:"),
          d: t.duration || 0, rank: t.rank || 0, bpm: 0, y: 0, x: t.explicit_lyrics ? 1 : 0, g, tier: tierOf(t.rank || 0) });
      }
    }
    const artists = await Promise.all([246791, 27, 13].map(id => dz("artist/" + id).catch(() => null)));
    const artistCards = artists.filter(a => a && a.id).map((a, i) => ({ kind: "artist", id: "a" + a.id, aid: a.id, t: a.name, a: "Artiste",
      cov: (a.picture_big || "").replace("http:", "https:"), rank: a.nb_fan, albums: a.nb_album || 0, tier: certOf(a.nb_fan, a.id), collector: i === 2 }));
    const best = picked.filter(c => c.tier >= MYTH);
    const shinyId = best[0]?.id;
    const all = [...picked.sort(() => Math.random() - .5)];
    artistCards.forEach((c, i) => all.splice(4 + i * 7, 0, c));
    const nodes = all.map(c => { const w = document.createElement("div"); w.className = "wall-card"; w.appendChild(cardEl(c, c.id === shinyId || (isArtist(c) && c.tier >= MYTH && !c.collector && c.aid === 246791))); return w; });
    cols.forEach((col, i) => fill(col, nodes.filter((_, k) => k % cols.length === i)));
  } catch (e) { /* the card backs keep drifting */ }
}
