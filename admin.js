"use strict";
/* Zik Hunter — the admin page (accounts in the admins table), and the player's side of it: a heartbeat that counts
   who is really playing, the ban screen, and the warnings and messages sent by the team. The server checks every
   admin action; this file only shows them. */

const ADM = { admin: false, q: "", filter: "all", users: [], sel: null, timer: 0, built: false };

/* ---------- presence: "really active" = the page is visible and was touched in the last 2 minutes ---------- */
let lastInput = Date.now();
for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true });
const reallyActive = () => document.visibilityState === "visible" && Date.now() - lastInput < 120000;

async function beat() {
  if (!me) return;
  let r;
  try { r = await rpc("heartbeat", { p_active: reallyActive() }); } catch (e) { return; }
  if (!r || !me) return;
  ADM.admin = !!r.admin;
  $("#tab-admin").hidden = !ADM.admin;
  if (r.ban) showBan(r.ban); else $("#banScreen")?.remove();
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") beat(); });

function adminOff() {
  ADM.admin = false; ADM.sel = null; clearInterval(ADM.timer);
  $("#tab-admin").hidden = true; $("#banScreen")?.remove();
  if (!views.admin.hidden) show("shop");
}

const dateFr = t => new Date(t).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
function ago(t) {
  if (!t) return "jamais";
  const s = Math.max(0, (Date.now() - Date.parse(t)) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86400)} j`;
}

/* ---------- the player's side: suspended account, warnings, messages ---------- */
function showBan(b) {
  let el = $("#banScreen");
  if (!el) {
    el = document.createElement("div"); el.id = "banScreen"; el.className = "adm-screen";
    el.setAttribute("role", "alertdialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "banTitle");
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="adm-box ban">
      <div class="adm-ico" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></div>
      <h2 id="banTitle">Compte suspendu</h2>
      <p>${b.until ? `Ton compte est suspendu jusqu'au <b>${esc(dateFr(b.until))}</b>.` : "Ton compte est suspendu <b>définitivement</b>."}</p>
      ${b.reason ? `<p class="adm-why">Raison : ${esc(b.reason)}</p>` : ""}
      <p class="adm-small">Tant que la suspension dure, tu ne peux plus ouvrir de boosters, échanger, vendre ni jouer de clash.</p>
      <button class="btn" id="banOut">Se déconnecter</button></div>`;
  $("#banOut").onclick = () => sb.auth.signOut();
}

// admin_warning (to one player) and admin_message (to everyone): a dialog, marked read once closed
function showNotice(x) {
  const warn = x.type === "admin_warning";
  const el = document.createElement("div"); el.className = "adm-screen";
  el.setAttribute("role", "alertdialog"); el.setAttribute("aria-modal", "true");
  el.innerHTML = `<div class="adm-box${warn ? " warn" : ""}">
      <p class="adm-kicker">${warn ? "Avertissement" : "Message de l'équipe Zik Hunter"}</p>
      <h2>${warn ? "Tu as reçu un avertissement" : "Message à tous les joueurs"}</h2>
      <p class="adm-msg">${esc(x.title)}</p>
      ${warn ? `<p class="adm-small">En cas de récidive, ton compte peut être suspendu.</p>` : ""}
      <button class="btn primary">J'ai compris</button></div>`;
  const b = el.querySelector("button");
  b.onclick = () => { el.remove(); rpc("notification_seen", { p_id: x.id }).catch(() => {}); };
  document.body.appendChild(el); b.focus();
}

/* ---------- the admin page ---------- */
function buildAdmin() {
  if (ADM.built) return;
  ADM.built = true;
  views.admin.innerHTML = `<h2>Admin</h2>
    <p class="sub">Mis à jour toutes les 15 secondes. « En ligne » = a touché au jeu dans les 2 dernières minutes, page visible.</p>
    <div class="adm-stats" id="admStats"></div>
    <div class="adm-grid">
      <div class="adm-panel" role="region" aria-labelledby="admPlayersT">
        <h3 id="admPlayersT">Joueurs</h3>
        <form class="adm-search" id="admSearch" role="search">
          <input type="search" id="admQ" placeholder="Pseudo ou e-mail" aria-label="Chercher un joueur" autocomplete="off">
          <select id="admFilter" aria-label="Filtrer">
            <option value="all">Tous</option><option value="online">En ligne</option><option value="active24">Actifs 24 h</option>
            <option value="new">Nouveaux (7 j)</option><option value="banned">Bannis</option><option value="admins">Admins</option>
          </select>
        </form>
        <div class="adm-users" id="admUsers"><p class="empty-line">Chargement…</p></div>
      </div>
      <div class="adm-panel" id="admDetail" aria-live="polite"><p class="empty-line">Choisis un joueur pour voir sa fiche et agir.</p></div>
    </div>
    <div class="adm-grid">
      <div class="adm-panel" role="region" aria-labelledby="admBcT">
        <h3 id="admBcT">Message à tous les joueurs</h3>
        <p class="adm-small">Chaque joueur le verra une fois, dans une fenêtre, à sa prochaine connexion (ou dans les 30 secondes s'il joue).</p>
        <textarea id="admBc" maxlength="500" rows="3" placeholder="Ex. : maintenance ce soir à 22 h, le jeu sera coupé 10 minutes."></textarea>
        <div class="adm-row"><button class="btn primary" id="admBcSend">Envoyer à tout le monde</button></div>
        <h3 class="adm-sep">Annonces Discord</h3>
        <p class="adm-small">GOD packs, Légendaires, Shiny et artistes Platine ou Diamant sont annoncés dans un salon Discord. Colle l'adresse du webhook du salon (Discord → paramètres du salon → Intégrations → Webhooks → Copier l'URL du webhook).</p>
        <p class="adm-small" id="admDcState">…</p>
        <form class="adm-row" id="admDc"><input type="url" id="admDcUrl" placeholder="https://discord.com/api/webhooks/…" aria-label="Adresse du webhook Discord" autocomplete="off">
          <button class="btn">Enregistrer</button></form>
        <div class="adm-row"><button class="btn" id="admDcTest">Envoyer un test</button><button class="btn" id="admDcToggle"></button></div>
      </div>
      <div class="adm-panel" role="region" aria-labelledby="admLogT">
        <h3 id="admLogT">Journal des actions</h3>
        <ol class="adm-log" id="admLog"></ol>
      </div>
    </div>`;
  let t;
  $("#admQ").oninput = () => { clearTimeout(t); t = setTimeout(() => { ADM.q = $("#admQ").value.trim(); loadUsers(); }, 300); };
  $("#admSearch").onsubmit = e => { e.preventDefault(); ADM.q = $("#admQ").value.trim(); loadUsers(); };
  $("#admFilter").onchange = () => { ADM.filter = $("#admFilter").value; loadUsers(); };
  $("#admBcSend").onclick = async () => {
    const m = $("#admBc").value.trim();
    if (!m) return toast("Écris un message d'abord.");
    if (!confirm(`Envoyer ce message à tous les joueurs ?\n\n${m}`)) return;
    try { const n = await rpc("admin_broadcast", { p_message: m }); $("#admBc").value = ""; toast(`Message envoyé à ${fmt(n)} joueurs.`); loadLog(); }
    catch (e) { toast(message(e)); }
  };
  $("#admDc").onsubmit = async e => {
    e.preventDefault(); const u = $("#admDcUrl").value.trim();
    try { await rpc("admin_discord_set", { p_url: u, p_enabled: null }); $("#admDcUrl").value = ""; toast(u ? "Webhook Discord enregistré." : "Webhook Discord retiré."); loadDiscord(); loadLog(); }
    catch (e) { toast(message(e)); }
  };
  $("#admDcTest").onclick = async () => { try { await rpc("admin_discord_test"); toast("Message de test envoyé : regarde le salon Discord."); } catch (e) { toast(message(e)); } };
  $("#admDcToggle").onclick = async () => {
    try { await rpc("admin_discord_set", { p_url: null, p_enabled: !ADM.discord?.enabled }); loadDiscord(); loadLog(); } catch (e) { toast(message(e)); }
  };
}

async function loadDiscord() {
  try { ADM.discord = await rpc("admin_discord_get"); } catch (e) { $("#admDcState").textContent = message(e); return; }
  const d = ADM.discord;
  $("#admDcState").innerHTML = !d.set ? "Aucun webhook enregistré : rien n'est annoncé."
    : d.enabled ? `Annonces <b>actives</b> (webhook ${esc(d.hint)}).` : `Annonces <b>coupées</b> (webhook ${esc(d.hint)} enregistré).`;
  $("#admDcToggle").textContent = d.enabled ? "Couper les annonces" : "Réactiver les annonces";
  $("#admDcToggle").hidden = $("#admDcTest").hidden = !d.set;
}

async function renderAdmin() {
  if (!me || !ADM.admin) return show("shop");
  buildAdmin();
  await Promise.all([loadStats(), loadUsers(), loadLog(), loadDiscord()]);
  clearInterval(ADM.timer);
  ADM.timer = setInterval(() => {
    if (views.admin.hidden || !ADM.admin) return clearInterval(ADM.timer);
    loadStats(); loadUsers(true);
  }, 15000);
}

async function loadStats() {
  let s;
  try { s = await rpc("admin_stats"); } catch (e) { $("#admStats").innerHTML = `<p class="empty-line">${esc(message(e))}</p>`; return; }
  const tile = (n, label, cls = "") => `<div class="adm-tile ${cls}"><b>${fmt(n)}</b><span>${label}</span></div>`;
  $("#admStats").innerHTML = tile(s.active_now, "en ligne maintenant", "live")
    + tile(s.open_now, "onglet ouvert") + tile(s.active_1h, "actifs dans l'heure") + tile(s.active_24h, "actifs 24 h")
    + tile(s.active_7d, "actifs 7 jours") + tile(s.accounts, "comptes") + tile(s.new_24h, "nouveaux 24 h")
    + tile(s.new_7d, "nouveaux 7 jours") + tile(s.banned, "bannis", s.banned ? "bad" : "") + tile(s.opened, "boosters ouverts");
}

async function loadUsers(quiet) {
  try { ADM.users = await rpc("admin_users", { p_q: ADM.q, p_filter: ADM.filter, p_limit: 100 }); }
  catch (e) { if (!quiet) $("#admUsers").innerHTML = `<p class="empty-line">${esc(message(e))}</p>`; return; }
  const box = $("#admUsers"); box.innerHTML = "";
  if (!ADM.users.length) { box.innerHTML = `<p class="empty-line">Aucun joueur.</p>`; return; }
  for (const u of ADM.users) {
    const b = document.createElement("button");
    b.className = "adm-user" + (ADM.sel === u.id ? " on" : "");
    b.innerHTML = `<i class="dot${u.online ? " live" : ""}" aria-label="${u.online ? "en ligne" : "hors ligne"}"></i>
      <span class="who"><b>${esc(u.pseudo)}</b>${u.admin ? `<em class="tag adm">admin</em>` : ""}${u.ban ? `<em class="tag ban">banni</em>` : ""}${u.warnings ? `<em class="tag warn">${u.warnings} avert.</em>` : ""}
        <small>${esc(u.email || "")}</small></span>
      <span class="when">${u.online ? "en ligne" : ago(u.active_at)}</span>`;
    b.onclick = () => { ADM.sel = u.id; box.querySelectorAll(".adm-user").forEach(x => x.classList.remove("on")); b.classList.add("on"); showUser(u); };
    box.appendChild(b);
  }
  const cur = ADM.users.find(u => u.id === ADM.sel);
  if (cur && !quiet) showUser(cur);
}

async function showUser(u) {
  const box = $("#admDetail");
  box.innerHTML = `<h3>${esc(u.pseudo)}</h3><p class="empty-line">Chargement de la fiche…</p>`;
  let d;
  let gifts = {}, given = [];
  try { [d, gifts, given] = await Promise.all([rpc("admin_user", { p_user: u.id }), rpc("admin_gifts", { p_user: u.id }).catch(() => ({})),
    rpc("admin_gifted_cards", { p_user: u.id }).catch(() => [])]); }
  catch (e) { box.innerHTML = `<p class="empty-line">${esc(message(e))}</p>`; return; }
  if (ADM.sel !== u.id) return;
  const god = !!gifts.god, gift = gifts.card;
  const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  box.innerHTML = `<div class="adm-head"><h3>${esc(u.pseudo)}</h3>${u.online ? `<span class="tag live">en ligne</span>` : ""}${u.admin ? `<span class="tag adm">admin</span>` : ""}</div>
    ${u.ban ? `<p class="adm-banned">Banni ${u.ban.until ? `jusqu'au ${esc(dateFr(u.ban.until))}` : "définitivement"}${u.ban.reason ? ` · ${esc(u.ban.reason)}` : ""}</p>` : ""}
    <dl class="adm-dl">
      ${row("E-mail", esc(u.email || "?"))}
      ${row("Inscrit", esc(dateFr(u.created_at)))}
      ${row("Dernière activité", u.online ? "en ligne" : esc(ago(u.active_at)))}
      ${row("Streams", fmt(u.streams))}
      ${row("Boosters en stock", fmt(u.stock))}
      ${row("Boosters ouverts", fmt(u.opened) + (u.gods ? ` · ${u.gods} GOD pack${u.gods > 1 ? "s" : ""}` : ""))}
      ${row("Cartes", fmt(d.cards))}
      ${row("En vente", fmt(d.listings))}
      ${row("Échanges faits", fmt(d.trades))}
    </dl>
    <div class="adm-actions">
      <form class="adm-act" id="aWarn"><h4>Envoyer un avertissement</h4>
        <textarea maxlength="500" rows="2" placeholder="Ex. : merci de respecter les autres joueurs dans les échanges." required></textarea>
        <button class="btn">Avertir</button></form>
      ${u.admin ? "" : u.ban ? `<div class="adm-act"><h4>Suspension</h4><button class="btn primary" id="aUnban">Lever le bannissement</button></div>`
        : `<form class="adm-act" id="aBan"><h4>Bannir</h4>
        <div class="adm-row"><select aria-label="Durée"><option value="1">1 heure</option><option value="24" selected>24 heures</option><option value="72">3 jours</option>
          <option value="168">7 jours</option><option value="720">30 jours</option><option value="0">Définitif</option></select>
          <input maxlength="300" placeholder="Raison (vue par le joueur)" aria-label="Raison"></div>
        <button class="btn danger">Bannir</button></form>`}
      <form class="adm-act" id="aStreams"><h4>Streams</h4>
        <div class="adm-row"><input type="number" step="1" placeholder="+500 ou -500" aria-label="Montant" required>
          <input maxlength="100" placeholder="Raison" aria-label="Raison"></div>
        <button class="btn">Appliquer</button></form>
      <div class="adm-act"><h4>GOD pack</h4>
        <p class="adm-small">${god ? "Son prochain booster sera un <b>GOD pack</b>." : "Son prochain booster ouvert sur le site sera un GOD pack (animation complète et annonce Discord)."}</p>
        <button class="btn${god ? "" : " primary"}" id="aGod">${god ? "Annuler le GOD pack" : "Offrir un GOD pack"}</button></div>
      <div class="adm-act adm-gift"><h4>Carte offerte</h4>
        <p class="adm-small">${gift ? `La dernière carte de son prochain booster sera : <b>${esc(giftName(gift))}</b>.` : "La dernière carte de son prochain booster sera la carte choisie (avec son animation et l'annonce Discord)."}</p>
        ${gift ? `<button class="btn" id="aGiftNo">Annuler</button>`
          : `<div class="adm-gifts">${GIFTS.map((g, k) => `<button class="btn${g.shiny ? " shiny" : ""}" data-gift="${k}">${esc(giftName(g))}</button>`).join("")}</div>`}</div>
      <form class="adm-act" id="aBoost"><h4>Boosters</h4>
        <div class="adm-row"><input type="number" step="1" min="-100" max="100" placeholder="+5" aria-label="Nombre de boosters" required></div>
        <button class="btn">Appliquer</button></form>
    </div>
    <h4>Cartes offertes${given.length ? ` (${given.length})` : ""}</h4>
    ${given.length ? `<ul class="adm-hist">${given.map(c => `<li><small>${esc(dateFr(c.at))}</small>${esc(giftName({ kind: c.kind, tier: c.tier, shiny: c.holo }))} · ${esc(c.title)}${c.artist ? ` — ${esc(c.artist)}` : ""}</li>`).join("")}</ul>
      <button class="btn danger" id="aGiftDel">Supprimer les cartes offertes</button>` : `<p class="adm-small">Aucune carte offerte dans sa collection.</p>`}
    ${d.warnings.length ? `<h4>Avertissements</h4><ul class="adm-hist">${d.warnings.map(w => `<li><small>${esc(dateFr(w.at))}${w.read ? " · lu" : " · pas encore lu"}</small>${esc(w.message)}</li>`).join("")}</ul>` : ""}
    ${d.log.length ? `<h4>Historique</h4><ul class="adm-hist">${d.log.map(l => `<li><small>${esc(dateFr(l.at))} · ${esc(l.admin || "?")}</small>${esc(actionTxt(l.action))}${l.detail ? ` · ${esc(l.detail)}` : ""}</li>`).join("")}</ul>` : ""}`;

  const act = async (fn, args, done) => {
    try { const r = await rpc(fn, args); toast(done(r)); await loadUsers(true); loadLog(); loadStats(); const nu = ADM.users.find(x => x.id === u.id); if (nu) showUser(nu); }
    catch (e) { toast(message(e)); }
  };
  $("#aWarn").onsubmit = e => { e.preventDefault(); const m = e.target.querySelector("textarea").value.trim(); if (m) act("admin_warn", { p_user: u.id, p_message: m }, () => `Avertissement envoyé à ${u.pseudo}.`); };
  const ban = $("#aBan");
  if (ban) ban.onsubmit = e => {
    e.preventDefault();
    const h = +ban.querySelector("select").value, why = ban.querySelector("input").value.trim();
    if (!confirm(`Bannir ${u.pseudo} ${h ? "pendant " + ban.querySelector("select").selectedOptions[0].text : "définitivement"} ?`)) return;
    act("admin_ban", { p_user: u.id, p_hours: h, p_reason: why }, () => `${u.pseudo} est banni.`);
  };
  const unban = $("#aUnban");
  if (unban) unban.onclick = () => act("admin_unban", { p_user: u.id }, () => `${u.pseudo} n'est plus banni.`);
  $("#aStreams").onsubmit = e => {
    e.preventDefault(); const [n, why] = e.target.querySelectorAll("input"); const v = Math.trunc(+n.value);
    if (v) act("admin_streams", { p_user: u.id, p_amount: v, p_reason: why.value.trim() }, bal => `${u.pseudo} a maintenant ${fmt(bal)} Streams.`);
  };
  $("#aGod").onclick = () => act("admin_force_god", { p_user: u.id, p_on: !god },
    () => god ? `GOD pack annulé pour ${u.pseudo}.` : `Le prochain booster de ${u.pseudo} sera un GOD pack.`);
  box.querySelectorAll("[data-gift]").forEach(b => b.onclick = () => { const g = GIFTS[+b.dataset.gift];
    act("admin_gift_card", { p_user: u.id, p_kind: g.kind, p_tier: g.tier, p_shiny: g.shiny }, () => `La dernière carte du prochain booster de ${u.pseudo} sera : ${giftName(g)}.`); });
  const no = $("#aGiftNo");
  if (no) no.onclick = () => act("admin_gift_card", { p_user: u.id, p_kind: "track", p_tier: 0, p_shiny: false }, () => `Carte annulée pour ${u.pseudo}.`);
  const del = $("#aGiftDel");
  if (del) del.onclick = () => { if (confirm(`Supprimer les ${given.length} carte${given.length > 1 ? "s" : ""} offerte${given.length > 1 ? "s" : ""} de la collection de ${u.pseudo} ?`))
    act("admin_delete_gifted", { p_user: u.id }, n => `${n} carte${n > 1 ? "s" : ""} offerte${n > 1 ? "s" : ""} supprimée${n > 1 ? "s" : ""}.`); };
  $("#aBoost").onsubmit = e => {
    e.preventDefault(); const v = Math.trunc(+e.target.querySelector("input").value);
    if (v) act("admin_boosters", { p_user: u.id, p_count: v }, s => `${u.pseudo} a maintenant ${fmt(s)} booster${s > 1 ? "s" : ""} en stock.`);
  };
}

// the cards an admin can offer as the last card of a player's next booster
const GIFTS = [["track", 4], ["track", 5], ["track", 4, true], ["track", 5, true], ["artist", 4], ["artist", 5], ["artist", 4, true], ["artist", 5, true]]
  .map(([kind, tier, shiny = false]) => ({ kind, tier, shiny }));
const giftName = g => (g.kind === "artist" ? (g.tier === 5 ? "Artiste Diamant" : "Artiste Platine") : (g.tier === 5 ? "Légendaire" : "Mythique")) + (g.shiny ? " Shiny" : "");
const ACTIONS = { ban: "Banni", unban: "Débanni", warn: "Averti", broadcast: "Message à tous", streams: "Streams", boosters: "Boosters", discord: "Discord", god: "GOD pack", gift: "Cadeau" };
const actionTxt = a => ACTIONS[a] || a;
async function loadLog() {
  let l;
  try { l = await rpc("admin_log_list", { p_limit: 40 }); } catch (e) { return; }
  $("#admLog").innerHTML = l.length ? l.map(x => `<li><small>${esc(ago(x.at))} · ${esc(x.admin || "?")}</small>${esc(actionTxt(x.action))}${x.target ? ` · <b>${esc(x.target)}</b>` : ""}${x.detail ? ` · ${esc(x.detail)}` : ""}</li>`).join("")
    : `<li class="empty-line">Aucune action pour l'instant.</li>`;
}

Object.assign(Online, { beat, adminOff, showNotice, renderAdmin });
