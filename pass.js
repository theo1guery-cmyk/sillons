"use strict";
/* Zik Hunter — the season pass. 30 tiers a season, a free reward and a Premium one per tier. XP comes from playing
   (boosters, daily bonus, challenges, albums…), counted by the server; this file shows the pass and claims rewards. */

const PASS = { data: null, busy: false, got: {} };
const PASS_PRICE = "4,99 €";
const TIER_VINYLS = 40, PREMIUM_VINYLS = 500;   // the prices in Vinyles (checked by the server)
// several tiers at once: -20 % from 5, -30 % from 10, -40 % from 20 (tiers_price on the server)
const tiersPrice = n => Math.round(TIER_VINYLS * n * (n >= 20 ? .6 : n >= 10 ? .7 : n >= 5 ? .8 : 1));

// kind "any": the Shiny surprise of the last VIP tier (Mythique, Légendaire, artist Platine or Diamant, drawn by the server)
const passCardName = c => c.kind === "any" ? "Shiny surprise" : (c.kind === "artist" ? (c.tier === 5 ? "Artiste Diamant" : "Artiste Platine") : (c.tier === 5 ? "Légendaire" : "Mythique"))
  + (c.shiny ? " Shiny" : "");
const passName = r => r.kind === "streams" ? `${fmt(r.amount)} Streams` : r.kind === "vinyls" ? `${r.amount} Vinyles` : r.kind === "boosters" ? `${r.amount} boosters`
  : r.kind === "big_booster" ? "Édition Deluxe (15 cartes Rare+)" : r.kind === "title" ? `Titre « ${r.title} »` : r.kind === "cosmetic" ? r.name : passCardName(r.card);
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
  if (kind === "any") {                                             // the four rarities in turn
    const ps = [["track", 4], ["artist", 4], ["track", 5], ["artist", 5]].map(([k, t]) => passPool(k, t)).filter(x => x.length);
    const out = [];
    for (let i = 0; ps.some(x => i < x.length); i++) for (const x of ps) if (i < x.length) out.push(x[i]);
    return out;
  }
  const pool = PS_POOL[kind + tier];
  if (pool.length) return pool;
  const own = owned().filter(c => c.tier === tier && isArtist(c) === (kind === "artist") && c.cov && !c.collector).sort((a, b) => b.rank - a.rank).slice(0, 8);
  return own;
}
function passArt(c, big = false, got = "") {
  return `<span class="ps-real${big ? " big" : ""}"${got ? ` data-got="${got}"` : ""} data-kind="${c.kind}" data-tier="${c.tier}" data-shiny="${c.shiny ? 1 : 0}" aria-hidden="true"></span>`;
}
function passIcon(r) {
  if (r.kind === "cosmetic") return `<span class="ps-cos ps-cos-${r.slot}" aria-hidden="true">${r.slot === "name" ? "Aa" : r.slot === "avatar" ? "Z" : ""}</span>`;
  if (r.kind === "streams") return `<i class="coin ps-coin" aria-hidden="true"></i>`;
  if (r.kind === "vinyls") return `<i class="vin ps-vin" aria-hidden="true"></i>`;
  if (r.kind === "title") return `<span class="ps-title-ic" aria-hidden="true">🎟️</span>`;
  if (r.kind === "big_booster") return `<span class="ps-pk-wrap" aria-hidden="true"><span class="pack mix ps-pk"><span class="pack-shine"></span><canvas class="pack-gl"></canvas><img class="pack-logo" src="brand/zikhunter-icon.svg" alt=""></span><b class="ps-x">15</b></span>`;
  if (r.kind === "boosters") return `<span class="ps-pk-wrap" aria-hidden="true"><span class="pack mix ps-pk"><span class="pack-shine"></span><canvas class="pack-gl"></canvas><img class="pack-logo" src="brand/zikhunter-icon.svg" alt=""></span><b class="ps-x">×${r.amount}</b></span>`;
  return passArt(r.card);
}
// shows the next example in every card slot (each slot starts at a different one)
let psStep = 0;
function passTick(now) {
  if (!now) psStep++;
  // the pass, and the offer of the day in the Boutique
  const els = [views.pass, views.store].filter(v => v && !v.hidden).flatMap(v => [...v.querySelectorAll(".ps-real")]);
  if (els.length && !psLoading) passLoadExamples();
  els.forEach((el, i) => {
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
// the Pass and the Vinyles shop are closed while their economy is being reworked (false = open again)
const MAINTENANCE = false;
const maintenanceCard = (title, text) => `<div class="maint"><span class="maint-ic" aria-hidden="true">🛠️</span>
  <div><p class="ps-kicker">En maintenance</p><h3>${title}</h3><p>${text}</p></div></div>`;

function passBadge() {
  const n = MAINTENANCE ? 0 : passReady(PASS.data), b = $("#passBadge");
  if (b) { b.hidden = !n; b.textContent = n; }
}

async function loadPass() {
  if (!me) return null;
  try { PASS.data = await rpc("my_season"); } catch (e) { PASS.data = null; }
  // the VIP of the season running now: a booster every 3 minutes (the server counts the same)
  const d = PASS.data, vip = d && d.premium && Date.now() < Date.parse(d.ends_at) && Date.now() >= Date.parse(d.starts_at);
  const ms = (vip ? 3 : 10) * 60 * 1000;
  if (REFILL_MS !== ms) { REFILL_MS = ms; if (typeof renderStock === "function") renderStock(); }
  passBadge(); renderVinylShop(); if (!SHOP.loaded) { SHOP.loaded = true; loadShop(); }
  return PASS.data;
}

// Season 1, "Tournée Mondiale": every tier is a date of the tour, from Paris to the final show in Los Angeles
const TOUR = ["Paris", "Bruxelles", "Genève", "Lyon", "Marseille", "Montréal", "New York", "Atlanta", "Chicago", "Houston",
  "Miami", "Mexico", "Rio", "Buenos Aires", "Lagos", "Abidjan", "Dakar", "Casablanca", "Madrid", "Lisbonne",
  "Londres", "Berlin", "Amsterdam", "Milan", "Stockholm", "Dubaï", "Mumbai", "Séoul", "Tokyo", "Los Angeles"];
const city = t => TOUR[t - 1] || "";

function daysLeft(t) {
  const s = (Date.parse(t) - Date.now()) / 1000;
  if (s <= 0) return "Saison terminée : récupère ce qu'il te reste";
  if (s < 86400) return `Fin dans ${Math.max(1, Math.ceil(s / 3600))} h`;
  return `Fin dans ${Math.ceil(s / 86400)} jours`;
}

async function renderPass() {
  const box = views.pass;
  if (!me) return;
  if (MAINTENANCE) {
    box.innerHTML = maintenanceCard("Pass Tournée", "Le pass est en cours de refonte et revient très vite. Ton XP continue de compter : rien n'est perdu.");
    return;
  }
  if (!PASS.data) box.innerHTML = `<h2>Pass Tournée</h2><p class="empty-line">Chargement du pass…</p>`;
  const d = await loadPass();
  if (!d) { box.innerHTML = `<h2>Pass Tournée</h2><p class="empty-line">Pas de saison en cours. La prochaine arrive bientôt !</p>`; return; }
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
  const premV = prem.filter(r => r.kind === "vinyls").reduce((a, r) => a + r.amount, 0);
  const premS = prem.filter(r => r.kind === "streams").reduce((a, r) => a + r.amount, 0);
  const premBig = prem.filter(r => r.kind === "big_booster").reduce((a, r) => a + r.amount, 0);
  const premTitles = prem.filter(r => r.kind === "title").map(r => r.title);
  const premCos = prem.filter(r => r.kind === "cosmetic");
  const lockedNow = d.premium ? 0 : prem.filter(r => r.tier <= tier).length;   // Premium rewards already reached, waiting for the pass
  const final = d.rewards[d.rewards.length - 1].premium;

  box.innerHTML = `

    <div class="ps-hero${d.premium ? " prem" : ""}">
      <div class="ps-hero-l">
        <p class="ps-kicker">Pass Tournée${season ? ` · ${esc(season)}` : ""}${d.premium ? ` <span class="ps-tag">VIP</span>` : ""}</p>
        <h2 class="ps-name">${esc(title)}</h2>
        <div class="ps-chips"><span>⏳ ${esc(daysLeft(d.ends_at))}</span><span>🌍 ${d.tiers} dates</span><span>${premCards.length + d.rewards.filter(r => r.free.kind === "card").length} cartes rares à gagner</span></div>
        <div class="ps-level">
          <div class="ps-ring" style="--p:${pct}"><b>${tier}</b><small>/ ${d.tiers}</small></div>
          <div class="ps-xp"><span>Palier ${tier}${max ? "" : ` <small>→ ${tier + 1} · ${esc(city(tier + 1))}</small>`}</span>
            <div class="ps-meter"><s style="width:${pct}%"></s></div>
            <small>${max ? "Tournée terminée, bravo !" : `${fmt(into)} / ${fmt(d.xp_per_tier)} XP`}</small></div>
        </div>
        ${d.premium ? "" : `<div class="ps-upsell" id="psUpsell">
          <div class="ps-up-t"><span class="ps-up-k">Billet Fosse → <b>Backstage VIP</b></span>
            <b>Un booster toutes les 3 min</b>
            <small>+ ${premBig} Éditions Deluxe de 15 cartes Rare+, une Shiny surprise, ${fmt(premV)} Vinyles, ${fmt(premS)} Streams et ${premCos.length} objets de la saison (${premCos.map(r => esc(r.name)).join(", ")})${lockedNow ? ` · <em>${lockedNow} récompense${lockedNow > 1 ? "s" : ""} VIP t'attend${lockedNow > 1 ? "ent" : ""} déjà</em>` : ""}</small></div>
          <div class="ps-up-buy"><button class="btn ps-buy" id="psBuy">Surclasser · ${PASS_PRICE}</button>
            <button class="ps-link" id="psBuyV">ou ${PREMIUM_VINYLS} <i class="vin" aria-hidden="true"></i></button></div>
        </div>`}
      </div>
      <div class="ps-hero-r">
        <p class="ps-stub"><span>Admit one</span><span>${d.premium ? "Backstage · VIP" : "Fosse"}</span></p>
        <div class="ps-show">${passArt(final.card, true)}<span class="ps-spark s1"></span><span class="ps-spark s2"></span><span class="ps-spark s3"></span></div>
        <p class="ps-show-lbl"><small>Dernière date · ${esc(city(d.tiers))}</small><b>${esc(passCardName(final.card))}</b><em>${final.card.kind === "any" ? "Mythique, Légendaire, Platine ou Diamant : la surprise est tirée au hasard" : "Exemples : la carte gagnée est tirée au hasard"}</em></p>
        <span class="ps-barcode" aria-hidden="true"></span>
      </div>
    </div>
    ${xpBox(d)}
    ${rarityBox(d)}
    <div class="ps-bar">
      <h3>Récompenses</h3>
      <button class="btn primary" id="psAll" ${ready ? "" : "disabled"}>${ready ? `Tout récupérer (${ready})` : "Rien à récupérer"}</button>
      ${d.gift_pending ? `<small class="ps-note">Une carte t'attend dans ton prochain booster : ouvre-le pour récupérer les autres.</small>` : ""}
    </div>
    <div class="ps-track" id="psTrack">
      <div class="ps-labels"><span></span><span class="gold">VIP</span><span>Gratuit</span><span></span></div>
      ${d.rewards.map(r => {
        const reached = r.tier <= tier;
        const cell = (rw, isPrem) => {
          const claimed = (isPrem ? d.claimed_premium : d.claimed_free).includes(r.tier);
          const can = reached && !claimed && (!isPrem || d.premium);
          const state = claimed ? "claimed" : can ? "ready" : (isPrem && !d.premium) ? "lock" : "wait";
          const star = rw.kind === "card" ? ` star r${rw.card.tier}${rw.card.shiny ? " shiny" : ""}` : "";
          const gk = r.tier + (isPrem ? "p" : "f"), mine = claimed && rw.kind === "card" ? PASS.got[gk] : null;
          return `<button class="ps-cell ${isPrem ? "prem" : "free"} ${state}${star}${mine ? " mine" : ""}" data-t="${r.tier}" data-p="${isPrem ? 1 : 0}" ${can ? "" : 'tabindex="-1"'}
            aria-label="Palier ${r.tier} (${esc(city(r.tier))}), ${isPrem ? "VIP" : "gratuit"} : ${esc(passName(rw))}${claimed ? ", récupéré" : can ? ", à récupérer" : ""}">
            ${rw.kind === "card" ? passArt(rw.card, false, claimed ? gk : "") : passIcon(rw)}<span class="ps-lbl">${mine ? `Ta carte : <b>${esc(mine.t)}</b>` : esc(passName(rw))}</span>
            ${claimed ? `<span class="ps-ok" aria-hidden="true">✓</span>` : state === "lock" ? `<span class="ps-lock" aria-hidden="true"></span>` : can ? `<span class="ps-go">Récupérer</span>` : ""}</button>`;
        };
        return `<div class="ps-tier${reached ? " reached" : ""}${r.tier === tier + 1 ? " next" : ""}">
          <span class="ps-n"><i style="width:${reached ? 100 : r.tier === tier + 1 ? pct : 0}%"></i><b>${r.tier}</b><em>${esc(city(r.tier))}</em></span>${cell(r.premium, true)}${cell(r.free, false)}${r.tier === tier + 1 && !max
            ? `<button class="ps-unlock" id="psTier" aria-label="Débloquer le palier ${r.tier} pour ${TIER_VINYLS} Vinyles">Débloquer · ${TIER_VINYLS} <i class="vin" aria-hidden="true"></i></button>` : "<span></span>"}</div>`;
      }).join("")}
    </div>`;

  passTick(true); passLoadExamples();
  renderCosmetics(d);
  box.querySelectorAll(".ps-pk").forEach(pk => skin(pk, classicName, {}));   // the shop's 3D booster
  const buyV = $("#psBuyV");
  if (buyV) buyV.onclick = async () => { await buyVipVinyls(); renderPass(); };
  tickCounts();
  const tierBtn = $("#psTier");
  if (tierBtn) tierBtn.onclick = () => buyTiers(1, tierBtn);
  const buy = $("#psBuy");
  if (buy) buy.onclick = () => checkout("pass", buy);
  box.querySelectorAll(".ps-cell.ready").forEach(b => b.onclick = () => claimPass([[+b.dataset.t, b.dataset.p === "1"]]));
  box.querySelectorAll(".ps-cell.lock").forEach(b => b.onclick = () => {
    const u = $("#psUpsell"); if (!u) return;
    u.scrollIntoView({ behavior: "smooth", block: "center" });
    u.classList.remove("hl"); void u.offsetWidth; u.classList.add("hl");
  });
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

// how XP is won, with this player's numbers (VIP bonus and boost included), and the XP of the day
const xpMult = d => (d?.xp_vip ? 1.5 : 1) * (d?.xp_boost || 1);
function xpBox(d) {
  if (d.xp_cap == null) return "";
  const m = xpMult(d), v = n => Math.round(n * m), pct = Math.min(100, Math.round(100 * d.xp_today / d.xp_cap));
  const until = d.xp_boost > 1 && d.xp_boost_until ? new Date(Date.parse(d.xp_boost_until) - 60000).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) + " inclus" : "";
  const rows = [["Booster ouvert", v(10)], ["Édition Deluxe ouverte", v(30)], ["GOD pack", v(100)], ["Défi du jour réussi", v(50)],
    ["Prime de connexion", v(25)], ["Succès, albums, blind test, parrainage", `+${v(2)} XP pour 10 Streams`]];
  return `<section class="ps-xpbox" aria-labelledby="psXpT">
    <div class="ps-xpday">
      <h3 id="psXpT">XP du jour</h3>
      <div class="ps-meter"><s style="width:${pct}%"></s></div>
      <small><b>${fmt(d.xp_today)}</b> / ${fmt(d.xp_cap)} XP${d.xp_today >= d.xp_cap ? " · plafond atteint, il se recharge à minuit" : " · le plafond se recharge à minuit"}</small>
      <div class="ps-xptags">${d.xp_boost > 1 ? `<span class="ps-boost">⚡ XP ×${String(d.xp_boost).replace(".", ",")}${until ? ` jusqu'au ${until}` : ""}</span>` : ""}
        ${d.xp_vip ? `<span class="ps-vipx">VIP · +50 % d'XP</span>` : `<span class="ps-vipno">Avec le VIP : +50 % d'XP et un plafond plus haut</span>`}</div>
    </div>
    <div class="ps-how">
      <h3>Comment gagner de l'XP</h3>
      <ul>${rows.map(([t, n]) => `<li><span>${t}</span><b>${typeof n === "number" ? "+" + n + " XP" : n}</b></li>`).join("")}</ul>
      <small>Les paliers se débloquent aussi avec des Vinyles. ${m > 1 ? "Les valeurs tiennent compte de tes bonus." : ""} 200 XP par palier.</small>
    </div>
  </section>`;
}
// the rarities are fixed for a season and computed again from Deezer's numbers when it ends
function rarityBox(d) {
  const dia = r => `<i style="background:${RCOL[r]}"></i>${RAR[r]}`;
  return `<section class="ps-rar" aria-labelledby="psRarT">
    <div class="ps-rar-l"><p class="ps-kicker">Raretés de saison</p>
      <h3 id="psRarT">Les raretés sont recalculées à chaque fin de saison</h3>
      <p>Pendant une saison, chaque son garde la même rareté pour tout le monde. À la fin de la saison${d.ends_at && Date.parse(d.ends_at) > Date.now() ? `, dans ${Math.ceil((Date.parse(d.ends_at) - Date.now()) / 864e5)} jours,` : ""} elles sont toutes recalculées d'après les écoutes sur Deezer : un son qui a explosé monte, un son qui s'essouffle descend.</p>
      <p><b>Tes cartes ne bougent pas :</b> une carte garde pour toujours la rareté avec laquelle tu l'as tirée. Une Légendaire d'une saison passée devient un vrai souvenir.</p></div>
    <div class="ps-rar-r" aria-hidden="true">
      <span class="ps-rar-row up"><b>Le son du moment</b><span>${dia(3)}</span><em>→</em><span>${dia(5)}</span></span>
      <span class="ps-rar-row down"><b>Le tube d'hier</b><span>${dia(5)}</span><em>→</em><span>${dia(4)}</span></span>
      <span class="ps-rar-row keep"><b>Ta carte déjà tirée</b><span>${dia(5)}</span><em>=</em><span>${dia(5)}</span></span>
    </div>
  </section>`;
}
// the XP of a booster just opened, shown on the opening scene (a guess from the pass data: the server counts the real XP)
function packXp(p, god) {
  const d = PASS.data; if (!d || d.xp_cap == null || p.pay === "vinyls" && p.g >= 0) return 0;
  const n = Math.round((god ? 100 : p.big ? 30 : 10) * xpMult(d)), left = Math.max(0, d.xp_cap - d.xp_today);
  const got = Math.min(n, left); d.xp_today += got;
  return got;
}

// "Tes objets de saison": the items received, worn or not
async function renderCosmetics(d) {
  document.getElementById("psCos")?.remove();
  let owned = [];
  try { const { data } = await sb.from("player_cosmetics").select("item"); owned = (data || []).map(r => r.item); } catch (e) {}
  const all = d.rewards.map(r => r.premium).filter(r => r.kind === "cosmetic");
  if (!all.length) return;
  const worn = me.cosmetics || {};
  const box = document.createElement("section"); box.className = "ps-cos-box"; box.id = "psCos";
  box.innerHTML = `<h3>Tes objets de saison</h3><div class="ps-cos-grid">${all.map(r => {
    const has = owned.includes(r.item), on = worn[r.slot] === r.item;
    return `<div class="ps-cos-it${has ? "" : " locked"}">${passIcon(r)}<b>${esc(r.name)}</b>
      ${has ? `<button class="ps-link" data-slot="${r.slot}" data-item="${on ? "" : r.item}">${on ? "Retirer" : "Porter"}</button>` : `<small>Pass VIP</small>`}</div>`;
  }).join("")}</div>`;
  views.pass.appendChild(box);
  box.querySelectorAll("[data-slot]").forEach(b => b.onclick = async () => {
    try { me.cosmetics = await rpc("set_cosmetic", { p_slot: b.dataset.slot, p_item: b.dataset.item || null }); }
    catch (e) { return toast(message(e)); }
    renderAccount(); renderStock?.(); renderCosmetics(d);
    toast(b.dataset.item ? "C'est porté !" : "Retiré.");
  });
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
    const g = got.filter(r => r.kind === "big_booster").reduce((a, r) => a + r.amount, 0);
    const ti = got.filter(r => r.kind === "title").map(r => `titre « ${r.title} »`)
      .concat(got.filter(r => r.kind === "cosmetic").map(r => `${r.name} (porté)`));
    const parts = [s && `${fmt(s)} Streams`, v && `${v} Vinyles`, b && `${b} booster${b > 1 ? "s" : ""}`, g && `${g} Édition${g > 1 ? "s" : ""} Deluxe (à ouvrir sur l'accueil)`, ...ti,
      c.length && `${c.join(", ")} (dans ton prochain booster)`].filter(Boolean);
    toast("Récupéré : " + parts.join(" · ") + (skippedCard ? ". Les autres cartes viendront une à une, après ton prochain booster." : "."));
    try { await loadProfile(); } catch (e) {}
    refreshViews();
    if (g && typeof bigStage === "function") { renderPass(); return setTimeout(bigStage, 400); }   // the big booster comes up at once
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
// what the shop knows of this player (my_shop): one-time offers bought, any purchase yet,
// the offer of the day, until when "Tu es en feu !" is open, boosters left before the guaranteed Mythique
const SHOP = { used: [], bought: true, daily: null, fire_until: null, pity_left: null };
async function loadShop() {
  if (!me) return;
  try { Object.assign(SHOP, await rpc("my_shop")); } catch (e) {}
  renderVinylShop(); fireBar();
  if (typeof renderStock === "function") renderStock();
}
// "2 j 14 h", "3 h 05 min", "12:04" — for the countdowns
function countdown(ms) {
  if (ms <= 0) return "0 min";
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  if (d) return `${d} j ${h} h`;
  if (h) return `${h} h ${String(m).padStart(2, "0")} min`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
function tickCounts() {
  document.querySelectorAll(".ps-count[data-end]").forEach(el => { el.textContent = countdown(Date.parse(el.dataset.end) - Date.now()); });
}
setInterval(tickCounts, 1000);


async function buyTiers(n, btn) {
  const price = tiersPrice(n);
  if ((S.vinyls || 0) < price) return toast(`Il te faut ${price} Vinyles, tu en as ${fmt(S.vinyls || 0)}.`);
  if (n > 1 && !confirm(`Débloquer ${n} paliers pour ${price} Vinyles ?`)) return;
  btn.disabled = true;
  try { const t = await rpc("buy_season_tiers", { p_count: n }); toast(n > 1 ? `${n} paliers débloqués : tu es au palier ${t} !` : `Palier ${t} débloqué !`); }
  catch (e) { toast(message(e)); }
  try { await loadProfile(); } catch (e) {}
  refreshViews(); renderPass();
}

/* ---------- stock empty: recharge, or the guaranteed Mythique now ---------- */
const PITY_PRICE = { 1: 40, 2: 55, 3: 70, 4: 85, 5: 100 };   // pity_price on the server
function stockOffers(el, on) {
  document.getElementById("stockOffers")?.remove();
  return;                                 // no offer pushed when the stock is empty (the Boutique is enough)
  const left = SHOP.pity_left ?? (PITY - S.dry), pity = PITY_PRICE[left];
  const box = document.createElement("div"); box.className = "stock-offers"; box.id = "stockOffers";
  box.innerHTML = `<p>Plus de boosters ? Continue tout de suite :</p>
    <div class="so-row">
      <button class="so-btn" data-n="10"><b>10 boosters</b><span>80 <i class="vin" aria-hidden="true"></i></span></button>
      <button class="so-btn best" data-n="25"><b>25 boosters</b><small>−10 %</small><span>180 <i class="vin" aria-hidden="true"></i></span></button>
      ${pity ? `<button class="so-btn pity" id="soPity"><b>Ta Mythique garantie, maintenant</b><small>Plus que ${left} booster${left > 1 ? "s" : ""} avant la garantie</small><span>${pity} <i class="vin" aria-hidden="true"></i></span></button>` : ""}
    </div>
    <small class="so-bal">Tu as ${fmt(S.vinyls || 0)} Vinyles · <a href="#" class="so-shop">En obtenir</a></small>`;
  box.querySelectorAll("[data-n]").forEach(b => b.onclick = () => buyStock(b, () => rpc("buy_boosters", { p_count: +b.dataset.n }), +b.dataset.n === 10 ? 80 : 180,
    () => `${b.dataset.n} boosters ajoutés !`));
  const pb = box.querySelector("#soPity");
  if (pb) pb.onclick = () => buyStock(pb, () => rpc("buy_pity"), pity, () => "Ton prochain booster contient ta Mythique garantie !");
  box.querySelector(".so-shop").onclick = e => { e.preventDefault(); show("store"); renderVinylShop(); };
  el.after(box);
}
async function buyStock(btn, call, price, done) {
  if ((S.vinyls || 0) < price) { toast(`Il te faut ${price} Vinyles, tu en as ${fmt(S.vinyls || 0)}.`); show("store"); renderVinylShop(); return; }
  btn.disabled = true;
  try { await call(); toast(done()); } catch (e) { toast(message(e)); btn.disabled = false; return; }
  try { await loadProfile(); } catch (e) {}
  refreshViews(); loadShop();
}

/* ---------- "Tu es en feu !": for one hour after a GOD pack or a Légendaire ---------- */
function afterPack(pulls, god) {
  if (!god && !pulls.some(pl => !isArtist(pl.c) && pl.c.tier === LEG)) return;
  setTimeout(loadShop, 2500);             // the server opens the offer; the bar shows once the cards are revealed
}
function fireBar() {
  document.getElementById("fireBar")?.remove();
  return;                                 // "Tu es en feu !" is off: only the welcome offer and the offer of the day
  const until = SHOP.fire_until && Date.parse(SHOP.fire_until);
  if (!me || MAINTENANCE || !until || until < Date.now()) return;
  let seen = null; try { seen = localStorage.getItem("zh-fire-closed"); } catch (e) {}
  if (seen === SHOP.fire_until) return;
  const bar = document.createElement("div"); bar.id = "fireBar"; bar.className = "fire-bar"; bar.setAttribute("role", "status");
  bar.innerHTML = `<span class="fire-ico" aria-hidden="true">🔥</span>
    <div><b>Tu es en feu !</b><small>50 boosters pour 2,99 € · encore <span class="ps-count" data-end="${esc(SHOP.fire_until)}"></span></small></div>
    <button class="vs-buy" id="fireBuy">2,99 €</button><button class="fire-x" aria-label="Fermer">×</button>`;
  document.body.appendChild(bar); tickCounts();
  bar.querySelector("#fireBuy").onclick = e => checkout("fire", e.currentTarget);
  bar.querySelector(".fire-x").onclick = () => { try { localStorage.setItem("zh-fire-closed", SHOP.fire_until); } catch (e) {} bar.remove(); };
  setTimeout(() => { if (Date.parse(SHOP.fire_until) < Date.now()) bar.remove(); }, until - Date.now() + 500);
}

// while card payments are being set up: buying goes through tyt23 on the Discord
const DISCORD_URL = "https://discord.gg/HQm87TkHX";
function payByDiscord() {
  const el = document.createElement("div"); el.className = "adm-screen";
  el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "payDcT");
  el.innerHTML = `<div class="adm-box pay-dc">
      <div class="pay-dc-ico" aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg></div>
      <h2 id="payDcT">Achats via Discord</h2>
      <p>On met en place le paiement par carte. En attendant, pour acheter le <b>Pass VIP</b>, des <b>Vinyles</b> ou une offre, rejoins le Discord Zik Hunter et envoie un <b>message privé à tyt23</b> : il s'occupe de ta commande.</p>
      <div class="pay-dc-actions"><a class="btn discord-cta" href="${DISCORD_URL}" target="_blank" rel="noopener">Rejoindre le Discord</a><button class="btn" type="button">Fermer</button></div></div>`;
  const close = () => el.remove();
  el.querySelector("button").onclick = close;
  el.addEventListener("click", e => { if (e.target === el) close(); });
  document.body.appendChild(el); el.querySelector("a").focus();
}

// a Stripe Checkout page for a pack (Edge Function create-checkout), then back to the site with ?achat=ok
async function checkout(pack, btn) {
  if (!me) return toast("Connecte-toi pour acheter.");
  if (PAY_OFF && !ADM.admin) return payByDiscord();
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
    loadShop();
    refreshViews();
    if (!views.pass.hidden) renderPass();
    if (S.vinyls !== before || PASS.data?.premium !== prem) { clearInterval(poll); toast("C'est arrivé : ton achat est sur ton compte."); }
  }, 2500);
})();
const euro = v => v.toFixed(2).replace(".", ",") + " €";
function renderVinylShop() {
  const box = $("#vinylShop");
  if (!box) return;
  if (MAINTENANCE) {
    box.innerHTML = maintenanceCard("Boutique de Vinyles", "La boutique de Vinyles est en maintenance le temps de la retravailler. Tes Vinyles sont bien gardés, et les packs de genre restent disponibles juste en dessous.");
    return;
  }
  const base = VINYL_PACKS[0].n / VINYL_PACKS[0].eur;
  box.innerHTML = `
    <div class="vs-head">
      <div><p class="ps-kicker">Monnaie rare</p><h3>Vinyles</h3>
        <p>Achète des paliers du Pass Tournée (${TIER_VINYLS} Vinyles) ou le Pass VIP (${PREMIUM_VINYLS} Vinyles).</p></div>
      ${me ? `<div class="vs-bal"><i class="vin" aria-hidden="true"></i><b>${fmt(S.vinyls || 0)}</b><small>Ton solde</small></div>` : ""}
    </div>
    ${SHOP.used.includes("welcome") ? "" : `<div class="vs-welcome">
      <span class="vs-badge">Offre de bienvenue · une seule fois</span>
      <div class="vs-stack s3" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="vs-wtxt"><b>200 Vinyles</b><small>au lieu de 2,49 €</small></div>
      <button class="vs-buy" data-pack="welcome">0,99 €</button>
    </div>`}
    ${dailyCard()}
    ${vipCard()}

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
  const vipV = box.querySelector("#vsVipV");
  if (vipV) vipV.onclick = () => buyVipVinyls();
  const vipSee = box.querySelector("#vsVipSee");
  if (vipSee) vipSee.onclick = () => { show("pass"); renderPass(); };
  tickCounts(); passTick(true);
}
// the VIP pass, in the Boutique too: a quiet card, gone once VIP
function vipCard() {
  const d = PASS.data;
  if (!me || !d || d.premium || Date.parse(d.ends_at) < Date.now()) return "";
  return `<div class="vs-vip">
    <div class="vs-dl"><span class="vs-badge">Pass VIP · ${esc(d.name.split("·").pop().trim())}</span>
      <b>Un booster toutes les 3 min</b><small>3 Éditions Deluxe de 15 cartes Rare+, une Shiny surprise, Vinyles et Streams · <a href="#" id="vsVipSee">voir le pass</a></small></div>
    <div class="vs-vip-r"><button class="vs-buy" data-pack="pass">${PASS_PRICE}</button><button class="ps-link" id="vsVipV">ou ${PREMIUM_VINYLS} <i class="vin" aria-hidden="true"></i></button></div>
  </div>`;
}
async function buyVipVinyls() {
  if ((S.vinyls || 0) < PREMIUM_VINYLS) return toast(`Il te faut ${PREMIUM_VINYLS} Vinyles, tu en as ${fmt(S.vinyls || 0)}.`);
  if (!confirm(`Passer VIP pour ${PREMIUM_VINYLS} Vinyles ?`)) return;
  try { await rpc("buy_season_premium"); toast("Bienvenue en backstage ! Toutes les récompenses VIP sont à toi."); }
  catch (e) { return toast(message(e)); }
  try { await loadProfile(); await loadPass(); } catch (e) {}
  refreshViews(); renderVinylShop();
}

// the offer of the day: a new one at midnight (Paris time), one purchase a day
function dailyCard() {
  const d = SHOP.daily;
  if (!me || !d) return "";
  const parts = [d.vinyls && `${fmt(d.vinyls)} Vinyles`, d.boosters && `${d.boosters} boosters`, d.card && `1 ${passCardName(d.card)} garanti${d.card.kind === "artist" ? "" : "e"}`].filter(Boolean);
  return `<div class="vs-daily${d.taken ? " taken" : ""}">
    ${d.card ? `<div class="vs-dcard">${passArt(d.card)}</div>` : `<div class="vs-stack s4" aria-hidden="true"><i></i><i></i><i></i><i></i></div>`}
    <div class="vs-dl"><span class="vs-badge">Offre du jour · ${d.taken ? "nouvelle offre dans" : "encore"} <span class="ps-count" data-end="${esc(d.ends_at)}"></span></span>
      <b>${esc(parts.join(" + "))}</b><small>${d.taken ? "Déjà prise aujourd'hui : reviens demain !" : "Une seule fois aujourd'hui"}</small></div>
    ${d.taken ? "" : `<button class="vs-buy" data-pack="${esc(d.id)}">${euro(d.cents / 100)}</button>`}
  </div>`;
}

renderVinylShop();
addEventListener("click", e => { if (e.target.closest?.("#tab-store")) renderVinylShop(); }, true);

// the badge on the tab: refreshed at sign-in and after each booster
const passWatch = () => { if (me) loadPass(); };
setInterval(passWatch, 120000);
Object.assign(Online, { renderPass, loadPass, stockOffers, afterPack, loadShop });
