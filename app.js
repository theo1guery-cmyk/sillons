"use strict";
/* Zik Hunter — every card is a live Deezer track. No server: the Deezer API is
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
// urgent requests (what the player is waiting for) jump ahead of background ones
function dz(path, params, urgent = false) {
  return new Promise((resolve, reject) => { const job = { path, params, resolve, reject, tries: 0 }; urgent ? queue.unshift(job) : queue.push(job); pump(); });
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
// artist cards: their rarity is a sales certification, from Deezer fans
const CERT = ["Démo", "Single", "Disque d'argent", "Disque d'or", "Disque de platine", "Disque de diamant"];
const CCOL = ["var(--c0)", "var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)"];
const CERT_MIN = [0, 1000, 20000, 150000, 1000000, 7000000];
// "Diamant d'honneur": artists who are Diamant whatever their fan count — stars that Deezer's mostly French audience
// undercounts (Travis Scott, Kanye West, Kendrick Lamar), plus Theo's picks (Mauvais Djo, Céline Dion, Aya Nakamura,
// GIMS, Niska, Booba, PNL). Same list on the server (cert_of(int, bigint), latest in
// supabase/migrations/20261009000000_honor_list.sql)
const HONOR = new Set([4495513, 230, 525046, 148380152, 198, 8909272, 4429712, 5288900, 390, 1519461]);
const certOf = (fans, id) => HONOR.has(+id) ? 5 : CERT_MIN.reduce((t, m, i) => fans >= m ? i : t, 0);
const inCert = (fans, t, id) => certOf(fans, id) === t;
const isArtist = c => c && c.kind === "artist";
const rarName = c => isArtist(c) ? CERT[c.tier] : RAR[c.tier];
const fmtFans = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(".", ",") + " M" : n >= 1e3 ? Math.round(n / 1e3) + " k" : String(n);
// Deezer rank (0 – 1 000 000) → rarity. 950 000+ is the global-hit club
// (Billie Jean, Bohemian Rhapsody…): a few thousand tracks out of 100+ million.
const TIER_MIN = [0, 250000, 450000, 700000, 850000, 950000];
const tierOf = rank => TIER_MIN.reduce((t, m, i) => rank >= m ? i : t, 0);
const inTier = (rank, t) => rank >= TIER_MIN[t] && (t === TOP || rank < TIER_MIN[t + 1]);
const tierDistance = (rank, t) => rank < TIER_MIN[t] ? TIER_MIN[t] - rank : t < TOP && rank >= TIER_MIN[t + 1] ? rank - TIER_MIN[t + 1] + 1 : 0;

// Every card of a booster uses the same odds (no guaranteed slot).
const DROP = [70, 21, 7, 1.7, 0.28, 0.02];
const PITY = 70;                         // boosters without a Mythique or better before one is guaranteed
let devShiny = false;                  // local preview (#shiny): every Mythique / Légendaire comes out Shiny
const SHINY_CHANCE = 0.01;               // a Mythique or Légendaire has 1 chance in 100 to be Shiny
const GOD_CHANCE = 1 / 3000;             // a booster turns into a GOD pack: 1 Légendaire + 4 cards that are Mythique or Légendaire (50/50)
const STOCK_MAX = 10, REFILL_MS = 10 * 60 * 1000;
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
    if (isPlayable(t) && !ownsTrack(t.id) && r.length < RESERVE_MAX && !r.some(x => x.id === t.id)) r.push(t);
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
    if (ownsTrack(t.id) || used.has(t.id)) { r.splice(i, 1); continue; }
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
    const fresh = pool.filter(t => !ownsTrack(t.id));
    const hits = fresh.filter(t => inTier(t.rank, tier));
    if (hits.length) { const t = pick(hits); stash(fresh.filter(x => x !== t && tierOf(x.rank) >= 1)); return t; }
    stash(fresh.filter(x => tierOf(x.rank) >= 1));
    if (!ownedHit) ownedHit = pool.find(t => inTier(t.rank, tier)) || null;
    for (const t of fresh) { const d = tierDistance(t.rank, tier); if (!best || d < best.d) best = { t, d }; }
  }
  // Commune → Épique never repeat: a new track of the nearest rarity beats a duplicate
  return tier <= 3 ? (best && best.t) || ownedHit : ownedHit || (best && best.t);
}

/* ---------- artists for the artist slots ----------
   Démo/Single: random artist searches. Argent/Or: searches on real words and names.
   Platine/Diamant: from the chart's artists, walking to similar artists (which carry fan counts). */
const famous = { seeds: null, pool: new Map() };
async function certArtistPool(tier) {
  if (tier >= 4) {
    // the French chart, plus worldwide stars so the walk doesn't stay among French artists
    if (!famous.seeds) famous.seeds = [...((await dz("chart/0/artists", { limit: 100 })).data || []).map(a => a.id),
      246791, 13, 564, 4050205, 75798, 1424821, 1182, 27, 12246, 4495513, 5313805, 288166, 1188, 9635624];
    if (!famous.honor) famous.honor = Promise.all([...HONOR].map(id => dz("artist/" + id).then(a => a.id && famous.pool.set(a.id, a)).catch(() => {})));
    await famous.honor;
    const known = [...famous.pool.values()].filter(a => a.nb_fan >= CERT_MIN[3]);
    const from = known.length && Math.random() < .6 ? pick(known).id : pick(famous.seeds);
    const rel = (await dz(`artist/${from}/related`, { limit: 50 })).data || [];
    for (const a of rel) famous.pool.set(a.id, a);
    return [...famous.pool.values()];
  }
  const q = tier >= 2 ? randomQuery(true) : randomQuery(false);
  const d = await dz("search/artist", { q, limit: 100, index: randInt(tier >= 2 ? 50 : 150) });
  return d.data || [];
}
async function findArtist(tier, used, owned = false) {   // owned: local previews may give an artist already in the collection
  let best = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const pool = (await certArtistPool(tier).catch(() => [])).filter(a => a.id && a.nb_fan != null && !used.has(a.id) && (owned || !ownsTrack("a" + a.id)));
    const hits = pool.filter(a => inCert(a.nb_fan, tier, a.id));
    if (hits.length) return pick(hits);
    for (const a of pool) {
      const d = a.nb_fan < CERT_MIN[tier] ? CERT_MIN[tier] - a.nb_fan : tier < 5 ? a.nb_fan - CERT_MIN[tier + 1] : 0;
      if (!best || d < best.d) best = { a, d };
    }
  }
  return best && best.a;
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
    const fresh = (await genreSource(typeIdx, tier).catch(() => [])).filter(t => isPlayable(t) && !used.has(t.id) && !ownsTrack(t.id));
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
  const tempo = c.bpm > 0 ? c.bpm : 70 + (Number(c.id) % 91);   // same estimate as the server uses in duels
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
// a card is a track (or artist) in one rarity: pulled as Légendaire, it stays Légendaire even if the track falls,
// and the same track pulled later as Mythique is another card. Keys are "<id>#<tier>" (older saves used "<id>").
{
  const c2 = {};
  for (const c of Object.values(S.c)) {
    const k = c.id + "#" + c.tier, p = c2[k];
    c2[k] = p ? { ...p, n: (p.n || 1) + (c.n || 1), holo: (p.holo || 0) + (c.holo || 0), at: Math.min(p.at || Infinity, c.at || Infinity) } : c;
  }
  S.c = c2;
}
if (S.stock == null) { S.stock = STOCK_MAX; S.stockAt = Date.now(); }
if (S.dry == null) S.dry = 0;            // boosters opened since the last Mythique or better

/* booster stock: one more every 10 min, up to 10 */
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
function artistStats(c) {
  const fans = clamp(Math.round(Math.log10(Math.max(1, c.rank)) / 7.5 * 99), 1, 99);
  const albums = clamp(Math.round((c.albums || 0) * 4), 1, 99);
  const aura = clamp(Math.round(20 + c.tier * 15 + (c.collector ? 10 : 0)), 1, 99);
  return { fans, albums, aura, pw: Math.round((fans * 2 + albums + aura) / 4) };
}
// artist cards: the photo fills the card like a track's cover, inside a frame made of the
// certification's material (kraft, lacquer, silver, gold, platinum, cut crystal)
function artistCardEl(c, holo) {
  const st = artistStats(c);
  // Disque de diamant: the Icône, its platinum frame set with brilliant-cut stones. Its Shiny is the Black Diamond (black lacquer, photo in black and white).
  // Disque de platine: its little sister — the same full photo and name down the side, but a rounded platinum frame, a satin name, a disc in the badge and no signature
  if (c.tier >= MYTH && c.cov) {
    const dia = c.tier === 5, shiny = holo && !c.collector, name = c.t.toUpperCase();
    const sig = c.t === c.t.toUpperCase() ? c.t.toLowerCase().replace(/(^|[\s-])\p{L}/gu, m => m.toUpperCase()) : c.t;
    const nfs = Math.min(16, fitCqw(name, LEG_TITLE_FONT, -.02, 108)), sfs = Math.min(12, fitCqw(sig, LEG_SIG_FONT, 0, 64));
    const fans = c.rank >= 1e6 ? (c.rank / 1e6).toFixed(1).replace(".", ",") + " M" : fmtFans(c.rank);
    const el = document.createElement("div");
    el.className = "dcard" + (dia ? "" : " pcard") + (shiny ? dia ? " bd" : " shiny" : "") + (c.collector ? " collector" : ""); el.dataset.cert = c.tier; el.dataset.r = c.tier;
    el.innerHTML = `${dia ? `<div class="pave"></div>${"<i class=\"tw\"></i>".repeat(6)}` : ""}<div class="in"><img class="photo" src="${esc(c.cov.replace(/\/\d+x\d+-/, "/1000x1000-"))}" alt="Photo de ${esc(c.t)}" loading="lazy" decoding="async">${dia ? '<div class="ice"></div>' : ""}<div class="shade"></div>
      <div class="vname"><span class="chrome" style="font-size:${nfs.toFixed(2)}cqw">${dia ? `<span class="depth">${esc(name)}</span>` : ""}<span class="face">${esc(name)}</span></span></div>
      <div class="head"><span class="badge">${dia ? '<span class="gem"></span>' : '<span class="vinyl"></span>'}${!dia ? "PLATINE" : shiny ? "BLACK DIAMOND" : "DIAMANT"}</span><span class="pw" title="Puissance">${st.pw}</span></div>
      <div class="foot">${dia ? `<div class="sig" style="font-size:${sfs.toFixed(2)}cqw">${esc(sig)}</div>` : ""}<div class="fans">${fans}<small>FANS SUR DEEZER</small></div>
        <div class="stl"><span>FANS <b>${fmtFans(c.rank)}</b></span><span>ALBUMS <b>${c.albums || "?"}</b></span><span>AURA <b>${st.aura}</b></span></div></div></div>
      ${shiny ? '<span class="ribbon">SHINY</span><div class="sweep"></div>' : c.collector ? '<span class="ribbon">COLLECTOR</span>' : ""}`;
    const w = document.createElement("div"); w.className = "cq"; w.appendChild(el);
    return w;
  }
  const el = document.createElement("div");
  el.className = "acard" + (holo && c.tier >= MYTH && !c.collector ? " shiny" : "") + (c.collector ? " collector" : ""); el.dataset.cert = c.tier; el.dataset.r = c.tier;
  const pic = c.cov ? `<img class="bg" src="${esc(c.cov)}" alt="" loading="lazy" decoding="async"><img class="photo" src="${esc(c.cov)}" alt="Photo de ${esc(c.t)}" loading="lazy" decoding="async">`
    : `<div class="ph">${esc(initials(c.t))}</div>`;
  el.innerHTML = `<div class="frame"><div class="backing">${pic}
      <div class="a-top"><span class="a-kind">Artiste</span><span class="a-pw" title="Puissance"><span class="disc" aria-hidden="true"></span>${st.pw}</span></div>
      <div class="a-body">
        <b class="a-name">${esc(c.t)}</b>
        <div class="plaque">${c.collector ? "Discographie complète" : "Certifié " + CERT[c.tier]}</div>
        <div class="st">
          <i>FANS</i><span class="bar"><s style="width:${st.fans}%"></s></span><em>${fmtFans(c.rank)}</em>
          <i>ALBUMS</i><span class="bar"><s style="width:${st.albums}%"></s></span><em>${c.albums || "?"}</em>
          <i>AURA</i><span class="bar"><s style="width:${st.aura}%"></s></span><em>${st.aura}</em>
        </div>
      </div>
    </div></div>
    ${c.collector ? `<div class="ribbon">Collector</div><div class="sheen" aria-hidden="true"></div>` : holo && c.tier >= MYTH ? `<div class="ribbon">Shiny</div><div class="sheen" aria-hidden="true"></div>` : ""}<div class="foil"></div>`;
  const w = document.createElement("div"); w.className = "cq"; w.appendChild(el);
  return w;
}
// the font size (in % of the card's width) at which a word fits in a given width
const LEG_TITLE_FONT = '900 100px "Unbounded"', LEG_SIG_FONT = '100px "Mrs Saint Delafield"';
document.fonts?.load(LEG_TITLE_FONT); document.fonts?.load(LEG_SIG_FONT);
const measureCtx = document.createElement("canvas").getContext("2d");
function fitCqw(text, font, spacingEm, widthCqw) {
  measureCtx.font = font;
  const w = measureCtx.measureText(text).width + spacingEm * 100 * text.length;   // at 100 px
  return w > 0 ? widthCqw * 100 / w * .96 : 99;
}
function cardEl(c, holo) {
  if (isArtist(c)) return artistCardEl(c, holo);
  const T = c.g == null ? PENDING_TYPE : TYPES[c.g] || TYPES[AUTRE], st = stats(c);
  const el = document.createElement("div");
  el.className = "card" + (holo && c.tier >= MYTH ? " shiny" : "") + (c.g == null ? " pending" : ""); el.dataset.r = c.tier;
  el.style.setProperty("--h", T.h); el.style.setProperty("--rc", RCOL[c.tier]);
  if (c.tier === LEG && c.cov) {          // a Légendaire is a concert poster: the sleeve fills the card, the artist signs it in gold
    const title = c.t.replace(/\s*\((feat|with)\.?[^)]*\)/i, ""), size = title.length > 24 ? " xlong" : title.length > 13 ? " long" : "";
    // the title and the signature shrink just enough for their widest word to fit the card
    const tfs = Math.min(title.length > 24 ? 6.4 : title.length > 13 ? 8 : 11, ...title.toUpperCase().split(/\s+/).map(w => fitCqw(w, LEG_TITLE_FONT, -.02, 88)));
    const sig = c.a === c.a.toUpperCase() ? c.a.toLowerCase().replace(/(^|[\s-])\p{L}/gu, m => m.toUpperCase()) : c.a;   // nobody signs in capitals
    const sfs = Math.min(13, fitCqw(sig, LEG_SIG_FONT, 0, 76));
    el.classList.add("legend");
    el.innerHTML = `<div class="in"><img class="ext" src="${esc(c.cov.replace(/\/\d+x\d+-/, "/120x120-"))}" alt="" loading="lazy" decoding="async"><img class="art" src="${esc(c.cov.replace(/\/\d+x\d+-/, "/500x500-"))}" alt="Pochette de ${esc(c.al)}" loading="lazy" decoding="async"><div class="shade"></div>
      <div class="lhead"><span>★ LÉGENDAIRE</span><span class="lpw" title="Puissance">${st.pw}</span></div>
      <div class="lfoot"><div class="sig" style="font-size:${sfs.toFixed(2)}cqw">${esc(sig)}</div><div class="lttl${size}" style="font-size:${tfs.toFixed(2)}cqw">${esc(title)}</div>
        <div class="lst"><span>${T.s.toUpperCase()} <b>${st.flow}</b></span><span>ENDUR. <b>${st.endu}</b></span><span>HYPE <b>${st.hype}</b></span></div></div>
    </div><div class="foil"></div>`;
    const w = document.createElement("div"); w.className = "cq"; w.appendChild(el);
    return w;
  }
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
function backEl(gl = false) {
  const w = document.createElement("div"); w.className = "cq"; w.innerHTML = '<div class="back"><div class="in"><img src="brand/zikhunter-icon.svg" alt=""><b>ZIK HUNTER</b></div></div>';
  if (gl) {                               // the design pack back, printed in 3D (the plain back until the studio is ready)
    const back = w.firstChild, cv = document.createElement("canvas"); cv.className = "back-gl"; cv.setAttribute("aria-hidden", "true"); back.appendChild(cv);
    withStudio(S => S.card(cv, backName, { host: back }));
  }
  return w;
}

/* ---------- views ---------- */
const views = { shop: $("#view-shop"), store: $("#view-store"), binder: $("#view-binder"), catalog: $("#view-catalog"), trades: $("#view-trades"), defis: $("#view-defis"), market: $("#view-market"), albums: $("#view-albums"), duels: $("#view-duels") };
function show(v) {
  for (const k in views) { views[k].hidden = k !== v; $("#tab-" + k).setAttribute("aria-selected", k === v); }
  if (!busy) unseatTable();   // leaving the tab puts the booster back
  if (v === "binder") { renderBinder(); Online.renderDiscard?.(); }
  if (v === "catalog") { if (!(CAT.mode === "artists" ? ART : CAT).loaded) catLoad(true); else renderCatalog(); }
  if (v === "trades") Online.renderTrades();
  if (v === "defis") Online.renderDefis();
  if (v === "market") Online.renderMarket();
  if (v === "albums") Online.renderAlbums();
  if (v === "duels") Online.renderDuels?.();
}
$("#tab-shop").onclick = () => show("shop");
$("#tab-store").onclick = () => show("store");
$("#tab-binder").onclick = () => show("binder");
$("#tab-catalog").onclick = () => show("catalog");
$("#tab-trades").onclick = () => show("trades");
$("#tab-defis").onclick = () => show("defis");
$("#tab-market").onclick = () => show("market");
$("#tab-albums").onclick = () => show("albums");
$("#tab-duels").onclick = () => show("duels");

const owned = () => Object.values(S.c);
const ck = c => c.id + "#" + c.tier;                     // key of a card: a track in one rarity
// every version you own of a track, whatever its rarity (rebuilt at most every 50 ms: collections can be big)
let TRK = null, TRKsrc = null, TRKat = 0;
function versionsOf(id) {
  const now = performance.now();
  if (!TRK || TRKsrc !== S.c || now - TRKat > 50) {
    TRK = new Map(); TRKsrc = S.c; TRKat = now;
    for (const c of Object.values(S.c)) { const k = String(c.id), a = TRK.get(k); a ? a.push(c) : TRK.set(k, [c]); }
  }
  return TRK.get(String(id)) || [];
}
const ownsTrack = id => versionsOf(id).length > 0;
const bestOwned = id => versionsOf(id).reduce((b, c) => !b || c.tier > b.tier ? c : b, null);
function renderCounters() {
  const all = owned();
  const pill = (cls, value, label) => `<span class="pill ${cls}"><b>${value}</b><small>${label}</small></span>`;
  $("#counters").innerHTML = (Online.active ? `<span class="pill streams"><i class="coin" aria-hidden="true"></i><b>${fmt(S.streams || 0)}</b><small>Streams</small></span>` : "")
    + pill("", fmt(all.length), "Cartes")
    + pill("myth", all.filter(c => c.tier === MYTH && !isArtist(c)).length, "Mythiques")
    + pill("leg", all.filter(c => c.tier === LEG && !isArtist(c)).length, "Légendaires")
    + pill("opened", fmt(S.opened), "Boosters");
}

/* ---------- shelf: one booster, limited stock ---------- */
const BOOSTER = { g: -1, n: "Booster" };
const shelf = $("#shelf");
const packBtn = document.createElement("button");
packBtn.className = "pack mix";
packBtn.innerHTML = `<span class="pack-shine" aria-hidden="true"></span><canvas class="pack-gl" aria-hidden="true"></canvas><img class="pack-logo" src="brand/zikhunter-icon.svg" alt=""><span class="lbl"><b>Booster</b><span>5 cartes · tout Deezer</span></span>`;
packBtn.setAttribute("aria-label", "Ouvrir un booster");
packBtn.onclick = e => { if (e.detail && packBtn.classList.contains("gl")) return; openPack(BOOSTER); };   // the 3D pack is torn open, not clicked
BOOSTER.el = packBtn;
const stockEl = document.createElement("div"); stockEl.className = "stock"; stockEl.setAttribute("aria-live", "polite");
const packStage = document.createElement("div"); packStage.className = "pack-stage";
const openBig = document.createElement("button"); openBig.className = "btn primary big"; openBig.id = "openBig"; openBig.textContent = "Ouvrir un booster";
openBig.onclick = () => openPack(BOOSTER);
const tearHint = document.createElement("p"); tearHint.className = "tear-hint"; tearHint.textContent = "Déchire le haut du sachet pour l'ouvrir";
packStage.append(packBtn, tearHint, openBig);
shelf.append(packStage, stockEl);
// boosters and card backs printed in 3D by studio.js
const studioQueue = [];
const withStudio = fn => window.Studio ? fn(window.Studio) : studioQueue.push(fn);
addEventListener("zh:studio", () => studioQueue.splice(0).forEach(fn => fn(window.Studio)));
function skin(el, name, opts) {           // name: a design, or a function giving the current one
  const cv = el.querySelector(".pack-gl"); if (!cv) return;
  el.classList.remove("gl");                 // a copied pack shows its plain design until it is drawn
  withStudio(S => S.pack(cv, name, { ...opts, host: el }));
}
// the classic booster's cards keep the plain back (light to draw); genre boosters get the 3D Égaliseur back
const backName = () => { const b = document.documentElement.dataset.back || "plain"; return b === "plain" ? null : "back-" + b; };
// the classic booster is Le Mur; genre boosters are duotones
const classicName = () => "pack-wall";
let tornCut = null;                       // the shape of the last tear, so the pack in the opening is torn the same way
skin(packBtn, classicName, { sway: true, canTear: () => !busy && !packBtn.disabled, tear: cut => { tornCut = cut; openPack(BOOSTER); } });
document.documentElement.dataset.back = "plain";
const studioScript = document.createElement("script"); studioScript.type = "module"; studioScript.src = "studio.js?v=16"; document.head.appendChild(studioScript);
function renderStock() {
  if (TEST_MODE) {
    stockEl.innerHTML = `<b>Boosters illimités</b><span class="test-badge">Mode test</span>
      <small>Le stock de 10 boosters (un nouveau toutes les 10 min) sera activé à la sortie du jeu.</small>
      <small>Mythique garantie dans ${Math.max(1, PITY - S.dry)} booster${PITY - S.dry > 1 ? "s" : ""} si tu n'en tires pas avant</small>`;
    if (!busy) { packBtn.disabled = false; openBig.disabled = false; $("#again").disabled = false; }
    return;
  }
  refill();
  const left = nextRefillMs(), min = Math.max(1, Math.ceil(left / 60000));
  const pips = Array.from({ length: STOCK_MAX }, (_, i) => `<i class="${i < S.stock ? "on" : ""}"></i>`).join("");
  stockEl.innerHTML = `<b>${S.stock} / ${STOCK_MAX}</b> booster${S.stock > 1 ? "s" : ""} disponible${S.stock > 1 ? "s" : ""}
    <span class="pips" aria-hidden="true">${pips}</span>
    <small>${S.stock >= STOCK_MAX ? "Stock plein. Un nouveau booster arrive toutes les 10 min quand le stock n'est pas plein." : `Prochain booster dans ${min >= 60 ? "1 h" : min + " min"}`}</small>
    <small>Mythique garantie dans ${Math.max(1, PITY - S.dry)} booster${PITY - S.dry > 1 ? "s" : ""} si tu n'en tires pas avant</small>`;
  const empty = S.stock <= 0;
  if (!busy) { packBtn.disabled = empty; openBig.disabled = empty; $("#again").disabled = empty; }
}
setInterval(() => { renderStock(); save(); }, 30000);

/* ---------- boutique: one-genre boosters (free while testing, paid later) ---------- */
const STORE_PACKS = TYPES.slice(0, AUTRE).map((t, g) => ({ g, n: t.n }));
const STORE_PRICE = 100;                 // Streams, charged by the server
for (const p of STORE_PACKS) {
  const offer = document.createElement("div"); offer.className = "offer";
  const b = document.createElement("button"); b.className = "pack"; b.style.setProperty("--h", TYPES[p.g].h);
  b.innerHTML = `<span class="pack-shine" aria-hidden="true"></span><canvas class="pack-gl" aria-hidden="true"></canvas><img class="pack-logo" src="brand/zikhunter-icon.svg" alt=""><span class="lbl"><b>${p.n}</b><span>5 cartes ${p.n}</span></span>`;
  skin(b, "pack-" + TYPES[p.g].k);
  b.setAttribute("aria-label", "Ouvrir un booster " + p.n);
  b.onclick = () => buyPack(p);
  p.el = b;
  const price = document.createElement("div"); price.className = "price";
  price.innerHTML = `<b>${STORE_PRICE} Streams</b><small>5 cartes ${p.n}</small>`;
  const buy = document.createElement("button"); buy.className = "btn primary"; buy.textContent = "Acheter";
  buy.setAttribute("aria-label", "Acheter un booster " + p.n + " pour " + STORE_PRICE + " Streams");
  buy.onclick = () => buyPack(p);
  offer.append(b, price, buy); $("#store").appendChild(offer);
}

// buying a genre booster brings it up big, centre screen: it is torn open there (nothing is paid until then)
const tearStage = document.createElement("div"); tearStage.className = "tear-stage"; tearStage.hidden = true;
tearStage.setAttribute("role", "dialog"); tearStage.setAttribute("aria-modal", "true"); tearStage.setAttribute("aria-label", "Ouvrir le booster");
tearStage.innerHTML = `<div class="ts-head"><b></b><small>${STORE_PRICE} Streams · 5 cartes</small></div>
  <div class="pack stage-pack"><canvas class="pack-gl" aria-hidden="true"></canvas></div>
  <p class="ts-hint">Déchire le haut du sachet pour l'ouvrir</p>
  <button class="btn" type="button">Annuler</button>`;
document.body.appendChild(tearStage);
let stagePack = null;
const stageHost = tearStage.querySelector(".stage-pack");
function closeStage() { tearStage.hidden = true; document.removeEventListener("keydown", stageKeys); }
const stageKeys = e => { if (e.key === "Escape") closeStage(); };
tearStage.querySelector("button").onclick = closeStage;
tearStage.addEventListener("click", e => { if (e.target === tearStage) closeStage(); });
let stageReady = false;
function buyPack(p) {
  // the checks of the opening come first (account, Streams), so a pack you can't open is never shown torn
  if (busy || !Online.active || (S.streams || 0) < STORE_PRICE || !window.Studio) return openPack(p);
  stagePack = p;
  tearStage.querySelector(".ts-head b").textContent = "Booster " + p.n;
  if (!stageReady) {
    stageReady = true;
    skin(stageHost, () => "pack-" + TYPES[stagePack.g].k, { sway: true, canTear: () => !busy && !tearStage.hidden,
      tear: cut => { tornCut = cut; closeStage(); openPack(stagePack); } });
  }
  tearStage.hidden = false; document.addEventListener("keydown", stageKeys);
}

/* ---------- drawing a booster (no UI) ---------- */
async function drawPack(p, god = false, forced = null, artistTier = null) {   // artistTier: local previews only
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
  if (raws.length < 5 - (artistTier != null)) throw { code: "short" };
  const cards = await Promise.all(raws.map(t => enrich(t, p.g)));
  if (artistTier != null) {               // local preview: the last card is a certified artist
    const f = await findArtist(artistTier, new Set(), true);
    if (!f) throw { code: "short" };
    cards.push({ kind: "artist", id: "a" + f.id, aid: f.id, t: f.name, a: "Artiste", al: "", cov: (f.picture_big || f.picture_medium || "").replace("http:", "https:"),
      rank: f.nb_fan, albums: f.nb_album || 0, tier: certOf(f.nb_fan, f.id), collector: false, g: null });
  }
  const pulls = cards.map((c, i) => {
    const holo = c.tier >= MYTH && (devShiny || Math.random() < SHINY_CHANCE), prev = S.c[ck(c)];   // Shiny: Mythique / Légendaire only
    S.c[ck(c)] = { ...c, n: (prev?.n || 0) + 1, holo: (prev?.holo || 0) + (holo ? 1 : 0), at: prev?.at || Date.now() };
    return { c, holo, isNew: !prev, wanted: slots[i] ?? c.tier, src: raws[i]?._src };
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
  if (p.g >= 0 && !Online.active) { toast("Les packs de la Boutique s'achètent en Streams : connecte-toi ou crée un compte."); Online.askSignIn?.(); return; }
  if (p.g >= 0 && (S.streams || 0) < STORE_PRICE) { toast(`Il te faut ${STORE_PRICE} Streams pour ce pack. Tu en as ${fmt(S.streams || 0)} : va voir les Défis.`); return; }
  refill();
  if (!Online.active && !TEST_MODE && S.stock <= 0) { renderStock(); toast("Plus de booster pour l'instant. Le prochain arrive dans " + Math.ceil(nextRefillMs() / 60000) + " min."); return; }
  busy = true; lastPack = p;
  // local preview only (#god, #demo, #shiny, #platine, #diamant…): drawn here even when signed in, and never sent to
  // the server (with an account nothing is saved locally either, so the preview card is gone on reload)
  const devHash = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && p === BOOSTER && /^#(god|demo|shiny|platine|diamant)(-shiny)?$/.test(location.hash) ? location.hash : "";
  let serverPack = null;                 // with an account the server rolls the rarities (and the GOD pack)
  if (Online.active && !devHash) {
    try { serverPack = await Online.startPack(p); }
    catch (e) { busy = false; renderStock(); toast(Online.message(e)); return; }
  }
  const paid = !Online.active && !TEST_MODE && p === BOOSTER;   // shop packs are free while testing
  if (paid) {
    if (S.stock >= STOCK_MAX) S.stockAt = Date.now();   // the refill clock starts when the stock drops below full
    S.stock--; save();
  }
  renderStock();
  document.querySelectorAll(".pack, .offer .btn, #again, #openBig, #tableBack, #flipAll").forEach(b => b.disabled = true);
  // #god turns the next booster into a GOD pack,
  // #demo gives one with a Commune, a Peu commune, an Épique, a Mythique and a Légendaire
  // #platine, #diamant, #platine-shiny, #diamant-shiny: four tracks then a certified artist (Shiny if asked)
  const devArtist = { "#platine": 4, "#diamant": 5, "#platine-shiny": 4, "#diamant-shiny": 5 }[devHash];
  if (devHash === "#god" || devHash === "#demo" || devHash === "#shiny" || devArtist != null) history.replaceState(null, "", location.pathname);
  if (devHash === "#demo" || devHash === "#shiny") opts.slots = [0, 1, 3, MYTH, LEG];
  if (devArtist != null) { opts.slots = [0, 1, 2, 3]; opts.artist = devArtist; }
  devShiny = devHash === "#shiny" || /-shiny$/.test(devHash);
  const god = serverPack ? serverPack.god : opts.god ?? (devHash === "#god" || (p === BOOSTER && Math.random() < GOD_CHANCE));

  const table = $("#table"), deal = $("#deal");
  seatTable(p === BOOSTER ? $("#shelf") : $("#store"));
  table.classList.toggle("god", god);
  $("#tableTitle").textContent = god ? "GOD PACK" : p === BOOSTER ? "Booster" : "Booster " + p.n;
  deal.innerHTML = "";
  const rip = document.createElement("div"); rip.className = "rip loading" + (god ? " god" : "");
  const pk = p.el.cloneNode(true); pk.tabIndex = -1; pk.disabled = true; pk.removeAttribute("id");
  document.documentElement.dataset.back = p === BOOSTER ? "plain" : "eq";
  skin(pk, p === BOOSTER ? classicName() : "pack-" + TYPES[p.g].k, { live: true, cut: tornCut });   // the copy in the opening
  tornCut = null;
  if (god) pk.classList.add("god");
  const line = document.createElement("p"); line.textContent = god ? "GOD PACK ! 1 chance sur 3 000…" : pick(LOADING_LINES);
  rip.append(pk, line); deal.appendChild(rip);
  const lineTimer = setInterval(() => { if (!god) line.textContent = pick(LOADING_LINES); }, 1600);
  try {
    const pulls = serverPack ? await Online.drawPack(p, serverPack) : await drawPack(p, god, opts.slots, opts.artist);
    if (god && reduceMotion()) toast("GOD PACK ! Que des Mythiques et des Légendaires.");   // the GOD pack has its own announcement
    renderCounters();
    if (pulls.some(Stage.isHit)) Stage.prepare(pulls);
    for (const pl of pulls) if (Stage.isHit(pl)) Stage.warm(pl);   // the hits' tracks load while the first cards flip
    deal.innerHTML = "";
    const grid = document.createElement("div"); grid.className = "deal"; deal.appendChild(grid);
    pulls.forEach((pl, i) => grid.appendChild(slotEl(pl, i)));
    window.V2?.pulls(pulls);
    if (god && !reduceMotion()) {
      const flips = [...grid.querySelectorAll(".flip")];
      if (await Stage.god(pulls, flips)) for (const f of flips) await f.reveal(true);
    }
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
    document.querySelectorAll(".pack, .offer .btn, #openBig, #tableBack, #flipAll").forEach(b => b.disabled = false);
    renderStock();
  }
}

// the opening table takes the place of the booster (or of the shop shelves), then gives it back
function seatTable(anchor) {
  const table = $("#table");
  document.querySelectorAll(".stowed").forEach(x => x.classList.remove("stowed"));
  anchor.after(table); anchor.classList.add("stowed");
  table.hidden = false;
  table.classList.remove("enter"); void table.offsetWidth; table.classList.add("enter");
}
function unseatTable() {
  $("#table").hidden = true; $("#deal").innerHTML = "";
  document.querySelectorAll(".stowed").forEach(x => { x.classList.remove("stowed"); x.classList.remove("back-in"); void x.offsetWidth; x.classList.add("back-in"); });
}

/* ---------- a hit (Mythique and above), full screen. A coloured record spins up in the dark, the track starts,
   sound waves pulse at its tempo, then the card bursts out of the record, flips, and flies back to its place. ---------- */
const Stage = (() => {
  let el, fading = null, tapped = null, sparks;
  const audio = new Audio(); audio.preload = "auto";
  const isHit = pl => pl.c.tier >= MYTH;
  const css = v => v.startsWith("var(") ? getComputedStyle(document.documentElement).getPropertyValue(v.slice(4, -1)).trim() : v;
  const colorOf = pl => pl.holo ? "#f5d27a" : css(isArtist(pl.c) ? CCOL[pl.c.tier] : RCOL[pl.c.tier]);
  const warm = pl => pl.preview ??= (isArtist(pl.c) ? dz(`artist/${pl.c.aid}/top`, { limit: 1 }, true).then(d => (d.data || [])[0]?.preview)
    : dz("track/" + pl.c.id, {}, true).then(t => t.preview)).catch(() => null);

  function build() {
    el = document.createElement("div");
    el.className = "fx-screen"; el.hidden = true;
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Révélation d'un hit");
    el.innerHTML = `<div class="fx-bg" aria-hidden="true"><div class="fx-glow"></div><div class="fx-rays"></div></div>
      <div class="fx-gl-host" aria-hidden="true"></div>
      <canvas class="fx-canvas" aria-hidden="true"></canvas>
      <div class="fx-center">
        <div class="fx-waves" aria-hidden="true"><i></i><i></i><i></i></div>
        <div class="fx-disc" aria-hidden="true">
          <div class="rec"><div class="grooves"></div><div class="tint"></div><div class="label"><div class="ltint"></div><img src="brand/zikhunter-icon.svg" alt=""><span>ZIK HUNTER · FACE A</span></div></div>
          <div class="gloss"></div>
        </div>
        <div class="fx-sleeve" aria-hidden="true"><img src="brand/zikhunter-icon.svg" alt=""><b>ZIK HUNTER</b><small>Face A · 33 tours</small></div>
        <div class="fx-card"><div class="tilt"><div class="flipper"><div class="face back"></div><div class="face front"></div></div></div></div>
      </div>
      <div class="fx-title" aria-live="polite"><b></b><small></small></div>
      <p class="fx-hint"></p>
      <div class="fx-god" aria-live="polite"><b></b><small>1 chance sur 3 000</small></div>
      <div class="fx-row" aria-hidden="true"></div>`;
    document.body.appendChild(el);
    el.querySelector(".face.back").appendChild(backEl(true));
    sparks = Particles(el.querySelector(".fx-canvas"));
    el.addEventListener("click", () => tapped?.());
    const tilt = el.querySelector(".tilt");
    let tiltRaf = 0;
    el.addEventListener("pointermove", e => {       // the card leans toward the pointer, at most once per frame
      if (tiltRaf || !el.classList.contains("s-hold")) return;
      tiltRaf = requestAnimationFrame(() => {
        tiltRaf = 0;
        tilt.style.transform = `rotateY(${(e.clientX / innerWidth - .5) * 16}deg) rotateX(${(e.clientY / innerHeight - .5) * -12}deg)`;
      });
    });
    addEventListener("keydown", e => {
      if (el.hidden || !tapped) return;
      if (e.key === " " || e.key === "Enter" || e.key === "Escape") { e.preventDefault(); e.stopPropagation(); tapped(); }
    }, true);
  }
  const $s = sel => el.querySelector(sel);

  // the record's rotation runs on its own clock so it can speed up and slow down smoothly
  let spin = { a: 0, v: 0, to: 0, raf: 0, t: 0 };
  function spinLoop(t) {
    const dt = Math.min(.05, (t - (spin.t || t)) / 1000); spin.t = t;
    spin.v += (spin.to - spin.v) * Math.min(1, dt * 2.2);
    spin.a = (spin.a + spin.v * 360 * dt) % 360;
    $s(".rec").style.transform = `rotate(${spin.a}deg)`;
    spin.raf = requestAnimationFrame(spinLoop);
  }

  function stopAudio(ms = 500) {
    clearInterval(fading);
    if (audio.paused) return;
    const step = audio.volume / Math.max(1, ms / 50);
    fading = setInterval(() => { audio.volume = Math.max(0, audio.volume - step); if (audio.volume <= 0.01) { clearInterval(fading); audio.pause(); } }, 50);
  }
  function fadeIn() { clearInterval(fading); fading = setInterval(() => { audio.volume = Math.min(1, audio.volume + .06); if (audio.volume >= 1) clearInterval(fading); }, 50); }

  // resolves once the player has tapped and the card has flown back into `target`
  async function hit(pl, target) {
    if (!el) build();
    const big = pl.c.tier === LEG || pl.holo, col = colorOf(pl);
    const bpm = pl.c.bpm > 0 ? pl.c.bpm : 118;
    warm(pl);
    el.className = "fx-screen"; el.hidden = false; document.body.classList.add("fx-on");
    $s(".tilt").style.transform = "";
    el.style.setProperty("--vc", "#cfc8da");
    el.style.setProperty("--beat", (60 / bpm).toFixed(3) + "s");
    if (big) el.classList.add("big");
    if (pl.holo) el.classList.add("shiny");
    const front = $s(".face.front"); front.innerHTML = ""; front.appendChild(cardEl(pl.c, pl.holo));
    // decode the artwork now, so it doesn't freeze the animation when the card comes out
    await Promise.race([Promise.all([...front.querySelectorAll("img")].map(i => i.decode().catch(() => {}))), wait(700)]);
    const title = pl.holo ? "SHINY" : rarName(pl.c).toUpperCase();
    $s(".fx-title b").style.setProperty("--n", title.length); $s(".fx-title b").innerHTML = [...title].map((ch, k) => `<span style="--k:${k}">${ch === " " ? "&nbsp;" : ch}</span>`).join("");
    $s(".fx-title small").textContent = (pl.isNew ? "Nouvelle carte · " : "Doublon · ") + (pl.holo ? rarName(pl.c) + " · " : "") + (isArtist(pl.c) ? pl.c.t : pl.c.a);
    $s(".fx-hint").textContent = "";
    sparks.start(col, big);
    const playTrack = async () => {
      const url = await Promise.race([pl.preview, wait(500)]);
      if (url) { clearInterval(fading); audio.src = url; audio.volume = 0; audio.play().then(() => { fadeIn(); window.NowPlaying?.(pl.c, audio); }).catch(() => {}); }
    };
    const flash = () => { const f = document.createElement("div"); f.className = "flash"; document.body.appendChild(f); setTimeout(() => f.remove(), 900); };
    // a Platine or Diamant artist gets its own film: the signed sleeve (falls back to the turntable, then to CSS)
    // the sleeve's 3D (about 4 MB) may still be on its way when the card is flipped right after the opening: a black
    // screen while it loads (a word after a second), rather than falling back to the turntable too early
    let sl = null;
    if (isArtist(pl.c) && pl.c.tier >= MYTH && !reduceMotion()) {
      const slow = setTimeout(() => { $s(".fx-hint").textContent = "Chargement…"; }, 1200);
      sl = await Promise.race([loadSleeve(), wait(15000)]);
      clearTimeout(slow); $s(".fx-hint").textContent = "";
    }
    if (sl?.lost) { dropSleeve(); sl = null; }                   // its 3D died since last time: the turntable, and a fresh one next time
    const g = sl ? null : await Promise.race([load3d(), wait(1200)]);
    let r;
    if (sl) {
      el.classList.add("three", "sleeve");
      const small = innerWidth <= 600;
      const w = small ? Math.min(innerWidth * .62, 260) : Math.min(Math.min(innerWidth, innerHeight) * .44, 300);
      const kind = pl.c.collector ? "collector" : pl.holo ? "shiny" : pl.c.tier >= LEG ? "diamant" : "platine";
      let url = null;
      r = await sl.play({ kind, w, cy: small ? .42 : .46, name: pl.c.t, photo: (pl.c.cov || "").replace(/\/\d+x\d+-/, "/1000x1000-"), on: {
        start: () => el.classList.add("s-in"),   // not before: the canvas still holds the last frame of the previous film
        // the track starts low behind the sleeve, and opens up when the record comes out
        music: async () => { url = await Promise.race([pl.preview, wait(500)]); if (url) { clearInterval(fading); audio.src = url; audio.volume = 0; audio.play().then(() => { audio.volume = .22; window.NowPlaying?.(pl.c, audio); }).catch(() => {}); } },
        open: () => { if (url) fadeIn(); },
      } });
      el.style.setProperty("--vc", col);
      const card = $s(".fx-card");
      Object.assign(card.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px" });
      $s(".fx-title").style.top = (r.top + r.height + 18) + "px";
      if (sl.lost) dropSleeve();
      el.classList.add("s-in", "s-reveal");
    } else if (g) {
      // the 3D turntable: intro, the needle lands (the music starts on the touch), the card rises out of the record
      el.classList.add("three");
      void el.offsetWidth; el.classList.add("s-in");
      await g.intro({ shiny: !!pl.holo, big });
      el.style.setProperty("--vc", col);
      const n = await g.needle(col, bpm, big);
      playTrack();
      el.classList.add("s-charge"); sparks.embers(big ? 3 : 2);
      n.swell();
      await wait(big ? 1500 : 1150);
      const small = innerWidth <= 600;
      const w = small ? Math.min(innerWidth * .62, 260) : Math.min(Math.min(innerWidth, innerHeight) * .44, 300);
      const cy = small ? .42 : .46;
      r = await g.emerge(w * 88 / 63, cy);
      const card = $s(".fx-card");
      Object.assign(card.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px" });
      $s(".fx-title").style.top = (r.top + r.height + 18) + "px";
      el.classList.remove("s-charge"); el.classList.add("s-reveal");
      g.hold(big);
    } else {
      // no 3D (old phone, offline CDN): the record and its sleeve in plain CSS
      spin = { a: 0, v: 0, to: 0, raf: 0, t: 0 };
      spin.raf = requestAnimationFrame(spinLoop);
      void el.offsetWidth; el.classList.add("s-in");             // 1. the sleeve appears, the record slides out of it
      await wait(380); el.classList.add("s-slide");
      await wait(620); el.classList.add("s-free"); spin.to = .55;   // out of the sleeve, it starts turning
      await wait(520);
      el.style.setProperty("--vc", col);                          // 2. it takes the colour of the hit, the needle is down
      el.classList.add("s-charge"); spin.to = big ? 1.1 : .8;
      sparks.embers(big ? 3 : 2);
      await playTrack();
      await wait(big ? 1450 : 1100);
      el.classList.remove("s-charge"); el.classList.add("s-reveal");   // 3. burst: the card comes out of the record
      spin.to = .35;
    }
    r = $s(".fx-card").getBoundingClientRect();
    if (!sl) { sparks.burst(r.left + r.width / 2, r.top + r.height / 2, big ? 260 : 150); if (big) flash(); }
    await wait(1100);
    el.classList.add("s-hold");
    $s(".fx-hint").textContent = "Touche pour continuer";
    await new Promise(r => { tapped = r; });
    tapped = null;

    stopAudio(600);                                             // 4. the card flies back to its place on the table
    $s(".fx-hint").textContent = "";
    el.classList.add("s-out"); $s(".tilt").style.transform = "";
    sparks.embers(0);
    const card = $s(".fx-card"), from = card.getBoundingClientRect(), to = target?.getBoundingClientRect();
    if (to && to.width && to.bottom > 0 && to.top < innerHeight) {
      const dx = to.left + to.width / 2 - (from.left + from.width / 2), dy = to.top + to.height / 2 - (from.top + from.height / 2);
      await card.animate([{ transform: "none" }, { transform: `translate(${dx}px,${dy}px) scale(${to.width / from.width})` }],
        { duration: 560, easing: "cubic-bezier(.6,0,.2,1)", fill: "forwards" }).finished;
    } else await card.animate([{ opacity: 1 }, { opacity: 0, transform: "scale(.6)" }], { duration: 400, fill: "forwards" }).finished;
    el.hidden = true; document.body.classList.remove("fx-on");
    card.getAnimations().forEach(a => a.cancel());
    card.removeAttribute("style"); $s(".fx-title").removeAttribute("style");
    el.className = "fx-screen";
    cancelAnimationFrame(spin.raf); sparks.stop(); hit3d?.stop(); sleeve3d?.stop();
  }
  // the signed sleeve, for Platine and Diamant artists: its own file, fetched only when a booster holds one
  let sleeve3d = null, sleeveP = null;
  const dropSleeve = () => { sleeve3d?.canvas.remove(); sleeve3d = null; sleeveP = null; };
  const loadSleeve = () => sleeveP ??= (t => Promise.all([document.fonts.load('40px "Mrs Saint Delafield"'), document.fonts.load('900 34px "Unbounded"'), document.fonts.load('500 20px "DM Mono"')])
    .then(() => import("./sleeve3d.js?v=7")).then(m => m.create($s(".fx-gl-host"))).then(async x => { await x.warmup(); console.info("Pochette 3D prête en", Math.round(performance.now() - t), "ms"); return sleeve3d = x; })
    .catch(e => { console.warn("Pochette 3D indisponible", e); sleeveP = null; return null; }))(performance.now());
  // the 3D scene is a separate file, fetched only when a booster holds a hit; null if WebGL or the CDN fails
  let hit3d = null, hit3dP = null;
  const load3d = () => hit3dP ??= import("./hit3d.js?v=23").then(m => m.create($s(".fx-gl-host"))).then(async x => { await x.warmup(); return hit3d = x; })
    .catch(e => { console.warn("3D indisponible, animation simple", e); return null; });
  /* GOD pack: "GOD PACK" is written in gold in the dark, the lamp lights a solid gold record, the needle lands, light
     leaks out of the grooves and the record bursts into five cards turning in a ring around the deck. Each tap brings
     one card to the front (its colour, its track); at the end the five fly down to the table. False if no 3D. */
  async function god(pulls, flips) {
    if (!el) build();
    const g = await Promise.race([load3d(), wait(2500)]);
    if (!g) return false;
    const tap = () => new Promise(r => { tapped = r; }).then(() => { tapped = null; });
    const flash = () => { const f = document.createElement("div"); f.className = "flash"; document.body.appendChild(f); setTimeout(() => f.remove(), 900); };
    el.className = "fx-screen three god"; el.hidden = false; document.body.classList.add("fx-on");
    $s(".tilt").style.transform = ""; $s(".fx-hint").textContent = "";
    $s(".fx-title b").innerHTML = ""; $s(".fx-title small").textContent = "";
    el.style.setProperty("--vc", "#f5c24d");
    $s(".fx-god b").innerHTML = [..."GOD PACK"].map((ch, k) => `<span style="--k:${k}">${ch === " " ? "&nbsp;" : ch}</span>`).join("");
    const row = $s(".fx-row"); row.innerHTML = pulls.map(() => `<i></i>`).join("");
    pulls.forEach(warm);
    sparks.start("#f5c24d", true);
    void el.offsetWidth; el.classList.add("s-ann");              // 1. the announcement, in the dark (the letters start a
    await wait(3000);                                            //    little late: the 3D may still be warming up just then)
    el.classList.add("s-ann-out", "s-in");                       // 2. the lamp, the gold record, the needle
    await g.intro({ god: true, big: true });
    await g.needle("#f5c24d", 120, true);
    sparks.embers(3);
    const colors = pulls.map(colorOf);
    await g.godBurst(colors, () => {                             // 3. light leaks out, the record bursts
      flash(); sparks.burst(innerWidth / 2, innerHeight * .45, 340);
    });
    $s(".fx-hint").textContent = "Touche pour révéler · 1 / 5";
    await tap();
    const small = innerWidth <= 600;
    const w = (small ? Math.min(innerWidth * .56, 230) : Math.min(Math.min(innerWidth, innerHeight) * .38, 270));
    const card = $s(".fx-card"), front = $s(".face.front");
    for (let i = 0; i < pulls.length; i++) {                     // 4. one card at a time
      const pl = pulls[i], col = colorOf(pl), big = pl.c.tier === LEG || pl.holo;
      $s(".fx-hint").textContent = "";
      el.classList.remove("s-reveal", "s-hold", "big", "shiny");
      if (big) el.classList.add("big"); if (pl.holo) el.classList.add("shiny");
      el.style.setProperty("--vc", col);
      front.innerHTML = ""; front.appendChild(cardEl(pl.c, pl.holo));
      const title = pl.holo ? "SHINY" : rarName(pl.c).toUpperCase();
      $s(".fx-title b").style.setProperty("--n", title.length); $s(".fx-title b").innerHTML = [...title].map((ch, k) => `<span style="--k:${k}">${ch === " " ? "&nbsp;" : ch}</span>`).join("");
      $s(".fx-title small").textContent = (pl.isNew ? "Nouvelle carte · " : "Doublon · ") + (pl.holo ? rarName(pl.c) + " · " : "") + (isArtist(pl.c) ? pl.c.t : pl.c.a);
      const r = await g.godPick(i, w * 88 / 63, small ? .4 : .42, col);
      const url = await Promise.race([pl.preview, wait(400)]);
      stopAudio(0);
      if (url) { clearInterval(fading); audio.src = url; audio.volume = 0; audio.play().then(() => { fadeIn(); window.NowPlaying?.(pl.c, audio); }).catch(() => {}); }
      Object.assign(card.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px" });
      $s(".fx-title").style.top = (r.top + r.height + 14) + "px";
      void el.offsetWidth; el.classList.add("s-reveal");
      sparks.burst(r.left + r.width / 2, r.top + r.height / 2, big ? 220 : 130);
      if (big) flash();
      await wait(1000);
      el.classList.add("s-hold");
      $s(".fx-hint").textContent = i < pulls.length - 1 ? `Touche pour la suivante · ${i + 2} / 5` : "Touche pour finir";
      await tap();
      // the card goes down into its place in the row
      const slot = row.children[i], from = card.getBoundingClientRect(), to = slot.getBoundingClientRect();
      const mini = front.querySelector(".cq").cloneNode(true); slot.appendChild(mini); slot.classList.add("on");
      el.classList.remove("s-reveal", "s-hold");
      mini.animate([{ transform: `translate(${from.left - to.left}px,${from.top - to.top}px) scale(${from.width / to.width})` }, { transform: "none" }],
        { duration: 480, easing: "cubic-bezier(.3,0,.2,1)" });
      if (i < pulls.length - 1) g.godRelease();
    }
    stopAudio(700);                                              // 5. the five cards fly down to the table
    $s(".fx-hint").textContent = "";
    el.classList.add("s-out");
    sparks.embers(0);
    await wait(150);
    await Promise.all([...row.children].map((slot, i) => {
      const mini = slot.firstElementChild, a = mini.getBoundingClientRect(), b = flips[i]?.getBoundingClientRect();
      if (!b || !b.width || b.bottom < 0 || b.top > innerHeight) return mini.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: "forwards" }).finished;
      return mini.animate([{ transform: "none" }, { transform: `translate(${b.left - a.left}px,${b.top - a.top}px) scale(${b.width / a.width})` }],
        { duration: 650, delay: i * 70, easing: "cubic-bezier(.6,0,.2,1)", fill: "forwards" }).finished;
    }));
    el.hidden = true; document.body.classList.remove("fx-on");
    row.innerHTML = ""; card.removeAttribute("style"); $s(".fx-title").removeAttribute("style");
    el.className = "fx-screen";
    cancelAnimationFrame(spin.raf); sparks.stop(); hit3d?.stop();
    return true;
  }
  // built and decoded ahead of time (when the pack holds a hit), so the screen opens without a hitch
  function prepare(pulls = []) {
    if (!el) build();
    el.querySelectorAll("img").forEach(i => i.decode().catch(() => {}));
    if (pulls.some(pl => isArtist(pl.c) && pl.c.tier >= MYTH)) loadSleeve();
    if (pulls.some(pl => !isArtist(pl.c) && isHit(pl)) || !pulls.length) load3d();
  }
  return { isHit, warm, hit, god, prepare };
})();

// light particles for the hit screen: slow embers rising during the charge, a burst when the card comes out
function Particles(cv) {
  const ctx = cv.getContext("2d");
  let list = [], raf = 0, col = "#fff", rate = 0, last = 0, dpr = 1;
  const fit = () => { dpr = Math.min(1.5, devicePixelRatio || 1); cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; };
  function frame(t) {
    const dt = Math.min(.05, (t - (last || t)) / 1000); last = t;
    for (let k = 0; k < rate; k++) if (Math.random() < .6) list.push({   // embers drift up from the bottom
      x: Math.random() * innerWidth, y: innerHeight + 10, vx: (Math.random() - .5) * 20, vy: -40 - Math.random() * 90,
      life: 0, max: 2.5 + Math.random() * 2, s: .8 + Math.random() * 2, c: Math.random() < .25 ? "#fff" : col, drag: 0, g: 0, streak: false });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalCompositeOperation = "lighter";
    list = list.filter(p => (p.life += dt) < p.max);
    if (list.length > 420) list.splice(0, list.length - 420);
    for (const p of list) {
      p.vx *= 1 - p.drag * dt; p.vy = p.vy * (1 - p.drag * dt) + p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const a = Math.max(0, 1 - p.life / p.max);
      ctx.globalAlpha = a; ctx.fillStyle = ctx.strokeStyle = p.c;
      if (p.streak) { ctx.lineCap = "round"; ctx.lineWidth = p.s; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * .045, p.y - p.vy * .045); ctx.stroke(); }
      else { const r = p.s * (.4 + a * .6); ctx.globalAlpha = a * .25; ctx.fillRect(p.x - r * 2, p.y - r * 2, r * 4, r * 4); ctx.globalAlpha = a; ctx.fillRect(p.x - r / 2, p.y - r / 2, r, r); }
    }
    raf = requestAnimationFrame(frame);
  }
  return {
    start(c) { col = c; list = []; fit(); last = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); },
    embers(n) { rate = n; },
    burst(x, y, n) {
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2, v = 250 + Math.random() * 900;
        list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: .7 + Math.random() * 1.1, s: 1 + Math.random() * 2.4,
          c: Math.random() < .3 ? "#fff" : col, drag: 2.6, g: 160, streak: Math.random() < .6 });
      }
    },
    stop() { cancelAnimationFrame(raf); list = []; ctx.clearRect(0, 0, cv.width, cv.height); },
  };
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
  const back = document.createElement("div"); back.className = "face"; back.appendChild(backEl(!!backName()));   // 3D only for a genre booster
  const front = document.createElement("div"); front.className = "face front"; front.appendChild(cardEl(pl.c, pl.holo));
  f.append(back, front);
  const tag = document.createElement("span"); tag.className = "tag"; tag.innerHTML = "&nbsp;";
  let revealing = false;
  f.reveal = async (instant = false) => {   // resolves once the card is face up (after its animation)
    if (f.classList.contains("on") || revealing) return;
    revealing = true;
    if (instant) { f.style.transition = "none"; f.classList.add("on"); void f.offsetWidth; f.style.transition = ""; }
    else if (Stage.isHit(pl) && !reduceMotion()) {
      await Stage.hit(pl, f);
      f.style.transition = "none"; f.classList.add("on"); void f.offsetWidth; f.style.transition = "";   // the card landed face up
    }
    else if (pl.c.tier >= 3 && !reduceMotion()) await revealBig(slot, pl.c.tier);
    f.classList.add("on"); f.setAttribute("aria-label", pl.c.t + ", " + rarName(pl.c));
    if (pl.c.tier >= 3) slot.classList.add("burst", "burst-" + pl.c.tier);
    tag.textContent = (pl.isNew ? "Nouvelle · " : "Doublon · ") + (isArtist(pl.c) ? "Artiste · " : "") + rarName(pl.c) + (pl.holo && pl.c.tier >= MYTH ? " · SHINY" : "");
    if (pl.isNew) tag.classList.add("new");
    revealing = false;
  };
  f.onclick = () => f.classList.contains("on") ? openModal(pl.c, pl.holo) : f.reveal();
  slot.append(f, tag);
  return slot;
}
// one card after the other, so each big pull gets its own moment
$("#flipAll").onclick = async () => {
  for (const f of document.querySelectorAll("#deal .flip:not(.on)")) { await f.reveal(); await wait(160); }
};
$("#again").onclick = () => openPack(lastPack);
$("#tableBack").onclick = unseatTable;

/* ---------- binder ---------- */
const F = { g: -1, r: -1, sort: "recent", q: "", tag: null };
function renderBinder() {
  const all = owned();
  const pg = $("#prog");
  const rows = [{ g: -1, n: "Tout", h: 42 }].concat(TYPES.map((t, g) => ({ g, n: t.n, h: t.h })));
  if (all.some(isArtist)) rows.splice(1, 0, { g: -2, n: "Artistes", h: 42 });
  pg.innerHTML = rows.map(t => {
    const list = t.g === -1 ? all : t.g === -2 ? all.filter(isArtist) : all.filter(c => c.g === t.g && !isArtist(c));
    const leg = list.filter(c => c.tier === LEG).length;
    return `<button data-g="${t.g}" style="--h:${t.h}" aria-pressed="${F.g === t.g}"><span class="row">${t.n}<small>${fmt(list.length)}</small></span><span class="meter"><s style="width:${all.length ? list.length / all.length * 100 : 0}%"></s></span><small class="legs">${leg} légendaire${leg > 1 ? "s" : ""}</small></button>`;
  }).join("");
  pg.querySelectorAll("button").forEach(b => b.onclick = () => { F.g = +b.dataset.g; renderBinder(); });

  const fl = $("#filters");
  fl.innerHTML = [-1, ...RAR.keys()].map(r => `<button class="chip" data-r="${r}" aria-pressed="${F.r === r}">${r < 0 ? "Toutes raretés" : `<i style="background:${RCOL[r]}"></i>${RAR[r]}`}</button>`).join("") +
    `<label for="fSort">Trier par <select id="fSort"><option value="recent">plus récentes</option><option value="rarity">rareté</option><option value="pw">puissance</option><option value="year">année de sortie</option><option value="dup">doublons</option></select></label>`;
  $("#fSort").value = F.sort;
  fl.querySelectorAll(".chip").forEach(b => b.onclick = () => { F.r = +b.dataset.r; renderBinder(); });
  const fq = $("#fQ");
  fq.oninput = () => { clearTimeout(fq._t); fq._t = setTimeout(() => { F.q = fq.value; renderBinder(); }, 250); };
  $("#fSort").onchange = e => { F.sort = e.target.value; renderBinder(); };

  const q = F.q.trim().toLowerCase();
  let list = all.filter(c => (F.g === -1 || (F.g === -2 ? isArtist(c) : c.g === F.g && !isArtist(c))) && (F.r < 0 || c.tier === F.r)
    && (!q || (c.t + " " + c.a + " " + (c.al || "")).toLowerCase().includes(q))
    && (!F.tag || (Online.tagsOf?.(c) || []).some(t => t.id === F.tag)));
  Online.renderTagBar?.();
  const power = new Map();                // computed once per card, not at every comparison
  const pw = c => { if (!power.has(c)) power.set(c, (isArtist(c) ? artistStats(c) : stats(c)).pw); return power.get(c); };
  const by = {
    recent: (a, b) => b.at - a.at,
    rarity: (a, b) => b.tier - a.tier || b.rank - a.rank,
    pw: (a, b) => pw(b) - pw(a),
    year: (a, b) => (b.y || 0) - (a.y || 0),
    dup: (a, b) => b.n - a.n,
  }[F.sort];
  list.sort(by);
  $("#binderCount").textContent = list.length === all.length ? `${fmt(all.length)} cartes` : `${fmt(list.length)} carte${list.length > 1 ? "s" : ""} sur ${fmt(all.length)}`;
  const bd = $("#binder"); bd.innerHTML = "";
  if (BIND.io) BIND.io.disconnect();
  if (!list.length) {
    bd.innerHTML = `<div class="empty">${all.length ? "Aucune carte ne correspond à ces filtres." : "Ta collection est vide. Ouvre un booster pour tirer tes premiers morceaux."}</div>`;
    return;
  }
  // cards arrive 48 at a time as you scroll, so a big collection opens instantly, even on a phone
  BIND.list = list; BIND.shown = 0;
  binderMore();
  const sentinel = document.createElement("div"); sentinel.className = "sentinel"; sentinel.setAttribute("aria-hidden", "true");
  bd.after(sentinel); BIND.sentinel?.remove(); BIND.sentinel = sentinel;
  BIND.io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) binderMore(); }, { rootMargin: "900px 0px" });
  BIND.io.observe(sentinel);
}
const BIND = { list: [], shown: 0, io: null, sentinel: null };
function binderMore() {
  const bd = $("#binder"), next = BIND.list.slice(BIND.shown, BIND.shown + 48);
  if (!next.length) { BIND.io?.disconnect(); return; }
  const frag = document.createDocumentFragment();
  for (const c of next) {
    const b = document.createElement("button"); b.className = "cell";
    b.setAttribute("aria-label", c.t + " de " + c.a);
    b.appendChild(cardEl(c, c.holo > 0));
    if (c.n > 1) { const n = document.createElement("span"); n.className = "cnt"; n.textContent = "×" + c.n; b.appendChild(n); }
    const tags = Online.tagsOf?.(c) || [];
    if (tags.length) {                     // your tags, as coloured dots under the card
      const d = document.createElement("span"); d.className = "tag-dots";
      d.innerHTML = tags.slice(0, 5).map(t => `<i style="background:${t.color}" title="${esc(t.name)}"></i>`).join("");
      b.appendChild(d);
    }
    b.onclick = () => openModal(c);
    frag.appendChild(b);
  }
  bd.appendChild(frag);
  BIND.shown += next.length;
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
  unseatTable();
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
const catCard = t => {
  const now = fullCards[t.id] || quickCard(t), own = bestOwned(t.id);
  if (!own || fullCards[t.id]) return now;
  const rank = t.rank || own.rank;                         // what we know of the track from your copy, today's rarity
  return { ...own, rank, tier: tierOf(rank), n: undefined, holo: undefined, copies: undefined, locked: undefined };
};

async function catLoad(reset) {
  if (CAT.mode === "artists") return artLoad(reset);
  const seq = ++CAT.seq;
  CAT.loading = true;
  if (reset) { CAT.items = []; CAT.index = 0; CAT.total = 0; CAT.wanted = 24; $("#catalog").innerHTML = ""; }
  CAT.loaded = true;
  $("#catMore").hidden = true;
  $("#catStatus").textContent = "Chargement des cartes…";
  try {
    let data, total;
    if (!CAT.q) {
      const d = await dz("chart/0/tracks", { limit: 100 }, true);
      data = d.data || []; total = data.length;
    } else {
      const params = { q: CAT.q, limit: PAGE, index: CAT.index };
      if (CAT.order) params.order = CAT.order;
      const d = await dz("search", params, true);
      data = d.data || []; total = d.total || 0;
    }
    if (seq !== CAT.seq) return;          // a newer search replaced this one
    const seen = new Set(CAT.items.map(t => t.id));
    CAT.items.push(...data.filter(t => t.album && !seen.has(t.id)));
    CAT.index += data.length || PAGE; CAT.total = total;
    CAT.loading = false;
    renderCatalog();
  } catch (e) {
    if (seq !== CAT.seq) return;
    CAT.loading = false;
    $("#catStatus").textContent = e.code === 4 ? "Deezer limite le nombre de demandes. Attends quelques secondes puis réessaie." : "Deezer ne répond pas. Vérifie ta connexion puis réessaie.";
  }
}

let catObserver = null;
function renderCatalog() {
  if (CAT.mode === "artists") return renderArtists();
  $("#catFilters").innerHTML = [-1, ...RAR.keys()].map(r => `<button class="chip" data-r="${r}" aria-pressed="${CAT.r === r}">${r < 0 ? "Toutes raretés" : `<i style="background:${RCOL[r]}"></i>${RAR[r]}`}</button>`).join("") +
    `<label for="catOwn">Afficher <select id="catOwn"><option value="all">toutes les cartes</option><option value="own">mes cartes</option><option value="miss">à trouver</option></select></label>`;
  $("#catOwn").value = CAT.own;
  $("#catFilters").querySelectorAll(".chip").forEach(b => b.onclick = () => { CAT.r = +b.dataset.r; CAT.wanted = 24; renderCatalog(); });
  $("#catOwn").onchange = e => { CAT.own = e.target.value; CAT.wanted = 24; renderCatalog(); };

  const list = CAT.items.filter(t => (CAT.r < 0 || tierOf(catCard(t).rank) === CAT.r) &&
    (CAT.own === "all" || (CAT.own === "own") === ownsTrack(t.id)));
  const ownedHere = CAT.items.filter(t => ownsTrack(t.id)).length;
  $("#catStatus").textContent = !CAT.items.length
    ? (CAT.q ? `Aucun morceau trouvé pour « ${CAT.q} ».` : "Aucune carte à afficher.")
    : `${CAT.q ? fmt(CAT.total) + " résultats pour « " + CAT.q + " »" : "Les 100 tubes du moment sur Deezer"} · ${fmt(CAT.items.length)} affichées, dont ${ownedHere} dans ta collection`;
  $("#catMore").hidden = true;            // more cards arrive by scrolling

  const grid = $("#catalog"); grid.innerHTML = "";
  if (catObserver) catObserver.disconnect();
  catObserver = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    catObserver.unobserve(e.target); completeCell(e.target);
  }), { rootMargin: "300px" });
  if (CAT.items.length && !list.length) { grid.innerHTML = `<div class="empty">Aucune carte ne correspond à ces filtres.</div>`; return; }
  // cards arrive 24 at a time while scrolling; at the end of what is loaded, the next search page is fetched
  CAT.list = list; CAT.drawn = 0;
  catalogMore(Math.max(24, CAT.wanted || 24));
  CAT.sentinel?.remove();
  const sentinel = document.createElement("div"); sentinel.className = "sentinel"; sentinel.setAttribute("aria-hidden", "true");
  grid.after(sentinel); CAT.sentinel = sentinel;
  if (CAT.endObserver) CAT.endObserver.disconnect();
  CAT.endObserver = new IntersectionObserver(es => {
    if (!es.some(e => e.isIntersecting)) return;
    if (CAT.drawn < CAT.list.length) catalogMore(24);
    else if (CAT.q && CAT.index < CAT.total && !CAT.loading) { CAT.wanted = CAT.drawn + 24; catLoad(false); }
  }, { rootMargin: "900px 0px" });
  CAT.endObserver.observe(sentinel);
}
function catalogMore(n) {
  const grid = $("#catalog"), next = CAT.list.slice(CAT.drawn, CAT.drawn + n);
  const frag = document.createDocumentFragment();
  for (const t of next) { const cell = catCell(t); frag.appendChild(cell); if (catCard(t).g == null) catObserver.observe(cell); }
  grid.appendChild(frag);
  CAT.drawn += next.length;
}
function catCell(t) {
  const c = catCard(t), own = S.c[ck(c)], best = bestOwned(t.id);
  const b = document.createElement("button");
  b.className = "cell" + (own ? "" : " locked"); b.dataset.id = t.id; b.track = t;
  b.setAttribute("aria-label", c.t + " de " + c.a + (own ? ", dans ta collection" : ", pas encore trouvée"));
  b.appendChild(cardEl(c, own?.holo > 0));
  if (own) { if (own.n > 1) { const n = document.createElement("span"); n.className = "cnt"; n.textContent = "×" + own.n; b.appendChild(n); } }
  else if (!best) { const l = document.createElement("span"); l.className = "lock"; l.textContent = "À trouver"; b.appendChild(l); }
  if (best && best.tier > c.tier) {                        // you pulled it when it was rarer
    const l = document.createElement("span"); l.className = "lock mine"; l.textContent = "À toi en " + RAR[best.tier]; b.appendChild(l);
  }
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

/* ---------- catalogue, artists: the artists of the moment, or any Deezer artist by name ---------- */
const ART = { q: "", items: [], ids: [], index: 0, total: 0, loaded: false, loading: false, seq: 0, r: -1, own: "all" };
const artistCard = a => ({ kind: "artist", id: "a" + a.id, aid: a.id, t: a.name, a: "Artiste", al: "", cov: (a.picture_big || a.picture_medium || "").replace(/^http:/, "https:"),
  rank: a.nb_fan || 0, albums: a.nb_album || 0, tier: certOf(a.nb_fan || 0, a.id), collector: false, g: null });
async function artLoad(reset) {
  const seq = ++ART.seq;
  if (reset) { ART.items = []; ART.ids = []; ART.index = 0; ART.total = 0; $("#catalog").innerHTML = ""; }
  ART.loaded = true; ART.loading = true;
  $("#catMore").hidden = true;
  $("#catStatus").textContent = "Chargement des artistes…";
  try {
    if (!ART.q) {
      // the artists of the moment (the Deezer chart), plus the Diamants d'honneur; the chart has no fan counts, so each
      // artist is fetched, 24 at a time
      if (!ART.ids.length) ART.ids = [...new Set([...HONOR, ...((await dz("chart/0/artists", { limit: 100 }, true)).data || []).map(a => a.id)])];
      const next = ART.ids.slice(ART.index, ART.index + PAGE);
      const got = await Promise.all(next.map(id => dz("artist/" + id, {}, true).catch(() => null)));
      if (seq !== ART.seq) return;
      ART.items.push(...got.filter(a => a && a.id)); ART.index += next.length; ART.total = ART.ids.length;
    } else {
      const d = await dz("search/artist", { q: ART.q, limit: PAGE, index: ART.index }, true);
      if (seq !== ART.seq) return;
      const seen = new Set(ART.items.map(a => a.id));
      ART.items.push(...(d.data || []).filter(a => !seen.has(a.id))); ART.index += (d.data || []).length || PAGE; ART.total = d.total || 0;
    }
    ART.loading = false;
    renderCatalog();
  } catch (e) {
    if (seq !== ART.seq) return;
    ART.loading = false;
    $("#catStatus").textContent = e.code === 4 ? "Deezer limite le nombre de demandes. Attends quelques secondes puis réessaie." : "Deezer ne répond pas. Vérifie ta connexion puis réessaie.";
  }
}
function renderArtists() {
  $("#catFilters").innerHTML = [-1, ...CERT.keys()].map(r => `<button class="chip" data-r="${r}" aria-pressed="${ART.r === r}">${r < 0 ? "Toutes certifications" : `<i style="background:${CCOL[r]}"></i>${CERT[r]}`}</button>`).join("") +
    `<label for="catOwn">Afficher <select id="catOwn"><option value="all">tous les artistes</option><option value="own">mes cartes</option><option value="miss">à trouver</option></select></label>`;
  $("#catOwn").value = ART.own;
  $("#catFilters").querySelectorAll(".chip").forEach(b => b.onclick = () => { ART.r = +b.dataset.r; renderArtists(); });
  $("#catOwn").onchange = e => { ART.own = e.target.value; renderArtists(); };
  // the best artists first (a search for "travis" puts Travis Scott before the many small Travis)
  const all = [...ART.items].sort((a, b) => certOf(b.nb_fan, b.id) - certOf(a.nb_fan, a.id) || b.nb_fan - a.nb_fan);
  const list = all.filter(a => (ART.r < 0 || certOf(a.nb_fan, a.id) === ART.r) && (ART.own === "all" || (ART.own === "own") === ownsTrack("a" + a.id)));
  const ownedHere = ART.items.filter(a => ownsTrack("a" + a.id)).length;
  $("#catStatus").textContent = !ART.items.length
    ? (ART.q ? `Aucun artiste trouvé pour « ${ART.q} ».` : "Aucun artiste à afficher.")
    : `${ART.q ? fmt(ART.total) + " artistes pour « " + ART.q + " »" : "Les artistes du moment sur Deezer"} · ${fmt(ART.items.length)} affichés, dont ${ownedHere} dans ta collection`;
  const grid = $("#catalog"); grid.innerHTML = "";
  CAT.sentinel?.remove(); CAT.endObserver?.disconnect(); catObserver?.disconnect();
  if (ART.items.length && !list.length) grid.innerHTML = `<div class="empty">Aucun artiste ne correspond à ces filtres.</div>`;
  for (const a of list) {
    const c = artistCard(a), own = versionsOf(c.id).reduce((b, v) => !b || v.tier > b.tier ? v : b, null);
    const b = document.createElement("button");
    b.className = "cell" + (own ? "" : " locked");
    b.setAttribute("aria-label", c.t + ", " + CERT[(own || c).tier] + (own ? ", dans ta collection" : ", pas encore trouvé"));
    b.appendChild(cardEl(own || c, own?.holo > 0));
    if (own) { if (own.n > 1) { const n = document.createElement("span"); n.className = "cnt"; n.textContent = "×" + own.n; b.appendChild(n); } }
    else { const l = document.createElement("span"); l.className = "lock"; l.textContent = "À trouver"; b.appendChild(l); }
    b.onclick = () => openModal(own || c);
    grid.appendChild(b);
  }
  $("#catMore").hidden = ART.loading || ART.index >= ART.total;
  $("#catMore").textContent = "Voir plus d'artistes";
}

// Morceaux / Artistes
function setCatMode(m) {
  CAT.mode = m;
  document.querySelectorAll("#catMode button").forEach(b => b.setAttribute("aria-pressed", b.dataset.m === m));
  $("#q").placeholder = m === "artists" ? "Nom d'un artiste : Daft Punk, Aya Nakamura…" : "Titre ou artiste : Daft Punk, Bohemian Rhapsody…";
  $("#qOrder").hidden = m === "artists";
  $("#q").value = m === "artists" ? ART.q : CAT.q;
  $("#catMore").textContent = m === "artists" ? "Voir plus d'artistes" : "Voir plus de cartes";
  const st = m === "artists" ? ART : CAT;
  if (!st.loaded) catLoad(true); else { if (m !== "artists") $("#catMore").hidden = true; renderCatalog(); }
}
document.querySelectorAll("#catMode button").forEach(b => b.onclick = () => setCatMode(b.dataset.m));

let searchTimer;
const catSearch = () => { const q = $("#q").value.trim(); if (CAT.mode === "artists") ART.q = q; else CAT.q = q; catLoad(true); };
$("#q").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(catSearch, 350);
});
$("#qOrder").onchange = () => { CAT.order = $("#qOrder").value; if (CAT.q) catLoad(true); };
$("#searchForm").onsubmit = e => { e.preventDefault(); clearTimeout(searchTimer); catSearch(); };
$("#catMore").onclick = () => catLoad(false);

/* ---------- detail + preview audio ---------- */
const modal = $("#modal"), audio = new Audio();
let lastFocus = null, current = null;
audio.onended = audio.onpause = () => { $("#mPlay").textContent = "Écouter l'extrait"; $("#mPlay").setAttribute("aria-pressed", "false"); };
audio.onplay = () => { $("#mPlay").textContent = "Pause"; $("#mPlay").setAttribute("aria-pressed", "true"); };
// shiny: how the clicked copy looks (a market listing, a pulled card…); by default, the best copy owned
function openModal(c, shiny) {
  lastFocus = document.activeElement; current = c;
  const own = S.c[ck(c)] || { n: 0, holo: 0 }, st = stats(c), T = TYPES[c.g] || TYPES[AUTRE];
  const others = versionsOf(c.id).filter(v => v.tier !== c.tier).sort((a, b) => b.tier - a.tier);
  const otherLine = others.length ? `<dt>Autres versions</dt><dd>${others.map(v => `${isArtist(c) ? CERT[v.tier] : RAR[v.tier]}${v.n > 1 ? " ×" + v.n : ""}`).join(" · ")}</dd>` : "";
  const box = $("#mCard"); box.innerHTML = "";
  const isShiny = (shiny ?? own.holo > 0) && c.tier >= MYTH && !c.collector;
  const w = cardEl(c, isShiny); box.appendChild(w);
  if (isArtist(c)) {
    $("#mTitle").textContent = c.t; $("#mSub").textContent = "Carte d'artiste · " + CERT[c.tier];
    $("#mDl").innerHTML = `<dt>Certification</dt><dd>${CERT[c.tier]}${c.collector || own.collector ? " · Collector" : ""}${isShiny ? " · Shiny" : ""}</dd><dt>Fans Deezer</dt><dd>${fmt(c.rank)}</dd>
      <dt>Albums</dt><dd>${c.albums || "?"}</dd><dt>Possédées</dt><dd>${own.n}${own.collector ? ` (dont la Collector)` : ""}</dd>${otherLine}`;
    $("#mLink").href = "https://www.deezer.com/artist/" + c.aid;
  } else {
  $("#mTitle").textContent = c.t; $("#mSub").textContent = c.a + " · " + c.al;
  $("#mDl").innerHTML = `<dt>Rareté</dt><dd>${RAR[c.tier]}${isShiny ? " · Shiny" : ""}</dd><dt>Classement</dt><dd>${fmt(c.rank)} pts Deezer</dd>
    <dt>${T.s}</dt><dd>${st.flow} · ${c.bpm > 0 ? c.bpm + " BPM" : "tempo estimé"}</dd><dt>Endurance</dt><dd>${st.endu} · ${fmtDur(c.d)}</dd>
    <dt>Hype</dt><dd>${st.hype}</dd><dt>Sortie</dt><dd>${c.y || "?"}</dd><dt>Possédées</dt><dd>${own.n}${own.holo && c.tier >= MYTH ? ` (dont ${own.holo} Shiny)` : ""}${own.locked ? ` · ${own.locked} non échangeable${own.locked > 1 ? "s" : ""}` : ""}</dd>${otherLine}`;
  $("#mLink").href = "https://www.deezer.com/track/" + c.id;
  }
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
    // an artist card plays the artist's most popular track
    const t = isArtist(c) ? ((await dz(`artist/${c.aid}/top`, { limit: 1 })).data || [])[0] || {} : await dz("track/" + c.id);
    if (!t.preview) throw 0;
    if (current !== c) return;
    audio.src = t.preview; await audio.play();
    window.NowPlaying?.(c, audio);
  } catch (e) { $("#mPlay").textContent = "Écouter l'extrait"; toast("Pas d'extrait disponible pour ce morceau."); }
};
function closeModal() { if (!window.NowPlaying) audio.pause(); modal.hidden = true; current = null; lastFocus?.focus?.(); }
$("#mClose").onclick = closeModal;
modal.onclick = e => { if (e.target === modal) closeModal(); };
addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) closeModal(); });

renderCounters();
renderStock();

/* ---------- local preview only: http://localhost:8765/#galerie shows one card of every kind ---------- */
async function buildGallery() {
  const shop = $("#view-shop"), wrap = document.createElement("div"); wrap.id = "gameDemo"; shop.prepend(wrap);
  const section = (title, sub) => {
    const h = document.createElement("h2"); h.textContent = title;
    const p = document.createElement("p"); p.className = "sub"; p.textContent = sub;
    const g = document.createElement("div"); g.className = "binder"; wrap.append(h, p, g); return g;
  };
  const add = (g, c, holo) => { const b = document.createElement("button"); b.className = "cell"; b.appendChild(cardEl(c, holo)); b.onclick = () => openModal(c, holo); g.appendChild(b); };
  const artist = (f, collector) => ({ kind: "artist", id: (collector ? "col" : "a") + f.id, aid: f.id, t: f.name, a: "Artiste",
    cov: (f.picture_big || "").replace("http:", "https:"), rank: f.nb_fan, albums: f.nb_album || 0, tier: certOf(f.nb_fan, f.id), collector });
  const gT = section("Les morceaux", "Une carte par rareté, de la Commune à la Légendaire, plus une Mythique et une Légendaire Shiny.");
  const used = new Set();
  for (const t of [0, 1, 2, 3, 4, 5]) { const raw = await findTrack(-1, t, used); if (raw) { used.add(raw.id); add(gT, await enrich(raw, -1), false); } }
  for (const t of [MYTH, LEG]) { const sh = await findTrack(-1, t, used); if (sh) { used.add(sh.id); add(gT, await enrich(sh, -1), true); } }
  const gA = section("Les artistes", "Une carte par certification, de la Démo au Disque de diamant.");
  const ua = new Set();
  for (const t of [0, 1, 2, 3, 4, 5]) { const a = await findArtist(t, ua); if (a) { ua.add(a.id); add(gA, artist(await dz("artist/" + a.id), false), false); } }
  const gS = section("Artistes Shiny", "Un Platine et un Diamant en version Shiny.");
  for (const id of [27, 246791]) add(gS, artist(await dz("artist/" + id), false), true);
  const gC = section("Les Collector", "La carte noire obtenue en complétant toute la discographie d'un artiste.");
  for (const id of [1424821, 75798, 564]) add(gC, artist(await dz("artist/" + id), true), false);
}
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && location.hash === "#galerie") buildGallery();
