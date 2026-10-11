"use strict";
/* Zik Hunter — the season pass. 30 tiers a season, a free reward and a Premium one per tier. XP comes from playing
   (boosters, daily bonus, challenges, albums…), counted by the server; this file shows the pass and claims rewards. */

const PASS = { data: null, busy: false, got: {} };
const PASS_PRICE = "4,99 €";
const TIER_VINYLS = 30, PREMIUM_VINYLS = 450;   // the prices in Vinyles (checked by the server)

const passCardName = c => (c.kind === "artist" ? (c.tier === 5 ? "Artiste Diamant" : "Artiste Platine") : (c.tier === 5 ? "Légendaire" : "Mythique"))
  + (c.shiny ? " Shiny" : "");
const passName = r => r.kind === "streams" ? `${fmt(r.amount)} Streams` : r.kind === "vinyls" ? `${r.amount} Vinyles` : r.kind === "boosters" ? `${r.amount} boosters` : passCardName(r.card);
// the reward pictures are the game's own: the 3D booster of the shop, and real cards of the right rarity. The cards are
// examples (Deezer's chart and famous artists, Travis Scott first), changing every 2 seconds: a reward is a card of
// that rarity, not that one. Until the examples are loaded, the player's own cards stand in, or a card back.
const PS_POOL = { track4: [], track5: [], artist4: [], artist5: [] };
let psLoading = null;
const PS_STARS = [4495513, 246791, 4050205, 12246, 13, 564, 5313805, 27];   // Travis Scott, Drake, The Weeknd, Taylor Swift, Eminem, Rihanna…
function passLoadExamples() {
  if (psLoading) return psLoading;
  const add = (key, c) => { if (c.cov && PS_POOL[key].length < 14 && !PS_POOL[key].some(x => x.id === c.id)) PS_POOL[key].push(c); };
  const artist = a => {
    const tier = certOf(a.nb_fan || 0, a.id);
    if (tier >= 4) add("artist" + tier, cardFromRow({ kind: "artist", artist_id: a.id, tier, rank: a.nb_fan, holo: false },
      { name: a.name, picture: (a.picture_xl || a.picture_big || "").replace(/^http:/, "https:"), fans: a.nb_fan, nb_album: a.nb_album }));
  };
  psLoading = (async () => {
    const [chart, ...stars] = await Promise.all([dz("chart/0/tracks", { limit: 100 }).catch(() => ({})),
      ...PS_STARS.map(id => dz("artist/" + id).catch(() => ({})))]);
    for (const t of chart.data || []) { const tier = tierOf(t.rank || 0); if (tier >= 4) add("track" + tier, { ...quickCard(t), g: AUTRE }); }
    for (const a of stars) if (a && a.id) artist(a);
    const rel = await Promise.all([4495513, 246791, 9635624].map(id => dz(`artist/${id}/related`, { limit: 50 }).catch(() => ({}))));
    for (const r of rel) for (const a of r.data || []) artist(a);
    passTick(true);
  })();
  return psLoading;
}
function passPool(kind, tier) {
  const pool = PS_POOL[kind + tier];
  if (pool.length) return pool;
  const own = owned().filter(c => c.tier === tier && isArtist(c) === (kind === "artist") && c.cov && !c.collector).sort((a, b) => b.rank - a.rank).slice(0, 8);
  return own;
}
function passArt(c, big = false, got = "") {
  return `<span class="ps-real${big ? " big" : ""}"${got ? ` data-got="${got}"` : ""} data-kind="${c.kind}" data-tier="${c.tier}" data-shiny="${c.shiny ? 1 : 0}" aria-hidden="true"></span>`;
}
function passIcon(r) {
  if (r.kind === "streams") return `<i class="coin ps-coin" aria-hidden="true"></i>`;
  if (r.kind === "vinyls") return `<i class="vin ps-vin" aria-hidden="true"></i>`;
  if (r.kind === "boosters") return `<span class="ps-pk-wrap" aria-hidden="true"><span class="pack mix ps-pk"><span class="pack-shine"></span><canvas class="pack-gl"></canvas><img class="pack-logo" src="brand/zikhunter-icon.svg" alt=""></span><b class="ps-x">×${r.amount}</b></span>`;
  return passArt(r.card);
}
// shows the next example in every card slot (each slot starts at a different one)
let psStep = 0;
function passTick(now) {
  if (!now) psStep++;
  const root = views.pass;
  if (!root || root.hidden) return;
  root.querySelectorAll(".ps-real").forEach((el, i) => {
    const mine = el.dataset.got && PASS.got[el.dataset.got];         // a reward already received: the player's own card, fixed
    const pool = mine ? [mine] : passPool(el.dataset.kind, +el.dataset.tier);
    const c = pool.length ? pool[(psStep + i) % pool.length] : null, id = c ? String(c.id) : "back";
    if (el.dataset.cur === id) return;
    el.dataset.cur = id;
    let card;
    try { card = c ? cardEl(c, mine ? !!mine.shinyCopy : el.dataset.shiny === "1") : backEl(); } catch (e) { card = backEl(); }
    const old = el.firstElementChild;
    card.classList.add("ps-in");
    el.appendChild(card);
    if (old) { old.classList.add("ps-out"); setTimeout(() => old.remove(), 450); }
  });
}
setInterval(() => { if (!document.hidden) passTick(); }, 2000);

const passTier = d => Math.min(d.tiers, Math.floor(d.xp / d.xp_per_tier));
const passReady = d => {
  if (!d) return 0;
  const t = passTier(d);
  let n = 0;
  for (let i = 1; i <= t; i++) {
    if (!d.claimed_free.includes(i)) n++;
    if (d.premium && !d.claimed_premium.includes(i)) n++;
  }
  return n;
};
function passBadge() {
  const n = passReady(PASS.data), b = $("#passBadge");
  if (b) { b.hidden = !n; b.textContent = n; }
}

async function loadPass() {
  if (!me) return null;
  try { PASS.data = await rpc("my_season"); } catch (e) { PASS.data = null; }
  passBadge(); renderVinylShop(); if (!SHOP.loaded) { SHOP.loaded = true; loadOffersUsed(); }
  return PASS.data;
}

function daysLeft(t) {
  const s = (Date.parse(t) - Date.now()) / 1000;
  if (s <= 0) return "Saison terminée : récupère ce qu'il te reste";
  if (s < 86400) return `Fin dans ${Math.max(1, Math.ceil(s / 3600))} h`;
  return `Fin dans ${Math.ceil(s / 86400)} jours`;
}

async function renderPass() {
  const box = views.pass;
  if (!me) return;
  if (!PASS.data) box.innerHTML = `<h2>Pass saisonnier</h2><p class="empty-line">Chargement du pass…</p>`;
  const d = await loadPass();
  if (!d) { box.innerHTML = `<h2>Pass saisonnier</h2><p class="empty-line">Pas de saison en cours. La prochaine arrive bientôt !</p>`; return; }
  const tier = passTier(d), into = d.xp - tier * d.xp_per_tier, max = tier >= d.tiers, pct = max ? 100 : Math.round(100 * into / d.xp_per_tier);
  const ready = passReady(d);
  PASS.got = {};
  for (const g of d.got || []) {
    const k = g.card, c = cardFromRow({ kind: k.kind, track_id: k.track_id, artist_id: k.artist_id, tier: k.tier, rank: k.rank },
      { title: k.title, artist: k.artist, album: k.album, cover: k.cover, duration: k.duration, bpm: k.bpm, year: k.year, explicit: k.explicit, genre: k.genre,
        name: k.name, picture: k.picture, fans: k.fans, nb_album: k.nb_album });
    PASS.got[g.tier + (g.premium ? "p" : "f")] = { ...c, shinyCopy: k.holo };
  }
  const [season, title] = d.name.includes("·") ? d.name.split("·").map(x => x.trim()) : ["", d.name];
  const prem = d.rewards.map(r => ({ tier: r.tier, ...r.premium }));
  const premCards = prem.filter(r => r.kind === "card");
  const worth = prem.reduce((a, r) => a + (r.kind === "streams" ? r.amount : r.kind === "boosters" ? r.amount * STORE_PRICE : 0), 0);
  const lockedNow = d.premium ? 0 : prem.filter(r => r.tier <= tier).length;   // Premium rewards already reached, waiting for the pass
  const final = d.rewards[d.rewards.length - 1].premium;

  box.innerHTML = `
    <div class="ps-hero${d.premium ? " prem" : ""}">
      <div class="ps-hero-l">
        <p class="ps-kicker">Pass saisonnier${season ? ` · ${esc(season)}` : ""}${d.premium ? ` <span class="ps-tag">Premium</span>` : ""}</p>
        <h2 class="ps-name">${esc(title)}</h2>
        <div class="ps-chips"><span>⏳ ${esc(daysLeft(d.ends_at))}</span><span>${d.tiers} paliers</span><span>${premCards.length + d.rewards.filter(r => r.free.kind === "card").length} cartes rares à gagner</span></div>
        <div class="ps-level">
          <div class="ps-ring" style="--p:${pct}"><b>${tier}</b><small>/ ${d.tiers}</small></div>
          <div class="ps-xp"><span>Palier ${tier}${max ? "" : ` <small>→ ${tier + 1}</small>`}</span>
            <div class="ps-meter"><s style="width:${pct}%"></s></div>
            <small>${max ? "Pass terminé, bravo !" : `${fmt(into)} / ${fmt(d.xp_per_tier)} XP`}</small></div>
        </div>
        ${max ? "" : `<div class="ps-skip"><button class="ps-buytier" id="psTier">Acheter le palier ${tier + 1} <span>${TIER_VINYLS} <i class="vin" aria-hidden="true"></i></span></button>
          <small>Tu as <b>${fmt(S.vinyls || 0)}</b> Vinyles</small></div>`}
      </div>
      <div class="ps-hero-r">
        <div class="ps-show">${passArt(final.card, true)}<span class="ps-spark s1"></span><span class="ps-spark s2"></span><span class="ps-spark s3"></span></div>
        <p class="ps-show-lbl"><small>Récompense finale · palier ${d.tiers}</small><b>${esc(passCardName(final.card))}</b><em>Exemples : la carte gagnée est tirée au hasard</em></p>
      </div>
    </div>

    ${d.premium ? "" : `
    <div class="ps-offer">
      <div class="ps-offer-l">
        <p class="ps-kicker gold">Pass Premium</p>
        <h3>Double toutes tes récompenses</h3>
        ${lockedNow ? `<p class="ps-miss"><b>${lockedNow} récompense${lockedNow > 1 ? "s" : ""} Premium</b> déjà débloquée${lockedNow > 1 ? "s" : ""} t'attend${lockedNow > 1 ? "ent" : ""}. Elle${lockedNow > 1 ? "s" : ""} arrive${lockedNow > 1 ? "nt" : ""} dès que tu passes Premium.</p>` : ""}
        <ul class="ps-perks">
          <li><b>${premCards.length} cartes rares garanties</b> : Légendaire dès le palier 5, Shiny, artistes Platine et Diamant</li>
          <li><b>${fmt(prem.filter(r => r.kind === "boosters").reduce((a, r) => a + r.amount, 0))} boosters</b> et <b>${fmt(prem.filter(r => r.kind === "streams").reduce((a, r) => a + r.amount, 0))} Streams</b> en plus</li>
          <li>Ton <b>badge Premium</b> sur la saison</li>
        </ul>
        <div class="ps-offer-cards">${premCards.map(r => `<span class="ps-oc" title="Palier ${r.tier} : ${esc(passCardName(r.card))}">${passArt(r.card)}<small>${r.tier}</small></span>`).join("")}</div>
      </div>
      <div class="ps-offer-r">
        <p class="ps-worth">Plus de <b>${fmt(Math.floor(worth / 1000) * 1000)} Streams</b> de valeur</p>
        <p class="ps-price"><b>${PASS_PRICE}</b><small>pour toute la saison</small></p>
        <button class="btn ps-buy" id="psBuy">Débloquer le Premium</button>
        <button class="ps-buy-v" id="psBuyV">ou avec ${PREMIUM_VINYLS} <i class="vin" aria-hidden="true"></i> Vinyles</button>
      </div>
    </div>`}

    <div class="ps-bar">
      <h3>Récompenses</h3>
      <button class="btn primary" id="psAll" ${ready ? "" : "disabled"}>${ready ? `Tout récupérer (${ready})` : "Rien à récupérer"}</button>
      ${d.gift_pending ? `<small class="ps-note">Une carte t'attend dans ton prochain booster : ouvre-le pour récupérer les autres.</small>` : ""}
    </div>
    <div class="ps-track" id="psTrack">
      <div class="ps-labels"><span></span><span>Gratuit</span><span class="gold">Premium</span></div>
      ${d.rewards.map(r => {
        const reached = r.tier <= tier;
        const cell = (rw, isPrem) => {
          const claimed = (isPrem ? d.claimed_premium : d.claimed_free).includes(r.tier);
          const can = reached && !claimed && (!isPrem || d.premium);
          const state = claimed ? "claimed" : can ? "ready" : (isPrem && !d.premium) ? "lock" : "wait";
          const star = rw.kind === "card" ? ` star r${rw.card.tier}${rw.card.shiny ? " shiny" : ""}` : "";
          const gk = r.tier + (isPrem ? "p" : "f"), mine = claimed && rw.kind === "card" ? PASS.got[gk] : null;
          return `<button class="ps-cell ${isPrem ? "prem" : "free"} ${state}${star}${mine ? " mine" : ""}" data-t="${r.tier}" data-p="${isPrem ? 1 : 0}" ${can ? "" : 'tabindex="-1"'}
            aria-label="Palier ${r.tier}, ${isPrem ? "Premium" : "gratuit"} : ${esc(passName(rw))}${claimed ? ", récupéré" : can ? ", à récupérer" : ""}">
            ${rw.kind === "card" ? passArt(rw.card, false, claimed ? gk : "") : passIcon(rw)}<span class="ps-lbl">${mine ? `Ta carte : <b>${esc(mine.t)}</b>` : esc(passName(rw))}</span>
            ${claimed ? `<span class="ps-ok" aria-hidden="true">✓</span>` : state === "lock" ? `<span class="ps-lock" aria-hidden="true"></span>` : can ? `<span class="ps-go">Récupérer</span>` : ""}</button>`;
        };
        return `<div class="ps-tier${reached ? " reached" : ""}${r.tier === tier + 1 ? " next" : ""}">
          <span class="ps-n"><i style="width:${reached ? 100 : r.tier === tier + 1 ? pct : 0}%"></i><b>${r.tier}</b></span>${cell(r.free, false)}${cell(r.premium, true)}</div>`;
      }).join("")}
    </div>`;

  passTick(true); passLoadExamples();
  box.querySelectorAll(".ps-pk").forEach(pk => skin(pk, classicName, {}));   // the shop's 3D booster
  const buyV = $("#psBuyV");
  if (buyV) buyV.onclick = async () => {
    if ((S.vinyls || 0) < PREMIUM_VINYLS) return toast(`Il te faut ${PREMIUM_VINYLS} Vinyles, tu en as ${fmt(S.vinyls || 0)}.`);
    if (!confirm(`Débloquer le Pass Premium pour ${PREMIUM_VINYLS} Vinyles ?`)) return;
    try { await rpc("buy_season_premium"); toast("Pass Premium débloqué ! Toutes les récompenses dorées sont à toi."); }
    catch (e) { return toast(message(e)); }
    try { await loadProfile(); } catch (e) {}
    refreshViews(); renderPass();
  };
  const tierBtn = $("#psTier");
  if (tierBtn) tierBtn.onclick = async () => {
    if ((S.vinyls || 0) < TIER_VINYLS) return toast(`Il te faut ${TIER_VINYLS} Vinyles, tu en as ${fmt(S.vinyls || 0)}.`);
    tierBtn.disabled = true;
    try { const t = await rpc("buy_season_tier"); toast(`Palier ${t} débloqué !`); }
    catch (e) { toast(message(e)); }
    try { await loadProfile(); } catch (e) {}
    refreshViews(); renderPass();
  };
  const buy = $("#psBuy");
  if (buy) buy.onclick = () => checkout("pass", buy);
  box.querySelectorAll(".ps-cell.ready").forEach(b => b.onclick = () => claimPass([[+b.dataset.t, b.dataset.p === "1"]]));
  box.querySelectorAll(".ps-cell.lock").forEach(b => b.onclick = () => $("#psBuy")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  $("#psAll").onclick = () => {
    const list = [];
    for (let i = 1; i <= tier; i++) {
      if (!d.claimed_free.includes(i)) list.push([i, false]);
      if (d.premium && !d.claimed_premium.includes(i)) list.push([i, true]);
    }
    claimPass(list);
  };
  // the track opens on the next tier to reach
  const next = box.querySelector(".ps-tier.next") || [...box.querySelectorAll(".ps-tier.reached")].pop();
  const track = $("#psTrack");
  if (next && track) track.scrollLeft = Math.max(0, next.offsetLeft - track.clientWidth / 2 + next.clientWidth / 2);
}

async function claimPass(list) {
  if (PASS.busy || !list.length) return;
  PASS.busy = true;
  const got = [];
  let stop = null, skippedCard = false;
  for (const [t, prem] of list) {
    try { got.push(await rpc("claim_season", { p_tier: t, p_premium: prem })); }
    catch (e) {
      if (e.message === "gift_pending" && list.length > 1) { skippedCard = true; continue; }   // one card at a time: the others wait
      stop = e; break;
    }
  }
  PASS.busy = false;
  if (got.length) {
    const s = got.filter(r => r.kind === "streams").reduce((a, r) => a + r.amount, 0);
    const b = got.filter(r => r.kind === "boosters").reduce((a, r) => a + r.amount, 0);
    const v = got.filter(r => r.kind === "vinyls").reduce((a, r) => a + r.amount, 0);
    const c = got.filter(r => r.kind === "card").map(r => passCardName(r.card));
    const parts = [s && `${fmt(s)} Streams`, v && `${v} Vinyles`, b && `${b} booster${b > 1 ? "s" : ""}`, c.length && `${c.join(", ")} (dans ton prochain booster)`].filter(Boolean);
    toast("Récupéré : " + parts.join(" · ") + (skippedCard ? ". Les autres cartes viendront une à une, après ton prochain booster." : "."));
    try { await loadProfile(); } catch (e) {}
    refreshViews();
  }
  if (stop) toast(message(stop));
  renderPass();
}

/* ---------- the Boutique: buying Vinyles (the payment comes later: for now the buttons say so) ---------- */
// the ids and prices of shop_packs (the server charges its own price; these are for the display)
const VINYL_PACKS = [
  { id: "v80", n: 80, eur: 0.99 }, { id: "v170", n: 170, eur: 1.99 }, { id: "v360", n: 360, eur: 3.99 },
  { id: "v950", n: 950, eur: 9.99, tag: "Populaire" }, { id: "v2000", n: 2000, eur: 19.99 }, { id: "v5500", n: 5500, eur: 49.99, tag: "Meilleure offre" },
];
const SHOP = { used: [] };     // the one-time offers already bought

// a Stripe Checkout page for a pack (Edge Function create-checkout), then back to the site with ?achat=ok
async function checkout(pack, btn) {
  if (!me) return toast("Connecte-toi pour acheter.");
  const label = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.textContent = "Paiement…"; }
  let url = null, err = null;
  try {
    const { data, error } = await sb.functions.invoke("create-checkout", { body: { pack } });
    if (error) { const b = await error.context?.json?.().catch(() => null); err = b?.error || "payments_off"; }
    else url = data?.url;
  } catch (e) { err = "payments_off"; }
  if (url) { location.href = url; return; }
  if (err) console.warn("Paiement :", err);
  if (btn) { btn.disabled = false; btn.innerHTML = label; }
  toast(message({ message: err || "payments_off" }));
}
// back from Stripe: the webhook delivers within a few seconds, so the balance is read again a few times
(function backFromStripe() {
  const q = new URLSearchParams(location.search), r = q.get("achat");
  if (!r) return;
  q.delete("achat"); history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash);
  if (r !== "ok") return setTimeout(() => toast("Paiement annulé : rien n'a été débité."), 800);
  setTimeout(() => toast("Paiement reçu, merci ! Tes Vinyles arrivent dans quelques secondes."), 800);
  let n = 0;
  const poll = setInterval(async () => {
    if (++n > 8) return clearInterval(poll);
    if (!me) return;
    const before = S.vinyls, prem = PASS.data?.premium;
    try { await loadProfile(); await loadPass(); } catch (e) { return; }
    refreshViews();
    if (!views.pass.hidden) renderPass();
    if (S.vinyls !== before || PASS.data?.premium !== prem) { clearInterval(poll); toast("C'est arrivé : ton achat est sur ton compte."); }
  }, 2500);
})();
const euro = v => v.toFixed(2).replace(".", ",") + " €";
function renderVinylShop() {
  const box = $("#vinylShop");
  if (!box) return;
  const base = VINYL_PACKS[0].n / VINYL_PACKS[0].eur;
  box.innerHTML = `
    <div class="vs-head">
      <div><p class="ps-kicker">Monnaie rare</p><h3>Vinyles</h3>
        <p>Achète des paliers du pass saisonnier (${TIER_VINYLS} Vinyles) ou le Pass Premium (${PREMIUM_VINYLS} Vinyles).</p></div>
      ${me ? `<div class="vs-bal"><i class="vin" aria-hidden="true"></i><b>${fmt(S.vinyls || 0)}</b><small>Ton solde</small></div>` : ""}
    </div>
    ${SHOP.used.includes("welcome") ? "" : `<div class="vs-welcome">
      <span class="vs-badge">Offre de bienvenue · une seule fois</span>
      <div class="vs-stack s3" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="vs-wtxt"><b>300 Vinyles</b><small>au lieu de 3,99 €</small></div>
      <button class="vs-buy" data-pack="welcome">0,99 €</button>
    </div>`}
    <div class="vs-grid">${VINYL_PACKS.map((p, i) => {
      const bonus = Math.round((p.n / p.eur / base - 1) * 100);
      return `<div class="vs-pack${p.tag ? " hot" : ""}">
        ${p.tag ? `<span class="vs-tag">${p.tag}</span>` : ""}
        <div class="vs-stack s${i + 1}" aria-hidden="true">${"<i></i>".repeat(i + 1)}</div>
        <b class="vs-n">${fmt(p.n)}</b><small>Vinyles</small>
        ${bonus > 0 ? `<span class="vs-bonus">+${bonus} % offerts</span>` : `<span class="vs-bonus none">&nbsp;</span>`}
        <button class="vs-buy" data-pack="${p.id}">${euro(p.eur)}</button>
      </div>`;
    }).join("")}</div>`;
  box.querySelectorAll(".vs-buy").forEach(b => b.onclick = () => checkout(b.dataset.pack, b));
}
async function loadOffersUsed() {
  if (!me) return;
  try { SHOP.used = await rpc("my_offers_used") || []; } catch (e) { SHOP.used = []; }
  renderVinylShop();
}
renderVinylShop();
addEventListener("click", e => { if (e.target.closest?.("#tab-store")) renderVinylShop(); }, true);

// the badge on the tab: refreshed at sign-in and after each booster
const passWatch = () => { if (me) loadPass(); };
setInterval(passWatch, 120000);
Object.assign(Online, { renderPass, loadPass });
