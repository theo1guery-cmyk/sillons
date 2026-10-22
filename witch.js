"use strict";
/* Zik Hunter — Halloween at the witch's (only while the event is on, with an account): pumpkins won with the quests of
   the day, the transmutation cauldron (5 cards of a rarity → 1 of the next) and the restoration elixir (+1 to a graded
   card, never above 9). The server decides everything; this file shows the page and the two magic films. */
const W = { st: null, tier: 2, sel: [], elix: null, busy: false };
const CAULDRON = { 2: [3, 20, 100], 3: [4, 40, 100], 4: [5, 80, 50] };   // from: [to, pumpkins, % of success]
const ELIXIR = g => g <= 5 ? 70 : g === 6 ? 50 : g === 7 ? 35 : g === 8 ? 20 : 0;

function witchTab() {
  const on = EVENT.on === "halloween" && Online.active;
  $("#tab-witch").hidden = !on;
  if (!on && !views.witch.hidden) show("shop");
}
setInterval(witchTab, 3000);

async function renderWitch() {
  if (!me) return;
  try { W.st = await rpc("halloween_state"); } catch (e) { return toast(message(e)); }
  const st = W.st, box = views.witch;
  if (!st.active) { box.innerHTML = `<h2>Le chaudron est froid</h2><p class="sub">La sorcière revient au prochain événement.</p>`; return; }
  box.innerHTML = `<h2>Chez la sorcière <button class="ps-link wz-replay" id="wzIntro">▶ Revoir l'annonce</button></h2>
    <p class="sub">Gagne des citrouilles avec les quêtes de la nuit, puis fais bouillir tes cartes dans le chaudron ou verse l'élixir sur tes cartes gradées. La magie ne dure que pendant l'événement.</p>
    <div class="wz-top">
      <div class="wz-purse"><span class="wz-pk" aria-hidden="true">🎃</span><b id="wzPk">${fmt(st.pumpkins)}</b><small>citrouilles</small></div>
      <div class="wz-quests">${st.quests.map(q => `<div class="wz-q${q.claimed ? " done" : q.progress >= q.goal ? " ready" : ""}">
          <span>${esc(q.label)}</span><div class="meter"><s style="width:${Math.round(100 * q.progress / q.goal)}%"></s></div>
          <small>${q.progress} / ${q.goal}</small>
          ${q.claimed ? `<em>✓ +${q.reward} 🎃</em>` : q.progress >= q.goal ? `<button class="btn primary" data-q="${q.key}">+${q.reward} 🎃</button>` : `<em>+${q.reward} 🎃</em>`}</div>`).join("")}
        <p class="wz-note">Les quêtes reviennent chaque jour à minuit.</p></div>
    </div>
    <section class="wz-sec hx-sec" id="hxSec" aria-labelledby="hxT"></section>
    <section class="wz-sec wz-shop" aria-labelledby="wzShopT">
      <h3 id="wzShopT">Le marché aux citrouilles</h3>
      <p class="sub">Besoin de plus de magie ? Les citrouilles servent au chaudron et à l'élixir, et seulement pendant l'événement : dépense-les avant la fin.</p>
      <div class="wz-packs" id="wzPacks"></div>
    </section>
    <section class="wz-sec" aria-labelledby="wzCauldT">
      <h3 id="wzCauldT">Chaudron de transmutation</h3>
      <p class="sub">Jette 5 titres de la même rareté : il en sort un titre de la rareté au-dessus. Les cartes Shiny, gradées ou de collection ne vont pas dans le chaudron.</p>
      <div class="wz-recipes">${[2, 3, 4].map(t => `<button class="wz-rec${W.tier === t ? " on" : ""}" data-t="${t}" style="--a:${RCOL[t]};--b:${RCOL[t + 1]}">
          <span><i style="background:${RCOL[t]}"></i>5 ${RAR[t]}s</span><b>→ ${RAR[t + 1]}${CAULDRON[t][2] < 100 ? ` <small>(${CAULDRON[t][2]} %)</small>` : ""}</b><em>${CAULDRON[t][1]} 🎃</em></button>`).join("")}</div>
      <div class="wz-pot">
        <div class="wz-slots">${Array.from({ length: 5 }, (_, i) => `<div class="wz-slot" data-i="${i}"></div>`).join("")}</div>
        <button class="btn primary wz-brew" id="wzBrew" disabled>Lancer la potion · ${CAULDRON[W.tier][1]} 🎃</button>
      </div>
      <div class="wz-pick" id="wzPick"></div>
    </section>
    <section class="wz-sec" aria-labelledby="wzElixT">
      <h3 id="wzElixT">Élixir de restauration · 30 🎃</h3>
      <p class="sub">Verse-le sur une carte gradée : elle tente de gagner +1 à sa note (jamais au-delà de 9). Si ça rate, tu ne perds que les citrouilles : la note, la boîte et son numéro restent.</p>
      <div class="wz-elix" id="wzElix"></div>
    </section>`;
  box.querySelectorAll("[data-q]").forEach(b => b.onclick = async () => {
    try { const n = await rpc("halloween_claim", { p_key: b.dataset.q }); toast(`+${n} 🎃 !`); renderWitch(); } catch (e) { toast(message(e)); }
  });
  $("#wzIntro").onclick = () => window.halloweenIntro?.();
  box.querySelectorAll(".wz-rec").forEach(b => b.onclick = () => { W.tier = +b.dataset.t; W.sel = []; renderWitch(); });
  drawPot(); drawElixir(); drawPumpkinShop(); drawHaunted($("#hxSec"));
}
// the pumpkin packs: paid in euros (Stripe, or through the Discord while card payments are off) or in Vinyles
async function drawPumpkinShop() {
  const box = $("#wzPacks"); if (!box) return;
  let packs = []; try { packs = await rpc("pumpkin_packs"); } catch (e) {}
  if (!packs.length) { box.closest(".wz-shop").remove(); return; }
  const base = packs[0].pumpkins / packs[0].cents;
  box.innerHTML = packs.map((p, i) => { const bonus = Math.round((p.pumpkins / p.cents / base - 1) * 100);
    return `<div class="wz-pack${i === 2 ? " hot" : ""}">${i === 2 ? `<span class="wz-tag">Populaire</span>` : ""}
      <span class="wz-pile" aria-hidden="true">${"🎃".repeat(Math.min(i + 1, 4))}</span>
      <b>${fmt(p.pumpkins)}</b><small>citrouilles</small>${bonus > 0 ? `<em>+${bonus} % offertes</em>` : `<em class="none">&nbsp;</em>`}
      <button class="vs-buy" data-eur="${esc(p.id)}">${euro(p.cents / 100)}</button>
      ${p.vinyls ? `<button class="ps-link" data-vin="${esc(p.id)}" data-n="${p.vinyls}">ou ${fmt(p.vinyls)} <i class="vin" aria-hidden="true"></i></button>` : ""}</div>`; }).join("");
  box.querySelectorAll("[data-eur]").forEach(b => b.onclick = () => checkout(b.dataset.eur, b));
  box.querySelectorAll("[data-vin]").forEach(b => b.onclick = async () => {
    const n = +b.dataset.n;
    if ((S.vinyls || 0) < n) return toast(`Il te faut ${fmt(n)} Vinyles, tu en as ${fmt(S.vinyls || 0)}.`);
    if (!confirm(`Acheter ces citrouilles pour ${fmt(n)} Vinyles ?`)) return;
    b.disabled = true;
    try { const pk = await rpc("buy_pumpkins", { p_pack: b.dataset.vin }); toast(`Tu as maintenant ${fmt(pk)} 🎃 !`); }
    catch (e) { toast(message(e)); b.disabled = false; return; }
    try { await loadProfile(); } catch (e) {}
    refreshViews(); renderWitch();
  });
}
// the cards that can go in the cauldron: track copies of the rarity, not Shiny, graded nor collector
function potCopies() {
  const out = [];
  for (const c of Object.values(S.c)) {
    if (isArtist(c) || c.tier !== W.tier || c.collector) continue;
    for (const cp of c.copies || []) if (!cp.grade && !cp.holo && !cp.collector) out.push([c, cp]);
  }
  return out.sort((a, b) => (b[0].n || 1) - (a[0].n || 1) || a[0].rank - b[0].rank);
}
function drawPot() {
  const pick = $("#wzPick"); if (!pick) return;
  const list = potCopies(), chosen = new Set(W.sel.map(([, cp]) => cp.id));
  pick.innerHTML = list.length ? "" : `<p class="empty-line">Aucun titre ${RAR[W.tier]} disponible pour le chaudron.</p>`;
  for (const [c, cp] of list.slice(0, 400)) {
    const b = document.createElement("button"); b.className = "wz-card" + (chosen.has(cp.id) ? " on" : "");
    b.appendChild(cardEl(c, false));
    if ((c.n || 1) > 1) b.insertAdjacentHTML("beforeend", `<span class="wz-dup">×${c.n}</span>`);
    else b.insertAdjacentHTML("beforeend", `<span class="wz-last">dernière</span>`);
    b.onclick = () => {
      const i = W.sel.findIndex(([, x]) => x.id === cp.id);
      if (i >= 0) W.sel.splice(i, 1); else if (W.sel.length < 5) W.sel.push([c, cp]); else return toast("Le chaudron prend 5 cartes.");
      drawPot();
    };
    pick.appendChild(b);
  }
  document.querySelectorAll(".wz-slot").forEach((s, i) => { s.innerHTML = ""; const x = W.sel[i]; if (x) s.appendChild(cardEl(x[0], false)); s.classList.toggle("on", !!x); });
  const brew = $("#wzBrew"), price = CAULDRON[W.tier][1];
  brew.disabled = W.sel.length !== 5 || W.st.pumpkins < price || W.busy;
  brew.textContent = W.sel.length < 5 ? `Choisis encore ${5 - W.sel.length} carte${5 - W.sel.length > 1 ? "s" : ""}` : W.st.pumpkins < price ? `Il te faut ${price} 🎃` : `Lancer la potion · ${price} 🎃`;
  brew.onclick = brewPotion;
}
function drawElixir() {
  const box = $("#wzElix"); if (!box) return;
  const list = [];
  // every graded card: those under 9 can drink the elixir, the others are shown at their maximum
  for (const c of Object.values(S.c)) for (const cp of c.copies || []) if (cp.grade) list.push([c, cp]);
  list.sort((a, b) => (a[1].grade >= 9) - (b[1].grade >= 9) || b[1].grade - a[1].grade || b[0].tier - a[0].tier);
  box.innerHTML = list.length ? "" : `<p class="empty-line">Aucune carte gradée. Fais grader une carte dans l'onglet Gradation.</p>`;
  for (const [c, cp] of list) {
    const max = cp.grade >= 9;
    const w = document.createElement("div"); w.className = "wz-gr" + (max ? " max" : "");
    w.appendChild(slabEl(c, !!cp.holo && c.tier >= MYTH, cp));
    w.insertAdjacentHTML("beforeend", max ? `<p>${cp.grade === 10 ? "Gem Mint 10 : déjà parfaite" : "Déjà au maximum de l'élixir (9)"}</p>`
      : `<p><b>${cp.grade} → ${cp.grade + 1}</b> · ${ELIXIR(cp.grade)} % de chances</p>`);
    if (!max) {
      const b = document.createElement("button"); b.className = "btn"; b.textContent = "Verser l'élixir · 30 🎃";
      b.disabled = W.st.pumpkins < 30; b.onclick = () => pourElixir(c, cp);
      w.appendChild(b);
    }
    box.appendChild(w);
  }
}

/* ---------- the cauldron: the cards fall in one by one, the potion boils, a new card rises from the smoke ---------- */
const POT_SVG = `<svg class="wz-cauldron" viewBox="0 0 220 190" aria-hidden="true">
  <defs><radialGradient id="wzLiq" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="var(--liq2)"/><stop offset="1" stop-color="var(--liq)"/></radialGradient>
    <linearGradient id="wzPot" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2a2233"/><stop offset="1" stop-color="#0b080f"/></linearGradient></defs>
  <g class="wz-fire"><path d="M70 186c-6-14 6-20 2-34 12 10 14 22 8 34z"/><path d="M100 188c-8-18 8-26 2-44 16 14 18 30 8 44z"/><path d="M134 186c-6-14 6-22 0-36 14 12 16 24 8 36z"/><path d="M156 186c-4-10 4-14 2-24 9 8 10 16 5 24z"/></g>
  <path d="M36 70 C30 150 70 172 110 172 C150 172 190 150 184 70 Z" fill="url(#wzPot)" stroke="#000" stroke-width="2"/>
  <path d="M60 160 l-10 22 M160 160 l10 22" stroke="#0b080f" stroke-width="8" stroke-linecap="round"/>
  <ellipse class="wz-liq" cx="110" cy="70" rx="72" ry="16" fill="url(#wzLiq)"/>
  <ellipse cx="110" cy="66" rx="80" ry="12" fill="none" stroke="#3a3044" stroke-width="10"/>
  <ellipse cx="110" cy="64" rx="80" ry="12" fill="none" stroke="#6a5a7a" stroke-width="2" opacity=".6"/>
</svg>`;
function wzScreen(cls) {
  const scr = document.createElement("div"); scr.className = "wz-screen " + cls; scr.setAttribute("role", "dialog"); scr.setAttribute("aria-modal", "true");
  document.body.appendChild(scr); document.body.classList.add("fx-on"); void scr.offsetWidth; scr.classList.add("on");
  return scr;
}
const wzWait = ms => new Promise(r => setTimeout(r, ms));
const wzTap = scr => new Promise(r => { const done = e => { if (e.type === "keydown" && !["Enter", " ", "Escape"].includes(e.key)) return;
  removeEventListener("keydown", done, true); scr.removeEventListener("click", done); r(); }; scr.addEventListener("click", done); addEventListener("keydown", done, true); });
async function wzClose(scr) { scr.classList.remove("on"); await wzWait(350); scr.remove(); document.body.classList.remove("fx-on"); }

async function brewPotion() {
  if (W.busy || W.sel.length !== 5) return;
  W.busy = true;
  const sel = W.sel.slice(), from = W.tier;
  const scr = wzScreen("brew");
  scr.style.setProperty("--liq", "#1f9a4a"); scr.style.setProperty("--liq2", "#8dff7a");
  scr.innerHTML = `<div class="wz-row">${sel.map(([c]) => `<div class="wz-fly"></div>`).join("")}</div>
    <div class="wz-stage">${POT_SVG}<div class="wz-bubbles">${Array.from({ length: 14 }, (_, i) => `<i style="--x:${10 + Math.random() * 80}%;--d:${(1 + Math.random() * 1.4).toFixed(2)}s;--w:${(-Math.random() * 2).toFixed(2)}s"></i>`).join("")}</div>
      <div class="wz-steam"></div><div class="wz-out"></div></div>
    <div class="wz-title" aria-live="polite"></div><p class="wz-hint"></p>`;
  scr.querySelectorAll(".wz-fly").forEach((f, i) => f.appendChild(cardEl(sel[i][0], false)));
  const res = rpc("cauldron_brew", { p_cards: sel.map(([, cp]) => cp.id) });   // asked now, shown at the end
  await wzWait(700);
  const pot = scr.querySelector(".wz-cauldron").getBoundingClientRect(), px = pot.left + pot.width / 2, py = pot.top + pot.height * .36;
  for (const f of scr.querySelectorAll(".wz-fly")) {          // 1. one card after the other into the potion
    const r = f.getBoundingClientRect();
    f.style.setProperty("--tx", (px - (r.left + r.width / 2)) + "px"); f.style.setProperty("--ty", (py - (r.top + r.height / 2)) + "px");
    f.classList.add("in"); await wzWait(380);
    scr.classList.remove("splash"); void scr.offsetWidth; scr.classList.add("splash");
  }
  let out, err = null;
  scr.classList.add("boil"); scr.querySelector(".wz-hint").textContent = "La potion bout…";   // 2. it boils
  try { [out] = await Promise.all([res, wzWait(1800)]); } catch (e) { err = e; }
  if (err) { await wzClose(scr); W.busy = false; toast(message(err)); return; }
  const col = RCOL[out.tier];
  scr.style.setProperty("--liq", col); scr.style.setProperty("--liq2", "#fff");
  await wzWait(500);
  scr.classList.add("wzflash"); scr.querySelector(".wz-hint").textContent = "";   // 3. a flash, and the card rises from the smoke
  const card = cardFromRow({ kind: "track", track_id: out.card.track_id, tier: out.tier, rank: out.card.rank, holo: false },
    { title: out.card.title, artist: out.card.artist, album: out.card.album, cover: out.card.cover, duration: out.card.duration, bpm: out.card.bpm,
      year: out.card.year, explicit: out.card.explicit, genre: out.card.genre });
  const o = scr.querySelector(".wz-out"); o.style.setProperty("--rc", col); o.appendChild(cardEl(card, false));
  await wzWait(250); o.classList.add("up");
  await wzWait(1100);
  scr.querySelector(".wz-title").innerHTML = out.success
    ? `<b style="--rc:${col}">${RAR[out.tier]} !</b><small>${out.card.new ? "Nouvelle carte" : "Doublon"} · ${esc(card.t)} · ${esc(card.a)}</small>`
    : `<b class="miss">La potion a tourné…</b><small>Pas de Légendaire cette fois : une ${RAR[out.tier]} sort du chaudron · ${esc(card.t)}</small>`;
  scr.querySelector(".wz-hint").textContent = "Touche pour continuer";
  // the collection: the 5 cards are gone, the new one is in
  const gone = new Set(sel.map(([, cp]) => cp.id));
  for (const [k, c] of Object.entries(S.c)) {
    const before = (c.copies || []).length; if (!before) continue;
    c.copies = c.copies.filter(cp => !gone.has(cp.id));
    if (c.copies.length !== before) { c.n = c.copies.length; if (!c.n) delete S.c[k]; }
  }
  addCopy(S.c, { id: out.card.id, kind: "track", track_id: out.card.track_id, tier: out.tier, rank: out.card.rank, holo: false, tradeable: true,
    pulled_at: new Date().toISOString() }, { title: out.card.title, artist: out.card.artist, album: out.card.album, cover: out.card.cover,
    duration: out.card.duration, bpm: out.card.bpm, year: out.card.year, explicit: out.card.explicit, genre: out.card.genre });
  W.st.pumpkins -= out.price; W.sel = [];
  await wzTap(scr); await wzClose(scr);
  W.busy = false; renderCounters?.(); renderWitch();
}

/* ---------- the elixir: the bottle pours over the case, the grade climbs (or the elixir goes up in smoke) ---------- */
async function pourElixir(c, cp) {
  if (W.busy) return;
  W.busy = true;
  const scr = wzScreen("elixir");
  scr.innerHTML = `<div class="wz-stage"><div class="wz-bottle" aria-hidden="true"><svg viewBox="0 0 80 120"><path d="M30 6h20v22c14 6 22 18 22 34 0 26-18 50-32 50S8 88 8 62c0-16 8-28 22-34z" fill="rgba(140,255,170,.25)" stroke="#d8ffe4" stroke-width="2"/>
      <path d="M12 70c0 22 14 38 28 38s28-16 28-38c-8 4-18 6-28 2s-20-6-28-2z" fill="#5dff9a"/><rect x="27" y="0" width="26" height="9" rx="3" fill="#8a5a2b"/></svg></div>
      <div class="wz-drops">${Array.from({ length: 10 }, (_, i) => `<i style="--d:${(i * .12).toFixed(2)}s;--x:${(Math.random() * 30 - 15).toFixed(0)}px"></i>`).join("")}</div>
      <div class="wz-slab"></div><div class="wz-smoke"></div></div>
    <div class="wz-title" aria-live="polite"></div><p class="wz-hint">L'élixir coule…</p>`;
  const slab = slabEl(c, !!cp.holo && c.tier >= MYTH, cp); scr.querySelector(".wz-slab").appendChild(slab);
  const res = rpc("elixir_pour", { p_card: cp.id });
  await wzWait(500); scr.classList.add("pour");
  let out, err = null;
  try { [out] = await Promise.all([res, wzWait(2200)]); } catch (e) { err = e; }
  if (err) { await wzClose(scr); W.busy = false; toast(message(err)); return; }
  scr.querySelector(".wz-hint").textContent = "";
  if (out.success) {
    cp.grade = out.grade;
    scr.classList.add("win");
    const g = slab.querySelector(".slab"); g.dataset.g = out.grade;
    g.querySelector(".gr b").textContent = out.grade; g.querySelector(".gr small").textContent = GRADE_NAME[out.grade];
    g.classList.remove("landed"); void g.offsetWidth; g.classList.add("landed");
    scr.querySelector(".wz-title").innerHTML = `<b>Note ${out.before} → ${out.grade} !</b><small>${GRADE_NAME[out.grade]} · la boîte et son numéro sont gardés</small>`;
  } else {
    scr.classList.add("miss");
    scr.querySelector(".wz-title").innerHTML = `<b class="miss">L'élixir s'est évaporé…</b><small>La note reste ${out.before}. Seules les citrouilles sont perdues.</small>`;
  }
  W.st.pumpkins -= 30;
  scr.querySelector(".wz-hint").textContent = "Touche pour continuer";
  await wzTap(scr); await wzClose(scr);
  W.busy = false; renderWitch();
}

Object.assign(Online, { renderWitch: () => renderWitch() });
