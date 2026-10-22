"use strict";
/* Zik Hunter — tells the player when a new version of the game is online, with what changed. The page knows its own
   version (meta zh-version); version.json on the site says the newest one. When they differ, a card shows the notes
   and "Mettre à jour" reloads through a fresh address, so no cache serves the old page again.
   On each release: bump "id" and write the notes in version.json, and put the same id in index.html (meta zh-version). */
const UPD = { mine: document.querySelector('meta[name="zh-version"]')?.content || "", later: 0, shown: null };
async function updateCheck() {
  if (document.hidden || Date.now() < UPD.later) return;
  let v; try { v = await (await fetch("version.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (e) { return; }
  if (!v?.id || v.id === UPD.mine || UPD.shown === v.id) return;
  if (document.body.classList.contains("fx-on") || document.querySelector(".op:not([hidden])")) return;   // not during a film or a booster
  updateCard(v);
}
function updateCard(v) {
  UPD.shown = v.id;
  document.getElementById("updCard")?.remove();
  const el = document.createElement("aside"); el.id = "updCard"; el.className = "upd"; el.setAttribute("role", "status"); el.setAttribute("aria-labelledby", "updT");
  el.innerHTML = `<div class="upd-ico" aria-hidden="true">✨</div>
    <div class="upd-body"><p class="upd-kick">Nouvelle version</p><h3 id="updT">${esc(v.title || "Le jeu a été mis à jour")}</h3>
      ${(v.notes || []).length ? `<ul>${v.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
      <div class="upd-row"><button class="btn primary" type="button" data-u="go">Mettre à jour</button><button class="btn" type="button" data-u="later">Plus tard</button></div></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("on"));
  el.querySelector('[data-u="go"]').onclick = () => { const u = new URL(location.href); u.searchParams.set("maj", v.id); location.replace(u.toString()); };
  el.querySelector('[data-u="later"]').onclick = () => { UPD.later = Date.now() + 30 * 60000; UPD.shown = null; el.classList.remove("on"); setTimeout(() => el.remove(), 300); };
}
// back from an update: the address is cleaned, and the player is told it worked
(() => {
  const u = new URL(location.href);
  if (!u.searchParams.has("maj")) return;
  u.searchParams.delete("maj"); history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
  setTimeout(() => typeof toast === "function" && toast("✨ Jeu mis à jour : bonne chasse !"), 1500);
})();
setTimeout(updateCheck, 20000);
setInterval(updateCheck, 5 * 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) updateCheck(); });
