"use strict";
/* Zik Hunter — Wrapped 2026: the year of a player in a few full-screen screens, like stories (touch the right to go
   on, the left to go back; they go on by themselves), with the extract of the best card playing behind, and at the
   end a picture to share. From 1 December (the admins can look before). The server counts everything (my_wrapped). */
const WR = { d: null, i: 0, timer: 0, audio: null, el: null, OPEN: Date.parse("2026-12-01T00:00:00+01:00"), KEY: "zh-wrapped-2026" };
const WR_KIND = {
  duel: ["Le Duelliste", "Le clash, c'est ta scène. Tu as gagné plus de blind tests que la plupart des joueurs."],
  trader: ["Le Trader", "Acheter, vendre, échanger : le marché n'a aucun secret pour toi."],
  grader: ["Le Perfectionniste", "Tes cartes, tu les veux sous verre et notées au dixième."],
  lucky: ["La Main d'Or", "Les Légendaires te tombent dans les mains. La chance ou le talent ?"],
  hunter: ["Le Chasseur", "Booster après booster, tu as tout retourné pour trouver la perle rare."],
  collector: ["Le Collectionneur", "Tu construis ta collection carte après carte, avec patience."],
};
const wrOpen = () => Date.now() >= WR.OPEN || (typeof ADM !== "undefined" && ADM.admin);
const wrDay = d => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
const wrCard = j => j && socCard(j);

function wrSlides(d) {
  const t = d.tiers || [], k = WR_KIND[d.kind] || WR_KIND.collector, a = d.artists || [];
  const since = new Date(d.since).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  return [
    { bg: "w1", html: `<p class="wr-k">Zik Hunter</p><h2 class="wr-big">Ton année<br>2026</h2><p class="wr-t">${esc(d.pseudo)}, depuis le ${since}, tu as fait vibrer tes oreilles et ta collection. On rembobine ?</p><div class="wr-disc" aria-hidden="true"></div>` },
    { bg: "w2", html: `<p class="wr-k">Les boosters</p><p class="wr-t">Tu as ouvert</p><b class="wr-n" data-n="${d.packs}">0</b><p class="wr-t">boosters, soit <b>${fmt(d.cards)}</b> cartes tirées${d.gods ? ` et <b>${d.gods} GOD pack${d.gods > 1 ? "s" : ""}</b> !` : "."}</p>
        ${d.top_day ? `<p class="wr-s">Ton record : <b>${fmt(d.top_day.packs)} boosters</b> le ${wrDay(d.top_day.day)}.</p>` : ""}` },
    { bg: "w3", html: `<p class="wr-k">Fidèle au poste</p><p class="wr-t">Tu es venu jouer</p><b class="wr-n" data-n="${d.days}">0</b><p class="wr-t">jour${d.days > 1 ? "s" : ""} cette année.</p>
        <p class="wr-s">Et tu as gagné <b>${fmt(d.streams)} Streams</b> en chemin.</p>` },
    ...(d.best ? [{ bg: "w4", music: true, html: `<p class="wr-k">Ta plus belle carte</p><div class="wr-card wr-flip"></div><p class="wr-t"><b>${esc(d.best.track?.title || d.best.artist?.name || "")}</b>${d.best.track ? ` · ${esc(d.best.track.artist)}` : ""}</p>`, card: d.best }] : []),
    ...(a.length ? [{ bg: "w5", html: `<p class="wr-k">Ton artiste n°1</p>${a[0].cover ? `<img class="wr-cover" src="${esc(a[0].cover)}" alt="">` : ""}<h2 class="wr-big sm">${esc(a[0].artist)}</h2><p class="wr-t"><b>${fmt(a[0].n)}</b> cartes dans ta collection.</p>
        <ol class="wr-top">${a.slice(1).map((x, i) => `<li><span>${i + 2}</span>${esc(x.artist)}<em>${fmt(x.n)}</em></li>`).join("")}</ol>` }] : []),
    { bg: "w6", html: `<p class="wr-k">Ta collection</p><b class="wr-n" data-n="${d.distinct}">0</b><p class="wr-t">cartes différentes, dont :</p>
        <div class="wr-rar">${[5, 4, 3].map(r => `<div style="--c:${RCOL[r]}"><b>${fmt(t[r] || 0)}</b><span>${RAR[r]}${(t[r] || 0) > 1 ? "s" : ""}</span></div>`).join("")}
          <div style="--c:#e9d9ff"><b>${fmt(d.shiny)}</b><span>Shiny</span></div>${d.limited ? `<div style="--c:#9fd8ff"><b>${fmt(d.limited)}</b><span>éd. limitée${d.limited > 1 ? "s" : ""}</span></div>` : ""}</div>` },
    { bg: "w7", html: `<p class="wr-k">L'arène</p>
        <div class="wr-grid">
          <div><b>${fmt(d.duel_wins)}</b><span>clash${d.duel_wins > 1 ? "s" : ""} gagné${d.duel_wins > 1 ? "s" : ""}</span></div>
          <div><b>${fmt(d.sales + d.buys)}</b><span>ventes et achats au marché</span></div>
          <div><b>${fmt(d.trades)}</b><span>échange${d.trades > 1 ? "s" : ""}</span></div>
          <div><b>${fmt(d.n_graded)}</b><span>carte${d.n_graded > 1 ? "s" : ""} gradée${d.n_graded > 1 ? "s" : ""}</span></div></div>
        ${d.graded ? `<div class="wr-card sm"></div><p class="wr-s">Ta meilleure note : <b>${d.graded.grade}/10</b></p>` : ""}`, card: d.graded },
    { bg: "w8", html: `<p class="wr-k">Ton classement</p><p class="wr-t">Score de collection</p><b class="wr-n" data-n="${d.score}">0</b>
        <p class="wr-t">Tu es <b>${d.rank}<sup>${d.rank === 1 ? "er" : "e"}</sup></b> sur ${fmt(d.players)} joueurs.</p>${d.top_pct <= 50 ? `<p class="wr-badge">TOP ${d.top_pct} %</p>` : ""}` },
    { bg: "w9", html: `<p class="wr-k">Ton profil de joueur</p><h2 class="wr-big sm">${k[0]}</h2><p class="wr-t">${k[1]}</p><div class="wr-medal" aria-hidden="true">★</div>` },
    { bg: "w10", end: true, html: `<p class="wr-k">Ton année 2026</p><div class="wr-sum" id="wrSum"></div>
        <div class="wr-acts"><button class="btn primary" id="wrShare">Partager mon année</button><button class="btn" id="wrAgain">Revoir</button></div>` },
  ];
}

async function wrappedOpen() {
  if (!me) return Online.askSignIn?.();
  try { WR.d = await rpc("my_wrapped"); } catch (e) { return toast(/wrapped_soon/.test(e?.message || "") ? "Ton Wrapped arrive le 1er décembre !" : message(e)); }
  try { localStorage.setItem(WR.KEY, "1"); } catch (e) {}
  WR.slides = wrSlides(WR.d); WR.i = 0;
  const el = WR.el = document.createElement("div"); el.className = "wr"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Ton année 2026 sur Zik Hunter");
  el.innerHTML = `<div class="wr-bars">${WR.slides.map(() => `<i><s></s></i>`).join("")}</div><button class="wr-x" aria-label="Fermer">×</button>
    <div class="wr-stage"></div><button class="wr-prev" aria-label="Précédent"></button><button class="wr-next" aria-label="Suivant"></button>`;
  document.body.appendChild(el); document.body.classList.add("fx-on");
  el.querySelector(".wr-x").onclick = wrappedClose;
  el.querySelector(".wr-prev").onclick = () => wrGo(WR.i - 1);
  el.querySelector(".wr-next").onclick = () => wrGo(WR.i + 1);
  el.addEventListener("keydown", e => { if (e.key === "Escape") wrappedClose(); if (e.key === "ArrowRight") wrGo(WR.i + 1); if (e.key === "ArrowLeft") wrGo(WR.i - 1); });
  // the extract of the best card, heard from its screen on (the touch that opened the Wrapped unlocks the sound)
  const b = WR.d.best;
  if (b?.track && typeof hxMusic === "function") { WR.music = hxMusic({ title: b.track.title, artist: b.track.artist, track_id: b.track_id }); WR.music.arm(); }
  requestAnimationFrame(() => el.classList.add("on"));
  el.tabIndex = -1; wrGo(0); el.focus();
}
function wrappedClose() {
  clearTimeout(WR.timer); WR.music?.stop(); WR.music = null;
  const el = WR.el; if (!el) return; WR.el = null;
  el.classList.remove("on"); document.body.classList.remove("fx-on"); setTimeout(() => el.remove(), 400);
}
function wrGo(i) {
  const el = WR.el; if (!el) return;
  if (i >= WR.slides.length) return; if (i < 0) i = 0;
  WR.i = i; clearTimeout(WR.timer);
  const s = WR.slides[i], st = el.querySelector(".wr-stage");
  el.dataset.bg = s.bg;
  el.querySelectorAll(".wr-bars i").forEach((b, k) => { b.className = k < i ? "done" : k === i ? "now" : ""; });
  const bar = el.querySelector(".wr-bars i.now s"); if (bar) bar.style.animationDuration = s.end ? ".01s" : (s.card ? 7.5 : 6) + "s";
  st.innerHTML = `<div class="wr-slide">${s.html}</div>`;
  const slot = st.querySelector(".wr-card"); if (slot && s.card) slot.appendChild(wrCard(s.card));
  st.querySelectorAll(".wr-n").forEach(n => wrCount(n, +n.dataset.n));
  if (s.music) WR.music?.start();
  if (s.end) wrSummary();
  else WR.timer = setTimeout(() => wrGo(i + 1), s.card ? 7500 : 6000);
}
function wrCount(n, to) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { n.textContent = fmt(to); return; }
  const t0 = performance.now(), D = 1400;
  const f = t => { const k = Math.min(1, (t - t0) / D); n.textContent = fmt(Math.round(to * (1 - Math.pow(1 - k, 3)))); if (k < 1 && n.isConnected) requestAnimationFrame(f); };
  requestAnimationFrame(f);
}
// the last screen: the year on one card, and a picture of it to share
function wrSummary() {
  const d = WR.d, t = d.tiers || [], k = WR_KIND[d.kind] || WR_KIND.collector, box = $("#wrSum");
  const lines = [["Boosters ouverts", fmt(d.packs)], ["Cartes différentes", fmt(d.distinct)], ["Légendaires", fmt(t[5] || 0)], ["Jours de jeu", fmt(d.days)],
    ["Artiste n°1", d.artists?.[0]?.artist || "—"], ["Classement", `${d.rank}${d.rank === 1 ? "er" : "e"} / ${fmt(d.players)}`]];
  box.innerHTML = `<div class="wr-sc"><div class="wr-sc-h"><b>${esc(d.pseudo)}</b><span>${k[0]}</span></div>
    <div class="wr-sc-b">${d.best ? `<div class="wr-card xs"></div>` : ""}<dl>${lines.map(([a, b]) => `<dt>${a}</dt><dd>${esc(String(b))}</dd>`).join("")}</dl></div>
    <p class="wr-sc-f">Zik Hunter · Wrapped 2026</p></div>`;
  if (d.best) box.querySelector(".wr-card").appendChild(wrCard(d.best));
  $("#wrAgain").onclick = () => wrGo(0);
  $("#wrShare").onclick = () => wrShare(lines, k[0]);
}
async function wrShare(lines, kind) {
  const d = WR.d, W = 1080, H = 1920, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d"), grd = g.createLinearGradient(0, 0, W, H);
  grd.addColorStop(0, "#1b0a3a"); grd.addColorStop(.5, "#4a1462"); grd.addColorStop(1, "#e7b14a"); g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(255,255,255,.06)"; for (let r = 900; r > 0; r -= 60) { g.beginPath(); g.arc(W * .85, H * .12, r, 0, 7); g.fill(); }
  const font = (w, s) => `${w} ${s}px Inter, system-ui, sans-serif`;
  g.fillStyle = "#fff"; g.font = font(600, 40); g.fillText("ZIK HUNTER · WRAPPED 2026", 80, 140);
  g.font = font(900, 110); g.fillText(d.pseudo, 80, 280); g.font = font(700, 54); g.fillStyle = "#ffd88a"; g.fillText(kind, 80, 360);
  const cov = d.best?.track?.cover || d.best?.artist?.picture;
  if (cov) await new Promise(ok => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => { try { g.save(); g.shadowColor = "rgba(0,0,0,.5)"; g.shadowBlur = 40; g.drawImage(im, 80, 440, 560, 560); g.restore(); } catch (e) {} ok(); }; im.onerror = ok; im.src = cov; setTimeout(ok, 4000); });
  g.fillStyle = "#fff"; g.font = font(600, 34); g.fillText("Ma plus belle carte", 680, 480);
  g.font = font(900, 46); const tt = (d.best?.track?.title || d.best?.artist?.name || "").slice(0, 22); g.fillText(tt, 680, 540);
  g.font = font(500, 34); g.fillStyle = "rgba(255,255,255,.75)"; g.fillText((d.best?.track?.artist || "").slice(0, 26), 680, 590);
  lines.forEach(([a, b], i) => { const y = 1140 + i * 110; g.fillStyle = "rgba(255,255,255,.7)"; g.font = font(500, 40); g.fillText(a, 80, y);
    g.fillStyle = "#fff"; g.font = font(900, 58); g.textAlign = "right"; g.fillText(String(b).slice(0, 18), W - 80, y); g.textAlign = "left"; });
  g.fillStyle = "rgba(255,255,255,.8)"; g.font = font(600, 36); g.fillText(`Et toi, c'est quoi ton année ? ${location.host}`.slice(0, 52), 80, H - 90);
  let blob = null; try { blob = await new Promise(r => cv.toBlob(r, "image/png")); } catch (e) {}
  if (!blob) return toast("Impossible de créer l'image.");
  const file = new File([blob], "zikhunter-wrapped-2026.png", { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: "Mon année Zik Hunter" }); return; } catch (e) { if (e?.name === "AbortError") return; } }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast("Image enregistrée : partage-la où tu veux !");
}

// the banner on the boosters page from 1 December, and the Wrapped opens by itself the first time
function wrappedBanner() {
  const shop = $("#view-shop"); if (!shop || !me || !Online.active || !wrOpen()) { $("#wrBanner")?.remove(); return; }
  if (!$("#wrBanner")) {
    shop.insertAdjacentHTML("afterbegin", `<button class="wr-banner" id="wrBanner"><span class="wr-bd" aria-hidden="true"></span><span><b>Ton Wrapped 2026 est prêt</b><small>Ton année sur Zik Hunter en quelques écrans</small></span><em>Voir ▶</em></button>`);
    $("#wrBanner").onclick = () => wrappedOpen();
  }
  let seen = true; try { seen = !!localStorage.getItem(WR.KEY); } catch (e) {}
  if (!seen && Date.now() >= WR.OPEN && !WR.auto && views.shop && !views.shop.hidden && document.body.classList.contains("op-on") === false) { WR.auto = true; setTimeout(() => wrappedOpen(), 1200); }
}
setInterval(wrappedBanner, 4000);
window.wrappedOpen = wrappedOpen;
