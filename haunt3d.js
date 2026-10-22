/* Zik Hunter — the reveal of a Collection Hantée card in 3D, shot like the hit film (same turntable, same light):
   a dark room lit by three candles; a black record drops on the platter, the arm lands, the record turns backwards
   and green cracks run through its grooves; the candles blow out; in the dark the record bursts into shards and the
   cursed card rises out of them in a green beam, turns to us, and green fire eats its cover: the card shows.
   One continuous camera move, no cut. Turntable: "Yamaha TT-300 Record Player" by AleixoAlonso, CC BY 4.0.
   Loaded only when a booster holds such a card. play() resolves when the film is over. */
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
const clamp01 = t => Math.max(0, Math.min(1, t));
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const loadImg = (src, cors) => new Promise(r => { const i = new Image(); if (cors) i.crossOrigin = "anonymous"; i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
const canvas2d = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")]; };
const GREEN = "#39ff88";

export async function play(host, card) {
  const mobile = Math.min(innerWidth, innerHeight) < 600 || /Android|iPhone|iPad/.test(navigator.userAgent);
  const renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.25 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = mobile ? 1.15 : 1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x020203, 1);
  const canvas = renderer.domElement; canvas.className = "hx3d-gl";
  host.prepend(canvas);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x020203, .085);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
  scene.environmentIntensity = .25;
  const camera = new THREE.PerspectiveCamera(30, 1, .05, 80);
  // the glow pass only on computers, at half resolution (as the hit film does): phones render straight
  const composer = mobile ? null : new EffectComposer(renderer);
  let bloom = null;
  if (composer) {
    composer.setPixelRatio(1);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .45, .55, .78);
    composer.addPass(bloom); composer.addPass(new OutputPass());
  }
  const draw = () => composer ? composer.render() : renderer.render(scene, camera);

  const [gltf, logo, cover, torn, rim] = await Promise.all([
    new GLTFLoader().loadAsync(new URL(mobile ? "brand/3d/turntable-1k.gltf?v=2" : "brand/3d/turntable.gltf?v=2", location.href).href),
    loadImg("brand/zikhunter-icon.svg"), loadImg(card.cover, true), loadImg("brand/torn.svg"), loadImg("brand/torn-rim.svg"),
  ]);
  await document.fonts?.ready;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const texOf = cv => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; return t; };
  const [sc, sg] = canvas2d(128, 128);
  { const gr = sg.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)"); sg.fillStyle = gr; sg.fillRect(0, 0, 128, 128); }
  const soft = texOf(sc);

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

  /* ---------- the cursed record: black, a dark label; green cracks spread through its grooves ---------- */
  const recordMat = new THREE.MeshPhysicalMaterial({ map: vinylTexture(), color: 0x55555c, roughness: .34, metalness: .1, clearcoat: 1, clearcoatRoughness: .1, envMapIntensity: .8 });
  const [lc, lg] = canvas2d(1024, 1024);
  { const c = 512, gr = lg.createRadialGradient(c * .7, c * .6, 0, c, c, c); gr.addColorStop(0, "#14261b"); gr.addColorStop(1, "#040806");
    lg.fillStyle = gr; lg.beginPath(); lg.arc(c, c, c, 0, 7); lg.fill();
    lg.strokeStyle = GREEN; lg.lineWidth = 6; lg.beginPath(); lg.arc(c, c, c * .93, 0, 7); lg.stroke();
    lg.fillStyle = "#9dffbf"; lg.textAlign = "center"; lg.font = `600 ${1024 * .05}px "DM Mono", monospace`; lg.fillText("ZIK HUNTER · FACE B", c, c + c * .52);
    lg.font = `500 ${1024 * .036}px "DM Mono", monospace`; lg.fillText("À NE PAS ÉCOUTER", c, c + c * .67);
    lg.font = `900 ${1024 * .2}px Unbounded, sans-serif`; lg.shadowColor = GREEN; lg.shadowBlur = 30; lg.fillText("?", c, c - c * .08);
    lg.shadowBlur = 0; lg.fillStyle = "#020202"; lg.beginPath(); lg.arc(c, c, c * .06, 0, 7); lg.fill(); }
  const labelMat = new THREE.MeshStandardMaterial({ map: texOf(lc), roughness: .6 });
  const record = new THREE.Group();
  const recTop = new THREE.Mesh(new THREE.CircleGeometry(R_REC, 160), recordMat); recTop.position.z = .0021; record.add(recTop);
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: .3 });
  const recEdge = new THREE.Mesh(new THREE.CylinderGeometry(R_REC, R_REC, .002, 160, 1, true), edgeMat);
  recEdge.rotation.x = Math.PI / 2; recEdge.position.z = .001; record.add(recEdge);
  const label = new THREE.Mesh(new THREE.CircleGeometry(.05, 96), labelMat); label.position.z = .00225; record.add(label);
  // the cracks: branching lines from the centre, drawn once; a shader shows them up to a growing radius
  const [kc, kg] = canvas2d(1024, 1024);
  kg.fillStyle = "#000"; kg.fillRect(0, 0, 1024, 1024); kg.strokeStyle = "#fff"; kg.lineCap = "round";
  const branch = (x, y, a, len, w, depth) => {
    for (let s = 0; s < len; s += 14) {
      const nx = x + Math.cos(a) * 14, ny = y + Math.sin(a) * 14;
      kg.lineWidth = w; kg.beginPath(); kg.moveTo(x, y); kg.lineTo(nx, ny); kg.stroke();
      x = nx; y = ny; a += (Math.random() - .5) * .5;
      if (depth < 3 && Math.random() < .06) branch(x, y, a + (Math.random() < .5 ? -1 : 1) * (.5 + Math.random() * .6), len * .5, w * .7, depth + 1);
      if (Math.hypot(x - 512, y - 512) > 505) break;
    }
  };
  for (let k = 0; k < 11; k++) { const a = k / 11 * Math.PI * 2 + Math.random() * .4; branch(512 + Math.cos(a) * 56, 512 + Math.sin(a) * 56, a, 520, 3, 0); }
  kg.filter = "blur(2px)"; kg.drawImage(kc, 0, 0); kg.filter = "none";
  const crackTex = new THREE.CanvasTexture(kc);
  const uCrack = { value: 0 }, uCrackGlow = { value: 0 };
  const crackMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { map: { value: crackTex }, reach: uCrack, glow: uCrackGlow, color: { value: new THREE.Color(GREEN) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform sampler2D map; uniform float reach; uniform float glow; uniform vec3 color; varying vec2 vUv;
      void main(){ float d = length(vUv - .5) * 2.; float c = texture2D(map, vUv).r;
        float shown = smoothstep(reach, reach - .08, d);
        gl_FragColor = vec4(clamp(color * c * shown * glow, 0., 4.), 1.); }`,
  });
  const cracks = new THREE.Mesh(new THREE.CircleGeometry(R_REC, 96), crackMat); cracks.position.z = .0024; record.add(cracks);
  record.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
  platterNode.add(record);
  const REC_Z = P_TOP;
  // the shards it bursts into: wedges of the same record, their broken edges glowing
  const shards = [];
  { let a0 = 0; const glowEdge = new THREE.MeshBasicMaterial({ color: 0x1fa85a });
    while (a0 < Math.PI * 2 - .01) {
      const a1 = Math.min(Math.PI * 2, a0 + .35 + Math.random() * .5), sh = new THREE.Shape();
      sh.moveTo(Math.cos(a0) * .012, Math.sin(a0) * .012);
      const steps = 6; for (let s = 0; s <= steps; s++) { const r = s === 0 || s === steps ? R_REC * (.55 + Math.random() * .2) : R_REC * (.18 + s / steps * .8 + (Math.random() - .5) * .05); sh.lineTo(Math.cos(a0) * r, Math.sin(a0) * r); }
      for (let s = 0; s <= 12; s++) { const a = lerp(a0, a1, s / 12); sh.lineTo(Math.cos(a) * R_REC, Math.sin(a) * R_REC); }
      sh.lineTo(Math.cos(a1) * .012, Math.sin(a1) * .012);
      const geo = new THREE.ExtrudeGeometry(sh, { depth: .002, bevelEnabled: false });
      const uv = geo.attributes.uv, pos = geo.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / (R_REC * 2) + .5, pos.getY(i) / (R_REC * 2) + .5);   // the same grooves as the record
      const m = new THREE.Mesh(geo, [recordMat, glowEdge]); m.visible = false;
      const mid = (a0 + a1) / 2;
      m.userData = { dir: new THREE.Vector3(Math.cos(mid), Math.sin(mid), 0), up: .9 + Math.random() * .8, out: .5 + Math.random() * .5, spin: new THREE.Vector3((Math.random() - .5) * 9, (Math.random() - .5) * 9, (Math.random() - .5) * 4) };
      platterNode.add(m); shards.push(m); a0 = a1;
    }
  }

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

  /* ---------- the floor, a dim moon from above (for the shadow), three candles ---------- */
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: .32, metalness: .55, envMapIntensity: .25 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR_Y; floor.receiveShadow = true; scene.add(floor);
  scene.add(new THREE.HemisphereLight(0x8890a0, 0x000000, .05));
  const key = new THREE.SpotLight(0xbfd0ff, 6, 16, .42, .7, 1.4);
  key.position.set(-.4, 6, .8); key.target.position.set(.15, 0, 0); scene.add(key, key.target);
  key.castShadow = true; key.shadow.mapSize.set(mobile ? 512 : 1024, mobile ? 512 : 1024); key.shadow.bias = -.0004; key.shadow.radius = 6;
  key.shadow.camera.near = 2; key.shadow.camera.far = 12;
  const greenLight = new THREE.PointLight(0x39ff88, 0, 4, 1.8); greenLight.position.set(0, .35, 0); scene.add(greenLight);
  // a candle: ivory wax with a soft top, a black wick, a flame (an additive sprite with a hot core) and its light
  const [fc0, fg0] = canvas2d(64, 128);
  { const gr = fg0.createRadialGradient(32, 84, 2, 32, 74, 50); gr.addColorStop(0, "rgba(255,250,220,1)"); gr.addColorStop(.25, "rgba(255,200,90,.95)"); gr.addColorStop(.6, "rgba(255,120,20,.35)"); gr.addColorStop(1, "rgba(255,80,0,0)");
    fg0.fillStyle = gr; fg0.beginPath(); fg0.moveTo(32, 4); fg0.bezierCurveTo(52, 50, 58, 96, 32, 124); fg0.bezierCurveTo(6, 96, 12, 50, 32, 4); fg0.fill(); }
  const flameTex = texOf(fc0);
  const wax = new THREE.MeshStandardMaterial({ color: 0xe9dcc4, roughness: .55, emissive: 0x3a1c06, emissiveIntensity: .25 });
  const wick = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: .9 });
  const smokeMat = new THREE.SpriteMaterial({ map: soft, color: 0x9a9a9a, transparent: true, opacity: 0, depthWrite: false });
  const candles = [[-1.75, .62, .95], [1.95, .9, .35], [-1.2, .45, -1.3]].map(([x, h, z], i) => {
    const g = new THREE.Group(); g.position.set(x, FLOOR_Y, z); scene.add(g);
    const r = .085 - i * .01;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.04, h, 32), wax); body.position.y = h / 2; body.castShadow = true; g.add(body);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(r * .85, r * .18, 10, 32), wax); lip.rotation.x = Math.PI / 2; lip.position.y = h - r * .05; g.add(lip);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(.004, .004, .05, 6), wick); w.position.y = h + .02; g.add(w);
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    flame.center.set(.5, .05); flame.position.y = h + .02; flame.scale.set(.07, .14, 1); g.add(flame);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft, color: 0xff9a40, transparent: true, opacity: .35, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.position.y = h + .07; halo.scale.setScalar(.6); g.add(halo);
    const light = new THREE.PointLight(0xffa04a, 0, 5, 1.6); light.position.y = h + .1; g.add(light);
    const smoke = Array.from({ length: 6 }, (_, k) => { const s = new THREE.Sprite(smokeMat.clone()); s.position.y = h + .03; s.scale.setScalar(.05); s.userData.k = k; g.add(s); return s; });
    return { g, flame, halo, light, smoke, h, seed: Math.random() * 10 };
  });

  /* ---------- a green beam in the haze, for the card ---------- */
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { color: { value: new THREE.Color(0x39ff88) }, strength: { value: 0 }, height: { value: 1 } },
    vertexShader: `uniform float height; varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ vY = position.y / height + .5; vec4 wp = modelMatrix * vec4(position,1.); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 color; uniform float strength; varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ float y = clamp(vY, 0., 1.);
        float edge = pow(clamp(abs(dot(normalize(vN), normalize(vV))), 0., 1.), 2.2);
        float along = (1. - y) * smoothstep(0., .15, y) * (1. - smoothstep(.85, 1., y));
        gl_FragColor = vec4(clamp(color * strength * edge * along, 0., 4.), 1.); }`,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(.55, .25, 4, 48, 1, true), beamMat);
  beam.position.set(0, 2, 0); beamMat.uniforms.height.value = 4; scene.add(beam);
  // dust (green motes) floating up in it
  const DUST = mobile ? 90 : 200, dPos = new Float32Array(DUST * 3), dSeed = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) { const a = Math.random() * 7, r = Math.sqrt(Math.random()) * .5; dPos.set([Math.cos(a) * r, Math.random() * 3, Math.sin(a) * r], i * 3); dSeed[i] = Math.random() * 100; }
  const dGeo = new THREE.BufferGeometry(); dGeo.setAttribute("position", new THREE.BufferAttribute(dPos, 3));
  const motes = new THREE.Points(dGeo, new THREE.PointsMaterial({ map: soft, size: .03, color: 0x9dffbf, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(motes); const dBase = dPos.slice();

  /* ---------- the card: its face, the cursed sheet over it (which burns), its back ---------- */
  const CW = 1.26, CH = 1.76, TW = 630, TH = 880;
  const [ac, ag] = canvas2d(TW, TH);                        // the torn outline, as an alpha map
  ag.fillStyle = "#000"; ag.fillRect(0, 0, TW, TH); if (torn) { ag.filter = "invert(1)"; ag.drawImage(torn, 0, 0, TW, TH); ag.filter = "none"; } else { ag.fillStyle = "#fff"; ag.fillRect(0, 0, TW, TH); }
  const alpha = new THREE.CanvasTexture(ac);
  const [fc, fg] = canvas2d(TW, TH);                        // the face, drawn like the HTML card
  fg.fillStyle = "#050806"; fg.fillRect(0, 0, TW, TH);
  if (cover) { const s = Math.max(TW / cover.width, TH / cover.height); fg.drawImage(cover, (TW - cover.width * s) / 2, (TH - cover.height * s) / 2, cover.width * s, cover.height * s); }
  let gr = fg.createLinearGradient(0, 0, 0, TH); gr.addColorStop(0, "rgba(10,40,20,.15)"); gr.addColorStop(.55, "rgba(0,30,12,.4)"); gr.addColorStop(.92, "#020503");
  fg.fillStyle = gr; fg.fillRect(0, 0, TW, TH);
  fg.strokeStyle = "rgba(18,8,2,.9)"; fg.lineWidth = 40; fg.filter = "blur(12px)"; fg.strokeRect(0, 0, TW, TH); fg.filter = "none";
  fg.textAlign = "center"; fg.fillStyle = "#b8ffcf"; fg.shadowColor = GREEN; fg.shadowBlur = 12;
  fg.font = `600 17px "DM Mono", monospace`; fg.fillText("C O L L E C T I O N   H A N T É E", TW / 2, 48);
  fg.textAlign = "left";
  fg.font = `78px "Mrs Saint Delafield", cursive`; fg.fillStyle = "#c9ffd9"; fg.shadowBlur = 20;
  fg.save(); fg.translate(36, TH - 160); fg.rotate(-.08); fg.fillText(card.artist, 0, 0); fg.restore();
  const title = card.title.toUpperCase(); let fs = 66; fg.font = `900 ${fs}px Unbounded, sans-serif`;
  while (fg.measureText(title).width > TW - 72 && fs > 30) { fs -= 2; fg.font = `900 ${fs}px Unbounded, sans-serif`; }
  gr = fg.createLinearGradient(0, TH - 130, 0, TH - 70); gr.addColorStop(0, "#f4ffe6"); gr.addColorStop(.5, "#9dffbf"); gr.addColorStop(1, "#1fd16a");
  fg.fillStyle = gr; fg.shadowBlur = 16; fg.fillText(title, 36, TH - 92);
  fg.shadowBlur = 0; fg.strokeStyle = "rgba(57,255,136,.45)"; fg.lineWidth = 2; fg.beginPath(); fg.moveTo(36, TH - 72); fg.lineTo(TW - 36, TH - 72); fg.stroke();
  fg.font = `500 17px "DM Mono", monospace`; fg.fillStyle = "#9fd8b2"; fg.fillText("HALLOWEEN 2026", 36, TH - 40);
  const no = String(card.no).padStart(String(card.of).length, "0");
  fg.textAlign = "right"; fg.font = `900 40px Unbounded, sans-serif`; fg.fillStyle = "#eaffd0"; fg.shadowColor = GREEN; fg.shadowBlur = 14;
  fg.fillText(`${no}`, TW - 74, TH - 34); fg.font = `600 22px Unbounded, sans-serif`; fg.fillStyle = GREEN; fg.fillText(`/${card.of}`, TW - 36, TH - 34);
  const [bc, bg] = canvas2d(TW, TH);                        // the cursed sheet and the back: charred, a glowing sigil
  gr = bg.createRadialGradient(TW / 2, TH * .45, 20, TW / 2, TH * .45, TH * .7); gr.addColorStop(0, "#1c4a2c"); gr.addColorStop(.6, "#08140c"); gr.addColorStop(1, "#020403");
  bg.fillStyle = gr; bg.fillRect(0, 0, TW, TH);
  bg.strokeStyle = "rgba(57,255,136,.5)"; bg.lineWidth = 4; bg.setLineDash([10, 12]); bg.beginPath(); bg.arc(TW / 2, TH * .45, 210, 0, 7); bg.stroke(); bg.setLineDash([]);
  bg.textAlign = "center"; bg.textBaseline = "middle"; bg.font = `900 300px Unbounded, sans-serif`; bg.fillStyle = "rgba(57,255,136,.55)"; bg.shadowColor = GREEN; bg.shadowBlur = 50; bg.fillText("?", TW / 2, TH * .46);
  if (logo) { bg.shadowBlur = 0; bg.globalAlpha = .7; bg.drawImage(logo, TW / 2 - 34, TH - 120, 68, 68); bg.globalAlpha = 1; }
  const [nc, ng] = canvas2d(256, 360);                      // the burn's noise: soft blobs
  ng.fillStyle = "#808080"; ng.fillRect(0, 0, 256, 360);
  for (let k = 0; k < 260; k++) { const v = Math.random() * 255 | 0; ng.fillStyle = `rgba(${v},${v},${v},.35)`; ng.beginPath(); ng.arc(Math.random() * 256, Math.random() * 360, 8 + Math.random() * 40, 0, 7); ng.fill(); }
  ng.filter = "blur(6px)"; ng.drawImage(nc, 0, 0); ng.filter = "none";
  const noise = new THREE.CanvasTexture(nc);
  const uBurn = { value: 0 };
  const geo = new THREE.PlaneGeometry(CW, CH);
  const faceMat = new THREE.MeshStandardMaterial({ map: texOf(fc), alphaMap: alpha, alphaTest: .5, roughness: .55, metalness: .1, emissive: 0xffffff, emissiveMap: texOf(fc), emissiveIntensity: .9, fog: false });
  const sheetMat = new THREE.MeshStandardMaterial({ map: texOf(bc), alphaMap: alpha, alphaTest: .5, roughness: .8, emissive: 0xffffff, emissiveMap: texOf(bc), emissiveIntensity: .8, transparent: true });
  sheetMat.onBeforeCompile = sh => {
    sh.uniforms.uBurn = uBurn; sh.uniforms.uNoise = { value: noise };
    sh.fragmentShader = "uniform float uBurn; uniform sampler2D uNoise;\n" + sh.fragmentShader
      .replace("#include <alphatest_fragment>", `#include <alphatest_fragment>
        float zn = texture2D(uNoise, vMapUv).r * .55 + vMapUv.y * .45;   // it burns from the bottom up, in blobs
        float zb = uBurn * 1.25 - .1;
        if (zn < zb) discard;
        float zEdge = smoothstep(zb + .07, zb, zn);`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(.25, 1., .5) * zEdge * 2.5;`);
  };
  const backMat = new THREE.MeshStandardMaterial({ map: texOf(bc), alphaMap: alpha, alphaTest: .5, roughness: .8, emissive: 0xffffff, emissiveMap: texOf(bc), emissiveIntensity: .8 });
  const cardG = new THREE.Group();
  const face = new THREE.Mesh(geo, faceMat), sheet = new THREE.Mesh(geo, sheetMat), back = new THREE.Mesh(geo, backMat);
  sheet.position.z = .004; back.rotation.y = Math.PI; back.position.z = -.002;
  const [rc, rg] = canvas2d(TW, TH); if (rim) { rg.filter = "invert(1) drop-shadow(0 0 6px #fff)"; rg.drawImage(rim, 0, 0, TW, TH); }
  const rimMesh = new THREE.Mesh(new THREE.PlaneGeometry(CW * 1.02, CH * 1.02), new THREE.MeshBasicMaterial({ color: 0x39ff88, alphaMap: new THREE.CanvasTexture(rc), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  rimMesh.position.z = .006;
  cardG.add(face, sheet, back, rimMesh); scene.add(cardG); cardG.visible = false;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft, color: 0x39ff88, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(3.2, 3.6, 1); scene.add(halo);


  const CARD_S = .55;                                         // the card at the deck's size

  /* ---------- the film: one continuous camera move ---------- */
  const resize = () => { const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight; renderer.setSize(w, h, false); composer?.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  resize(); addEventListener("resize", resize);
  const portrait = () => camera.aspect < 1.1;
  const pk = () => portrait() ? Math.min(2.6, 1.15 / Math.max(.4, camera.aspect)) : 1;
  const camPath = () => {
    const k = pk(), side = portrait() ? .45 : 1, V = (x, y, z) => new THREE.Vector3(x, y, z);
    return {
      p: new THREE.CatmullRomCurve3([V(2.6 * side, .55, 3.1 * k), V(1.9 * side, .95, 2.7 * k), V(1.2 * side, 1.6, 3.2 * k), V(.6 * side, 1.75, 3.9 * k), V(.3 * side, 1.35, 3.7 * k)]),
      l: new THREE.CatmullRomCurve3([V(-.1, .1, 0), V(0, .08, 0), V(0, .15, 0), V(0, .5, 0), V(0, .95, 0)]),
    };
  };
  let path = camPath(); addEventListener("resize", () => { path = camPath(); });
  const T = 9.4;
  const recPos = new THREE.Vector3(), cardEnd = new THREE.Vector3(), flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), qa = new THREE.Quaternion(), qs = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  let spinA = 0, last = 0;
  const step = (t, dt = .016) => {
    const u = ease.inOut(clamp01(t / T));
    camera.position.copy(path.p.getPointAt(u)); camera.lookAt(path.l.getPointAt(u));
    // candles: alive, then leaning and fluttering as the curse grows, then blown out
    const out = seg(t, 5.1, 5.35), wind = seg(t, 3.4, 5.1);
    candles.forEach((c, i) => {
      const f = .85 + .1 * Math.sin(t * 13 + c.seed) + .06 * Math.sin(t * 29 + c.seed * 3) + wind * .25 * Math.sin(t * 41 + i);
      const on = (1 - out) * ease.out(seg(t, 0, .6));
      c.flame.scale.set(.07 * (1 + wind * .3), .14 * f * (1 - out * .9), 1); c.flame.material.opacity = on; c.flame.material.rotation = wind * .35 * Math.sin(t * 7 + i);
      c.halo.material.opacity = .35 * on * f; c.light.intensity = 2.2 * on * f;
      c.smoke.forEach(s => { const a = seg(t, 5.3 + s.userData.k * .08, 7.3 + s.userData.k * .1); s.position.y = c.h + .03 + a * .9; s.position.x = Math.sin(a * 6 + s.userData.k) * .06 * a; s.scale.setScalar(.05 + a * .35); s.material.opacity = .22 * Math.sin(a * Math.PI); });
    });
    // the record drops, the arm lands, the record turns backwards, faster and faster
    const drop = seg(t, .9, 1.75);
    record.position.z = lerp(REC_Z + .12, REC_Z, ease.drop(drop)); record.rotation.x = lerp(.3, 0, clamp01(drop * 1.25));
    armNode.rotation.x = t < 2.2 ? lerp(0, LIFT_UP, ease.out(seg(t, 1.9, 2.2))) : t < 3 ? LIFT_UP : lerp(LIFT_UP, LIFT_PLAY, ease.soft(seg(t, 3, 3.35)));
    armNode.rotation.z = lerp(0, YAW_PLAY, ease.inOut(seg(t, 2.2, 3)));
    const speed = seg(t, 3.3, 3.9) * .55 + seg(t, 3.9, 5.6) * 1.6;
    spinA += speed * Math.PI * 2 * dt; platterNode.rotation.z = spinA;                // backwards: anticlockwise seen from above
    // the cracks spread, then glow brighter; the record bursts
    uCrack.value = lerp(.1, 1.05, ease.inOut(seg(t, 3.7, 5.5))); uCrackGlow.value = seg(t, 3.6, 4) * (.7 + seg(t, 5.1, 5.7) * 1.1);
    const burst = seg(t, 5.8, 7.6), broken = t >= 5.8;
    recTop.visible = label.visible = recEdge.visible = cracks.visible = !broken;
    shards.forEach(s => {
      s.visible = broken;
      if (!broken) return;
      const d = s.userData, tt = burst * 1.8;
      s.position.copy(d.dir).multiplyScalar(d.out * tt * .09).setZ(REC_Z + Math.max(0, d.up * tt * .1 - tt * tt * .045));
      s.rotation.set(d.spin.x * tt * .25, d.spin.y * tt * .25, d.spin.z * tt * .3);
    });
    greenLight.intensity = uCrackGlow.value * 1.2 + Math.max(0, 1 - Math.abs(t - 5.85) * 4) * 9 + seg(t, 6, 7) * 1.2;
    key.intensity = 6 * (1 - out * .6);
    beamMat.uniforms.strength.value = seg(t, 5.8, 6.6) * .32 * (1 - seg(t, 7.6, 8.6) * .5); motes.material.opacity = seg(t, 5.9, 6.8) * .8;
    for (let i = 0; i < DUST; i++) { dPos[i * 3 + 1] = (dBase[i * 3 + 1] + t * .25 * (1 + (dSeed[i] % 1))) % 3; dPos[i * 3] = dBase[i * 3] + Math.sin(t * .6 + dSeed[i]) * .04; }
    dGeo.attributes.position.needsUpdate = true;
    if (bloom) bloom.strength = .4 + uCrackGlow.value * .08 + Math.max(0, 1 - Math.abs(t - 5.85) * 3) * .8;
    // the card rises out of the shards, turning, and stops facing the camera
    const rise = ease.out(seg(t, 5.9, 7.3));
    cardG.visible = t >= 5.85;
    platterNode.getWorldPosition(recPos);
    const endCam = path.p.getPointAt(ease.inOut(clamp01(7.6 / T)));
    cardEnd.set(0, 1.0, .1);
    cardG.position.lerpVectors(recPos.setY(recPos.y + .05), cardEnd, rise); cardG.position.y += Math.sin(t * 2) * .02 * seg(t, 7.3, 7.8);
    qa.copy(flat).slerp(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(endCam, cardEnd, Y)), Math.min(1, rise * 1.3));
    qs.setFromAxisAngle(Y, (1 - rise) * Math.PI * 4); cardG.quaternion.copy(qa).multiply(qs);
    cardG.scale.setScalar(CARD_S * lerp(.35, 1, rise));
    halo.position.copy(cardG.position); halo.material.opacity = seg(t, 6.3, 7.2) * .12 + seg(t, 7.8, 8.4) * .12 * (1 - seg(t, 8.6, 9.4));
    halo.scale.set(3.2 * CARD_S, 3.6 * CARD_S, 1);
    rimMesh.material.opacity = .6 + .4 * Math.sin(t * 9);
    uBurn.value = ease.inOut(seg(t, 7.7, 8.8)); sheetMat.emissiveIntensity = .8 + seg(t, 7.2, 7.7) * .5;
    draw();
  };
  let raf = 0, t0 = 0, done;
  const finished = new Promise(r => done = r);
  const frame = now => {
    if (!t0) t0 = now;
    const t = !host.isConnected ? T : window.__hxT ?? (now - t0) / 1000;   // host gone: skip to the end (__hxT: a frozen instant, for tests)
    step(t, Math.min(.05, (now - (last || now)) / 1000) || .016); last = now;
    if (t < T) raf = requestAnimationFrame(frameSafe); else done();
  };
  const frameSafe = now => { try { frame(now); } catch (e) { done(); throw e; } };
  // warm-up, out of sight: every moment drawn once (shaders compiled, textures sent to the GPU) before the clock starts
  canvas.style.visibility = "hidden";
  try { await renderer.compileAsync(scene, camera); } catch (e) {}
  for (const w of [.5, 3.5, 5.9, 7.5, 8.3]) { step(w, 0); await new Promise(r => requestAnimationFrame(r)); }
  spinA = 0; canvas.style.visibility = "";
  raf = requestAnimationFrame(frameSafe);
  await finished;
  cancelAnimationFrame(raf); removeEventListener("resize", resize);
  canvas.remove(); renderer.dispose(); composer?.dispose?.();
}
