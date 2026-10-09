/* Zik Hunter — the reveal for Platine and Diamant artists: "la pochette signée". A record sleeve lies face down on a
   walnut desk in the dark; the desk lamp flickers in the colour of what is coming (platinum white, diamond
   iridescence, Shiny gold), comes on, the sleeve flips over on the artist's photo, a gold marker signs it along the real
   strokes of the signature, the record slides out, rises and turns — and the page shows the card.
   Models: "Uncapped Permanent Marker Pens" by sandeia (CC BY 4.0); "Desk Lamp Arm 01" and "Black Walnut Veneer 01" from
   Poly Haven (CC0). Loaded only when a booster holds such an artist; the page keeps the HTML card, title and sparks. */
const CDN = "https://cdn.jsdelivr.net/npm/three@0.160.0/";
const [THREE, { GLTFLoader }, { EffectComposer }, { RenderPass }, { UnrealBloomPass }, { ShaderPass }, { OutputPass }, { BokehPass }, BGU] = await Promise.all([
  import(CDN + "+esm"), import(CDN + "examples/jsm/loaders/GLTFLoader.js/+esm"), import(CDN + "examples/jsm/postprocessing/EffectComposer.js/+esm"),
  import(CDN + "examples/jsm/postprocessing/RenderPass.js/+esm"), import(CDN + "examples/jsm/postprocessing/UnrealBloomPass.js/+esm"), import(CDN + "examples/jsm/postprocessing/ShaderPass.js/+esm"),
  import(CDN + "examples/jsm/postprocessing/OutputPass.js/+esm"), import(CDN + "examples/jsm/postprocessing/BokehPass.js/+esm"), import(CDN + "examples/jsm/utils/BufferGeometryUtils.js/+esm"),
]);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v)), lerp = (a, b, k) => a + (b - a) * k, seg = (t, a, b) => clamp((t - a) / (b - a));
const ease = { out: k => 1 - Math.pow(1 - k, 3), in: k => k * k * k, inOut: k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2 };
const loadImg = src => new Promise(r => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
const url = p => new URL(p, location.href).href;

// timeline, in seconds
const PRE = 2.7, PEN_IN = PRE + .7, SIGN0 = PRE + 1.35, SIGN1 = PRE + 3.35, PEN_OUT = PRE + 3.75, SLIDE = PRE + 3.95, RISE = PRE + 4.75, SWAP = PRE + 5.55;
const FLICKS = [[.75, .82], [1.32, 1.37], [1.43, 1.5], [2.02, 2.08]];
const FLICK_COL = { platine: [0xe6eef8], diamant: [0xbdf0ff, 0xf8c8ff, 0xfff7c2, 0xc2ffe1], shiny: [0xffc85a], collector: [0xffc85a] };

export async function create(host) {
  const mobile = Math.min(innerWidth, innerHeight) < 600 || /Android|iPhone|iPad/.test(navigator.userAgent);
  const renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.25 : 1.75)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.setClearColor(0x050403, 1);
  const canvas = renderer.domElement; canvas.className = "fx-gl fx-gl-sleeve"; host.prepend(canvas);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x050403);
  { const env = new THREE.Scene(); env.background = new THREE.Color(0x020101);
    for (const [c, i, p, s] of [[0xffd9a8, 2.2, [-3, 4, -2], [2, 1.5]], [0xffffff, 1.4, [4, 3, 3], [2, 3]], [0xfff0dd, 1.2, [0, 5, 2], [3, 1]], [0xdfe8ff, .5, [0, 2, 6], [4, 1]]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(...s), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i), side: THREE.DoubleSide })); m.position.set(...p); m.lookAt(0, 0, 0); env.add(m); }
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(env, .03).texture; pm.dispose(); }
  const camera = new THREE.PerspectiveCamera(32, 1, .01, 30);

  // film look: bloom, depth of field (not on phones), vignette and grain
  const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
  const bokeh = mobile ? null : new BokehPass(scene, camera, { focus: .5, aperture: .03, maxblur: .009 }); if (bokeh) composer.addPass(bokeh);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .35, .5, .9); composer.addPass(bloom);
  const grade = new ShaderPass({ uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uBlack: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uBlack; varying vec2 vUv; float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 61.7) * 43758.5453); }
      void main(){ vec2 d = vUv - .5; vec3 c = texture2D(tDiffuse, vUv).rgb; c *= 1. - dot(d, d) * 1.25; c += (h(gl_FragCoord.xy) - .5) * .028; gl_FragColor = vec4(c * (1. - uBlack), 1.); }` });
  composer.addPass(grade); composer.addPass(new OutputPass());
  const noDepth = []; if (bokeh) { const r0 = bokeh.render.bind(bokeh); bokeh.render = (...a) => { noDepth.forEach(o => { o.userData.v = o.visible; o.visible = false; }); r0(...a); noDepth.forEach(o => o.visible = o.userData.v); }; }

  const [markerG, lampG] = await Promise.all([new GLTFLoader().loadAsync(url("brand/3d/sleeve/marker/scene.gltf")), new GLTFLoader().loadAsync(url("brand/3d/sleeve/desk_lamp/scene.gltf"))]);
  const tl = new THREE.TextureLoader(), wood = (f, srgb) => { const t = tl.load(url(`brand/3d/sleeve/walnut/walnut_${f}.jpg`)); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 5); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const desk = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshPhysicalMaterial({ map: wood("diff", true), normalMap: wood("nor_gl"), roughnessMap: wood("rough"), color: 0x8a7060, clearcoat: .5, clearcoatRoughness: .3 }));
  desk.rotation.x = -Math.PI / 2; desk.receiveShadow = true; scene.add(desk);
  const lamp = lampG.scene; lamp.scale.setScalar(.72); lamp.position.set(-.34, 0, -.3); lamp.rotation.y = Math.PI * .78; scene.add(lamp);
  let bulb; lamp.traverse(o => { if (o.isMesh) { o.castShadow = true; if (o.material.name.includes("light")) { bulb = o; o.material = new THREE.MeshBasicMaterial({ color: 0x000000 }); } } });
  lamp.updateMatrixWorld(true); const bulbP = new THREE.Box3().setFromObject(bulb).getCenter(V());
  const key = new THREE.SpotLight(0xffd2a0, 0, 0, .55, .7, 0); key.position.copy(bulbP); key.target.position.set(.02, 0, .02); key.castShadow = true; key.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048); key.shadow.bias = -.0002; scene.add(key, key.target);
  scene.add(new THREE.HemisphereLight(0x2a2433, 0x000000, .25));

  // the sleeve: front = photo + signature (painted per artist), back = black with the Zik Hunter mark
  const SW = .315, C = 1024, sleeveC = document.createElement("canvas"); sleeveC.width = sleeveC.height = C; const sg = sleeveC.getContext("2d");
  const sleeveT = new THREE.CanvasTexture(sleeveC); sleeveT.colorSpace = THREE.SRGBColorSpace; sleeveT.anisotropy = 8;
  const backC = document.createElement("canvas"); backC.width = backC.height = 512; { const g = backC.getContext("2d"); g.fillStyle = "#0d0c0b"; g.fillRect(0, 0, 512, 512);
    const im = g.getImageData(0, 0, 512, 512); for (let i = 0; i < im.data.length; i += 4) { const n = Math.random() * 10; im.data[i] += n; im.data[i + 1] += n; im.data[i + 2] += n; } g.putImageData(im, 0, 0);
    g.strokeStyle = "rgba(220,200,160,.35)"; g.lineWidth = 2; g.beginPath(); [[.22, 0], [.78, 0], [1, .3], [.5, 1], [0, .3]].forEach(([u, v], i) => g[i ? "lineTo" : "moveTo"](256 + (u - .5) * 70, 190 + v * 61)); g.closePath(); g.stroke();
    g.font = '500 20px "DM Mono"'; g.letterSpacing = "10px"; g.textAlign = "center"; g.fillStyle = "rgba(220,200,160,.45)"; g.fillText("ZIK HUNTER", 261, 320); }
  const backT = new THREE.CanvasTexture(backC); backT.colorSpace = THREE.SRGBColorSpace; backT.wrapS = backT.wrapT = THREE.RepeatWrapping; backT.repeat.set(-1, -1); backT.offset.set(1, 1);
  const edge = new THREE.MeshStandardMaterial({ color: 0xb9ad98, roughness: .9 }), backM = new THREE.MeshStandardMaterial({ map: backT, roughness: .45 });
  const faceM = new THREE.MeshPhysicalMaterial({ map: sleeveT, roughness: .55, clearcoat: .25, clearcoatRoughness: .5 });
  const sleeve = new THREE.Mesh(new THREE.BoxGeometry(SW, .004, SW), [edge, edge, faceM, backM, edge, edge]); sleeve.castShadow = sleeve.receiveShadow = true; scene.add(sleeve);
  const toWorld = (px, py) => V((px / C - .5) * SW, .0042, (py / C - .5) * SW);

  // the record
  const recC = document.createElement("canvas"); recC.width = recC.height = 1024; const recT = new THREE.CanvasTexture(recC); recT.colorSpace = THREE.SRGBColorSpace;
  const recM = new THREE.MeshPhysicalMaterial({ map: recT, roughness: .3, clearcoat: 1, clearcoatRoughness: .15 });
  const rec = new THREE.Mesh(new THREE.CylinderGeometry(.149, .149, .0018, 96), [new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: .4 }), recM, recM]); rec.castShadow = true;
  const recHold = new THREE.Group(); recHold.add(rec); scene.add(recHold);

  // the gold marker: one pen out of the pack, nib down, held at a writing angle
  let pen; { const parts = []; markerG.scene.updateMatrixWorld(true); markerG.scene.traverse(o => { if (o.isMesh) parts.push(o); });
    const split = mesh => { const g0 = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld); for (const k of Object.keys(g0.attributes)) if (k !== "position") g0.deleteAttribute(k);
      const g = BGU.mergeVertices(g0, 1e-5), idx = g.index.array, par = new Int32Array(g.attributes.position.count).map((_, i) => i), find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
      for (let i = 0; i < idx.length; i += 3) { const a = find(idx[i]); par[find(idx[i + 1])] = a; par[find(idx[i + 2])] = a; }
      const groups = new Map(); for (let i = 0; i < idx.length; i += 3) { const r = find(idx[i]); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(idx[i], idx[i + 1], idx[i + 2]); }
      const P = g.attributes.position; return [...groups.values()].map(l => { const pos = new Float32Array(l.length * 3); l.forEach((v, i) => pos.set([P.getX(v), P.getY(v), P.getZ(v)], i * 3)); const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.computeBoundingBox(); return geo; }); };
    const nibs = split(parts.find(p => p.material.name.includes("NIB"))), bodies = parts.filter(p => !p.material.name.includes("NIB")).flatMap(split);
    const cx = g => (g.boundingBox.min.x + g.boundingBox.max.x) / 2, x0 = Math.min(...nibs.map(cx)), nib = nibs.find(g => cx(g) === x0);
    const bodyG = BGU.mergeGeometries(bodies.filter(g => Math.abs(cx(g) - x0) < .08)); bodyG.computeBoundingBox();
    const tip = V(x0, nib.boundingBox.max.y, (nib.boundingBox.min.z + nib.boundingBox.max.z) / 2), S = .14 / (nib.boundingBox.max.y - bodyG.boundingBox.min.y);
    for (const g of [bodyG, nib]) { g.translate(-tip.x, -tip.y, -tip.z); g.scale(S, S, S); g.rotateX(Math.PI); g.computeVertexNormals(); }
    const inner = new THREE.Group(); inner.add(new THREE.Mesh(bodyG, new THREE.MeshPhysicalMaterial({ color: 0xf2c96a, metalness: 1, roughness: .32, clearcoat: .8, envMapIntensity: 2.6, emissive: 0x3a2808 })), new THREE.Mesh(nib, new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: .7 })));
    inner.children.forEach(m => m.castShadow = true); inner.rotation.set(-.42, 0, -.35); pen = new THREE.Group(); pen.add(inner); scene.add(pen); }

  const dot = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const ND = mobile ? 160 : 300, dP = new Float32Array(ND * 3); for (let i = 0; i < ND; i++) dP.set([(Math.random() - .5) * .6, Math.random() * .45, (Math.random() - .5) * .5], i * 3);
  const dust = new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(dP, 3)), new THREE.PointsMaterial({ map: dot, size: .003, color: 0xffe3bf, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(dust); noDepth.push(dust);

  // per artist: the photo on the sleeve, the signature and where its strokes are, the record label
  let base = null, inkC = null, colY = null, xMin = 0, xMax = 0, revealed = -1; const SIG_Y = C * .6;
  function paintSleeve(xr) { if (Math.abs(xr - revealed) < 1) return; revealed = xr; sg.drawImage(base, 0, 0); if (xr > xMin) sg.drawImage(inkC, 0, 0, xr, 360, 0, SIG_Y - 180, xr, 360); sleeveT.needsUpdate = true; }
  async function dress({ photo, name }) {
    const im = photo ? await loadImg(photo) : null;
    base = document.createElement("canvas"); base.width = base.height = C; { const g = base.getContext("2d");
      if (im) { const s = Math.max(C / im.width, C / im.height); g.drawImage(im, (C - im.width * s) / 2, (C - im.height * s) * .25, im.width * s, im.height * s); } else { g.fillStyle = "#222"; g.fillRect(0, 0, C, C); }
      try { const d = g.getImageData(0, 0, C, C), px = d.data; for (let i = 0; i < px.length; i += 4) { const n = (Math.random() - .5) * 14; px[i] += n; px[i + 1] += n; px[i + 2] += n; } g.putImageData(d, 0, 0); } catch {}
      g.strokeStyle = "rgba(255,255,255,.07)"; g.lineWidth = 26; g.beginPath(); g.arc(C / 2, C / 2, C * .43, 0, 7); g.stroke();
      const e = g.createLinearGradient(0, 0, C, 0); [[0, .25], [.03, 0], [.97, 0], [1, .25]].forEach(([o, a]) => e.addColorStop(o, `rgba(0,0,0,${a})`)); g.fillStyle = e; g.fillRect(0, 0, C, C);
      g.font = '500 22px "DM Mono"'; g.letterSpacing = "6px"; g.fillStyle = "rgba(255,255,255,.75)"; g.fillText(name.toUpperCase(), 40, 62); }
    const sig = name === name.toUpperCase() ? name.toLowerCase().replace(/(^|[\s-])\p{L}/gu, m => m.toUpperCase()) : name;
    inkC = document.createElement("canvas"); inkC.width = C; inkC.height = 360; const ig = inkC.getContext("2d");
    let fs = 230; ig.font = `${fs}px "Mrs Saint Delafield"`; while (ig.measureText(sig).width > C * .7) { fs -= 8; ig.font = `${fs}px "Mrs Saint Delafield"`; }
    const sw = ig.measureText(sig).width; ig.save(); ig.translate((C - sw) / 2 + 40, 230); ig.rotate(-.08);
    const gold = ig.createLinearGradient(0, -fs * .6, sw, 0); [[0, "#b8862b"], [.3, "#fff1b8"], [.55, "#d9a83f"], [.8, "#fff6cf"], [1, "#b8862b"]].forEach(([o, c]) => gold.addColorStop(o, c));
    ig.shadowColor = "rgba(40,24,4,.8)"; ig.shadowBlur = 3; ig.shadowOffsetY = 2; ig.fillStyle = gold; ig.fillText(sig, 0, 0); ig.restore();
    const a = ig.getImageData(0, 0, C, 360).data; colY = new Float32Array(C).fill(-1); xMin = C; xMax = 0;
    for (let x = 0; x < C; x++) { let s = 0, n = 0; for (let y = 0; y < 360; y++) if (a[(y * C + x) * 4 + 3] > 120) { s += y; n++; } if (n) { colY[x] = s / n; xMin = Math.min(xMin, x); xMax = Math.max(xMax, x); } }
    for (let x = xMin, last = 180; x <= xMax; x++) { if (colY[x] < 0) colY[x] = last; else last = colY[x]; }
    revealed = -1; paintSleeve(xMin);
    const g = recC.getContext("2d"); g.clearRect(0, 0, 1024, 1024); g.fillStyle = "#0b0b0c"; g.beginPath(); g.arc(512, 512, 512, 0, 7); g.fill();
    for (let r = 505; r > 190; r -= 2.2) { g.strokeStyle = `rgba(255,255,255,${.025 + Math.random() * .04})`; g.lineWidth = 1; g.beginPath(); g.arc(512, 512, r, 0, 7); g.stroke(); }
    g.fillStyle = "#e9e1d0"; g.beginPath(); g.arc(512, 512, 175, 0, 7); g.fill(); g.fillStyle = "#151210"; g.textAlign = "center"; g.letterSpacing = "0px";
    g.font = '900 34px "Unbounded"'; g.fillText(name.toUpperCase().slice(0, 18), 512, 470); g.font = '500 18px "DM Mono"'; g.letterSpacing = "6px"; g.fillText("ZIK HUNTER · 33 ⅓", 512, 590);
    g.fillStyle = "#000"; g.beginPath(); g.arc(512, 512, 9, 0, 7); g.fill(); recT.needsUpdate = true;
  }
  const strokeAt = k => { const x = Math.round(lerp(xMin, xMax, k)); return [x, SIG_Y - 180 + colY[clamp(x, 0, C - 1)]]; };

  // a little foley, made on the fly
  let ac = null; const sfx = () => ac ||= new (window.AudioContext || window.webkitAudioContext)();
  function noise(when, dur, { type = "bandpass", f0 = 800, f1 = f0, q = 1, gain = .3, attack = .01 } = {}) { const a = sfx(), t = a.currentTime + when, n = a.createBuffer(1, Math.ceil(a.sampleRate * (dur + .1)), a.sampleRate), d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(); s.buffer = n; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.setTargetAtTime(0, t + attack, dur / 3); s.connect(f).connect(g).connect(a.destination); s.start(t); s.stop(t + dur + .1); }
  function thump(when, g0 = .5) { const a = sfx(), t = a.currentTime + when, o = a.createOscillator(), g = a.createGain(); o.frequency.setValueAtTime(58, t); o.frequency.exponentialRampToValueAtTime(30, t + .45); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(g0, t + .005); g.gain.exponentialRampToValueAtTime(.001, t + .5); o.connect(g).connect(a.destination); o.start(t); o.stop(t + .55); }
  function score() {
    try { const a = sfx(); a.resume();
      [.35, 1.05, 1.62, 2.05, 2.36, 2.58].forEach((w, i) => thump(w, .3 + i * .07));
      FLICKS.forEach(([w, w1]) => noise(w, w1 - w + .02, { type: "highpass", f0: 3000, gain: .1 }));
      noise(1.2, PRE - 1.2, { type: "highpass", f0: 300, f1: 5000, gain: .05, attack: PRE - 1.3 }); noise(PRE - .55, .5, { f0: 300, f1: 3000, q: 1.2, gain: .2, attack: .3 });
      for (let w = SIGN0; w < SIGN1; w += .06) noise(w, .07, { f0: 2400 + Math.random() * 800, q: 3, gain: .03 + Math.random() * .03 });
      noise(SLIDE, 1, { f0: 900, f1: 500, q: .8, gain: .12, attack: .3 }); } catch {}
  }

  let raf = 0, last = 0, t0 = 0, kind = "diamant", cues = [], onSwap = null, cardW = 260, cardCy = .46, dog = 0, lost = false;
  // the card is shown at the swap — or right away if the 3D dies on the way (a phone out of GPU memory loses its WebGL
  // context; the sounds are already scheduled, so without this the player would hear the film and see nothing)
  function swap() { clearTimeout(dog); if (!onSwap) return; const cb = onSwap; onSwap = null; const w = cardW, h = w * 88 / 63, W = host.clientWidth || innerWidth, H = host.clientHeight || innerHeight; cb({ left: (W - w) / 2, top: H * cardCy - h / 2, width: w, height: h }); }
  function fail(e) { console.warn("Pochette 3D interrompue", e); lost = true; cancelAnimationFrame(raf); raf = 0; while (cues.length) cues.shift()[1](); swap(); }
  canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); fail("contexte WebGL perdu"); });
  const KEYS = [[PRE, [.02, .5, .36], [0, 0, .02]], [SIGN0, [.06, .4, .3], [0, 0, .06]], [SIGN1, [.03, .38, .32], [0, 0, .07]], [SLIDE, [.06, .36, .42], [.03, .02, .02]], [RISE, [.05, .27, .52], [.05, .1, .02]], [SWAP + .6, [.04, .22, .52], [.04, .14, .03]], [SWAP + 12, [.06, .225, .5], [.04, .14, .03]]];
  const portrait = () => clamp(.95 / camera.aspect, 1, 2.3);   // on a tall phone screen, step back so the sleeve stays in frame
  function camAt(t) { if (t < PRE) { const a = ease.inOut(seg(t, 0, PRE)); return [V(lerp(0, .02, a), lerp(.62, .5, a), lerp(.5, .36, a)), V(0, 0, .02)]; }
    let i = 0; while (i < KEYS.length - 2 && t > KEYS[i + 1][0]) i++; const a = KEYS[i], b = KEYS[i + 1], k = ease.inOut(seg(t, a[0], b[0])); return [V(...a[1]).lerp(V(...b[1]), k), V(...a[2]).lerp(V(...b[2]), k)]; }
  function resize() { const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight; renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  addEventListener("resize", () => raf && resize());

  function frame(now) {
    try { step(now); } catch (e) { fail(e); }
  }
  function step(now) {
    const dt = Math.min(.05, (now - (last || now)) / 1000); last = now; const t = (now - t0) / 1000;
    const [cp, ct] = camAt(t), pk = portrait(); camera.position.copy(ct).add(cp.clone().sub(ct).multiplyScalar(pk)); camera.lookAt(ct);
    // the lamp: flickers in the colour of what is coming, then warm light for good
    const fi = FLICKS.findIndex(([a, b]) => t >= a && t < b), cols = FLICK_COL[kind] || FLICK_COL.diamant;
    if (t < PRE - .55) { const f = fi >= 0 ? .55 : 0, c = new THREE.Color(cols[Math.max(0, fi) % cols.length]); key.color.copy(c); key.intensity = 4.2 * f; bulb.material.color.copy(c).multiplyScalar(f * 4); dust.material.color.copy(c); dust.material.opacity = f * .9; }
    else { const on = seg(t, PRE - .55, PRE - .4); key.color.set(0xffd2a0); key.intensity = 1.9 * on; bulb.material.color.setScalar(3 * on); dust.material.color.set(0xffe3bf); dust.material.opacity = on * .7; }
    // the sleeve turns over
    const fk = ease.inOut(seg(t, PRE - .55, PRE)); sleeve.rotation.z = Math.PI * (1 - fk); sleeve.position.y = .002 + Math.sin(fk * Math.PI) * .09;
    // the pen
    const [sx, sy] = strokeAt(seg(t, SIGN0, SIGN1));
    if (t < SIGN0) { const a = ease.out(seg(t, PEN_IN, SIGN0)); pen.position.copy(toWorld(...strokeAt(0))).add(V(lerp(.25, 0, a), lerp(.2, .006, a), lerp(.12, 0, a))); }
    else if (t < SIGN1) { pen.position.copy(toWorld(sx, sy)); paintSleeve(sx); }
    else { const a = ease.in(seg(t, SIGN1, PEN_OUT)); pen.position.copy(toWorld(...strokeAt(1))).add(V(a * .2, a * .25, a * .05)); paintSleeve(xMax + 2); }
    pen.visible = t > PEN_IN - .05 && t < PEN_OUT + .1;
    faceM.clearcoat = .25 + (t > SIGN1 && t < SLIDE ? .6 * Math.sin(seg(t, SIGN1, SLIDE) * Math.PI) : 0);
    // the record slides out, rises, turns — at the swap the page takes over with the card
    const s = ease.inOut(seg(t, SLIDE, RISE)), r = ease.inOut(seg(t, RISE, SWAP)); recHold.position.set(lerp(0, .2, s) + lerp(0, -.16, r), .002 + r * .16, lerp(0, .05, r));
    recHold.rotation.x = r * Math.PI / 2 * .92; rec.rotation.y += dt * (2 + r * 9); recHold.rotation.y = seg(t, SWAP - .3, SWAP) * Math.PI / 2;
    recHold.visible = t > PRE && t < SWAP;
    while (cues.length && t >= cues[0][0]) cues.shift()[1]();
    if (t >= SWAP) swap();
    for (let i = 0; i < ND; i++) { dP[i * 3 + 1] += Math.sin(now / 1000 * .3 + i) * .00004; dP[i * 3] += Math.cos(now / 1000 * .2 + i * 1.3) * .00003; } dust.geometry.attributes.position.needsUpdate = true;
    grade.uniforms.uTime.value = now / 1000 % 100; grade.uniforms.uBlack.value = t < PRE ? 1 - seg(t, 0, .6) * .85 : 0;
    if (bokeh) { const fp = t < PRE ? sleeve.position : t < SLIDE ? pen.position : t < SWAP ? recHold.position : V(.04, .14, .03); bokeh.uniforms.focus.value = camera.position.distanceTo(fp); bokeh.uniforms.aperture.value = t < SWAP ? .03 : .06; }
    composer.render(); raf = requestAnimationFrame(frame);
  }

  return {
    // the whole film up to the moment the card appears; resolves with where the card should be shown
    // on.start: the first frame of this film is drawn (show the canvas then, not before); on.music: when the track should start (quiet, behind the sleeve); on.open: when the record comes out and it opens up
    async play({ kind: k = "diamant", photo, name, w = 260, cy = .46, on = {} }) {
      kind = k; cardW = w; cardCy = cy; cues = [[0, on.start], [PRE + .5, on.music], [SLIDE, on.open]].filter(c => c[1]); await dress({ photo, name }); resize();
      sleeve.rotation.z = Math.PI; recHold.visible = false; pen.visible = false;
      if (lost) return Promise.reject(new Error("3D perdue"));
      return new Promise(res => { onSwap = res; t0 = performance.now(); last = 0; score(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
        clearTimeout(dog); dog = setTimeout(() => fail("trop lent"), (SWAP + 2.5) * 1000); });   // watchdog: the card comes, whatever happens
    },
    // compile the shaders ahead of time
    async warmup() { resize(); camera.position.set(.02, .5, .36); camera.lookAt(0, 0, 0); pen.visible = recHold.visible = true; try { await Promise.race([renderer.compileAsync(scene, camera), new Promise(r => setTimeout(r, 4000))]); } catch {} composer.render(); },
    stop() { cancelAnimationFrame(raf); raf = 0; clearTimeout(dog); onSwap = null; cues = []; },
    get lost() { return lost; },
    canvas,
  };
}
