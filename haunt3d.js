/* Zik Hunter — the reveal of a Collection Hantée card in 3D: a graveyard in green fog, lightning, a coffin rattles,
   green light leaks out, its lid flies open and bats burst out; seen from above, the cursed card lies face down in the
   satin and trembles; then in front, it rises spinning, turns to us, and green fire eats its cover: the card shows. Coffin: "Coffin" by ✞BloodTea✞ (https://sketchfab.com/bloodtea), CC BY 4.0.
   Loaded only when a booster holds such a card. play() resolves when the film is over; the page then shows the HTML
   card in its place. */
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

const ease = { out: t => 1 - Math.pow(1 - t, 3), inOut: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2, soft: t => t * t * (3 - 2 * t) };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = t => Math.max(0, Math.min(1, t));
const seg = (t, a, b) => clamp01((t - a) / (b - a));          // 0 → 1 between a and b
const loadImg = (src, cors) => new Promise(r => { const i = new Image(); if (cors) i.crossOrigin = "anonymous"; i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
const canvas2d = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")]; };
const GREEN = "#39ff88";

export async function play(host, card) {
  const mobile = Math.min(innerWidth, innerHeight) < 600 || /Android|iPhone|iPad/.test(navigator.userAgent);
  const renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.5 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0x020604, 1);
  const canvas = renderer.domElement; canvas.className = "hx3d-gl";
  host.prepend(canvas);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x020a06, .09);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), .04).texture;   // soft reflections on the wood and the brass
  scene.environmentIntensity = .35;
  const camera = new THREE.PerspectiveCamera(34, 1, .05, 60);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .55, .6, .72);
  composer.addPass(bloom); composer.addPass(new OutputPass());
  const texOf = cv => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; };

  const [cover, bat, torn, rim, logo, gltf] = await Promise.all([loadImg(card.cover, true), loadImg("brand/bat.svg"), loadImg("brand/torn.svg"), loadImg("brand/torn-rim.svg"), loadImg("brand/zikhunter-icon.svg"),
    new GLTFLoader().loadAsync(new URL("brand/3d/coffin/scene.gltf?v=1", location.href).href)]);
  await document.fonts?.ready;

  /* ---------- the ground, the graves, the moon ---------- */
  scene.add(new THREE.AmbientLight(0x1a3a28, 1.1));
  const moon = new THREE.DirectionalLight(0x9fffd0, 1.1); moon.position.set(-3, 6, -4); scene.add(moon);
  const glow = new THREE.PointLight(0x39ff88, 0, 9, 1.6); glow.position.set(0, 1.6, -1.2); scene.add(glow);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x06100a, roughness: .85, metalness: .05 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const stone = new THREE.MeshStandardMaterial({ color: 0x0c1410, roughness: .9 });
  const grave = (x, z, w, h, cross) => {
    const g = new THREE.Group();
    if (cross) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(w * .25, h, w * .25), stone); a.position.y = h / 2;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, w * .25, w * .25), stone); b.position.y = h * .72; g.add(a, b);
    } else {
      const sh = new THREE.Shape(); sh.moveTo(-w / 2, 0); sh.lineTo(-w / 2, h - w / 2); sh.absarc(0, h - w / 2, w / 2, Math.PI, 0, true); sh.lineTo(w / 2, 0);
      g.add(new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: .12, bevelEnabled: false }), stone));
    }
    g.position.set(x, 0, z); g.rotation.y = (Math.random() - .5) * .5; g.rotation.z = (Math.random() - .5) * .12; scene.add(g);
  };
  grave(-2.6, -2.2, .7, 1.1); grave(2.4, -2.6, .8, 1.25); grave(-1.4, -4.2, .6, .9, true); grave(1.3, -4.6, .7, 1.4, true); grave(3.6, -1.2, .55, .8); grave(-3.8, -1, .6, 1.2, true);
  const [mc, mg] = canvas2d(512, 512);
  const mgr = mg.createRadialGradient(256, 256, 0, 256, 256, 256); mgr.addColorStop(0, "rgba(230,255,235,1)"); mgr.addColorStop(.35, "rgba(160,255,200,.35)"); mgr.addColorStop(1, "rgba(0,0,0,0)");
  mg.fillStyle = mgr; mg.fillRect(0, 0, 512, 512);
  const moonSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: texOf(mc), transparent: true, depthWrite: false, fog: false }));
  moonSpr.material.opacity = .7; moonSpr.position.set(-3.4, 4.6, -10); moonSpr.scale.setScalar(2.4); scene.add(moonSpr);

  /* ---------- the coffin ("Coffin" by ✞BloodTea✞ on Sketchfab, CC BY 4.0): lying across, its lid on a hinge at the back ---------- */
  const model = gltf.scene;
  model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.material.envMapIntensity = 1.4; } });
  const coffin = new THREE.Group(); coffin.add(model); scene.add(coffin);
  let box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
  if (size.z > size.x) { model.rotation.y = Math.PI / 2; model.updateMatrixWorld(true); box = new THREE.Box3().setFromObject(model); size = box.getSize(new THREE.Vector3()); }
  model.scale.multiplyScalar(3 / size.x); model.updateMatrixWorld(true);         // 3 units long
  box = new THREE.Box3().setFromObject(model);
  const ctr = box.getCenter(new THREE.Vector3());
  model.position.sub(new THREE.Vector3(ctr.x, box.min.y, ctr.z)); model.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(model);
  const lidNode = model.getObjectByName("lid"), lidBox = new THREE.Box3().setFromObject(lidNode);
  const H = lidBox.min.y;                                    // the top of the box, under the lid
  const lidPivot = new THREE.Group(); lidPivot.position.set(0, H, lidBox.min.z); coffin.add(lidPivot);
  lidPivot.attach(lidNode);                                  // the hinge: the back edge of the lid
  // green light leaking out between the lid and the box
  const seamMat = new THREE.SpriteMaterial({ map: null, color: 0x39ff88, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const seam = new THREE.Sprite(seamMat); seam.position.set(0, H + .01, (box.max.z + box.min.z) / 2 + .1); seam.scale.set(size.x * 0, .1, 1); coffin.add(seam);
  coffin.position.set(0, 0, .1);
  const key = new THREE.SpotLight(0xfff0dc, 16, 14, .5, .5, 1.1); key.position.set(1.5, 4.5, 3.5); key.target = coffin; scene.add(key);
  const inner = new THREE.PointLight(0x39ff88, 0, 1.8, 1.6); inner.position.set(0, H * .8, .1); scene.add(inner);
  const flash = new THREE.HemisphereLight(0xbfffe0, 0x0a1a10, 0); scene.add(flash);   // the lightning
  const CARD_Y = H * .55;                                    // the card lies inside, on the satin

  /* ---------- mist and embers ---------- */
  const [sc, sg] = canvas2d(128, 128);
  const sgr = sg.createRadialGradient(64, 64, 0, 64, 64, 64); sgr.addColorStop(0, "rgba(255,255,255,1)"); sgr.addColorStop(1, "rgba(255,255,255,0)");
  sg.fillStyle = sgr; sg.fillRect(0, 0, 128, 128);
  const soft = texOf(sc); seamMat.map = soft; seam.scale.set(3.3, .22, 1);
  const mist = [];
  for (let k = 0; k < (mobile ? 14 : 26); k++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft, color: k % 3 ? 0x2f8a57 : 0x6a4a9a, transparent: true, opacity: .16, depthWrite: false }));
    s.position.set((Math.random() - .5) * 9, .2 + Math.random() * .5, -Math.random() * 5 + 1); s.scale.setScalar(2.5 + Math.random() * 2.5);
    s.material.opacity = .09; s.userData.v = (Math.random() - .5) * .25; scene.add(s); mist.push(s);
  }
  const EMB = mobile ? 90 : 180, ePos = new Float32Array(EMB * 3), eSpd = new Float32Array(EMB);
  const resetEmber = (k, y) => { const a = Math.random() * 7, r = Math.random() * .5; ePos[k * 3] = Math.cos(a) * r; ePos[k * 3 + 1] = y ?? Math.random() * .3; ePos[k * 3 + 2] = Math.sin(a) * r; eSpd[k] = .4 + Math.random() * .9; };
  for (let k = 0; k < EMB; k++) resetEmber(k, Math.random() * 3);
  const embGeo = new THREE.BufferGeometry(); embGeo.setAttribute("position", new THREE.BufferAttribute(ePos, 3));
  const embers = new THREE.Points(embGeo, new THREE.PointsMaterial({ map: soft, color: 0x7dffb0, size: .09, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(embers);

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
  const faceMat = new THREE.MeshStandardMaterial({ map: texOf(fc), alphaMap: alpha, alphaTest: .5, roughness: .55, metalness: .1, emissive: 0xffffff, emissiveMap: texOf(fc), emissiveIntensity: .75 });
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
  cardG.add(face, sheet, back, rimMesh); scene.add(cardG);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft, color: 0x39ff88, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(3.2, 3.6, 1); scene.add(halo);

  /* ---------- bats ---------- */
  const [btc, btg] = canvas2d(256, 112); if (bat) btg.drawImage(bat, 0, 0, 256, 112);
  const batMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(btc), color: 0x000000, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const bats = Array.from({ length: mobile ? 7 : 11 }, (_, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(.42, .18), batMat); m.visible = false;
    m.userData = { a: k / 7 * Math.PI * 2 + Math.random(), r: 1.2 + Math.random() * 2.4, y: .6 + Math.random() * 1.8, s: .8 + Math.random() * .7, ph: Math.random() * 6 };
    scene.add(m); return m;
  });

  /* ---------- the film ---------- */
  const resize = () => { const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight; renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  resize(); addEventListener("resize", resize);
  const portrait = () => camera.aspect < .8;
  const T = 8.4;
  let raf = 0, t0 = 0, done;
  const finished = new Promise(r => done = r);
  const target = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), DOWN_UP = new THREE.Vector3(1, 0, 0);   // from above, the coffin stands upright on the screen and the card reads the right way
  cardG.rotation.order = "YXZ";                              // lying: turned along the coffin, back up; standing: facing us
  // three shots: the graveyard (the coffin opens), from above (the card lies face down in the satin), then in front
  const SHOT2 = 2.5, SHOT3 = 4.3;
  const frame = now => {
    if (!t0) t0 = now;
    const t = !host.isConnected ? T : window.__hxT ?? (now - t0) / 1000;   // host gone: skip to the end (__hxT: a frozen instant, for tests)
    const top = t >= SHOT2 && t < SHOT3;                    // the shot from above
    if (t < SHOT2) {                                         // 1. wide: we come closer to the coffin
      const app = ease.inOut(seg(t, 0, SHOT2)), far = portrait() ? 14 : 7.2, near = portrait() ? 9.5 : 5;
      camera.up.copy(UP); camera.position.set(Math.sin(t * .2) * .5, lerp(3.1, 2.4, app), lerp(far, near, app));
      target.set(0, .45, .1);
    } else if (t < SHOT3) {                                  // 2. straight above the card, slowly coming down, a slight turn
      const k = ease.inOut(seg(t, SHOT2, SHOT3)), h = (portrait() ? 3.4 : 3.6) - k * .6;
      camera.up.copy(DOWN_UP).applyAxisAngle(UP, .12 - k * .2);
      camera.position.set(0, CARD_Y + h, .1 + .001); target.set(0, CARD_Y, .1);
    } else {                                                 // 3. in front, low: the card rises and turns to us
      const push = ease.out(seg(t, 6.6, 7.8)), dist = portrait() ? 8.4 : 5.2;
      camera.up.copy(UP); camera.position.set(Math.sin(t * .2) * .3, 1.25 + (t - SHOT3) * .04, dist - push * (portrait() ? 1.2 : 1.1));
      target.set(0, lerp(.9, 1.5, ease.out(seg(t, SHOT3, 5.2))), .45);
    }
    camera.lookAt(target);
    // lightning twice, the coffin rattles, green light leaks out
    const bolt = Math.max(0, 1 - Math.abs(t - .45) * 14) + Math.max(0, 1 - Math.abs(t - 1.05) * 10) * .7;
    flash.intensity = bolt * 3; bloom.strength = (top ? .3 : .55) + bolt * .6 + seg(t, 5.7, 6.4) * 1.1 * (1 - seg(t, 6.6, 7.7));
    const shake = seg(t, .6, 1.5) * (1 - seg(t, 1.45, 1.6));
    coffin.rotation.z = Math.sin(t * 55) * .01 * shake; coffin.position.y = Math.abs(Math.sin(t * 38)) * .02 * shake;
    seamMat.opacity = seg(t, .5, 1.3) * (.6 + .4 * Math.sin(t * 20)) * (1 - seg(t, 1.6, 2));
    // the lid flies open (a little bounce), light and mist pour out
    const open = seg(t, 1.5, 2.3);
    lidPivot.rotation.x = -(ease.out(open) * 1.95 - Math.sin(open * Math.PI) * .12 * (open > .7 ? 1 : 0));
    inner.intensity = ease.out(seg(t, 1.4, 2.2)) * (top ? 1.2 : 4) * (1 - seg(t, 6.4, 7.4) * .5);
    glow.intensity = seg(t, 1.5, 2.3) * 1.2 + seg(t, 5.6, 6.4) * 5 * (1 - seg(t, 6.6, 7.8));
    embers.visible = !top; embers.material.opacity = ease.out(seg(t, 1.6, 2.4)) * .9;
    for (let k = 0; k < EMB; k++) { ePos[k * 3 + 1] += eSpd[k] * .016 * (seg(t, 1.6, 2) + seg(t, 5.8, 6.6) * 2); if (ePos[k * 3 + 1] > 3.4) resetEmber(k); }
    embGeo.attributes.position.needsUpdate = true;
    for (const s of mist) { s.position.x += s.userData.v * .016; if (Math.abs(s.position.x) > 5) s.userData.v *= -1; }
    // the card: face down in the satin; it trembles, lifts a little, then rises, spins and stands facing us
    const tremble = seg(t, 3.2, SHOT3) * (t < SHOT3 ? 1 : 0), lift = ease.inOut(seg(t, 3.7, SHOT3)) * .18;
    const rise = ease.out(seg(t, SHOT3, 5.2)), stand = ease.inOut(seg(t, SHOT3 + .2, 5.1));
    cardG.position.set(Math.sin(t * 47) * .008 * tremble, lerp(CARD_Y + lift, 1.55, rise) + Math.sin(t * 2) * .03 * seg(t, 5.2, 5.6), lerp(.1, .45, rise));
    cardG.rotation.set(lerp(Math.PI / 2, 0, stand) + Math.sin(t * 31) * .02 * tremble, lerp(Math.PI * 4, 0, ease.out(seg(t, SHOT3, 5.4))), Math.sin(t * 1.6) * .03 * seg(t, 5.2, 6.4));
    cardG.scale.setScalar(lerp(.6, 1, ease.out(seg(t, SHOT3, 5))) + ease.out(seg(t, 6.6, 7.8)) * .06);   // small enough to lie inside
    halo.position.copy(cardG.position); halo.position.z -= .25; halo.material.opacity = seg(t, 4.6, 5.2) * .3 + seg(t, 5.6, 6.4) * .5 * (1 - seg(t, 6.8, 8.2));
    rimMesh.material.opacity = .6 + .4 * Math.sin(t * 9);
    // the burn
    uBurn.value = ease.inOut(seg(t, 5.6, 6.8));
    sheetMat.emissiveIntensity = .8 + seg(t, 5, 5.6) * .5; backMat.emissiveIntensity = top ? .45 : .8;
    // the bats burst out of the coffin when it opens, and circle away
    const fly = seg(t, 1.6, 7);
    bats.forEach(b => {
      const u = b.userData; b.visible = t > 1.6 && t < 7 && (t < SHOT2 || t > SHOT3);
      const a = u.a + fly * u.s * 5, r = .2 + ease.out(fly) * u.r * 1.6;
      b.position.set(Math.cos(a) * r, .5 + (u.y + .4) * ease.out(fly) + fly * 1.2, Math.sin(a) * r * .6 + .4);
      b.scale.y = .45 + .55 * Math.abs(Math.sin(t * 16 + u.ph)); b.lookAt(camera.position);
    });
    composer.render();
    if (t < T) raf = requestAnimationFrame(frameSafe); else done();
  };
  const frameSafe = now => { try { frame(now); } catch (e) { done(); throw e; } };
  raf = requestAnimationFrame(frameSafe);
  await finished;
  cancelAnimationFrame(raf); removeEventListener("resize", resize);
  canvas.remove(); renderer.dispose(); composer.dispose?.();
}
