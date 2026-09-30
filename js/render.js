/* ------------------------------------------------------------------
 * 金龙聚宝 · 盘面渲染
 * Canvas 2D。和上一版最大的不同：这是真正的滚轮 ——
 * 每一轴都在自己的轮带上按"加速 → 匀速 → 减速 → 回弹"滚动，
 * 而不是每隔几十毫秒随机换一批图标。老虎机的手感八成来自这里。
 * ------------------------------------------------------------------ */
(function (root) {
  "use strict";

  var CONFIG = root.ASTER_CONFIG;
  var ART = root.ASTER_ART;
  var REELS = CONFIG.REELS;
  var ROWS = CONFIG.ROWS;

  function mod(n, m) { return ((n % m) + m) % m; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  /* 速度曲线：12% 加速 / 58% 匀速 / 30% 减速，积分后归一化到 [0,1]。
   * 用"先定路程再解速度"的方式，可以保证每一轴都精确停在目标格上。 */
  var ACCEL = 0.12, DECEL = 0.30, CRUISE = 1 - 0.12 - 0.30;
  var NORM = ACCEL / 2 + CRUISE + DECEL / 2;
  function travelled(u) {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    if (u < ACCEL) return (u * u / (2 * ACCEL)) / NORM;
    if (u < ACCEL + CRUISE) return (ACCEL / 2 + (u - ACCEL)) / NORM;
    var w = (u - ACCEL - CRUISE) / DECEL;
    return (ACCEL / 2 + CRUISE + DECEL * (w - w * w / 2)) / NORM;
  }

  function supportsCanvasFilter() {
    var c = document.createElement("canvas").getContext("2d");
    try { c.filter = "blur(2px)"; return c.filter === "blur(2px)"; } catch (err) { return false; }
  }

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true });
    this.dpr = 1;
    this.strips = CONFIG.STRIPS.base;
    this.reels = [];
    for (var c = 0; c < REELS; c++) {
      this.reels.push({ pos: c * 7, prevPos: c * 7, speed: 0, anim: null, bounce: null, flash: 0, teasing: false });
    }
    this.atlas = {};
    this.blurAtlas = {};
    this.layout = null;
    this.highlight = null;       // { cells:[{c,r}], pulse }
    this.dimOthers = false;
    this.wildReels = [];
    this.wildGrow = {};          // reelIndex -> 0..1
    this.hold = null;            // { board:[15], spinning:[15], flash:[15] }
    this.particles = [];
    this.rings = [];
    this.shakeAmount = 0;
    this.anticipation = {};      // reelIndex -> 0..1
    this.reducedMotion = false;
    this.flashOverlay = 0;
    this.onReelStop = null;
    this._raf = null;
    this._last = 0;
    this.filterOk = supportsCanvasFilter();
    this.resize();
    this.start();
  }

  /* ---------------- 布局与图集 ---------------- */

  Renderer.prototype.resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    var w = Math.max(320, Math.round(rect.width));
    var h = Math.max(200, Math.round(rect.height));
    this.dpr = Math.min(root.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    var padX = Math.round(w * 0.018);
    var padY = Math.round(h * 0.035);
    var gap = Math.max(4, Math.round(w * 0.008));
    var cellH = (h - padY * 2 - gap * (ROWS - 1)) / ROWS;
    var cellW = (w - padX * 2 - gap * (REELS - 1)) / REELS;
    /* 别让格子被拉成细长条或大扁块：超出比例就收窄并居中，
     * 两侧留白反而更像一台真的机柜。 */
    cellW = Math.min(cellW, cellH * 1.35);
    cellH = Math.min(cellH, cellW * 1.45);
    var gridW = cellW * REELS + gap * (REELS - 1);
    var gridH = cellH * ROWS + gap * (ROWS - 1);
    this.layout = {
      w: w, h: h, gap: gap,
      cellW: cellW, cellH: cellH,
      stepX: cellW + gap, stepY: cellH + gap,
      originX: (w - gridW) / 2,
      viewTop: (h - gridH) / 2,
      viewH: gridH
    };
    this.buildAtlas();
  };

  Renderer.prototype.buildAtlas = function () {
    var L = this.layout;
    var self = this;
    var w = Math.round(L.cellW * this.dpr);
    var h = Math.round(L.cellH * this.dpr);
    if (w < 2 || h < 2) return;
    this.atlas = {};
    this.blurAtlas = {};
    this.softAtlas = {};
    this.iconAtlas = {};

    Object.keys(CONFIG.SYMBOLS).forEach(function (key) {
      var sym = CONFIG.SYMBOLS[key];
      var cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      var c = cv.getContext("2d");
      c.scale(self.dpr, self.dpr);
      var special = key === "W" ? "wild" : key === "S" ? "scatter" : key === "C" ? "coin" : null;
      ART.drawPlate(c, L.cellW, L.cellH, { special: special });
      c.save();
      c.translate(L.cellW / 2, L.cellH / 2);
      ART.drawSymbol(c, key, sym, Math.min(L.cellW, L.cellH) * 0.82);
      c.restore();
      /* 特殊图标加一行小字，避免玩家不知道它是干什么的 */
      if (special) {
        var label = key === "W" ? "百搭" : key === "S" ? "免费" : "招财";
        c.font = ART.cjkFont(Math.max(9, Math.round(L.cellH * 0.11)), 700);
        c.textAlign = "center";
        c.textBaseline = "alphabetic";
        c.fillStyle = "rgba(255,226,150,.92)";
        c.strokeStyle = "rgba(0,0,0,.6)";
        c.lineWidth = 2.4;
        c.strokeText(label, L.cellW / 2, L.cellH - L.cellH * 0.06);
        c.fillText(label, L.cellW / 2, L.cellH - L.cellH * 0.06);
      }
      self.atlas[key] = cv;
      self.blurAtlas[key] = self._makeBlurred(cv, L.cellH * 0.34);
      self.softAtlas[key] = self._makeBlurred(cv, L.cellH * 0.12);

      /* 只有图标、没有底板也没有小字的版本：聚宝盆格子和展开的龙柱要用，
       * 顺便避免每帧重新走一遍矢量绘制。 */
      var icon = document.createElement("canvas");
      icon.width = w; icon.height = h;
      var ic = icon.getContext("2d");
      ic.scale(self.dpr, self.dpr);
      ic.translate(L.cellW / 2, L.cellH / 2);
      ART.drawSymbol(ic, key, sym, Math.min(L.cellW, L.cellH) * 0.82);
      self.iconAtlas[key] = icon;
    });
  };

  /* 方向性动态模糊：把图标沿纵向叠印多份。
   * 比 filter:blur() 更对：滚轮只在垂直方向运动，横向不该糊。 */
  Renderer.prototype._makeBlurred = function (source, spreadCss) {
    var cv = document.createElement("canvas");
    cv.width = source.width; cv.height = source.height;
    var c = cv.getContext("2d");
    var steps = 9;
    var spread = spreadCss * this.dpr;
    c.globalAlpha = 1 / steps;
    for (var i = 0; i < steps; i++) {
      c.drawImage(source, 0, (i / (steps - 1) - 0.5) * spread);
    }
    c.globalAlpha = 1;
    return cv;
  };

  Renderer.prototype.setStrips = function (strips) { this.strips = strips; };

  /* 直接把盘面对到某个停轮位置（开局 / 恢复用）。 */
  Renderer.prototype.setStops = function (stops) {
    for (var c = 0; c < REELS; c++) {
      this.reels[c].pos = stops[c];
      this.reels[c].prevPos = stops[c];
      this.reels[c].anim = null;
      this.reels[c].bounce = null;
    }
  };

  /* ---------------- 旋转 ---------------- */

  Renderer.prototype.spin = function (opts) {
    var self = this;
    var stops = opts.stops;
    var turbo = opts.turbo;
    var reduced = this.reducedMotion;
    var baseDur = reduced ? 260 : turbo ? 420 : 880;
    var stagger = reduced ? 40 : turbo ? 80 : 165;
    var speed = 24;   // 目标平均速度（格/秒）

    this.clearHighlight();
    this.wildReels = [];
    this.wildGrow = {};
    this.anticipation = {};
    this.reels.forEach(function (r) { r.teasing = false; });

    var promises = [];
    var startAt = performance.now();
    var pending = [];

    for (var c = 0; c < REELS; c++) {
      pending.push({
        index: c,
        delay: c * stagger,
        dur: baseDur + c * (reduced ? 20 : turbo ? 60 : 110)
      });
    }

    this._spinPlan = {
      pending: pending, stops: stops, startAt: startAt, speed: speed,
      extra: opts.anticipate || {},
      tease: opts.tease || {}
    };

    pending.forEach(function (p) {
      promises.push(new Promise(function (resolve) { p.resolve = resolve; }));
    });

    /* 逐轴启动，前面的轴先停；被标记期待的轴会额外多转很久。 */
    pending.forEach(function (p) {
      setTimeout(function () { self._launchReel(p); }, p.delay);
    });

    return Promise.all(promises);
  };

  /* 关键轴期待：在第 index 轴上额外拉长时间并打开视觉/听觉提示。 */
  Renderer.prototype.requestAnticipation = function (index, level) {
    if (!this._spinPlan) return;
    this._spinPlan.extra[index] = level;
  };

  Renderer.prototype._launchReel = function (p) {
    var self = this;
    var reel = this.reels[p.index];
    var len = this.strips[p.index].length;
    var stop = mod(this._spinPlan.stops[p.index], len);
    var extra = this._spinPlan.extra[p.index] || 0;
    var tease = this.reducedMotion ? 0 : (this._spinPlan.tease[p.index] || 0);
    var dur = p.dur + (extra ? (this.reducedMotion ? 300 : 1500 + extra * 800) : 0);

    /* 擦边球：先"差一点点"停住、顿一下，再蠕动到真正的位置。
     * tease 是提前停住的格数（1~2），所以第二段只要爬一两格。 */
    var firstTarget = tease ? mod(stop + tease, len) : stop;

    function finish() {
      reel.anim = null;
      reel.pos = stop;
      reel.bounce = { start: performance.now(), dur: self.reducedMotion ? 90 : 230, target: stop };
      reel.flash = 1;
      reel.teasing = false;
      if (self.onReelStop) self.onReelStop(p.index, !!extra);
      p.resolve();
    }

    function crawl() {
      reel.teasing = true;
      if (self.onReelTease) self.onReelTease(p.index);
      setTimeout(function () {
        reel.anim = {
          from: reel.pos, dist: tease, start: performance.now(), dur: 620,
          stop: stop, slow: true, done: finish
        };
      }, 560);
    }

    var from = reel.pos;
    var need = mod(from - firstTarget, len);
    var cycles = Math.max(1, Math.round((this._spinPlan.speed * dur / 1000 - need) / len));

    reel.anim = {
      from: from, dist: need + cycles * len, start: performance.now(), dur: dur, stop: firstTarget,
      done: tease ? function () {
        reel.anim = null;
        reel.pos = firstTarget;
        reel.bounce = { start: performance.now(), dur: 170, target: firstTarget };
        crawl();
      } : finish
    };
  };

  /* 神龙整轴展开动画 */
  Renderer.prototype.expandWilds = function (reels) {
    var self = this;
    this.wildReels = reels.slice();
    if (!reels.length) return Promise.resolve();
    var dur = this.reducedMotion ? 120 : 420;
    reels.forEach(function (c) { self.wildGrow[c] = 0; });
    var start = performance.now();
    return new Promise(function (resolve) {
      function step() {
        var t = clamp((performance.now() - start) / dur, 0, 1);
        reels.forEach(function (c) { self.wildGrow[c] = easeOutCubic(t); });
        if (t < 1) requestAnimationFrame(step); else resolve();
      }
      step();
    });
  };

  /* ---------------- 中奖展示 ---------------- */

  Renderer.prototype.setHighlight = function (cells, dimOthers) {
    this.highlight = cells && cells.length ? { cells: cells, t: 0 } : null;
    this.dimOthers = !!dimOthers;
  };

  Renderer.prototype.clearHighlight = function () {
    this.highlight = null;
    this.dimOthers = false;
  };

  Renderer.prototype.shake = function (strength) {
    if (this.reducedMotion) return;
    this.shakeAmount = Math.max(this.shakeAmount, strength);
  };

  Renderer.prototype.flash = function (amount) {
    this.flashOverlay = Math.max(this.flashOverlay, amount);
  };

  Renderer.prototype.ring = function (c, r, color) {
    var L = this.layout;
    this.rings.push({
      x: L.originX + c * L.stepX + L.cellW / 2,
      y: L.viewTop + r * L.stepY + L.cellH / 2,
      t: 0, dur: 620, color: color || "#ffd76a",
      size: Math.max(L.cellW, L.cellH)
    });
  };

  Renderer.prototype.burst = function (count, opts) {
    if (this.reducedMotion) count = Math.min(count, 10);
    opts = opts || {};
    var L = this.layout;
    var x = opts.x === undefined ? L.w / 2 : opts.x;
    var y = opts.y === undefined ? L.h / 2 : opts.y;
    var colors = opts.colors || ["#ffd76a", "#e8b640", "#ff6f5e", "#fff2c8"];
    for (var i = 0; i < count; i++) {
      var angle = opts.angle === undefined ? Math.random() * Math.PI * 2 : opts.angle + (Math.random() - 0.5) * 1.2;
      var speed = (opts.speed || 240) * (0.4 + Math.random() * 0.9);
      this.particles.push({
        x: x, y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (opts.lift || 90),
        g: opts.gravity === undefined ? 620 : opts.gravity,
        life: 0, max: 0.7 + Math.random() * 0.8,
        size: (opts.size || 6) * (0.5 + Math.random()),
        color: colors[(Math.random() * colors.length) | 0],
        spin: (Math.random() - 0.5) * 12,
        rot: Math.random() * 6.28,
        shape: opts.shape || "coin"
      });
    }
  };

  Renderer.prototype.coinRain = function (count) {
    var L = this.layout;
    for (var i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random() * L.w,
        y: -20 - Math.random() * 200,
        vx: (Math.random() - 0.5) * 60,
        vy: 120 + Math.random() * 180,
        g: 420, life: 0, max: 2.4,
        size: 7 + Math.random() * 7,
        color: ["#ffd76a", "#e8b640", "#fff2c8"][(Math.random() * 3) | 0],
        spin: (Math.random() - 0.5) * 10,
        rot: Math.random() * 6.28,
        shape: "coin"
      });
    }
  };

  /* ---------------- 聚宝盆（Hold & Spin）---------------- */

  Renderer.prototype.enterHold = function (board) {
    this.hold = {
      board: board.slice(),
      spinning: new Array(REELS * ROWS).fill(false),
      pop: new Array(REELS * ROWS).fill(0)
    };
    this.clearHighlight();
  };

  Renderer.prototype.exitHold = function () { this.hold = null; };

  Renderer.prototype.holdSpinning = function (on) {
    if (!this.hold) return;
    for (var i = 0; i < this.hold.spinning.length; i++) {
      this.hold.spinning[i] = on && !this.hold.board[i];
    }
  };

  Renderer.prototype.holdLand = function (index, value) {
    if (!this.hold) return;
    this.hold.board[index] = value;
    this.hold.spinning[index] = false;
    this.hold.pop[index] = 1;
    var L = this.layout;
    var c = Math.floor(index / ROWS), r = index % ROWS;
    this.ring(c, r, "#ffd76a");
    this.burst(14, {
      x: L.originX + c * L.stepX + L.cellW / 2,
      y: L.viewTop + r * L.stepY + L.cellH / 2,
      speed: 150, size: 5, lift: 40
    });
  };

  /* ---------------- 主循环 ---------------- */

  Renderer.prototype.start = function () {
    var self = this;
    if (this._raf) return;
    this._last = performance.now();
    var loop = function (now) {
      var dt = Math.min(0.05, (now - self._last) / 1000);
      self._last = now;
      self.update(dt, now);
      self.draw(now);
      self._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  };

  Renderer.prototype.update = function (dt, now) {
    var self = this;
    this.reels.forEach(function (reel) {
      reel.prevPos = reel.pos;
      if (reel.anim) {
        var a = reel.anim;
        var u = clamp((now - a.start) / a.dur, 0, 1);
        /* slow 段是擦边球的"最后一两格蠕动"，用缓出曲线而不是滚轮速度曲线 */
        reel.pos = a.from - a.dist * (a.slow ? easeOutCubic(u) : travelled(u));
        if (u >= 1) a.done();
      } else if (reel.bounce) {
        var b = reel.bounce;
        var s = clamp((now - b.start) / b.dur, 0, 1);
        /* 一次快速的过冲回弹：往下顶出一点再弹回来 */
        reel.pos = b.target - Math.sin(s * Math.PI) * (1 - s * 0.45) * 0.17;
        if (s >= 1) { reel.pos = b.target; reel.bounce = null; }
      }
      var delta = Math.abs(reel.pos - reel.prevPos);
      reel.speed = reel.speed * 0.6 + (delta / Math.max(dt, 0.001)) * 0.4;
      reel.flash = Math.max(0, reel.flash - dt * 4);
    });

    if (this.highlight) this.highlight.t += dt;
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 42);
    this.flashOverlay = Math.max(0, this.flashOverlay - dt * 2.6);

    this.rings = this.rings.filter(function (ring) {
      ring.t += dt * 1000;
      return ring.t < ring.dur;
    });

    this.particles = this.particles.filter(function (p) {
      p.life += dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      return p.life < p.max && p.y < self.layout.h + 60;
    });

    if (this.hold) {
      for (var i = 0; i < this.hold.pop.length; i++) {
        this.hold.pop[i] = Math.max(0, this.hold.pop[i] - dt * 3);
      }
    }
  };

  Renderer.prototype.draw = function (now) {
    var ctx = this.ctx;
    var L = this.layout;
    ctx.clearRect(0, 0, L.w, L.h);

    ctx.save();
    if (this.shakeAmount > 0.2) {
      ctx.translate((Math.random() - 0.5) * this.shakeAmount, (Math.random() - 0.5) * this.shakeAmount);
    }

    if (this.hold) this._drawHold(ctx, now);
    else this._drawReels(ctx, now);

    this._drawRings(ctx);
    this._drawParticles(ctx);
    ctx.restore();

    if (this.flashOverlay > 0.01) {
      ctx.fillStyle = "rgba(255,236,178," + (this.flashOverlay * 0.5) + ")";
      ctx.fillRect(0, 0, L.w, L.h);
    }
  };

  Renderer.prototype._cellRect = function (c, r) {
    var L = this.layout;
    return { x: L.originX + c * L.stepX, y: L.viewTop + r * L.stepY, w: L.cellW, h: L.cellH };
  };

  Renderer.prototype._isHighlighted = function (c, r) {
    if (!this.highlight) return false;
    for (var i = 0; i < this.highlight.cells.length; i++) {
      if (this.highlight.cells[i].c === c && this.highlight.cells[i].r === r) return true;
    }
    return false;
  };

  Renderer.prototype._drawReels = function (ctx, now) {
    var L = this.layout;
    /* 有轴在"顿停"时，其他轴压暗，把注意力全部推到那一轴上 */
    var spotlight = -1;
    for (var s = 0; s < REELS; s++) if (this.reels[s].teasing) { spotlight = s; break; }

    for (var c = 0; c < REELS; c++) {
      var reel = this.reels[c];
      var strip = this.strips[c];
      var len = strip.length;
      var base = Math.floor(reel.pos);
      var frac = reel.pos - base;
      /* 三档模糊：全速糊成一条，减速段软一点，一旦停下（含回弹）立刻清晰。
       * 只在 anim 阶段用模糊图，避免停轮后残留一两帧糊影。 */
      var bank = this.atlas;
      if (reel.anim) bank = reel.speed > 9 ? this.blurAtlas : reel.speed > 2.2 ? this.softAtlas : this.atlas;
      var x = L.originX + c * L.stepX;

      ctx.save();
      ctx.beginPath();
      ART.roundRect(ctx, x - 1, L.viewTop - 1, L.cellW + 2, L.viewH + 2, L.cellW * 0.13);
      ctx.clip();

      var anticipating = !!this.anticipation[c] && reel.anim;
      if (anticipating) {
        ctx.fillStyle = "rgba(255,120,60,.10)";
        ctx.fillRect(x - 2, L.viewTop - 2, L.cellW + 4, L.viewH + 4);
      }

      for (var r = -1; r <= ROWS; r++) {
        var key = strip[mod(base + r, len)];
        var y = L.viewTop + (r - frac) * L.stepY;
        var img = bank[key];
        if (!img) continue;

        var visible = r >= 0 && r < ROWS && !reel.anim && !reel.bounce;
        var isWin = visible && this._isHighlighted(c, r);
        var alpha = 1;
        if (this.dimOthers && visible && !isWin) alpha = 0.32;
        if (spotlight >= 0 && c !== spotlight) alpha = Math.min(alpha, 0.34);
        if (this.wildGrow[c] !== undefined && visible) alpha = 1;

        ctx.globalAlpha = alpha;
        if (isWin) {
          /* 中奖格：放大一点 + 金色外发光 */
          var pulse = 1 + Math.sin(this.highlight.t * 7) * 0.045;
          ctx.save();
          ctx.translate(x + L.cellW / 2, y + L.cellH / 2);
          ctx.scale(pulse, pulse);
          ctx.shadowColor = "rgba(255,214,110,.95)";
          ctx.shadowBlur = L.cellW * 0.30;
          ctx.drawImage(img, -L.cellW / 2, -L.cellH / 2, L.cellW, L.cellH);
          ctx.restore();
        } else {
          ctx.drawImage(img, x, y, L.cellW, L.cellH);
        }
        ctx.globalAlpha = 1;
      }

      /* 神龙整轴展开：一条竖向的金色龙柱盖住整轴 */
      var grow = this.wildGrow[c];
      if (grow > 0) this._drawWildColumn(ctx, c, grow);

      /* 停轮瞬间的一道白闪 */
      if (reel.flash > 0.01) {
        ctx.fillStyle = "rgba(255,240,200," + (reel.flash * 0.22) + ")";
        ctx.fillRect(x, L.viewTop, L.cellW, L.viewH);
      }
      ctx.restore();

      if (anticipating) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,168,70," + (0.5 + Math.sin(now / 90) * 0.35) + ")";
        ctx.lineWidth = 3;
        ART.roundRect(ctx, x - 2, L.viewTop - 2, L.cellW + 4, L.viewH + 4, L.cellW * 0.14);
        ctx.stroke();
        ctx.restore();
      }
      /* 擦边球顿住的那一下：整轴打上炽白边框，"差一点就中了" */
      if (reel.teasing) {
        var beat = 0.55 + Math.sin(now / 48) * 0.45;
        ctx.save();
        ctx.strokeStyle = "rgba(255,248,220," + beat + ")";
        ctx.lineWidth = 6;
        ctx.shadowColor = "#ffd15c";
        ctx.shadowBlur = 40;
        ART.roundRect(ctx, x - 4, L.viewTop - 4, L.cellW + 8, L.viewH + 8, L.cellW * 0.16);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,150,70," + (beat * 0.7) + ")";
        ctx.lineWidth = 2;
        ctx.shadowBlur = 0;
        ART.roundRect(ctx, x - 9, L.viewTop - 9, L.cellW + 18, L.viewH + 18, L.cellW * 0.18);
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  Renderer.prototype._drawWildColumn = function (ctx, c, grow) {
    var L = this.layout;
    var x = L.originX + c * L.stepX;
    var full = L.viewH;
    var h = full * grow;
    var y = L.viewTop + (full - h) / 2;

    ctx.save();
    ctx.globalAlpha = Math.min(1, grow * 1.4);
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, "#5a1417");
    g.addColorStop(0.5, "#7d1d1c");
    g.addColorStop(1, "#3d0d10");
    ART.roundRect(ctx, x, y, L.cellW, h, L.cellW * 0.13);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "rgba(255,214,110,.9)";
    ctx.shadowColor = "rgba(255,180,60,.9)";
    ctx.shadowBlur = 24;
    ctx.stroke();
    ctx.shadowBlur = 0;

    /* 龙身：叠瓦状鳞片铺满整轴，龙首压在中间 */
    ctx.save();
    ctx.beginPath();
    ART.roundRect(ctx, x, y, L.cellW, h, L.cellW * 0.13);
    ctx.clip();

    var scaleR = L.cellW * 0.115;
    ctx.strokeStyle = "rgba(255,214,110,.28)";
    ctx.lineWidth = Math.max(1.2, L.cellW * 0.012);
    for (var row = 0; row * scaleR * 1.1 < h + scaleR; row++) {
      var yy = y + row * scaleR * 1.1;
      var shift = (row % 2) * scaleR;
      for (var col = -1; col * scaleR * 2 < L.cellW + scaleR * 2; col++) {
        ctx.beginPath();
        ctx.arc(x + shift + col * scaleR * 2, yy, scaleR, Math.PI * 0.06, Math.PI * 0.94);
        ctx.stroke();
      }
    }

    /* 中段压暗，让龙首有地方站 */
    var vignette = ctx.createLinearGradient(0, y + h * 0.22, 0, y + h * 0.78);
    vignette.addColorStop(0, "rgba(40,6,8,0)");
    vignette.addColorStop(0.5, "rgba(40,6,8,.75)");
    vignette.addColorStop(1, "rgba(40,6,8,0)");
    ctx.fillStyle = vignette;
    ctx.fillRect(x, y, L.cellW, h);

    var icon = this.iconAtlas && this.iconAtlas.W;
    if (icon) {
      var iw = L.cellW * 1.18;
      var ih = L.cellH * 1.18;
      ctx.drawImage(icon, x + (L.cellW - iw) / 2, y + h / 2 - ih / 2, iw, ih);
    }
    ctx.restore();
    ctx.restore();
  };

  Renderer.prototype._drawHold = function (ctx, now) {
    var L = this.layout;
    for (var c = 0; c < REELS; c++) {
      for (var r = 0; r < ROWS; r++) {
        var index = c * ROWS + r;
        var rect = this._cellRect(c, r);
        var value = this.hold.board[index];

        if (value) {
          var pop = this.hold.pop[index];
          var scale = 1 + pop * 0.22;
          ctx.save();
          /* 锁定格的底板自己画，好让金色更亮 */
          ART.roundRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.w * 0.13);
          var g = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
          g.addColorStop(0, "#5c3f0a");
          g.addColorStop(0.55, "#402a05");
          g.addColorStop(1, "#271903");
          ctx.fillStyle = g;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = "rgba(255,214,110,.85)";
          ctx.shadowColor = "rgba(255,200,80,.7)";
          ctx.shadowBlur = rect.w * 0.2;
          ctx.stroke();
          ctx.shadowBlur = 0;

          ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
          ctx.scale(scale, scale);
          /* 用无底板、无小字的图标，免得"招财"两个字和面值叠在一起 */
          var icon = this.iconAtlas && this.iconAtlas.C;
          if (icon) ctx.drawImage(icon, -rect.w / 2, -rect.h * 0.60, rect.w, rect.h);
          ctx.font = "800 " + Math.round(rect.h * 0.24) + "px system-ui,'Microsoft YaHei',sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.lineWidth = Math.max(3, rect.h * 0.05);
          ctx.strokeStyle = "rgba(34,5,7,.95)";
          ctx.fillStyle = "#fff3c4";
          var text = value + "×";
          ctx.strokeText(text, 0, rect.h * 0.33);
          ctx.fillText(text, 0, rect.h * 0.33);
          ctx.restore();
        } else {
          ctx.save();
          ART.roundRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.w * 0.13);
          ctx.fillStyle = "rgba(24,8,10,.82)";
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = "rgba(232,182,64,.22)";
          ctx.stroke();
          if (this.hold.spinning[index]) {
            /* 空位在转：一圈跑动的光弧 */
            var a = now / 220 + index;
            ctx.beginPath();
            ctx.arc(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w * 0.22, a, a + 1.5);
            ctx.strokeStyle = "rgba(255,214,110,.75)";
            ctx.lineWidth = Math.max(2, rect.w * 0.035);
            ctx.stroke();
          }
          ctx.restore();
        }
      }
    }
  };

  Renderer.prototype._drawRings = function (ctx) {
    this.rings.forEach(function (ring) {
      var t = ring.t / ring.dur;
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.85;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = Math.max(1.5, 5 * (1 - t));
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.size * (0.28 + t * 0.85), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });
  };

  Renderer.prototype._drawParticles = function (ctx) {
    this.particles.forEach(function (p) {
      var life = 1 - p.life / p.max;
      ctx.save();
      ctx.globalAlpha = clamp(life * 1.4, 0, 1);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === "coin") {
        /* 用横向压扁模拟翻滚的钱币 */
        var squash = Math.abs(Math.cos(p.rot * 1.6));
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * (0.25 + squash * 0.75), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(150,90,10,.7)";
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      }
      ctx.restore();
    });
  };

  Renderer.prototype.cellCenter = function (c, r) {
    var rect = this._cellRect(c, r);
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  };

  root.ASTER_RENDER = { Renderer: Renderer };
})(typeof window !== "undefined" ? window : globalThis);
