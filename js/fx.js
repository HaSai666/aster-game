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
  var MAX_PARTICLES = 1400;

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

    this.flashEl = document.getElementById("fx-flash");
    this.raysEl = document.getElementById("fx-rays");
    this.vignetteEl = document.getElementById("fx-vignette");

    this.resize();
    var self = this;
    root.addEventListener("resize", function () { self.resize(); });
    this.start();
  }

  ScreenFX.prototype.resize = function () {
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
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
      self.update(dt, now);
      self.draw();
      self._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  };

  ScreenFX.prototype._push = function (p) {
    if (this.parts.length >= MAX_PARTICLES) this.parts.shift();
    this.parts.push(p);
  };

  /* 从某一点炸开。默认从屏幕中心。 */
  ScreenFX.prototype.burst = function (count, opts) {
    opts = opts || {};
    if (this.reduced) count = Math.min(count, 24);
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
    if (!this.raysEl || this.reduced) return;
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

  ScreenFX.prototype.update = function (dt, now) {
    var self = this;

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
    ctx.clearRect(0, 0, this.w, this.h);

    this.rings.forEach(function (r) {
      var t = r.t / r.dur;
      var e = 1 - Math.pow(1 - t, 3);
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = Math.max(1, r.width * (1 - t));
      ctx.shadowColor = r.color;
      ctx.shadowBlur = 26;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.max * e * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });

    for (var i = 0; i < this.parts.length; i++) {
      var p = this.parts[i];
      var fade = 1 - p.life / p.max;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, fade * 1.6));
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.glow) { ctx.shadowColor = p.color; ctx.shadowBlur = p.size * 0.9; }
      ctx.fillStyle = p.color;
      if (p.shape === "coin") {
        /* 横向压扁模拟翻滚的钱币 */
        var squash = Math.abs(Math.cos(p.rot * 1.5));
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * 0.5, p.size * 0.5 * (0.2 + squash * 0.8), 0, 0, Math.PI * 2);
        ctx.fill();
        if (squash > 0.55) {
          ctx.fillStyle = "rgba(120,70,8,.55)";
          ctx.beginPath();
          ctx.rect(-p.size * 0.14, -p.size * 0.14 * squash, p.size * 0.28, p.size * 0.28 * squash);
          ctx.fill();
        }
      } else {
        ctx.fillRect(-p.size * 0.4, -p.size * 0.22, p.size * 0.8, p.size * 0.44);
      }
      ctx.restore();
    }
  };

  root.ASTER_FX = { ScreenFX: ScreenFX, GOLD: GOLD, FESTIVE: FESTIVE };
})(typeof window !== "undefined" ? window : globalThis);
