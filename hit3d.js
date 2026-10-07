/* Zik Hunter — the hit reveal in 3D, shot like a product film: a real turntable on a dark glossy floor, one beam
   of light through haze, dust floating in it. The record drops on the platter, the tone arm lands, the light takes
   the colour of the hit and the card rises out of the record.
   Turntable: "Yamaha TT-300 Record Player" by AleixoAlonso, CC BY 4.0 (brand marks removed from the texture).
   Loaded only when a booster holds a hit. The page keeps the HTML card, title and sparks on top. */
const CDN = "https://cdn.jsdelivr.net/npm/three@0.160.0/";
const [THREE, { GLTFLoader }, { EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }, { RoomEnvironment }] = await Promise.all([
  import(CDN + "+esm"),
  import(CDN + "examples/jsm/loaders/GLTFLoader.js/+esm"),
  import(CDN + "examples/jsm/postprocessing/EffectComposer.js/+esm"),
  import(CDN + "examples/jsm/postprocessing/RenderPass.js/+esm"),
  import(CDN + "examples/jsm/postprocessing/UnrealBloomPass.js/+esm"),
  import(CDN + "examples/jsm/postprocessing/OutputPass.js/+esm"),
  import(CDN + "examples/jsm/environments/RoomEnvironment.js/+esm"),
]);

const ease = {
  out: t => 1 - Math.pow(1 - t, 3),
  inOut: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  soft: t => t * t * (3 - 2 * t),
  drop: t => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + .75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + .9375; return n * (t -= 2.625 / d) * t + .984375; },
};
const lerp = (a, b, t) => a + (b - a) * t;
const loadImg = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });

export async function create(host) {
  const mobile = Math.min(innerWidth, innerHeight) < 600 || /Android|iPhone|iPad/.test(navigator.userAgent);
  const renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.5 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = mobile ? 1.15 : 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x020203, 1);
  const canvas = renderer.domElement; canvas.className = "fx-gl";
  host.prepend(canvas);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x020203, .085);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
  const camera = new THREE.PerspectiveCamera(30, 1, .05, 80);

  const composer = mobile ? null : new EffectComposer(renderer);
  let bloom = null;
  if (composer) {
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .3, .6, .9);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  const [gltf, logo] = await Promise.all([
    new GLTFLoader().loadAsync(new URL(mobile ? "brand/3d/turntable-1k.gltf?v=2" : "brand/3d/turntable.gltf?v=2", location.href).href),
    loadImg("brand/zikhunter-icon.svg"),
  ]);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const texOf = cv => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; return t; };

  /* ---------- the turntable model ---------- */
  const model = gltf.scene;
  const byName = n => { let f = null; model.traverse(o => { if (!f && o.name === n) f = o; }); return f; };
  byName("#RPL0002_Cover")?.removeFromParent();              // no dust cover: we want to see the record
  model.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    o.material.envMapIntensity = .55;
  });
  const deck = new THREE.Group(); deck.add(model); scene.add(deck);
  // size it (3.5 units wide) and put the platter's centre at the origin
  let box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  deck.scale.setScalar(3.5 / size.x);
  deck.updateMatrixWorld(true);
  const platterNode = byName("#RPL0002_Platter"), armNode = byName("#RPL0002_Tone_Arm");
  const platterMesh = platterNode.children.find(c => c.isMesh) || platterNode;
  const pBox = new THREE.Box3().setFromObject(platterMesh), pc = pBox.getCenter(new THREE.Vector3());
  deck.position.set(-pc.x, -pBox.max.y, -pc.z);
  deck.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(model);
  const FLOOR_Y = box.min.y;

  // the platter's own frame is Z-up, in the model's units: the record is built in it and turns with it
  const P_TOP = .0159, R_REC = .1505;
  function vinylTexture(light = false) {        // light: a pale version, tinted gold by the material for the GOD pack
    const S = 2048, cv = document.createElement("canvas"); cv.width = cv.height = S;
    const g = cv.getContext("2d"), c = S / 2;
    g.fillStyle = light ? "#c8c8c8" : "#18181b"; g.fillRect(0, 0, S, S);
    for (let r = c * .36; r < c * .985; r += 1.5) {
      const v = light ? 150 + Math.random() * 90 : 20 + Math.random() * 14;
      g.strokeStyle = `rgb(${v},${v},${v + 2})`; g.lineWidth = 1; g.beginPath(); g.arc(c, c, r, 0, 7); g.stroke();
    }
    for (const f of [.48, .61, .74, .87]) { g.strokeStyle = light ? "#6a6a6a" : "#0b0b0d"; g.lineWidth = S * .004; g.beginPath(); g.arc(c, c, c * f, 0, 7); g.stroke(); }
    g.strokeStyle = light ? "#f0f0f0" : "#26262a"; g.lineWidth = S * .008; g.beginPath(); g.arc(c, c, c * .978, 0, 7); g.stroke();
    return texOf(cv);
  }
  function labelTexture(shiny) {
    const S = 1024, cv = document.createElement("canvas"); cv.width = cv.height = S;
    const g = cv.getContext("2d"), c = S / 2;
    const bg = g.createRadialGradient(c * .7, c * .6, 0, c, c, c);
    if (shiny) { bg.addColorStop(0, "#2c241a"); bg.addColorStop(1, "#0b0907"); } else { bg.addColorStop(0, "#ffffff"); bg.addColorStop(1, "#d4d4d4"); }
    g.fillStyle = bg; g.beginPath(); g.arc(c, c, c, 0, 7); g.fill();
    g.strokeStyle = shiny ? "#f5d27a" : "rgba(0,0,0,.4)"; g.lineWidth = 5; g.beginPath(); g.arc(c, c, c * .93, 0, 7); g.stroke();
    if (logo) { g.save(); if (!shiny) g.filter = "brightness(0) opacity(.8)"; g.drawImage(logo, c - c * .4, c - c * .56, c * .8, c * .8); g.restore(); }
    g.fillStyle = shiny ? "#f5d27a" : "rgba(0,0,0,.75)"; g.textAlign = "center";
    g.font = `600 ${S * .05}px "DM Mono", Menlo, monospace`; g.fillText("ZIK HUNTER · FACE A", c, c + c * .52);
    g.font = `500 ${S * .036}px "DM Mono", Menlo, monospace`; g.fillText("33 ⅓ TOURS", c, c + c * .67);
    g.fillStyle = "#050505"; g.beginPath(); g.arc(c, c, c * .06, 0, 7); g.fill();
    return texOf(cv);
  }
  function godLabelTexture() {
    const S = 1024, cv = document.createElement("canvas"); cv.width = cv.height = S;
    const g = cv.getContext("2d"), c = S / 2;
    const bg = g.createRadialGradient(c * .7, c * .6, 0, c, c, c); bg.addColorStop(0, "#1d1810"); bg.addColorStop(1, "#060504");
    g.fillStyle = bg; g.beginPath(); g.arc(c, c, c, 0, 7); g.fill();
    g.strokeStyle = "#f5c24d"; g.lineWidth = 8; g.beginPath(); g.arc(c, c, c * .93, 0, 7); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.arc(c, c, c * .86, 0, 7); g.stroke();
    if (logo) g.drawImage(logo, c - c * .3, c - c * .66, c * .6, c * .6);
    g.fillStyle = "#f5c24d"; g.textAlign = "center";
    g.font = `900 ${S * .11}px "Unbounded", "Arial Black", sans-serif`; g.fillText("GOD PACK", c, c + c * .3);
    g.font = `500 ${S * .036}px "DM Mono", Menlo, monospace`; g.fillText("1 CHANCE SUR 3 000", c, c + c * .5);
    g.fillStyle = "#050505"; g.beginPath(); g.arc(c, c, c * .06, 0, 7); g.fill();
    return texOf(cv);
  }
  const vinylTex = vinylTexture(), goldTex = vinylTexture(true);
  const recordMat = new THREE.MeshPhysicalMaterial({ map: vinylTex, emissiveMap: vinylTex, color: 0x6a6a70, roughness: .36, metalness: .1, clearcoat: 1, clearcoatRoughness: .1, envMapIntensity: .8 });
  const labelPlain = labelTexture(false), labelShiny = labelTexture(true), labelGod = godLabelTexture();
  const labelMat = new THREE.MeshStandardMaterial({ map: labelPlain, color: 0xd9ad5b, roughness: .55 });
  const record = new THREE.Group();
  const recTop = new THREE.Mesh(new THREE.CircleGeometry(R_REC, 160), recordMat); recTop.position.z = .0021; record.add(recTop);
  const recEdge = new THREE.Mesh(new THREE.CylinderGeometry(R_REC, R_REC, .002, 160, 1, true), new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: .3 }));
  recEdge.rotation.x = Math.PI / 2; recEdge.position.z = .001; record.add(recEdge);
  const label = new THREE.Mesh(new THREE.CircleGeometry(.05, 96), labelMat); label.position.z = .00225; record.add(label);
  record.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
  platterNode.add(record);
  const REC_Z = P_TOP;

  // the tone arm turns around the pivot (Z), lifts around X; find the angle that puts the needle on the outer tracks
  armNode.rotation.order = "ZXY";
  const pivotNode = armNode.parent;
  const TIP = new THREE.Vector2(.015, -.232);
  const PIV = new THREE.Vector2(pivotNode.position.x - platterNode.position.x, pivotNode.position.y - platterNode.position.y);
  let YAW_PLAY = 0;
  for (let a = 0, best = 9; a < 1.4; a += .002) for (const s of [-1, 1]) {
    const yaw = a * s, x = TIP.x * Math.cos(yaw) - TIP.y * Math.sin(yaw), y = TIP.x * Math.sin(yaw) + TIP.y * Math.cos(yaw);
    const d = Math.abs(Math.hypot(PIV.x + x, PIV.y + y) - .132);
    if (d < best - 1e-4) { best = d; YAW_PLAY = yaw; }
    if (best < .001) break;
  }
  const LIFT_UP = -.13, LIFT_PLAY = -.05;                       // radians around X (negative raises the head)
  const tipWorld = () => armNode.localToWorld(new THREE.Vector3(TIP.x, TIP.y, -.01));

  /* ---------- the floor: dark and glossy, it catches the beam and the deck's shadow ---------- */
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: .32, metalness: .55, envMapIntensity: .25 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR_Y; floor.receiveShadow = true; scene.add(floor);

  /* ---------- light: a key spot from above with its visible beam in the haze, a rim behind, a glow on the record ---------- */
  scene.add(new THREE.HemisphereLight(0x8890a0, 0x000000, .08));
  const KEY_POS = new THREE.Vector3(-.4, 6, .8);
  const key = new THREE.SpotLight(0xfff1dc, 0, 16, .42, .7, 1.4);
  key.position.copy(KEY_POS); key.target.position.set(.15, 0, 0); scene.add(key, key.target);
  key.castShadow = true; key.shadow.mapSize.set(mobile ? 512 : 1024, mobile ? 512 : 1024); key.shadow.bias = -.0004; key.shadow.radius = 6;
  key.shadow.camera.near = 2; key.shadow.camera.far = 12;
  const rim = new THREE.SpotLight(0xffffff, 0, 14, .5, .8, 1.2); rim.position.set(.5, 3.2, -5); rim.target.position.set(0, 0, 0); scene.add(rim, rim.target);
  const glow = new THREE.PointLight(0xffffff, 0, 2.6, 2); glow.position.set(-.6, .5, -.5); scene.add(glow);

  // a cone of light drawn in the haze: brighter near the lamp, soft on the edges, fading to the floor
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { color: { value: new THREE.Color(0xfff1dc) }, strength: { value: 0 }, height: { value: 1 } },
    vertexShader: `uniform float height; varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ vY = position.y / height + .5; vec4 wp = modelMatrix * vec4(position,1.); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 color; uniform float strength; varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ float y = clamp(vY, 0., 1.);
        float edge = pow(clamp(abs(dot(normalize(vN), normalize(vV))), 0., 1.), 2.2);
        float along = pow(y, 1.6) * (1. - smoothstep(.9, 1., y)) * smoothstep(0., .25, y);
        vec3 c = color * strength * edge * along;
        gl_FragColor = vec4(clamp(c, 0., 4.), 1.); }`,   // clamped: one invalid pixel would turn into a black block in the bloom
  });
  function beam(from, to, radius) {
    const dir = to.clone().sub(from), h = dir.length();
    const m = new THREE.Mesh(new THREE.ConeGeometry(radius, h, 64, 1, true), beamMat.clone());
    m.material.uniforms.height.value = h;
    m.position.copy(from).addScaledVector(dir, .5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
    m.renderOrder = 2; scene.add(m);
    return m;
  }
  const mainBeam = beam(KEY_POS, new THREE.Vector3(.15, FLOOR_Y, 0), 2.3);
  // two coloured side beams for Légendaire / Shiny, sweeping slowly
  const sideBeams = [-1, 1].map(s => { const b = beam(new THREE.Vector3(s * 4.5, 5.5, -3.5), new THREE.Vector3(s * .6, FLOOR_Y, .4), 1.5); b.visible = false; return b; });

  // dust floating in the beam
  const DUST = mobile ? 160 : 360;
  const dustGeo = new THREE.BufferGeometry(), dustPos = new Float32Array(DUST * 3), dustSeed = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) {
    const t = Math.random(), a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 2.1 * (1 - t * .85);
    const p = new THREE.Vector3(.15, FLOOR_Y, 0).lerp(KEY_POS, t);
    dustPos.set([p.x + Math.cos(a) * r, p.y, p.z + Math.sin(a) * r], i * 3); dustSeed[i] = Math.random() * 100;
  }
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dotCv = document.createElement("canvas"); dotCv.width = dotCv.height = 32;
  { const g = dotCv.getContext("2d"), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); }
  const dotTex = new THREE.CanvasTexture(dotCv);
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: dotTex, size: .035, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfff1dc }));
  scene.add(dust);
  const dustBase = dustPos.slice();

  /* ---------- the card that rises out of the record ---------- */
  function cardBackTexture() {
    const W = 630, H = 880, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const g = cv.getContext("2d"), rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, "#221d2b"); bg.addColorStop(1, "#0d0b11");
    g.fillStyle = bg; rr(0, 0, W, H, 34); g.fill();
    g.strokeStyle = "#e7b14a"; g.lineWidth = 6; rr(18, 18, W - 36, H - 36, 24); g.stroke();
    g.strokeStyle = "rgba(231,177,74,.35)"; g.lineWidth = 2; rr(34, 34, W - 68, H - 68, 18); g.stroke();
    if (logo) g.drawImage(logo, W / 2 - 170, H / 2 - 220, 340, 340);
    g.fillStyle = "#e7b14a"; g.font = `900 52px "Unbounded", "Arial Black", sans-serif`; g.textAlign = "center"; g.fillText("ZIK HUNTER", W / 2, H / 2 + 190);
    return texOf(cv);
  }
  const card = new THREE.Group(); scene.add(card); card.visible = false;
  const CARD_H = .9, CARD_W = CARD_H * 63 / 88;
  const cardFace = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W, CARD_H), new THREE.MeshBasicMaterial({ map: cardBackTexture(), side: THREE.DoubleSide, fog: false }));
  card.add(cardFace);
  const plainBack = cardFace.material.map, backs = {};   // demo: the back of the booster being opened (vinyl, equaliser)
  const backStill = k => backs[k] ??= (window.Studio?.still("back-" + k) || Promise.resolve(null)).then(c => c && texOf(c));
  backStill("vinyl"); backStill("eq");
  const cardHalo = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W * 3.2, CARD_H * 2.6), new THREE.MeshBasicMaterial({ map: dotTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  cardHalo.position.z = -.03; card.add(cardHalo);

  // the GOD pack: five cards born from the broken gold record, turning in a ring around the deck
  const ring = Array.from({ length: 5 }, () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(cardFace.geometry, cardFace.material));
    const h = new THREE.Mesh(cardHalo.geometry, cardHalo.material.clone()); h.position.z = -.03; h.scale.setScalar(.55); g.add(h);
    g.visible = false; scene.add(g);
    return { g, halo: h, free: true };
  });
  const RING_R = 2.25, RING_Y = 1.1;
  let ringOn = 0, ringAngle = 0, orbit = 0, orbitA = 0, shake = 0;
  const deckBase = new THREE.Vector3();

  /* ---------- clock and tweens ---------- */
  let raf = 0, last = 0, time = 0;
  let spin = 0, spinTo = 0, angle = 0, bpm = 120, pulse = 0, beatOn = false, calm = 0, drift = 0, sideOn = 0;
  const driftBase = new THREE.Vector3();
  const tweens = new Set();
  const tween = (ms, fn, e = ease.inOut) => new Promise(res => tweens.add({ t: 0, ms, fn, e, res }));

  /* ---------- camera ---------- */
  const look = new THREE.Vector3();
  // where the needle will be once playing (for the close shot)
  armNode.rotation.set(LIFT_PLAY, 0, YAW_PLAY); armNode.updateMatrixWorld(true);
  const tipAtPlay = tipWorld();
  armNode.rotation.set(0, 0, 0); armNode.updateMatrixWorld(true);
  const portraitK = () => camera.aspect < 1.1 ? Math.min(3, 1.15 / Math.max(.4, camera.aspect)) : 1;
  function shots() {
    const k = portraitK(), side = camera.aspect < 1.1 ? .45 : 1;
    return {
      low: { p: new THREE.Vector3(2.3 * side, .5, 2.6 * k), l: new THREE.Vector3(0, .05, 0) },
      wide: { p: new THREE.Vector3(1.6 * side, 2.4 * k, 4.4 * k), l: new THREE.Vector3(.2, -.1, 0) },
      needle: { p: tipAtPlay.clone().add(new THREE.Vector3(.9 * side, .75, 1.25).multiplyScalar(Math.min(1.6, k))), l: tipAtPlay.clone() },
      high: { p: new THREE.Vector3(.9 * side, 3.1 * k, 3.9 * k), l: new THREE.Vector3(.1, 0, 0) },
    };
  }
  const camA = { p: new THREE.Vector3(), l: new THREE.Vector3() };
  const moveCam = (to, ms, e = ease.inOut) => { camA.p.copy(camera.position); camA.l.copy(look); return tween(ms, k => { camera.position.lerpVectors(camA.p, to.p, k); look.lerpVectors(camA.l, to.l, k); camera.lookAt(look); }, e); };
  const setShot = s => { camera.position.copy(s.p); look.copy(s.l); camera.lookAt(look); };

  function resize() {
    const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight;
    renderer.setSize(w, h, false); composer?.setSize(w, h); bloom?.resolution.set(w / 2, h / 2);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  addEventListener("resize", () => raf && resize());

  function frame(t) {
    const dt = Math.min(.05, (t - (last || t)) / 1000); last = t; time += dt;
    for (const tw of tweens) { tw.t = Math.min(1, tw.t + dt * 1000 / tw.ms); tw.fn(tw.e(tw.t), tw.t); if (tw.t >= 1) { tweens.delete(tw); tw.res(); } }
    spin += (spinTo - spin) * Math.min(1, dt * 1.6);
    angle -= spin * Math.PI * 2 * dt;                          // clockwise seen from above
    platterNode.rotation.z = angle;
    pulse = beatOn ? Math.exp(-((time * bpm / 60) % 1) * 5) : pulse * .9;
    glow.intensity = (.4 + pulse * .25) * calm * (mobile ? 1.6 : 1);
    // dust drifts slowly upward and sideways
    const pa = dust.geometry.attributes.position;
    for (let i = 0; i < DUST; i++) {
      const s = dustSeed[i];
      pa.array[i * 3] = dustBase[i * 3] + Math.sin(time * .3 + s) * .08;
      pa.array[i * 3 + 1] = dustBase[i * 3 + 1] + ((time * .05 + s) % 1) * .3;
      pa.array[i * 3 + 2] = dustBase[i * 3 + 2] + Math.cos(time * .25 + s) * .08;
    }
    pa.needsUpdate = true;
    if (sideOn) sideBeams.forEach((b, i) => { b.rotation.z = Math.sin(time * .35 + i * 2) * .12; });
    if (ringOn) {                                             // the ring of cards turns slowly; each card faces the camera
      ringAngle += dt * .22 * ringOn;
      ring.forEach((c, j) => {
        if (!c.free) return;
        const a = ringAngle + j * Math.PI * 2 / 5;
        c.g.position.set(Math.cos(a) * RING_R, RING_Y + Math.sin(time * 1.3 + j) * .06, Math.sin(a) * RING_R);
        c.g.lookAt(camera.position);
      });
    }
    if (orbit) {                                              // the camera circles the deck
      orbitA += dt * .1 * orbit;
      const k = Math.min(portraitK(), 1.45);                  // on a phone, close enough to keep the deck in view
      camera.position.set(Math.sin(orbitA) * 7.6 * k, 3.4 * k, Math.cos(orbitA) * 7.6 * k);
      look.set(0, .55, 0); camera.lookAt(look);
    }
    if (shake) deck.position.set(deckBase.x + (Math.random() - .5) * .025 * shake, deckBase.y + (Math.random() - .5) * .015 * shake, deckBase.z + (Math.random() - .5) * .025 * shake);
    if (drift) {                                              // a slow drift of the camera while the card is shown
      const a = time * .15;
      camera.position.set(driftBase.x + Math.sin(a) * .3 * drift, driftBase.y + Math.sin(a * .7) * .06 * drift, driftBase.z);
      camera.lookAt(look);
    }
    composer ? composer.render() : renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }

  const lightColor = new THREE.Color(0xfff1dc);
  function light(hex, ms = 700) {
    const from = rim.color.clone(), to = new THREE.Color(hex), c = new THREE.Color();
    return tween(ms, k => { c.lerpColors(from, to, k); paint(c); }, ease.soft);
  }
  function paint(c) {                                         // the colour of the light, everywhere at once
    key.color.copy(c).lerp(lightColor, .65);
    mainBeam.material.uniforms.color.value.copy(c).lerp(lightColor, .35);
    rim.color.copy(c); glow.color.copy(c); dust.material.color.copy(c).lerp(lightColor, .3);
    sideBeams.forEach(b => b.material.uniforms.color.value.copy(c));
    cardHalo.material.color.copy(c);
  }

  return {
    // 1. darkness; the lamp lights up through the haze; the record drops on the platter; the camera rises to 3/4
    async intro({ shiny, big, god }) {
      resize(); tweens.clear(); last = 0; time = 0; renderer.shadowMap.autoUpdate = true;
      ringOn = 0; orbit = 0; shake = 0; record.visible = true; deckBase.copy(deck.position);
      ring.forEach(c => { c.g.visible = false; c.free = true; });
      recordMat.emissiveIntensity = 1; recordMat.metalness = .1; recordMat.roughness = .36;
      recordMat.map = recordMat.emissiveMap = god ? goldTex : vinylTex; recordMat.needsUpdate = true;
      spin = spinTo = 0; beatOn = false; pulse = 0; calm = 0; drift = 0; sideOn = 0;
      card.visible = false; cardHalo.material.opacity = 0;
      const bk = await backStill(document.documentElement.dataset.back || "vinyl");
      cardFace.material.map = bk || plainBack; cardFace.material.transparent = !!bk; cardFace.material.needsUpdate = true;
      labelMat.map = god ? labelGod : shiny ? labelShiny : labelPlain; labelMat.color.set(shiny || god ? 0xffffff : 0xd9ad5b); labelMat.needsUpdate = true;
      recordMat.color.set(god ? 0xe0b25a : 0x6a6a70); recordMat.emissive.set(0);
      if (god) { recordMat.color.set(0xd9a640); recordMat.metalness = 1; recordMat.roughness = .24; recordMat.envMapIntensity = 1.4; }   // a solid gold record
      else recordMat.envMapIntensity = .8;
      paint(lightColor); key.intensity = rim.intensity = 0; mainBeam.material.uniforms.strength.value = 0; dust.material.opacity = 0;
      sideBeams.forEach(b => { b.visible = !!big; b.material.uniforms.strength.value = 0; });
      armNode.rotation.set(0, 0, 0);
      record.position.z = REC_Z + .12; record.rotation.x = .3;
      if (bloom) bloom.strength = .3;
      setShot(shots().low);
      cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
      tween(1100, k => { key.intensity = 34 * k; mainBeam.material.uniforms.strength.value = .38 * k; dust.material.opacity = .55 * k; rim.intensity = 10 * k; }, ease.soft);
      moveCam(shots().wide, 2300);
      await tween(500, () => {});
      await tween(850, k => { record.position.z = lerp(REC_Z + .12, REC_Z, k); record.rotation.x = lerp(.3, 0, Math.min(1, k * 1.25)); }, ease.drop);
      spinTo = .55;                                            // 33 rpm
      await tween(700, () => {});
    },
    // 2. the camera comes close to the arm; it lifts, swings, lowers; resolves on the touch (the music starts there)
    async needle(hex, tempo, big) {
      bpm = tempo || 120;
      moveCam(shots().needle, 1300);
      await tween(260, k => { armNode.rotation.x = lerp(0, LIFT_UP, k); }, ease.out);
      await tween(780, k => { armNode.rotation.z = lerp(0, YAW_PLAY, k); }, ease.inOut);
      await tween(380, k => { armNode.rotation.x = lerp(LIFT_UP, LIFT_PLAY, k); }, ease.soft);
      // the light floods with the colour of the hit
      const to = new THREE.Color(hex), c = new THREE.Color();
      const recFrom = new THREE.Color(0x6a6a70), recTo = to.clone().lerp(new THREE.Color(0), .4), labFrom = new THREE.Color(0xd9ad5b);
      beatOn = true;
      tween(1000, k => {
        c.lerpColors(lightColor, to, k); paint(c);
        if (labelMat.map === labelPlain) labelMat.color.lerpColors(labFrom, to, k);
        if (labelMat.map !== labelGod) recordMat.color.lerpColors(recFrom, recTo, k);
        recordMat.emissive.copy(to).multiplyScalar(.025 * k);
        calm = k; mainBeam.material.uniforms.strength.value = lerp(.38, .55, k); rim.intensity = lerp(10, 16, k);
        if (big) { sideOn = 1; sideBeams.forEach(b => { b.material.uniforms.strength.value = .45 * k; }); }
        if (bloom) bloom.strength = lerp(.3, big ? .55 : .4, k);
      }, ease.out);
      spinTo = big ? 1 : .75;
      return { swell: () => moveCam(shots().high, big ? 1500 : 1150) };
    },
    // 3. the card rises out of the record's centre, turning, and stops facing the screen at `px` pixels high with its
    //    centre at `cy` (0..1 from the top); resolves with its rectangle so the HTML card can take over exactly there
    async emerge(px, cy) {
      const W = host.clientWidth || innerWidth, H = host.clientHeight || innerHeight;
      const fovH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const dist = CARD_H * H / (px * fovH);
      const ray = new THREE.Vector3(0, 1 - 2 * cy, .5).unproject(camera).sub(camera.position).normalize();
      const end = camera.position.clone().addScaledVector(ray, dist);
      const start = new THREE.Vector3(0, .05, 0);
      const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), face = camera.quaternion.clone();
      const q = new THREE.Quaternion(), spinQ = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
      renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;   // nothing moves on the deck any more but the platter
      card.visible = true; card.position.copy(start); card.quaternion.copy(flat); card.scale.setScalar(.3);
      spinTo = .35;
      if (bloom) bloom.strength += .1;
      await tween(1150, (k, raw) => {
        card.position.lerpVectors(start, end, k); card.position.y += Math.sin(Math.min(1, raw * 1.1) * Math.PI) * .3 * (1 - k);
        q.slerpQuaternions(flat, face, Math.min(1, k * 1.35)); spinQ.setFromAxisAngle(Y, (1 - k) * Math.PI * 4);
        card.quaternion.copy(q).multiply(spinQ); card.scale.setScalar(lerp(.3, 1, k));
        cardHalo.material.opacity = .5 * k;
      }, ease.out);
      card.updateMatrixWorld(true);
      const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => new THREE.Vector3(x * CARD_W / 2, y * CARD_H / 2, 0).applyMatrix4(card.matrixWorld).project(camera));
      const xs = cs.map(v => (v.x + 1) / 2 * W), ys = cs.map(v => (1 - v.y) / 2 * H);
      return { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    },
    // 4. the HTML card has taken over: the 3D one goes, the light calms down, the camera drifts
    hold(big) {
      card.visible = false; beatOn = false; spinTo = .55;
      driftBase.copy(camera.position); drift = 1;
      tween(1600, k => { calm = lerp(1, .75, k); if (big) sideBeams.forEach(b => { b.material.uniforms.strength.value = lerp(.45, .2, k); }); if (bloom) bloom.strength = lerp(bloom.strength, .4, k * .1); });
    },
    // GOD pack: light leaks out of the grooves, the deck shakes, the record bursts into five cards that form a ring.
    // `onBurst` is called at the moment of the burst (the page flashes and throws sparks then).
    async godBurst(colors, onBurst) {
      spinTo = 2.4;
      const gold = new THREE.Color(0xffc75a);
      await tween(1900, k => {
        recordMat.emissive.copy(gold); recordMat.emissiveIntensity = k * 1.1;
        shake = k; mainBeam.material.uniforms.strength.value = lerp(.55, .9, k); calm = 1 + k;
        sideBeams.forEach(b => { b.material.uniforms.strength.value = lerp(.45, .8, k); });
        if (bloom) bloom.strength = lerp(.55, 1.2, k);
      }, t => t * t);
      shake = 0; deck.position.copy(deckBase);
      record.visible = false; spinTo = .55;
      renderer.shadowMap.needsUpdate = true;
      onBurst?.();
      if (bloom) tween(1200, k => { bloom.strength = lerp(1.2, .55, k); });
      tween(900, k => { mainBeam.material.uniforms.strength.value = lerp(.9, .5, k); calm = lerp(2, 1, k); });
      // the five pieces fly out to their place in the ring, spinning
      ringAngle = 0; ringOn = 0;
      const from = new THREE.Vector3(0, .1, 0), to = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion();
      ring.forEach((c, j) => { c.g.visible = true; c.free = false; c.halo.material.color.set(colors[j]); c.halo.material.opacity = .22; });
      const ok = Math.min(portraitK(), 1.45);
      moveCam({ p: new THREE.Vector3(0, 3.4 * ok, 7.6 * ok), l: new THREE.Vector3(0, .55, 0) }, 1400);
      await tween(1100, k => {
        ring.forEach((c, j) => {
          const a = j * Math.PI * 2 / 5;
          to.set(Math.cos(a) * RING_R, RING_Y, Math.sin(a) * RING_R);
          c.g.position.lerpVectors(from, to, k); c.g.position.y += Math.sin(k * Math.PI) * .6;
          c.g.lookAt(camera.position); q.setFromAxisAngle(Y, (1 - k) * Math.PI * 3); c.g.quaternion.multiply(q);
          c.g.scale.setScalar(lerp(.2, 1, k));
        });
      }, ease.out);
      ring.forEach(c => { c.free = true; });
      ringOn = 1; orbitA = 0; orbit = 1;
    },
    // one card leaves the ring and comes to face the screen (same contract as emerge)
    async godPick(j, px, cy, hex) {
      orbit = 0; ringOn = 0;
      const c = ring[j]; c.free = false;
      const W = host.clientWidth || innerWidth, H = host.clientHeight || innerHeight;
      const fovH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), dist = CARD_H * H / (px * fovH);
      const ray = new THREE.Vector3(0, 1 - 2 * cy, .5).unproject(camera).sub(camera.position).normalize();
      const end = camera.position.clone().addScaledVector(ray, dist), start = c.g.position.clone();
      const q0 = c.g.quaternion.clone(), face = camera.quaternion.clone(), spinQ = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
      light(hex, 700);
      await tween(950, k => {
        c.g.position.lerpVectors(start, end, k);
        c.g.quaternion.slerpQuaternions(q0, face, k); spinQ.setFromAxisAngle(Y, (1 - k) * Math.PI * 2); c.g.quaternion.multiply(spinQ);
      }, ease.inOut);
      c.g.updateMatrixWorld(true);
      const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => new THREE.Vector3(x * CARD_W / 2, y * CARD_H / 2, 0).applyMatrix4(c.g.matrixWorld).project(camera));
      const xs = cs.map(v => (v.x + 1) / 2 * W), ys = cs.map(v => (1 - v.y) / 2 * H);
      c.g.visible = false;
      return { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    },
    // back to the ring: the remaining cards turn again and the camera circles
    godRelease() { ringOn = 1; orbit = 1; },
    // compile the shaders and upload the textures ahead of time, without blocking the page
    async warmup() {
      resize(); setShot(shots().wide);
      card.visible = true; sideBeams.forEach(b => { b.visible = true; }); ring.forEach(c => { c.g.visible = true; });
      try { await renderer.compileAsync(scene, camera); } catch {}
      composer ? composer.render() : renderer.render(scene, camera);
      card.visible = false; ring.forEach(c => { c.g.visible = false; });
    },
    stop() { cancelAnimationFrame(raf); raf = 0; tweens.clear(); },
    canvas,
  };
}
