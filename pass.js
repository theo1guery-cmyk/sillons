"use strict";
/* Zik Hunter — the season pass. 30 tiers a season, a free reward and a Premium one per tier. XP comes from playing
   (boosters, daily bonus, challenges, albums…), counted by the server; this file shows the pass and claims rewards. */

const PASS = { data: null, busy: false };
const PASS_PRICE = "4,99 €";

const passCardName = c => (c.kind === "artist" ? (c.tier === 5 ? "Artiste Diamant" : "Artiste Platine") : (c.tier === 5 ? "Légendaire" : "Mythique"))
  + (c.shiny ? " Shiny" : "");
const passName = r => r.kind === "streams" ? `${fmt(r.amount)} Streams` : r.kind === "boosters" ? `${r.amount} boosters` : passCardName(r.card);
function passIcon(r) {
  if (r.kind === "streams") return `<i class="coin ps-coin" aria-hidden="true"></i>`;
  if (r.kind === "boosters") return `<span class="ps-ico ps-pack" aria-hidden="true"><b>${r.amount}</b></span>`;
  const c = r.card;
  return `<span class="ps-ico ps-card ${c.kind === "artist" ? "art" : "trk"} t${c.tier}${c.shiny ? " shiny" : ""}" aria-hidden="true"></span>`;
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
  const tier = passTier(d), into = d.xp - tier * d.xp_per_tier, max = tier >= d.tiers;
  const ready = passReady(d);
  box.innerHTML = `
    <div class="ps-head${d.premium ? " prem" : ""}">
      <div class="ps-title">
        <p class="ps-kicker">Pass saisonnier${d.premium ? ` · <b>Premium</b>` : ""}</p>
        <h2>${esc(d.name)}</h2>
        <p class="ps-ends">${esc(daysLeft(d.ends_at))}</p>
      </div>
      <div class="ps-level">
        <div class="ps-ring" style="--p:${max ? 100 : Math.round(100 * into / d.xp_per_tier)}"><b>${tier}</b><small>/ ${d.tiers}</small></div>
        <div class="ps-xp"><span>Palier ${tier}</span><div class="meter"><s style="width:${max ? 100 : 100 * into / d.xp_per_tier}%"></s></div>
          <small>${max ? "Pass terminé, bravo !" : `${fmt(into)} / ${fmt(d.xp_per_tier)} XP avant le palier ${tier + 1}`}</small></div>
      </div>
      ${d.premium ? `<div class="ps-premium on"><b>Pass Premium actif</b><small>Toutes les récompenses dorées sont à toi.</small></div>`
        : `<div class="ps-premium"><b>Pass Premium</b><small>Une Légendaire dès le palier 5, Shiny, artistes Platine et Diamant, et 2 fois plus de récompenses.</small>
            <button class="btn primary" id="psBuy">Débloquer · ${PASS_PRICE}</button></div>`}
    </div>
    <p class="sub">Gagne de l'XP en jouant : <b>5 XP</b> par booster ouvert, <b>+50</b> pour un GOD pack, et <b>1 XP pour 10 Streams</b> gagnés avec la prime du jour, les défis, les albums et les succès. Chaque palier débloque une récompense gratuite, et une récompense Premium.</p>
    <div class="ps-bar"><button class="btn primary" id="psAll" ${ready ? "" : "disabled"}>Tout récupérer${ready ? ` (${ready})` : ""}</button>
      ${d.gift_pending ? `<small class="ps-note">Une carte t'attend dans ton prochain booster : ouvre-le pour pouvoir récupérer les autres cartes.</small>` : ""}</div>
    <div class="ps-track" id="psTrack">
      <div class="ps-labels"><span></span><span>Gratuit</span><span class="gold">Premium</span></div>
      ${d.rewards.map(r => {
        const reached = r.tier <= tier;
        const cell = (rw, prem) => {
          const claimed = (prem ? d.claimed_premium : d.claimed_free).includes(r.tier);
          const can = reached && !claimed && (!prem || d.premium);
          const state = claimed ? "claimed" : can ? "ready" : (prem && !d.premium) ? "lock" : "wait";
          const big = rw.kind === "card" ? " big" : "";
          return `<button class="ps-cell ${prem ? "prem" : "free"} ${state}${big}" data-t="${r.tier}" data-p="${prem ? 1 : 0}" ${can ? "" : "tabindex=\"-1\""}
            aria-label="Palier ${r.tier}, ${prem ? "Premium" : "gratuit"} : ${esc(passName(rw))}${claimed ? ", récupéré" : can ? ", à récupérer" : ""}">
            ${passIcon(rw)}<span class="ps-lbl">${esc(passName(rw))}</span>${claimed ? `<span class="ps-ok" aria-hidden="true">✓</span>` : state === "lock" ? `<span class="ps-lock" aria-hidden="true"></span>` : ""}</button>`;
        };
        return `<div class="ps-tier${reached ? " reached" : ""}${r.tier === tier + 1 ? " next" : ""}"><span class="ps-n">${r.tier}</span>${cell(r.free, false)}${cell(r.premium, true)}</div>`;
      }).join("")}
    </div>`;

  const buy = $("#psBuy");
  if (buy) buy.onclick = () => toast("Le paiement arrive très bientôt ! En attendant, demande le Pass Premium à l'équipe sur Discord.");
  box.querySelectorAll(".ps-cell.ready").forEach(b => b.onclick = () => claimPass([[+b.dataset.t, b.dataset.p === "1"]]));
  $("#psAll").onclick = () => {
    const list = [];
    for (let i = 1; i <= tier; i++) {
      if (!d.claimed_free.includes(i)) list.push([i, false]);
      if (d.premium && !d.claimed_premium.includes(i)) list.push([i, true]);
    }
    claimPass(list);
  };
  // the track opens on the next tier to reach
  const next = box.querySelector(".ps-tier.next") || box.querySelector(".ps-tier.reached:last-of-type");
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
