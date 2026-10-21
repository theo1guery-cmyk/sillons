"use strict";
/* Zik Hunter — the "grand ménage": for the accounts the admin chose, the player picks the cards to keep and every
   other card is deleted for good (the server does it in steps, and graded cards leave no trace). */
const RS = { keep: new Set(), q: "", r: -1, only: "", shown: 120 };
async function resetCheck() {
  let st = null; try { st = await rpc("collection_reset_state"); } catch (e) { return; }
  if (!st) return;
  if (st.started) return resetRun();                      // interrupted in the middle: it goes on
  resetIntro();
}
function rsScreen() {
  let el = $("#rsScreen");
  if (!el) { el = document.createElement("div"); el.id = "rsScreen"; el.className = "rs"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); document.body.appendChild(el); }
  return el;
}
function resetIntro() {
  const el = rsScreen(), n = Object.values(S.c).reduce((a, c) => a + (c.copies?.length || 0), 0);
  el.innerHTML = `<div class="rs-box rs-intro">
    <p class="rs-kick">Grand ménage</p><h2>Ta collection repart (presque) de zéro</h2>
    <p>Tu as <b>${fmt(n)} cartes</b>. Choisis celles que tu veux garder : <b>toutes les autres seront supprimées pour toujours</b>.</p>
    <ul><li>Pour chaque carte choisie, on garde <b>un exemplaire</b> : la version gradée ou Shiny en priorité.</li>
      <li>Les cartes gradées supprimées disparaissent de la numérotation, comme si elles n'avaient jamais existé (les #001 se libèrent).</li>
      <li>Les albums et discographies qui ne sont plus complets pourront être complétés et récupérés à nouveau.</li>
      <li>Tes Streams, Vinyles, ton pass et tes succès ne bougent pas.</li></ul>
    <div class="rs-row"><button class="btn primary" id="rsGo">Choisir mes cartes</button><button class="btn" id="rsLater">Plus tard</button></div></div>`;
  $("#rsGo").onclick = resetPick;
  $("#rsLater").onclick = () => { el.remove(); toast("Le grand ménage t'attend : il revient à ta prochaine connexion."); };
}
const bestCopy = c => [...(c.copies || [])].sort((a, b) => (b.grade || 0) - (a.grade || 0) || (a.pop || 1e9) - (b.pop || 1e9) || (b.holo ? 1 : 0) - (a.holo ? 1 : 0) || (b.collector ? 1 : 0) - (a.collector ? 1 : 0))[0];
function rsList() {
  const q = RS.q.trim().toLowerCase();
  return Object.entries(S.c).filter(([, c]) => (c.copies || []).length
      && (RS.r < 0 || c.tier === RS.r)
      && (!RS.only || (RS.only === "kept" ? RS.keep.has(ck(c)) : RS.only === "graded" ? c.copies.some(cp => cp.grade) : RS.only === "shiny" ? c.copies.some(cp => cp.holo) : true))
      && (!q || (c.t + " " + c.a).toLowerCase().includes(q)))
    .sort((a, b) => b[1].tier - a[1].tier || b[1].rank - a[1].rank);
}
function resetPick() {
  const el = rsScreen();
  el.innerHTML = `<div class="rs-pick">
    <header class="rs-head"><div><p class="rs-kick">Grand ménage</p><h2>Choisis les cartes à garder</h2></div>
      <input type="search" id="rsQ" placeholder="Chercher un titre ou un artiste" value="${esc(RS.q)}" aria-label="Chercher"></header>
    <div class="rs-tools">
      <div class="rs-chips">${[-1, ...RAR.keys()].map(r => `<button class="chip" data-r="${r}" aria-pressed="${RS.r === r}">${r < 0 ? "Toutes" : `<i style="background:${RCOL[r]}"></i>${RAR[r]}`}</button>`).join("")}
        ${[["graded", "Gradées"], ["shiny", "Shiny"], ["kept", "Mes cartes gardées"]].map(([k, t]) => `<button class="chip" data-only="${k}" aria-pressed="${RS.only === k}">${t}</button>`).join("")}</div>
      <div class="rs-quick"><span>Tout garder :</span><button class="ps-link" data-all="5">Légendaires</button><button class="ps-link" data-all="4">Mythiques</button>
        <button class="ps-link" data-all="graded">Gradées</button><button class="ps-link" data-all="shiny">Shiny</button><button class="ps-link" data-all="none">Tout décocher</button></div>
    </div>
    <div class="rs-grid" id="rsGrid"></div>
    <footer class="rs-bar"><p id="rsCount"></p><button class="btn" id="rsBack">Plus tard</button><button class="btn danger solid" id="rsDo">Lancer le grand ménage</button></footer></div>`;
  const q = $("#rsQ");
  q.oninput = () => { clearTimeout(q._t); q._t = setTimeout(() => { RS.q = q.value; RS.shown = 120; rsGrid(); }, 200); };
  el.querySelectorAll("[data-r]").forEach(b => b.onclick = () => { RS.r = +b.dataset.r; RS.shown = 120; resetPick(); });
  el.querySelectorAll("[data-only]").forEach(b => b.onclick = () => { RS.only = RS.only === b.dataset.only ? "" : b.dataset.only; RS.shown = 120; resetPick(); });
  el.querySelectorAll("[data-all]").forEach(b => b.onclick = () => {
    const a = b.dataset.all;
    if (a === "none") RS.keep.clear();
    else for (const [k, c] of Object.entries(S.c)) if ((c.copies || []).length && (a === "graded" ? c.copies.some(cp => cp.grade) : a === "shiny" ? c.copies.some(cp => cp.holo) : c.tier === +a)) RS.keep.add(k);
    rsGrid();
  });
  $("#rsBack").onclick = () => { el.remove(); toast("Le grand ménage t'attend : il revient à ta prochaine connexion."); };
  $("#rsDo").onclick = resetConfirm;
  rsGrid();
}
function rsGrid() {
  const g = $("#rsGrid"); if (!g) return;
  const list = rsList();
  g.innerHTML = list.length ? "" : `<p class="empty-line">Aucune carte ici.</p>`;
  for (const [k, c] of list.slice(0, RS.shown)) {
    const b = document.createElement("button"); b.className = "rs-card" + (RS.keep.has(k) ? " on" : "");
    const best = bestCopy(c);
    b.appendChild(cardEl(c, !!best?.holo && c.tier >= MYTH));
    b.insertAdjacentHTML("beforeend", `<span class="rs-check" aria-hidden="true">✓</span>${c.copies.length > 1 ? `<span class="rs-n">×${c.copies.length}</span>` : ""}${best?.grade ? `<span class="rs-g">${best.grade} · #${String(best.pop).padStart(3, "0")}</span>` : ""}`);
    b.setAttribute("aria-pressed", RS.keep.has(k));
    b.onclick = () => { RS.keep.has(k) ? RS.keep.delete(k) : RS.keep.add(k); b.classList.toggle("on"); b.setAttribute("aria-pressed", RS.keep.has(k)); rsCount(); };
    g.appendChild(b);
  }
  if (list.length > RS.shown) { const m = document.createElement("button"); m.className = "btn rs-more"; m.textContent = `Afficher plus (${fmt(list.length - RS.shown)} autres)`; m.onclick = () => { RS.shown += 240; rsGrid(); }; g.appendChild(m); }
  rsCount();
}
function rsCount() {
  const total = Object.values(S.c).reduce((a, c) => a + (c.copies?.length || 0), 0), kept = [...RS.keep].filter(k => S.c[k]).length;
  const el = $("#rsCount"); if (el) el.innerHTML = `<b>${fmt(kept)}</b> carte${kept > 1 ? "s" : ""} gardée${kept > 1 ? "s" : ""} · <span>${fmt(total - kept)} seront supprimées</span>`;
}
function resetConfirm() {
  const kept = [...RS.keep].filter(k => S.c[k]), total = Object.values(S.c).reduce((a, c) => a + (c.copies?.length || 0), 0);
  if (!confirm(`Tu gardes ${fmt(kept.length)} carte${kept.length > 1 ? "s" : ""}.\n\nLes ${fmt(total - kept.length)} autres seront supprimées POUR TOUJOURS, gradées comprises. Ce n'est pas annulable.\n\nLancer le grand ménage ?`)) return;
  resetRun(kept.map(k => bestCopy(S.c[k]).id));
}
async function resetRun(ids) {
  const el = rsScreen();
  el.innerHTML = `<div class="rs-box rs-run"><p class="rs-kick">Grand ménage</p><h2>On range ta collection…</h2>
    <div class="meter"><s id="rsBar" style="width:0%"></s></div><p id="rsLeft">Préparation…</p><p class="rs-note">Ne ferme pas la page.</p></div>`;
  let left, total;
  try { const r = await rpc("collection_reset_start", { p_keep: ids || [] }); left = total = r.left; }
  catch (e) { el.remove(); return toast(message(e)); }
  for (let tries = 0; ;) {
    $("#rsBar").style.width = total ? Math.round(100 * (total - left) / total) + "%" : "100%";
    $("#rsLeft").textContent = `${fmt(total - left)} / ${fmt(total)} cartes supprimées`;
    let r;
    try { r = await rpc("collection_reset_step"); tries = 0; }
    catch (e) { if (++tries > 4) { $("#rsLeft").textContent = "Le serveur est lent : recharge la page pour continuer, rien n'est perdu."; return; } await new Promise(k => setTimeout(k, 2000)); continue; }
    left = r.left;
    if (r.done) break;
  }
  $("#rsBar").style.width = "100%";
  el.querySelector(".rs-run").innerHTML = `<p class="rs-kick">Grand ménage</p><h2>C'est fait ✨</h2><p>Ta collection est toute propre. La page va se recharger.</p>`;
  setTimeout(() => location.reload(), 2200);
}
Object.assign(Online, { resetCheck });
