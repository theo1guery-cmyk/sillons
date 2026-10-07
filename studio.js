// The print studio: the boosters and the card backs of the design pack, rendered in 3D with their real materials
// (hot foil, embossing, holographic film) by one shared WebGL renderer, then copied into ordinary 2D canvases
// on the page. A canvas only re-renders while it is visible and animated (the shelf booster, a hovered card).
const CDN = "https://cdn.jsdelivr.net/npm/three@0.160.0/";
const [THREE, { RoomEnvironment }] = await Promise.all([
  import(CDN + "+esm"),
  import(CDN + "examples/jsm/environments/RoomEnvironment.js/+esm"),
]);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const MAXW = 1100, MAXH = 1500;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(1); renderer.setSize(MAXW, MAXH, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.setClearColor(0, 0);
const pmrem = new THREE.PMREMGenerator(renderer);
const loader = new THREE.TextureLoader();
const maxAniso = renderer.capabilities.getMaxAnisotropy();
const texture = (url, srgb) => new Promise(res => loader.load(url, t => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; res(t); }, undefined, () => res(null)));

/* ---------- boosters: a pillow of foil in a bright room, two coloured lights orbiting ---------- */
const packScene = new THREE.Scene();
packScene.environment = pmrem.fromScene(new RoomEnvironment(), .03).texture;
packScene.environmentIntensity = .75;
packScene.add(new THREE.AmbientLight(0xffffff, .45));
{ const k = new THREE.DirectionalLight(0xfff2e0, 2.2); k.position.set(-2, 3, 4); packScene.add(k);
  const r = new THREE.DirectionalLight(0xbfd4ff, .9); r.position.set(3, 1, -2); packScene.add(r); }
const packPink = new THREE.PointLight(0xff4fc0, 4, 8, 1.8), packCyan = new THREE.PointLight(0x40e0ff, 4, 8, 1.8);
packScene.add(packPink, packCyan);

const PW = 1.12, PH = 1.9, CRIMP = .07;
function bulge(u, v) {
  if (v < CRIMP || v > 1 - CRIMP) return .0035 * Math.abs(Math.sin(u * 140));
  const side = Math.pow(Math.sin(Math.PI * u), .55);
  const ends = THREE.MathUtils.smoothstep(v, CRIMP, CRIMP + .1) * THREE.MathUtils.smoothstep(1 - v, CRIMP, CRIMP + .1);
  const wrinkle = .0016 * Math.sin(u * 19 + v * 7) * Math.sin(v * 23 + u * 5) + .0008 * Math.sin(u * 41 - v * 13);
  const seal = u < .035 || u > .965 ? -.002 : 0;
  return (.085 * side + wrinkle * side) * ends + seal;
}
function pillow(back) {
  const sx = 64, sy = 120, pos = [], uv = [], idx = [];
  for (let j = 0; j <= sy; j++) for (let i = 0; i <= sx; i++) {
    const u = i / sx, v = j / sy, z = bulge(u, v);
    pos.push((u - .5) * PW * (back ? -1 : 1), (v - .5) * PH, back ? -z : z); uv.push(u, v);
  }
  for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) { const a = j * (sx + 1) + i, b = a + 1, c = a + sx + 1, d = c + 1; idx.push(a, b, d, a, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
const serrated = (() => {                                            // the crimped ends are cut with pinking shears
  const c = document.createElement("canvas"); c.width = 512; c.height = 1024; const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, 512, 1024); g.fillStyle = "#000";
  const n = 22, tw = 512 / n, th = 14;
  for (const top of [true, false]) { g.beginPath(); for (let k = 0; k <= n; k++) { const x = k * tw; g.lineTo(x, top ? 0 : 1024); g.lineTo(x + tw / 2, top ? th : 1024 - th); } g.lineTo(512, top ? 0 : 1024); g.closePath(); g.fill(); }
  return new THREE.CanvasTexture(c);
})();
const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;
const packBackMat = new THREE.MeshStandardMaterial({ map: white, color: 0x15101f, roughness: .5, metalness: .4, alphaMap: serrated, alphaTest: .5 });
const packFront = new THREE.Mesh(pillow(false)), packBackSide = new THREE.Mesh(pillow(true));
const packCap = new THREE.Mesh(packFront.geometry), packCapBack = new THREE.Mesh(packBackSide.geometry);
const capInner = new THREE.Group(), capPivot = new THREE.Group(); capInner.add(packCap, packCapBack); capPivot.add(capInner);
const pack = new THREE.Group(); pack.add(packFront, packBackSide, capPivot); packScene.add(pack);

/* ---------- tearing: the cut is a curve v = f(u) in a 512 x 1 float texture (2 = not torn) ---------- */
const newCut = () => { const t = new THREE.DataTexture(new Float32Array(512).fill(2), 512, 1, THREE.RedFormat, THREE.FloatType); t.needsUpdate = true; return t; };
const noCut = newCut(), uCut = { value: noCut };
// mode 1 keeps what is under the tear (the pack), -1 what is above (the strip torn off); flip for the back
function torn(base, mode, flip) {
  const m = base.clone();
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uCut, uMode: { value: mode }, uFlip: { value: flip } });
    sh.fragmentShader = "uniform sampler2D uCut; uniform float uMode; uniform float uFlip;\n" + sh.fragmentShader
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
        float zU = uFlip > .5 ? 1. - vMapUv.x : vMapUv.x;
        float zC = texture2D(uCut, vec2(zU, .5)).r;
        float zD = vMapUv.y - zC;                                  // a clean cut, exactly along the finger
        if (uMode > .5 && zD > 0.) discard;
        if (uMode < -.5 && zD < 0.) discard;`)
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>
        if (zC < 1.5 && abs(zD) < .0018) gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(.96, .96, 1.), .6);`);   // the thin bright edge of the foil
  };
  m.customProgramCacheKey = () => "torn" + mode + flip;
  return m;
}
const tornBack = [torn(packBackMat, 1, 1), torn(packBackMat, -1, 1)];
const tornSets = new WeakMap();
const tornFront = m => { let t = tornSets.get(m); if (!t) tornSets.set(m, t = [torn(m, 1, 0), torn(m, -1, 0)]); return t; };

/* ---------- card backs: a thin slab in a dark photo studio with soft boxes ---------- */
const cardScene = new THREE.Scene();
{
  const studio = new THREE.Scene(); studio.background = new THREE.Color(0x040308);
  const box = (w, h, col, k, p) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide })); m.position.set(...p); m.lookAt(0, 0, 0); studio.add(m); };
  box(7, 2.4, 0xffffff, 3.2, [-4, 5, 6]); box(1.6, 8, 0xfff0dc, 2.2, [7, 0, 4]); box(9, 1.2, 0xffd49a, 1.6, [0, -6, 5]);
  box(3, 3, 0xff5ccf, 1.4, [-7, -2, 2]); box(3, 3, 0x5cd2ff, 1.4, [6, 4, -3]); box(12, 7, 0x2a2236, 1, [0, 0, 9]);
  cardScene.environment = pmrem.fromScene(studio, .02).texture;
}
// the holographic back reflects a ring of big coloured panels, so its rainbow is vivid without any point highlight
const prismEnv = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 512; const g = c.getContext("2d");
  const cg = g.createConicGradient(0, 256, 256); ["#ff3ec8", "#ff9a2e", "#ffe84a", "#3dff9c", "#2ee0ff", "#5a6bff", "#c04dff", "#ff3ec8"].forEach((h, k, a) => cg.addColorStop(k / (a.length - 1), h));
  g.fillStyle = cg; g.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const room = new THREE.Scene(); room.background = new THREE.Color(0x1a0f2a);
  const wheel = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1.8, 1.8, 1.8), side: THREE.DoubleSide }));
  wheel.position.set(0, 0, 6); wheel.lookAt(0, 0, 0); room.add(wheel);
  return pmrem.fromScene(room, .02).texture;
})();
cardScene.add(new THREE.AmbientLight(0xffffff, .35));
{ const k = new THREE.DirectionalLight(0xfff2e0, 1.8); k.position.set(-2, 3, 4); cardScene.add(k);
  const r = new THREE.DirectionalLight(0xbfd4ff, .8); r.position.set(3, 1, -2); cardScene.add(r); }
const cardPink = new THREE.PointLight(0xff4fc0, 1.6, 8, 1.8), cardCyan = new THREE.PointLight(0x40e0ff, 1.6, 8, 1.8), torch = new THREE.PointLight(0xfff4dc, 2.6, 7, 1.6);
cardScene.add(torch);   // no coloured point lights here: on a small card their reflections read as stray dots

const CW = 1.26, CH = 1.76, CR = .075, DEPTH = .016;
const shape = (() => {
  const s = new THREE.Shape(), x = -CW / 2, y = -CH / 2;
  s.moveTo(x + CR, y); s.lineTo(x + CW - CR, y); s.quadraticCurveTo(x + CW, y, x + CW, y + CR); s.lineTo(x + CW, y + CH - CR);
  s.quadraticCurveTo(x + CW, y + CH, x + CW - CR, y + CH); s.lineTo(x + CR, y + CH); s.quadraticCurveTo(x, y + CH, x, y + CH - CR);
  s.lineTo(x, y + CR); s.quadraticCurveTo(x, y, x + CR, y); return s;
})();
const cardFace = (() => {
  const g = new THREE.ShapeGeometry(shape, 12), p = g.attributes.position, uv = [];
  for (let i = 0; i < p.count; i++) uv.push((p.getX(i) + CW / 2) / CW, (p.getY(i) + CH / 2) / CH);
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.translate(0, 0, DEPTH / 2 + .0004);
  return new THREE.Mesh(g);
})();
const cardEdge = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: false, curveSegments: 12 }).translate(0, 0, -DEPTH / 2));
const card = new THREE.Group(); card.add(cardEdge, cardFace); cardScene.add(card);

// the Égaliseur back: LED peaks that dance on top of the printed bars
const TW = 1024, TH = 1430, CX = 512, CY = 590, EQN = 64, EQR = 172;
const eqLen = k => 70 + 175 * Math.abs(Math.sin(k * .41) * .65 + Math.sin(k * 1.37) * .35);
const uvToLocal = (px, py) => new THREE.Vector3((px / TW - .5) * CW, (.5 - py / TH) * CH, DEPTH / 2 + .002);
const peaks = new THREE.InstancedMesh(new THREE.PlaneGeometry(16 / TW * CW, 6 / TH * CH), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), EQN);
{ const col = new THREE.Color(); for (let k = 0; k < EQN; k++) peaks.setColorAt(k, col.setHSL(((330 + k / EQN * 60) % 360) / 360, 1, .72)); }
card.add(peaks);
const o3 = new THREE.Object3D();
function dancePeaks(t) {
  for (let k = 0; k < EQN; k++) {
    const a = k / EQN * Math.PI * 2 - Math.PI / 2, v = .55 + .45 * Math.abs(Math.sin(t * 2.1 + k * .6) * Math.sin(t * 1.3 + k * .23)), d = EQR + eqLen(k) * v + 8;
    o3.position.copy(uvToLocal(CX + Math.cos(a) * d, CY + Math.sin(a) * d)); o3.rotation.set(0, 0, Math.PI / 2 - a); o3.updateMatrix(); peaks.setMatrixAt(k, o3.matrix);
  }
  peaks.instanceMatrix.needsUpdate = true;
}

/* ---------- materials, loaded on demand ---------- */
const BACK = { "back-vinyl": { edge: 0xc9a04a }, "back-eq": { edge: 0xe7b14a, peaks: true }, "back-mono": { edge: 0x6b4423 }, "back-holo": { edge: 0xc8c8dc, env: 1.6, relief: 1, prism: true } };   // the holo needs its full diffraction relief
const mats = new Map();
function material(name) {
  if (mats.has(name)) return mats.get(name);
  const base = "brand/demo/" + name;
  const p = Promise.all([texture(base + "-a.webp", true), texture(base + "-m.webp", false), texture(base + "-n.webp", false)]).then(([a, m, n]) => {
    if (!a || !m || !n) return null;
    if (BACK[name]) return {
      face: new THREE.MeshPhysicalMaterial({ map: a, roughnessMap: m, metalnessMap: m, iridescenceMap: m, normalMap: n, roughness: 1, metalness: 1, iridescence: 1, iridescenceIOR: 1.55, iridescenceThicknessRange: [200, 640], clearcoat: .3, clearcoatRoughness: .15, envMapIntensity: BACK[name].env || 1, ...(BACK[name].prism ? { envMap: prismEnv, roughness: .4, iridescenceThicknessRange: [120, 900] } : {}) }),
      edge: new THREE.MeshPhysicalMaterial({ color: BACK[name].edge, roughness: .35, metalness: .8, clearcoat: .5 }),
      peaks: !!BACK[name].peaks, relief: BACK[name].relief || 0, sway: !!BACK[name].sway,
    };
    return new THREE.MeshPhysicalMaterial({
      map: a, roughnessMap: m, metalnessMap: m, iridescenceMap: m, normalMap: n, roughness: 1, metalness: 1, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 620],
      clearcoat: 1, clearcoatRoughness: .08, alphaMap: serrated, alphaTest: .5, envMapIntensity: 1.1, emissive: 0xffffff, emissiveMap: a, emissiveIntensity: .1,
    });
  });
  mats.set(name, p);
  p.then(m => { p.ready = m; if (!m) setTimeout(() => { if (mats.get(name) === p) mats.delete(name); }, 3000); });   // a failed load is retried, never kept
  return p;
}

/* ---------- the canvases on the page ---------- */
const items = new Set();
const seen = new IntersectionObserver(es => { for (const e of es) { const it = e.target.__studio; if (it) { it.visible = e.isIntersecting; if (it.visible) it.dirty = true; } } });
function attach(canvas, kind, name, { live = false, sway = false, tear = null, canTear = null, cut = null, host = null } = {}) {
  if (canvas.__studio) { Object.assign(canvas.__studio, { name, live, sway, dirty: true }); return canvas.__studio; }
  const it = { canvas, kind, name, live, sway, host, hover: false, px: 0, py: 0, tx: 0, ty: 0, dirty: true, visible: true, was: false, cur: null, st: 0, peel: null };
  if (cut) { it.cut = newCut(); it.cut.image.data.set(cut); it.cut.needsUpdate = true; }   // a copy, already torn
  if (tear) { it.cut = newCut(); it.tear = tear; it.canTear = canTear; tearable(it); }
  canvas.__studio = it; items.add(it); seen.observe(canvas);
  canvas.addEventListener("pointermove", e => { const r = canvas.getBoundingClientRect(); it.hover = true; it.px = clamp((e.clientX - r.left) / r.width * 2 - 1, -1, 1); it.py = clamp(-((e.clientY - r.top) / r.height * 2 - 1), -1, 1); });
  canvas.addEventListener("pointerleave", () => { it.hover = false; it.px = it.py = 0; });
  material(typeof name === "function" ? name() : name);
  return it;
}
const camera = new THREE.PerspectiveCamera(32, 1, .1, 50);
function frameObject(w, h, objW, objH, fit) {
  camera.aspect = w / h; const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const d = Math.max(objH * fit / 2 / t, objW * fit / 2 / t / camera.aspect);
  camera.position.set(0, 0, d); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); return d;
}
function draw(it, time) {
  const name = typeof it.name === "function" ? it.name() : it.name, m = material(name).ready;
  if (!m) { if (name !== it.cur) it.host?.classList.remove("gl"); return false; }   // the plain design shows until the 3D one is drawn
  const c = it.canvas, dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.min(MAXW, Math.round(c.clientWidth * dpr)), h = Math.min(MAXH, Math.round(c.clientHeight * dpr));
  if (!w || !h) return false;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  renderer.setViewport(0, 0, w, h); renderer.setScissor(0, 0, w, h); renderer.setScissorTest(true);
  if (it.kind === "pack") {
    const [body, top] = tornFront(m);
    packFront.material = body; packCap.material = top; packBackSide.material = tornBack[0]; packCapBack.material = tornBack[1];
    uCut.value = it.cut || noCut;
    posePack(it, w, h);
    const pl = it.peel; capPivot.visible = !!pl && pl.k < 1;     // the torn strip peels backwards and flies off
    if (pl) {
      const k = ease(pl.k); capPivot.position.set(pl.dir * k * k * 1.1, pl.yc + k * .9, k * .6); capInner.position.y = -pl.yc;
      capPivot.rotation.set(-k * 2.1, 0, pl.dir * k * .5); capPivot.scale.setScalar(1 - k * .5);
    }
    packPink.position.set(Math.cos(time * .6) * 2.6, 1.2 + Math.sin(time * .8) * .6, 2.2 + Math.sin(time * .6) * .8);
    packCyan.position.set(Math.cos(time * .6 + Math.PI) * 2.6, -.6 + Math.cos(time * .7) * .6, 2.2 + Math.cos(time * .6) * .8);
    renderer.render(packScene, camera);
  } else {
    cardFace.material = m.face; cardEdge.material = m.edge; peaks.visible = m.peaks;
    m.face.normalScale.setScalar(Math.max(m.relief, clamp(w / 900, .12, 1)));   // fine grooves would shimmer on a small card
    if (m.peaks) dancePeaks(time);
    const sw = m.sway ? 1 : 0, ph = it.phase ??= Math.random() * 6;   // the holo sways gently so its rainbow keeps sliding
    card.rotation.set(-it.ty * .22 + sw * Math.cos(time * .7 + ph) * .12, it.tx * .32 + sw * Math.sin(time * .9 + ph) * .2, 0);
    const d = frameObject(w, h, CW, CH, 1.08);
    torch.position.set(it.px * 1.7, it.py * 1.1, d * .4); torch.intensity = it.hover ? 2.6 : 0;   // the light follows the pointer over the card
    cardPink.position.set(Math.cos(time * .6) * 2.6, 1.2 + Math.sin(time * .8) * .6, 2.2 + Math.sin(time * .6) * .8);
    cardCyan.position.set(Math.cos(time * .6 + Math.PI) * 2.6, -.6 + Math.cos(time * .7) * .6, 2.2 + Math.cos(time * .6) * .8);
    renderer.render(cardScene, camera);
  }
  const g = c.getContext("2d"); g.clearRect(0, 0, w, h);
  g.drawImage(renderer.domElement, 0, MAXH - h, w, h, 0, 0, w, h);
  it.cur = name; it.host?.classList.add("gl");
  return true;
}
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function posePack(it, w, h) {
  pack.rotation.set(-it.ty * .28, it.tx * .45 + (it.sway ? Math.sin(it.st * .7) * .08 : 0), 0);
  pack.position.y = it.sway ? Math.sin(it.st * 1.4) * .02 : 0;
  frameObject(w, h, PW, PH, 1.1);
}

// the shelf booster can be torn open anywhere across its upper half: the cut follows the finger
let trail = null, tg = null;
function trailCanvas() {
  if (trail) return;
  trail = document.createElement("canvas"); trail.className = "tear-trail"; trail.setAttribute("aria-hidden", "true");
  Object.assign(trail.style, { position: "fixed", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "60" });
  document.body.appendChild(trail); tg = trail.getContext("2d");
}
function drawTrail(pts, alpha) {
  const dpr = devicePixelRatio || 1;
  if (trail.width !== innerWidth * dpr) { trail.width = innerWidth * dpr; trail.height = innerHeight * dpr; }
  tg.setTransform(dpr, 0, 0, dpr, 0, 0); tg.clearRect(0, 0, innerWidth, innerHeight);
  if (pts.length < 2 || alpha <= 0) return;
  tg.globalAlpha = alpha; tg.lineCap = tg.lineJoin = "round";
  for (const [lw, c] of [[14, "rgba(255,200,110,.22)"], [8, "rgba(255,215,140,.4)"], [3.5, "#fff"]]) {
    tg.lineWidth = lw; tg.strokeStyle = c; tg.beginPath(); pts.forEach(([x, y], i) => i ? tg.lineTo(x, y) : tg.moveTo(x, y)); tg.stroke();
  }
  const [hx, hy] = pts[pts.length - 1]; tg.fillStyle = "#fff"; tg.beginPath(); tg.arc(hx, hy, 5, 0, 7); tg.fill();
  tg.globalAlpha = 1;
}
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function hitPack(it, e) {
  const r = it.canvas.getBoundingClientRect();
  posePack(it, r.width, r.height); pack.updateMatrixWorld(true);
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height * 2 - 1));
  ray.setFromCamera(ndc, camera);
  return ray.intersectObject(packFront)[0];
}
function tearable(it) {
  const c = it.canvas; let path = [], pts = [], fade = 0;
  c.style.touchAction = "none";
  const span = () => { const us = path.map(p => p.x); return Math.max(...us) - Math.min(...us); };
  const fadeOut = () => { fade = 1; const step = () => { fade -= .045; drawTrail(pts, fade); if (fade > 0) requestAnimationFrame(step); }; requestAnimationFrame(step); };
  c.addEventListener("pointerdown", e => {
    if (it.peel || (it.canTear && !it.canTear())) return;
    const h = hitPack(it, e);
    if (!h || h.uv.y < .3 || h.uv.y > .95) return;
    trailCanvas(); it.tearing = true; path = [h.uv.clone()]; pts = [[e.clientX, e.clientY]];
    c.setPointerCapture(e.pointerId); e.preventDefault();
  });
  c.addEventListener("pointermove", e => {
    if (!it.tearing) return;
    const h = hitPack(it, e);
    if (h && h.uv.y > .3 && h.uv.y < .95) path.push(h.uv.clone());
    const lp = pts[pts.length - 1];
    if (!lp || Math.hypot(e.clientX - lp[0], e.clientY - lp[1]) < 140) pts.push([e.clientX, e.clientY]);   // a sudden jump is a glitch, not a gesture
    drawTrail(pts, 1);
    const outside = !h || h.uv.x < .03 || h.uv.x > .97;
    if (span() > .9 || (outside && span() > .75)) finish();
  });
  const up = () => { if (!it.tearing) return; if (span() > .65) finish(); else { it.tearing = false; fadeOut(); } };   // not across: nothing happens
  c.addEventListener("pointerup", up); c.addEventListener("pointercancel", up);
  // the drawn points become a curve over the whole width: averaged per column, gaps joined, smoothed
  function finish() {
    it.tearing = false; fadeOut();
    const N = 512, sum = new Float32Array(N), cnt = new Float32Array(N), f = it.cut.image.data;
    for (const p of path) { const i = Math.min(N - 1, Math.max(0, Math.round(p.x * (N - 1)))); sum[i] += p.y; cnt[i]++; }
    const known = []; for (let i = 0; i < N; i++) if (cnt[i]) known.push([i, sum[i] / cnt[i]]);
    for (let i = 0; i < N; i++) {
      let a = known[0], b = known[known.length - 1];
      for (let k = 0; k < known.length; k++) { if (known[k][0] <= i) a = known[k]; if (known[k][0] >= i) { b = known[k]; break; } }
      f[i] = a[0] === b[0] ? a[1] : lerp(a[1], b[1], (i - a[0]) / (b[0] - a[0]));
    }
    for (let pass = 0; pass < 8; pass++) for (let i = 1; i < N - 1; i++) f[i] = (f[i - 1] + f[i] * 2 + f[i + 1]) / 4;
    for (let i = 0; i < N; i++) f[i] = Math.min(.93, Math.max(.3, f[i]));
    it.cut.needsUpdate = true;
    const dir = Math.sign(path[path.length - 1].x - path[0].x) || 1, low = Math.min(...f);
    it.peel = { k: 0, dir, yc: (low - .5) * PH }; it.px = it.py = 0;
    setTimeout(() => { it.tear(f.slice()); it.waitReset = true; }, 900);   // the strip has flown: open the booster
  }
}
// a torn pack stays torn until the opening is over (it is hidden by then), then a fresh one is put back
function untear(it) { it.cut.image.data.fill(2); it.cut.needsUpdate = true; it.peel = null; it.waitReset = false; it.dirty = true; }
let last = 0, time = 0;
function loop(t) {
  const dt = Math.min(.05, (t - (last || t)) / 1000); last = t; time += dt;
  for (const it of items) {
    if (!it.canvas.isConnected) { if (it.was) { items.delete(it); seen.unobserve(it.canvas); delete it.canvas.__studio; } continue; }
    it.was = true;
    if (!it.visible || !it.canvas.clientWidth) continue;
    const f = Math.min(1, dt * 6), ox = it.tx, oy = it.ty;
    if (!it.tearing) { it.tx = lerp(it.tx, it.px, f); it.ty = lerp(it.ty, it.py, f); it.st += dt; }   // the pack holds still under the finger
    if (it.peel && it.peel.k < 1) { it.peel.k = Math.min(1, it.peel.k + dt); it.dirty = true; }
    if (it.waitReset && (!it.canTear || it.canTear())) untear(it);
    const moving = Math.abs(it.tx - ox) + Math.abs(it.ty - oy) > .0005;
    const name = typeof it.name === "function" ? it.name() : it.name;
    const swaying = material(name).ready?.sway;
    if (it.dirty || moving || it.hover || it.live || it.sway || swaying || name !== it.cur) { if (draw(it, time)) it.dirty = false; }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
renderer.domElement.addEventListener("webglcontextlost", e => { e.preventDefault(); for (const it of items) { it.host?.classList.remove("gl"); it.cur = null; } });
renderer.domElement.addEventListener("webglcontextrestored", () => { for (const it of items) it.dirty = true; });

// a still of a card back, cut to the card's edges (for the 3D hit reveal)
const ortho = new THREE.OrthographicCamera(-CW / 2, CW / 2, CH / 2, -CH / 2, .1, 10); ortho.position.set(0, 0, 3);
async function still(name) {
  const m = await material(name); if (!m) return null;
  const w = 630, h = 880;
  renderer.setViewport(0, 0, w, h); renderer.setScissor(0, 0, w, h); renderer.setScissorTest(true);
  cardFace.material = m.face; cardEdge.material = m.edge; peaks.visible = false; card.rotation.set(0, 0, 0); m.face.normalScale.setScalar(.7);
  torch.intensity = 0;
  renderer.render(cardScene, ortho);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  c.getContext("2d").drawImage(renderer.domElement, 0, MAXH - h, w, h, 0, 0, w, h);
  return c;
}

window.Studio = {
  pack: (canvas, name, opts) => attach(canvas, "pack", name, opts),
  card: (canvas, name, opts) => attach(canvas, "card", name, opts),
  preload: name => material(name),
  still,
};
dispatchEvent(new Event("zh:studio"));
