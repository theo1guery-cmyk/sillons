/* ---------- Zik Hunter v3: my radio, Collection and Catalogue redesign ----------
   Built on top of app.js / online.js / v2.js globals (S, owned, TYPES, RAR, RCOL, dz, catCell, openModal, Online, TAGS). */
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const LEG = RAR.length - 1;

  /* =================== MY RADIO =================== */
  const KEY = "zh-radio";
  const R = { audio: new Audio(), queue: [], i: -1, on: false, interrupted: false, f: { g: [], r: [], tag: [] }, fading: null };
  R.audio.preload = "auto";
  try { Object.assign(R.f, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) {}
  const saveF = () => { try { localStorage.setItem(KEY, JSON.stringify(R.f)); } catch (e) {} };
  const isArt = c => c.kind === "artist";
  const matches = c => (!R.f.g.length || (!isArt(c) && R.f.g.includes(c.g)) || (isArt(c) && R.f.g.includes(-2)))
    && (!R.f.r.length || R.f.r.includes(c.tier))
    && (!R.f.tag.length || (Online.tagsOf?.(c) || []).some(t => R.f.tag.includes(t.id)));
  const pool = () => owned().filter(matches);
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  async function preview(c) {
    try {
      const t = isArt(c) ? ((await dz(`artist/${c.aid}/top`, { limit: 1 }, true)).data || [])[0] : await dz("track/" + c.id, {}, true);
      return t?.preview || null;
    } catch (e) { return null; }
  }
  function label() {
    const parts = [];
    if (R.f.g.length) parts.push(R.f.g.map(g => g === -2 ? "Artistes" : TYPES[g].n).join(", "));
    if (R.f.r.length) parts.push(R.f.r.map(r => RAR[r]).join(", "));
    if (R.f.tag.length) parts.push(R.f.tag.map(id => TAGS.find(t => t.id === id)?.name).filter(Boolean).join(", "));
    return parts.length ? parts.join(" · ") : "Toute ta collection";
  }
  async function playAt(i, tries = 0) {
    if (!R.queue.length) return;
    if (i >= R.queue.length) { R.queue = shuffle(R.queue); i = 0; }   // everything played: a new shuffle
    if (i < 0) i = R.queue.length - 1;
    R.i = i;
    const c = R.queue[i], url = await preview(c);
    if (!R.on || R.queue[R.i] !== c) return;
    if (!url) return tries < 5 ? playAt(i + 1, tries + 1) : toast("La radio ne trouve pas d'extraits pour cette sélection.");
    R.audio.src = url; R.audio.volume = 1; R.interrupted = false;
    try { await R.audio.play(); } catch (e) {}
    window.NowPlaying(c, R.audio);
  }
  R.audio.addEventListener("ended", () => { if (R.on && !R.interrupted) playAt(R.i + 1); });
  const Radio = window.Radio = {
    start(f) {
      if (f) { R.f = { g: [], r: [], tag: [], ...f }; saveF(); }
      const list = pool();
      if (!list.length) return toast("Aucune carte de ta collection ne correspond à cette sélection.");
      R.queue = shuffle(list); R.on = true; R.interrupted = false;
      document.body.classList.add("radio-on");
      playAt(0);
      closePanel();
    },
    // another sound starts: the radio fades out and waits for you to press play again
    interrupt() {
      if (!R.on || R.audio.paused) return;
      R.interrupted = true;
      const a = R.audio; clearInterval(R.fading);
      R.fading = setInterval(() => { a.volume = Math.max(0, a.volume - .1); if (a.volume <= .02) { clearInterval(R.fading); a.pause(); a.volume = 1; } }, 40);
      syncResume();
    },
    resume() {
      R.interrupted = false; syncResume();
      const c = R.queue[R.i]; if (!c) return;
      window.NowPlaying(c, R.audio);
      R.audio.volume = 1; R.audio.play().catch(() => {});
    },
    next() { if (R.on) playAt(R.i + 1); },
    prev() { if (R.on) playAt(R.audio.currentTime > 3 ? R.i : R.i - 1); },
    stop() { R.on = false; R.interrupted = false; R.audio.pause(); document.body.classList.remove("radio-on"); syncResume(); },
  };
  // every other sound goes through NowPlaying: it interrupts the radio
  const show = window.NowPlaying;
  window.NowPlaying = (c, a) => {
    if (a !== R.audio) Radio.interrupt();
    show(c, a);
    $("#v2Player").classList.toggle("radio", a === R.audio && R.on);
    $("#v2Player .rl").textContent = "Radio · " + label();
  };
  // the mini player gets previous / next and a radio label; a pill brings the radio back after an interruption
  const bar = $("#v2Player");
  bar.querySelector(".pp").insertAdjacentHTML("beforebegin", `<button class="pv" aria-label="Morceau précédent">⏮</button>`);
  bar.querySelector(".pp").insertAdjacentHTML("afterend", `<button class="nx" aria-label="Morceau suivant">⏭</button>`);
  bar.insertAdjacentHTML("afterbegin", `<span class="rl"></span>`);
  bar.querySelector(".pv").onclick = Radio.prev; bar.querySelector(".nx").onclick = Radio.next;
  bar.querySelector(".x").addEventListener("click", Radio.stop);
  const pill = document.createElement("button"); pill.id = "radioResume"; pill.hidden = true;
  pill.innerHTML = `<span>▶</span> Reprendre la radio`; pill.onclick = Radio.resume;
  document.body.appendChild(pill);
  function syncResume() { pill.hidden = !(R.on && R.interrupted); }
  // the Clash blind test plays its own extracts: the radio must stop there too
  window.addEventListener("zh:sound", Radio.interrupt);

  // the panel: genres, rarities, tags
  const panel = document.createElement("div"); panel.id = "radioPanel"; panel.hidden = true;
  panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Ma radio");
  document.body.appendChild(panel);
  function chips(kind, items) {
    return items.map(([v, n, col]) => `<button class="rchip" data-k="${kind}" data-v="${v}" aria-pressed="${R.f[kind].includes(v)}">${col ? `<i style="background:${col}"></i>` : ""}${esc(n)}</button>`).join("");
  }
  function renderPanel() {
    const all = owned(), gs = TYPES.map((t, g) => [g, t.n]).filter(([g]) => all.some(c => !isArt(c) && c.g === g));
    if (all.some(isArt)) gs.unshift([-2, "Artistes"]);
    const tags = (typeof TAGS !== "undefined" && Online.active) ? TAGS.map(t => [t.id, t.name, t.color]) : [];
    const n = pool().length;
    panel.innerHTML = `<div class="rp-head"><b>Ma radio</b><button class="rp-x" aria-label="Fermer">✕</button></div>
      <p class="rp-sub">Les extraits de ta collection, à la suite et dans le désordre. Elle se met en pause dès qu'un autre son démarre.</p>
      <h4>Genres</h4><div class="rp-row">${chips("g", gs)}</div>
      <h4>Raretés</h4><div class="rp-row">${chips("r", RAR.map((r, i) => [i, r, RCOL[i]]))}</div>
      ${tags.length ? `<h4>Étiquettes</h4><div class="rp-row">${chips("tag", tags)}</div>` : Online.active ? "" : `<p class="rp-note">Les étiquettes sont disponibles avec un compte.</p>`}
      <div class="rp-foot"><span>${n ? `${n} morceau${n > 1 ? "x" : ""}` : "Aucun morceau"}</span>
      <button class="rp-clear linkish">Tout effacer</button>
      <button class="btn primary rp-go"${n ? "" : " disabled"}>${R.on ? "Relancer la radio" : "Lancer la radio"}</button></div>`;
    panel.querySelectorAll(".rchip").forEach(b => b.onclick = () => {
      const k = b.dataset.k, v = k === "tag" ? b.dataset.v : +b.dataset.v, arr = R.f[k];
      arr.includes(v) ? arr.splice(arr.indexOf(v), 1) : arr.push(v);
      saveF(); renderPanel();
    });
    panel.querySelector(".rp-x").onclick = closePanel;
    panel.querySelector(".rp-clear").onclick = () => { R.f = { g: [], r: [], tag: [] }; saveF(); renderPanel(); };
    panel.querySelector(".rp-go").onclick = () => Radio.start();
  }
  function openPanel() { renderPanel(); panel.hidden = false; document.body.classList.add("rp-open"); panel.querySelector(".rp-go")?.focus(); }
  function closePanel() { panel.hidden = true; document.body.classList.remove("rp-open"); }
  addEventListener("keydown", e => { if (e.key === "Escape" && !panel.hidden) closePanel(); });
  // a click outside closes it (a chip re-drawn by its own click is no longer in the page: that one is inside)
  document.addEventListener("click", e => { if (!panel.hidden && e.target.isConnected && !panel.contains(e.target) && !e.target.closest("#tab-radio,.v3-listen")) closePanel(); });
  // menu entry, under Collection
  const radioTab = document.createElement("button");
  radioTab.id = "tab-radio"; radioTab.type = "button";
  radioTab.innerHTML = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M7 8 17 3"/><circle cx="8.5" cy="14" r="2.5"/><path d="M15 12h3M15 15h3"/></svg><span class="lbl">Radio</span>`;
  radioTab.onclick = () => panel.hidden ? openPanel() : closePanel();
  ($("#tab-catalog") || $("#tab-binder")).after(radioTab);

  /* =================== COLLECTION =================== */
  const binder = $("#view-binder");
  const vitrine = document.createElement("div"); vitrine.className = "v3-vitrine";
  binder.querySelector("h2").after(vitrine);
  const tools = document.createElement("div"); tools.className = "v3-tools";
  const search = binder.querySelector("form.search");
  search.before(tools); tools.append(search, $("#filters"));
  const listen = document.createElement("button"); listen.className = "btn v3-listen"; listen.type = "button";
  listen.innerHTML = "▶ Écouter cette sélection";
  listen.onclick = () => Radio.start({ g: F.g === -1 ? [] : [F.g], r: F.r < 0 ? [] : [F.r], tag: F.tag ? [F.tag] : [] });
  tools.appendChild(listen);
  /* the showcase: your 5 best cards by default, or the ones you pick (kept per player in this browser) */
  const V = { edit: false };
  const vKey = () => "zh-vitrine-" + (Online.active && me ? me.id : "invite");
  const picked = () => { try { return JSON.parse(localStorage.getItem(vKey())) || null; } catch (e) { return null; } };
  const setPicked = ids => { try { ids ? localStorage.setItem(vKey(), JSON.stringify(ids)) : localStorage.removeItem(vKey()); } catch (e) {} };
  const best5 = () => owned().slice().sort((a, b) => b.tier - a.tier || b.rank - a.rank).slice(0, 5);
  function showcase() {
    const ids = picked();
    if (!ids) return best5();
    return ids.map(id => S.c[id] || bestOwned(String(id).split("#")[0])).filter(Boolean);   // older picks were track ids
  }
  const vbar = document.createElement("div"); vbar.className = "v3-vbar";
  vitrine.after(vbar);
  function renderVbar() {
    const n = picked()?.length ?? 0;
    vbar.innerHTML = V.edit
      ? `<span>${n ? `Ta vitrine : ${n} / 5. Touche une carte de ta collection pour l'ajouter ou la retirer.` : "Touche jusqu'à 5 cartes de ta collection pour les mettre en vitrine."}</span>
         <button class="linkish" id="vDefault">Remettre par défaut</button><button class="btn primary" id="vDone">Terminé</button>`
      : `<button class="btn v3-vedit" id="vEdit">Modifier ma vitrine</button>`;
    if (V.edit) {
      $("#vDone").onclick = () => { V.edit = false; binder.classList.remove("v3-editing"); renderVbar(); };
      $("#vDefault").onclick = () => { setPicked(null); drawVitrine(); markCells(); renderVbar(); };
    } else $("#vEdit").onclick = () => {
      V.edit = true; binder.classList.add("v3-editing");
      if (!picked()) setPicked(best5().map(ck));                    // start from what is shown
      drawVitrine(); markCells(); renderVbar();
    };
  }
  function toggle(c) {
    let ids = picked() || [];
    if (ids.includes(ck(c))) ids = ids.filter(id => id !== ck(c));
    else if (ids.length >= 5) return toast("Ta vitrine est pleine : retire d'abord une carte (5 maximum).");
    else ids.push(ck(c));
    setPicked(ids); drawVitrine(); markCells(); renderVbar();
  }
  function drawVitrine() {
    const list = showcase();
    vitrine.innerHTML = "";
    vitrine.hidden = !list.length && !V.edit;
    list.forEach((c, k) => {
      const b = document.createElement("button"); b.className = "v3-v"; b.style.setProperty("--k", k - (list.length - 1) / 2);
      b.setAttribute("aria-label", c.t + " de " + c.a + (V.edit ? ", retirer de la vitrine" : ""));
      b.appendChild(cardEl(c, c.holo > 0));
      b.onclick = () => V.edit ? toggle(c) : openModal(c, c.holo > 0);
      vitrine.appendChild(b);
    });
    if (V.edit && !list.length) vitrine.innerHTML = `<p class="v3-vempty">Ta vitrine est vide</p>`;
    if (list[0]?.cov && !binder.hidden) window.V2?.ambient?.(list[0].cov);
  }
  // in edit mode a click on a card of the grid puts it in (or takes it out of) the showcase
  function markCells() {
    const ids = new Set(picked() || []);
    [...$("#binder").children].forEach((cell, i) => { const c = BIND.list[i]; if (c) cell.classList.toggle("in-vitrine", ids.has(ck(c))); });
  }
  $("#binder").addEventListener("click", e => {
    if (!V.edit) return;
    const cell = e.target.closest(".cell"); if (!cell) return;
    e.stopImmediatePropagation(); e.preventDefault();
    const c = BIND.list[[...$("#binder").children].indexOf(cell)]; if (c) toggle(c);
  }, true);
  new MutationObserver(() => V.edit && markCells()).observe($("#binder"), { childList: true });
  function decorateBinder() {
    drawVitrine(); renderVbar(); if (V.edit) markCells();
    // the genre strip becomes small rings
    $("#prog").querySelectorAll("button").forEach(b => {
      const w = parseFloat(b.querySelector(".meter s")?.style.width) || 0;
      b.style.setProperty("--p", w + "%");
    });
  }
  const baseRender = window.renderBinder;
  window.renderBinder = function () { baseRender.apply(this, arguments); decorateBinder(); };

  /* =================== CATALOGUE =================== */
  const cat = $("#view-catalog");
  const rows = document.createElement("div"); rows.className = "v3-rows";
  $("#catFilters").before(rows);
  const ROWS = [{ n: "Les tubes du moment", gid: 0, hero: true }].concat(TYPES.filter(t => t.g.length).map(t => ({ n: t.n, gid: t.g[0] })));
  let rowsBuilt = false;
  async function buildRows() {
    rowsBuilt = true;
    rows.innerHTML = ROWS.map((r, i) => `<section class="v3-row${r.hero ? " hero" : ""}" data-i="${i}"><div class="v3-rh"><h3>${esc(r.n)}</h3><span class="v3-arrows"><button class="v3-ar" data-d="-1" aria-label="Défiler vers la gauche">‹</button><button class="v3-ar" data-d="1" aria-label="Défiler vers la droite">›</button></span></div><div class="v3-strip" aria-label="${esc(r.n)}"><div class="v3-skel"></div><div class="v3-skel"></div><div class="v3-skel"></div><div class="v3-skel"></div><div class="v3-skel"></div><div class="v3-skel"></div></div></section>`).join("");
    rows.querySelectorAll(".v3-ar").forEach(b => b.onclick = () => {
      const strip = b.closest(".v3-row").querySelector(".v3-strip");
      strip.scrollBy({ left: +b.dataset.d * strip.clientWidth, behavior: "smooth" });
    });
    for (const [i, r] of ROWS.entries()) {
      const sec = rows.querySelector(`[data-i="${i}"] .v3-strip`);
      try {
        const d = await dz(`chart/${r.gid}/tracks`, { limit: r.hero ? 20 : 16 }, true);
        const list = (d.data || []).filter(t => t.album);
        sec.innerHTML = "";
        for (const t of list) sec.appendChild(catCell(t));
        if (!list.length) sec.closest(".v3-row").remove();
      } catch (e) { sec.closest(".v3-row").remove(); }
    }
  }
  function syncCatalog() {
    const browsing = !CAT.q && CAT.mode !== "artists";   // the artists are a plain grid
    cat.classList.toggle("v3-browse", browsing);
    if (browsing && !rowsBuilt && !cat.hidden) buildRows();
  }
  const baseCat = window.renderCatalog;
  window.renderCatalog = function () { baseCat.apply(this, arguments); syncCatalog(); };
  new MutationObserver(syncCatalog).observe(cat, { attributes: true, attributeFilter: ["hidden"] });
  syncCatalog();
})();
