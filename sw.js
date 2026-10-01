/* ------------------------------------------------------------------
 * 金龙聚宝 · Service Worker
 *
 * 策略分两类：
 *   代码（HTML / JS / CSS / manifest）—— network-first，带 2.5 秒超时
 *   其他（图标等静态资源）        —— cache-first
 *
 * 为什么代码不能 cache-first：上一版是 stale-while-revalidate，
 * 打开时先吃旧缓存、后台再更新，所以**发新版之后玩家第一次打开看到的还是旧版**，
 * 要再刷一次才生效。实际发生过：双厅上线后打开只有正常模式，因为 index.html
 * 和 app.js 都是上一版的。
 *
 * 换成 network-first 之后：有网必定是最新的；网慢（>2.5s）或断网则立刻回落到
 * 缓存，离线可玩这条没丢，代价只是联网时多等一个请求往返。
 * ------------------------------------------------------------------ */
var VERSION = "jinlong-v7";
var TIMEOUT = 2500;

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
      /* cache: "reload" 绕开浏览器自己的 HTTP 缓存 ——
       * GitHub Pages 发的是 max-age=600，不绕开的话装进来的可能还是旧的。 */
      .then(function (c) {
        return Promise.all(SHELL.map(function (u) {
          return fetch(new Request(u, { cache: "reload" }))
            .then(function (r) { if (r && r.ok) return c.put(u, r); })
            .catch(function () { /* 某个文件取不到不该让整个安装失败 */ });
        }));
      })
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

/* 代码类资源：导航请求，或路径以这些后缀结尾的 */
function isCode(req, url) {
  if (req.mode === "navigate") return true;
  return /\.(html|js|css|webmanifest)$/.test(url.pathname) || url.pathname.endsWith("/");
}

function networkFirst(req) {
  return new Promise(function (resolve) {
    var settled = false;
    var done = function (res) { if (!settled) { settled = true; resolve(res); } };

    /* 超时了先把缓存端上去，但网络那边还在跑 —— 它回来之后照样写进缓存，
     * 所以这一次虽然吃的是旧的，下一次一定是新的。 */
    var timer = setTimeout(function () {
      caches.match(req).then(function (hit) { if (hit) done(hit); });
    }, TIMEOUT);

    /* 注意这里不能直接 fetch(req)：req 走的是浏览器自己的 HTTP 缓存，
     * GitHub Pages 发 max-age=600，十分钟内 SW 拿到的还是旧响应 —— 实测过，
     * 换成 network-first 之后第一次刷新依然是旧版，就是卡在这一层。
     * cache:"no-cache" 强制带 ETag 去问一次：没变返回 304，几乎不花流量。 */
    fetch(req.url, { cache: "no-cache", credentials: "same-origin" }).then(function (res) {
      clearTimeout(timer);
      if (res && res.status === 200) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
      }
      done(res);
    }).catch(function () {
      clearTimeout(timer);
      caches.match(req).then(function (hit) {
        done(hit || new Response("离线且无缓存", { status: 503 }));
      });
    });
  });
}

function cacheFirst(req) {
  return caches.match(req).then(function (hit) {
    if (hit) return hit;
    return fetch(req).then(function (res) {
      if (res && res.status === 200) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
      }
      return res;
    });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(isCode(req, url) ? networkFirst(req) : cacheFirst(req));
});
