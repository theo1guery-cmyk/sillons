"use strict";
/* Sillons TCG — every card is a live Deezer track. No server: the Deezer API is
   called straight from the browser through JSONP (it sends no CORS headers). */

/* ---------- Deezer ---------- */
const API = "https://api.deezer.com/";
let jsonpSeq = 0;
function jsonp(path, params = {}) {
  return new Promise((resolve, reject) => {
    const cb = "__dz" + (++jsonpSeq);
    const qs = new URLSearchParams({ ...params, output: "jsonp", callback: cb });
    const s = document.createElement("script");
    const done = () => { clearTimeout(timer); delete window[cb]; s.remove(); };
    const timer = setTimeout(() => { done(); reject({ code: "timeout" }); }, 12000);
    window[cb] = d => { done(); d && d.error ? reject({ code: d.error.code, message: d.error.message }) : resolve(d); };
    s.onerror = () => { done(); reject({ code: "network" }); };
    s.src = API + path + "?" + qs;
    document.head.appendChild(s);
  });
}
// Deezer allows about 50 requests per 5 s; keep a few in flight and back off on quota errors (code 4).
const queue = []; let inFlight = 0;
function dz(path, params) {
  return new Promise((resolve, reject) => { queue.push({ path, params, resolve, reject, tries: 0 }); pump(); });
}
function pump() {
  while (inFlight < 4 && queue.length) {
    const job = queue.shift(); inFlight++;
    jsonp(job.path, job.params).then(job.resolve, err => {
      if ((err.code === 4 || err.code === "timeout") && job.tries++ < 3) {
        setTimeout(() => { queue.unshift(job); pump(); }, 1200 * job.tries);
      } else job.reject(err);
    }).finally(() => { inFlight--; pump(); });
  }
}

/* ---------- game rules ---------- */
const TYPES = [
  { k: "rap", n: "Rap", h: 4, s: "Flow", g: [116] },
  { k: "pop", n: "Pop", h: 330, s: "Éclat", g: [132] },
  { k: "rock", n: "Rock", h: 26, s: "Riff", g: [152, 85, 464] },
  { k: "electro", n: "Électro", h: 190, s: "Pulse", g: [106, 113] },
  { k: "soul", n: "Soul / R&B", h: 270, s: "Groove", g: [165, 169] },
  { k: "chanson", n: "Chanson", h: 220, s: "Verbe", g: [52] },
  { k: "jazz", n: "Jazz / Blues", h: 158, s: "Swing", g: [129, 153] },
  { k: "latino", n: "Latino", h: 45, s: "Ritmo", g: [197, 122, 75] },
  { k: "afro", n: "Afro / Reggae", h: 95, s: "Vibe", g: [2, 144] },
  { k: "classique", n: "Classique / BO", h: 245, s: "Souffle", g: [98, 173] },
  { k: "autre", n: "Inclassable", h: 300, s: "Aura", g: [] },
];
const AUTRE = TYPES.length - 1;
function typeOfGenre(gid) { const i = TYPES.findIndex(t => t.g.includes(gid)); return i < 0 ? AUTRE : i; }

const RAR = ["Commune", "Peu commune", "Rare", "Épique", "Légendaire"];
const RCOL = ["var(--r0)", "var(--r1)", "var(--r2)", "var(--r3)", "var(--r4)"];
// Deezer rank (0 – 1 000 000) → rarity. Calibrated on random catalogue samples:
// about half of all tracks are commons, only the real hits reach 850 000.
const TIER_MIN = [0, 200000, 400000, 650000, 850000];
const tierOf = rank => TIER_MIN.reduce((t, m, i) => rank >= m ? i : t, 0);
const inTier = (rank, t) => rank >= TIER_MIN[t] && (t === 4 || rank < TIER_MIN[t + 1]);
const tierDistance = (rank, t) => rank < TIER_MIN[t] ? TIER_MIN[t] - rank : t < 4 && rank >= TIER_MIN[t + 1] ? rank - TIER_MIN[t + 1] + 1 : 0;

const WORDS = ("amour love night fire heart soleil baby dance rain moon party road summer life dream girl boy city sky street gold blue black red " +
  "money time world king queen star ocean paris tokyo london new york corazon vida noche fuego liebe nacht herz amore notte cuore mama papa " +
  "freedom home light dark sun angel devil crazy wild young forever tonight tomorrow yesterday sweet bad good happy sad lonely alone together " +
  "music song radio rock roll soul funk disco house techno bass beat flow rap hip hop jazz blues reggae samba salsa tango bossa afro " +
  "mon ma ton ta la le les une un des toi moi nous elle lui pourquoi jamais toujours encore ciel mer terre feu eau vent nuit jour rêve " +
  "coeur fille garçon ville rue route fête danse chanson musique liberté paradis enfer temps vie mort amour belle beau fou folle " +
  "el la los las mi tu te quiero bailar dinero calle playa sol luna fiesta cielo mujer hombre loco loca " +
  "ich du wir mein dein und der die das o meu minha samba saudade amor eu você baila kuduro wahala lagos dakar abidjan " +
  "boom bang hey yeah oh no yes ok fly high low down up run fall rise shine glow break wake stay go come back").split(" ");
const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const pick = a => a[Math.floor(Math.random() * a.length)];
const randInt = n => Math.floor(Math.random() * n);

function rollTier(guaranteed) {
  const w = guaranteed ? [0, 0, 70, 23, 7] : [62, 25, 9.2, 3, .8];
  let r = Math.random() * w.reduce((a, b) => a + b);
  for (let i = 0; i < 5; i++) if ((r -= w[i]) < 0) return i;
  return 0;
}

/* candidate tracks for a wanted tier, from the whole catalogue */
async function searchPool(tier) {
  const high = tier >= 3;
  const q = high || Math.random() < .6 ? pick(WORDS) : pick(LETTERS) + pick(LETTERS) + (Math.random() < .5 ? pick(LETTERS) : "");
  const params = { q, limit: 100 };
  if (high) params.order = "RANKING";
  else params.index = randInt(tier <= 1 ? 200 : 100);
  const d = await dz("search", params);
  return d.data || [];
}
/* candidate tracks for one genre: Deezer's genre radios (its per-genre charts return the global chart, so they are not used) */
const genreCache = {};
async function genrePool(typeIdx, tier) {
  const t = TYPES[typeIdx];
  if (!genreCache.radios) {
    const d = await dz("radio/genres");
    genreCache.radios = {};
    for (const g of d.data || []) genreCache.radios[g.id] = (g.radios || []).map(r => r.id);
  }
  const radios = t.g.flatMap(gid => genreCache.radios[gid] || []);
  if (!radios.length) return searchPool(tier);
  const rid = pick(radios), key = "radio" + rid;
  genreCache[key] = genreCache[key] || dz(`radio/${rid}/tracks`, { limit: 100 }).then(d => d.data || []);
  return genreCache[key];
}

const albumCache = {};
const getAlbum = id => albumCache[id] = albumCache[id] || dz("album/" + id).catch(() => ({}));
// genre radios mix in neighbouring styles, so a genre booster checks each album's real genre
async function firstOfType(cands, typeIdx) {
  for (const t of cands.sort(() => Math.random() - .5).slice(0, 6)) {
    const g = typeOfGenre((await getAlbum(t.album.id)).genre_id);
    if (g === typeIdx) return t;
  }
  return null;
}
async function findTrack(typeIdx, tier, used) {
  let best = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const pool = (typeIdx < 0 ? await searchPool(tier) : await genrePool(typeIdx, tier))
      .filter(t => t.readable !== false && t.album && !used.has(t.id));
    const hits = pool.filter(t => inTier(t.rank, tier));
    if (hits.length) {
      if (typeIdx < 0) return pick(hits);
      const ok = await firstOfType(hits, typeIdx);
      if (ok) return ok;
      continue;
    }
    // keep the track closest to the wanted tier, so a booster never comes back short
    for (const t of pool) { const d = tierDistance(t.rank, tier); if (!best || d < best.d) best = { t, d }; }
  }
  return best && best.t;
}

async function enrich(t, typeIdx) {
  const [full, album] = await Promise.all([
    dz("track/" + t.id).catch(() => ({})),
    getAlbum(t.album.id),
  ]);
  const rank = full.rank ?? t.rank ?? 0;
  const date = full.release_date || album.release_date || "";
  return {
    id: t.id,
    t: t.title_short || t.title,
    a: t.artist?.name || "?",
    al: t.album?.title || "",
    cov: (album.cover_big || t.album.cover_big || t.album.cover_medium || "").replace(/^http:/, "https:"),
    d: full.duration || t.duration || 0,
    rank,
    bpm: Math.round(full.bpm || 0),
    y: parseInt(date.slice(0, 4)) || 0,
    x: t.explicit_lyrics ? 1 : 0,
    g: typeIdx >= 0 ? typeIdx : typeOfGenre(album.genre_id),
    tier: tierOf(rank),
  };
}

/* ---------- stats ---------- */
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function stats(c) {
  const tempo = c.bpm > 0 ? c.bpm : Math.round(70 + rng(c.id)() * 90);
  const flow = clamp(Math.round((tempo - 60) / 130 * 99), 8, 99);
  const endu = clamp(Math.round((c.d - 90) / 330 * 99), 5, 99);
  const hype = clamp(Math.round(c.rank / 1e6 * 99), 1, 99);
  return { flow, endu, hype, pw: Math.round((flow + endu + hype * 2) / 4) };
}

/* ---------- save (this browser) ---------- */
const LS = "sillons-live-v1";
let S = { c: {}, opened: 0 };
try { const p = JSON.parse(localStorage.getItem(LS)); if (p && p.c) S = p; } catch (e) {}
function save() {
  try { localStorage.setItem(LS, JSON.stringify(S)); }
  catch (e) { toast("Le navigateur n'a plus de place pour sauvegarder ta collection."); }
}

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const fmt = n => n.toLocaleString("fr-FR");
const fmtDur = s => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
const esc = s => String(s).replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
function initials(t) { const w = t.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean); return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || "?").slice(0, 2)).toUpperCase(); }
let toastTimer;
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 2600); }
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- card markup ---------- */
const PENDING_TYPE = { n: "…", h: 250, s: "Rythme" };   // genre not fetched yet (catalogue)
function cardEl(c, holo) {
  const T = c.g == null ? PENDING_TYPE : TYPES[c.g] || TYPES[AUTRE], st = stats(c);
  const el = document.createElement("div");
  el.className = "card" + (holo ? " holo" : "") + (c.g == null ? " pending" : ""); el.dataset.r = c.tier;
  el.style.setProperty("--h", T.h); el.style.setProperty("--rc", RCOL[c.tier]);
  const art = c.cov
    ? `<img class="bg" src="${esc(c.cov.replace(/\/\d+x\d+-/, "/120x120-"))}" alt="" loading="lazy" decoding="async"><img class="cover" src="${esc(c.cov.replace(/\/\d+x\d+-/, "/500x500-"))}" alt="Pochette de ${esc(c.al)}" loading="lazy" decoding="async">`
    : `<div class="ph">${esc(initials(c.t))}</div>`;
  el.innerHTML = `<div class="in">${art}
    <div class="top"><span class="ty">${T.n}</span><span class="pw" title="Puissance · ${RAR[c.tier]}"><span class="gem"></span>${st.pw}</span></div>
    <div class="body">
      <div class="nm">${esc(c.t)}${c.x ? '<span class="ex">E</span>' : ""}</div>
      <div class="meta"><b>${esc(c.a)}</b> · ${esc(c.al)}${c.y ? " · " + c.y : ""}</div>
      <div class="st">
        <i>${T.s.toUpperCase()}</i><span class="bar"><s style="width:${st.flow}%"></s></span><em>${st.flow}</em>
        <i>ENDUR.</i><span class="bar"><s style="width:${st.endu}%"></s></span><em>${st.endu}</em>
        <i>HYPE</i><span class="bar"><s style="width:${st.hype}%"></s></span><em>${st.hype}</em>
      </div>
    </div>
    <div class="ft"><span>${c.y || "—"}</span><span class="rn">${RAR[c.tier]}</span></div>
  </div><div class="foil"></div>`;
  const w = document.createElement("div"); w.className = "cq"; w.appendChild(el);
  return w;
}
function backEl() { const w = document.createElement("div"); w.className = "cq"; w.innerHTML = '<div class="back"><div class="in"><b>SILLONS</b></div></div>'; return w; }

/* ---------- views ---------- */
const views = { shop: $("#view-shop"), binder: $("#view-binder"), catalog: $("#view-catalog") };
function show(v) {
  for (const k in views) { views[k].hidden = k !== v; $("#tab-" + k).setAttribute("aria-selected", k === v); }
  if (v === "binder") renderBinder();
  if (v === "catalog") { if (!CAT.loaded) catLoad(true); else renderCatalog(); }
}
$("#tab-shop").onclick = () => show("shop");
$("#tab-binder").onclick = () => show("binder");
$("#tab-catalog").onclick = () => show("catalog");

const owned = () => Object.values(S.c);
function renderCounters() {
  const all = owned();
  $("#counters").innerHTML = `<span>Cartes <b>${fmt(all.length)}</b></span><span class="leg">Légendaires <b>${all.filter(c => c.tier === 4).length}</b></span><span>Boosters ouverts <b>${fmt(S.opened)}</b></span>`;
}

/* ---------- shelf ---------- */
const PACKS = [{ g: -1, n: "Mix", sub: "Tout Deezer" }, ...TYPES.slice(0, AUTRE).map((t, g) => ({ g, n: t.n, sub: "Booster " + t.n }))];
const shelf = $("#shelf");
PACKS.forEach(p => {
  const b = document.createElement("button"); b.className = "pack" + (p.g < 0 ? " mix" : "");
  if (p.g >= 0) b.style.setProperty("--h", TYPES[p.g].h);
  b.innerHTML = `<span class="disc"></span><span class="lbl"><b>${p.n}</b><span>${p.sub} · 5 cartes</span></span>`;
  b.setAttribute("aria-label", "Ouvrir un booster " + p.n);
  b.onclick = () => openPack(p);
  shelf.appendChild(b);
});

/* ---------- opening ---------- */
let lastPack = null, busy = false;
const LOADING_LINES = ["On fouille Deezer…", "On feuillette les bacs…", "On souffle sur les vinyles…", "On écoute les 30 premières secondes…"];
async function openPack(p) {
  if (busy) return;
  busy = true; lastPack = p;
  document.querySelectorAll(".pack, #again").forEach(b => b.disabled = true);
  const table = $("#table"), deal = $("#deal");
  table.hidden = false; $("#tableTitle").textContent = "Booster " + p.n;
  deal.innerHTML = "";
  const rip = document.createElement("div"); rip.className = "rip loading";
  const pk = shelf.children[PACKS.indexOf(p)].cloneNode(true); pk.tabIndex = -1; pk.disabled = true;
  const line = document.createElement("p"); line.textContent = pick(LOADING_LINES);
  rip.append(pk, line); deal.appendChild(rip);
  table.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
  const lineTimer = setInterval(() => line.textContent = pick(LOADING_LINES), 1600);

  try {
    const used = new Set(), slots = [];
    for (let s = 0; s < 5; s++) slots.push(rollTier(s === 4));
    const raws = [];
    for (const tier of slots) {           // sequential so one slot can't pick a track another slot already took
      const t = await findTrack(p.g, tier, used);
      if (t) { used.add(t.id); raws.push(t); }
    }
    if (raws.length < 5) throw { code: "short" };
    const cards = await Promise.all(raws.map(t => enrich(t, p.g)));
    const pulls = cards.map(c => {
      const holo = Math.random() < .04, prev = S.c[c.id];
      S.c[c.id] = { ...c, n: (prev?.n || 0) + 1, holo: (prev?.holo || 0) + (holo ? 1 : 0), at: prev?.at || Date.now() };
      return { c, holo, isNew: !prev };
    }).sort((a, b) => a.c.tier - b.c.tier);
    S.opened++; save(); renderCounters();
    deal.innerHTML = "";
    const grid = document.createElement("div"); grid.className = "deal"; deal.appendChild(grid);
    pulls.forEach((pl, i) => grid.appendChild(slotEl(pl, i)));
  } catch (err) {
    rip.classList.remove("loading");
    line.className = "err";
    line.textContent = err.code === "network" || err.code === "timeout"
      ? "Deezer ne répond pas. Vérifie ta connexion puis réessaie."
      : err.code === 4 ? "Deezer limite le nombre de demandes. Attends quelques secondes puis réessaie."
      : "Le booster n'a pas pu être rempli. Réessaie.";
  } finally {
    clearInterval(lineTimer);
    busy = false;
    document.querySelectorAll(".pack, #again").forEach(b => b.disabled = false);
  }
}
function slotEl(pl, i) {
  const slot = document.createElement("div"); slot.className = "slot"; slot.style.animationDelay = (i * 90) + "ms";
  const f = document.createElement("button"); f.className = "flip"; f.setAttribute("aria-label", "Retourner la carte " + (i + 1));
  const back = document.createElement("div"); back.className = "face"; back.appendChild(backEl());
  const front = document.createElement("div"); front.className = "face front"; front.appendChild(cardEl(pl.c, pl.holo));
  f.append(back, front);
  const tag = document.createElement("span"); tag.className = "tag"; tag.innerHTML = "&nbsp;";
  f.onclick = () => {
    if (f.classList.contains("on")) return openModal(pl.c);
    f.classList.add("on"); f.setAttribute("aria-label", pl.c.t + ", " + RAR[pl.c.tier]);
    if (pl.c.tier >= 3) slot.classList.add("burst");
    tag.textContent = (pl.isNew ? "Nouvelle · " : "Doublon · ") + RAR[pl.c.tier] + (pl.holo ? " · Holo" : "");
    if (pl.isNew) tag.classList.add("new");
  };
  slot.append(f, tag);
  return slot;
}
$("#flipAll").onclick = () => document.querySelectorAll("#deal .flip:not(.on)").forEach((f, i) => setTimeout(() => f.click(), i * 160));
$("#again").onclick = () => { if (lastPack) openPack(lastPack); };

/* ---------- binder ---------- */
const F = { g: -1, r: -1, sort: "recent" };
function renderBinder() {
  const all = owned();
  const pg = $("#prog");
  const rows = [{ g: -1, n: "Tout", h: 42 }].concat(TYPES.map((t, g) => ({ g, n: t.n, h: t.h })));
  pg.innerHTML = rows.map(t => {
    const list = t.g < 0 ? all : all.filter(c => c.g === t.g);
    const leg = list.filter(c => c.tier === 4).length;
    return `<button data-g="${t.g}" style="--h:${t.h}" aria-pressed="${F.g === t.g}"><span class="row">${t.n}<small>${fmt(list.length)}</small></span><span class="meter"><s style="width:${all.length ? list.length / all.length * 100 : 0}%"></s></span><small class="legs">${leg} légendaire${leg > 1 ? "s" : ""}</small></button>`;
  }).join("");
  pg.querySelectorAll("button").forEach(b => b.onclick = () => { F.g = +b.dataset.g; renderBinder(); });

  const fl = $("#filters");
  fl.innerHTML = [-1, 0, 1, 2, 3, 4].map(r => `<button class="chip" data-r="${r}" aria-pressed="${F.r === r}">${r < 0 ? "Toutes raretés" : `<i style="background:${RCOL[r]}"></i>${RAR[r]}`}</button>`).join("") +
    `<label for="fSort">Trier par <select id="fSort"><option value="recent">plus récentes</option><option value="rarity">rareté</option><option value="pw">puissance</option><option value="year">année de sortie</option><option value="dup">doublons</option></select></label>`;
  $("#fSort").value = F.sort;
  fl.querySelectorAll(".chip").forEach(b => b.onclick = () => { F.r = +b.dataset.r; renderBinder(); });
  $("#fSort").onchange = e => { F.sort = e.target.value; renderBinder(); };

  let list = all.filter(c => (F.g < 0 || c.g === F.g) && (F.r < 0 || c.tier === F.r));
  const by = {
    recent: (a, b) => b.at - a.at,
    rarity: (a, b) => b.rank - a.rank,
    pw: (a, b) => stats(b).pw - stats(a).pw,
    year: (a, b) => b.y - a.y,
    dup: (a, b) => b.n - a.n,
  }[F.sort];
  list.sort(by);
  const bd = $("#binder"); bd.innerHTML = "";
  if (!list.length) {
    bd.innerHTML = `<div class="empty">${all.length ? "Aucune carte ne correspond à ces filtres." : "Ta collection est vide. Ouvre un booster pour tirer tes premiers morceaux."}</div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  for (const c of list) {
    const b = document.createElement("button"); b.className = "cell";
    b.setAttribute("aria-label", c.t + " de " + c.a);
    b.appendChild(cardEl(c, c.holo > 0));
    if (c.n > 1) { const n = document.createElement("span"); n.className = "cnt"; n.textContent = "×" + c.n; b.appendChild(n); }
    b.onclick = () => openModal(c);
    frag.appendChild(b);
  }
  bd.appendChild(frag);
}

/* ---------- catalogue: any Deezer track, searchable ---------- */
const PAGE = 24;
const CAT = { q: "", order: "", items: [], index: 0, total: 0, loaded: false, seq: 0, r: -1, own: "all" };
const fullCards = {};                     // id → card with genre, BPM and year fetched
function quickCard(t) {                   // what a search result alone tells us
  return {
    id: t.id, t: t.title_short || t.title, a: t.artist?.name || "?", al: t.album?.title || "",
    cov: (t.album?.cover_big || t.album?.cover_medium || "").replace(/^http:/, "https:"),
    d: t.duration || 0, rank: t.rank || 0, bpm: 0, y: 0, x: t.explicit_lyrics ? 1 : 0, g: null, tier: tierOf(t.rank || 0),
  };
}
const catCard = t => S.c[t.id] || fullCards[t.id] || quickCard(t);

async function catLoad(reset) {
  const seq = ++CAT.seq;
  if (reset) { CAT.items = []; CAT.index = 0; CAT.total = 0; $("#catalog").innerHTML = ""; }
  CAT.loaded = true;
  $("#catMore").hidden = true;
  $("#catStatus").textContent = "Chargement des cartes…";
  try {
    let data, total;
    if (!CAT.q) {
      const d = await dz("chart/0/tracks", { limit: 100 });
      data = d.data || []; total = data.length;
    } else {
      const params = { q: CAT.q, limit: PAGE, index: CAT.index };
      if (CAT.order) params.order = CAT.order;
      const d = await dz("search", params);
      data = d.data || []; total = d.total || 0;
    }
    if (seq !== CAT.seq) return;          // a newer search replaced this one
    const seen = new Set(CAT.items.map(t => t.id));
    CAT.items.push(...data.filter(t => t.album && !seen.has(t.id)));
    CAT.index += data.length || PAGE; CAT.total = total;
    renderCatalog();
  } catch (e) {
    if (seq !== CAT.seq) return;
    $("#catStatus").textContent = e.code === 4 ? "Deezer limite le nombre de demandes. Attends quelques secondes puis réessaie." : "Deezer ne répond pas. Vérifie ta connexion puis réessaie.";
  }
}

let catObserver = null;
function renderCatalog() {
  $("#catFilters").innerHTML = [-1, 0, 1, 2, 3, 4].map(r => `<button class="chip" data-r="${r}" aria-pressed="${CAT.r === r}">${r < 0 ? "Toutes raretés" : `<i style="background:${RCOL[r]}"></i>${RAR[r]}`}</button>`).join("") +
    `<label for="catOwn">Afficher <select id="catOwn"><option value="all">toutes les cartes</option><option value="own">mes cartes</option><option value="miss">à trouver</option></select></label>`;
  $("#catOwn").value = CAT.own;
  $("#catFilters").querySelectorAll(".chip").forEach(b => b.onclick = () => { CAT.r = +b.dataset.r; renderCatalog(); });
  $("#catOwn").onchange = e => { CAT.own = e.target.value; renderCatalog(); };

  const list = CAT.items.filter(t => (CAT.r < 0 || tierOf(catCard(t).rank) === CAT.r) &&
    (CAT.own === "all" || (CAT.own === "own") === !!S.c[t.id]));
  const ownedHere = CAT.items.filter(t => S.c[t.id]).length;
  $("#catStatus").textContent = !CAT.items.length
    ? (CAT.q ? `Aucun morceau trouvé pour « ${CAT.q} ».` : "Aucune carte à afficher.")
    : `${CAT.q ? fmt(CAT.total) + " résultats pour « " + CAT.q + " »" : "Les 100 tubes du moment sur Deezer"} · ${fmt(CAT.items.length)} affichées, dont ${ownedHere} dans ta collection`;
  $("#catMore").hidden = !CAT.q || CAT.index >= CAT.total;

  const grid = $("#catalog"); grid.innerHTML = "";
  if (catObserver) catObserver.disconnect();
  catObserver = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    catObserver.unobserve(e.target); completeCell(e.target);
  }), { rootMargin: "300px" });
  if (CAT.items.length && !list.length) { grid.innerHTML = `<div class="empty">Aucune carte ne correspond à ces filtres.</div>`; return; }
  const frag = document.createDocumentFragment();
  for (const t of list) { const cell = catCell(t); frag.appendChild(cell); if (catCard(t).g == null) catObserver.observe(cell); }
  grid.appendChild(frag);
}
function catCell(t) {
  const c = catCard(t), own = S.c[t.id];
  const b = document.createElement("button");
  b.className = "cell" + (own ? "" : " locked"); b.dataset.id = t.id; b.track = t;
  b.setAttribute("aria-label", c.t + " de " + c.a + (own ? ", dans ta collection" : ", pas encore trouvée"));
  b.appendChild(cardEl(c, own?.holo > 0));
  if (own) { if (own.n > 1) { const n = document.createElement("span"); n.className = "cnt"; n.textContent = "×" + own.n; b.appendChild(n); } }
  else { const l = document.createElement("span"); l.className = "lock"; l.textContent = "À trouver"; b.appendChild(l); }
  b.onclick = async () => openModal(catCard(t).g == null ? await completeCell(b) : catCard(t));
  return b;
}
// fetch genre, BPM and release year only for cards that scroll into view
async function completeCell(cell) {
  const t = cell.track;
  if (!fullCards[t.id]) fullCards[t.id] = await enrich(t, -1);
  if (cell.isConnected) cell.replaceWith(catCell(t));
  return fullCards[t.id];
}

let searchTimer;
$("#q").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { CAT.q = $("#q").value.trim(); catLoad(true); }, 350);
});
$("#qOrder").onchange = () => { CAT.order = $("#qOrder").value; if (CAT.q) catLoad(true); };
$("#searchForm").onsubmit = e => { e.preventDefault(); clearTimeout(searchTimer); CAT.q = $("#q").value.trim(); catLoad(true); };
$("#catMore").onclick = () => catLoad(false);

/* ---------- detail + preview audio ---------- */
const modal = $("#modal"), audio = new Audio();
let lastFocus = null, current = null;
audio.onended = audio.onpause = () => { $("#mPlay").textContent = "Écouter l'extrait"; $("#mPlay").setAttribute("aria-pressed", "false"); };
audio.onplay = () => { $("#mPlay").textContent = "Pause"; $("#mPlay").setAttribute("aria-pressed", "true"); };
function openModal(c) {
  lastFocus = document.activeElement; current = c;
  const own = S.c[c.id] || { n: 0, holo: 0 }, st = stats(c), T = TYPES[c.g] || TYPES[AUTRE];
  const box = $("#mCard"); box.innerHTML = "";
  const w = cardEl(c, own.holo > 0); box.appendChild(w);
  $("#mTitle").textContent = c.t; $("#mSub").textContent = c.a + " · " + c.al;
  $("#mDl").innerHTML = `<dt>Rareté</dt><dd>${RAR[c.tier]}</dd><dt>Classement</dt><dd>${fmt(c.rank)} pts Deezer</dd>
    <dt>${T.s}</dt><dd>${st.flow} · ${c.bpm > 0 ? c.bpm + " BPM" : "tempo estimé"}</dd><dt>Endurance</dt><dd>${st.endu} · ${fmtDur(c.d)}</dd>
    <dt>Hype</dt><dd>${st.hype}</dd><dt>Sortie</dt><dd>${c.y || "?"}</dd><dt>Possédées</dt><dd>${own.n}${own.holo ? ` (dont ${own.holo} holo)` : ""}</dd>`;
  $("#mLink").href = "https://www.deezer.com/track/" + c.id;
  audio.pause();
  modal.hidden = false; $("#mPlay").focus();
  box.onpointermove = e => {
    const r = box.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    w.style.transform = `rotateY(${(px - .5) * 22}deg) rotateX(${(.5 - py) * 22}deg)`;
    w.style.setProperty("--fx", px * 100 + "%"); w.style.setProperty("--fy", py * 100 + "%");
  };
  box.onpointerleave = () => { w.style.transform = ""; };
}
// preview links expire after a while, so fetch a fresh one each time
$("#mPlay").onclick = async () => {
  if (!audio.paused) return audio.pause();
  const c = current; if (!c) return;
  $("#mPlay").textContent = "Chargement…";
  try {
    const t = await dz("track/" + c.id);
    if (!t.preview) throw 0;
    if (current !== c) return;
    audio.src = t.preview; await audio.play();
  } catch (e) { $("#mPlay").textContent = "Écouter l'extrait"; toast("Pas d'extrait disponible pour ce morceau."); }
};
function closeModal() { audio.pause(); modal.hidden = true; current = null; lastFocus?.focus?.(); }
$("#mClose").onclick = closeModal;
modal.onclick = e => { if (e.target === modal) closeModal(); };
addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) closeModal(); });

renderCounters();
