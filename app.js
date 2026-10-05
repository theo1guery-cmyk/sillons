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

const RAR = ["Commune", "Peu commune", "Rare", "Épique", "Mythique", "Légendaire"];
const RCOL = ["var(--r0)", "var(--r1)", "var(--r2)", "var(--r3)", "var(--r4)", "var(--r5)"];
const MYTH = 4, LEG = 5, TOP = RAR.length - 1;
// Deezer rank (0 – 1 000 000) → rarity. 950 000+ is the global-hit club
// (Billie Jean, Bohemian Rhapsody…): a few thousand tracks out of 100+ million.
const TIER_MIN = [0, 250000, 450000, 700000, 850000, 950000];
const tierOf = rank => TIER_MIN.reduce((t, m, i) => rank >= m ? i : t, 0);
const inTier = (rank, t) => rank >= TIER_MIN[t] && (t === TOP || rank < TIER_MIN[t + 1]);
const tierDistance = (rank, t) => rank < TIER_MIN[t] ? TIER_MIN[t] - rank : t < TOP && rank >= TIER_MIN[t + 1] ? rank - TIER_MIN[t + 1] + 1 : 0;

// Every card of a booster uses the same odds (no guaranteed slot).
const DROP = [70, 21, 7, 1.7, 0.28, 0.02];
const PITY = 70;                         // boosters without a Mythique or better before one is guaranteed
const GOD_CHANCE = 1 / 3000;             // a booster turns into a GOD pack: 1 Légendaire + 4 cards that are Mythique or Légendaire (50/50)
const STOCK_MAX = 10, REFILL_MS = 30 * 60 * 1000;
let TEST_MODE = true;                   // unlimited free boosters while the game is being tested (read from the server when signed in)
// signed-in play lives in online.js; this flag switches the game between the guest (this browser) and account modes
const Online = { active: false };

const WORDS = ("amour love night fire heart soleil baby dance rain moon party road summer life dream girl boy city sky street gold blue black red " +
  "money time world king queen star ocean corazon vida noche fuego liebe nacht herz amore notte cuore mama papa " +
  "freedom home light dark sun angel devil crazy wild young forever tonight tomorrow yesterday sweet bad good happy sad lonely alone together " +
  "music song radio rock roll soul funk disco house techno bass beat flow rap hip hop jazz blues reggae samba salsa tango bossa afro " +
  "pourquoi jamais toujours encore ciel mer terre feu eau vent nuit jour rêve coeur fille garçon ville rue route fête danse chanson " +
  "musique liberté paradis enfer temps vie mort belle beau fou folle quiero bailar dinero calle playa sol luna fiesta cielo mujer hombre loco loca " +
  "mein dein liebe welt zeit leben saudade eu você baila kuduro wahala " +
  "boom bang hey yeah fly high low down run fall rise shine glow break wake stay come back river mountain window mirror letter " +
  "summer winter autumn spring morning evening midnight sunrise sunset thunder storm snow ice smoke shadow ghost dragon tiger wolf lion " +
  "bird butterfly flower rose garden forest desert island highway train plane car bike boat bridge tower castle church school hospital " +
  "doctor teacher soldier pirate cowboy queen prince princess hero villain friend enemy brother sister mother father daughter son lover " +
  "kiss hug tears smile laugh cry scream whisper silence noise echo memory secret promise lie truth faith hope fear anger peace war " +
  "blood bones skin eyes lips hands feet wings crown diamond silver money cash gun knife poison medicine wine beer coffee tea sugar honey").split(" ");
const NAMES = ("maria anna sofia julia emma lea chloe ines sarah laura camille manon alice lina nina lola rosa elena clara carmen lucia " +
  "jose juan carlos pedro luis miguel antonio pablo diego paul pierre jean louis lucas hugo leo nathan theo adam ali omar karim yasmine " +
  "fatou aminata moussa mamadou ibrahim kofi kwame ama akira yuki hana kenji min jin seo ivan olga natasha dmitri sven lars ingrid " +
  "johnny jimmy billy bobby tommy frankie charlie eddie sammy danny joey mickey lucy molly peggy sally susie annie katie betty").split(" ");
const PLACES = ("paris london berlin madrid roma lisboa tokyo seoul lagos dakar abidjan kinshasa cairo dubai mumbai delhi bangkok sydney " +
  "chicago detroit memphis nashville atlanta miami texas california brooklyn harlem bronx compton havana kingston rio bahia salvador " +
  "bogota medellin lima santiago mexico tijuana montreal quebec marseille lyon toulouse bordeaux lille nice napoli milano venezia " +
  "amsterdam bruxelles zurich wien praha moscow istanbul athens africa europe america asia jamaica brasil argentina colombia").split(" ");
const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const CONS = "bcdfghjklmnprstvz", VOW = "aeiou";
const pick = a => a[Math.floor(Math.random() * a.length)];
const randInt = n => Math.floor(Math.random() * n);
// pronounceable nonsense ("kelo", "maribu") hits titles and artist names in every language
const syllables = () => Array.from({ length: 2 + randInt(2) }, () => pick(CONS) + pick(VOW)).join("");
function randomQuery(meaningful) {
  const r = Math.random();
  if (meaningful || r < .45) {
    const r2 = Math.random();
    return r2 < .55 ? pick(WORDS) : r2 < .8 ? pick(NAMES) : r2 < .95 ? pick(PLACES) : String(1955 + randInt(71));
  }
  if (r < .8) return syllables();
  return Array.from({ length: 2 + randInt(3) }, () => pick(LETTERS)).join("");
}

function rollTier() {
  let r = Math.random() * DROP.reduce((a, b) => a + b);
  for (let i = 0; i < DROP.length; i++) if ((r -= DROP[i]) < 0) return i;
  return 0;
}
// pity: Mythique or Légendaire with their own relative odds
const rollTopTier = () => Math.random() < DROP[LEG] / (DROP[MYTH] + DROP[LEG]) ? LEG : MYTH;

/* ---------- where cards come from ----------
   Communes: true random Deezer track numbers (every track equally likely, even ones nobody plays).
   Higher rarities: public playlists, an artist-to-artist walk and searches, which reach known tracks.
   Nothing already in the collection is handed out from Commune to Épique. */
const isPlayable = t => t && t.readable !== false && t.album && t.artist;
const tag = (list, src) => { for (const t of list) t._src = t._src || src; return list; };

// 1) random track numbers: about 1 in 12 is a playable track, so a background loop keeps a reserve
const ID_MAX = 4200000000, RESERVE_MAX = 30;
const reserve = RAR.map(() => []);       // tracks waiting to be pulled, by rarity
let probing = 0;
function stash(list) {                   // keep good leftovers instead of throwing fetched tracks away
  for (const t of list) {
    const r = reserve[tierOf(t.rank || 0)];
    if (isPlayable(t) && !S.c[t.id] && r.length < RESERVE_MAX && !r.some(x => x.id === t.id)) r.push(t);
  }
}
async function probeRandomTrack() {
  try { const t = await dz("track/" + (1 + randInt(ID_MAX))); if (isPlayable(t)) stash(tag([t], "id")); } catch (e) {}
}
setInterval(() => {                      // only when Deezer isn't busy with a booster
  if (probing >= 2 || queue.length || reserve[0].length >= RESERVE_MAX) return;
  probing++; probeRandomTrack().finally(() => probing--);
}, 220);
function takeReserve(tier, used) {
  const r = reserve[tier];
  for (let i = r.length - 1; i >= 0; i--) {
    const t = r[i];
    if (S.c[t.id] || used.has(t.id)) { r.splice(i, 1); continue; }
    if (tier === 0 && t._src !== "id") continue;   // Communes come from true random draws when there are some
    r.splice(i, 1); return t;
  }
  return null;
}

// 2) searches (random words, names, syllables; sorted by popularity for the top rarities)
async function searchPool(tier) {
  const high = tier >= 3;
  const params = { q: randomQuery(high), limit: 100 };
  if (high) {
    params.order = "RANKING";
    params.index = tier === LEG ? randInt(2) * 100 : randInt(3) * 100;
  } else params.index = randInt(tier === 0 ? 250 : 150);
  const d = await dz("search", params);
  return tag(d.data || [], high ? "ranking" : "search");
}

// 3) public playlists: hundreds of thousands of known tracks, every style and era
const PL_TERMS = ["hits", "top", "tubes", "best of", "classics", "chill", "relax", "party", "soirée", "workout", "running", "summer", "été",
  "love", "sad", "happy", "road trip", "rap", "rap français", "hip hop", "drill", "trap", "rnb", "soul", "funk", "disco", "pop", "rock",
  "indie", "metal", "punk", "electro", "house", "techno", "edm", "dance", "afro", "afrobeats", "amapiano", "reggae", "dancehall", "latino",
  "reggaeton", "salsa", "bachata", "kpop", "jpop", "bollywood", "arabic", "raï", "chanson française", "variété", "jazz", "blues", "country",
  "folk", "classique", "piano", "lofi", "ambient", "soundtrack", "anime", "gaming", "oldies", "throwback", "acoustic", "covers", "remix"];
const PL_MODS = ["60s", "70s", "80s", "90s", "2000s", "2010s", "2020s", "années 80", "années 90", "années 2000", "2015", "2018", "2021", "2024",
  "chill", "hits", "best", "underground", "nostalgie", "playlist", "mix", "radio"];
const playlistQuery = base => (base || pick(PL_TERMS)) + (Math.random() < .45 ? " " + pick(PL_MODS) : "");
async function playlistPool(base) {
  const d = await dz("search/playlist", { q: playlistQuery(base), limit: 50, index: randInt(3) * 50 });
  const pls = (d.data || []).filter(p => p.nb_tracks > 0);
  if (!pls.length) return [];
  const p = pick(pls);
  const index = p.nb_tracks > 100 ? randInt(Math.min(p.nb_tracks - 100, 2000)) : 0;
  const t = await dz(`playlist/${p.id}/tracks`, { limit: 100, index });
  return tag(t.data || [], "playlist");
}

// 4) artist walk: from an artist, Deezer gives 20 similar artists and their top tracks, endlessly
const frontiers = {};                    // "all" or a genre index → artist ids to visit
const frontier = key => frontiers[key] = frontiers[key] || [];
function noteArtists(list, key) {
  const f = frontier(key);
  for (const t of list) { const id = t.artist?.id || t.id; if (id && f.length < 4000) f.push(id); }
}
async function artistPool(key) {
  const f = frontier(key);
  if (!f.length) return [];
  const id = pick(f);
  const [top, rel] = await Promise.all([
    dz(`artist/${id}/top`, { limit: 50 }).catch(() => ({})),
    Math.random() < .5 ? dz(`artist/${id}/related`, { limit: 20 }).catch(() => ({})) : {},
  ]);
  noteArtists(rel.data || [], key);
  return tag(top.data || [], "artist");
}

function poolFor(tier) {
  const r = Math.random();
  if (tier <= 1) return searchPool(tier);
  if (tier <= 3) return r < .45 ? playlistPool() : r < .75 && frontier("all").length ? artistPool("all") : searchPool(tier);
  return r < .5 ? searchPool(tier) : playlistPool();
}

async function findTrack(typeIdx, tier, used) {
  if (typeIdx >= 0) return findGenreTrack(typeIdx, tier, used);
  const ready = takeReserve(tier, used);
  if (ready) return ready;
  let best = null, ownedHit = null;
  const attempts = tier >= MYTH ? 10 : 25;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const pool = (await poolFor(tier).catch(() => [])).filter(t => isPlayable(t) && !used.has(t.id));
    if (pool[0]?._src === "playlist") noteArtists(pool, "all");
    const fresh = pool.filter(t => !S.c[t.id]);
    const hits = fresh.filter(t => inTier(t.rank, tier));
    if (hits.length) { const t = pick(hits); stash(fresh.filter(x => x !== t && tierOf(x.rank) >= 1)); return t; }
    stash(fresh.filter(x => tierOf(x.rank) >= 1));
    if (!ownedHit) ownedHit = pool.find(t => inTier(t.rank, tier)) || null;
    for (const t of fresh) { const d = tierDistance(t.rank, tier); if (!best || d < best.d) best = { t, d }; }
  }
  // Commune → Épique never repeat: a new track of the nearest rarity beats a duplicate
  return tier <= 3 ? (best && best.t) || ownedHit : ownedHit || (best && best.t);
}

/* ---------- genre boosters (boutique) ---------- */
const GENRE_TERMS = {
  rap: ["rap", "rap français", "hip hop", "drill", "trap", "rap us", "boom bap", "rap old school", "rap belge", "uk rap"],
  pop: ["pop", "pop hits", "pop française", "kpop", "dance pop", "pop rock", "teen pop", "synthpop"],
  rock: ["rock", "rock classique", "indie rock", "metal", "punk", "grunge", "hard rock", "rock français", "alternative rock"],
  electro: ["electro", "house", "techno", "edm", "french touch", "drum and bass", "trance", "deep house"],
  soul: ["rnb", "soul", "funk", "neo soul", "r&b", "motown", "rnb français"],
  chanson: ["chanson française", "variété française", "chanson", "nouvelle scène française", "chansons françaises"],
  jazz: ["jazz", "blues", "jazz piano", "bebop", "smooth jazz", "jazz vocal", "jazz classics", "delta blues"],
  latino: ["reggaeton", "latino", "salsa", "bachata", "musica latina", "brasil", "bossa nova", "cumbia"],
  afro: ["afrobeats", "reggae", "dancehall", "afro", "coupé décalé", "amapiano", "zouk", "roots reggae"],
  classique: ["classique", "musique classique", "piano classique", "bande originale", "soundtrack", "orchestre", "opéra"],
};
const genreCache = {};
async function genrePool(typeIdx, tier) {   // Deezer genre radios
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
  return tag((await genreCache[key]).slice(), "radio");
}
function genreSource(typeIdx, tier) {
  const r = Math.random();
  if (r < .5) return playlistPool(pick(GENRE_TERMS[TYPES[typeIdx].k]));
  if (r < .85 && frontier(typeIdx).length) return artistPool(typeIdx);
  return genrePool(typeIdx, tier);
}
const albumCache = {};
const getAlbum = id => albumCache[id] = albumCache[id] || dz("album/" + id).catch(() => ({}));
async function firstOfType(cands, typeIdx) {   // checks each album's real genre
  for (const t of cands.sort(() => Math.random() - .5).slice(0, 6)) {
    const g = typeOfGenre((await getAlbum(t.album.id)).genre_id);
    if (g === typeIdx) { noteArtists([t], typeIdx); return t; }
  }
  return null;
}
async function findGenreTrack(typeIdx, tier, used) {
  let near = [];
  const attempts = tier >= MYTH ? 10 : 18;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const fresh = (await genreSource(typeIdx, tier).catch(() => [])).filter(t => isPlayable(t) && !used.has(t.id) && !S.c[t.id]);
    const ok = await firstOfType(fresh.filter(t => inTier(t.rank, tier)), typeIdx);
    if (ok) return ok;
    near.push(...fresh);
  }
  // nothing of that exact rarity: the new track of the right genre with the nearest rarity
  near = [...new Map(near.map(t => [t.id, t])).values()].sort((a, b) => tierDistance(a.rank, tier) - tierDistance(b.rank, tier));
  for (let i = 0; i < near.length && i < 36; i += 6) {
    const ok = await firstOfType(near.slice(i, i + 6), typeIdx);
    if (ok) return ok;
  }
  if (near[0]) return near[0];
  const mine = Object.values(S.c).filter(c => c.g === typeIdx && c.tier === tier);   // last resort: a random owned card, never a fixed one
  if (!mine.length) return null;
  const c = pick(mine);
  return { id: c.id, _card: c, _src: "owned" };
}

async function enrich(t, typeIdx) {
  if (t._card) return { ...t._card };
  const [full, album] = await Promise.all([
    t._src === "id" ? t : dz("track/" + t.id).catch(() => ({})),   // random draws already are full track records
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
// rarities v2: re-tier every saved card from the Deezer rank it had when it was pulled
for (const c of Object.values(S.c)) c.tier = tierOf(c.rank || 0);
if (S.stock == null) { S.stock = STOCK_MAX; S.stockAt = Date.now(); }
if (S.dry == null) S.dry = 0;            // boosters opened since the last Mythique or better

/* booster stock: one more every 30 min, up to 10 */
function refill() {
  const now = Date.now();
  if (S.stock >= STOCK_MAX) { S.stockAt = now; return; }
  const gained = Math.floor((now - S.stockAt) / REFILL_MS);
  if (gained > 0) { S.stock = Math.min(STOCK_MAX, S.stock + gained); S.stockAt = S.stock >= STOCK_MAX ? now : S.stockAt + gained * REFILL_MS; }
}
const nextRefillMs = () => S.stock >= STOCK_MAX ? 0 : S.stockAt + REFILL_MS - Date.now();
function save() {
  if (Online.active) return;             // with an account, the server holds the collection
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
const views = { shop: $("#view-shop"), store: $("#view-store"), binder: $("#view-binder"), catalog: $("#view-catalog"), trades: $("#view-trades"), defis: $("#view-defis") };
function show(v) {
  for (const k in views) { views[k].hidden = k !== v; $("#tab-" + k).setAttribute("aria-selected", k === v); }
  $("#tableWrap").hidden = v !== "shop" && v !== "store";   // the opening table follows the booster tabs
  if (v === "binder") { renderBinder(); Online.renderDiscard?.(); }
  if (v === "catalog") { if (!CAT.loaded) catLoad(true); else renderCatalog(); }
  if (v === "trades") Online.renderTrades();
  if (v === "defis") Online.renderDefis();
}
$("#tab-shop").onclick = () => show("shop");
$("#tab-store").onclick = () => show("store");
$("#tab-binder").onclick = () => show("binder");
$("#tab-catalog").onclick = () => show("catalog");
$("#tab-trades").onclick = () => show("trades");
$("#tab-defis").onclick = () => show("defis");

const owned = () => Object.values(S.c);
function renderCounters() {
  const all = owned();
  $("#counters").innerHTML = (Online.active ? `<span class="streams">Streams <b>${fmt(S.streams || 0)}</b></span>` : "") + `<span>Cartes <b>${fmt(all.length)}</b></span><span class="myth">Mythiques <b>${all.filter(c => c.tier === MYTH).length}</b></span><span class="leg">Légendaires <b>${all.filter(c => c.tier === LEG).length}</b></span><span>Boosters ouverts <b>${fmt(S.opened)}</b></span>`;
}

/* ---------- shelf: one booster, limited stock ---------- */
const BOOSTER = { g: -1, n: "Booster" };
const shelf = $("#shelf");
const packBtn = document.createElement("button");
packBtn.className = "pack mix";
packBtn.innerHTML = `<span class="disc"></span><span class="lbl"><b>Booster</b><span>5 cartes · tout Deezer</span></span>`;
packBtn.setAttribute("aria-label", "Ouvrir un booster");
packBtn.onclick = () => openPack(BOOSTER);
BOOSTER.el = packBtn;
const stockEl = document.createElement("div"); stockEl.className = "stock"; stockEl.setAttribute("aria-live", "polite");
shelf.append(packBtn, stockEl);
function renderStock() {
  if (TEST_MODE) {
    stockEl.innerHTML = `<b>Boosters illimités</b><span class="test-badge">Mode test</span>
      <small>Le stock de 10 boosters (un nouveau toutes les 30 min) sera activé à la sortie du jeu.</small>
      <small>Mythique garantie dans ${Math.max(1, PITY - S.dry)} booster${PITY - S.dry > 1 ? "s" : ""} si tu n'en tires pas avant</small>`;
    if (!busy) { packBtn.disabled = false; $("#again").disabled = false; }
    return;
  }
  refill();
  const left = nextRefillMs(), min = Math.max(1, Math.ceil(left / 60000));
  const pips = Array.from({ length: STOCK_MAX }, (_, i) => `<i class="${i < S.stock ? "on" : ""}"></i>`).join("");
  stockEl.innerHTML = `<b>${S.stock} / ${STOCK_MAX}</b> booster${S.stock > 1 ? "s" : ""} disponible${S.stock > 1 ? "s" : ""}
    <span class="pips" aria-hidden="true">${pips}</span>
    <small>${S.stock >= STOCK_MAX ? "Stock plein. Un nouveau booster arrive toutes les 30 min quand le stock n'est pas plein." : `Prochain booster dans ${min >= 60 ? "1 h" : min + " min"}`}</small>
    <small>Mythique garantie dans ${Math.max(1, PITY - S.dry)} booster${PITY - S.dry > 1 ? "s" : ""} si tu n'en tires pas avant</small>`;
  const empty = S.stock <= 0;
  if (!busy) { packBtn.disabled = empty; $("#again").disabled = empty; }
}
setInterval(() => { renderStock(); save(); }, 30000);

/* ---------- boutique: one-genre boosters (free while testing, paid later) ---------- */
const STORE_PACKS = TYPES.slice(0, AUTRE).map((t, g) => ({ g, n: t.n }));
for (const p of STORE_PACKS) {
  const offer = document.createElement("div"); offer.className = "offer";
  const b = document.createElement("button"); b.className = "pack"; b.style.setProperty("--h", TYPES[p.g].h);
  b.innerHTML = `<span class="disc"></span><span class="lbl"><b>${p.n}</b><span>5 cartes ${p.n}</span></span>`;
  b.setAttribute("aria-label", "Ouvrir un booster " + p.n);
  b.onclick = () => openPack(p);
  p.el = b;
  const price = document.createElement("div"); price.className = "price";
  price.innerHTML = `<b>Gratuit</b><small>bientôt payant</small>`;
  const buy = document.createElement("button"); buy.className = "btn primary"; buy.textContent = "Ouvrir";
  buy.setAttribute("aria-label", "Ouvrir un booster " + p.n + " gratuitement");
  buy.onclick = () => openPack(p);
  offer.append(b, price, buy); $("#store").appendChild(offer);
}

/* ---------- drawing a booster (no UI) ---------- */
async function drawPack(p, god = false, forced = null) {
  const used = new Set(), slots = [];
  if (forced) slots.push(...forced);
  else if (god) {
    slots.push(LEG);
    for (let s = 0; s < 4; s++) slots.push(Math.random() < .5 ? MYTH : LEG);
  } else {
    for (let s = 0; s < 5; s++) slots.push(rollTier());   // same odds for every card
    if (S.dry + 1 >= PITY && Math.max(...slots) < MYTH) slots[0] = rollTopTier();
  }
  const raws = [];
  for (const tier of slots) {             // sequential so one slot can't pick a track another slot already took
    const t = await findTrack(p.g, tier, used);
    if (t) { used.add(t.id); raws.push(t); }
  }
  if (raws.length < 5) throw { code: "short" };
  const cards = await Promise.all(raws.map(t => enrich(t, p.g)));
  const pulls = cards.map((c, i) => {
    const holo = Math.random() < .04, prev = S.c[c.id];
    S.c[c.id] = { ...c, n: (prev?.n || 0) + 1, holo: (prev?.holo || 0) + (holo ? 1 : 0), at: prev?.at || Date.now() };
    return { c, holo, isNew: !prev, wanted: slots[i], src: raws[i]._src };
  }).sort((a, b) => a.c.tier - b.c.tier || a.c.rank - b.c.rank);   // weakest first, best card last
  S.dry = pulls.some(pl => pl.c.tier >= MYTH) ? 0 : S.dry + 1;
  if (god) S.gods = (S.gods || 0) + 1;
  S.opened++; save();
  return pulls;
}

/* ---------- opening ---------- */
let busy = false, lastPack = BOOSTER;
const LOADING_LINES = ["On fouille Deezer…", "On feuillette les bacs…", "On souffle sur les vinyles…", "On écoute les 30 premières secondes…"];
async function openPack(p, opts = {}) {
  if (busy) return;
  refill();
  if (!Online.active && !TEST_MODE && S.stock <= 0) { renderStock(); toast("Plus de booster pour l'instant. Le prochain arrive dans " + Math.ceil(nextRefillMs() / 60000) + " min."); return; }
  busy = true; lastPack = p;
  let serverPack = null;                 // with an account the server rolls the rarities (and the GOD pack)
  if (Online.active) {
    try { serverPack = await Online.startPack(p); }
    catch (e) { busy = false; renderStock(); toast(Online.message(e)); return; }
  }
  const paid = !Online.active && !TEST_MODE && p === BOOSTER;   // shop packs are free while testing
  if (paid) {
    if (S.stock >= STOCK_MAX) S.stockAt = Date.now();   // the refill clock starts when the stock drops below full
    S.stock--; save();
  }
  renderStock();
  document.querySelectorAll(".pack, .offer .btn, #again").forEach(b => b.disabled = true);
  const table = $("#table"), deal = $("#deal");
  // local preview only: #god turns the next booster into a GOD pack,
  // #demo gives one with a Commune, a Peu commune, an Épique, a Mythique and a Légendaire
  const devHash = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && p === BOOSTER && !serverPack ? location.hash : "";
  if (devHash === "#god" || devHash === "#demo") history.replaceState(null, "", location.pathname);
  if (devHash === "#demo") opts.slots = [0, 1, 3, MYTH, LEG];
  const god = serverPack ? serverPack.god : opts.god ?? (devHash === "#god" || (p === BOOSTER && Math.random() < GOD_CHANCE));
  table.hidden = false; table.classList.toggle("god", god);
  $("#tableTitle").textContent = god ? "GOD PACK" : p === BOOSTER ? "Booster" : "Booster " + p.n;
  deal.innerHTML = "";
  const rip = document.createElement("div"); rip.className = "rip loading" + (god ? " god" : "");
  const pk = p.el.cloneNode(true); pk.tabIndex = -1; pk.disabled = true;
  if (god) { pk.className = "pack god"; pk.querySelector(".lbl").innerHTML = "<b>GOD PACK</b><span>Mythiques et Légendaires</span>"; }
  const line = document.createElement("p"); line.textContent = god ? "GOD PACK ! 1 chance sur 3 000…" : pick(LOADING_LINES);
  rip.append(pk, line); deal.appendChild(rip);
  table.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
  const lineTimer = setInterval(() => { if (!god) line.textContent = pick(LOADING_LINES); }, 1600);

  try {
    const pulls = serverPack ? await Online.drawPack(p, serverPack) : await drawPack(p, god, opts.slots);
    if (god) toast("GOD PACK ! Que des Mythiques et des Légendaires.");
    renderCounters();
    deal.innerHTML = "";
    const grid = document.createElement("div"); grid.className = "deal"; deal.appendChild(grid);
    pulls.forEach((pl, i) => grid.appendChild(slotEl(pl, i)));
  } catch (err) {
    if (paid) { S.stock = Math.min(STOCK_MAX, S.stock + 1); save(); }   // a failed opening gives the booster back
    if (serverPack) await Online.abandon(serverPack);
    rip.classList.remove("loading");
    line.className = "err";
    line.textContent = err.code === "network" || err.code === "timeout"
      ? "Deezer ne répond pas. Vérifie ta connexion puis réessaie. Ton booster t'a été rendu."
      : err.code === 4 ? "Deezer limite le nombre de demandes. Attends quelques secondes puis réessaie. Ton booster t'a été rendu."
      : "Le booster n'a pas pu être rempli. Ton booster t'a été rendu, réessaie.";
  } finally {
    clearInterval(lineTimer);
    busy = false;
    document.querySelectorAll(".pack, .offer .btn").forEach(b => b.disabled = false);
    renderStock();
  }
}
/* reveal animations for the big pulls: the face-down card charges up in its rarity colour, then bursts open */
const REVEAL = {
  3: { charge: 650, sparks: 14, banner: "" },                // Épique: purple charge, ring and sparks
  4: { charge: 1150, sparks: 24, banner: "MYTHIQUE" },       // Mythique: harder shake, red shockwave, banner
  5: { charge: 1900, sparks: 40, banner: "LÉGENDAIRE" },     // Légendaire: lights dim, golden rays, white flash, banner
};
const wait = ms => new Promise(r => setTimeout(r, ms));
async function revealBig(slot, tier) {
  const R = REVEAL[tier];
  let dim = null;
  slot.classList.add("charge", "charge-" + tier);
  if (tier === LEG) {
    dim = document.createElement("div"); dim.className = "dim"; document.body.appendChild(dim);
    const rays = document.createElement("div"); rays.className = "rays"; slot.prepend(rays);
    setTimeout(() => rays.remove(), R.charge + 2600);
  }
  await wait(R.charge);
  slot.classList.remove("charge", "charge-" + tier);
  const fx = document.createElement("div"); fx.className = "fx"; fx.setAttribute("aria-hidden", "true");
  fx.innerHTML = `<span class="ring"></span><span class="ring r2"></span>` +
    Array.from({ length: R.sparks }, () => {
      const a = Math.random() * Math.PI * 2, d = 90 + Math.random() * (tier === LEG ? 220 : 140);
      return `<i style="--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;--s:${.5 + Math.random()}"></i>`;
    }).join("") + (R.banner ? `<b class="banner">${R.banner}</b>` : "");
  slot.appendChild(fx);
  setTimeout(() => fx.remove(), 2600);
  if (tier === LEG) {
    const flash = document.createElement("div"); flash.className = "flash"; document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 900);
  }
  if (dim) { dim.classList.add("out"); setTimeout(() => dim.remove(), 900); }
}

function slotEl(pl, i) {
  const slot = document.createElement("div"); slot.className = "slot"; slot.style.animationDelay = (i * 90) + "ms";
  slot.style.setProperty("--aura", RCOL[pl.c.tier]);
  const f = document.createElement("button"); f.className = "flip"; f.setAttribute("aria-label", "Retourner la carte " + (i + 1));
  const back = document.createElement("div"); back.className = "face"; back.appendChild(backEl());
  const front = document.createElement("div"); front.className = "face front"; front.appendChild(cardEl(pl.c, pl.holo));
  f.append(back, front);
  const tag = document.createElement("span"); tag.className = "tag"; tag.innerHTML = "&nbsp;";
  let revealing = false;
  f.reveal = async () => {               // resolves once the card is face up (after its animation)
    if (f.classList.contains("on") || revealing) return;
    revealing = true;
    if (pl.c.tier >= 3 && !reduceMotion()) await revealBig(slot, pl.c.tier);
    f.classList.add("on"); f.setAttribute("aria-label", pl.c.t + ", " + RAR[pl.c.tier]);
    if (pl.c.tier >= 3) slot.classList.add("burst", "burst-" + pl.c.tier);
    tag.textContent = (pl.isNew ? "Nouvelle · " : "Doublon · ") + RAR[pl.c.tier] + (pl.holo ? " · Holo" : "");
    if (pl.isNew) tag.classList.add("new");
    revealing = false;
  };
  f.onclick = () => f.classList.contains("on") ? openModal(pl.c) : f.reveal();
  slot.append(f, tag);
  return slot;
}
// one card after the other, so each big pull gets its own moment
$("#flipAll").onclick = async () => {
  for (const f of document.querySelectorAll("#deal .flip:not(.on)")) { await f.reveal(); await wait(160); }
};
$("#again").onclick = () => openPack(lastPack);

/* ---------- binder ---------- */
const F = { g: -1, r: -1, sort: "recent" };
function renderBinder() {
  const all = owned();
  const pg = $("#prog");
  const rows = [{ g: -1, n: "Tout", h: 42 }].concat(TYPES.map((t, g) => ({ g, n: t.n, h: t.h })));
  pg.innerHTML = rows.map(t => {
    const list = t.g < 0 ? all : all.filter(c => c.g === t.g);
    const leg = list.filter(c => c.tier === LEG).length;
    return `<button data-g="${t.g}" style="--h:${t.h}" aria-pressed="${F.g === t.g}"><span class="row">${t.n}<small>${fmt(list.length)}</small></span><span class="meter"><s style="width:${all.length ? list.length / all.length * 100 : 0}%"></s></span><small class="legs">${leg} légendaire${leg > 1 ? "s" : ""}</small></button>`;
  }).join("");
  pg.querySelectorAll("button").forEach(b => b.onclick = () => { F.g = +b.dataset.g; renderBinder(); });

  const fl = $("#filters");
  fl.innerHTML = [-1, ...RAR.keys()].map(r => `<button class="chip" data-r="${r}" aria-pressed="${F.r === r}">${r < 0 ? "Toutes raretés" : `<i style="background:${RCOL[r]}"></i>${RAR[r]}`}</button>`).join("") +
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

/* ---------- reset (confirmation lives in the page) ---------- */
$("#resetAsk").onclick = () => { $("#resetConfirm").hidden = false; $("#resetAsk").hidden = true; $("#resetNo").focus(); };
$("#resetNo").onclick = () => { $("#resetConfirm").hidden = true; $("#resetAsk").hidden = false; $("#resetAsk").focus(); };
$("#resetYes").onclick = async () => {
  if (Online.active) {
    try { await Online.reset(); } catch (e) { toast(Online.message(e)); return; }
  } else {
    S = { c: {}, opened: 0, stock: STOCK_MAX, stockAt: Date.now(), dry: 0 };
    save();
  }
  $("#resetConfirm").hidden = true; $("#resetAsk").hidden = false;
  $("#table").hidden = true; $("#deal").innerHTML = "";
  renderCounters(); renderStock(); renderBinder();
  toast("Collection réinitialisée.");
};

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
  $("#catFilters").innerHTML = [-1, ...RAR.keys()].map(r => `<button class="chip" data-r="${r}" aria-pressed="${CAT.r === r}">${r < 0 ? "Toutes raretés" : `<i style="background:${RCOL[r]}"></i>${RAR[r]}`}</button>`).join("") +
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
    <dt>Hype</dt><dd>${st.hype}</dd><dt>Sortie</dt><dd>${c.y || "?"}</dd><dt>Possédées</dt><dd>${own.n}${own.holo ? ` (dont ${own.holo} holo)` : ""}${own.locked ? ` · ${own.locked} non échangeable${own.locked > 1 ? "s" : ""}` : ""}</dd>`;
  $("#mLink").href = "https://www.deezer.com/track/" + c.id;
  Online.modalExtras?.(c);
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
renderStock();
$("#odds").innerHTML = `<table><tr><th>Rareté</th><th>Chance par carte</th><th>Classement Deezer</th></tr>${RAR.map((r, i) =>
  `<tr><td><i style="background:${RCOL[i]}"></i>${r}</td><td>${String(DROP[i]).replace(".", ",")} %</td><td>${i === TOP ? fmt(TIER_MIN[i]) + " et plus" : fmt(TIER_MIN[i]) + " – " + fmt(TIER_MIN[i + 1] - 1)}</td></tr>`).join("")}</table>
  <p class="god-odds"><b>GOD PACK</b> : 1 booster sur 3 000 se transforme en GOD pack. Il contient 1 Légendaire garantie, et ses 4 autres cartes ont chacune 50 % de chances d'être Mythique et 50 % d'être Légendaire.</p>`;
