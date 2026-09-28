(() => {
  "use strict";

  const SAVE_KEY = "aster-slot-save-v1";
  const ENERGY_MAX = 18;
  const BETS = [10, 25, 50, 100];
  const BUYINS = [1000, 3000, 10000];

  const SYMBOLS = {
    C: { glyph: "☄", name: "彗星", color: "#63eaff", pay: { 3: 0.35, 4: 1.2, 5: 8 } },
    P: { glyph: "◈", name: "行星", color: "#b58cff", pay: { 3: 0.5, 4: 1.8, 5: 12 } },
    M: { glyph: "☽", name: "月环", color: "#ff83df", pay: { 3: 0.75, 4: 2.5, 5: 18 } },
    N: { glyph: "✹", name: "星云", color: "#69f1b7", pay: { 3: 1, 4: 4, 5: 30 } },
    T: { glyph: "✦", name: "星辰", color: "#ffd36c", pay: { 3: 2, 4: 8, 5: 50 } },
    A: { glyph: "♛", name: "王冠", color: "#fff1a6", pay: { 3: 3, 4: 12, 5: 80 } },
    W: { glyph: "W", name: "Wild", color: "#ffffff" },
    S: { glyph: "✪", name: "Scatter", color: "#ffbf66" },
    E: { glyph: "◎", name: "星核", color: "#ffd36c" }
  };
  const NORMALS = ["C", "P", "M", "N", "T", "A"];
  const WEIGHTED = ["C","C","C","C","P","P","P","M","M","N","N","T","T","A","W","S","E","E","E","E"];
  const ACHIEVEMENTS = [
    { id: "first", icon: "✦", title: "初次跃迁", desc: "完成第一次旋转" },
    { id: "win", icon: "✧", title: "小型爆发", desc: "单次赢得 500 金币" },
    { id: "ten", icon: "✹", title: "星际常客", desc: "累计旋转 10 次" },
    { id: "nova", icon: "◎", title: "超新星", desc: "触发一次超新星模式" },
    { id: "big", icon: "♛", title: "宇宙级好运", desc: "单次赢得 5,000 金币" }
  ];

  const $ = (id) => document.getElementById(id);
  const els = {
    wallet: $("wallet"), session: $("session-balance"), sessionLabel: $("session-label"),
    bet: $("bet"), betSelect: $("bet-select"), streak: $("streak"), bestStreak: $("best-streak"),
    mode: $("mode-label"), spinCounter: $("spin-counter"), energyLabel: $("energy-label"),
    energyFill: $("energy-fill"), result: $("result-line"), stage: $("pixi-stage"),
    stageWrap: $("stage-wrap"), fx: $("fx-layer"), banner: $("win-banner"),
    bonusStatus: $("bonus-status"), bonusCopy: $("bonus-copy"), bonusFill: $("bonus-progress-fill"),
    freeSpins: $("free-spins"), bonusMultiplier: $("bonus-multiplier"),
    log: $("event-log"), achievementList: $("achievement-list"), achievementCount: $("achievement-count"),
    spin: $("spin-btn"), collect: $("collect-btn"), auto: $("auto-btn"), autoSelect: $("auto-select"),
    autoLabel: $("auto-label"), betDown: $("bet-down"), betUp: $("bet-up"), turbo: $("turbo-btn"),
    sound: $("sound-btn"), music: $("music-btn"), settings: $("settings-btn"),
    buyinModal: $("buyin-modal"), buyinOptions: $("buyin-options"), buyinWallet: $("buyin-wallet"),
    modalReset: $("modal-reset"), resetSave: $("reset-save"), paytable: $("paytable-btn"),
    paytableModal: $("paytable-modal"), paytableList: $("paytable-list"), settingsModal: $("settings-modal"),
    reduced: $("reduced-motion"), details: $("show-details"), toast: $("toast"), clearLog: $("clear-log")
  };

  const defaults = {
    wallet: 25000, sessionBalance: 0, bet: 10, energy: 0, freeSpins: 0, multiplier: 1,
    spinCount: 0, streak: 0, bestStreak: 0, totalWins: 0, totalBurst: 0,
    autoRemaining: 0, turbo: false, inBonus: false, soundOn: true, musicOn: true,
    reducedMotion: false, showDetails: true, achievements: {}
  };
  let state = loadState();
  let phase = "idle";
  let devSeed = Number(window.__ASTER_SEED || 0) >>> 0;
  let currentMatrix = makeMatrix();
  let renderer = null;
  let rendererReady = false;
  let timers = [];
  let toastTimer = null;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
      return Object.assign({}, defaults, saved || {}, { sessionBalance: 0, freeSpins: 0, inBonus: false, multiplier: 1, autoRemaining: 0 });
    } catch (err) {
      return Object.assign({}, defaults);
    }
  }
  function saveState() {
    const data = {
      wallet: Math.max(0, Math.floor(state.wallet)), bestStreak: state.bestStreak, totalWins: state.totalWins,
      totalBurst: state.totalBurst, spinCount: state.spinCount, achievements: state.achievements,
      bet: state.bet, soundOn: state.soundOn, musicOn: state.musicOn, reducedMotion: state.reducedMotion, showDetails: state.showDetails
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (err) { /* private browsing can disable storage; the game remains playable */ }
  }
  function fmt(value) { return new Intl.NumberFormat("zh-CN").format(Math.max(0, Math.floor(value || 0))); }
  function randomUnit() {
    if (devSeed) { devSeed = (devSeed * 1664525 + 1013904223) >>> 0; return devSeed / 4294967296; }
    if (window.crypto && window.crypto.getRandomValues) {
      const value = new Uint32Array(1); window.crypto.getRandomValues(value); return value[0] / 4294967296;
    }
    return Math.random();
  }
  function pick(list) { return list[Math.floor(randomUnit() * list.length)]; }
  function makeMatrix() {
    return Array.from({ length: 5 }, () => Array.from({ length: 3 }, () => pick(WEIGHTED)));
  }
  function countSymbol(matrix, symbol) {
    return matrix.reduce((sum, reel) => sum + reel.filter((cell) => cell === symbol).length, 0);
  }

  class AudioEngine {
    constructor() { this.ctx = null; this.master = 0.15; this.ambient = null; }
    unlock() {
      if (!this.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        try { this.ctx = new Ctx(); } catch (e) { return; }
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
      if (state.musicOn && !this.ambient) this.startAmbient();
    }
    startAmbient() {
      if (!this.ctx || this.ambient) return;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.018;
      gain.connect(this.ctx.destination);
      const osc = this.ctx.createOscillator();
      osc.type = "sine"; osc.frequency.value = 55; osc.connect(gain); osc.start();
      this.ambient = { osc, gain };
    }
    stopAmbient() { if (this.ambient) { try { this.ambient.osc.stop(); } catch (e) {} this.ambient = null; } }
    tone(freq, duration, type = "sine", volume = 0.08, slide = 0) {
      if (!this.ctx || !state.soundOn) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
      osc.type = type; osc.frequency.setValueAtTime(freq, now);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), now + duration);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume * this.master, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain); gain.connect(this.ctx.destination); osc.start(now); osc.stop(now + duration + 0.03);
    }
    noise(duration = 0.08, volume = 0.04) {
      if (!this.ctx || !state.soundOn) return;
      const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * duration, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const src = this.ctx.createBufferSource(), filter = this.ctx.createBiquadFilter(), gain = this.ctx.createGain();
      filter.type = "bandpass"; filter.frequency.value = 1500;
      gain.gain.value = volume * this.master;
      src.buffer = buffer; src.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination); src.start();
    }
    spin() { this.noise(0.16, 0.07); this.tone(105, 0.18, "sawtooth", 0.045, 95); }
    stop(index) { this.tone(165 + index * 22, 0.12, "square", 0.05, 35); }
    win(level = 1) { [440, 554, 659].slice(0, level + 1).forEach((f, i) => setTimeout(() => this.tone(f, 0.24, "triangle", 0.08, 80), i * 70)); }
    charge() { this.tone(320, 0.16, "triangle", 0.07, 360); setTimeout(() => this.tone(690, 0.24, "triangle", 0.08, 400), 80); }
    bonus() { [110, 165, 220, 330, 495, 660].forEach((f, i) => setTimeout(() => this.tone(f, 0.28, "sawtooth", 0.09, f), i * 90)); this.noise(0.45, 0.12); }
    jackpot() { [330, 440, 554, 659, 880, 1100].forEach((f, i) => setTimeout(() => this.tone(f, 0.32, "triangle", 0.12, 120), i * 95)); }
  }
  const audio = new AudioEngine();

  class PixiRenderer {
    constructor(host) { this.host = host; this.app = null; this.board = null; this.reels = []; this.stars = []; this.fallback = false; }
    async init() {
      if (!window.PIXI) { this.initFallback(); return; }
      try {
        this.app = new PIXI.Application({ resizeTo: this.host, backgroundAlpha: 0, antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true });
        this.host.appendChild(this.app.view);
        this.board = new PIXI.Container();
        this.app.stage.addChild(this.board);
        for (let i = 0; i < 42; i++) {
          const star = new PIXI.Graphics().beginFill(i % 4 === 0 ? 0xffd36c : 0x80bfff, 0.28 + Math.random() * 0.5).drawCircle(0, 0, 0.5 + Math.random() * 1.8).endFill();
          star.x = Math.random() * this.host.clientWidth; star.y = Math.random() * this.host.clientHeight;
          star.v = 0.08 + Math.random() * 0.25; this.app.stage.addChild(star); this.stars.push(star);
        }
        this.rebuild();
        this.app.ticker.add(() => { if (!state.reducedMotion) this.stars.forEach((s) => { s.y += s.v; if (s.y > this.host.clientHeight + 4) s.y = -4; }); });
        window.addEventListener("resize", () => this.rebuild());
      } catch (err) { this.initFallback(); }
    }
    initFallback() {
      this.fallback = true;
      this.host.innerHTML = "";
      const grid = document.createElement("div"); grid.className = "dom-grid"; this.host.appendChild(grid);
      for (let c = 0; c < 5; c++) {
        const reel = document.createElement("div"); reel.className = "dom-reel";
        for (let r = 0; r < 3; r++) { const cell = document.createElement("div"); cell.className = "dom-cell"; reel.appendChild(cell); }
        grid.appendChild(reel);
      }
      rendererReady = true; this.render(currentMatrix, []);
    }
    rebuild() {
      if (!this.app) return;
      const w = this.host.clientWidth, h = this.host.clientHeight;
      this.app.renderer.resize(w, h);
      this.board.removeChildren();
      this.reels = [];
      const cellH = Math.min(92, Math.max(48, (h - 36) / 3));
      const gap = Math.max(5, Math.min(10, w / 80));
      const cellW = (w - 28 - gap * 4) / 5;
      const top = (h - cellH * 3 - gap * 2) / 2;
      for (let c = 0; c < 5; c++) {
        const col = [];
        for (let r = 0; r < 3; r++) {
          const text = new PIXI.Text("", new PIXI.TextStyle({ fontFamily: "Arial, Segoe UI Symbol, sans-serif", fontSize: Math.min(52, cellH * 0.6), fontWeight: "700", fill: "#ffffff", align: "center", dropShadow: true, dropShadowAlpha: 0.7, dropShadowBlur: 8, dropShadowDistance: 0 }));
          text.anchor.set(0.5); text.x = 14 + cellW * c + gap * c + cellW / 2; text.y = top + cellH * r + gap * r + cellH / 2;
          const x = 14 + cellW * c + gap * c, y = top + cellH * r + gap * r;
          const bg = new PIXI.Graphics().lineStyle(1, 0x3b4d88, 1).beginFill(0x18234a, 0.9).drawRoundedRect(x, y, cellW, cellH, 10).endFill();
          this.board.addChild(bg); this.board.addChild(text); col.push({ text, bg, x, y, cellW, cellH });
        }
        this.reels.push(col);
      }
      rendererReady = true; this.render(currentMatrix, []);
    }
    render(matrix, hits = [], spinning = false) {
      currentMatrix = matrix;
      if (this.fallback) {
        const cells = this.host.querySelectorAll(".dom-cell");
        matrix.forEach((reel, c) => reel.forEach((key, r) => { const cell = cells[c * 3 + r]; if (!cell) return; cell.textContent = SYMBOLS[key].glyph; cell.style.color = SYMBOLS[key].color; cell.classList.toggle("hit", hits.some((h) => h.c === c && h.r === r)); cell.style.opacity = spinning ? "0.7" : "1"; }));
        return;
      }
      this.reels.forEach((col, c) => col.forEach((item, r) => {
        const key = matrix[c][r], info = SYMBOLS[key], isHit = hits.some((h) => h.c === c && h.r === r);
        item.text.text = info.glyph; item.text.style.fill = info.color; item.text.alpha = spinning ? 0.64 : 1; item.text.scale.set(isHit ? 1.14 : 1);
        item.bg.clear().lineStyle(isHit ? 2 : 1, isHit ? 0xffd36c : 0x3b4d88, 1).beginFill(isHit ? 0x3d3152 : 0x18234a, 0.95).drawRoundedRect(item.x, item.y, item.cellW, item.cellH, 10).endFill();
      }));
    }
  }

  async function init() {
    renderer = new PixiRenderer(els.stage);
    await renderer.init();
    bindEvents();
    renderPaytable();
    renderAchievements();
    updateUI();
    showBuyin();
    currentMatrix = makeMatrix(); renderer.render(currentMatrix, []);
  }

  function bindEvents() {
    els.betSelect.value = String(state.bet);
    els.betSelect.addEventListener("change", () => { state.bet = Number(els.betSelect.value); updateUI(); saveState(); });
    els.betDown.addEventListener("click", () => cycleBet(-1));
    els.betUp.addEventListener("click", () => cycleBet(1));
    els.turbo.addEventListener("click", () => { state.turbo = !state.turbo; updateUI(); });
    els.spin.addEventListener("click", () => spin());
    els.collect.addEventListener("click", collect);
    els.auto.addEventListener("click", toggleAuto);
    els.sound.addEventListener("click", () => { state.soundOn = !state.soundOn; if (state.soundOn) audio.unlock(); updateUI(); saveState(); });
    els.music.addEventListener("click", () => { state.musicOn = !state.musicOn; if (state.musicOn) { audio.unlock(); audio.startAmbient(); } else audio.stopAmbient(); updateUI(); saveState(); });
    els.settings.addEventListener("click", () => openModal(els.settingsModal));
    els.paytable.addEventListener("click", () => openModal(els.paytableModal));
    els.clearLog.addEventListener("click", () => { els.log.innerHTML = '<div class="log-empty">你的下一次爆发会记录在这里</div>'; });
    els.reduced.addEventListener("change", () => { state.reducedMotion = els.reduced.checked; document.body.classList.toggle("reduced-motion", state.reducedMotion); saveState(); });
    els.details.addEventListener("change", () => { state.showDetails = els.details.checked; saveState(); });
    els.resetSave.addEventListener("click", resetSave);
    els.modalReset.addEventListener("click", () => { state.wallet += 10000; saveState(); updateUI(); toast("已获得 10,000 虚拟金币"); });
    els.buyinOptions.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => buyIn(Number(button.dataset.buyin))));
    document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => closeModal($(button.dataset.close))));
    document.querySelectorAll(".modal-backdrop").forEach((backdrop) => backdrop.addEventListener("click", (event) => { if (event.target === backdrop && backdrop.id !== "buyin-modal") closeModal(backdrop); }));
    document.addEventListener("keydown", (event) => { if (event.code === "Space" && !event.repeat && !isModalOpen()) { event.preventDefault(); spin(); } if (event.code === "Escape") document.querySelectorAll(".modal-backdrop.visible").forEach((m) => { if (m.id !== "buyin-modal") closeModal(m); }); });
  }

  function isModalOpen() { return !!document.querySelector(".modal-backdrop.visible:not(#buyin-modal)"); }
  function openModal(modal) { modal.classList.add("visible"); }
  function closeModal(modal) { if (modal) modal.classList.remove("visible"); }
  function cycleBet(direction) { const index = BETS.indexOf(state.bet); state.bet = BETS[(index + direction + BETS.length) % BETS.length]; els.betSelect.value = String(state.bet); updateUI(); saveState(); }
  function buyIn(amount) {
    if (state.wallet < amount) { toast("局外金币不足，先领取虚拟补给"); return; }
    state.wallet -= amount; state.sessionBalance = amount; state.energy = 0; state.streak = 0; state.freeSpins = 0; state.multiplier = 1; state.inBonus = false; state.autoRemaining = 0; phase = "idle";
    closeModal(els.buyinModal); logEvent("买入 " + fmt(amount) + "，星云航程开始"); updateUI(); saveState(); audio.unlock(); audio.tone(240, .2, "triangle", .06, 180);
  }
  function collect() {
    if (phase !== "idle") { toast("等这次旋转完成再收手"); return; }
    if (state.freeSpins > 0) { toast("超新星模式结束后才能收手"); return; }
    if (state.sessionBalance <= 0) { showBuyin(); return; }
    const amount = state.sessionBalance; state.wallet += amount; state.sessionBalance = 0; state.energy = 0; state.streak = 0; state.autoRemaining = 0;
    saveState(); updateUI(); logEvent("收手，回收 " + fmt(amount) + " 虚拟金币"); toast("已回收到局外金币"); showBuyin();
  }
  function toggleAuto() {
    if (phase !== "idle") return;
    if (!state.sessionBalance) { showBuyin(); return; }
    if (state.autoRemaining > 0) { state.autoRemaining = 0; toast("自动旋转已暂停"); updateUI(); return; }
    state.autoRemaining = Number(els.autoSelect.value); updateUI(); toast("自动旋转 " + state.autoRemaining + " 次"); spin();
  }

  async function spin() {
    if (phase !== "idle") return;
    if (!state.sessionBalance) { showBuyin(); return; }
    if (state.freeSpins <= 0 && state.sessionBalance < state.bet) { toast("本局余额不足，请收手或重新买入"); return; }
    audio.unlock(); phase = "spinning"; updateUI(); els.stageWrap.classList.remove("shake");
    if (state.freeSpins > 0) state.freeSpins -= 1; else state.sessionBalance -= state.bet;
    state.spinCount += 1; saveState(); audio.spin(); updateUI();
    const result = makeMatrix();
    await animateSpin(result);
    const outcome = settle(result);
    phase = "idle"; updateUI(); renderer.render(result, outcome.hits);
    await presentOutcome(outcome);
    if (state.autoRemaining > 0) {
      state.autoRemaining -= 1;
      if (state.inBonus) state.autoRemaining = 0;
      updateUI();
    }
    saveState();
    if (state.inBonus && state.freeSpins > 0) {
      timers.push(setTimeout(() => spin(), state.turbo ? 420 : 1050));
    } else if (state.inBonus && state.freeSpins === 0) {
      finishBonus();
    } else if (state.autoRemaining > 0 && state.sessionBalance >= state.bet) {
      timers.push(setTimeout(() => spin(), state.turbo ? 300 : 720));
    } else if (state.autoRemaining > 0) {
      state.autoRemaining = 0; updateUI(); toast("余额不足，自动旋转已暂停");
    }
  }

  function animateSpin(result) {
    const duration = state.turbo ? 520 : 1120;
    return new Promise((resolve) => {
      let stopped = 0;
      const temp = makeMatrix();
      for (let c = 0; c < 5; c++) {
        const interval = setInterval(() => { for (let r = 0; r < 3; r++) temp[c][r] = pick(WEIGHTED); renderer.render(temp, [], true); }, state.turbo ? 42 : 65);
        const stopTimer = setTimeout(() => {
          clearInterval(interval); for (let r = 0; r < 3; r++) temp[c][r] = result[c][r]; renderer.render(temp, [], c < 4); audio.stop(c);
          stopped += 1; if (stopped === 5) { renderer.render(result, []); resolve(); }
        }, duration * 0.37 + c * (duration * 0.115));
        timers.push(stopTimer);
      }
    });
  }

  function settle(matrix) {
    const wins = [];
    let payout = 0;
    NORMALS.forEach((symbol) => {
      let ways = 1, reels = 0;
      for (let c = 0; c < 5; c++) {
        const count = matrix[c].filter((cell) => cell === symbol || cell === "W").length;
        if (!count) break;
        reels += 1; ways *= count;
      }
      if (reels >= 3) {
        const baseMult = SYMBOLS[symbol].pay[reels];
        const amount = Math.max(0, Math.floor(state.bet * baseMult * ways * state.multiplier));
        payout += amount;
        const positions = [];
        for (let c = 0; c < reels; c++) for (let r = 0; r < 3; r++) if (matrix[c][r] === symbol || matrix[c][r] === "W") positions.push({ c, r });
        wins.push({ symbol, reels, ways, amount, positions });
      }
    });
    const scatterCount = countSymbol(matrix, "S");
    const energyCount = countSymbol(matrix, "E");
    let energyGain = 1 + energyCount;
    let triggeredNova = false, triggeredScatter = false;
    state.energy = Math.min(ENERGY_MAX, state.energy + energyGain);
    if (scatterCount >= 3) { state.freeSpins += 5; state.inBonus = true; state.multiplier = Math.max(state.multiplier, 1.5); triggeredScatter = true; logEvent("星门共振：获得 5 次免费旋转"); }
    if (state.energy >= ENERGY_MAX) {
      state.energy = 0; state.freeSpins += 8; state.inBonus = true; state.multiplier = 2; state.totalBurst += 1; triggeredNova = true;
      unlock("nova"); logEvent("超新星爆发：获得 8 次免费旋转 · 2×"); audio.bonus();
    }
    const hits = wins.flatMap((win) => win.positions);
    if (payout > 0) {
      state.sessionBalance += payout; state.totalWins += payout; state.streak += 1; state.bestStreak = Math.max(state.bestStreak, state.streak);
      unlock("win"); if (payout >= 5000) unlock("big");
      logEvent((state.multiplier > 1 ? "超新星 " : "") + "赢得 " + fmt(payout) + " · " + wins.map((w) => SYMBOLS[w.symbol].name + " " + w.reels + "轴").join("、"));
    } else { state.streak = 0; if (!triggeredNova && !triggeredScatter) logEvent("本次没有命中，星核 +" + energyGain); }
    if (state.spinCount >= 1) unlock("first"); if (state.spinCount >= 10) unlock("ten");
    return { payout, wins, hits, energyGain, scatterCount, triggeredNova, triggeredScatter };
  }

  async function presentOutcome(outcome) {
    if (outcome.payout > 0) els.result.textContent = "赢得 " + fmt(outcome.payout) + " 虚拟金币" + (outcome.wins.length ? " · " + outcome.wins.map((w) => SYMBOLS[w.symbol].name + " " + w.reels + "轴").join("、") : "");
    else if (outcome.triggeredNova) els.result.textContent = "星核满格：超新星模式已开启 · 8 次免费旋转";
    else if (outcome.triggeredScatter) els.result.textContent = "星门共振：获得 5 次免费旋转";
    else els.result.textContent = "没有命中，但星核能量继续累积 +" + outcome.energyGain;
    if (outcome.energyGain > 1) audio.charge();
    if (outcome.payout > 0) { audio.win(outcome.payout >= 5000 ? 2 : outcome.payout >= 500 ? 1 : 0); burst(outcome.payout >= 5000 ? "jackpot" : "win"); showBanner(outcome.payout, outcome.wins); if (outcome.payout >= 5000) { els.stageWrap.classList.add("shake"); setTimeout(() => els.stageWrap.classList.remove("shake"), 500); } }
    if (outcome.triggeredNova) { bodyBonus(true); burst("nova"); showBanner("超新星", "8 次免费旋转 · 2×爆发"); }
    else if (outcome.triggeredScatter) { bodyBonus(true); burst("scatter"); showBanner("星门共振", "5 次免费旋转"); }
    else if (state.inBonus) bodyBonus(true);
    await new Promise((resolve) => setTimeout(resolve, state.turbo ? 210 : outcome.payout > 0 ? 820 : 300));
  }
  function finishBonus() {
    state.inBonus = false; state.multiplier = 1; bodyBonus(false); audio.jackpot(); burst("nova"); showBanner("超新星完成", "能量重新归零，带走你的战果"); logEvent("超新星模式结束，余额 " + fmt(state.sessionBalance)); updateUI(); saveState();
  }
  function bodyBonus(enabled) { document.body.classList.toggle("bonus-mode", enabled); }

  function showBanner(title, subtitle) {
    els.banner.innerHTML = '<span class="big">' + (typeof title === "number" ? "+" + fmt(title) : title) + '</span><span class="sub">' + (Array.isArray(subtitle) ? subtitle.map((x) => SYMBOLS[x.symbol].glyph + " " + x.reels + "轴").join("　") : subtitle) + "</span>";
    els.banner.classList.remove("show"); void els.banner.offsetWidth; els.banner.classList.add("show");
  }
  function burst(kind) {
    const colors = kind === "nova" ? ["#ffd36c","#ff69d4","#63eaff","#fff"] : kind === "scatter" ? ["#ffbf66","#b58cff","#fff"] : ["#ffd36c","#63eaff","#ff69d4"];
    const amount = state.reducedMotion ? 12 : kind === "nova" ? 80 : 38;
    for (let i = 0; i < amount; i++) {
      const p = document.createElement("span"); p.className = "particle"; p.style.setProperty("--color", pick(colors)); p.style.setProperty("--size", (2 + Math.random() * (kind === "nova" ? 8 : 5)) + "px"); p.style.setProperty("--x", ((Math.random() - .5) * 100) + "vw"); p.style.setProperty("--y", ((Math.random() - .5) * 65) + "vh"); p.style.setProperty("--dur", (650 + Math.random() * 700) + "ms"); els.fx.appendChild(p); setTimeout(() => p.remove(), 1500);
    }
    if (kind === "nova") { const ring = document.createElement("span"); ring.className = "ring-burst"; ring.style.borderColor = "#ffd36c"; els.fx.appendChild(ring); setTimeout(() => ring.remove(), 1000); }
  }
  function logEvent(text) {
    if (!els.log) return;
    const empty = els.log.querySelector(".log-empty"); if (empty) empty.remove();
    const item = document.createElement("div"); item.className = "log-item"; item.innerHTML = "<strong>" + new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) + "</strong>　" + text; els.log.prepend(item);
    while (els.log.children.length > 8) els.log.lastElementChild.remove();
  }
  function toast(text) { els.toast.textContent = text; els.toast.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200); }
  function unlock(id) { if (!state.achievements[id]) { state.achievements[id] = true; renderAchievements(); const item = ACHIEVEMENTS.find((a) => a.id === id); if (item) toast("成就解锁：" + item.title); } }
  function renderAchievements() {
    const done = ACHIEVEMENTS.filter((a) => state.achievements[a.id]).length; els.achievementCount.textContent = done + " / " + ACHIEVEMENTS.length;
    els.achievementList.innerHTML = ACHIEVEMENTS.map((a) => '<div class="achievement ' + (state.achievements[a.id] ? "done" : "") + '"><span class="achievement-icon">' + (state.achievements[a.id] ? a.icon : "·") + '</span><span><b>' + a.title + "</b> · " + a.desc + "</span></div>").join("");
  }
  function renderPaytable() {
    els.paytableList.innerHTML = NORMALS.map((key) => { const s = SYMBOLS[key]; return '<div class="pay-row"><span class="pay-symbol" style="color:' + s.color + '">' + s.glyph + '</span><span class="pay-name">' + s.name + "<small>3 / 4 / 5 轴</small></span><span class=\"pay-values\">" + s.pay[3] + "×　" + s.pay[4] + "×　" + s.pay[5] + "×</span></div>"; }).join("") + '<div class="pay-row"><span class="pay-symbol" style="color:#fff">W</span><span class="pay-name">Wild<small>替代普通图标</small></span><span class="pay-values">扩展 Ways</span></div>';
  }
  function updateUI() {
    els.wallet.textContent = fmt(state.wallet); els.buyinWallet.textContent = fmt(state.wallet);
    els.session.textContent = state.sessionBalance ? fmt(state.sessionBalance) : "—"; els.sessionLabel.textContent = state.inBonus ? "超新星进行中" : state.sessionBalance ? "本局航程" : "尚未买入";
    els.bet.textContent = fmt(state.bet); els.betSelect.value = String(state.bet); els.streak.textContent = state.streak; els.bestStreak.textContent = state.bestStreak; els.spinCounter.textContent = "旋转 " + state.spinCount;
    els.energyLabel.textContent = state.energy + " / " + ENERGY_MAX; els.energyFill.style.width = (state.energy / ENERGY_MAX * 100) + "%"; els.bonusFill.style.width = (state.energy / ENERGY_MAX * 100) + "%";
    els.freeSpins.textContent = state.freeSpins; els.bonusMultiplier.textContent = state.multiplier + "×"; els.bonusStatus.textContent = state.inBonus ? "爆发中" : state.energy >= ENERGY_MAX - 3 ? "即将充能" : "未充能"; els.bonusStatus.classList.toggle("charged", state.inBonus || state.energy >= ENERGY_MAX - 3);
    els.bonusCopy.textContent = state.inBonus ? "星云正在燃烧，免费旋转会自动继续。" : "每次旋转都会为星核充能。满格后，免费旋转与大奖爆发将自动开启。";
    els.mode.textContent = state.inBonus ? "超新星模式 · " + state.freeSpins + " 次免费旋转" : phase === "spinning" ? "轴正在跃迁…" : state.sessionBalance ? "星云航程进行中" : "准备探索星云";
    els.autoLabel.textContent = state.autoRemaining ? state.autoRemaining + " 次剩余" : "选择次数"; els.auto.classList.toggle("running", state.autoRemaining > 0); els.turbo.classList.toggle("on", state.turbo); els.turbo.querySelector("span").textContent = state.turbo ? "ON" : "OFF";
    els.sound.textContent = state.soundOn ? "♫" : "♩"; els.music.textContent = state.musicOn ? "◒" : "○"; els.collect.disabled = !state.sessionBalance || phase === "spinning"; els.spin.disabled = phase === "spinning"; els.betDown.disabled = phase === "spinning"; els.betUp.disabled = phase === "spinning";
    els.reduced.checked = state.reducedMotion; els.details.checked = state.showDetails; document.body.classList.toggle("reduced-motion", state.reducedMotion);
    if (phase === "spinning") els.result.textContent = "轴正在跃迁，准备接收星光…";
    document.querySelectorAll("#buyin-options button").forEach((button) => { button.disabled = state.wallet < Number(button.dataset.buyin); button.style.opacity = state.wallet < Number(button.dataset.buyin) ? ".45" : "1"; });
  }
  function showBuyin() { updateUI(); els.buyinModal.classList.add("visible"); }
  function resetSave() {
    if (!window.confirm("要重置所有虚拟金币、成就和本地设置吗？")) return;
    localStorage.removeItem(SAVE_KEY); location.reload();
  }

  function boot() {
    const deadline = Date.now() + 1200;
    const attempt = () => {
      if (window.PIXI || Date.now() >= deadline) init();
      else setTimeout(attempt, 40);
    };
    attempt();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();

