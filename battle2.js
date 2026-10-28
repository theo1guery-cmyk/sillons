"use strict";
/* Zik Hunter — la Bataille 2.0, in simulation for the admins only: a deck with a budget, three families of genres,
   combos, a fixed skill on every Mythique and Légendaire (one fired per battle), 3 Hype tokens to bet, and the plan
   my deck defends with. Nothing counts: no trophies, and the other side never hears of it. */
const B2 = { home: null, b: null, sel: null, bet: 0, sk: false, edit: null, busy: false };
const B2_COST = [1, 1, 2, 3, 4, 5];
const B2_FAM = [["🎤", "Street", "#ff8a3d"], ["💖", "Mainstream", "#ff5f9e"], ["🎸", "Live", "#59b8ff"]];
const B2_FAM_OF = { 0: 0, 7: 0, 8: 0, 1: 1, 4: 1, 5: 1, 2: 2, 3: 2, 6: 2, 9: 2 };
const B2_SKILLS = ["remix", "encore", "refrain", "feat", "larsen", "hymne", "jackpot"];
const B2_SK = {
  remix: ["🎛️", "Remix", "La stat de la manche est retirée au sort."],
  encore: ["🔁", "Encore", "Ta carte revient dans ta main après la manche."],
  refrain: ["🎵", "Refrain", "+12 si tu as perdu la manche d'avant."],
  feat: ["🎤", "Featuring", "+10 si un morceau du même artiste a déjà joué de ton côté."],
  larsen: ["📢", "Larsen", "−10 à la carte adverse."],
  hymne: ["🏟️", "Hymne", "+10 sur une balle de match."],
  jackpot: ["🪙", "Jackpot", "+1 jeton de Hype."],
};
const B2_PLAN = {
  aggro: ["⚡", "Agressif", "Les meilleures cartes d'abord, et ses jetons tôt."],
  patient: ["🧘", "Patient", "Garde ses grosses cartes et ses jetons pour la fin."],
  spec: ["🎯", "Spécialiste", "La meilleure carte pour chaque stat."],
  random: ["🎲", "Imprévisible", "Un ordre au hasard, impossible à lire."],
};
const b2Admin = () => typeof ADM !== "undefined" && ADM.admin;
// the same rules as the server, for a card of the collection
const b2Skill = (id, tier) => tier >= 4 ? B2_SKILLS[Math.abs(Number(id)) * 7919 % 7] : null;
const b2Fam = c => B2_FAM_OF[c.g] ?? null;
const b2Chips = j => `<div class="b2-chips"><span class="b2-cost" title="Coût">${j.cost}</span>${j.fam != null ? `<span class="b2-fam" style="--c:${B2_FAM[j.fam][2]}" title="${B2_FAM[j.fam][1]}">${B2_FAM[j.fam][0]}</span>` : ""}
  ${j.skill ? `<span class="b2-sk" title="${esc(B2_SK[j.skill][2])}">${B2_SK[j.skill][0]} ${B2_SK[j.skill][1]}</span>` : ""}${(j.combo || []).map(k => `<span class="b2-cb">${k === "album" ? "💿 Album +5" : "📅 Millésime +5"}</span>`).join("")}</div>`;

/* ---------------------------------------------------------------- the panel in the Bataille tab */
async function b2Panel(box) {
  if (!b2Admin()) return;
  const anchor = box.querySelector("#btLeagues"); if (!anchor) return;
  let sec = box.querySelector(".b2"); if (!sec) { sec = document.createElement("section"); sec.className = "b2"; anchor.after(sec); }
  sec.innerHTML = `<p class="empty-line">Chargement de la Bataille 2.0…</p>`;
  let h; try { h = B2.home = await rpc("battle2_home"); } catch (e) { sec.innerHTML = `<p class="empty-line">Bataille 2.0 : lance le SQL de la simulation pour l'activer.</p>`; return; }
  const pct = Math.min(100, Math.round(h.cost / h.budget * 100));
  sec.innerHTML = `<header class="b2-head"><div><p class="bt-k">Admins seulement · rien ne compte</p><h3>⚡ Bataille 2.0 · simulation</h3>
      <p class="b2-sub">Pas de trophées, et l'adversaire ne voit rien. Teste les nouvelles règles contre de vrais decks.</p></div>
      <button class="btn primary" id="b2Go">⚔️ Lancer une simulation</button></header>
    <div class="b2-budget"><span>💰 Budget du deck</span><i><s style="width:${pct}%"></s></i><b>${h.cost} / ${h.budget}</b><small>${h.league}</small></div>
    ${h.recomposed ? `<p class="b2-warn">Ton deck 2.0 dépassait le budget de ta ligue : il a été recomposé au mieux.</p>` : ""}
    <div class="b2-deck">${h.deck.map(j => `<div class="b2-dc">${btCardEl(j).outerHTML}${b2Chips(j)}</div>`).join("")}</div>
    <div class="b2-acts"><button class="ps-link" id="b2Edit">✎ Composer mon deck 2.0</button>${h.chosen ? `<button class="ps-link" id="b2Auto">Deck automatique</button>` : `<small>Deck automatique (le meilleur dans ton budget)</small>`}</div>
    <div id="b2Pick"></div>
    <div class="b2-plan"><p><b>🛡️ Mon plan de défense</b> : la façon dont ton deck se défend quand on l'attaque.</p>
      <div class="b2-plans">${Object.entries(B2_PLAN).map(([k, [i, n, d]]) => `<button type="button" data-plan="${k}" aria-pressed="${h.plan === k}"><span>${i}</span><b>${n}</b><small>${d}</small></button>`).join("")}</div></div>
    <details class="bt-rules b2-rules"><summary>Les règles de la 2.0</summary>
      <p><b>💰 Le budget</b> : chaque carte coûte selon sa rareté (Commune et Peu commune 1, Rare 2, Épique 3, Mythique 4, Légendaire 5). Ton budget dépend de ta ligue : 14 en Bronze, puis 15, 16, 17, et 18 en Diamant et Légende.</p>
      <p><b>🎸 Les familles</b> : 🎤 Street (rap, latino, afro) bat 💖 Mainstream (pop, soul, chanson), qui bat 🎸 Live (rock, électro, jazz, classique), qui bat Street. La carte qui a l'avantage prend +10.</p>
      <p><b>🔗 Les combos</b> : 2 morceaux du même album, +5 chacun. 3 morceaux de la même année, +5 chacun.</p>
      <p><b>✨ Les compétences</b> : chaque Mythique et Légendaire a la sienne. Tu n'en déclenches qu'une par bataille. ${Object.values(B2_SK).map(([i, n, d]) => `${i} <b>${n}</b> : ${d}`).join(" ")}</p>
      <p><b>⚡ Les jetons de Hype</b> : 3 par bataille. À chaque manche, mise-en 0, 1 ou 2 (+8 chacun). L'adversaire ne voit que ce qu'il te reste.</p></details>`;
  sec.querySelector("#b2Go").onclick = () => b2Start();
  sec.querySelector("#b2Edit").onclick = () => b2Pick();
  const auto = sec.querySelector("#b2Auto"); if (auto) auto.onclick = async () => { try { await rpc("set_battle_deck2", { p_cards: [], p_plan: null }); b2Panel(box); } catch (e) { toast(message(e)); } };
  sec.querySelectorAll("[data-plan]").forEach(b => b.onclick = async () => { try { await rpc("set_battle_deck2", { p_cards: null, p_plan: b.dataset.plan }); toast(`Plan de défense : ${B2_PLAN[b.dataset.plan][1]}`); b2Panel(box); } catch (e) { toast(message(e)); } });
}

// composing the deck within the budget
function b2Pick() {
  const box = $("#b2Pick"), h = B2.home, list = [];
  for (const c of Object.values(S.c)) { if (isArtist(c) || c.ed) continue; const cp = c.copies.find(x => x.grade) || c.copies.find(x => x.holo) || c.copies[0]; if (cp) list.push([c, cp]); }
  const gb = cp => (typeof BT_GRADE !== "undefined" ? BT_GRADE[cp.grade || 0] : 0) || 0;
  const val = ([c, cp]) => stats(c).pw + c.tier * 3 + gb(cp) + (cp.holo ? 4 : 0);
  list.sort((a, b) => val(b) - val(a));
  B2.edit ??= h.chosen ? h.deck.map(j => j.id) : [];
  const draw = () => {
    const picked = B2.edit.map(id => list.find(([, cp]) => cp.id === id)).filter(Boolean), spent = picked.reduce((t, [c]) => t + B2_COST[c.tier], 0), left = h.budget - spent;
    box.innerHTML = `<div class="pf-picker b2-picker"><p>5 morceaux différents, <b>${spent} / ${h.budget}</b> points utilisés. Il te reste <b>${left}</b> point${left > 1 ? "s" : ""} pour ${5 - picked.length} carte${5 - picked.length > 1 ? "s" : ""}.</p>
      <div class="pf-pacts"><button class="btn" id="b2Cancel">Annuler</button><button class="btn primary" id="b2Save"${picked.length === 5 ? "" : " disabled"}>Enregistrer</button></div>
      <div class="pf-grid" id="b2Grid"></div></div>`;
    const g = $("#b2Grid"), tracks = new Set(picked.map(([c]) => c.id));
    for (const [c, cp] of list.slice(0, 240)) {
      const k = B2.edit.indexOf(cp.id), cost = B2_COST[c.tier], fits = k >= 0 || (picked.length < 5 && cost + (4 - picked.length) <= left && !tracks.has(c.id));
      const w = document.createElement("button"); w.type = "button"; w.className = "pf-gc pick b2-pk" + (fits ? "" : " no");
      if (k >= 0) { w.classList.add("on"); w.dataset.k = k + 1; }
      w.appendChild(cardEl(c, cp.holo));
      w.insertAdjacentHTML("beforeend", b2Chips({ cost, fam: b2Fam(c), skill: b2Skill(c.id, c.tier) }));
      w.onclick = () => { const i = B2.edit.indexOf(cp.id);
        if (i >= 0) B2.edit.splice(i, 1); else if (!fits) return toast(tracks.has(c.id) ? "Ce morceau est déjà dans ton deck." : "Pas assez de budget pour cette carte.");
        else B2.edit.push(cp.id); draw(); };
      g.appendChild(w);
    }
    $("#b2Save").onclick = async () => { try { await rpc("set_battle_deck2", { p_cards: B2.edit, p_plan: null }); toast("Deck 2.0 enregistré !"); B2.edit = null; b2Panel(views.battle); } catch (e) { toast(message(e)); } };
    $("#b2Cancel").onclick = () => { B2.edit = null; box.innerHTML = ""; };
  };
  draw(); box.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------------------------------------------------------------- the battle */
async function b2Start() {
  if (B2.busy) return; B2.busy = true;
  try { B2.b = await rpc("battle2_start"); } catch (e) { B2.busy = false; return toast(message(e)); }
  B2.busy = false; B2.sel = null; B2.bet = 0; B2.sk = false;
  const el = B2.el = document.createElement("div"); el.className = "bt-arena b2-arena"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Bataille 2.0");
  document.body.appendChild(el); document.body.classList.add("fx-on");
  requestAnimationFrame(() => el.classList.add("on"));
  const b = B2.b;
  el.innerHTML = `<div class="bt-vs"><p class="bt-mode">⚡ Bataille 2.0 · simulation</p><div class="bt-side bt-me">${btEmblem(b.me.league, 70)}<b>${esc(b.me.pseudo)}</b><small>${fmt(b.me.trophies)} 🏆</small></div>
    <div class="bt-vsx">VS</div><div class="bt-side bt-op">${btEmblem(b.opp.league, 70)}<b>${esc(b.opp.pseudo)}</b><small>${fmt(b.opp.trophies)} 🏆 · son deck défend seul</small></div></div>`;
  setTimeout(b2Draw, 1700);
}
function b2Close() { const el = B2.el; B2.el = null; if (!el) return; el.classList.remove("on"); document.body.classList.remove("fx-on"); setTimeout(() => el.remove(), 350); if (!views.battle.hidden) renderBattle(); }
const b2Dots = n => `<span class="b2-dots">${[0, 1, 2, 3].slice(0, Math.max(3, n)).map(i => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>`;

function b2Draw() {
  const b = B2.b, el = B2.el; if (!el) return;
  if (b.status === "done") return b2End();
  const st = BT_STAT[b.stat], his = b.log.map(x => x.his), sel = B2.sel != null ? b.mine[B2.sel] : null;
  const canSk = sel?.skill && !b.skill_used;
  if (!canSk) B2.sk = false; if (B2.bet > Math.min(2, b.tokens)) B2.bet = 0;
  el.innerHTML = `<button class="bt-quit" aria-label="Quitter">×</button>
    <div class="bt-top"><div class="bt-who">${btEmblem(b.opp.league, 30)}<b>${esc(b.opp.pseudo)}</b><em class="bt-tag">2.0</em></div>
      <div class="bt-opp">${Array.from({ length: 5 }, (_, i) => his[i] ? `<div class="bt-mini shown">${btCardEl(his[i]).outerHTML}</div>` : `<div class="bt-mini back"><span>?</span></div>`).join("")}</div>
      <div class="b2-oinfo"><span>⚡ Ses jetons ${b2Dots(b.opp_tokens)}</span><span class="${b.opp_skill_used ? "off" : ""}">✨ Sa compétence : <b>${b.opp_skill_used ? "utilisée" : "encore en main"}</b></span></div></div>
    <div class="bt-mid">
      <div class="bt-score"><b class="bt-me">${b.a_won}</b><span>Manche ${Math.min(b.round + 1, 5)} / 5</span><b class="bt-op">${b.d_won}</b></div>
      <div class="bt-clash" id="b2Clash"></div>
      <div class="bt-stat" data-s="${b.stat}"><span>${st[2]}</span><div><b>${st[0]}</b><small>${st[1]} · la plus haute gagne</small></div></div>
    </div>
    <div class="b2-ctrl${sel ? " on" : ""}">
      <div class="b2-bet"><span>⚡ Jetons ${b2Dots(b.tokens)}</span>${[0, 1, 2].map(n => `<button type="button" data-bet="${n}" aria-pressed="${B2.bet === n}"${n > b.tokens ? " disabled" : ""}>${n ? "+" + n * 8 : "0"}</button>`).join("")}</div>
      ${canSk ? `<button type="button" class="b2-skb${B2.sk ? " on" : ""}" id="b2Sk">${B2_SK[sel.skill][0]} ${B2_SK[sel.skill][1]}<small>${B2_SK[sel.skill][2]}</small></button>`
        : sel?.skill ? `<span class="b2-skx">✨ Compétence déjà utilisée dans ce combat</span>` : ""}
      <button class="btn primary b2-play" id="b2Play"${sel ? "" : " disabled"}>${sel ? `Jouer ${esc(sel.title || "")}` : "Choisis une carte"}</button></div>
    <div class="bt-hand">${b.mine.map((j, i) => `<button class="bt-card${b.used.includes(i) ? " used" : ""}${B2.sel === i ? " b2-sel" : ""}" data-i="${i}"${b.used.includes(i) ? " disabled" : ""}>
      <div class="bt-cw"></div><span class="bt-val">${j[b.stat] + (B2.sel === i ? B2.bet * 8 : 0)}</span>${j.skill ? `<span class="b2-hsk">${B2_SK[j.skill][0]}</span>` : ""}${j.fam != null ? `<span class="b2-hf">${B2_FAM[j.fam][0]}</span>` : ""}</button>`).join("")}</div>`;
  el.querySelectorAll(".bt-card").forEach((btn, i) => btn.querySelector(".bt-cw").appendChild(btCardEl(b.mine[i])));
  el.querySelector(".bt-quit").onclick = () => { if (confirm("Quitter la simulation ?")) b2Close(); };
  el.querySelectorAll(".bt-card:not([disabled])").forEach(btn => btn.onclick = () => { B2.sel = +btn.dataset.i; b2Draw(); });
  el.querySelectorAll("[data-bet]").forEach(x => x.onclick = () => { B2.bet = +x.dataset.bet; b2Draw(); });
  const sk = $("#b2Sk"); if (sk) sk.onclick = () => { B2.sk = !B2.sk; b2Draw(); };
  $("#b2Play").onclick = () => b2Play();
}

async function b2Play() {
  if (B2.busy || B2.sel == null) return; B2.busy = true;
  const b = B2.b, i = B2.sel;
  let r; try { r = await rpc("battle2_play", { p_battle: b.id, p_slot: i, p_bet: B2.bet, p_skill: B2.sk }); } catch (e) { B2.busy = false; toast(message(e)); return b2Draw(); }
  B2.sel = null; B2.bet = 0; B2.sk = false;
  B2.el.classList.add("showing"); B2.el.querySelectorAll(".bt-card").forEach(x => x.disabled = true);
  await b2Show(r.last, b); B2.el?.classList.remove("showing");
  B2.b = r; B2.busy = false; b2Draw();
}
const b2Bon = (base, bon, sk) => `<ul class="b2-bon"><li>Base <b>${base}</b></li>${(bon || []).map(x => `<li class="${x.v < 0 ? "neg" : ""}">${esc(x.t)} <b>${x.v > 0 ? "+" : ""}${x.v}</b></li>`).join("")}${sk ? `<li class="sk">${B2_SK[sk][0]} ${B2_SK[sk][1]}</li>` : ""}</ul>`;
async function b2Show(x, b) {
  const clash = $("#b2Clash"); if (!clash) return;
  clash.innerHTML = `${x.stat !== x.stat0 ? `<p class="b2-remix">🎛️ Remix ! La stat devient <b>${BT_STAT[x.stat][0]}</b></p>` : ""}
    <div class="bt-duel"><div class="bt-c bt-me"><div class="bt-cw"></div><b class="bt-v" data-v="${x.mv}">0</b>${b2Bon(x.mb, x.mbon, x.msk)}</div>
    <div class="bt-c bt-op"><div class="bt-flip"><div class="bt-back"><span>?</span></div><div class="bt-front"></div></div><b class="bt-v" data-v="${x.hv}">0</b>${b2Bon(x.hb, x.hbon, x.hsk)}</div></div>`;
  clash.querySelector(".bt-me .bt-cw").appendChild(btCardEl(b.mine[x.mine]));
  clash.querySelector(".bt-front").appendChild(btCardEl(x.his));
  await wait(450); clash.querySelector(".bt-flip").classList.add("on");
  await wait(600); clash.querySelectorAll(".bt-v").forEach(v => wrCountTo(v, +v.dataset.v));
  await wait(1100);
  clash.querySelector(x.won ? ".bt-c.bt-me" : ".bt-c.bt-op").classList.add("win");
  clash.querySelector(x.won ? ".bt-c.bt-op" : ".bt-c.bt-me").classList.add("lose");
  clash.insertAdjacentHTML("beforeend", `<p class="bt-verdict ${x.won ? "w" : "l"}">${x.won ? "Manche gagnée !" : "Manche perdue"}</p>`);
  await wait(2200);
}
function b2End() {
  const b = B2.b, el = B2.el, won = b.winner, p = B2_PLAN[b.plan] || B2_PLAN.spec;
  el.innerHTML = `<div class="bt-end ${won ? "w" : "l"}"><p class="bt-k">Simulation 2.0 · ${b.a_won} – ${b.d_won} contre ${esc(b.opp.pseudo)}</p><h2>${won ? "Victoire !" : "Défaite"}</h2>
    <p class="bt-friendly">Son plan de défense était : <b>${p[0]} ${p[1]}</b> (${p[2].toLowerCase()})</p>
    <div class="bt-oc">${(b.opp_cards || []).map(j => `<div>${btCardEl(j).outerHTML}${b2Chips(j)}</div>`).join("")}</div>
    <div class="bt-acts"><button class="btn primary" id="b2Again">⚔️ Rejouer</button><button class="btn" id="b2Back">Retour</button></div></div>`;
  $("#b2Again").onclick = () => { const o = B2.el; B2.el = null; o.remove(); document.body.classList.remove("fx-on"); b2Start(); };
  $("#b2Back").onclick = () => b2Close();
}
Object.assign(window, { b2Panel });
