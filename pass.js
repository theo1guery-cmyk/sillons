"use strict";
/* Zik Hunter — the season pass. 30 tiers a season, a free reward and a Premium one per tier. XP comes from playing
   (boosters, daily bonus, challenges, albums…), counted by the server; this file shows the pass and claims rewards. */

const PASS = { data: null, busy: false };
const PASS_PRICE = "4,99 €";

const passCardName = c => (c.kind === "artist" ? (c.tier === 5 ? "Artiste Diamant" : "Artiste Platine") : (c.tier === 5 ? "Légendaire" : "Mythique"))
  + (c.shiny ? " Shiny" : "");
const passName = r => r.kind === "streams" ? `${fmt(r.amount)} Streams` : r.kind === "boosters" ? `${r.amount} boosters` : passCardName(r.card);
// the reward pictures: a coin, a booster, a card outlined in its rarity, or a record for an artist
function passArt(c, big = false) {
  if (c.kind === "artist") return `<span class="ps-disc t${c.tier}${c.shiny ? " shiny" : ""}${big ? " big" : ""}" aria-hidden="true"><i></i></span>`;
  return `<span class="ps-mini t${c.tier}${c.shiny ? " shiny" : ""}" aria-hidden="true"><i></i></span>`;
}
function passIcon(r) {
  if (r.kind === "streams") return `<i class="coin ps-coin" aria-hidden="true"></i>`;
  if (r.kind === "boosters") return `<span class="ps-pack" aria-hidden="true"></span>`;
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

const two = n => String(n).padStart(2, "0");
async function renderPass() {
  const box = views.pass;
  if (!me) return;
  if (!PASS.data) box.innerHTML = `<h2>Pass saisonnier</h2><p class="empty-line">Chargement du pass…</p>`;
  const d = await loadPass();
  if (!d) { box.innerHTML = `<h2>Pass saisonnier</h2><p class="empty-line">Pas de saison en cours. La prochaine arrive bientôt.</p>`; return; }
  const tier = passTier(d), into = d.xp - tier * d.xp_per_tier, max = tier >= d.tiers, pct = max ? 100 : Math.round(100 * into / d.xp_per_tier);
  const ready = passReady(d);
  const [season, title] = d.name.includes("·") ? d.name.split("·").map(x => x.trim()) : ["", d.name];
  const words = title.split(" "), last = words.pop();
  const prem = d.rewards.map(r => ({ tier: r.tier, ...r.premium }));
  const premCards = prem.filter(r => r.kind === "card");
  const nBoost = prem.filter(r => r.kind === "boosters").reduce((a, r) => a + r.amount, 0);
  const nStreams = prem.filter(r => r.kind === "streams").reduce((a, r) => a + r.amount, 0);
  const lockedNow = d.premium ? 0 : prem.filter(r => r.tier <= tier).length;
  const final = d.rewards[d.rewards.length - 1].premium;
  const left = Math.max(0, Math.ceil((Date.parse(d.ends_at) - Date.now()) / 864e5));

  box.innerHTML = `
    <div class="ps-hero">
      <div class="ps-hero-l">
        <p class="ps-eyebrow">${esc(season || "Saison")} <span>—</span> Pass${d.premium ? ` <b>Premium</b>` : ""}</p>
        <h2 class="ps-title">${esc(words.join(" "))} <em>${esc(last)}</em></h2>
        <p class="ps-meta">${left ? `${left} jour${left > 1 ? "s" : ""} restant${left > 1 ? "s" : ""}` : "Saison terminée"} <span>·</span> ${d.tiers} paliers <span>·</span> ${fmt(d.xp)} XP</p>
        <div class="ps-prog">
          <div class="ps-big"><b>${two(tier)}</b><small>/ ${d.tiers}</small></div>
          <div class="ps-prog-r">
            <div class="ps-line"><s style="width:${pct}%"></s></div>
            <p>${max ? "Pass terminé." : `${fmt(into)} / ${fmt(d.xp_per_tier)} XP avant le palier ${tier + 1}`}</p>
          </div>
        </div>
      </div>
      <figure class="ps-hero-r">
        <div class="ps-object">${passArt(final.card, true)}<span class="ps-sleeve"></span></div>
        <figcaption><span>Palier ${d.tiers}</span>${esc(passCardName(final.card))}</figcaption>
      </figure>
    </div>

    ${d.premium ? "" : `
    <div class="ps-offer">
      <div class="ps-offer-l">
        <p class="ps-eyebrow">Pass Premium</p>
        <h3 class="ps-title sm">Toute la saison, <em>en double.</em></h3>
        <div class="ps-stats">
          <div><b>${premCards.length}</b><small>cartes rares garanties</small></div>
          <div><b>${nBoost}</b><small>boosters en plus</small></div>
          <div><b>${fmt(nStreams)}</b><small>Streams en plus</small></div>
        </div>
        <p class="ps-fine">Légendaire dès le palier 5, Shiny, artistes Platine et Diamant.${lockedNow ? ` <b>${lockedNow} récompense${lockedNow > 1 ? "s" : ""} Premium</b> ${lockedNow > 1 ? "sont" : "est"} déjà débloquée${lockedNow > 1 ? "s" : ""} et t'attend${lockedNow > 1 ? "ent" : ""}.` : ""}</p>
      </div>
      <div class="ps-offer-r">
        <p class="ps-price">${PASS_PRICE}</p>
        <small>la saison, sans engagement</small>
        <button class="ps-buy" id="psBuy">Passer Premium</button>
      </div>
    </div>`}

    <div class="ps-bar">
      <p class="ps-eyebrow">Récompenses</p>
      <button class="ps-claim" id="psAll" ${ready ? "" : "disabled"}>${ready ? `Tout récupérer <span>${ready}</span>` : "Tout est récupéré"}</button>
      ${d.gift_pending ? `<small class="ps-note">Une carte t'attend dans ton prochain booster. Ouvre-le pour récupérer les suivantes.</small>` : ""}
    </div>
    <div class="ps-track" id="psTrack">
      <div class="ps-labels"><span></span><span>Gratuit</span><span>Premium</span></div>
      ${d.rewards.map(r => {
        const reached = r.tier <= tier;
        const cell = (rw, isPrem) => {
          const claimed = (isPrem ? d.claimed_premium : d.claimed_free).includes(r.tier);
          const can = reached && !claimed && (!isPrem || d.premium);
          const state = claimed ? "claimed" : can ? "ready" : (isPrem && !d.premium) ? "lock" : "wait";
          return `<button class="ps-cell ${isPrem ? "prem" : "free"} ${state}${rw.kind === "card" ? " star" : ""}" data-t="${r.tier}" data-p="${isPrem ? 1 : 0}" ${can ? "" : 'tabindex="-1"'}
            aria-label="Palier ${r.tier}, ${isPrem ? "Premium" : "gratuit"} : ${esc(passName(rw))}${claimed ? ", récupéré" : can ? ", à récupérer" : ""}">
            ${passIcon(rw)}<span class="ps-lbl">${esc(passName(rw))}</span>
            <span class="ps-state">${claimed ? "Récupéré" : can ? "Récupérer" : state === "lock" ? "Premium" : ""}</span></button>`;
        };
        return `<div class="ps-tier${reached ? " reached" : ""}${r.tier === tier + 1 ? " next" : ""}">
          <span class="ps-n"><b>${two(r.tier)}</b><i style="width:${reached ? 100 : r.tier === tier + 1 ? pct : 0}%"></i></span>${cell(r.free, false)}${cell(r.premium, true)}</div>`;
      }).join("")}
    </div>`;

  const buy = $("#psBuy");
  if (buy) buy.onclick = () => toast("Le paiement arrive très bientôt. En attendant, demande le Pass Premium à l'équipe sur Discord.");
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
