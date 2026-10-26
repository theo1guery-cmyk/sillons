"use strict";
/* Zik Hunter — Noël (1 to 25 December): the Cartes Givrées (Christmas sounds in a few numbered copies, one of them a
   1/1), the Advent calendar (a door a day), the snowflakes (the currency of the event) and the Pack de Noël. The
   server decides everything; this file shows. */

/* a Carte Givrée: the sleeve sealed in a block of ice — a thick bevelled pane, frost ferns grown from the corners,
   a crack or two, snow fallen on the top edge with icicles under it; the 1/1 is tied with a red ribbon and gold */
const GC_SEED = s => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296; };
function gcFern(rnd, x, y, a, len, depth, out) {        // a frost fern: a stem that throws shorter twins at 60°
  const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
  out.push(`M${x.toFixed(2)} ${y.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}`);
  if (depth <= 0 || len < .9) return;
  const n = 2 + (rnd() * 3 | 0);
  for (let k = 1; k <= n; k++) {
    const f = k / (n + 1), bx = x + (x2 - x) * f, by = y + (y2 - y) * f, l = len * (.42 + rnd() * .2) * (1 - f * .5);
    gcFern(rnd, bx, by, a + Math.PI / 3, l, depth - 1, out); gcFern(rnd, bx, by, a - Math.PI / 3, l, depth - 1, out);
  }
  if (rnd() < .6) gcFern(rnd, x2, y2, a + (rnd() - .5) * .5, len * .55, depth - 1, out);
}
function gcFrost(seed) {
  const rnd = GC_SEED(seed), d = [];
  for (const [x, y, a0, big] of [[0, 0, .75, 1], [63, 0, 2.39, 1], [0, 88, -.75, .45], [63, 88, -2.39, .35]])   // light at the bottom: the title and the N° stay clear
    for (let k = 0; k < 3; k++) gcFern(rnd, x, y, a0 + (rnd() - .5) * 1.1, (9 + rnd() * 9) * big, big < 1 ? 2 : 3, d);
  const cracks = [];
  for (let k = 0; k < 2; k++) {                          // a crack across the ice, zigzag
    let x = rnd() * 63, y = rnd() < .5 ? 0 : 88; const dir = y ? -1 : 1; let p = `M${x.toFixed(1)} ${y}`;
    for (let s = 0; s < 6; s++) { x += (rnd() - .5) * 10; y += dir * (3 + rnd() * 5); p += `L${x.toFixed(1)} ${y.toFixed(1)}`; }
    cracks.push(p);
  }
  return `<svg class="gc-ferns" viewBox="0 0 63 88" preserveAspectRatio="none" aria-hidden="true"><path class="f" d="${d.join("")}"/><path class="c" d="${cracks.join("")}"/></svg>`;
}
// the outline of the block: broken ice — the edge in facets, with chips out of it and crystals sticking out
function gcEdge(seed) {
  const rnd = GC_SEED("edge" + seed), pts = [], W = 63, H = 88, step = 3.2;
  const side = (x0, y0, x1, y1, nx, ny) => {
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.round(len / step);
    for (let k = 0; k < n; k++) {
      const t = k / n, j = rnd() < .14 ? -(1.4 + rnd() * 1.8) : rnd() < .12 ? 1.3 + rnd() * 2.2 : (rnd() - .5) * 1.2;   // a chip, a crystal, or just uneven
      pts.push([x0 + (x1 - x0) * t + nx * j, y0 + (y1 - y0) * t + ny * j]);
    }
  };
  const m = 2.6;
  side(m, m, W - m, m, 0, -1); const top = pts.slice(); side(W - m, m, W - m, H - m, 1, 0); side(W - m, H - m, m, H - m, 0, 1); side(m, H - m, m, m, -1, 0);
  const poly = pts.map(([x, y]) => `${(x / W * 100).toFixed(2)}% ${(y / H * 100).toFixed(2)}%`).join(",");
  const path = "M" + pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L") + "Z";
  // facets: a few lines from the edge inwards, as on a cut block
  const fac = pts.filter((_, i) => i % 5 === 2).map(([x, y]) => { const cx = W / 2, cy = H / 2, f = .12 + rnd() * .1; return `M${x.toFixed(2)} ${y.toFixed(2)}L${(x + (cx - x) * f).toFixed(2)} ${(y + (cy - y) * f).toFixed(2)}`; }).join("");
  return { poly, path, fac, top };
}
// snow lying on the top edge: it follows the broken ice, thick in the middle and thin at the ends, its top soft and
// lumpy, a little overhang that droops at both ends, shaded blue underneath; icicles under it, of uneven lengths
function gcSnow(seed, top) {
  const rnd = GC_SEED("snow" + seed), W = 63, n = top.length;
  const lump = Array.from({ length: n }, () => rnd());
  const up = top.map(([x, y], i) => {
    const t = i / (n - 1), th = 3.3 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, (t - .02) / .96))), .55) + (lump[i] - .5) * .9 + .5;
    return [x, y - Math.max(.4, th)];
  });
  const L = [top[0][0] - 1.4, top[0][1] + 1.6], R = [top[n - 1][0] + 1.6, top[n - 1][1] + 1.4];   // the overhang droops at the ends
  let d = `M${L[0].toFixed(2)} ${L[1].toFixed(2)}Q${(L[0] - .4).toFixed(2)} ${(up[0][1] + .6).toFixed(2)} ${up[0][0].toFixed(2)} ${up[0][1].toFixed(2)}`;
  for (let i = 1; i < n; i++) { const [x0, y0] = up[i - 1], [x1, y1] = up[i]; d += `Q${x0.toFixed(2)} ${(y0 - .5).toFixed(2)} ${((x0 + x1) / 2).toFixed(2)} ${((y0 + y1) / 2 - .25).toFixed(2)}`; if (i === n - 1) d += `T${x1.toFixed(2)} ${y1.toFixed(2)}`; }
  d += `Q${(R[0] + .5).toFixed(2)} ${(up[n - 1][1] + .5).toFixed(2)} ${R[0].toFixed(2)} ${R[1].toFixed(2)}`;
  for (let i = n - 1; i >= 0; i--) { const [x, y] = top[i]; d += `L${x.toFixed(2)} ${(y + .5 + (i % 2) * .35).toFixed(2)}`; }   // the underside, a little ragged
  d += "Z";
  const hi = "M" + up.slice(2, n - 2).map(([x, y]) => `${x.toFixed(2)} ${(y + .55).toFixed(2)}`).join("L");   // the light on the top of the snow
  let ice = "";
  for (let k = 0; k < 9; k++) {
    const i = 1 + (rnd() * (n - 2) | 0), [x, y] = top[i], w = .7 + rnd() * 1.1, h = rnd() < .35 ? 4 + rnd() * 5 : 1.5 + rnd() * 2.5;
    ice += `M${(x - w).toFixed(2)} ${(y + .3).toFixed(2)}Q${(x - w * .3).toFixed(2)} ${(y + h * .55).toFixed(2)} ${x.toFixed(2)} ${(y + h).toFixed(2)}Q${(x + w * .3).toFixed(2)} ${(y + h * .55).toFixed(2)} ${(x + w).toFixed(2)} ${(y + .3).toFixed(2)}Z`;
  }
  const dots = Array.from({ length: 10 }, () => { const i = 2 + (rnd() * (n - 4) | 0), [x, y] = up[i]; return `<circle cx="${(x + (rnd() - .5) * 2).toFixed(2)}" cy="${(y + .8 + rnd() * 1.4).toFixed(2)}" r="${(.12 + rnd() * .16).toFixed(2)}"/>`; }).join("");
  return `<svg class="gc-snow" viewBox="0 0 63 88" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="gcS${seed.length}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#f2f9ff"/><stop offset="1" stop-color="#bcd8f0"/></linearGradient>
      <linearGradient id="gcI${seed.length}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4fbff" stop-opacity=".95"/><stop offset="1" stop-color="#9fd2ff" stop-opacity=".35"/></linearGradient></defs>
    <path class="ice" d="${ice}" fill="url(#gcI${seed.length})"/><path class="cap" d="${d}" fill="url(#gcS${seed.length})"/><path class="hi" d="${hi}"/><g class="glit">${dots}</g></svg>`;
}
function givreCardEl(c) {
  const one = c.of === 1, no = c.no === "?" ? "?" : String(c.no).padStart(String(c.of).length, "0");
  const el = document.createElement("div"); el.className = "gcard" + (one ? " one" : "");
  const edge = gcEdge(c.t + c.a);
  el.style.setProperty("--gc-edge", `polygon(${edge.poly})`);
  el.innerHTML = `<div class="gc-glow" aria-hidden="true"></div>
    <div class="gc-block">
      <div class="gc-paper">
        <img class="gc-art" src="${esc(c.cov)}" alt="Pochette de ${esc(c.t)}" loading="lazy" decoding="async">
        <div class="gc-cold" aria-hidden="true"></div>${gcFrost(c.t + c.a)}<div class="gc-sheen" aria-hidden="true"></div>
        <div class="gc-head"><span class="gc-flake" aria-hidden="true">❄</span><span>Édition givrée</span>${one ? `<span class="gc-uniq">Unique</span>` : ""}</div>
        <div class="gc-foot">
          <div class="gc-a">${esc(c.a)}</div>
          <div class="gc-t${c.t.length > 18 ? " xlong" : c.t.length > 10 ? " long" : ""}">${esc(c.t)}</div>
          <div class="gc-row"><span>Noël 2026</span><b class="gc-no"><small>N°</small>${no}<em>/${c.of}</em></b></div>
        </div>
      </div>
    </div>
    <svg class="gc-rim" viewBox="0 0 63 88" preserveAspectRatio="none" aria-hidden="true"><path class="r" d="${edge.path}"/><path class="r2" d="${edge.path}"/><path class="fa" d="${edge.fac}"/></svg>
    ${gcSnow(c.t + c.a, edge.top)}
    ${one ? `<div class="gc-ribbon" aria-hidden="true"><i class="v"></i><i class="h"></i><b></b></div>` : ""}
    <div class="gc-spark" aria-hidden="true">${"<i></i>".repeat(6)}</div>`;
  const w = document.createElement("div"); w.className = "cq"; w.appendChild(el);
  return w;
}
window.givreCardEl = givreCardEl;

/* the Advent calendar: 24 wooden doors in a frame, opened ones show their present; today's glows */
const ADVENT = Array.from({ length: 24 }, (_, i) => i + 1);
function adventEl(st) {   // st: { today, opened: [days], gifts: { day: label } }
  const el = document.createElement("div"); el.className = "adv";
  el.innerHTML = `<div class="adv-top"><b>Calendrier de l'Avent</b><small>une porte par jour, du 1er au 24 décembre</small></div>
    <div class="adv-grid">${[3, 17, 8, 22, 1, 12, 19, 6, 14, 24, 10, 4, 20, 15, 7, 11, 23, 2, 16, 9, 21, 5, 18, 13].map(d => {
      const open = st.opened.includes(d), today = d === st.today, late = d < st.today && !open, soon = d > st.today;
      return `<button class="adv-d${open ? " open" : ""}${today ? " today" : ""}${late ? " late" : ""}${soon ? " soon" : ""}${d === 24 ? " big" : ""}" data-d="${d}" ${soon ? "disabled" : ""}>
        <span class="adv-in">${open ? `<em>${esc(st.gifts[d] || "")}</em>` : ""}</span><span class="adv-door"><b>${d}</b>${d === 24 ? "<i>🎁</i>" : ""}</span></button>`;
    }).join("")}</div>`;
  return el;
}

/* ---------------------------------------------------------------- the Atelier du Père Noël (the "noel" view) */
const NL = { st: null, sub: "advent", busy: false };
const NL_SUBS = [["advent", "🎁 Calendrier"], ["givree", "❄ Cartes Givrées"], ["quests", "⭐ Quêtes"], ["pack", "🛷 Pack de Noël"], ["shop", "🛒 Flocons"]];
const nlAdmin = () => typeof ADM !== "undefined" && ADM.admin;
// the tab: for everyone during the event; admins see it before, as a preview
function noelTab() {
  const t = document.getElementById("tab-noel"); if (!t) return;
  const on = typeof EVENT !== "undefined" && Online.active && (EVENT.on === "noel" || nlAdmin());
  t.hidden = !on;
  if (!on && views.noel && !views.noel.hidden) show("shop");
}
setInterval(noelTab, 3000);

async function renderNoel() {
  if (!me) return;
  try { NL.st = await rpc("noel_state"); } catch (e) { return toast(message(e)); }
  const st = NL.st, box = views.noel, preview = !st.active;
  if (preview && !nlAdmin()) { box.innerHTML = `<h2>L'atelier est fermé</h2><p class="sub">Le Père Noël ouvre ses portes le 1er décembre.</p>`; return; }
  const left = Math.max(0, 25 - st.day), dot = k => k === "quests" ? st.quests.some(q => !q.claimed && q.progress >= q.goal)
    : k === "advent" ? st.doors.some(d => !d.open && d.day <= Math.min(st.day, 24)) : false;
  box.innerHTML = `<div class="nl-hero">
      <div class="nl-sky" aria-hidden="true">${"<i></i>".repeat(22)}</div>
      <div class="nl-hero-in">
        <h2>L'Atelier du Père Noël</h2>
        ${preview ? `<p class="nl-prev"><b>Aperçu admin :</b> les joueurs verront l'atelier le 1er décembre à minuit, il s'ouvre tout seul.</p>` : ""}
        <p class="sub">${st.day < 1 ? "Ouverture le 1er décembre." : st.day >= 25 ? "Joyeux Noël ! C'est le dernier jour de l'atelier." : `Encore ${left} jour${left > 1 ? "s" : ""} avant Noël.`}
          Une porte du calendrier chaque jour, des flocons à gagner, et 12 Cartes Givrées cachées dans les boosters.</p>
        <p class="nl-storm">${st.storm ? `🌨️ <b>Tempête en cours !</b> Mythiques et Légendaires doublées, +50 % d'XP de Pass.`
          : st.storms_left ? `🌨️ Encore <b>${st.storms_left} tempête${st.storms_left > 1 ? "s" : ""} de neige</b> aujourd'hui, à une heure surprise.`
          : `🌨️ Chaque jour, 3 tempêtes de neige surprises entre 10 h et 23 h.`}</p>
      </div>
      <div class="nl-purse"><span aria-hidden="true">❄</span><b>${fmt(st.snowflakes || 0)}</b><small>flocons</small></div>
    </div>
    <div class="nl-tabs" role="tablist" aria-label="L'Atelier du Père Noël">${NL_SUBS.map(([k, t]) => `<button role="tab" data-sub="${k}" aria-selected="${NL.sub === k}">${t}${dot(k) ? `<i class="nl-dot" aria-label="à récupérer"></i>` : ""}</button>`).join("")}</div>
    <section class="nl-sec" data-sub="advent" id="nlAdv" aria-label="Calendrier de l'Avent"></section>
    <section class="nl-sec" data-sub="givree" id="nlGiv" aria-label="Cartes Givrées"></section>
    <section class="nl-sec" data-sub="quests" aria-label="Quêtes">
      <h3>Les quêtes de l'atelier</h3>
      <div class="nl-quests">${st.quests.map(q => `<div class="nl-q${q.claimed ? " done" : q.progress >= q.goal ? " ready" : ""}">
          <span>${esc(q.label)}</span><div class="meter"><s style="width:${Math.round(100 * q.progress / q.goal)}%"></s></div>
          <small>${q.progress} / ${q.goal}</small>
          ${q.claimed ? `<em>✓ +${q.reward} ❄</em>` : q.progress >= q.goal && !preview ? `<button class="btn primary" data-q="${q.key}">+${q.reward} ❄</button>` : `<em>+${q.reward} ❄</em>`}</div>`).join("")}</div>
      <p class="nl-note">Les quêtes reviennent chaque jour à minuit. Des flocons se cachent aussi dans les boosters.</p>
    </section>
    <section class="nl-sec" data-sub="pack" aria-label="Pack de Noël">
      <div class="nl-pk">
        <button class="pack nl-pack" id="nlPackArt" aria-label="Ouvrir un Pack de Noël"><span class="pack-shine"></span><canvas class="pack-gl" aria-hidden="true"></canvas><img class="pack-logo" src="brand/zikhunter-icon.svg" alt=""></button>
        <div class="nl-pinfo"><p class="nl-pkt">Le Pack de Noël</p>
          <p>5 cartes <b>Rare ou mieux</b>, et <b>20 fois plus de chances</b> qu'un booster de cacher une Carte Givrée. Pour <b>All I Want for Christmas Is You</b>, la carte unique, il n'aide presque pas : elle peut sortir de n'importe quel booster.</p>
          <button class="btn primary" id="nlPack"${(st.snowflakes || 0) < 100 || preview ? " disabled" : ""}>Ouvrir · 100 ❄</button>
          ${(st.snowflakes || 0) < 100 ? `<small>Il te manque ${100 - (st.snowflakes || 0)} ❄ : fais les quêtes ou passe à la boutique de flocons.</small>` : ""}</div>
      </div>
    </section>
    <section class="nl-sec" data-sub="shop" aria-label="Boutique de flocons">
      <h3>La boutique de flocons</h3>
      <p class="sub">Les flocons servent au Pack de Noël, et seulement pendant l'événement : dépense-les avant le 26 décembre.</p>
      <div class="nl-packs" id="nlPacks"></div>
    </section>`;
  box.querySelectorAll("[data-q]").forEach(b => b.onclick = async () => {
    try { const n = await rpc("noel_claim", { p_key: b.dataset.q }); toast(`+${n} ❄ !`); renderNoel(); } catch (e) { toast(message(e)); }
  });
  box.querySelector("#nlPack").onclick = () => startOpening(NOELPACK);
  const art = box.querySelector("#nlPackArt"); skin(art, "pack-noel", { sway: true });
  art.onclick = () => preview ? toast("Aperçu : le Pack de Noël s'ouvre à partir du 1er décembre.") : (st.snowflakes || 0) >= 100 ? startOpening(NOELPACK) : toast("Il te faut 100 ❄ pour le Pack de Noël.");
  box.querySelectorAll(".nl-tabs [data-sub]").forEach(b => b.onclick = () => { NL.sub = b.dataset.sub; nlSub(); });
  nlSub(); nlAdvent(); nlBoard(); nlShop();
}
function nlSub() {
  const box = views.noel;
  box.querySelectorAll(".nl-tabs [data-sub]").forEach(b => b.setAttribute("aria-selected", b.dataset.sub === NL.sub));
  box.querySelectorAll("section[data-sub]").forEach(s => s.hidden = s.dataset.sub !== NL.sub);
}

// the calendar: a door opens with a touch, its present comes at once (door 24 may hide a Carte Givrée)
function nlAdvent() {
  const box = $("#nlAdv"); if (!box) return;
  const st = NL.st, today = Math.min(st.day, 24);
  const cal = adventEl({ today, opened: st.doors.filter(d => d.open).map(d => d.day), gifts: Object.fromEntries(st.doors.map(d => [d.day, d.gift])) });
  box.replaceChildren(cal);
  box.insertAdjacentHTML("beforeend", `<p class="nl-note">${st.day < 1 ? "La première porte s'ouvre le 1er décembre." : "Une porte oubliée se rattrape plus tard. Les portes à venir restent fermées."} La porte 24 cache le plus gros cadeau : une carte Légendaire, 100 flocons, et peut-être une Carte Givrée.</p>`);
  cal.querySelectorAll(".adv-d:not(.open):not(.soon)").forEach(b => b.onclick = async () => {
    if (NL.busy || !st.active) return;
    NL.busy = true;
    try {
      const r = await rpc("noel_open", { p_day: +b.dataset.d });
      b.querySelector(".adv-in").innerHTML = `<em>${esc(r.gift.label)}</em>`; b.classList.add("open");
      toast(`🎁 Porte ${b.dataset.d} : ${r.gift.label} !`);
      try { await loadProfile(); } catch (e) {}
      if (r.card) { await wait(900); await Noel.reveal(r.card); try { await loadAll(); } catch (e) {} }
      await wait(r.card ? 0 : 900); refreshViews?.(); renderNoel();
    } catch (e) { toast(message(e)); }
    finally { NL.busy = false; }
  });
}

// the board of the 12 Cartes Givrées: who holds which number
async function nlBoard() {
  const box = $("#nlGiv"); if (!box) return;
  let d = null; try { d = await rpc("haunted_collection"); } catch (e) { return; }
  const eds = (d?.editions || []).filter(e => e.series === 3); if (!eds.length || !box.isConnected) return;
  const out = eds.reduce((a, e) => a + e.copies.length, 0), all = eds.reduce((a, e) => a + e.of, 0);
  box.innerHTML = `<h3>Les Cartes Givrées${nlAdmin() ? ` <button class="ps-link" id="nlDemo">🎬 Tester l'apparition (admin)</button>` : ""}</h3>
    <p class="sub">12 sons de Noël en édition limitée, numérotés, qui n'existeront jamais ailleurs : 5 exemplaires chacun, et <b>All I Want for Christmas Is You</b> en un seul. Ils se cachent dans les boosters du 1er au 25 décembre, et tous sortiront avant Noël. <b>${out} / ${all}</b> déjà trouvées.</p>
    <div class="hx-board nl-board">${eds.map(e => {
      const mine = e.copies.filter(c => c.mine), left = e.of - e.copies.length;
      return `<div class="hx-slot${mine.length ? " mine" : ""}${left ? "" : " out"}" data-slot="${e.slot}">
        <div class="hx-card"></div>
        <p class="hx-left">${left ? `${left} / ${e.of} à trouver` : "Tous sortis"}</p>
        <ul class="hx-owners">${e.copies.map(c => `<li${c.mine ? ' class="me"' : ""}><button type="button" data-no="${c.no}"><b>N° ${String(c.no).padStart(String(e.of).length, "0")}</b> ${esc(c.pseudo || "?")}${c.grade ? ` <i class="hx-g">${c.grade}</i>` : ""}${c.sale ? ` <em class="hx-price">${fmt(c.sale.price)} Streams</em>` : ""}</button></li>`).join("")}</ul></div>`;
    }).join("")}</div>`;
  box.querySelectorAll(".hx-slot").forEach(s => {
    const e = eds.find(x => x.slot === +s.dataset.slot), mine = e.copies.filter(c => c.mine);
    const w = givreCardEl({ t: e.title, a: e.artist, cov: e.cover || "", no: mine.length ? mine[0].no : "?", of: e.of });
    if (!e.copies.length) w.querySelector(".gcard").classList.add("gc-ghost");
    s.querySelector(".hx-card").appendChild(w);
    const open = cp => hxView(hxCard(e, cp));
    if (e.copies.length) { s.querySelector(".hx-card").onclick = () => open(mine[0] || e.copies.find(c => c.sale) || e.copies[0]); s.querySelector(".hx-card").classList.add("tap"); }
    else if (nlAdmin()) { s.querySelector(".hx-card").onclick = () => hxView({ ...hxCard(e, { no: 1 }), no: 1, mine: false }); s.querySelector(".hx-card").classList.add("tap"); }
    s.querySelectorAll(".hx-owners button").forEach(b => b.onclick = () => open(e.copies.find(c => c.no === +b.dataset.no)));
  });
  const demo = box.querySelector("#nlDemo"); if (demo) demo.onclick = () => Noel.demo(eds);
}

// the flocon shop: paid in euros (Stripe, or through the Discord while card payments are off) or in Vinyles
async function nlShop() {
  const box = $("#nlPacks"); if (!box) return;
  let packs = []; try { packs = await rpc("snowflake_packs"); } catch (e) {}
  if (!packs.length) { box.closest(".nl-sec").remove(); return; }
  const base = packs[0].snowflakes / packs[0].cents;
  box.innerHTML = packs.map((p, i) => { const bonus = Math.round((p.snowflakes / p.cents / base - 1) * 100);
    return `<div class="nl-buy${i === 2 ? " hot" : ""}">${i === 2 ? `<span class="nl-tag">Populaire</span>` : ""}
      <span class="nl-pile" aria-hidden="true">${"❄".repeat(Math.min(i + 1, 4))}</span>
      <b>${fmt(p.snowflakes)}</b><small>flocons</small>${bonus > 0 ? `<em>+${bonus} % offerts</em>` : `<em class="none">&nbsp;</em>`}
      <button class="vs-buy" data-eur="${esc(p.id)}">${euro(p.cents / 100)}</button>
      ${p.vinyls ? `<button class="ps-link" data-vin="${esc(p.id)}" data-n="${p.vinyls}">ou ${fmt(p.vinyls)} <i class="vin" aria-hidden="true"></i></button>` : ""}</div>`; }).join("");
  const off = !NL.st?.active;
  box.querySelectorAll("[data-eur]").forEach(b => b.onclick = () => off ? toast("Aperçu : la boutique ouvre le 1er décembre.") : checkout(b.dataset.eur, b));
  box.querySelectorAll("[data-vin]").forEach(b => b.onclick = async () => {
    if (off) return toast("Aperçu : la boutique ouvre le 1er décembre.");
    const n = +b.dataset.n;
    if ((S.vinyls || 0) < n) return toast(`Il te faut ${fmt(n)} Vinyles, tu en as ${fmt(S.vinyls || 0)}.`);
    if (!confirm(`Acheter ces flocons pour ${fmt(n)} Vinyles ?`)) return;
    b.disabled = true;
    try { const k = await rpc("buy_snowflakes", { p_pack: b.dataset.vin }); toast(`Tu as maintenant ${fmt(k)} ❄ !`); }
    catch (e) { toast(message(e)); b.disabled = false; return; }
    try { await loadProfile(); } catch (e) {}
    refreshViews(); renderNoel();
  });
}

/* ---------------------------------------------------------------- the reveal of a Carte Givrée
   a winter night: snow falls, the northern lights move, a great snowflake lights up on the snow and turns; the card
   rises out of it in a block of ice, spinning, the frost spreads, the ice cracks and bursts into shards, and the card
   shows. Same timing as the haunted film (the music starts with the card, at 3.6 s). Plain HTML and CSS. */
function ncFilm(host, c, opts = {}) {
  return new Promise(done => {
    const arms = [...Array(6)].map((_, k) => `<g transform="rotate(${k * 60} 50 50)"><path d="M50 50V8M50 20l-7-7M50 20l7-7M50 32l-9-8M50 32l9-8M50 42l-5-5M50 42l5-5"/></g>`).join("");
    const shards = [...Array(16)].map((_, k) => { const a = k / 16 * Math.PI * 2 + Math.random() * .3, r = 34 + Math.random() * 26;
      return `<i style="--x:${(Math.cos(a) * r).toFixed(1)}vmin;--y:${(Math.sin(a) * r).toFixed(1)}vmin;--r:${(Math.random() * 720 - 360).toFixed(0)}deg;--s:${(.5 + Math.random() * .9).toFixed(2)}"></i>`; }).join("");
    const el = document.createElement("div"); el.className = "ncf" + (c.of === 1 ? " one" : "");
    el.innerHTML = `<div class="ncf-sky"></div><div class="ncf-aurora"><i></i><i></i></div>
      <svg class="ncf-hills" viewBox="0 0 400 120" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><path d="M0 120V70Q60 52 120 66T240 60T400 64V120Z" fill="#cfe2f3"/><path d="M0 120V88Q90 74 200 86T400 82V120Z" fill="#eaf4ff"/>
        <path d="M60 70l-14 22h8l-12 18h36l-12-18h8zM330 64l-16 26h9l-13 20h40l-13-20h9z" fill="#0d2d25"/></svg>
      <div class="ncf-floor"><svg class="ncf-flake" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="47" stroke-width=".8"/><circle cx="50" cy="50" r="30" stroke-width=".5"/>${arms}</svg></div>
      <div class="ncf-pillar"></div><div class="ncf-snow">${"<i></i>".repeat(40)}</div>
      <div class="ncf-stage"><div class="ncf-card"><div class="ncf-face"></div><div class="ncf-ice"><b>❄</b><svg class="ncf-cracks" viewBox="0 0 63 88" preserveAspectRatio="none"><path d="M31 44L20 30L12 34M31 44L40 26L46 14M31 44L46 52L58 48M31 44L28 62L18 76M31 44L38 66L44 84M20 30L16 18M46 52L52 64"/></svg></div></div></div>
      <div class="ncf-flash"></div><div class="ncf-shards">${shards}</div><div class="ncf-glints">${"<i></i>".repeat(10)}</div>`;
    el.querySelector(".ncf-face").appendChild(givreCardEl({ t: c.title, a: c.artist, cov: c.cover || "", no: c.no, of: c.of }));
    host.appendChild(el);
    const t0 = performance.now(); let revealed = false, readied = false;
    const tick = () => {
      if (!host.isConnected) { if (!revealed) opts.onReveal?.(); return done(); }
      const t = (performance.now() - t0) / 1000;
      if (!readied) { readied = true; opts.onReady?.(); el.classList.add("go"); }
      if (t >= 3.6 && !revealed) { revealed = true; try { opts.onReveal?.(); } catch (e) {} }
      if (t >= 6.2) return done();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const ncFilmLoad = () => matchMedia("(prefers-reduced-motion: reduce)").matches ? null : Promise.resolve({ play: ncFilm });
const ncNo = c => String(c.no).padStart(String(c.of).length, "0");
const Noel = {
  card: givreCardEl, advent: adventEl,
  // inside the booster: after the last card, a frozen back glitters; a touch and the film plays
  inPack(OP) {
    OP.hDone = true;
    const box = $o(".op-cards"), c = OP.haunted;
    box.querySelectorAll(".solo-card").forEach(x => x.remove());
    const el = document.createElement("div"); el.className = "solo-card gv-solo";
    el.innerHTML = `<div class="gv-bk" aria-hidden="true"><b>❄</b><i></i></div><div class="gv-front"></div><div class="gv-burst" aria-hidden="true">${"<i></i>".repeat(10)}</div>`;
    el.querySelector(".gv-front").appendChild(givreCardEl({ t: c.title, a: c.artist, cov: c.cover, no: c.no, of: c.of }));
    box.appendChild(el); op.classList.add("gv-on");
    $o(".op-sub").textContent = "Carte bonus · Carte Givrée";
    opHint("Ce booster est tout gelé… touche la carte");
    const music = hxMusic(c); OP.hAudio = music.audio;
    OP.step = async () => {
      opHint("");
      music.arm();
      const shown = await hxFilm(ncFilmLoad(), c, music.start);
      if (shown) { el.classList.add("cracked", "done"); music.start(); }
      else { el.classList.add("cracked"); setTimeout(music.start, 600); await wait(1400); el.classList.add("done"); }
      opHint(`${c.title} · N° ${ncNo(c)}/${c.of}${c.of === 1 ? " · exemplaire unique !" : ""} — touche pour voir tout le booster`);
      OP.step = async () => { OP.hAudio?.pause(); OP.hAudio = null; op.classList.remove("gv-on"); el.classList.add("leave"); setTimeout(() => el.remove(), 380);
        if (OP.demo) { OP.demo = false; OP.haunted = null; OP.step = null; closeOpening(); } else opRecap(); };
    };
  },
  // the layout of the whole booster: the Givrée at the end (its film plays even when "Tout révéler" skipped it)
  async inRecap(OP, rc) {
    const c = OP.haunted, slot = document.createElement("div"); slot.className = "slot hx-rslot";
    slot.appendChild(givreCardEl({ t: c.title, a: c.artist, cov: c.cover, no: c.no, of: c.of }));
    slot.onclick = () => hxView({ ...c, mine: !!c.card_id, id: c.card_id });
    if (!OP.hDone) { OP.hDone = true; await Noel.reveal(c); }
    rc.appendChild(slot);
  },
  // the film on its own (from the calendar, or after "Tout révéler"), then the card to look at
  async reveal(c) {
    const music = hxMusic(c);
    music.arm(); await Promise.race([music.pre, wait(1500)]);
    if (await hxFilm(ncFilmLoad(), c, music.start)) { music.start(); setTimeout(() => music.stop(), 8000); }
    else music.stop();
    await hxView({ ...c, mine: !!c.card_id, id: c.card_id });
    music.stop();
  },
  // admins: the whole reveal with a sound of the series, nothing drawn nor saved
  demo(eds) {
    if (busy || !op.hidden) return;
    const list = (eds || []).filter(e => e.cover); if (!list.length) return toast("Pas encore de carte à montrer.");
    const e = list[Math.random() * list.length | 0];
    Object.assign(OP, { p: NOELPACK, pulls: [], i: 0, seen: -1, haunted: { title: e.title, artist: e.artist, cover: e.cover, preview: e.preview, track_id: e.track_id, slot: e.slot, series: 3, no: 1, of: e.of }, hDone: false, demo: true });
    $o(".op-title").textContent = "Aperçu · Carte Givrée"; $o(".op-cards").innerHTML = ""; $o(".op-recap").innerHTML = ""; $o(".op-tray").innerHTML = "";
    op.classList.remove("god", "err"); op.hidden = false; document.body.classList.add("op-on"); addEventListener("keydown", opKeys, true);
    opPhase("cards");
    Noel.inPack(OP);
  },
};
window.Noel = Noel; window.renderNoel = renderNoel;
