/* Zik Hunter — the reveal of a Collection Hantée card in 3D: a graveyard in the fog, a magic circle lights up on the
   ground like a ritual, the cursed card rises out of it spinning, bats burst out, then fire eats its cover and the
   card shows. Green for the Collection Hantée; pumpkin orange under a full moon for the night of 31 October.
   Loaded only when a booster holds such a card. play() resolves when the film is over; the page then shows the HTML
   card in its place. */
const CDN = "https://cdn.jsdelivr.net/npm/three@0.160.0/";
const [THREE, { EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
  import(CDN + "+esm"),
  import(CDN + "examples/jsm/postprocessing/EffectComposer.js/+esm"),
  import(CDN + "examples/jsm/postprocessing/RenderPass.js/+esm"),
  import(CDN + "examples/jsm/postprocessing/UnrealBloomPass.js/+esm"),
  import(CDN + "examples/jsm/postprocessing/OutputPass.js/+esm"),
]);

const ease = { out: t => 1 - Math.pow(1 - t, 3), inOut: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2, soft: t => t * t * (3 - 2 * t) };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = t => Math.max(0, Math.min(1, t));
const seg = (t, a, b) => clamp01((t - a) / (b - a));          // 0 → 1 between a and b
const loadImg = (src, cors) => new Promise(r => { const i = new Image(); if (cors) i.crossOrigin = "anonymous"; i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
const canvas2d = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")]; };
const GREEN = "#39ff88";

export async function play(host, card) {
  // a card of the night of 31 October: the ritual, the card and its fire burn pumpkin orange, under a full moon
  const NIGHT = card.series === 2 || card.slot >= 14, ACC = NIGHT ? "#ff8a1f" : GREEN, ACC_HEX = NIGHT ? 0xff8a1f : 0x39ff88;
  const mobile = Math.min(innerWidth, innerHeight) < 600 || /Android|iPhone|iPad/.test(navigator.userAgent);
  const renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.25 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = mobile ? 1.15 : 1;
  renderer.setClearColor(NIGHT ? 0x06030a : 0x020604, 1);
  const canvas = renderer.domElement; canvas.className = "hx3d-gl";
  host.prepend(canvas);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(NIGHT ? 0x0a0508 : 0x020a06, .09);
  const camera = new THREE.PerspectiveCamera(34, 1, .05, 60);
  // the glow pass only on computers, at low resolution: phones render straight (smooth first)
  const composer = mobile ? null : new EffectComposer(renderer);
  let bloom = null;
  if (composer) {
    composer.setPixelRatio(1);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .55, .6, .72);
    composer.addPass(bloom); composer.addPass(new OutputPass());
  }
  const draw = () => composer ? composer.render() : renderer.render(scene, camera);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const texOf = cv => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; return t; };

  const [cover, bat, torn, rim, logo] = await Promise.all([loadImg(card.cover, true), loadImg("brand/bat.svg"), loadImg("brand/torn.svg"), loadImg("brand/torn-rim.svg"), loadImg("brand/zikhunter-icon.svg")]);
  await document.fonts?.ready;

  /* ---------- the ground, the graves, the moon ---------- */
  scene.add(new THREE.AmbientLight(NIGHT ? 0x3a2418 : 0x1a3a28, .6));
  const moon = new THREE.DirectionalLight(NIGHT ? 0xffc890 : 0x9fffd0, 1.1); moon.position.set(-3, 6, -4); scene.add(moon);
  const glow = new THREE.PointLight(ACC_HEX, 0, 9, 1.6); glow.position.set(0, .4, 0); scene.add(glow);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: NIGHT ? 0x0d0806 : 0x06100a, roughness: .38, metalness: .25 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const stone = new THREE.MeshStandardMaterial({ color: NIGHT ? 0x16100c : 0x0c1410, roughness: .9 });
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
  if (NIGHT) {                                   // a full moon, big and orange, with its craters
    const mgr = mg.createRadialGradient(256, 256, 0, 256, 256, 256); mgr.addColorStop(0, "rgba(255,246,220,1)"); mgr.addColorStop(.3, "rgba(255,210,130,1)"); mgr.addColorStop(.34, "rgba(255,150,60,.45)"); mgr.addColorStop(1, "rgba(0,0,0,0)");
    mg.fillStyle = mgr; mg.fillRect(0, 0, 512, 512);
    mg.fillStyle = "rgba(190,100,30,.28)"; for (const [x, y, r] of [[220, 230, 22], [290, 200, 14], [280, 290, 26], [205, 300, 12]]) { mg.beginPath(); mg.arc(x, y, r, 0, 7); mg.fill(); }
  } else {
    const mgr = mg.createRadialGradient(256, 256, 0, 256, 256, 256); mgr.addColorStop(0, "rgba(230,255,235,1)"); mgr.addColorStop(.35, "rgba(160,255,200,.35)"); mgr.addColorStop(1, "rgba(0,0,0,0)");
    mg.fillStyle = mgr; mg.fillRect(0, 0, 512, 512);
  }
  const moonSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: texOf(mc), transparent: true, depthWrite: false, fog: false }));
  moonSpr.material.opacity = NIGHT ? .95 : .7; moonSpr.position.set(-3.4, 4.6, -10); moonSpr.scale.setScalar(NIGHT ? 4.2 : 2.4); scene.add(moonSpr);

  /* ---------- the magic circle (the ritual), the pillar of light ---------- */
  const [cc, cg] = canvas2d(1024, 1024);
  cg.translate(512, 512); cg.strokeStyle = ACC; cg.fillStyle = ACC; cg.shadowColor = ACC; cg.shadowBlur = 18;
  for (const [r, w] of [[480, 10], [440, 4], [300, 6], [270, 3]]) { cg.lineWidth = w; cg.beginPath(); cg.arc(0, 0, r, 0, 7); cg.stroke(); }
  cg.lineWidth = 5; cg.beginPath();
  for (let k = 0; k <= 5; k++) { const a = -Math.PI / 2 + k * 4 * Math.PI / 5; cg[k ? "lineTo" : "moveTo"](Math.cos(a) * 430, Math.sin(a) * 430); }
  cg.stroke();
  cg.font = "bold 46px serif"; cg.textAlign = "center"; cg.textBaseline = "middle";
  const runes = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ";
  for (let k = 0; k < 24; k++) { cg.save(); cg.rotate(k * Math.PI / 12); cg.fillText(runes[k], 0, -372); cg.restore(); }
  const circle = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ map: texOf(cc), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  circle.rotation.x = -Math.PI / 2; circle.position.y = .01; scene.add(circle);
  const [pc, pg] = canvas2d(64, 256);
  const pgr = pg.createLinearGradient(0, 256, 0, 0); pgr.addColorStop(0, NIGHT ? "rgba(255,170,90,.9)" : "rgba(120,255,170,.9)"); pgr.addColorStop(1, NIGHT ? "rgba(255,170,90,0)" : "rgba(120,255,170,0)");
  pg.fillStyle = pgr; pg.fillRect(0, 0, 64, 256);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(.8, 1.1, 5, 48, 1, true), new THREE.MeshBasicMaterial({ map: texOf(pc), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide }));   // only its far wall: the light stays behind the card
  pillar.position.y = 2.5; scene.add(pillar);

  /* ---------- mist and embers ---------- */
  const [sc, sg] = canvas2d(128, 128);
  const sgr = sg.createRadialGradient(64, 64, 0, 64, 64, 64); sgr.addColorStop(0, "rgba(255,255,255,1)"); sgr.addColorStop(1, "rgba(255,255,255,0)");
  sg.fillStyle = sgr; sg.fillRect(0, 0, 128, 128);
  const soft = texOf(sc);
  const mist = [];
  for (let k = 0; k < (mobile ? 10 : 22); k++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft, color: k % 3 ? (NIGHT ? 0x8a4a2a : 0x2f8a57) : 0x6a4a9a, transparent: true, opacity: .09, depthWrite: false }));
    s.position.set((Math.random() - .5) * 9, .2 + Math.random() * .5, -Math.random() * 5 + 1); s.scale.setScalar(2.5 + Math.random() * 2.5);
    s.userData.v = (Math.random() - .5) * .25; scene.add(s); mist.push(s);
  }
  const EMB = mobile ? 70 : 160, ePos = new Float32Array(EMB * 3), eSpd = new Float32Array(EMB);
  const resetEmber = (k, y) => { const a = Math.random() * 7, r = Math.random() * 1.3; ePos[k * 3] = Math.cos(a) * r; ePos[k * 3 + 1] = y ?? Math.random() * .3; ePos[k * 3 + 2] = Math.sin(a) * r; eSpd[k] = .4 + Math.random() * .9; };
  for (let k = 0; k < EMB; k++) resetEmber(k, Math.random() * 3);
  const embGeo = new THREE.BufferGeometry(); embGeo.setAttribute("position", new THREE.BufferAttribute(ePos, 3));
  const embers = new THREE.Points(embGeo, new THREE.PointsMaterial({ map: soft, color: NIGHT ? 0xffc080 : 0x7dffb0, size: .09, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(embers);

  /* ---------- the card: its face, the cursed sheet over it (which burns), its back ---------- */
  const CW = 1.26, CH = 1.76, TW = 630, TH = 880;
  const [ac, ag] = canvas2d(TW, TH);                        // the torn outline, as an alpha map
  ag.fillStyle = "#000"; ag.fillRect(0, 0, TW, TH); if (torn) { ag.filter = "invert(1)"; ag.drawImage(torn, 0, 0, TW, TH); ag.filter = "none"; } else { ag.fillStyle = "#fff"; ag.fillRect(0, 0, TW, TH); }
  const alpha = new THREE.CanvasTexture(ac);
  const [fc, fg] = canvas2d(TW, TH);                        // the face, drawn like the HTML card
  fg.fillStyle = "#050806"; fg.fillRect(0, 0, TW, TH);
  if (cover) { const s = Math.max(TW / cover.width, TH / cover.height); fg.drawImage(cover, (TW - cover.width * s) / 2, (TH - cover.height * s) / 2, cover.width * s, cover.height * s); }
  let gr = fg.createLinearGradient(0, 0, 0, TH); gr.addColorStop(0, NIGHT ? "rgba(40,10,50,.3)" : "rgba(10,40,20,.15)"); gr.addColorStop(.55, NIGHT ? "rgba(60,20,0,.35)" : "rgba(0,30,12,.4)"); gr.addColorStop(.92, NIGHT ? "#070302" : "#020503");
  fg.fillStyle = gr; fg.fillRect(0, 0, TW, TH);
  fg.strokeStyle = "rgba(18,8,2,.9)"; fg.lineWidth = 40; fg.filter = "blur(12px)"; fg.strokeRect(0, 0, TW, TH); fg.filter = "none";
  if (NIGHT) {                                              // the full moon and the seal of the 31
    const mg = fg.createRadialGradient(TW * .74, TH * .2, 4, TW * .76, TH * .22, TW * .15); mg.addColorStop(0, "#fff6dc"); mg.addColorStop(.5, "#ffd98a"); mg.addColorStop(1, "rgba(232,138,42,0)");
    fg.globalCompositeOperation = "screen"; fg.fillStyle = mg; fg.beginPath(); fg.arc(TW * .76, TH * .22, TW * .15, 0, 7); fg.fill(); fg.globalCompositeOperation = "source-over";
    fg.save(); fg.translate(84, 140); fg.rotate(-.2); const sg = fg.createRadialGradient(-12, -14, 4, 0, 0, 48); sg.addColorStop(0, "#ff9a3a"); sg.addColorStop(.6, "#c2410c"); sg.addColorStop(1, "#6b1d03");
    fg.fillStyle = sg; fg.beginPath(); fg.arc(0, 0, 46, 0, 7); fg.fill(); fg.textAlign = "center"; fg.fillStyle = "#fff1d6"; fg.font = `900 38px Unbounded, sans-serif`; fg.fillText("31", 0, 10);
    fg.font = `700 12px "DM Mono", monospace`; fg.fillStyle = "#ffe2b0"; fg.fillText("OCT.", 0, 28); fg.restore();
  }
  fg.textAlign = "center"; fg.fillStyle = NIGHT ? "#ffe2b0" : "#b8ffcf"; fg.shadowColor = ACC; fg.shadowBlur = 12;
  fg.font = `600 17px "DM Mono", monospace`; fg.fillText(NIGHT ? "N U I T   D ' H A L L O W E E N" : "C O L L E C T I O N   H A N T É E", TW / 2, 48);
  fg.textAlign = "left";
  fg.font = `78px "Mrs Saint Delafield", cursive`; fg.fillStyle = NIGHT ? "#ffe6c4" : "#c9ffd9"; fg.shadowBlur = 20;
  fg.save(); fg.translate(36, TH - 160); fg.rotate(-.08); fg.fillText(card.artist, 0, 0); fg.restore();
  const title = card.title.toUpperCase(); let fs = 66; fg.font = `900 ${fs}px Unbounded, sans-serif`;
  while (fg.measureText(title).width > TW - 72 && fs > 30) { fs -= 2; fg.font = `900 ${fs}px Unbounded, sans-serif`; }
  gr = fg.createLinearGradient(0, TH - 130, 0, TH - 70); gr.addColorStop(0, NIGHT ? "#fff6e0" : "#f4ffe6"); gr.addColorStop(.5, NIGHT ? "#ffcf8a" : "#9dffbf"); gr.addColorStop(1, NIGHT ? "#ff8a1f" : "#1fd16a");
  fg.fillStyle = gr; fg.shadowBlur = 16; fg.fillText(title, 36, TH - 92);
  fg.shadowBlur = 0; fg.strokeStyle = NIGHT ? "rgba(255,140,40,.45)" : "rgba(57,255,136,.45)"; fg.lineWidth = 2; fg.beginPath(); fg.moveTo(36, TH - 72); fg.lineTo(TW - 36, TH - 72); fg.stroke();
  fg.font = `500 17px "DM Mono", monospace`; fg.fillStyle = NIGHT ? "#f2c08a" : "#9fd8b2"; fg.fillText(NIGHT ? "31 · 10 · 2026" : "HALLOWEEN 2026", 36, TH - 40);
  const no = String(card.no).padStart(String(card.of).length, "0");
  fg.textAlign = "right"; fg.font = `900 40px Unbounded, sans-serif`; fg.fillStyle = NIGHT ? "#fff1d6" : "#eaffd0"; fg.shadowColor = ACC; fg.shadowBlur = 14;
  fg.fillText(`${no}`, TW - 74, TH - 34); fg.font = `600 22px Unbounded, sans-serif`; fg.fillStyle = ACC; fg.fillText(`/${card.of}`, TW - 36, TH - 34);
  const [bc, bg] = canvas2d(TW, TH);                        // the cursed sheet and the back: charred, a glowing sigil
  gr = bg.createRadialGradient(TW / 2, TH * .45, 20, TW / 2, TH * .45, TH * .7); gr.addColorStop(0, NIGHT ? "#4a2a10" : "#1c4a2c"); gr.addColorStop(.6, NIGHT ? "#140a04" : "#08140c"); gr.addColorStop(1, NIGHT ? "#040201" : "#020403");
  bg.fillStyle = gr; bg.fillRect(0, 0, TW, TH);
  bg.strokeStyle = NIGHT ? "rgba(255,138,31,.5)" : "rgba(57,255,136,.5)"; bg.lineWidth = 4; bg.setLineDash([10, 12]); bg.beginPath(); bg.arc(TW / 2, TH * .45, 210, 0, 7); bg.stroke(); bg.setLineDash([]);
  bg.textAlign = "center"; bg.textBaseline = "middle"; bg.font = `900 300px Unbounded, sans-serif`; bg.fillStyle = NIGHT ? "rgba(255,138,31,.6)" : "rgba(57,255,136,.55)"; bg.shadowColor = ACC; bg.shadowBlur = 50; bg.fillText("?", TW / 2, TH * .46);
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
        totalEmissiveRadiance += ${NIGHT ? "vec3(1., .5, .1)" : "vec3(.25, 1., .5)"} * zEdge * 2.5;`);
  };
  const backMat = new THREE.MeshStandardMaterial({ map: texOf(bc), alphaMap: alpha, alphaTest: .5, roughness: .8, emissive: 0xffffff, emissiveMap: texOf(bc), emissiveIntensity: .8 });
  const cardG = new THREE.Group();
  const face = new THREE.Mesh(geo, faceMat), sheet = new THREE.Mesh(geo, sheetMat), back = new THREE.Mesh(geo, backMat);
  sheet.position.z = .004; back.rotation.y = Math.PI; back.position.z = -.002;
  const [rc, rg] = canvas2d(TW, TH); if (rim) { rg.filter = "invert(1) drop-shadow(0 0 6px #fff)"; rg.drawImage(rim, 0, 0, TW, TH); }
  const rimMesh = new THREE.Mesh(new THREE.PlaneGeometry(CW * 1.02, CH * 1.02), new THREE.MeshBasicMaterial({ color: ACC_HEX, alphaMap: new THREE.CanvasTexture(rc), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  rimMesh.position.z = .006;
  cardG.add(face, sheet, back, rimMesh); scene.add(cardG);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft, color: ACC_HEX, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
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
  const resize = () => { const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight; renderer.setSize(w, h, false); composer?.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  resize(); addEventListener("resize", resize);
  const portrait = () => camera.aspect < .8;
  const T = 6.2;
  const step = (t, dt = .016) => {
    const dist = portrait() ? 8.2 : 6;
    const push = ease.inOut(seg(t, 0, 3)) * .9 + ease.out(seg(t, 4.4, 5.6)) * (portrait() ? 1.6 : 1.3);
    camera.position.set(Math.sin(t * .15) * .6, 1.55 + .15 * Math.sin(t * .4), dist - push);
    camera.lookAt(0, 1.3, 0);
    const lit = ease.out(seg(t, .1, 1.1));
    circle.material.opacity = lit * (.85 + .15 * Math.sin(t * 6)); circle.rotation.z = t * .25;
    pillar.material.opacity = ease.soft(seg(t, .6, 1.6)) * .16 * (1 - seg(t, 3, 4.4) * .7);
    glow.intensity = lit * 2.5 + seg(t, 3.2, 4.2) * 5 * (1 - seg(t, 4.4, 5.6));
    embers.material.opacity = lit * .9;
    for (let k = 0; k < EMB; k++) { ePos[k * 3 + 1] += eSpd[k] * dt * (1 + seg(t, 3.4, 4.4) * 2); if (ePos[k * 3 + 1] > 3.4) resetEmber(k); }
    embGeo.attributes.position.needsUpdate = true;
    for (const s of mist) { s.position.x += s.userData.v * dt; if (Math.abs(s.position.x) > 5) s.userData.v *= -1; }
    // the card rises spinning, slows down facing us, hovers
    const rise = ease.out(seg(t, .7, 2.6));
    cardG.position.set(0, lerp(-.9, 1.35, rise) + Math.sin(t * 2) * .03 * seg(t, 2.6, 3), 0);
    const spin = 1 - ease.out(seg(t, .7, 2.8));
    cardG.rotation.set(0, spin * Math.PI * 6, Math.sin(t * 1.6) * .03);
    cardG.scale.setScalar(lerp(.55, 1, rise) * (1 + ease.out(seg(t, 4.3, 5.4)) * .08));
    halo.position.copy(cardG.position); halo.position.z -= .2; halo.material.opacity = rise * .3 + seg(t, 3.2, 4.2) * .4 * (1 - seg(t, 4.6, 6));
    rimMesh.material.opacity = .6 + .4 * Math.sin(t * 9);
    // the burn
    uBurn.value = ease.inOut(seg(t, 3.2, 4.5));
    sheetMat.emissiveIntensity = .8 + seg(t, 2.6, 3.2) * .5;
    if (bloom) bloom.strength = .55 + seg(t, 3.6, 4.3) * 1.1 * (1 - seg(t, 4.5, 5.6));
    // the bats burst out of the card and circle away
    const fly = seg(t, 2.7, 6.2);
    bats.forEach(b => {
      const u = b.userData; b.visible = t > 2.7 && t < 6.2;
      const a = u.a + fly * u.s * 5, r = .2 + ease.out(fly) * u.r * 1.6;
      b.position.set(Math.cos(a) * r, cardG.position.y + (u.y - 1.3) * ease.out(fly) + fly * 1.2, Math.sin(a) * r * .6 + .4);
      b.scale.y = .45 + .55 * Math.abs(Math.sin(t * 16 + u.ph)); b.lookAt(camera.position);
    });
    draw();
  };
  let raf = 0, t0 = 0, last = 0, done;
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
  for (const w of [.5, 2.9, 3.8, 5]) { step(w, 0); await new Promise(r => requestAnimationFrame(r)); }
  canvas.style.visibility = "";
  raf = requestAnimationFrame(frameSafe);
  await finished;
  cancelAnimationFrame(raf); removeEventListener("resize", resize);
  canvas.remove(); renderer.dispose(); composer?.dispose?.();
}
