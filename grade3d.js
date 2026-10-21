/* Zik Hunter — the grading reveal, "le labo d'authentification". On a black cutting mat, under a magnifier lamp, the
   card waits on a small black riser. A fine line of cold light glides over it (edges, corners, surface, centring), the
   card rises and settles into the open acrylic case; the lid comes down with a click. Then, in the
   dark, the label printer feeds the label out: it prints from left to right as it comes out, the grade last. The label
   goes into its pocket, and the case stands up facing the camera — gold light for a 10. Then the page shows the real
   case (HTML) in its place.
   Models: "Label Maker Photoscan" by BrainIess, "Lamp And Lup" by andre.ldeaesilva
   (Sketchfab, CC BY 4.0, lightened); walnut from Poly Haven (CC0). The mat, riser, case and label are built here. */
const CDN = "https://cdn.jsdelivr.net/npm/three@0.160.0/";
const [THREE, { GLTFLoader }, { EffectComposer }, { RenderPass }, { UnrealBloomPass }, { ShaderPass }, { OutputPass }, { BokehPass }, { RoundedBoxGeometry }] = await Promise.all([
  import(CDN + "+esm"), import(CDN + "examples/jsm/loaders/GLTFLoader.js/+esm"), import(CDN + "examples/jsm/postprocessing/EffectComposer.js/+esm"),
  import(CDN + "examples/jsm/postprocessing/RenderPass.js/+esm"), import(CDN + "examples/jsm/postprocessing/UnrealBloomPass.js/+esm"), import(CDN + "examples/jsm/postprocessing/ShaderPass.js/+esm"),
  import(CDN + "examples/jsm/postprocessing/OutputPass.js/+esm"), import(CDN + "examples/jsm/postprocessing/BokehPass.js/+esm"), import(CDN + "examples/jsm/geometries/RoundedBoxGeometry.js/+esm"),
]);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v)), lerp = (a, b, k) => a + (b - a) * k, seg = (t, a, b) => clamp((t - a) / (b - a));
const ease = { out: k => 1 - Math.pow(1 - k, 3), in: k => k * k * k, inOut: k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2 };
const loadImg = src => new Promise(r => { if (!src) return r(null); const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => r(i); i.onerror = () => r(null); i.src = src; setTimeout(() => r(null), 5000); });
const url = p => new URL(p, location.href).href;
const gltf = p => new GLTFLoader().loadAsync(url(p));

// ---- the timeline, in seconds
const ON = .4, SCAN0 = 1.5, SCAN1 = 3.9, CHECKS = [1.9, 2.5, 3.1, 3.6];
const HAND0 = 4.0, PINCH = 4.8, LIFT = 5.3, OVER = 6.0, DOWN = 6.5, LEAVE = 7.2, LID0 = 7.0, CLICK = 7.6;
const PRINT0 = 8.2, PRINT1 = 10.8, LAND = 10.8, POCKET0 = 11.6, POCKET1 = 12.5, STAND0 = 12.7, SWAP = 14.0;
// ---- sizes in metres: a real card (63 × 88 mm) in a real case
const CW = .063, CL = .088, CT = .0008, SW = .0745, SL = .126, ST = .0085, RISER = .005;
const CARD_Z = SL / 2 - .0045 - CL / 2, LABEL_Z = -SL / 2 + .0045 + .0112, LW = SW * .9, LH = .021;
// ---- where things stand on the mat
const START = V(-.055, RISER + CT / 2, .005);                 // the card on its riser
const CASE_X = .06;                                             // the case lies open to the right; the card goes in at z = 0
const PRN = V(.205, 0, -.005);                                  // the label printer, its slot facing left

export async function create(host) {
  const mobile = Math.min(innerWidth, innerHeight) < 600 || /Android|iPhone|iPad/.test(navigator.userAgent);
  const renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.25 : 1.75)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.setClearColor(0x040305, 1);
  const canvas = renderer.domElement; canvas.className = "g-gl"; host.prepend(canvas);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x040305);
  { const env = new THREE.Scene(); env.background = new THREE.Color(0x020102);
    for (const [c, i, p, s] of [[0xffd9a8, 2.2, [-3, 4, -2], [2, 1.5]], [0xffffff, 1.5, [4, 3, 3], [1.2, 3]], [0xfff0dd, 1.3, [0, 5, 1], [3, .6]], [0xcfe0ff, .6, [0, 1.5, 6], [5, .5]], [0xffffff, .9, [-4, 2, 3], [.4, 3]]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(...s), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i), side: THREE.DoubleSide })); m.position.set(...p); m.lookAt(0, 0, 0); env.add(m); }
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(env, .02).texture; pm.dispose(); }
  const camera = new THREE.PerspectiveCamera(30, 1, .005, 20);

  // film look: bloom, depth of field (not on phones), vignette and grain
  const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
  const bokeh = mobile ? null : new BokehPass(scene, camera, { focus: .2, aperture: .05, maxblur: .01 }); if (bokeh) composer.addPass(bokeh);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .25, .45, .96); composer.addPass(bloom);
  const grade = new ShaderPass({ uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uBlack: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uBlack; varying vec2 vUv; float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 61.7) * 43758.5453); }
      void main(){ vec2 d = vUv - .5; vec3 c = texture2D(tDiffuse, vUv).rgb; c *= 1. - dot(d, d) * 1.3; c += (h(gl_FragCoord.xy) - .5) * .024; gl_FragColor = vec4(c * (1. - uBlack), 1.); }` });
  composer.addPass(grade); composer.addPass(new OutputPass());
  const noDepth = []; if (bokeh) { const r0 = bokeh.render.bind(bokeh); bokeh.render = (...a) => { noDepth.forEach(o => { o.userData.v = o.visible; o.visible = false; }); r0(...a); noDepth.forEach(o => o.visible = o.userData.v); }; }

  const [lampG, prnG] = await Promise.all([gltf("brand/3d/grade/lamp/scene.gltf"), gltf("brand/3d/grade/labeler/scene.gltf")]);

  // ---- the bench: walnut, a black cutting mat
  const tl = new THREE.TextureLoader(), wood = (f, srgb) => { const t = tl.load(url(`brand/3d/sleeve/walnut/walnut_${f}.jpg`)); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 5); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const desk = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshPhysicalMaterial({ map: wood("diff", true), normalMap: wood("nor_gl"), roughnessMap: wood("rough"), color: 0x5a4639, clearcoat: .4, clearcoatRoughness: .35 }));
  desk.rotation.x = -Math.PI / 2; desk.position.y = -.0021; desk.receiveShadow = true; scene.add(desk);
  const matC = document.createElement("canvas"); matC.width = 2048; matC.height = 1536; { const g = matC.getContext("2d");
    g.fillStyle = "#101113"; g.fillRect(0, 0, 2048, 1536);
    const im = g.getImageData(0, 0, 2048, 1536); for (let i = 0; i < im.data.length; i += 4) { const n = (Math.random() - .5) * 8; im.data[i] += n; im.data[i + 1] += n; im.data[i + 2] += n; } g.putImageData(im, 0, 0);
    const px = 2048 / 50;                                       // 50 cm wide: a fine line per cm, a stronger one every 5
    for (let i = 0; i <= 50; i++) { g.strokeStyle = i % 5 ? "rgba(150,160,170,.06)" : "rgba(180,190,200,.13)"; g.lineWidth = i % 5 ? 1 : 1.8; g.beginPath(); g.moveTo(i * px, 0); g.lineTo(i * px, 1536); g.stroke(); }
    for (let j = 0; j <= 38; j++) { g.strokeStyle = j % 5 ? "rgba(150,160,170,.06)" : "rgba(180,190,200,.13)"; g.lineWidth = j % 5 ? 1 : 1.8; g.beginPath(); g.moveTo(0, j * px); g.lineTo(2048, j * px); g.stroke(); }
    g.font = "500 20px 'DM Mono', monospace"; g.fillStyle = "rgba(190,200,210,.35)"; for (let i = 5; i < 50; i += 5) g.fillText(String(i), i * px + 6, 28);
    g.save(); g.translate(1995, 1500); g.rotate(-Math.PI / 2); g.font = "700 24px 'Unbounded', sans-serif"; g.fillStyle = "rgba(231,177,74,.3)"; g.fillText("ZIK HUNTER · LABO D'AUTHENTIFICATION", 0, 0); g.restore(); }
  const matT = new THREE.CanvasTexture(matC); matT.colorSpace = THREE.SRGBColorSpace; matT.anisotropy = 8;
  const mat = new THREE.Mesh(new THREE.BoxGeometry(.5, .002, .38), [0, 0, 0, 0, 0, 0].map((_, i) => i === 2 ? new THREE.MeshStandardMaterial({ map: matT, roughness: .82 }) : new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: .9 })));
  mat.position.set(.06, -.001, -.03); mat.receiveShadow = true; scene.add(mat);

  // ---- the magnifier lamp, behind on the left, its head and lens over the card
  const lamp = lampG.scene; lamp.scale.setScalar(.052); scene.add(lamp);
  lamp.traverse(o => { if (!o.isMesh) return; o.castShadow = true; const m = o.material, n = m.name;
    if (n.startsWith("Branco")) o.material = new THREE.MeshPhysicalMaterial({ color: 0xe9e6df, roughness: .32, clearcoat: .7, clearcoatRoughness: .2 });           // white enamel
    else if (n.startsWith("Vidro")) o.material = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 1, thickness: .006, ior: 1.5, roughness: .02, transparent: true });
    else if (n.startsWith("Filamento")) { o.material = new THREE.MeshBasicMaterial({ color: 0x000000 }); o.userData.bulb = true; }
    else o.material = new THREE.MeshPhysicalMaterial({ color: n.includes("bronze.003") ? 0xb08a52 : 0xa7adb6, metalness: 1, roughness: .35 }); });
  lamp.rotation.y = .32; lamp.position.set(-.25, -.034, -.13);  // the model's base sits a little above its origin
  lamp.updateMatrixWorld(true);
  let bulb; lamp.traverse(o => { if (o.userData.bulb) bulb = o; });
  const bulbP = new THREE.Box3().setFromObject(bulb).getCenter(V());
  const key = new THREE.SpotLight(0xffe2bd, 0, 0, .5, .8, 0); key.position.copy(bulbP); key.target.position.set(-.01, 0, 0); key.castShadow = true;
  key.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048); key.shadow.bias = -.00015; key.shadow.normalBias = .0004; key.shadow.camera.near = .05; scene.add(key, key.target);
  const glow = new THREE.PointLight(0xfff0d8, 0, .25, 2); glow.position.copy(bulbP).add(V(0, -.01, 0)); scene.add(glow);
  const rim = new THREE.DirectionalLight(0x9fb8ff, 0); rim.position.set(.3, .25, -.4); scene.add(rim);
  const fill = new THREE.HemisphereLight(0x2a2433, 0x000000, .25); scene.add(fill);
  const printLight = new THREE.SpotLight(0xf3f6ff, 0, .5, .35, .9, 1.5); printLight.position.set(PRN.x - .05, .14, .1); printLight.target.position.set(PRN.x - .05, .02, 0); scene.add(printLight, printLight.target);

  // ---- the riser the card waits on
  const riser = new THREE.Mesh(new RoundedBoxGeometry(CW - .014, RISER, CL - .014, 2, .0012), new THREE.MeshPhysicalMaterial({ color: 0x0b0b0d, roughness: .55, clearcoat: .25, clearcoatRoughness: .5 }));
  riser.position.set(START.x, RISER / 2, START.z); riser.castShadow = riser.receiveShadow = true; scene.add(riser);

  // ---- the card: a thin board with its face painted for this card
  const FC = document.createElement("canvas"); FC.width = 756; FC.height = 1056; const fg = FC.getContext("2d");
  const faceT = new THREE.CanvasTexture(FC); faceT.colorSpace = THREE.SRGBColorSpace; faceT.anisotropy = 8;
  const grainC = document.createElement("canvas"); grainC.width = grainC.height = 256; { const g = grainC.getContext("2d"), im = g.createImageData(256, 256);
    for (let i = 0; i < im.data.length; i += 4) { const n = 120 + Math.random() * 30; im.data[i] = im.data[i + 1] = im.data[i + 2] = n; im.data[i + 3] = 255; } g.putImageData(im, 0, 0); }
  const grainT = new THREE.CanvasTexture(grainC); grainT.wrapS = grainT.wrapT = THREE.RepeatWrapping; grainT.repeat.set(6, 8);
  const faceM = new THREE.MeshPhysicalMaterial({ map: faceT, roughness: .55, roughnessMap: grainT, bumpMap: grainT, bumpScale: .00004, clearcoat: .22, clearcoatRoughness: .35, specularIntensity: .45 });   // a satin card: the lamp does not blind it
  const card = new THREE.Mesh(new RoundedBoxGeometry(CW, CT, CL, 2, .0003), faceM); card.castShadow = true; card.receiveShadow = true;
  { const back = new THREE.Mesh(new THREE.PlaneGeometry(CW * .98, CL * .98), new THREE.MeshStandardMaterial({ color: 0x1b1622, roughness: .6 })); back.rotation.x = Math.PI / 2; back.position.y = -CT / 2 - .00001; card.add(back); }
  { const g = card.geometry, p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;   // the face on the top only, a pale edge around
    for (let i = 0; i < p.count; i++) { const top = n.getY(i) > .5; uv.setXY(i, top ? (p.getX(i) / CW + .5) : .5, top ? (1 - (p.getZ(i) / CL + .5)) : .995); } uv.needsUpdate = true; }
  const cardG = new THREE.Group(); cardG.add(card); scene.add(cardG);
  // the scan: a fine line of cold light projected on the card, its soft spill, and its glint
  const lineC = document.createElement("canvas"); lineC.width = 8; lineC.height = 512; { const g = lineC.getContext("2d"), gr = g.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(.3, "rgba(90,170,255,.06)"); gr.addColorStop(.485, "rgba(170,225,255,.35)"); gr.addColorStop(.5, "rgba(245,252,255,1)"); gr.addColorStop(.515, "rgba(170,225,255,.35)"); gr.addColorStop(.7, "rgba(90,170,255,.06)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 8, 512); }
  const scanLine = new THREE.Mesh(new THREE.PlaneGeometry(CW + .002, .03), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(lineC), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  scanLine.rotation.x = -Math.PI / 2; scene.add(scanLine); noDepth.push(scanLine);
  const scanLight = new THREE.PointLight(0xbfe4ff, 0, .06, 1.5); scene.add(scanLight);

  // ---- the case: thick polished acrylic in two halves, the label pocket and ribbed grip moulded in
  const acrylic = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 1, thickness: .004, ior: 1.49, roughness: .03, clearcoat: 1, clearcoatRoughness: .02,
    attenuationColor: 0xdfe9f2, attenuationDistance: .25, specularIntensity: 1, envMapIntensity: 1.5 });
  const slab = new THREE.Group(); scene.add(slab);
  const base = new THREE.Mesh(new RoundedBoxGeometry(SW, ST * .5, SL, 4, .002), acrylic); base.position.y = ST * .25; base.castShadow = true; slab.add(base);
  const lid = new THREE.Group(); slab.add(lid);
  const lidM = new THREE.Mesh(new RoundedBoxGeometry(SW, ST * .5, SL, 4, .002), acrylic); lidM.position.y = ST * .75; lid.add(lidM);
  const frost = new THREE.MeshStandardMaterial({ color: 0xcfd6de, roughness: .6, transparent: true, opacity: .2 });
  for (let i = 0; i < 7; i++) { const r = new THREE.Mesh(new THREE.BoxGeometry(SW * .8, .0004, .0004), frost); r.position.set(0, ST + .0002, LABEL_Z + .0122 + i * .0007); lid.add(r); }
  // the label: a thermal label, printed column by column as it leaves the printer
  const LC = document.createElement("canvas"); LC.width = 1400; LC.height = 440; const lg = LC.getContext("2d");
  const labelT = new THREE.CanvasTexture(LC); labelT.colorSpace = THREE.SRGBColorSpace; labelT.anisotropy = 8;
  const label = new THREE.Mesh(new THREE.BoxGeometry(LW, .0003, LH), [0, 0, 0, 0, 0, 0].map((_, i) => i === 2 ? new THREE.MeshPhysicalMaterial({ map: labelT, roughness: .5, clearcoat: .2 }) : new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: .7 })));
  label.castShadow = true; scene.add(label);
  const logo = await loadImg(url("brand/zikhunter-icon.svg"));
  let L = null, printed = -1;
  // the whole label, then everything right of `upto` (0..1 of the width) blanked: the printer has not printed it yet
  function drawLabel(upto, gold) {
    const g = lg, W = 1400, H = 440;
    g.fillStyle = "#fbfaf6"; g.fillRect(0, 0, W, H);
    g.strokeStyle = "#c9962f"; g.lineWidth = 16; g.strokeRect(8, 8, W - 16, H - 16); g.strokeStyle = "rgba(201,150,47,.55)"; g.lineWidth = 4; g.strokeRect(30, 30, W - 60, H - 60);
    g.fillStyle = "#141016"; g.textBaseline = "alphabetic"; g.textAlign = "left";
    const fit = (txt, font, max) => { g.font = font; let t = txt; while (g.measureText(t).width > max && t.length > 3) t = t.slice(0, -2) + "…"; return t; };
    g.font = "700 48px 'Instrument Sans', Arial"; g.fillText(fit(L.l1, g.font, 760), 70, 118);
    g.font = "800 66px 'Instrument Sans', Arial"; g.fillText(fit(L.l2, g.font, 760), 70, 196);
    g.font = "700 48px 'Instrument Sans', Arial"; g.fillText(fit(L.l3, g.font, 760), 70, 264);
    g.fillStyle = L.first ? "#b07a12" : "#7a5410"; g.font = "700 44px 'DM Mono', monospace"; g.fillText(L.l4, 70, 334);
    if (logo) g.drawImage(logo, 860, 115, 190, 190);
    g.textAlign = "right"; g.fillStyle = "#141016"; g.font = "800 52px 'Instrument Sans', Arial"; g.fillText(L.gname, W - 70, 108);
    g.font = "800 210px 'Instrument Sans', Arial";
    if (gold) { const gr = g.createLinearGradient(0, 130, 0, 300); gr.addColorStop(0, "#8a5d14"); gr.addColorStop(.4, "#e2b04a"); gr.addColorStop(.6, "#7a520f"); gr.addColorStop(1, "#c9962f"); g.fillStyle = gr; }
    g.fillText(String(L.grade), W - 70, 296);
    g.fillStyle = "#141016"; let x = W - 330; for (let i = 0; i < 62; i++) { const w = [3, 5, 2, 7, 3, 4][(i * 7 + L.cert) % 6]; if (i % 3 !== 1) g.fillRect(x, 322, w, 50); x += w + 1.6; if (x > W - 70) break; }
    g.font = "500 30px 'DM Mono', monospace"; g.fillText(String(L.cert), W - 70, 404); g.textAlign = "left";
    if (upto < 1) { const x0 = Math.max(0, Math.floor(upto * W)); g.fillStyle = "#fbfaf6"; g.fillRect(x0, 0, W - x0, H);
      g.fillStyle = "rgba(20,16,22,.18)"; g.fillRect(x0 - 3, 0, 3, H); }             // the edge being printed, still warm
    labelT.needsUpdate = true;
  }

  // ---- the label printer, lying on its back, its slot facing the case
  const prn = prnG.scene; prn.scale.setScalar(.0155); prn.rotation.set(-Math.PI / 2, 0, Math.PI / 2); scene.add(prn);
  prn.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.material.roughness = .6; } });
  prn.updateMatrixWorld(true);
  { const b = new THREE.Box3().setFromObject(prn); prn.position.set(PRN.x - b.min.x, -b.min.y - .0005, PRN.z - (b.min.z + b.max.z) / 2); prn.updateMatrixWorld(true); }
  const prnBox = new THREE.Box3().setFromObject(prn), SLOT = V(prnBox.min.x + .002, prnBox.max.y * .55, PRN.z);   // the tape leaves from the end that faces the case


  // ---- the face of the card: artwork, rarity frame, title
  async function paintCard(c) {
    const W = 756, H = 1056, g = fg, im = await loadImg(c.cover);
    g.fillStyle = "#16121f"; g.fillRect(0, 0, W, H);
    if (im) { const s = Math.max(W / im.width, (H * .78) / im.height); g.drawImage(im, (W - im.width * s) / 2, 0, im.width * s, im.height * s); }
    const sh = g.createLinearGradient(0, H * .45, 0, H); sh.addColorStop(0, "rgba(14,10,20,0)"); sh.addColorStop(.55, "rgba(14,10,20,.9)"); sh.addColorStop(1, "#0e0a14"); g.fillStyle = sh; g.fillRect(0, 0, W, H);
    g.strokeStyle = c.color; g.lineWidth = 26; g.beginPath(); g.roundRect(13, 13, W - 26, H - 26, 34); g.stroke();
    g.strokeStyle = "rgba(255,255,255,.25)"; g.lineWidth = 3; g.beginPath(); g.roundRect(30, 30, W - 60, H - 60, 24); g.stroke();
    g.fillStyle = c.color; g.font = "500 30px 'DM Mono', monospace"; g.fillText(c.rarity.toUpperCase(), 62, 88);
    g.fillStyle = "#f6efe2"; g.font = "900 64px 'Unbounded', sans-serif";
    const words = c.title.toUpperCase().split(" "), lines = [""]; for (const w of words) { const t = (lines.at(-1) + " " + w).trim(); g.measureText(t).width > W - 130 && lines.at(-1) ? lines.push(w) : lines[lines.length - 1] = t; }
    lines.slice(-2).forEach((l, i, a) => g.fillText(l, 62, H - 120 - (a.length - 1 - i) * 70));
    g.fillStyle = "rgba(246,239,226,.75)"; g.font = "600 34px 'Instrument Sans', sans-serif"; g.fillText(c.artist, 64, H - 64);
    if (c.holo) { const h = g.createLinearGradient(0, 0, W, H); h.addColorStop(0, "rgba(255,200,90,0)"); h.addColorStop(.5, "rgba(255,210,120,.22)"); h.addColorStop(1, "rgba(255,200,90,0)"); g.fillStyle = h; g.fillRect(0, 0, W, H); }
    faceT.needsUpdate = true;
  }

  // ---- a little foley
  let ac = null; const sfx = () => ac ||= new (window.AudioContext || window.webkitAudioContext)();
  function noise(when, dur, { type = "bandpass", f0 = 800, f1 = f0, q = 1, gain = .3, attack = .01 } = {}) { const a = sfx(), t = a.currentTime + when, n = a.createBuffer(1, Math.ceil(a.sampleRate * (dur + .1)), a.sampleRate), d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(); s.buffer = n; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.setTargetAtTime(0, t + attack, dur / 3); s.connect(f).connect(g).connect(a.destination); s.start(t); s.stop(t + dur + .1); }
  function tone(when, f, dur, gain = .05, type = "sine", f1 = f) { const a = sfx(), t = a.currentTime + when, o = a.createOscillator(), g = a.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + dur); o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + .05); }
  function score(gr) {
    try { const a = sfx(); a.resume();
      noise(ON, .05, { type: "highpass", f0: 2500, gain: .12 }); tone(ON, 55, 1.6, .035);                                // the lamp
      noise(SCAN0, SCAN1 - SCAN0, { f0: 5200, f1: 6200, q: 8, gain: .012, attack: .4 });                                // the scanner's hiss
      CHECKS.forEach((w, i) => tone(w, 1320 + i * 110, .08, .035, "triangle"));
      noise(PINCH, .08, { type: "highpass", f0: 3000, gain: .05 }); noise(DOWN, .1, { f0: 1500, gain: .05 });            // the card taken, laid down
      noise(LID0, CLICK - LID0, { type: "lowpass", f0: 400, f1: 1400, gain: .05, attack: .4 });
      noise(CLICK, .045, { type: "highpass", f0: 1800, gain: .4 }); tone(CLICK, 160, .16, .18, "triangle", 70);          // the click of the case
      for (let w = PRINT0; w < PRINT1; w += .05) noise(w, .045, { f0: 2600 + Math.random() * 600, q: 4, gain: .05 });  // the thermal head, line by line
      tone(PRINT0, 120, PRINT1 - PRINT0, .03, "sawtooth", 118);                                                          // the feed motor
      tone(LAND, 70, .7, .45, "sine", 38); noise(LAND, .25, { type: "lowpass", f0: 600, gain: .2 });
      if (gr >= 9) [1, 1.5, 2, 2.5].forEach((m, i) => tone(LAND + .06 + i * .07, 880 * m, 1.4, .028));
    } catch {}
  }

  let raf = 0, t0 = 0, cues = [], onSwap = null, cardW = 280, cardCy = .45, dog = 0, lost = false, G = 10;
  function swap() { clearTimeout(dog); if (!onSwap) return; const cb = onSwap; onSwap = null; const w = cardW, h = w * 104 / 66, W = host.clientWidth || innerWidth, H = host.clientHeight || innerHeight; cb({ left: (W - w) / 2, top: H * cardCy - h / 2, width: w, height: h }); }
  function fail(e) { console.warn("Labo 3D interrompu", e); lost = true; cancelAnimationFrame(raf); raf = 0; while (cues.length) cues.shift()[1](); swap(); }
  canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); fail("contexte WebGL perdu"); });

  // the case lies open at CASE_X; the card goes in so that its centre ends at z = 0
  const CASE0 = V(CASE_X, 0, -CARD_Z), CARD_IN = V(CASE_X, ST * .5 + CT / 2 - .0006, 0);
  const LABEL_HOME = V(CASE_X, ST + .0006, LABEL_Z - CARD_Z);
  // the camera: [time, position, target]
  const LBL_OUT = SLOT.clone().add(V(-LW / 2, 0, 0));
  const KEYS = [[0, [-.02, .36, .4], [-.02, 0, 0]], [ON + .6, [-.03, .25, .28], [-.03, 0, 0]],
    [SCAN0, [-.13, .07, .12], [START.x, 0, START.z]], [2.7, [-.02, .06, .11], [START.x, 0, START.z]], [SCAN1, [-.09, .055, .13], [START.x, .002, START.z]],
    [PINCH, [-.05, .2, .26], [-.005, .01, 0]], [DOWN, [.02, .19, .25], [.02, .01, 0]], [CLICK, [CASE_X + .01, .16, .2], [CASE_X, .005, -.01]],
    [PRINT0, [LBL_OUT.x - .005, .085, .13], [LBL_OUT.x, .015, LBL_OUT.z]], [PRINT1, [LBL_OUT.x + .002, .075, .1], [LBL_OUT.x, .02, LBL_OUT.z]],
    [POCKET0, [LBL_OUT.x - .03, .13, .17], [(LBL_OUT.x + CASE_X) / 2, .01, -.02]], [POCKET1, [CASE_X, .16, .17], [CASE_X, .005, -.02]],
    [STAND0 + .3, [CASE_X, .1, .22], [CASE_X, .055, 0]], [SWAP + 3, [CASE_X + .01, .1, .27], [CASE_X, .07, 0]]];
  const portrait = () => clamp(.9 / camera.aspect, 1, 2.1);
  function camAt(t) { let i = 0; while (i < KEYS.length - 2 && t > KEYS[i + 1][0]) i++; const a = KEYS[i], b = KEYS[i + 1], k = ease.inOut(seg(t, a[0], b[0])); return [V(...a[1]).lerp(V(...b[1]), k), V(...a[2]).lerp(V(...b[2]), k)]; }
  function resize() { const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight; renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  addEventListener("resize", () => raf && resize());
  // the card's path from the riser to the case
  const PIN0 = V(START.x - CW / 2 + .004, START.y, START.z), PIN_IN = V(CASE_X - CW / 2 + .004, CARD_IN.y, 0);
  const HAND_PATH = [[HAND0, V(-.32, .14, .06)], [PINCH, PIN0.clone().add(V(0, .004, 0))], [PINCH + .15, PIN0], [LIFT, PIN0.clone().add(V(0, .03, 0))],
    [OVER, PIN_IN.clone().add(V(0, .035, 0))], [DOWN, PIN_IN], [DOWN + .25, PIN_IN], [LEAVE, V(-.3, .16, .1)]];
  const handAt = t => { let i = 0; while (i < HAND_PATH.length - 2 && t > HAND_PATH[i + 1][0]) i++; const a = HAND_PATH[i], b = HAND_PATH[i + 1]; return a[1].clone().lerp(b[1], ease.inOut(seg(t, a[0], b[0]))); };

  function frame(now) { try { step(now); } catch (e) { fail(e); } }
  const dev = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (dev) window.__lab = { cardG, slab, label, prn, lamp, SLOT, scene };
  function step(now) {
    const t = (now - t0) / 1000; if (dev) window.__labT = t;
    const [cp, ct] = camAt(t), pk = portrait(); camera.position.copy(ct).add(cp.clone().sub(ct).multiplyScalar(pk)); camera.lookAt(ct);
    if (dev && window.labCam) { camera.position.set(...window.labCam[0]); camera.lookAt(...window.labCam[1]); }   // local preview: a fixed camera to inspect
    // the lamp: a flicker, then on; dimmed while the label prints in the dark; gold (or cold silver) when a high grade lands
    const on = t < ON ? 0 : t < ON + .07 ? .6 : t < ON + .13 ? .1 : seg(t, ON + .13, ON + .5);
    const dark = seg(t, PRINT0 - .4, PRINT0) * (1 - seg(t, LAND + .3, POCKET0));
    const land = seg(t, LAND, LAND + .5), hi = new THREE.Color(G === 10 ? 0xffc54d : G === 9 ? 0xdfe9ff : 0xffe2bd);
    key.color.set(0xffe2bd).lerp(hi, land); key.intensity = 2.2 * on * (1 - dark * .88);
    glow.intensity = .015 * on; bulb.material.color.setScalar(1.1 * on * (1 - dark * .7));
    rim.intensity = (.4 + land * (G >= 9 ? 1.1 : .25)) * on; fill.intensity = .25 * (1 - dark * .7);
    printLight.intensity = .3 * dark + (G === 10 ? .2 : 0) * land * dark; printLight.color.set(0xf3f6ff).lerp(hi, land);
    bloom.strength = .25 + land * (G === 10 ? .3 : G === 9 ? .15 : 0);
    // the scan: a fine line of light glides along the card and back
    const sc = seg(t, SCAN0, SCAN1), pass = sc < .5 ? sc * 2 : 2 - sc * 2, bz = START.z + lerp(-CL / 2 - .002, CL / 2 + .002, ease.inOut(pass));
    const sOn = Math.sin(Math.PI * sc) ** .35;
    scanLine.material.opacity = t > SCAN0 && t < SCAN1 ? .9 * sOn : 0; scanLine.position.set(START.x, START.y + CT / 2 + .0002, clamp(bz, START.z - CL / 2, START.z + CL / 2));
    scanLight.intensity = t > SCAN0 && t < SCAN1 ? .025 * sOn : 0; scanLight.position.set(START.x, START.y + .012, bz);
    // the card rises off its riser, glides over and settles into the open case, tilting a little on the way
    if (t < PINCH + .15) cardG.position.copy(START);
    else if (t < DOWN + .25) { cardG.position.copy(handAt(t)).add(V(CW / 2 - .004, 0, 0)); const m = seg(t, PINCH + .15, DOWN); cardG.rotation.set(Math.sin(m * Math.PI) * .12, 0, -Math.sin(m * Math.PI) * .18); }
    if (t >= DOWN + .25 && t < STAND0) { cardG.position.copy(CARD_IN); cardG.rotation.set(0, 0, 0); }
    // the lid comes down and clicks
    const ld = ease.out(seg(t, LID0, CLICK)); lid.position.y = lerp(.06, 0, ld); lid.visible = t > LID0 - .05;
    const bump = t > CLICK && t < CLICK + .12 ? Math.sin(seg(t, CLICK, CLICK + .12) * Math.PI) * .0006 : 0;
    // the label: fed out of the printer from its left edge, printed as it comes out, the grade last; then into its pocket
    const fk = seg(t, PRINT0, PRINT1), fed = ease.inOut(fk);
    label.visible = t > PRINT0;
    const pk2 = ease.inOut(seg(t, POCKET0, POCKET1));
    // only what has come out exists: the label grows from the slot, showing the left part of its print
    const outLen = Math.max(.0005, fed);
    const outPos = SLOT.clone().add(V(-LW * outLen / 2, 0, 0));
    label.scale.x = t < POCKET0 ? outLen : 1; labelT.repeat.x = t < POCKET0 ? outLen : 1;
    if (t < POCKET0) { label.position.copy(outPos); label.rotation.set(0, 0, 0); }
    else { label.position.copy(SLOT.clone().add(V(-LW / 2, 0, 0))).lerp(LABEL_HOME, pk2); label.position.y += Math.sin(pk2 * Math.PI) * .03; label.rotation.set(0, 0, Math.sin(pk2 * Math.PI) * .2); }
    const up = 1;                                                       // what is out is printed
    const key2 = Math.round(up * 140); if (key2 !== printed) { printed = key2; drawLabel(up, G === 10 && t >= LAND); }
    // standing up to face the camera, case, card and label together
    const sk = ease.inOut(seg(t, STAND0, SWAP - .2));
    slab.position.set(CASE0.x, lerp(0, SL / 2 * Math.sin(Math.PI * .42) + .006, sk) + bump,   // high enough: the lower end clears the mat
       lerp(CASE0.z, -CARD_Z * .2, sk)); slab.rotation.x = sk * Math.PI * .42;   // the label end goes up, the card faces the camera
    if (t >= STAND0) { cardG.position.copy(slab.localToWorld(V(0, ST * .5 + CT / 2 - .0006, CARD_Z))); cardG.rotation.copy(slab.rotation);
      label.position.copy(slab.localToWorld(V(0, ST + .0006, LABEL_Z))); label.rotation.copy(slab.rotation); }
    else if (t < PINCH + .15 || t >= DOWN + .25) cardG.rotation.set(0, 0, 0);
    if (t >= SWAP) slab.visible = cardG.visible = label.visible = false;      // the real case (HTML) is in front now: the bench stays, blurred
    else { slab.visible = true; cardG.visible = true; }
    while (cues.length && t >= cues[0][0]) cues.shift()[1]();
    if (t >= SWAP) swap();
    grade.uniforms.uTime.value = now / 1000 % 100; grade.uniforms.uBlack.value = t < ON ? 1 : t < 1 ? .6 * (1 - seg(t, ON, 1)) : 0;
    if (bokeh) { const fp = t < SCAN1 ? V(START.x, 0, bz) : t < CLICK ? cardG.position : t < POCKET0 ? label.position : slab.position;
      bokeh.uniforms.focus.value = camera.position.distanceTo(fp); bokeh.uniforms.aperture.value = t >= SWAP ? .12 : t > PRINT0 && t < POCKET0 ? .09 : .05; }
    composer.render(); raf = requestAnimationFrame(frame);
  }

  return {
    // card: { cover, title, artist, rarity, color, holo }; label: { l1, l2, l3, l4, gname, grade, cert }
    // on.start: first frame drawn; on.check(i): each check of the scan; on.land: the grade is printed. Resolves with the rect of the case at the end.
    async play({ card: c, label: l, w = 280, cy = .45, on = {} }) {
      if (lost) throw new Error("3D perdue");
      cardW = w; cardCy = cy; G = l.grade; L = l; printed = -1;
      await paintCard(c); drawLabel(0, false); resize();
      cues = [[0, on.start], ...CHECKS.map((w, i) => [w, () => on.check?.(i)]), [LAND, on.land]].filter(x => x[1]);
      const skip = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? +(window.labSkip || 0) : 0;   // local preview (?labskip=6): jump into the film
      return new Promise(res => { onSwap = res; t0 = performance.now() - skip * 1000; score(G); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
        clearTimeout(dog); dog = setTimeout(() => fail("trop lent"), (SWAP + 3) * 1000); });
    },
    async warmup() { resize(); L = { l1: "", l2: "", l3: "", l4: "", gname: "", grade: 0, cert: 0 }; drawLabel(1, false); camera.position.set(0, .25, .3); camera.lookAt(0, 0, 0);
      label.visible = lid.visible = true; scanLine.material.opacity = .5;
      try { await Promise.race([renderer.compileAsync(scene, camera), new Promise(r => setTimeout(r, 4000))]); } catch {} composer.render(); },
    stop() { cancelAnimationFrame(raf); raf = 0; clearTimeout(dog); onSwap = null; cues = []; },
    get lost() { return lost; },
    canvas,
  };
}
