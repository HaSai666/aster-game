/* ------------------------------------------------------------------
 * 金龙聚宝 · Service Worker
 * 把整个游戏缓存到本地：第二次打开瞬开，断网也能玩。
 * 策略是 cache-first + 后台更新（stale-while-revalidate）：
 * 先拿缓存立刻渲染，同时去网上取新版本存起来，下次打开就是新的。
 * ------------------------------------------------------------------ */
var VERSION = "jinlong-v4";
var SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./js/config.js",
  "./js/engine.js",
  "./js/art.js",
  "./js/audio.js",
  "./js/fx.js",
  "./js/render.js",
  "./js/app.js",
  "./manifest.webmanifest"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(VERSION)
      .then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; })
                             .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req).then(function (hit) {
      var live = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || live;
    })
  );
});
