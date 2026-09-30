/* ------------------------------------------------------------------
 * 金龙聚宝 · 音频引擎
 * 全部由 WebAudio 实时合成，没有任何音频素材文件。
 * 三个让它不再像"电子哔哔声"的关键：
 *   1. 所有音色都走 ADSR 包络 + 低通滤波，而不是裸振荡器；
 *   2. 有一条程序生成脉冲响应的混响总线，声音落在同一个空间里；
 *   3. 旋律锁在五声音阶（宫商角徵羽）上，随便弹都是"中国味"。
 * ------------------------------------------------------------------ */
(function (root) {
  "use strict";

  /* 五声音阶（C 宫）：宫 商 角 徵 羽 */
  var PENTA = [0, 2, 4, 7, 9];
  function note(scaleDegree, octave) {
    var idx = ((scaleDegree % PENTA.length) + PENTA.length) % PENTA.length;
    var oct = (octave === undefined ? 4 : octave) + Math.floor(scaleDegree / PENTA.length);
    return 440 * Math.pow(2, (PENTA[idx] + (oct - 4) * 12 - 9) / 12);
  }

  function AudioEngine() {
    this.ctx = null;
    this.ready = false;
    this.sfxOn = true;
    this.musicOn = true;
    this.intensity = 0;        // 0 = 基础局，1 = 免费游戏 / 聚宝盆
    this._musicTimer = null;
    this._nextNoteAt = 0;
    this._step = 0;
    this._spinLoop = null;
    this._riser = null;
  }

  AudioEngine.prototype.unlock = function () {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return true;
    }
    var Ctx = root.AudioContext || root.webkitAudioContext;
    if (!Ctx) return false;
    try { this.ctx = new Ctx(); } catch (err) { return false; }

    var ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 1.25;

    /* 轻压缩，避免大奖时几层音叠在一起削顶 */
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 24;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.2;

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.8;
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.32;

    /* 每条轴一个声像位置：第 1 轴偏左、第 5 轴偏右。
     * 停轮声从左扫到右，这一下比任何混响都更能让机台"变宽"。 */
    this.reelBus = [];
    for (var i = 0; i < 5; i++) {
      var g = ctx.createGain();
      if (ctx.createStereoPanner) {
        var pan = ctx.createStereoPanner();
        pan.pan.value = -0.62 + i * 0.31;
        g.connect(pan);
        pan.connect(this.sfxBus);
      } else {
        g.connect(this.sfxBus);
      }
      this.reelBus.push(g);
    }

    /* 程序生成的混响脉冲响应：指数衰减噪声 + 轻微低通 */
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(2.4, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.34;

    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.reverbSend);
    this.musicBus.connect(this.reverbSend);
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.master);
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    this.ready = true;
    if (this.musicOn) this.startMusic();
    return true;
  };

  AudioEngine.prototype._makeImpulse = function (seconds, decay) {
    var ctx = this.ctx;
    var rate = ctx.sampleRate;
    var length = Math.floor(rate * seconds);
    var buffer = ctx.createBuffer(2, length, rate);
    for (var ch = 0; ch < 2; ch++) {
      var data = buffer.getChannelData(ch);
      var last = 0;
      for (var i = 0; i < length; i++) {
        var t = i / length;
        var n = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
        last = last * 0.55 + n * 0.45;   // 简易低通，让尾巴不刺耳
        data[i] = last;
      }
    }
    return buffer;
  };

  AudioEngine.prototype._noiseBuffer = function (seconds) {
    var ctx = this.ctx;
    var length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    var buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  };

  AudioEngine.prototype._now = function (delay) { return this.ctx.currentTime + (delay || 0); };

  /* ---- 基础音色 ---- */

  /* 古筝式拨弦：两个失谐锯齿波过低通，快速衰减，加一点起音噪声。 */
  AudioEngine.prototype.pluck = function (freq, opts) {
    if (!this.ready || !this.sfxOn) return;
    opts = opts || {};
    var ctx = this.ctx;
    var t = this._now(opts.delay);
    var dur = opts.dur || 0.85;
    var gain = ctx.createGain();
    var filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 3;
    filter.frequency.setValueAtTime(Math.min(12000, freq * 9), t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(180, freq * 1.4), t + dur * 0.7);

    var vol = (opts.vol === undefined ? 0.3 : opts.vol);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(vol * 0.28, t + 0.09);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    [0, -7, 7].forEach(function (detune, i) {
      var osc = ctx.createOscillator();
      osc.type = i === 0 ? "sawtooth" : "triangle";
      osc.frequency.value = freq;
      osc.detune.value = detune;
      var g = ctx.createGain();
      g.gain.value = i === 0 ? 0.6 : 0.24;
      osc.connect(g); g.connect(filter);
      osc.start(t); osc.stop(t + dur + 0.05);
    });

    /* 指甲触弦的起音 */
    var src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.03);
    var nf = ctx.createBiquadFilter();
    nf.type = "bandpass"; nf.frequency.value = freq * 4; nf.Q.value = 1.2;
    var ng = ctx.createGain(); ng.gain.value = vol * 0.5;
    src.connect(nf); nf.connect(ng); ng.connect(filter);
    src.start(t);

    filter.connect(gain);
    gain.connect(opts.bus || this.sfxBus);
  };

  /* FM 铃：钱币、锁定、计数用。 */
  AudioEngine.prototype.bell = function (freq, opts) {
    if (!this.ready || !this.sfxOn) return;
    opts = opts || {};
    var ctx = this.ctx;
    var t = this._now(opts.delay);
    var dur = opts.dur || 0.5;
    var vol = (opts.vol === undefined ? 0.2 : opts.vol);

    var carrier = ctx.createOscillator();
    carrier.type = "sine";
    carrier.frequency.value = freq;

    var mod = ctx.createOscillator();
    mod.type = "sine";
    mod.frequency.value = freq * (opts.ratio || 3.4);
    var modGain = ctx.createGain();
    modGain.gain.setValueAtTime(freq * (opts.index || 2.2), t);
    modGain.gain.exponentialRampToValueAtTime(freq * 0.05, t + dur * 0.5);
    mod.connect(modGain);
    modGain.connect(carrier.frequency);

    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    carrier.connect(gain);
    gain.connect(opts.bus || this.sfxBus);
    carrier.start(t); carrier.stop(t + dur + 0.05);
    mod.start(t); mod.stop(t + dur + 0.05);
  };

  /* 锣：一组非谐波分音 + 噪声，长衰减，重混响。 */
  AudioEngine.prototype.gong = function (opts) {
    if (!this.ready || !this.sfxOn) return;
    opts = opts || {};
    var ctx = this.ctx;
    var t = this._now(opts.delay);
    var base = opts.freq || 132;
    var dur = opts.dur || 3.4;
    var vol = (opts.vol === undefined ? 0.34 : opts.vol);

    var out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    out.connect(opts.bus || this.sfxBus);

    /* 非整数倍分音是"金属感"的来源 */
    [1, 2.37, 3.41, 4.72, 6.13, 8.29].forEach(function (ratio, i) {
      var osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(base * ratio, t);
      osc.frequency.exponentialRampToValueAtTime(base * ratio * 0.985, t + dur);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.9 / (i + 1.4), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur * (1 - i * 0.1));
      osc.connect(g); g.connect(out);
      osc.start(t); osc.stop(t + dur + 0.05);
    });

    var src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.28);
    var nf = ctx.createBiquadFilter();
    nf.type = "bandpass"; nf.frequency.value = base * 9; nf.Q.value = 0.8;
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(vol * 0.8, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    src.connect(nf); nf.connect(ng); ng.connect(out);
    src.start(t);
  };

  /* 太鼓：正弦下滑 + 噪声皮革声。 */
  AudioEngine.prototype.drum = function (opts) {
    if (!this.ready || !this.sfxOn) return;
    opts = opts || {};
    var ctx = this.ctx;
    var t = this._now(opts.delay);
    var vol = (opts.vol === undefined ? 0.4 : opts.vol);
    var from = opts.freq || 150;

    var osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(from * 0.32, t + 0.16);
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (opts.dur || 0.42));
    osc.connect(g); g.connect(opts.bus || this.sfxBus);
    osc.start(t); osc.stop(t + 0.6);

    var src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.08);
    var nf = ctx.createBiquadFilter();
    nf.type = "lowpass"; nf.frequency.value = 1800;
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(vol * 0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    src.connect(nf); nf.connect(ng); ng.connect(opts.bus || this.sfxBus);
    src.start(t);
  };

  /* 梆子/木鱼：极短的高频撞击，用在按钮和停轮上。 */
  AudioEngine.prototype.woodblock = function (opts) {
    if (!this.ready || !this.sfxOn) return;
    opts = opts || {};
    var ctx = this.ctx;
    var t = this._now(opts.delay);
    var vol = (opts.vol === undefined ? 0.22 : opts.vol);
    var src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.05);
    var bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = opts.freq || 1500;
    bp.Q.value = 7;
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (opts.dur || 0.075));
    src.connect(bp); bp.connect(g); g.connect(opts.bus || this.sfxBus);
    src.start(t);
  };

  /* ---- 夸张化：冲击、铺垫、钱币瀑布 ---- */

  /* 次低频下坠（sub drop）—— "咚"的那股压迫感来自这里 */
  AudioEngine.prototype.subDrop = function (opts) {
    if (!this.ready || !this.sfxOn) return;
    opts = opts || {};
    var ctx = this.ctx;
    var t = this._now(opts.delay);
    var dur = opts.dur || 1.1;
    var osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(opts.from || 180, t);
    osc.frequency.exponentialRampToValueAtTime(opts.to || 28, t + dur * 0.85);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.vol || 0.55, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    /* 轻微失真让它在小喇叭上也听得见 */
    var shaper = ctx.createWaveShaper();
    var curve = new Float32Array(1024);
    for (var i = 0; i < 1024; i++) {
      var x = (i / 512) - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    shaper.curve = curve;
    osc.connect(shaper); shaper.connect(g); g.connect(this.sfxBus);
    osc.start(t); osc.stop(t + dur + 0.1);
  };

  /* 上冲铺垫：白噪扫频 + 升调锯齿，用在特效爆发前 */
  AudioEngine.prototype.riser = function (ms, opts) {
    if (!this.ready || !this.sfxOn) return;
    opts = opts || {};
    var ctx = this.ctx;
    var t = this._now(opts.delay);
    var dur = ms / 1000;

    var src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(Math.max(0.3, dur));
    var bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 2.2;
    bp.frequency.setValueAtTime(320, t);
    bp.frequency.exponentialRampToValueAtTime(8200, t + dur);
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(opts.vol || 0.22, t + dur * 0.85);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
    src.connect(bp); bp.connect(ng); ng.connect(this.sfxBus);
    src.start(t); src.stop(t + dur + 0.2);

    var osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(note(0, 2), t);
    osc.frequency.exponentialRampToValueAtTime(note(0, 5), t + dur);
    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.Q.value = 6;
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.exponentialRampToValueAtTime(7000, t + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + dur * 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
    osc.connect(lp); lp.connect(g); g.connect(this.sfxBus);
    osc.start(t); osc.stop(t + dur + 0.2);
  };

  /* 钱币瀑布：一串随机音高的铃，持续 ms 毫秒 */
  AudioEngine.prototype.coinShower = function (ms, density) {
    if (!this.ready || !this.sfxOn) return;
    var n = Math.min(90, Math.round((ms / 1000) * (density || 16)));
    for (var i = 0; i < n; i++) {
      this.bell(note(Math.floor(Math.random() * 6), 5 + (Math.random() < 0.35 ? 1 : 0)), {
        delay: (i / n) * (ms / 1000) + Math.random() * 0.04,
        dur: 0.4, vol: 0.09 + Math.random() * 0.06, ratio: 3.1 + Math.random(), index: 1.6
      });
    }
  };

  /* 一记"爆点"。level 1~4 逐级夸张，和 fx.impact 配套使用。 */
  AudioEngine.prototype.impact = function (level) {
    var lv = Math.max(1, Math.min(4, level));
    this.subDrop({ vol: 0.35 + lv * 0.08, dur: 0.9 + lv * 0.25 });
    this.gong({ vol: 0.26 + lv * 0.07, dur: 2.4 + lv * 0.8 });
    for (var i = 0; i < lv + 1; i++) {
      this.drum({ delay: i * 0.085, freq: 150 - i * 8, vol: 0.34 + lv * 0.04 });
    }
    if (lv >= 2) this.coinShower(500 + lv * 350, 12 + lv * 6);
    if (lv >= 3) {
      for (var k = 0; k < 8; k++) this.pluck(note(k, 4), { delay: 0.18 + k * 0.065, dur: 0.9, vol: 0.2 });
    }
  };

  /* 擦边球顿住那一下：悬而未决的挂留和弦 */
  AudioEngine.prototype.tease = function () {
    this.drum({ freq: 190, vol: 0.42, dur: 0.5 });
    this.pluck(note(1, 4), { dur: 1.1, vol: 0.26 });
    this.pluck(note(3, 4), { delay: 0.04, dur: 1.1, vol: 0.22 });
    this.woodblock({ freq: 2200, vol: 0.2 });
  };

  /* ---- 游戏事件 ---- */

  AudioEngine.prototype.ui = function (kind) {
    if (kind === "hover") this.woodblock({ freq: 2600, vol: 0.05, dur: 0.03 });
    else if (kind === "deny") { this.pluck(note(0, 2), { dur: 0.3, vol: 0.18 }); this.woodblock({ freq: 700, vol: 0.12 }); }
    else this.woodblock({ freq: 1900, vol: 0.16 });
  };

  /* 旋转时的持续层：低频滚动 + 被扫频低通过滤的噪声。 */
  AudioEngine.prototype.startSpinLoop = function () {
    if (!this.ready || !this.sfxOn || this._spinLoop) return;
    var ctx = this.ctx;
    var t = this._now();
    var src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(2);
    src.loop = true;
    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(320, t);
    lp.frequency.linearRampToValueAtTime(1500, t + 0.5);
    lp.Q.value = 1.4;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.055, t + 0.12);
    src.connect(lp); lp.connect(g); g.connect(this.sfxBus);
    src.start(t);

    var drone = ctx.createOscillator();
    drone.type = "sawtooth";
    drone.frequency.value = note(0, 1);
    var dlp = ctx.createBiquadFilter();
    dlp.type = "lowpass"; dlp.frequency.value = 300;
    var dg = ctx.createGain();
    dg.gain.setValueAtTime(0.0001, t);
    dg.gain.exponentialRampToValueAtTime(0.05, t + 0.15);
    drone.connect(dlp); dlp.connect(dg); dg.connect(this.sfxBus);
    drone.start(t);

    this._spinLoop = { src: src, g: g, drone: drone, dg: dg };
    this.woodblock({ freq: 1200, vol: 0.2 });
  };

  AudioEngine.prototype.stopSpinLoop = function () {
    if (!this._spinLoop) return;
    var loop = this._spinLoop;
    this._spinLoop = null;
    var t = this._now();
    try {
      loop.g.gain.cancelScheduledValues(t);
      loop.g.gain.setValueAtTime(Math.max(0.0001, loop.g.gain.value), t);
      loop.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      loop.dg.gain.cancelScheduledValues(t);
      loop.dg.gain.setValueAtTime(Math.max(0.0001, loop.dg.gain.value), t);
      loop.dg.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      loop.src.stop(t + 0.25);
      loop.drone.stop(t + 0.25);
    } catch (err) { /* 已经停过了 */ }
  };

  /* 停轮：五声音阶逐轮上行，配一记木鱼。
   * 走对应轴的声像总线 —— 声音跟着眼睛从左扫到右。 */
  AudioEngine.prototype.reelStop = function (index, hot) {
    if (!this.ready) return;
    var bus = this.reelBus && this.reelBus[index] ? this.reelBus[index] : this.sfxBus;
    this.woodblock({ freq: 900 + index * 120, vol: hot ? 0.26 : 0.18, bus: bus });
    this.pluck(note(index, hot ? 4 : 3), { dur: hot ? 0.9 : 0.42, vol: hot ? 0.26 : 0.16, bus: bus });
    /* 落轴的"咚"：短促的低频，给停轮一点重量 */
    this.drum({ freq: 220 - index * 12, vol: hot ? 0.24 : 0.14, dur: 0.16, bus: bus });
  };

  /* 关键轮期待：上行滑音 + 心跳鼓。level 越高越紧张。 */
  AudioEngine.prototype.startAnticipation = function (level) {
    if (!this.ready || !this.sfxOn || this._riser) return;
    var ctx = this.ctx;
    var t = this._now();
    var osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(note(0, 2), t);
    osc.frequency.exponentialRampToValueAtTime(note(0, 4), t + 2.6);
    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(4200, t + 2.6);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 + level * 0.03, t + 0.3);
    /* 颤音，让紧张感"抖"起来 */
    var lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.setValueAtTime(5, t);
    lfo.frequency.linearRampToValueAtTime(11, t + 2.6);
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain); lfoGain.connect(g.gain);

    osc.connect(lp); lp.connect(g); g.connect(this.sfxBus);
    osc.start(t); lfo.start(t);
    this._riser = { osc: osc, g: g, lfo: lfo };
    this.drum({ freq: 110, vol: 0.3 });
  };

  AudioEngine.prototype.stopAnticipation = function () {
    if (!this._riser) return;
    var r = this._riser;
    this._riser = null;
    var t = this._now();
    try {
      r.g.gain.cancelScheduledValues(t);
      r.g.gain.setValueAtTime(Math.max(0.0001, r.g.gain.value), t);
      r.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      r.osc.stop(t + 0.2); r.lfo.stop(t + 0.2);
    } catch (err) { /* noop */ }
  };

  AudioEngine.prototype.coin = function (index) {
    var i = index || 0;
    this.bell(note(2 + (i % 4), 5), { dur: 0.45, vol: 0.17, ratio: 3.1, index: 1.8, delay: i * 0.06 });
  };

  AudioEngine.prototype.dragon = function () {
    if (!this.ready || !this.sfxOn) return;
    var ctx = this.ctx;
    var t = this._now();
    /* 低沉的龙吟：锯齿波扫频过共振低通 */
    var osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(note(0, 2), t);
    osc.frequency.exponentialRampToValueAtTime(note(3, 3), t + 0.35);
    osc.frequency.exponentialRampToValueAtTime(note(0, 2), t + 1.1);
    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.Q.value = 9;
    lp.frequency.setValueAtTime(600, t);
    lp.frequency.exponentialRampToValueAtTime(2600, t + 0.4);
    lp.frequency.exponentialRampToValueAtTime(500, t + 1.2);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    osc.connect(lp); lp.connect(g); g.connect(this.sfxBus);
    osc.start(t); osc.stop(t + 1.4);
    this.drum({ freq: 130, vol: 0.5 });
    this.drum({ delay: 0.11, freq: 108, vol: 0.4 });
    this.subDrop({ vol: 0.4, dur: 1.1 });
    this.gong({ freq: 96, vol: 0.26, dur: 2.8, delay: 0.04 });
  };

  /* 中奖：五声音阶上行琶音，层数随奖级递增。大奖级另外叠冲击与钱币瀑布。 */
  AudioEngine.prototype.win = function (tierId) {
    var levels = { tiny: 2, small: 3, nice: 5, big: 8, mega: 11, super: 14, legend: 18 };
    var count = levels[tierId] || 3;
    for (var i = 0; i < count; i++) {
      this.pluck(note(i, 4), { delay: i * 0.068, dur: 0.7, vol: 0.22 });
      if (i % 2 === 0) this.bell(note(i, 5), { delay: i * 0.068 + 0.02, dur: 0.4, vol: 0.1 });
    }
    if (count >= 5) {
      this.gong({ delay: 0.02, vol: 0.32 });
      this.drum({ delay: 0.02, vol: 0.44 });
    }
    if (count >= 8) {
      this.subDrop({ vol: 0.38, dur: 1 });
      this.coinShower(900, 16);
      for (var k = 0; k < 5; k++) this.drum({ delay: 0.45 + k * 0.13, freq: 150, vol: 0.3 });
    }
    if (count >= 11) this.coinShower(2000, 22);
    if (count >= 14) {
      for (var j = 0; j < 8; j++) this.gong({ delay: 0.3 + j * 0.42, vol: 0.2, dur: 2.6, freq: 120 + j * 9 });
    }
  };

  /* 数字滚动时的连续 tick，音高随进度上行。 */
  AudioEngine.prototype.countTick = function (progress) {
    this.bell(note(Math.floor(progress * 10), 5), { dur: 0.13, vol: 0.075, ratio: 2.4, index: 1.1 });
  };

  AudioEngine.prototype.chargeTick = function (ratio) {
    this.bell(note(Math.floor(ratio * 8), 4 + (ratio > 0.6 ? 1 : 0)), { dur: 0.32, vol: 0.13, ratio: 2.8 });
  };

  AudioEngine.prototype.freeSpinsStart = function () {
    this.riser(900);
    this.gong({ delay: 0.9, vol: 0.55, dur: 5 });
    this.subDrop({ delay: 0.9, vol: 0.5, dur: 1.4 });
    for (var i = 0; i < 10; i++) this.drum({ delay: 0.9 + i * 0.12, freq: 115 + i * 10, vol: 0.38 });
    for (var k = 0; k < 10; k++) this.pluck(note(k, 4), { delay: 1.2 + k * 0.09, dur: 1, vol: 0.24 });
    this.coinShower(2400, 18);
  };

  AudioEngine.prototype.holdStart = function () {
    this.riser(800);
    this.gong({ delay: 0.8, freq: 176, vol: 0.5, dur: 4 });
    this.subDrop({ delay: 0.8, vol: 0.45, dur: 1.2 });
    for (var i = 0; i < 5; i++) this.bell(note(i, 5), { delay: 0.85 + i * 0.1, dur: 0.7, vol: 0.22 });
    for (var k = 0; k < 6; k++) this.drum({ delay: 0.8 + k * 0.14, freq: 130, vol: 0.34 });
  };

  /* 聚宝盆里锁定一枚钱币。streak 越大音越高，连锁感更强。 */
  AudioEngine.prototype.holdLock = function (streak) {
    var s = Math.min(9, streak || 0);
    this.woodblock({ freq: 2400 + s * 130, vol: 0.2 });
    this.bell(note(s % 5, 5 + (s > 4 ? 1 : 0)), { dur: 0.8, vol: 0.26, ratio: 3.9, index: 2.8 });
    this.drum({ freq: 200 + s * 14, vol: 0.22, dur: 0.22 });
  };

  AudioEngine.prototype.grand = function () {
    this.riser(1100);
    this.gong({ delay: 1.1, vol: 0.62, dur: 6 });
    this.subDrop({ delay: 1.1, vol: 0.6, dur: 1.8 });
    for (var i = 0; i < 20; i++) this.pluck(note(i, 4), { delay: 1.15 + i * 0.062, dur: 1.2, vol: 0.26 });
    for (var k = 0; k < 16; k++) this.drum({ delay: 1.1 + k * 0.1, freq: 140, vol: 0.4 });
    this.coinShower(5000, 26);
  };

  /* ---- 背景音乐：五声音阶琶音 + 低音垫，免费游戏时加鼓与密度 ---- */
  AudioEngine.prototype.startMusic = function () {
    if (!this.ready || this._musicTimer) return;
    var self = this;
    this._nextNoteAt = this.ctx.currentTime + 0.1;
    this._step = 0;
    this._musicTimer = setInterval(function () { self._schedule(); }, 25);
  };

  AudioEngine.prototype.stopMusic = function () {
    if (this._musicTimer) clearInterval(this._musicTimer);
    this._musicTimer = null;
  };

  AudioEngine.prototype.setIntensity = function (value) {
    this.intensity = value;
    if (this.ready) {
      this.musicBus.gain.setTargetAtTime(0.32 + value * 0.16, this.ctx.currentTime, 0.4);
    }
  };

  /* 前瞻式调度：每 25ms 醒一次，把接下来 200ms 内要响的音都排进去。
   * 四小节一个循环，走 宫 → 羽 → 徵 → 商 的和声，比单调琶音耐听得多。 */
  var CHORDS = [0, 4, 3, 1];
  var ARP = [0, 2, 4, 2, 3, 1, 4, 2];

  AudioEngine.prototype._schedule = function () {
    if (!this.ready || !this.musicOn) return;
    var ctx = this.ctx;
    var hot = this.intensity > 0.5;
    var beat = hot ? 0.28 : 0.40;

    while (this._nextNoteAt < ctx.currentTime + 0.2) {
      var t = this._nextNoteAt;
      var step = this._step;
      var bar = Math.floor(step / 8);
      var inBar = step % 8;
      var root = CHORDS[bar % CHORDS.length];

      /* 琶音：主旋律层 */
      this._musicNote(note(root + ARP[inBar], inBar === 0 ? 5 : 4), t, beat);

      /* 低音：每小节的 1 和 5 拍，撑住底 */
      if (inBar === 0 || inBar === 4) {
        this._musicBass(note(root, 2), t, beat * (inBar === 0 ? 4 : 3.4));
      }

      /* 垫：整小节 */
      if (inBar === 0) this._musicPad(note(root, 3), t, beat * 8);

      /* 笛子对句：只在每两小节的后半段冒出来，留白才好听 */
      if (bar % 2 === 1 && inBar >= 4) {
        this._musicFlute(note(root + ARP[(inBar + 3) % 8] + 2, 5), t, beat * 1.6);
      }

      /* 免费游戏 / 聚宝盆：加一层鼓，速度也更快 */
      if (hot && inBar % 2 === 0) {
        this.drum({ delay: t - ctx.currentTime, freq: inBar === 0 ? 118 : 94, vol: 0.14, dur: 0.24 });
      }

      this._nextNoteAt += beat;
      this._step++;
    }
  };

  AudioEngine.prototype._musicNote = function (freq, t, beat) {
    var ctx = this.ctx;
    var osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(freq * 6, t);
    lp.frequency.exponentialRampToValueAtTime(freq * 1.5, t + beat);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.095, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + beat * 1.6);
    osc.connect(lp); lp.connect(g); g.connect(this.musicBus);
    osc.start(t); osc.stop(t + beat * 1.8);
  };

  /* 低音：正弦为主、加一点三角波泛音，短促有弹性 */
  AudioEngine.prototype._musicBass = function (freq, t, dur) {
    var ctx = this.ctx;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.13, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.04, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 360;
    lp.connect(g); g.connect(this.musicBus);
    [[1, "sine", 1], [2, "triangle", 0.3]].forEach(function (p) {
      var osc = ctx.createOscillator();
      osc.type = p[1];
      osc.frequency.value = freq * p[0];
      var og = ctx.createGain();
      og.gain.value = p[2];
      osc.connect(og); og.connect(lp);
      osc.start(t); osc.stop(t + dur + 0.1);
    });
  };

  /* 笛子对句：正弦 + 轻颤音，起音慢一点，像有人在远处吹 */
  AudioEngine.prototype._musicFlute = function (freq, t, dur) {
    var ctx = this.ctx;
    var osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * 0.995, t);
    osc.frequency.linearRampToValueAtTime(freq, t + 0.08);

    var vib = ctx.createOscillator();
    vib.type = "sine";
    vib.frequency.value = 5.2;
    var vibGain = ctx.createGain();
    vibGain.gain.value = freq * 0.006;
    vib.connect(vibGain); vibGain.connect(osc.frequency);

    var breath = ctx.createBufferSource();
    breath.buffer = this._noiseBuffer(Math.max(0.1, dur));
    var bf = ctx.createBiquadFilter();
    bf.type = "bandpass"; bf.frequency.value = freq * 2; bf.Q.value = 1.4;
    var bg = ctx.createGain();
    bg.gain.setValueAtTime(0.012, t);
    bg.gain.exponentialRampToValueAtTime(0.0002, t + dur * 0.6);

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.055, t + 0.09);
    g.gain.setValueAtTime(0.055, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g); breath.connect(bf); bf.connect(bg); bg.connect(g);
    g.connect(this.musicBus);
    osc.start(t); osc.stop(t + dur + 0.1);
    vib.start(t); vib.stop(t + dur + 0.1);
    breath.start(t);
  };

  AudioEngine.prototype._musicPad = function (freq, t, dur) {
    var ctx = this.ctx;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 520;
    lp.connect(g); g.connect(this.musicBus);
    [1, 1.5, 2.01].forEach(function (ratio, i) {
      var osc = ctx.createOscillator();
      osc.type = i === 2 ? "triangle" : "sawtooth";
      osc.frequency.value = freq * ratio;
      osc.detune.value = i * 6;
      var og = ctx.createGain();
      og.gain.value = 1 / (i + 1.6);
      osc.connect(og); og.connect(lp);
      osc.start(t); osc.stop(t + dur + 0.2);
    });
  };

  AudioEngine.prototype.setSfx = function (on) {
    this.sfxOn = on;
    if (!on) { this.stopSpinLoop(); this.stopAnticipation(); }
  };

  AudioEngine.prototype.setMusic = function (on) {
    this.musicOn = on;
    if (on) this.startMusic(); else this.stopMusic();
  };

  root.ASTER_AUDIO = { AudioEngine: AudioEngine, note: note };
})(typeof window !== "undefined" ? window : globalThis);
