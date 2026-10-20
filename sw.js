/* Zik Hunter — keeps the files of the artists' animation ("la pochette signée") on the device after the first visit:
   the three.js library (from jsDelivr) and the sleeve's models and textures. They are fetched once in the background,
   then served from here. Every other request goes to the network as usual. Bump CACHE when these files change. */
const CACHE = "zh-3d-v1";
const THREE = "https://cdn.jsdelivr.net/npm/three@0.160.0/";
const FILES = [
  THREE + "+esm",
  ...["loaders/GLTFLoader.js", "postprocessing/EffectComposer.js", "postprocessing/RenderPass.js", "postprocessing/UnrealBloomPass.js",
    "postprocessing/ShaderPass.js", "postprocessing/OutputPass.js", "postprocessing/BokehPass.js", "utils/BufferGeometryUtils.js"].map(f => THREE + "examples/jsm/" + f + "/+esm"),
  "sleeve3d.js?v=7",
  ...["desk_lamp/scene.gltf", "desk_lamp/desk_lamp_arm_01.bin", "desk_lamp/textures/desk_lamp_arm_01_arm_1k.jpg", "desk_lamp/textures/desk_lamp_arm_01_diff_1k.jpg",
    "desk_lamp/textures/desk_lamp_arm_01_nor_gl_1k.jpg", "marker/scene.gltf", "marker/scene.bin",
    "walnut/walnut_diff.jpg", "walnut/walnut_nor_gl.jpg", "walnut/walnut_rough.jpg"].map(f => "brand/3d/sleeve/" + f),
];
const kept = url => url.startsWith(THREE) || /\/brand\/3d\/sleeve\//.test(url) || /\/sleeve3d\.js(\?|$)/.test(url);

// first visit: download everything in the background (a file that fails is simply fetched later, when it is needed)
self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(FILES.map(u => c.add(new Request(u, { mode: "cors", credentials: "omit" }))))));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("zh-3d-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// those files: from the device if there, else from the network (and kept for next time)
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET" || !kept(r.url)) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(r, { ignoreVary: true });
    if (hit) return hit;
    const res = await fetch(r);
    if (res.ok) c.put(r, res.clone()).catch(() => {});
    return res;
  }));
});
