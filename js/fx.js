/* ------------------------------------------------------------------
 * 金龙聚宝 · 全屏特效层
 * 盘面内部的粒子归 render.js 管，这里管的是"冲出机台、盖住整个屏幕"的那些：
 * 金币暴雨、冲击波、放射光、闪白、震屏。
 * 一张 position:fixed 的画布 + 几个 DOM 遮罩，z-index 压在 UI 之上、弹窗之下。
 * ------------------------------------------------------------------ */
(function (root) {
  "use strict";

  var GOLD = ["#ffe9a0", "#ffd15c", "#e8b640", "#fff6d8", "#c8901f"];
  var FESTIVE = ["#ffd15c", "#ff5a4e", "#fff6d8", "#3fd1a0", "#ff9a3c"];

  /* 画质档位。手机上默认从中档起步，再按实测帧时间自动升降。
   * 低端机最怕的不是粒子数量，是每个粒子都走一遍 shadowBlur —— 见 _sheet()。 */
  var TIERS = [
    { name: "low",  maxParticles: 420,  count: 0.45, storm: 0.45, dpr: 1,   rays: false },
    { name: "mid",  maxParticles: 900,  count: 0.75, storm: 0.72, dpr: 1.5, rays: true },
    { name: "high", maxParticles: 1600, count: 1,    storm: 1,    dpr: 2,   rays: true }
  ];

  /* 升降档的阈值必须绕开 vsync：60Hz 下帧间隔本来就是 16.7ms，
   * 升档阈值要是设在 16.7 以下就永远够不到，一旦降档再也升不回来。 */
  var DOWN_MS = 27;    // 慢于 ~37fps 就降档
  var UP_MS = 18.5;    // 稳在 60fps 附近才敢升档

  var SPRITE = 64;        // 精灵单帧边长
  var COIN_FRAMES = 10;   // 钱币翻滚的压扁帧
  var CONF_FRAMES = 8;    // 彩纸旋转帧

  function ScreenFX(canvas, shellEl) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.shell = shellEl;
    this.parts = [];
    this.rings = [];
    this.reduced = false;

    this.storm = null;          // { until, rate, carry }
    this.shakeAmount = 0;
    this.shakeUntil = 0;
    this._raf = null;
    this._last = 0;

    /* 粗判一下是不是手机：触摸屏 + 窄屏就从中档起步，
     * 免得第一次大奖还没来得及降档就先卡一下。 */
    var coarse = root.matchMedia && root.matchMedia("(pointer: coarse)").matches;
    this.tier = (coarse || root.innerWidth < 900) ? 1 : 2;
    this._sheets = {};          // 颜色 -> 预渲染精灵表
    this._frameEma = 16.7;      // 帧时间指数移动平均
    /* 开头几秒在建图集、解析脚本，帧时间天然难看，先不参与判断 */
    this._tierHold = performance.now() + 3000;
    this.paused = false;

    this.flashEl = document.getElementById("fx-flash");
    this.raysEl = document.getElementById("fx-rays");
    this.vignetteEl = document.getElementById("fx-vignette");

    this.resize();
    /* 开局就把调色板的精灵表全烤好。否则第一次大奖时才懒加载，
     * 一次要渲染 18 帧，在低端机上正好砸出一个上百毫秒的掉帧。 */
    var self = this;
    GOLD.concat(FESTIVE).forEach(function (col) { self._sheet(col); });

    root.addEventListener("resize", function () { self.resize(); });
    this.start();
  }

  ScreenFX.prototype.resize = function () {
    var dpr = Math.min(root.devicePixelRatio || 1, TIERS[this.tier].dpr);
    this.w = root.innerWidth;
    this.h = root.innerHeight;
    this.dpr = dpr;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  ScreenFX.prototype.start = function () {
    if (this._raf) return;
    var self = this;
    this._last = performance.now();
    var loop = function (now) {
      var dt = Math.min(0.05, (now - self._last) / 1000);
      self._last = now;
      /* 页面不可见时只排队、不渲染，省电也避免回来时积压一大堆 */
      if (!document.hidden) {
        self.update(dt, now);
        self.draw();
      }
      self._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  };

  /* 预渲染精灵表：把"圆形 + 发光 + 方孔"一次性烤进图里。
   * 之前每个粒子都要 save/translate/rotate/ellipse/fill/stroke + shadowBlur，
   * shadowBlur 在移动端是逐次软件模糊，几百个粒子直接把帧时间拉到 90ms。
   * 现在每个粒子只剩一次 drawImage。 */
  ScreenFX.prototype._sheet = function (color) {
    var cached = this._sheets[color];
    if (cached) return cached;

    var total = COIN_FRAMES + CONF_FRAMES;
    var cv = document.createElement("canvas");
    cv.width = SPRITE * total;
    cv.height = SPRITE;
    var c = cv.getContext("2d");
    var half = SPRITE / 2;
    var r = SPRITE * 0.30;      // 留出外发光的余量

    for (var i = 0; i < COIN_FRAMES; i++) {
      var squash = i / (COIN_FRAMES - 1);          // 0 = 侧面，1 = 正面
      var ry = r * (0.16 + squash * 0.84);
      c.save();
      c.translate(i * SPRITE + half, half);
      /* 外发光烤进精灵 */
      var glow = c.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 1.6);
      glow.addColorStop(0, color);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      c.globalAlpha = 0.55;
      c.fillStyle = glow;
      c.beginPath(); c.ellipse(0, 0, r * 1.6, Math.max(ry, r * 0.5) * 1.5, 0, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 1;
      c.fillStyle = color;
      c.beginPath(); c.ellipse(0, 0, r, ry, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "rgba(140,85,10,.75)";
      c.lineWidth = 1.2;
      c.stroke();
      if (squash > 0.55) {
        c.fillStyle = "rgba(130,78,8,.6)";
        c.fillRect(-r * 0.22, -ry * 0.22, r * 0.44, ry * 0.44);
      }
      c.restore();
    }

    for (var k = 0; k < CONF_FRAMES; k++) {
      var ang = (k / CONF_FRAMES) * Math.PI;
      c.save();
      c.translate((COIN_FRAMES + k) * SPRITE + half, half);
      c.rotate(ang);
      c.fillStyle = color;
      c.globalAlpha = 0.5;
      c.fillRect(-r * 0.9, -r * 0.5, r * 1.8, r);
      c.globalAlpha = 1;
      c.fillRect(-r * 0.8, -r * 0.26, r * 1.6, r * 0.52);
      c.restore();
    }

    this._sheets[color] = cv;
    return cv;
  };

  ScreenFX.prototype._push = function (p) {
    if (this.parts.length >= TIERS[this.tier].maxParticles) this.parts.shift();
    this.parts.push(p);
  };

  /* 从某一点炸开。默认从屏幕中心。 */
  ScreenFX.prototype.burst = function (count, opts) {
    opts = opts || {};
    if (this.reduced) count = Math.min(count, 24);
    count = Math.max(4, Math.round(count * TIERS[this.tier].count));
    var x = opts.x === undefined ? this.w / 2 : opts.x;
    var y = opts.y === undefined ? this.h * 0.45 : opts.y;
    var colors = opts.colors || GOLD;
    for (var i = 0; i < count; i++) {
      var a = opts.angle === undefined ? Math.random() * Math.PI * 2
        : opts.angle + (Math.random() - 0.5) * (opts.spread || 1.4);
      var sp = (opts.speed || 620) * (0.35 + Math.random() * 1.1);
      this._push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - (opts.lift || 180),
        g: opts.gravity === undefined ? 1150 : opts.gravity,
        drag: opts.drag === undefined ? 0.6 : opts.drag,
        life: 0, max: (opts.life || 1.5) * (0.6 + Math.random() * 0.8),
        size: (opts.size || 11) * (0.5 + Math.random()),
        color: colors[(Math.random() * colors.length) | 0],
        rot: Math.random() * 6.28,
        spin: (Math.random() - 0.5) * 16,
        shape: opts.shape || (Math.random() < 0.72 ? "coin" : "confetti"),
        glow: opts.glow !== false
      });
    }
  };

  /* 持续的金币暴雨：ms 毫秒内每秒 rate 枚。 */
  ScreenFX.prototype.coinStorm = function (ms, rate) {
    if (this.reduced) { ms = Math.min(ms, 700); rate = Math.min(rate, 25); }
    rate = Math.max(6, rate * TIERS[this.tier].storm);
    var until = performance.now() + ms;
    if (this.storm && this.storm.until > until) {
      this.storm.rate = Math.max(this.storm.rate, rate);
      return;
    }
    this.storm = { until: until, rate: rate, carry: 0 };
  };

  ScreenFX.prototype.stopStorm = function () { this.storm = null; };

  ScreenFX.prototype._spawnRain = function (n) {
    for (var i = 0; i < n; i++) {
      this._push({
        x: Math.random() * this.w,
        y: -40 - Math.random() * 180,
        vx: (Math.random() - 0.5) * 110,
        vy: 340 + Math.random() * 380,
        g: 620, drag: 0,
        life: 0, max: 4,
        size: 9 + Math.random() * 12,
        color: GOLD[(Math.random() * GOLD.length) | 0],
        rot: Math.random() * 6.28,
        spin: (Math.random() - 0.5) * 13,
        shape: Math.random() < 0.82 ? "coin" : "confetti",
        glow: true
      });
    }
  };

  /* 冲击波圆环 */
  ScreenFX.prototype.shockwave = function (opts) {
    opts = opts || {};
    this.rings.push({
      x: opts.x === undefined ? this.w / 2 : opts.x,
      y: opts.y === undefined ? this.h * 0.45 : opts.y,
      t: 0,
      dur: opts.dur || 900,
      color: opts.color || "#ffe08a",
      width: opts.width || 10,
      max: opts.max || Math.max(this.w, this.h) * 1.1
    });
  };

  /* 全屏闪白/闪金 */
  ScreenFX.prototype.flash = function (strength, color) {
    if (!this.flashEl) return;
    this.flashEl.style.background = color || "radial-gradient(ellipse at center, rgba(255,240,200,.95), rgba(255,180,60,.5) 45%, rgba(255,120,40,0) 75%)";
    this.flashEl.style.opacity = String(Math.min(1, strength));
    this.flashEl.classList.remove("run");
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add("run");
  };

  /* 背后的旋转放射光，用于大奖/玩法期间 */
  ScreenFX.prototype.rays = function (ms, intensity) {
    if (!this.raysEl || this.reduced || !TIERS[this.tier].rays) return;
    this.raysEl.style.setProperty("--rays-opacity", String(intensity || 0.5));
    this.raysEl.classList.add("on");
    clearTimeout(this._raysTimer);
    var el = this.raysEl;
    this._raysTimer = setTimeout(function () { el.classList.remove("on"); }, ms);
  };

  ScreenFX.prototype.raysOff = function () {
    if (this.raysEl) this.raysEl.classList.remove("on");
    clearTimeout(this._raysTimer);
  };

  /* 边缘染色，用于免费游戏 / 聚宝盆这类"持续状态" */
  ScreenFX.prototype.vignette = function (on, color) {
    if (!this.vignetteEl) return;
    this.vignetteEl.style.setProperty("--vig", color || "rgba(232,182,64,.35)");
    this.vignetteEl.classList.toggle("on", !!on);
  };

  ScreenFX.prototype.shake = function (strength, ms) {
    if (this.reduced) return;
    this.shakeAmount = Math.max(this.shakeAmount, strength);
    this.shakeUntil = Math.max(this.shakeUntil, performance.now() + (ms || 500));
  };

  /* 组合拳：一次"爆点"。level 1~4 逐级夸张。 */
  ScreenFX.prototype.impact = function (level, opts) {
    opts = opts || {};
    var n = [40, 110, 230, 420][Math.min(3, level - 1)];
    this.flash(0.35 + level * 0.16, opts.flashColor);
    this.shockwave({ color: opts.color || "#ffe08a", width: 6 + level * 4, dur: 700 + level * 180 });
    if (level >= 2) this.shockwave({ color: "#ff8a4a", width: 4 + level * 2, dur: 900 + level * 200 });
    this.burst(n, { speed: 520 + level * 220, size: 9 + level * 2, colors: opts.colors });
    this.shake(6 + level * 6, 380 + level * 160);
    if (level >= 3) this.coinStorm(1400 + level * 700, 30 + level * 26);
    if (level >= 2) this.rays(1200 + level * 600, 0.28 + level * 0.14);
  };

  /* 按实测帧时间自动升降画质。降档要快（卡了马上救），升档要慢（别来回抖）。 */
  ScreenFX.prototype._adapt = function (dtMs, now) {
    this._frameEma = this._frameEma * 0.9 + dtMs * 0.1;
    if (now < this._tierHold) return;
    if (this._frameEma > DOWN_MS && this.tier > 0) {
      this.tier--;
      this._tierHold = now + 3000;
      this.resize();
      if (this.tier === 0) this.raysOff();
      if (this.onTierChange) this.onTierChange(this.tier);
    } else if (this._frameEma < UP_MS && this.tier < TIERS.length - 1 && this.parts.length > 40) {
      /* 只有在"正扛着不少粒子还很流畅"的时候才敢升档 */
      this.tier++;
      this._tierHold = now + 6000;
      this.resize();
      if (this.onTierChange) this.onTierChange(this.tier);
    }
  };

  ScreenFX.prototype.update = function (dt, now) {
    var self = this;
    this._adapt(dt * 1000, now);

    if (this.storm) {
      if (now > this.storm.until) this.storm = null;
      else {
        this.storm.carry += this.storm.rate * dt;
        var n = Math.floor(this.storm.carry);
        if (n > 0) { this.storm.carry -= n; this._spawnRain(n); }
      }
    }

    this.parts = this.parts.filter(function (p) {
      p.life += dt;
      p.vy += p.g * dt;
      if (p.drag) {
        var k = Math.exp(-p.drag * dt);
        p.vx *= k; p.vy *= k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      return p.life < p.max && p.y < self.h + 80;
    });

    this.rings = this.rings.filter(function (r) {
      r.t += dt * 1000;
      return r.t < r.dur;
    });

    /* 震屏作用在 .shell 上；body 有 background-attachment:fixed，动 body 会出问题 */
    if (this.shell) {
      if (now < this.shakeUntil && this.shakeAmount > 0.3) {
        var d = this.shakeAmount * (1 - (now - (this.shakeUntil - 500)) / 500);
        d = Math.max(0, Math.min(this.shakeAmount, d));
        this.shell.style.transform = "translate(" + ((Math.random() - 0.5) * d).toFixed(2) + "px," +
          ((Math.random() - 0.5) * d).toFixed(2) + "px)";
        this.shakeAmount = Math.max(0, this.shakeAmount - dt * 26);
      } else if (this.shell.style.transform) {
        this.shell.style.transform = "";
        this.shakeAmount = 0;
      }
    }
  };

  ScreenFX.prototype.draw = function () {
    var ctx = this.ctx;
    var self = this;
    ctx.clearRect(0, 0, this.w, this.h);

    this.rings.forEach(function (r) {
      var tierHi = self.tier > 0;
      var t = r.t / r.dur;
      var e = 1 - Math.pow(1 - t, 3);
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = Math.max(1, r.width * (1 - t));
      if (tierHi) { ctx.shadowColor = r.color; ctx.shadowBlur = 26; }
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.max * e * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });

    /* 粒子：一个粒子一次 drawImage，全程不改 ctx 状态（除了 alpha）。
     * 以前这里是 save/translate/rotate/ellipse/fill/stroke + shadowBlur，
     * 在手机上几百个粒子就能把一帧拖到 90ms。 */
    var prevAlpha = -1;
    for (var i = 0; i < this.parts.length; i++) {
      var p = this.parts[i];
      var fade = 1 - p.life / p.max;
      var a = fade > 0.62 ? 1 : fade / 0.62;
      if (a <= 0.01) continue;
      /* alpha 量化到 0.05 一档，减少状态切换 */
      var qa = Math.round(a * 20) / 20;
      if (qa !== prevAlpha) { ctx.globalAlpha = qa; prevAlpha = qa; }

      var frame;
      if (p.shape === "coin") {
        frame = (Math.abs(Math.cos(p.rot * 1.5)) * (COIN_FRAMES - 1)) | 0;
      } else {
        frame = COIN_FRAMES + ((((p.rot / Math.PI) % 1) + 1) % 1 * CONF_FRAMES | 0);
      }
      var d = p.size * 2.4;      // 精灵里含发光余量
      ctx.drawImage(this._sheet(p.color), frame * SPRITE, 0, SPRITE, SPRITE,
                    p.x - d * 0.5, p.y - d * 0.5, d, d);
    }
    ctx.globalAlpha = 1;
  };

  root.ASTER_FX = { ScreenFX: ScreenFX, GOLD: GOLD, FESTIVE: FESTIVE };
})(typeof window !== "undefined" ? window : globalThis);
