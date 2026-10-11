"use strict";
/* Zik Hunter — the season pass. 30 tiers a season, a free reward and a Premium one per tier. XP comes from playing
   (boosters, daily bonus, challenges, albums…), counted by the server; this file shows the pass and claims rewards. */

const PASS = { data: null, busy: false };
const PASS_PRICE = "4,99 €";

const passCardName = c => (c.kind === "artist" ? (c.tier === 5 ? "Artiste Diamant" : "Artiste Platine") : (c.tier === 5 ? "Légendaire" : "Mythique"))
  + (c.shiny ? " Shiny" : "");
const passName = r => r.kind === "streams" ? `${fmt(r.amount)} Streams` : r.kind === "boosters" ? `${r.amount} boosters` : passCardName(r.card);
// the reward pictures: a coin, a stack of boosters, a card in its rarity, or a record for an artist
function passArt(c, big = false) {
  const cls = `${c.kind === "artist" ? "ps-disc" : "ps-mini"} t${c.tier}${c.shiny ? " shiny" : ""}${big ? " big" : ""}`;
  return c.kind === "artist" ? `<span class="${cls}" aria-hidden="true"><i></i></span>` : `<span class="${cls}" aria-hidden="true"><i></i><em></em></span>`;
}
function passIcon(r) {
  if (r.kind === "streams") return `<i class="coin ps-coin" aria-hidden="true"></i>`;
  if (r.kind === "boosters") return `<span class="ps-pack" aria-hidden="true"><b>×${r.amount}</b></span>`;
  return passArt(r.card);
}

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
  passBadge();
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
      </div>
      <div class="ps-hero-r">
        <div class="ps-show">${passArt(final.card, true)}<span class="ps-spark s1"></span><span class="ps-spark s2"></span><span class="ps-spark s3"></span></div>
        <p class="ps-show-lbl"><small>Récompense finale · palier ${d.tiers}</small><b>${esc(passCardName(final.card))}</b></p>
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
          return `<button class="ps-cell ${isPrem ? "prem" : "free"} ${state}${star}" data-t="${r.tier}" data-p="${isPrem ? 1 : 0}" ${can ? "" : 'tabindex="-1"'}
            aria-label="Palier ${r.tier}, ${isPrem ? "Premium" : "gratuit"} : ${esc(passName(rw))}${claimed ? ", récupéré" : can ? ", à récupérer" : ""}">
            ${passIcon(rw)}<span class="ps-lbl">${esc(passName(rw))}</span>
            ${claimed ? `<span class="ps-ok" aria-hidden="true">✓</span>` : state === "lock" ? `<span class="ps-lock" aria-hidden="true"></span>` : can ? `<span class="ps-go">Récupérer</span>` : ""}</button>`;
        };
        return `<div class="ps-tier${reached ? " reached" : ""}${r.tier === tier + 1 ? " next" : ""}">
          <span class="ps-n"><i style="width:${reached ? 100 : r.tier === tier + 1 ? pct : 0}%"></i><b>${r.tier}</b></span>${cell(r.free, false)}${cell(r.premium, true)}</div>`;
      }).join("")}
    </div>`;

  const buy = $("#psBuy");
  if (buy) buy.onclick = () => toast("Le paiement arrive très bientôt ! En attendant, demande le Pass Premium à l'équipe sur Discord.");
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
    const c = got.filter(r => r.kind === "card").map(r => passCardName(r.card));
    const parts = [s && `${fmt(s)} Streams`, b && `${b} booster${b > 1 ? "s" : ""}`, c.length && `${c.join(", ")} (dans ton prochain booster)`].filter(Boolean);
    toast("Récupéré : " + parts.join(" · ") + (skippedCard ? ". Les autres cartes viendront une à une, après ton prochain booster." : "."));
    try { await loadProfile(); } catch (e) {}
    refreshViews();
  }
  if (stop) toast(message(stop));
  renderPass();
}

// the badge on the tab: refreshed at sign-in and after each booster
const passWatch = () => { if (me) loadPass(); };
setInterval(passWatch, 120000);
Object.assign(Online, { renderPass, loadPass });
