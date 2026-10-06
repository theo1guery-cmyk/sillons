/* ---------- Zik Hunter v2 look ----------
   Colour from the covers behind the page, a living booster stage, a mini player. Uses app.js globals (S, isArtist). */
(() => {
  const $ = s => document.querySelector(s);
  const big = src => src && src.replace(/\/\d+x\d+-/, "/250x250-");

  /* colour from the covers: two blurred artworks behind the page, cross-fading */
  const amb = document.createElement("div"); amb.id = "v2Amb"; amb.innerHTML = "<i></i><i></i>";
  document.body.prepend(amb);
  let layer = 0, lastAmb = "";
  function ambient(src) {
    src = big(src); if (!src || src === lastAmb) return; lastAmb = src;
    const img = new Image();
    img.onload = () => {
      const next = amb.children[layer ^= 1], prev = amb.children[layer ^ 1];
      next.style.backgroundImage = `url("${src}")`; next.classList.add("on"); prev.classList.remove("on");
    };
    img.src = src;
  }
  const owned = () => { try { return Object.values(S.c || {}).filter(c => c.cov && !isArtist(c)); } catch { return []; } };
  const recent = () => owned().sort((a, b) => (b.at || 0) - (a.at || 0) || b.tier - a.tier);

  /* booster page: "?" instead of the paragraph, the covers wall behind a big booster that follows the pointer */
  const shop = $("#view-shop"), h2 = shop.querySelector("h2");
  const help = document.createElement("button"); help.className = "v2-help"; help.textContent = "?";
  help.setAttribute("aria-label", "Comment ça marche et chances par carte");
  help.onclick = () => shop.classList.toggle("v2-open");
  h2.appendChild(help);

  const shelf = $("#shelf"), wall = document.createElement("div"); wall.className = "v2-wall"; wall.setAttribute("aria-hidden", "true");
  shelf.prepend(wall);
  function fillWall() {
    let list = recent().slice(0, 36).map(c => big(c.cov));
    if (list.length < 6) { wall.innerHTML = ""; return; }
    while (list.length < 24) list = list.concat(list);
    const rows = [0, 1, 2].map(r => list.filter((_, i) => i % 3 === r));
    wall.innerHTML = rows.map(r => `<div class="row">${r.concat(r).map(s => `<img src="${s}" alt="" loading="lazy">`).join("")}</div>`).join("");
  }
  const stage = shelf.querySelector(".pack-stage"), pack = stage?.querySelector(".pack");
  stage?.addEventListener("pointermove", e => {
    const r = pack.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    pack.style.setProperty("--ry", ((x - .5) * 18).toFixed(1) + "deg"); pack.style.setProperty("--rx", ((.5 - y) * 14).toFixed(1) + "deg");
    pack.style.setProperty("--gx", (x * 100).toFixed(0) + "%"); pack.style.setProperty("--gy", (y * 100).toFixed(0) + "%");
  });
  stage?.addEventListener("pointerleave", () => { pack.style.setProperty("--ry", "0deg"); pack.style.setProperty("--rx", "0deg"); });

  /* mini player: whatever plays (card details, hit reveal) shows here and keeps playing between pages */
  const bar = document.createElement("div"); bar.id = "v2Player"; bar.hidden = true;
  bar.innerHTML = `<img alt=""><div class="t"><b></b><span></span></div><div class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <button class="pp" aria-label="Pause">❚❚</button><button class="x" aria-label="Fermer le lecteur">✕</button><div class="bar"><s></s></div>`;
  document.body.appendChild(bar);
  let el = null;
  const sync = () => {
    const on = el && !el.paused;
    bar.classList.toggle("playing", !!on);
    bar.querySelector(".pp").textContent = on ? "❚❚" : "▶";
    bar.querySelector(".pp").setAttribute("aria-label", on ? "Pause" : "Lecture");
  };
  const tick = () => { if (el && el.duration) bar.querySelector(".bar s").style.width = (el.currentTime / el.duration * 100) + "%"; };
  window.NowPlaying = (c, audio) => {
    if (el !== audio) {
      el?.removeEventListener("play", sync); el?.removeEventListener("pause", sync); el?.removeEventListener("timeupdate", tick);
      el = audio; el.addEventListener("play", sync); el.addEventListener("pause", sync); el.addEventListener("timeupdate", tick);
    }
    bar.querySelector("img").src = big(c.cov) || "brand/zikhunter-icon.svg";
    bar.querySelector("b").textContent = c.t; bar.querySelector(".t span").textContent = isArtist(c) ? "Artiste" : c.a;
    bar.style.setProperty("--pc", getComputedStyle(document.documentElement).getPropertyValue(["--r0", "--r1", "--r2", "--r3", "--r4", "--r5"][c.tier] || "--r5"));
    bar.hidden = false; sync(); ambient(c.cov);
  };
  bar.querySelector(".pp").onclick = () => { if (!el) return; el.paused ? el.play().catch(() => {}) : el.pause(); };
  bar.querySelector(".x").onclick = () => { el?.pause(); bar.hidden = true; };

  /* after an opening: the page takes the colour of the best card, the wall gets the new covers */
  window.V2 = {
    ambient,
    pulls(pulls) {
      const best = pulls.filter(p => p.c.cov).sort((a, b) => b.c.tier - a.c.tier)[0];
      if (best) ambient(best.c.cov);
      setTimeout(fillWall, 400);
    },
  };

  fillWall();
  ambient(recent().sort((a, b) => b.tier - a.tier)[0]?.cov);
})();
