/* ------------------------------------------------------------------
 * 金龙聚宝 · 游戏主程序
 * 负责把引擎算出来的结果"演"出来：停轮节奏、擦边球、神龙展开、钱币入账、
 * 分级大奖、手动免费游戏、手动聚宝盆，以及所有按钮的即时反馈。
 * ------------------------------------------------------------------ */
(function () {
  "use strict";

  var CONFIG = window.ASTER_CONFIG;
  var ENGINE = window.ASTER_ENGINE;
  /* 当前模式的那份数值。切模式时整体换掉，所以这里用 var 不用 const。 */
  var MODEID = CONFIG.DEFAULT_MODE;
  var MODE = CONFIG.mode(MODEID);
  var F = MODE.FEATURES;
  var SAVE_KEY = "jinlong-slot-v2";

  var ACHIEVEMENTS = [
    { id: "first", icon: "初", title: "初鸣", desc: "完成第一次旋转" },
    { id: "dragon", icon: "龙", title: "龙抬头", desc: "让神龙整轴展开一次" },
    { id: "free", icon: "门", title: "龙门大开", desc: "触发一次免费游戏" },
    { id: "hold", icon: "盆", title: "聚宝成盆", desc: "触发一次聚宝盆" },
    { id: "twin", icon: "双", title: "双龙戏珠", desc: "两条神龙同时现身" },
    { id: "triple", icon: "三", title: "三龙聚顶", desc: "三条神龙同时现身" },
    { id: "grand", icon: "满", title: "大满贯", desc: "聚宝盆填满十五格" },
    { id: "hundred", icon: "百", title: "一本万利", desc: "单次旋转赢得 100 倍下注" },
    { id: "record", icon: "榜", title: "榜上有名", desc: "拿下本地排行榜第一" },
    { id: "vip", icon: "贵", title: "贵宾入室", desc: "晋升到银卡贵宾" }
  ];

  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  [
    "wallet", "session", "bet-value", "mode-label", "spin-count",
    "charge-track", "charge-fill", "charge-state",
    "reel-canvas", "stage", "result-line", "fx-canvas",
    "banner", "banner-title", "banner-amount", "banner-sub",
    "feature-card", "feature-title", "feature-sub", "feature-meta",
    "hold-hud", "hold-respins", "hold-total",
    "free-hud", "free-remaining", "free-multiplier", "free-total",
    "spin-btn", "spin-label", "spin-hint", "bet-down", "bet-up", "auto-btn", "auto-label",
    "auto-select", "turbo-btn", "turbo-state", "collect-btn", "buy-btn", "buy-price",
    "sound-btn", "music-btn", "settings-btn", "paytable-btn", "daily-btn", "daily-dot",
    "level-chip", "level-value", "level-fill", "level-xp",
    "jackpot-bar", "jackpot-value", "mission-list",
    "streak-row", "streak-value", "streak-best",
    "daily-modal", "daily-grid", "daily-claim", "daily-note",
    "buyin-modal", "buyin-wallet", "topup-btn", "buyin-go", "buyin-mode", "buyin-note",
    "mode-switch", "mode-name", "mode-tag", "board-list", "board-panel",
    "buyin-title", "vip-modal", "vip-card", "vip-name", "vip-perk", "vip-level", "vip-turnover",
    "vip-next", "vip-rebate", "vip-fill", "vip-rebate-note", "vip-ladder", "vip-chip-name",
    "party-bar", "snow-meter", "snow-steps", "snow-now", "rampage-chip", "rampage-left",
    "build-stamp", "force-update", "hall-picker",
    "paytable-modal", "paytable-body", "settings-modal",
    "opt-motion", "opt-quickwin", "reset-save",
    "log-list", "achievement-list", "achievement-count", "toast"
  ].forEach(function (id) { el[id.replace(/-(\w)/g, function (m, p) { return p.toUpperCase(); })] = $(id); });

  var META = CONFIG.META;

  /* 两个模式各自一份钱包与进度；等级、任务、签到、成就是账号级的，共享。 */
  function freshModeState(modeId) {
    var eco = CONFIG.mode(modeId).ECONOMY;
    return {
      wallet: eco.startingWallet,
      bet: eco.defaultBet,
      charge: 0,
      spinCount: 0,
      bestWin: 0,
      jackpotPot: null,
      jackpotReserve: 0
    };
  }

  var defaults = {
    mode: CONFIG.DEFAULT_MODE,
    modes: { normal: freshModeState("normal"), party: freshModeState("party") },
    achievements: {},
    soundOn: true,
    musicOn: true,
    turbo: false,
    reducedMotion: false,
    quickWin: false,
    /* 局外成长（共享） */
    level: 1,
    xp: 0,
    totalWager: 0,        // 累计流水，用来算洗码返水
    rebateBase: 0,        // 上次结算返水时的流水
    missions: null,
    missionsDone: 0,
    lastDaily: "",
    dailyStreak: 0,
    bestStreak: 0,
    leaderboard: []       // 只记正常模式
  };

  var state = load();
  var MS = null;                 // 当前模式的进度（钱包/下注/龙气/彩金池）
  var session = 0;
  var phase = "idle";            // idle | spinning | presenting | hold
  var autoRemaining = 0;
  var skipRequested = false;
  var toastTimer = null;
  var displayedSession = 0;
  var pressResolver = null;      // 等待玩家按「旋转」时挂在这里
  var awaitingPress = false;
  var streak = 0;                // 连胜
  var displayedJackpot = 0;
  var buyArmed = 0;              // 买龙门的二次确认时间戳

  var audio = new window.ASTER_AUDIO.AudioEngine();
  var engine = new ENGINE.SlotEngine();
  var renderer = null;
  var fx = null;

  /* ---------------- 存档 ---------------- */
  function load() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); } catch (err) { raw = null; }
    var out = Object.assign({}, defaults, raw || {});
    out.modes = Object.assign({}, defaults.modes, out.modes || {});
    ["normal", "party"].forEach(function (id) {
      out.modes[id] = Object.assign(freshModeState(id), out.modes[id] || {});
    });
    if (!Array.isArray(out.leaderboard)) out.leaderboard = [];
    return out;
  }
  function save() {
    try {
      MS.wallet = Math.max(0, Math.round(MS.wallet));
      MS.charge = engine.charge;
      MS.jackpotPot = engine.jackpot;
      MS.jackpotReserve = engine.jackpotReserve;
      state.mode = MODEID;
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    } catch (err) { /* 隐私模式下写不进去，不影响游戏 */ }
  }

  /* ---------------- 小工具 ---------------- */
  var nf = new Intl.NumberFormat("zh-CN");
  function fmt(v) { return nf.format(Math.max(0, Math.round(v || 0))); }
  function money(v) { return "$" + fmt(v); }
  /* 彩金带两位小数：每次旋转只投进下注的 2%，不显示到分就看不出它在涨，
   * 而"一直在涨"正是这条的全部意义。真实累积奖池也是这么显示的。 */
  function moneyPrecise(v) {
    var n = Math.max(0, v || 0);
    return "$" + nf.format(Math.floor(n)) + "." + String(Math.floor((n % 1) * 100)).padStart(2, "0");
  }

  function wait(ms) {
    if (state.reducedMotion) ms = Math.min(ms, 120);
    if (state.turbo) ms *= 0.5;
    return new Promise(function (resolve) {
      var done = false;
      var poll;
      var finish = function () { if (!done) { done = true; clearTimeout(timer); clearInterval(poll); resolve(); } };
      var timer = setTimeout(finish, ms);
      poll = setInterval(function () { if (skipRequested) finish(); }, 32);
    });
  }

  /* 让「旋转」键进入"等玩家按"的状态。
   * waitForPress 会额外挂一个 resolver 把协程停在原地；
   * 免费游戏只需要按钮态，不需要阻塞协程（否则每按一次就多套一层 await）。 */
  function armSpinButton(label, hint) {
    awaitingPress = true;
    el.spinLabel.textContent = label;
    el.spinHint.textContent = hint || "SPACE";
    el.spinBtn.disabled = false;
    el.spinBtn.classList.add("await");
  }

  function disarmSpinButton() {
    awaitingPress = false;
    pressResolver = null;
    el.spinBtn.classList.remove("await");
  }

  /* 等玩家自己按按钮，并把协程停在这里。聚宝盆的每一次重转走这条路。 */
  function waitForPress(label, hint) {
    armSpinButton(label, hint);
    updateUI();
    return new Promise(function (resolve) {
      pressResolver = function () {
        pressResolver = null;
        awaitingPress = false;
        skipRequested = false;      // 玩家重新接管，之前的快进不再生效
        el.spinBtn.classList.remove("await");
        el.spinBtn.disabled = true;
        resolve();
      };
    });
  }

  function toast(text) {
    el.toast.textContent = text;
    el.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove("show"); }, 2200);
  }

  function logEvent(text, kind) {
    var empty = el.logList.querySelector(".log-empty");
    if (empty) empty.remove();
    var row = document.createElement("div");
    row.className = "log-row" + (kind ? " log-" + kind : "");
    var time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    row.innerHTML = '<span class="log-time">' + time + "</span><span>" + text + "</span>";
    el.logList.prepend(row);
    while (el.logList.children.length > 14) el.logList.lastElementChild.remove();
  }

  function unlock(id) {
    if (state.achievements[id]) return;
    state.achievements[id] = true;
    renderAchievements();
    var item = ACHIEVEMENTS.filter(function (a) { return a.id === id; })[0];
    if (item) {
      toast("成就达成 · " + item.title);
      fx.burst(40, { y: window.innerHeight - 90, x: 90, speed: 340, size: 8 });
    }
    save();
  }

  /* 切换模式：换数值、换钱包、换彩金池，本局清空。 */
  function applyMode(id, opts) {
    opts = opts || {};
    MODEID = CONFIG.MODES[id] ? id : CONFIG.DEFAULT_MODE;
    MODE = CONFIG.mode(MODEID);
    F = MODE.FEATURES;
    MS = state.modes[MODEID];
    state.mode = MODEID;

    engine.setMode(MODEID);
    engine.charge = Math.min(F.charge.max - 1, MS.charge || 0);
    if (typeof MS.jackpotPot === "number") engine.jackpot = MS.jackpotPot;
    engine.jackpotReserve = MS.jackpotReserve || 0;
    displayedJackpot = engine.jackpot;

    /* 下注档位换了一整套，旧的值可能不在新列表里 */
    if (MODE.ECONOMY.bets.indexOf(MS.bet) < 0) MS.bet = MODE.ECONOMY.defaultBet;

    session = 0;
    displayedSession = 0;
    autoRemaining = 0;
    streak = 0;
    renderer.setStrips(MODE.STRIPS.base);
    renderer.setStops([4, 17, 31, 46, 9]);
    document.body.classList.toggle("party-mode", MODEID === "party");
    buildSnowMeter();
    el.modeName.textContent = MODE.name;
    el.modeTag.textContent = MODE.tagline;
    renderPaytable();
    renderBoard();
    updateStreak(false);
    updateUI();
    if (!opts.silent) save();
  }

  /* 换模式必须先把本局结清：两个模式钱包、彩金池、下注档完全独立，
   * 中途带着筹码跳过去会让排行榜（固定买入才可比）失去意义。 */
  var hallArmed = { id: null, until: 0 };

  function requestMode(id) {
    if (!CONFIG.MODES[id] || id === MODEID) return;
    if (phase !== "idle") { audio.ui("deny"); return; }
    if (engine.mode === "free") { audio.ui("deny"); toast("免费游戏结束后才能换厅"); return; }

    /* 还坐在桌上：先确认一次，然后替玩家收手再换 —— 换厅本身要结清本局，
     * 光弹一句"先收手"会把人卡死在那儿（收手之后弹窗又盖住了顶栏的切换）。 */
    if (session > 0) {
      if (hallArmed.id !== id || hallArmed.until < Date.now()) {
        hallArmed = { id: id, until: Date.now() + 4000 };
        updateUI();
        toast("再按一次：收手并移步" + CONFIG.mode(id).name);
        setTimeout(updateUI, 4100);
        return;
      }
      hallArmed = { id: null, until: 0 };
      endRun("collect", id);
      return;
    }
    switchHall(id);
    openBuyin();
  }

  /* ---- 娱乐模式 HUD：滚雪球 / 金龙狂暴 ---- */
  function buildSnowMeter() {
    var steps = F.snowball ? F.snowball.steps : null;
    el.partyBar.classList.toggle("on", !!steps);
    if (!steps) return;
    el.snowSteps.innerHTML = steps.map(function (m) {
      return '<i data-m="' + m + '"></i>';
    }).join("");
    updatePartyHud();
  }

  function updatePartyHud() {
    if (!F.snowball) return;
    var step = engine.snowballStep;
    var mult = engine.snowballMult();
    el.snowNow.textContent = mult + "×";
    el.snowMeter.classList.toggle("hot", step >= 2);
    var cells = el.snowSteps.children;
    for (var i = 0; i < cells.length; i++) cells[i].className = i <= step ? "on" : "";
    el.rampageChip.classList.toggle("on", engine.rampageLeft > 0);
    el.rampageLeft.textContent = engine.rampageLeft;
  }

  /* ==================================================================
     贵宾厅段位：每 8 级一段，段位决定洗码返水比例。
     等级本身来自流水（下注额），所以这整套就是"押得多、位子好"。
     ================================================================== */
  function vipIndex() {
    return Math.min(META.vip.tiers.length - 1,
      Math.floor((state.level - 1) / META.vip.levelsPerTier));
  }
  function vipTier() { return META.vip.tiers[vipIndex()]; }

  /* 娱乐模式筹码大一个量级，流水按 partyXpRate 折算，否则一局就封顶 */
  function wagerWeight() { return MODEID === "party" ? META.level.partyXpRate : 1; }

  /* 洗码返水：每满 rebateEvery 的流水结算一次，按当前段位比例发到金库。
   * 比例为 0 的段位也要推进基准，否则升段后会把散客时期的流水一起补发。 */
  function settleRebate() {
    var every = META.vip.rebateEvery;
    var pending = state.totalWager - state.rebateBase;
    if (pending < every) return 0;
    var chunks = Math.floor(pending / every);
    state.rebateBase += chunks * every;
    var amount = Math.round(chunks * every * vipTier().rebate);
    if (amount <= 0) return 0;
    MS.wallet += amount;
    audio.coinShower(700, 12);
    fx.burst(48, { y: 90, x: window.innerWidth - 120, speed: 320, size: 8 });
    toast(vipTier().name + " 洗码返水　+" + money(amount));
    logEvent("洗码返水（" + vipTier().name + "）　<b>+" + money(amount) + "</b>", "gold");
    return amount;
  }

  function renderVip() {
    var i = vipIndex();
    var tier = META.vip.tiers[i];
    var next = META.vip.tiers[i + 1];
    var span = META.vip.levelsPerTier;
    el.vipChipName.textContent = tier.name;
    el.levelChip.style.setProperty("--vip", tier.card);
    if (!el.vipModal.classList.contains("show")) return;   // 弹窗没开就不做重活

    el.vipCard.style.setProperty("--vip", tier.card);
    el.vipName.textContent = tier.name;
    el.vipPerk.textContent = tier.perk;
    el.vipLevel.textContent = state.level;
    el.vipTurnover.textContent = money(state.totalWager);
    el.vipRebate.textContent = next || tier.rebate ? "返水 " + (tier.rebate * 100).toFixed(1) + "%" : "无返水";
    if (next) {
      var needLevel = (i + 1) * span + 1;
      var into = state.level - (i * span + 1);
      el.vipNext.textContent = "距 " + next.name + " 还差 " + (needLevel - state.level) + " 级";
      el.vipFill.style.width = Math.min(100, (into / span) * 100).toFixed(1) + "%";
    } else {
      el.vipNext.textContent = "已是封顶段位";
      el.vipFill.style.width = "100%";
    }
    var left = META.vip.rebateEvery - (state.totalWager - state.rebateBase);
    el.vipRebateNote.textContent = tier.rebate
      ? "再流水 " + money(left) + " 结算一次洗码（约 " + money(META.vip.rebateEvery * tier.rebate) + "）"
      : "升到熟客即可开始洗码返水";
    el.vipLadder.innerHTML = META.vip.tiers.map(function (t, idx) {
      var cls = idx === i ? "now" : idx < i ? "past" : "";
      return '<div class="vip-rung ' + cls + '" style="--vip:' + t.card + '">' +
        '<span class="vip-rung-dot"></span>' +
        '<span class="vip-rung-name">' + t.name + "</span>" +
        '<span class="vip-rung-lv">Lv.' + (idx * span + 1) + "+</span>" +
        '<span class="vip-rung-perk">' + t.perk + "</span></div>";
    }).join("");
  }

  /* ==================================================================
     本地排行榜：只记正常模式。固定 $10,000 带入，按「最终带走」排名。
     ================================================================== */
  var run = null;

  function startRun(amount) {
    run = { buyin: amount, peak: amount, spins: 0, best: 0, at: Date.now() };
  }

  function trackRun(outcome) {
    if (!run) return;
    run.spins++;
    if (session > run.peak) run.peak = session;
    if (outcome.totalWin > run.best) run.best = outcome.totalWin;
  }

  /* 返回名次（0 起）；没进榜或不是正常模式返回 -1。 */
  function recordRun(final) {
    if (!run || MODEID !== "normal") { run = null; return -1; }
    var rec = {
      final: Math.round(final),
      peak: Math.round(run.peak),
      buyin: run.buyin,
      spins: run.spins,
      best: Math.round(run.best),
      date: Date.now()
    };
    run = null;
    if (!rec.spins) return -1;                       // 坐下没转就走，不记
    state.leaderboard.forEach(function (r) { delete r.fresh; });
    rec.fresh = true;
    state.leaderboard.push(rec);
    state.leaderboard.sort(function (a, b) { return b.final - a.final; });
    state.leaderboard = state.leaderboard.slice(0, META.leaderboard.size);
    var rank = state.leaderboard.indexOf(rec);
    if (rank < 0) delete rec.fresh;
    return rank;
  }

  function renderBoard() {
    if (MODEID !== "normal") return;
    var list = state.leaderboard;
    if (!list.length) {
      el.boardList.innerHTML = '<div class="board-empty">还没有纪录。固定 $' + fmt(MODE.ECONOMY.fixedBuyin) +
        " 带入，收手或输光时结算。</div>";
      return;
    }
    el.boardList.innerHTML = list.slice(0, 8).map(function (r, i) {
      var d = new Date(r.date);
      return '<div class="board-row' + (r.fresh ? " fresh" : "") + (i < 3 ? " top" : "") + '">' +
        '<span class="board-rank">' + (i + 1) + "</span>" +
        '<span class="board-main"><b>' + money(r.final) + "</b>" +
        "<small>峰值 " + money(r.peak) + " · " + r.spins + " 转</small></span>" +
        '<span class="board-date">' + (d.getMonth() + 1) + "/" + d.getDate() + "</span>" +
        "</div>";
    }).join("");
  }

  /* ==================================================================
     局外成长：等级 / 任务 / 签到 / 彩金 / 连胜
     这些发的都是"金库"里的虚拟金币，是水龙头，不算进老虎机 RTP。
     ================================================================== */

  /* ---- 财神等级 ---- */
  function xpNeeded(level) { return META.level.curve(level); }

  function addXp(amount) {
    if (amount <= 0) return 0;
    state.xp += amount;
    var gained = 0;
    while (state.level < META.level.maxLevel && state.xp >= xpNeeded(state.level)) {
      state.xp -= xpNeeded(state.level);
      state.level++;
      gained++;
      if (state.level >= META.vip.levelsPerTier * 2 + 1) unlock("vip");
    }
    updateLevelUI();
    return gained;
  }

  async function celebrateLevelUp(levels) {
    var reward = 0;
    for (var i = 0; i < levels; i++) reward += META.level.reward(state.level - i);
    MS.wallet += reward;
    var unlocked = Object.keys(META.level.betUnlock).filter(function (b) {
      var need = META.level.betUnlock[b];
      return need <= state.level && need > state.level - levels;
    });
    audio.impact(3);
    fx.impact(3, { colors: window.ASTER_FX.FESTIVE });
    fx.rays(3200, 0.8);
    showFeature("财 神 升 级", "Lv." + state.level,
      "奖励 " + money(reward) + (unlocked.length ? " · 解锁下注 " + unlocked.map(function (b) { return "$" + b; }).join(" / ") : ""),
      "gold");
    logEvent("<b>升到 Lv." + state.level + "</b>　奖励 " + money(reward), "gold");
    renderDaily();
    renderMissions();
    el.levelChip.classList.add("bump");
    setTimeout(function () { el.levelChip.classList.remove("bump"); }, 900);
    save();
    await wait(2200);
    hideFeature();
    updateUI();
  }

  function betLocked(bet) {
    var need = META.level.betUnlock[bet];
    return need ? state.level < need : false;
  }

  function updateLevelUI() {
    var need = xpNeeded(state.level);
    el.levelValue.textContent = state.level;
    el.levelFill.style.width = Math.min(100, (state.xp / need) * 100).toFixed(1) + "%";
    el.levelXp.textContent = fmt(state.xp) + " / " + fmt(need);
    renderVip();
  }

  /* ---- 任务 ---- */
  function rollMission(exclude) {
    var pool = META.missions.pool.filter(function (m) { return exclude.indexOf(m.key) < 0; });
    if (!pool.length) pool = META.missions.pool;
    var def = pool[Math.floor(Math.random() * pool.length)];
    var target = def.targets[Math.floor(Math.random() * def.targets.length)];
    return {
      key: def.key,
      label: def.label.replace("{n}", fmt(target)),
      target: target,
      progress: 0,
      coin: Math.round(def.coin * target),
      xp: Math.round(def.xp * target)
    };
  }

  function ensureMissions() {
    if (!Array.isArray(state.missions)) state.missions = [];
    var guard = 0;
    while (state.missions.length < META.missions.active && guard++ < 40) {
      state.missions.push(rollMission(state.missions.map(function (m) { return m.key; })));
    }
  }

  /* 累加型进度。bumpMissionMax 用于"单次达到 N"这类。 */
  function bumpMission(key, amount) {
    if (!amount) return;
    state.missions.forEach(function (m) { if (m.key === key) m.progress += amount; });
  }
  function bumpMissionMax(key, value) {
    state.missions.forEach(function (m) { if (m.key === key) m.progress = Math.max(m.progress, value); });
  }

  async function settleMissions() {
    var done = state.missions.filter(function (m) { return m.progress >= m.target; });
    if (!done.length) return;
    for (var i = 0; i < done.length; i++) {
      var m = done[i];
      var coin = missionCoin(m);
      MS.wallet += coin;
      state.missionsDone++;
      var levels = addXp(m.xp);
      audio.impact(2);
      fx.burst(70, { y: window.innerHeight * 0.4, speed: 420, size: 8 });
      fx.flash(0.3);
      toast("任务完成 · " + m.label + "　+" + money(coin));
      logEvent("任务完成：" + m.label + "　<b>+" + money(coin) + "</b>", "gold");
      /* 换一个新的进来，保持永远有三条在跑 */
      var idx = state.missions.indexOf(m);
      state.missions[idx] = rollMission(state.missions.map(function (x) { return x.key; }));
      renderMissions();
      updateUI();
      await wait(700);
      if (levels) await celebrateLevelUp(levels);
    }
    save();
  }

  /* 任务奖励按贵宾段位加成 —— 段位的好处要看得见 */
  function missionCoin(m) { return Math.round(m.coin * vipTier().mission); }

  function renderMissions() {
    ensureMissions();
    el.missionList.innerHTML = state.missions.map(function (m) {
      var pctDone = Math.min(100, (m.progress / m.target) * 100);
      return '<div class="mission">' +
        '<div class="mission-top"><span>' + m.label + '</span><b>+' + money(missionCoin(m)) + "</b></div>" +
        '<div class="mission-track"><i style="width:' + pctDone.toFixed(1) + '%"></i></div>' +
        '<div class="mission-foot"><span>' + fmt(Math.min(m.progress, m.target)) + " / " + fmt(m.target) + "</span><small>+" + fmt(m.xp) + " XP</small></div>" +
        "</div>";
    }).join("");
  }

  /* ---- 每日签到 ---- */
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function daysBetween(a, b) {
    if (!a) return 99;
    return Math.round((new Date(b) - new Date(a)) / 86400000);
  }
  function dailyAvailable() { return state.lastDaily !== todayKey(); }

  function renderDaily() {
    var next = dailyAvailable()
      ? (daysBetween(state.lastDaily, todayKey()) === 1 ? state.dailyStreak % META.daily.cycle : 0)
      : (state.dailyStreak - 1 + META.daily.cycle) % META.daily.cycle;
    var mult = vipTier().daily;
    el.dailyGrid.innerHTML = META.daily.rewards.map(function (r, i) {
      var cls = i < next ? "done" : i === next ? "next" : "";
      return '<div class="daily-cell ' + cls + '"><span>第 ' + (i + 1) + ' 天</span><b>' +
        money(r * mult) + "</b></div>";
    }).join("");
    el.dailyClaim.disabled = !dailyAvailable();
    el.dailyClaim.textContent = dailyAvailable() ? "领取今日奖励" : "今天已领取";
    el.dailyNote.textContent = dailyAvailable()
      ? "连续第 " + (next + 1) + " 天"
      : "明天回来继续，断一天会从第 1 天重新开始。";
    el.dailyDot.classList.toggle("on", dailyAvailable());
  }

  /* 开局时先弹签到、关掉之后再弹买入；中途手动打开签到则不该牵动买入。 */
  var pendingBuyinAfterDaily = false;
  function closeDaily() {
    el.dailyModal.classList.remove("show");
    if (pendingBuyinAfterDaily) {
      pendingBuyinAfterDaily = false;
      setTimeout(openBuyin, 350);
    }
  }

  async function claimDaily() {
    if (!dailyAvailable()) { audio.ui("deny"); return; }
    var gap = daysBetween(state.lastDaily, todayKey());
    state.dailyStreak = gap === 1 ? state.dailyStreak + 1 : 1;
    var index = (state.dailyStreak - 1) % META.daily.cycle;
    var reward = Math.round(META.daily.rewards[index] * vipTier().daily);
    MS.wallet += reward;
    state.lastDaily = todayKey();
    var levels = addXp(Math.round(reward * 0.1));
    save();
    renderDaily();
    updateUI();
    closeDaily();
    audio.impact(3);
    audio.coinShower(1800, 22);
    fx.impact(3, { colors: window.ASTER_FX.FESTIVE });
    fx.coinStorm(2600, 70);
    showFeature("签 到 有 赏", "连续第 " + state.dailyStreak + " 天", "获得 " + money(reward), "gold");
    logEvent("每日签到第 " + state.dailyStreak + " 天　<b>+" + money(reward) + "</b>", "gold");
    await wait(2200);
    hideFeature();
    if (levels) await celebrateLevelUp(levels);
  }

  /* ---- 累积彩金：数字一直在涨，是最直接的"再转一把"钩子 ---- */
  function tickJackpot() {
    var target = engine.jackpot;
    if (Math.abs(target - displayedJackpot) < 0.004) displayedJackpot = target;
    else displayedJackpot += (target - displayedJackpot) * 0.09;
    el.jackpotValue.textContent = moneyPrecise(displayedJackpot);
    requestAnimationFrame(tickJackpot);
  }

  /* ---- 连胜 ---- */
  function updateStreak(won) {
    if (won) {
      streak++;
      if (streak > state.bestStreak) state.bestStreak = streak;
      bumpMissionMax("streak", streak);
    } else {
      streak = 0;
    }
    el.streakValue.textContent = streak;
    el.streakBest.textContent = "最佳 " + state.bestStreak;
    el.streakRow.className = "streak-row" + (streak >= 5 ? " hot" : streak >= 3 ? " warm" : "");
  }


  /* ---------------- 界面刷新 ---------------- */
  function renderAchievements() {
    var done = ACHIEVEMENTS.filter(function (a) { return state.achievements[a.id]; }).length;
    el.achievementCount.textContent = done + " / " + ACHIEVEMENTS.length;
    el.achievementList.innerHTML = ACHIEVEMENTS.map(function (a) {
      var got = state.achievements[a.id];
      return '<div class="achv' + (got ? " done" : "") + '" title="' + a.desc + '">' +
        '<span class="achv-icon">' + (got ? a.icon : "·") + "</span>" +
        '<span class="achv-text"><b>' + a.title + "</b><small>" + a.desc + "</small></span></div>";
    }).join("");
  }

  function renderPaytable() {
    var rows = MODE.PAYING.slice().reverse().map(function (key) {
      var s = CONFIG.SYMBOLS[key];
      var p = MODE.PAYS[key];
      return '<div class="pay-row"><canvas class="pay-icon" data-symbol="' + key + '" width="56" height="56"></canvas>' +
        '<div class="pay-name"><b>' + s.name + "</b><small>3 / 4 / 5 连</small></div>" +
        '<div class="pay-values">' + p[3] + "× &nbsp; " + p[4] + "× &nbsp; " + p[5] + "×</div></div>";
    }).join("");

    var specials = [
      { key: "W", title: "神龙 · 百搭", body: "只出现在第 2/3/4 轮。落轴后<b>整轴展开</b>，替代所有普通图标。" },
      { key: "S", title: "金锣 · 免费游戏", body: "任意 <b>3/4/5 个</b> → 分别赔 2× / 10× / 50×，并开启 <b>9 / 14 / 20</b> 次免费旋转（每一次都由你自己按）。" },
      { key: "C", title: "招财钱币", body: "为<b>龙气</b>充能。3 枚以上还有额外散赔；龙气满时进入 <b>聚宝盆</b>。" }
    ].map(function (item) {
      return '<div class="pay-row special"><canvas class="pay-icon" data-symbol="' + item.key + '" width="56" height="56"></canvas>' +
        '<div class="pay-name wide"><b>' + item.title + "</b><small>" + item.body + "</small></div></div>";
    }).join("");

    el.paytableBody.innerHTML =
      '<p class="pay-lead">从<b>最左轴</b>开始，相邻轴上出现同一图标即中奖。同一轴出现多个时数量相乘 —— 共 <b>243 种</b>组合方式。<br>下表为<b>每一条 Ways</b> 的赔率，实际赔付 = 赔率 × Ways 数。</p>' +
      '<div class="pay-grid">' + rows + "</div>" +
      "<h3>特殊图标</h3><div class=\"pay-grid\">" + specials + "</div>" +
      '<h3>特殊组合</h3><ul class="combo-list">' +
      "<li><b>双龙戏珠</b>　2 条神龙同屏 → 本次旋转 <b>2×</b>，龙气大幅上涨</li>" +
      "<li><b>三龙聚顶</b>　3 条神龙同屏 → 本次旋转 <b>3×</b>，龙气<b>直接充满</b></li>" +
      "<li><b>满堂金</b>　　3 枚以上招财钱币 → 龙气额外上涨</li>" +
      "<li><b>龙锣共鸣</b>　2 个金锣 + 至少 1 条神龙 → 神龙化锣，<b>补足触发免费游戏</b></li>" +
      "</ul>" +
      '<h3>免费游戏 · 龙门</h3><p class="pay-note">起始 <b>4×</b> 倍率，每有一次中奖旋转 <b>+1×</b>（最高 8×）。期间再出 3 个金锣可 <b>+5 次</b>。' +
      "每一次免费旋转都由玩家<b>手动按下</b>。</p>" +
      '<h3>聚宝盆 · 龙气充满时自动开启</h3><p class="pay-note">盘面清空，落下的钱币<b>锁定</b>并带有面值；初始 3 次重转，每次落新币重置为 3 次。' +
      "<b>每一次重转也都由你自己按</b>，按得越久转得越久。填满 15 格额外奖励 <b>200×</b>。</p>" +
      '<p class="pay-note muted">单次旋转封顶 ' + F.maxWinPerSpin + '× 下注。全部为虚拟金币，不涉及任何真实货币。</p>';

    el.paytableBody.querySelectorAll(".pay-icon").forEach(function (canvas) {
      var key = canvas.dataset.symbol;
      var ctx = canvas.getContext("2d");
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = 56 * dpr; canvas.height = 56 * dpr;
      ctx.scale(dpr, dpr);
      ctx.translate(28, 28);
      window.ASTER_ART.drawSymbol(ctx, key, CONFIG.SYMBOLS[key], 50);
    });
  }

  function chargeStateLabel(ratio) {
    if (ratio >= 1) return "龙气充盈";
    if (ratio >= F.charge.warnAt) return "将满 · 蓄势待发";
    if (ratio >= 0.45) return "龙气渐盛";
    if (ratio > 0) return "聚气中";
    return "静待";
  }

  function updateCharge(animate) {
    var ratio = Math.min(1, engine.charge / F.charge.max);
    el.chargeFill.style.width = (ratio * 100).toFixed(1) + "%";
    el.chargeTrack.classList.toggle("hot", ratio >= F.charge.warnAt);
    el.chargeTrack.classList.toggle("full", ratio >= 1);
    el.chargeState.textContent = chargeStateLabel(ratio);
    if (animate) {
      el.chargeTrack.classList.remove("pulse");
      void el.chargeTrack.offsetWidth;
      el.chargeTrack.classList.add("pulse");
    }
  }

  function updateUI() {
    el.wallet.textContent = money(MS.wallet);
    el.buyinWallet.textContent = money(MS.wallet);
    el.session.textContent = session > 0 ? money(displayedSession) : "—";
    el.betValue.textContent = money(MS.bet);
    el.spinCount.textContent = fmt(MS.spinCount);

    var free = engine.mode === "free";
    el.freeHud.classList.toggle("visible", free);
    if (free) {
      el.freeRemaining.textContent = engine.freeSpins;
      el.freeMultiplier.textContent = engine.freeMultiplier + "×";
      el.freeTotal.textContent = money(engine.freeWon);
    }
    el.modeLabel.textContent = free ? "龙门免费游戏"
      : phase === "hold" ? "聚宝盆"
        : phase === "spinning" ? "转动中…"
          : session > 0 ? "基础游戏" : "等待入座";

    var busy = phase !== "idle";
    if (awaitingPress) {
      el.spinBtn.disabled = false;
    } else {
      el.spinBtn.disabled = busy || (session <= 0 && !free);
      if (free) {
        el.spinLabel.textContent = "免费旋转";
        el.spinHint.textContent = "剩 " + engine.freeSpins + " 次";
      } else if (phase !== "hold") {
        el.spinLabel.textContent = "旋 转";
        el.spinHint.textContent = "SPACE";
      }
    }
    el.betDown.disabled = busy || free;
    el.betUp.disabled = busy || free || betLocked(nextBet(1));
    el.collectBtn.disabled = busy || session <= 0 || free;
    el.autoBtn.disabled = session <= 0 || free;
    el.autoBtn.classList.toggle("on", autoRemaining > 0);
    el.autoLabel.textContent = autoRemaining > 0 ? autoRemaining + " 次" : "自动";
    el.turboBtn.classList.toggle("on", state.turbo);
    el.turboState.textContent = state.turbo ? "开" : "关";
    el.soundBtn.classList.toggle("off", !state.soundOn);
    el.musicBtn.classList.toggle("off", !state.musicOn);

    var price = MS.bet * F.buyFeature.price;
    el.buyPrice.textContent = money(price);
    el.buyBtn.disabled = busy || free || session < price;
    el.buyBtn.classList.toggle("armed", buyArmed > Date.now());

    el.modeSwitch.querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.mode === MODEID);
      b.classList.toggle("armed", hallArmed.id === b.dataset.mode && hallArmed.until > Date.now());
      b.disabled = phase !== "idle" || engine.mode === "free";
    });
    el.boardPanel.style.display = MODEID === "normal" ? "" : "none";
    updatePartyHud();
    updateCharge(false);
    updateLevelUI();
  }

  /* 余额数字滚动。大奖时滚得久一点，让"变多"这件事被看见。 */
  function countSession(target, duration) {
    var from = displayedSession;
    var delta = target - from;
    if (Math.abs(delta) < 1 || state.reducedMotion) {
      displayedSession = target;
      el.session.textContent = money(target);
      return Promise.resolve();
    }
    var start = performance.now();
    var lastTick = 0;
    el.session.classList.add("counting");
    return new Promise(function (resolve) {
      function step(now) {
        var t = Math.min(1, (now - start) / duration);
        var eased = 1 - Math.pow(1 - t, 2.2);
        displayedSession = from + delta * eased;
        el.session.textContent = money(displayedSession);
        if (now - lastTick > 62) { lastTick = now; audio.countTick(t); }
        if (t < 1 && !skipRequested) requestAnimationFrame(step);
        else {
          displayedSession = target;
          el.session.textContent = money(target);
          el.session.classList.remove("counting");
          resolve();
        }
      }
      requestAnimationFrame(step);
    });
  }

  /* ---------------- 横幅 / 满屏特写 ---------------- */
  function showBanner(tier, amount, sub) {
    hideFeature();
    el.bannerTitle.textContent = tier.label;
    el.bannerAmount.textContent = "+" + money(amount);
    el.bannerSub.textContent = sub || "";
    el.banner.className = "banner show tier-" + tier.id;
  }
  function hideBanner() { el.banner.className = "banner"; }

  function showFeature(title, sub, meta, kind) {
    hideBanner();
    el.featureTitle.textContent = title;
    el.featureSub.textContent = sub || "";
    el.featureMeta.textContent = meta || "";
    el.featureCard.className = "feature-card show" + (kind ? " " + kind : "");
  }
  function hideFeature() { el.featureCard.className = "feature-card"; }

  /* ---------------- 旋转流程 ---------------- */

  /* 期待与擦边球。前者只在真的还有机会时开，后者按配置的概率也会"假吊"一下。 */
  function planTension(grid) {
    var anticipate = {};
    var tease = {};
    var T = F.tease;
    var scatters = 0, dragons = 0, tops = 0;

    for (var c = 0; c < CONFIG.REELS; c++) {
      if (c >= 2 && scatters >= 2) anticipate[c] = Math.min(2, scatters - 1);
      if (c === 3 && dragons >= 2) anticipate[c] = Math.max(anticipate[c] || 0, 2);
      if (c === 2 && tops >= 2) anticipate[c] = Math.max(anticipate[c] || 0, 1);
      var hasDragon = false;
      for (var r = 0; r < CONFIG.ROWS; r++) {
        if (grid[c][r] === "S") scatters++;
        if (grid[c][r] === "W") hasDragon = true;
        if (grid[c][r] === "PX") tops++;
      }
      if (hasDragon) dragons++;
    }

    /* 最后一轴的擦边球：有真实机会时必吊，否则按概率也吊 */
    var last = CONFIG.REELS - 1;
    var realChance = T.onScatter && anticipate[last];
    if (realChance || Math.random() < T.chance) tease[last] = T.cells;
    /* 前两轴都是貔貅时，第三轴也吊一下 */
    if (T.onTopSymbol && anticipate[2] && Math.random() < 0.6) tease[2] = 1;

    return { anticipate: anticipate, tease: tease };
  }

  async function spin() {
    if (phase !== "idle") return;
    var free = engine.mode === "free";
    if (!free) {
      if (session <= 0) { openBuyin(); return; }
      if (session < MS.bet) { audio.ui("deny"); toast("本局余额不足，请收手或调低下注"); return; }
    }
    audio.unlock();
    skipRequested = false;
    disarmSpinButton();
    phase = "spinning";
    hideBanner();
    hideFeature();
    el.resultLine.textContent = "";
    el.resultLine.className = "result-line";

    if (!free) {
      session -= MS.bet;
      displayedSession = session;
      MS.spinCount++;
      unlock("first");
      /* 经验 = 流水：押得大升得快。娱乐模式筹码大一档，按权重折算。 */
      var weighted = MS.bet * wagerWeight();
      state.totalWager += weighted;
      var levels = addXp(weighted);
      bumpMission("spins", 1);
      bumpMission("wager", MS.bet);
      if (levels) { state.__pendingLevels = (state.__pendingLevels || 0) + levels; }
    }
    updateUI();

    renderer.setStrips(free ? MODE.STRIPS.free : MODE.STRIPS.base);
    var outcome = engine.play(MS.bet);
    var tension = planTension(outcome.grid);

    audio.startSpinLoop();
    var antStarted = false;
    renderer.onReelStop = function (index, hot) {
      audio.reelStop(index, hot);
      if (antStarted) { audio.stopAnticipation(); antStarted = false; }
      renderer.anticipation[index] = 0;
      var nextLevel = tension.anticipate[index + 1];
      if (nextLevel) {
        renderer.anticipation[index + 1] = nextLevel;
        audio.startAnticipation(nextLevel);
        antStarted = true;
        fx.rays(2600, 0.3);
      }
    };
    renderer.onReelTease = function () {
      if (antStarted) { audio.stopAnticipation(); antStarted = false; }
      audio.tease();
      fx.flash(0.34, "radial-gradient(ellipse at center, rgba(255,240,200,.9), rgba(255,170,60,.35) 50%, transparent 78%)");
      fx.rays(1400, 0.5);
      fx.shake(11, 480);
    };

    await renderer.spin({
      stops: outcome.stops, turbo: state.turbo,
      anticipate: tension.anticipate, tease: tension.tease
    });
    audio.stopSpinLoop();
    if (antStarted) audio.stopAnticipation();
    renderer.anticipation = {};
    fx.raysOff();

    phase = "presenting";
    await present(outcome);

    session += outcome.totalWin;
    displayedSession = session;
    if (outcome.totalWin > MS.bestWin) MS.bestWin = outcome.totalWin;
    trackRun(outcome);
    settleRebate();

    /* 任务与连胜结算 */
    bumpMission("won", outcome.totalWin);
    bumpMission("dragons", outcome.wildReels.length);
    bumpMission("coins", outcome.coinCount);
    bumpMission("scatters", outcome.scatterCount);
    if (outcome.free.triggered) bumpMission("frees", 1);
    if (outcome.hold) bumpMission("holds", 1);
    if (outcome.totalWin > 0) bumpMission("wins", 1);
    bumpMissionMax("bestX", outcome.totalWin / outcome.bet);
    updateStreak(outcome.totalWin > 0);
    renderMissions();
    save();
    updateUI();

    /* 升级和任务结算也算演出的一部分：这段时间 phase 仍然不是 idle，
     * 玩家按不动旋转键，外部（比如端到端检查）也能看出"还没演完"。 */
    if (state.__pendingLevels) {
      var lv = state.__pendingLevels;
      state.__pendingLevels = 0;
      await celebrateLevelUp(lv);
    }
    await settleMissions();

    phase = "idle";
    updateUI();

    /* 连最小注都押不起了 —— 这一局到此为止，直接结算进排行榜 */
    if (engine.mode !== "free" && session < minBet()) {
      await endRun("bust");
      return;
    }
    await chainNext(outcome);
  }

  async function chainNext(outcome) {
    /* 免费游戏改为手动：不自动连转，把按钮交回玩家（按钮自己会脉冲提示） */
    if (engine.mode === "free" && engine.freeSpins > 0) {
      armSpinButton("免费旋转", "剩 " + engine.freeSpins + " 次");
      updateUI();
      return;
    }
    if (outcome.free.ended) {
      var won = outcome.free.won;
      audio.impact(3);
      fx.impact(3, { colors: window.ASTER_FX.FESTIVE });
      showFeature("龙 门 已 闭", "本次免费游戏共赢得", money(won), "gold");
      logEvent("免费游戏结束，合计 <b>" + money(won) + "</b>", "gold");
      await wait(2400);
      hideFeature();
      fx.vignette(false);
      updateUI();
    }
    if (autoRemaining > 0) {
      autoRemaining--;
      updateUI();
      if (autoRemaining <= 0) return;
      if (session < MS.bet) {
        autoRemaining = 0;
        updateUI();
        toast("余额不足，自动旋转已停止");
        return;
      }
      await wait(state.turbo ? 160 : 380);
      if (phase === "idle" && autoRemaining > 0 && engine.mode !== "free") spin();
    }
  }

  async function present(outcome) {
    var bet = outcome.bet;

    /* 0. 天降横财：钱币是结算前额外砸上去的，先让玩家看见它们落位 */
    if (outcome.droppedCells && outcome.droppedCells.length) {
      audio.impact(2);
      fx.flash(0.4, "radial-gradient(ellipse at 50% -10%, rgba(255,230,160,.95), rgba(255,140,60,.3) 48%, transparent 76%)");
      fx.coinStorm(1400, 46);
      showFeature("天 降 横 财", outcome.droppedCells.length + " 枚招财钱币从天而降", "直接落进盘面", "gold");
      await wait(900);
      var rectD = el.stage.getBoundingClientRect();
      for (var di = 0; di < outcome.droppedCells.length; di++) {
        var idx = outcome.droppedCells[di];
        var dcc = Math.floor(idx / CONFIG.ROWS), drr = idx % CONFIG.ROWS;
        var dp = renderer.cellCenter(dcc, drr);
        audio.coin(di);
        renderer.ring(dcc, drr, "#ffd76a");
        renderer.burst(22, { x: dp.x, y: dp.y, speed: 240, size: 7, lift: 110 });
        fx.burst(26, { x: rectD.left + dp.x, y: rectD.top + dp.y, speed: 320, size: 8, lift: 140 });
        fx.shake(6, 200);
        await wait(140);
      }
      hideFeature();
      logEvent("<b>天降横财</b>　+" + outcome.droppedCells.length + " 枚钱币", "gold");
      await wait(220);
    }

    /* 0.5 金龙狂暴进行中：先亮一下身份，再走正常的神龙展开 */
    if (outcome.rampage && outcome.rampage.active) {
      audio.dragon();
      fx.flash(0.5, "radial-gradient(ellipse at center, rgba(255,120,80,.9), rgba(180,20,40,.4) 50%, transparent 78%)");
      fx.rays(2000, 0.7);
      fx.shake(14, 420);
      document.body.classList.add("rampage-mode");
      await wait(260);
    } else {
      document.body.classList.remove("rampage-mode");
    }

    /* 1. 神龙整轴展开 */
    if (outcome.wildReels.length) {
      audio.dragon();
      fx.flash(0.55, "radial-gradient(ellipse at center, rgba(255,220,150,.95), rgba(255,90,60,.45) 45%, transparent 75%)");
      fx.shockwave({ color: "#ff9a4a", width: 12, dur: 800 });
      fx.burst(90 * outcome.wildReels.length, { speed: 620, size: 11, colors: window.ASTER_FX.FESTIVE });
      fx.shake(10 + outcome.wildReels.length * 6, 620);
      renderer.flash(0.6);
      renderer.shake(outcome.wildReels.length * 7);
      await renderer.expandWilds(outcome.wildReels);
      unlock("dragon");
      await wait(240);
    }

    /* 2. 特殊组合：满屏特写 */
    if (outcome.combos.indexOf("tripleDragon") >= 0) {
      unlock("triple");
      audio.impact(4);
      fx.impact(4, { color: "#ff6a3c", colors: window.ASTER_FX.FESTIVE });
      fx.rays(3000, 0.85);
      showFeature("三 龙 聚 顶", "龙气直接充满", "本次旋转 3× 加成", "dragon");
      logEvent("<b>三龙聚顶</b>　龙气瞬间充满", "gold");
      await wait(2300);
      hideFeature();
      await wait(240);
    } else if (outcome.combos.indexOf("twinDragon") >= 0) {
      unlock("twin");
      audio.impact(3);
      fx.impact(3, { color: "#ffb04a" });
      showFeature("双 龙 戏 珠", "本次旋转 2× 加成", "龙气大幅上涨", "dragon");
      logEvent("<b>双龙戏珠</b>　2× 加成", "gold");
      await wait(1700);
      hideFeature();
      await wait(240);
    }

    /* 3. 招财钱币逐枚入账 + 龙气上涨 */
    if (outcome.coinCount) {
      for (var i = 0; i < outcome.coinCells.length; i++) {
        var index = outcome.coinCells[i];
        var c = Math.floor(index / CONFIG.ROWS), r = index % CONFIG.ROWS;
        audio.coin(i);
        renderer.ring(c, r, "#ffd76a");
        var p = renderer.cellCenter(c, r);
        var rect = el.stage.getBoundingClientRect();
        renderer.burst(16, { x: p.x, y: p.y, speed: 210, size: 6, lift: 80 });
        fx.burst(22, { x: rect.left + p.x, y: rect.top + p.y, speed: 300, size: 8, lift: 120 });
        await wait(130);
      }
      updateCharge(true);
      audio.chargeTick(Math.min(1, engine.charge / F.charge.max));
      if (outcome.combos.indexOf("coinRush") >= 0) {
        audio.impact(2);
        fx.impact(2);
        showFeature("满 堂 金", outcome.coinCount + " 枚招财钱币", "龙气额外上涨", "gold");
        logEvent("<b>满堂金</b>：" + outcome.coinCount + " 枚招财钱币", "gold");
        await wait(1300);
        hideFeature();
      }
    } else {
      updateCharge(false);
    }

    /* 4. 243 Ways 逐组高亮 */
    if (outcome.wins.length) {
      var all = [];
      outcome.wins.forEach(function (w) { all = all.concat(w.positions); });
      renderer.setHighlight(all, true);
      if (!state.quickWin && outcome.wins.length > 1 && !state.turbo) {
        for (var k = 0; k < outcome.wins.length; k++) {
          var w = outcome.wins[k];
          renderer.setHighlight(w.positions, true);
          audio.pluck(window.ASTER_AUDIO.note(k + 1, 4), { dur: 0.5, vol: 0.2 });
          await wait(500);
        }
        renderer.setHighlight(all, true);
      }
    }

    /* 5. 结算与奖级演出 —— 只要赢了就庆祝，哪怕少于下注 */
    var lines = [];
    if (outcome.waysPay > 0) {
      lines.push(outcome.wins.map(function (w) {
        return CONFIG.SYMBOLS[w.symbol].name + " " + w.reels + "连×" + w.ways;
      }).join("　"));
    }
    if (outcome.scatterPay > 0) lines.push("金锣 " + outcome.effectiveScatters + " 个");
    if (outcome.coinPay > 0) lines.push("钱币散赔 " + outcome.coinCount + " 枚");
    if (outcome.multiplier > 1) lines.push(outcome.multiplier + "× 加成");

    var spinWin = outcome.spinWin;
    if (spinWin > 0) {
      var tier = ENGINE.winTier(MODE, spinWin, bet);
      audio.win(tier.id);
      if (tier.fx >= 2) {
        audio.impact(tier.fx);
        fx.impact(tier.fx, { colors: tier.fx >= 3 ? window.ASTER_FX.FESTIVE : undefined });
      } else {
        /* 小额也庆祝，但不动用锣和次低频，否则大奖就不够响了 */
        fx.burst(38, { speed: 380, size: 8 });
        fx.flash(0.2);
        fx.shake(5, 260);
      }
      showBanner(tier, spinWin, lines.join("　"));
      renderer.burst(40 + tier.fx * 45, { speed: 320 + tier.fx * 120, size: 7 + tier.fx * 2 });
      renderer.shake(6 + tier.fx * 5);
      renderer.flash(0.25 + tier.fx * 0.12);
      if (tier.fx >= 3) {
        fx.coinStorm(tier.hold + 1200, 40 + tier.fx * 22);
        renderer.coinRain(60);
      }
      await countSession(session + spinWin, Math.min(tier.hold * 0.6, 2600));
      await wait(tier.hold * 0.4);
      hideBanner();
      if (tier.fx >= 3) logEvent(tier.label.replace(/\s/g, "") + "　<b>+" + money(spinWin) + "</b>　" + lines.join(" "), "gold");
      else logEvent("赢得 <b>+" + money(spinWin) + "</b>　" + lines.join(" "));
      el.resultLine.textContent = "+" + money(spinWin) + "　" + lines.join("　");
      el.resultLine.className = "result-line win";
      if (spinWin / bet >= 100) unlock("hundred");
    } else {
      el.resultLine.textContent = engine.mode === "free" ? "本轮未中" : "未中奖";
      el.resultLine.className = "result-line muted";
      await wait(state.turbo ? 80 : 220);
    }
    displayedSession = session + spinWin;

    /* 6. 聚宝盆 */
    if (outcome.hold) await runHold(outcome);

    /* 6.5 累积彩金 —— 整局最响的一下 */
    if (outcome.jackpot.hit) {
      audio.grand();
      fx.impact(4, { colors: window.ASTER_FX.FESTIVE });
      fx.rays(9000, 1);
      fx.coinStorm(8000, 190);
      fx.vignette(true, "rgba(255,90,60,.5)");
      for (var sw = 0; sw < 8; sw++) {
        setTimeout(function () { fx.shockwave({ color: "#ffe08a", width: 16, dur: 1400 }); }, sw * 300);
      }
      renderer.coinRain(200);
      showFeature("累 积 彩 金", "财神降临", money(outcome.jackpot.win), "grand");
      logEvent("<b>累积彩金命中</b>　<b>+" + money(outcome.jackpot.win) + "</b>", "gold");
      await wait(3600);
      hideFeature();
      var jTier = ENGINE.winTier(MODE, outcome.jackpot.win, bet);
      showBanner(jTier, outcome.jackpot.win, "累积彩金");
      await countSession(session + outcome.spinWin + (outcome.hold ? outcome.hold.total : 0) + outcome.jackpot.win, 2600);
      await wait(2400);
      hideBanner();
      if (engine.mode !== "free" && phase !== "hold") fx.vignette(false);
      displayedJackpot = engine.jackpot;
    }

    /* 7. 免费游戏开启 */
    if (outcome.free.triggered) {
      unlock("free");
      audio.freeSpinsStart();
      renderer.clearHighlight();
      fx.impact(4, { colors: window.ASTER_FX.FESTIVE, color: "#ffd15c" });
      fx.rays(4200, 0.9);
      fx.coinStorm(3200, 70);
      fx.vignette(true, "rgba(232,182,64,.4)");
      showFeature("龙 门 大 开", outcome.free.triggered + " 次免费旋转",
        "起始 " + F.freeSpins.startMultiplier + "× · 每次中奖再 +1× · 由你亲手按下", "gong");
      logEvent("<b>龙门大开</b>　" + outcome.free.triggered + " 次免费旋转（" + outcome.effectiveScatters + " 个金锣）", "gold");
      await wait(3000);
      hideFeature();
      audio.setIntensity(1);
      document.body.classList.add("free-mode");
    } else if (outcome.free.retriggered) {
      audio.impact(2);
      fx.impact(2);
      toast("金锣再鸣 · 免费旋转 +" + outcome.free.retriggered);
      logEvent("免费旋转 <b>+" + outcome.free.retriggered + "</b>", "gold");
    }
    if (outcome.free.ended) {
      audio.setIntensity(0);
      document.body.classList.remove("free-mode");
    }

    /* 8. 滚雪球爬级：连中越久倍率越高，断一次清零 */
    if (F.snowball) {
      var before = outcome.snowball.mult;
      updatePartyHud();
      var after = engine.snowballMult();
      if (after > before) {
        audio.pluck(window.ASTER_AUDIO.note(engine.snowballStep + 2, 5), { dur: 0.42, vol: 0.26 });
        el.snowMeter.classList.remove("bump");
        void el.snowMeter.offsetWidth;
        el.snowMeter.classList.add("bump");
        if (after >= 4) {
          fx.impact(2, { color: "#7fe7ff" });
          toast("滚雪球 " + after + "× · 别停");
        }
      } else if (before > 1 && after === 1) {
        el.snowMeter.classList.remove("drop");
        void el.snowMeter.offsetWidth;
        el.snowMeter.classList.add("drop");
        audio.subDrop({ vol: 0.2, dur: 0.45, from: 150, to: 50 });
      }
    }

    /* 9. 金龙狂暴触发：下一转开始，第 2/3/4 轴全是神龙 */
    if (outcome.rampage && outcome.rampage.triggered) {
      audio.grand();
      fx.impact(4, { colors: window.ASTER_FX.FESTIVE, color: "#ff5a3c" });
      fx.rays(5200, 1);
      fx.vignette(true, "rgba(255,70,50,.45)");
      for (var rw = 0; rw < 4; rw++) {
        setTimeout(function () { fx.shockwave({ color: "#ff9a4a", width: 15, dur: 1200 }); }, rw * 260);
      }
      fx.coinStorm(2600, 60);
      renderer.coinRain(90);
      showFeature("金 龙 狂 暴", "接下来 " + outcome.rampage.triggered + " 转",
        "中间三轴全是神龙 · 再 " + F.rampage.multiplier + "× 加成", "dragon");
      logEvent("<b>金龙狂暴</b>　接下来 " + outcome.rampage.triggered + " 转中轴全龙", "gold");
      await wait(3000);
      hideFeature();
      if (engine.mode !== "free" && phase !== "hold") fx.vignette(false);
      updatePartyHud();
    }
    if (outcome.rampage && outcome.rampage.left <= 0) document.body.classList.remove("rampage-mode");

    if (outcome.capped) toast("触及单次封顶 " + F.maxWinPerSpin + "×");
    renderer.clearHighlight();
    updateCharge(false);
  }

  /* ---------------- 聚宝盆：每一次重转都由玩家自己按 ---------------- */
  async function runHold(outcome) {
    var hold = outcome.hold;
    var size = CONFIG.REELS * CONFIG.ROWS;
    var H = F.holdSpin;
    phase = "hold";
    unlock("hold");
    updateUI();

    audio.holdStart();
    fx.impact(3, { color: "#ffd15c" });
    fx.rays(3200, 0.7);
    fx.vignette(true, "rgba(232,182,64,.45)");
    document.body.classList.add("hold-mode");
    showFeature("聚 宝 盆", "龙气充盈 · 钱币锁定", "每一次重转都由你自己按", "gold");
    await wait(2400);
    hideFeature();

    renderer.enterHold(new Array(size).fill(0));
    el.holdHud.classList.add("visible");
    var running = 0;

    for (var i = 0; i < hold.seeded.length; i++) {
      var sc = hold.seeded[i];
      renderer.holdLand(sc.index, sc.coin);
      audio.holdLock(i);
      running = holdRunning(hold, outcome.bet);
      el.holdTotal.textContent = money(running);
      flashHoldCell(sc.index, sc.coin);
      await wait(230);
    }

    var respins = H.respins;
    el.holdRespins.textContent = respins;

    for (var round = 0; round < hold.rounds.length; round++) {
      var step = hold.rounds[round];
      el.holdRespins.textContent = respins;
      updateUI();
      await waitForPress("重 转", "剩 " + respins + " 次");

      /* 按得越久转得越久：每一轮都比上一轮再长一点。
       * 转法和普通游戏完全一样，只是已锁定的钱币格不参与滚动。 */
      var ms = Math.min(H.spinMsMax, H.spinMs + round * H.spinMsStep);
      if (state.turbo) ms *= 0.6;
      audio.startSpinLoop();
      audio.riser(ms, { vol: 0.16 });
      fx.rays(ms + 400, 0.4);
      el.holdHud.classList.add("spinning");
      renderer.onHoldReelStop = function (index) { audio.reelStop(index, false); };
      await renderer.holdSpinReels(ms);
      el.holdHud.classList.remove("spinning");
      audio.stopSpinLoop();

      if (step.landed.length) {
        for (var k = 0; k < step.landed.length; k++) {
          var lc = step.landed[k];
          renderer.holdLand(lc.index, lc.coin);
          audio.holdLock(k);
          running = holdRunning(hold, outcome.bet);
          el.holdTotal.textContent = money(running);
          flashHoldCell(lc.index, lc.coin);
          await wait(300);
        }
        audio.impact(2);
        fx.impact(2);
        el.holdHud.classList.remove("reset");
        void el.holdHud.offsetWidth;
        el.holdHud.classList.add("reset");
        respins = H.respins;
      } else {
        audio.subDrop({ vol: 0.22, dur: 0.5, from: 120, to: 40 });
        respins = step.respinsLeft;
      }
      el.holdRespins.textContent = respins;
      await wait(420);
    }

    /* ---- 结算：满屏爆炸 + 金币持续崩 ---- */
    el.holdHud.classList.remove("visible");
    var tier = ENGINE.winTier(MODE, hold.total, outcome.bet);

    /* 倍率币 / 收集器：先把乘数单独演一遍，再报总数 —— 不然
     * "盆里 180 枚怎么变成 2160" 这一步玩家根本看不懂。 */
    if (hold.multiplier > 1) {
      audio.impact(3);
      fx.impact(3, { color: hold.collectorCount ? "#ff5a6a" : "#b47aff" });
      fx.rays(2600, 0.8);
      var parts = [];
      if (hold.multCount) parts.push(hold.multCount + " 枚倍率币");
      if (hold.collectorCount) parts.push(hold.collectorCount + " 枚聚财神");
      showFeature("全 盆 加 倍", parts.join(" · "),
        money(hold.coinTotal * outcome.bet) + " × " + hold.multiplier + "　→　" + money(hold.total), "grand");
      logEvent("<b>聚宝盆加倍</b>　" + parts.join("、") + " → <b>" + hold.multiplier + "×</b>", "gold");
      for (var mw = 0; mw < 3; mw++) {
        setTimeout(function () { fx.shockwave({ color: "#b47aff", width: 12, dur: 1000 }); }, mw * 280);
      }
      await wait(2600);
      hideFeature();
    }

    if (hold.grand) {
      unlock("grand");
      audio.grand();
      fx.impact(4, { colors: window.ASTER_FX.FESTIVE });
      fx.rays(9000, 1);
      fx.coinStorm(9000, 150);
      for (var s = 0; s < 6; s++) {
        setTimeout(function () { fx.shockwave({ color: "#ffe08a", width: 14, dur: 1200 }); }, s * 320);
      }
      showFeature("大 满 贯", "十五格全满", "额外 " + F.holdSpin.grandPay + "× 下注", "grand");
      renderer.coinRain(180);
      await wait(3600);
      hideFeature();
    } else {
      audio.impact(Math.max(3, tier.fx));
      fx.impact(Math.max(3, tier.fx), { colors: window.ASTER_FX.FESTIVE });
    }

    /* 巨大的满屏收尾：光芒 + 冲击波 + 持续几秒的金币暴雨 */
    audio.coinShower(4200, 24);
    fx.rays(5200, 0.95);
    fx.coinStorm(5200, hold.grand ? 170 : 110);
    fx.shockwave({ color: "#ffe08a", width: 16, dur: 1300 });
    fx.shockwave({ color: "#ff8a4a", width: 10, dur: 1700 });
    fx.shake(22, 900);
    renderer.coinRain(120);

    showBanner(tier, hold.total, "聚宝盆 · " + hold.filled + " 枚钱币" + (hold.grand ? " · 大满贯" : ""));
    await countSession(session + outcome.spinWin + hold.total, 2600);
    await wait(2800);                 // 让金币再崩一会儿
    hideBanner();
    renderer.exitHold();
    document.body.classList.remove("hold-mode");
    if (engine.mode !== "free") { fx.vignette(false); audio.setIntensity(0); }

    logEvent("<b>聚宝盆</b>　" + hold.filled + " 枚 → <b>+" + money(hold.total) + "</b>" +
      (hold.grand ? "（大满贯）" : ""), "gold");
    updateCharge(true);
    phase = "presenting";
    updateUI();
  }

  /* 盘面上已经锁定的钱币当前值多少（含倍率币 / 收集器的乘数） */
  function holdRunning(hold, bet) {
    var sum = 0, mult = 1;
    renderer.hold.board.forEach(function (cell) {
      if (!cell) return;
      if (cell.t === "v") sum += cell.v;
      else mult *= cell.v;
    });
    return sum * mult * bet;
  }

  /* 聚宝盆落币时在屏幕坐标上也炸一下，面值越大越夸张 */
  function flashHoldCell(index, coin) {
    var c = Math.floor(index / CONFIG.ROWS), r = index % CONFIG.ROWS;
    var p = renderer.cellCenter(c, r);
    var rect = el.stage.getBoundingClientRect();
    var big = coin.t !== "v" || coin.v >= 8;
    fx.burst(big ? 90 : 34, {
      x: rect.left + p.x, y: rect.top + p.y,
      speed: big ? 520 : 280, size: big ? 11 : 7, lift: 140
    });
    if (big) {
      fx.shockwave({ x: rect.left + p.x, y: rect.top + p.y, color: "#ffe08a", width: 7, dur: 700, max: 620 });
      fx.flash(0.3);
      fx.shake(12, 380);
    }
  }

  /* ---------------- 买龙门（bonus buy）---------------- */
  async function buyFeature() {
    if (phase !== "idle" || engine.mode === "free") { audio.ui("deny"); return; }
    var price = MS.bet * F.buyFeature.price;
    if (session < price) { audio.ui("deny"); toast("本局余额不足以买龙门"); return; }

    /* 两段确认：误点一下不会直接花掉 40 倍下注 */
    if (buyArmed < Date.now()) {
      buyArmed = Date.now() + 4000;
      updateUI();
      toast("再按一次确认：" + money(price) + " 买入龙门");
      setTimeout(updateUI, 4100);
      return;
    }
    buyArmed = 0;

    session -= price;
    displayedSession = session;
    bumpMission("wager", price);
    var levels = addXp(price);
    var granted = engine.buyFreeSpins();
    unlock("free");
    save();

    audio.freeSpinsStart();
    fx.impact(4, { colors: window.ASTER_FX.FESTIVE, color: "#ffd15c" });
    fx.rays(4200, 0.9);
    fx.coinStorm(3000, 70);
    fx.vignette(true, "rgba(232,182,64,.4)");
    showFeature("买 入 龙 门", granted.spins + " 次免费旋转",
      "花费 " + money(price) + " · 起始 " + F.freeSpins.startMultiplier + "×", "gong");
    logEvent("买入龙门 " + money(price) + "　→ " + granted.spins + " 次免费旋转", "gold");
    await wait(2600);
    hideFeature();
    audio.setIntensity(1);
    document.body.classList.add("free-mode");
    if (levels) await celebrateLevelUp(levels);
    armSpinButton("免费旋转", "剩 " + engine.freeSpins + " 次");
    updateUI();
  }

  /* ---------------- 买入 / 收手 ---------------- */
  function openBuyin() {
    renderHallPicker();
    var amount = MODE.ECONOMY.fixedBuyin;
    el.buyinNote.textContent = MODEID === "normal"
      ? "固定带入，收手或输光时结算成一条纪录 —— 带入一样多，纪录才可比。"
      : "固定带入，炸完再来。这个厅不计纪录，随便玩。";
    el.buyinGo.disabled = MS.wallet < amount;
    el.buyinGo.textContent = MS.wallet < amount
      ? "金库不足（需要 " + money(amount) + "）"
      : "入座（" + money(amount) + "）";
    updateUI();
    el.buyinModal.classList.add("show");
  }

  /* 入座页的选厅卡片。弹窗是全屏遮罩，顶栏那个切换在这里点不到，
   * 所以选厅必须在弹窗里也有一份 —— 否则收手之后就永远回不到娱乐厅。 */
  function renderHallPicker() {
    el.hallPicker.querySelectorAll("button").forEach(function (btn) {
      var id = btn.dataset.mode;
      var cfg = CONFIG.mode(id);
      var amount = cfg.ECONOMY.fixedBuyin;
      btn.classList.toggle("on", id === MODEID);
      btn.querySelector(".hall-amount").textContent = money(amount);
      btn.classList.toggle("poor", state.modes[id].wallet < amount);
    });
  }

  /* 真正换厅：两个厅的钱包 / 彩金池 / 下注档完全独立，本局必须已经结清 */
  function switchHall(id) {
    applyMode(id);
    audio.gong({ vol: 0.3, dur: 2.2 });
    fx.flash(0.38, "radial-gradient(ellipse at center, rgba(255,230,170,.8), transparent 72%)");
    logEvent("移步 <b>" + MODE.name + "</b>", "gold");
  }
  function buyIn(amount) {
    if (MS.wallet < amount) { audio.ui("deny"); toast("金库余额不足"); return; }
    audio.unlock();
    MS.wallet -= amount;
    session = amount;
    displayedSession = amount;
    autoRemaining = 0;
    startRun(amount);
    el.buyinModal.classList.remove("show");
    audio.gong({ vol: 0.34, dur: 2.6 });
    audio.coinShower(700, 14);
    fx.burst(70, { y: window.innerHeight * 0.5, speed: 460, size: 9 });
    logEvent("入座，带入 <b>" + money(amount) + "</b>");
    el.resultLine.textContent = "按「旋转」开始";
    el.resultLine.className = "result-line";
    save();
    updateUI();
  }
  function collect() {
    if (phase !== "idle" || session <= 0) { audio.ui("deny"); return; }
    if (engine.mode === "free") { toast("免费游戏结束后才能收手"); return; }
    endRun("collect");
  }

  function minBet() { return MODE.ECONOMY.bets[0]; }

  /* 一局结束（收手 / 输光）：钱回金库，正常模式结算排行榜。 */
  async function endRun(reason, nextMode) {
    var amount = Math.max(0, Math.round(session));
    var buyin = run ? run.buyin : MODE.ECONOMY.fixedBuyin;
    MS.wallet += amount;
    session = 0;
    displayedSession = 0;
    autoRemaining = 0;
    var rank = recordRun(amount);
    save();
    renderBoard();
    updateUI();

    if (reason === "collect") {
      audio.bell(window.ASTER_AUDIO.note(4, 5), { dur: 0.9, vol: 0.28 });
      audio.coinShower(900, 18);
      fx.burst(90, { y: window.innerHeight * 0.72, speed: 420, size: 9 });
      logEvent("收手，带走 <b>" + money(amount) + "</b>", "gold");
    } else {
      audio.ui("deny");
      logEvent("本局筹码用尽", "warn");
    }

    if (rank === 0) {
      unlock("record");
      audio.impact(3);
      audio.coinShower(2400, 30);
      fx.impact(3, { colors: window.ASTER_FX.FESTIVE });
      fx.coinStorm(3000, 80);
      showFeature("新 纪 录", "带入 " + money(buyin) + " · 带走", money(amount), "gold");
      logEvent("<b>刷新最高纪录：" + money(amount) + "</b>", "gold");
      await wait(2600);
      hideFeature();
    } else if (rank > 0) {
      toast("进入排行榜第 " + (rank + 1) + " 名 · " + money(amount));
    } else if (reason === "collect") {
      toast("已收回 " + money(amount) + " 到金库");
    } else {
      toast("筹码用尽，再来一局");
    }
    if (nextMode && nextMode !== MODEID) switchHall(nextMode);
    openBuyin();
  }

  /* ---------------- 事件绑定 ---------------- */
  function pressFeedback(node) {
    node.classList.remove("pressed");
    void node.offsetWidth;
    node.classList.add("pressed");
    setTimeout(function () { node.classList.remove("pressed"); }, 260);
  }

  /* 旋转键在三种语境下都是它：普通旋转、手动免费旋转、聚宝盆重转 */
  function pressSpin() {
    if (pressResolver) { pressFeedback(el.spinBtn); pressResolver(); return; }
    if (phase === "idle") { pressFeedback(el.spinBtn); spin(); }
  }

  function bind() {
    document.querySelectorAll("button").forEach(function (btn) {
      btn.addEventListener("pointerdown", function () {
        if (btn.disabled) return;
        audio.unlock();
        pressFeedback(btn);
        if (!btn.dataset.silent) audio.ui("click");
      });
      btn.addEventListener("pointerenter", function () {
        if (!btn.disabled) audio.ui("hover");
      });
    });

    el.spinBtn.addEventListener("click", pressSpin);
    el.collectBtn.addEventListener("click", collect);
    el.betDown.addEventListener("click", function () { stepBet(-1); });
    el.betUp.addEventListener("click", function () { stepBet(1); });

    el.turboBtn.addEventListener("click", function () {
      state.turbo = !state.turbo;
      save(); updateUI();
    });

    el.autoBtn.addEventListener("click", function () {
      if (autoRemaining > 0) { autoRemaining = 0; updateUI(); toast("自动旋转已停止"); return; }
      autoRemaining = Number(el.autoSelect.value);
      updateUI();
      toast("自动旋转 " + autoRemaining + " 次");
      if (phase === "idle") spin();
    });

    el.soundBtn.addEventListener("click", function () {
      state.soundOn = !state.soundOn;
      audio.setSfx(state.soundOn);
      save(); updateUI();
    });
    el.musicBtn.addEventListener("click", function () {
      state.musicOn = !state.musicOn;
      audio.unlock();
      audio.setMusic(state.musicOn);
      save(); updateUI();
    });

    el.paytableBtn.addEventListener("click", function () { el.paytableModal.classList.add("show"); });
    el.settingsBtn.addEventListener("click", function () { el.settingsModal.classList.add("show"); });
    el.buyBtn.addEventListener("click", buyFeature);
    el.dailyBtn.addEventListener("click", function () { renderDaily(); el.dailyModal.classList.add("show"); });
    el.dailyModal.addEventListener("click", function (e) {
      if (e.target === el.dailyModal || e.target.closest("[data-close]")) closeDaily();
    });
    /* 版本号 + 一键清缓存。Service Worker 出问题的时候，
     * 让玩家自己按一下比教他开 DevTools 现实得多。 */
    el.buildStamp.textContent = CONFIG.BUILD;
    el.forceUpdate.addEventListener("click", async function () {
      el.forceUpdate.textContent = "正在更新…";
      try {
        if (window.caches) {
          var keys = await caches.keys();
          await Promise.all(keys.map(function (k) { return caches.delete(k); }));
        }
        if (navigator.serviceWorker) {
          var regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(function (r) { return r.unregister(); }));
        }
      } catch (err) { /* 隐私模式下可能没有这些 API，直接硬刷也能解决大半 */ }
      location.reload(true);
    });

    el.levelChip.addEventListener("click", function () {
      el.vipModal.classList.add("show");
      renderVip();
    });
    el.dailyClaim.addEventListener("click", claimDaily);
    document.querySelectorAll("[data-close]").forEach(function (btn) {
      btn.addEventListener("click", function () { $(btn.dataset.close).classList.remove("show"); });
    });
    document.querySelectorAll(".modal-backdrop").forEach(function (back) {
      back.addEventListener("click", function (e) {
        if (e.target === back && back.id !== "buyin-modal") back.classList.remove("show");
      });
    });

    el.buyinGo.addEventListener("click", function () { buyIn(MODE.ECONOMY.fixedBuyin); });
    el.hallPicker.querySelectorAll("button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.dataset.mode === MODEID) return;
        switchHall(btn.dataset.mode);
        openBuyin();
      });
    });
    el.modeSwitch.querySelectorAll("button").forEach(function (btn) {
      btn.addEventListener("click", function () { requestMode(btn.dataset.mode); });
    });
    el.topupBtn.addEventListener("click", function () {
      MS.wallet += MODE.ECONOMY.topUp;
      save(); updateUI();
      toast("已补充 " + money(MODE.ECONOMY.topUp));
    });

    el.optMotion.addEventListener("change", function () {
      state.reducedMotion = el.optMotion.checked;
      renderer.reducedMotion = state.reducedMotion;
      fx.reduced = state.reducedMotion;
      document.body.classList.toggle("reduced-motion", state.reducedMotion);
      save();
    });
    el.optQuickwin.addEventListener("change", function () {
      state.quickWin = el.optQuickwin.checked;
      save();
    });
    el.resetSave.addEventListener("click", function () {
      if (!window.confirm("重置全部虚拟金币、龙气与成就？")) return;
      localStorage.removeItem(SAVE_KEY);
      location.reload();
    });

    document.addEventListener("keydown", function (e) {
      if (e.code === "Escape") {
        document.querySelectorAll(".modal-backdrop.show").forEach(function (m) {
          if (m.id !== "buyin-modal") m.classList.remove("show");
        });
        return;
      }
      if (e.code !== "Space" || e.repeat) return;
      if (document.querySelector(".modal-backdrop.show")) return;
      e.preventDefault();
      if (pressResolver || phase === "idle") pressSpin();
      else skipRequested = true;
    });

    /* 演出过程中点画面即可快进（等待玩家按的环节除外） */
    el.stage.addEventListener("click", function () {
      if (!pressResolver && (phase === "presenting" || phase === "hold")) skipRequested = true;
    });

    var resizeTimer = null;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { renderer.resize(); }, 140);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { audio.stopSpinLoop(); audio.stopAnticipation(); }
    });

    /* 兜底：演出流程是一长串 await，任何一步抛异常都会让 Promise 静默挂起、
     * 游戏卡在非 idle 状态再也点不动。这里强制把状态收回来。 */
    window.addEventListener("unhandledrejection", function (e) {
      console.error("演出中断，已恢复可操作状态：", e.reason);
      phase = "idle";
      disarmSpinButton();
      hideFeature();
      hideBanner();
      el.holdHud.classList.remove("visible");
      if (renderer) { renderer.exitHold(); renderer.clearHighlight(); }
      audio.stopSpinLoop();
      audio.stopAnticipation();
      document.body.classList.remove("hold-mode");
      updateUI();
    });
  }

  function stepBet(dir) {
    var next = nextBet(dir);
    if (next === MS.bet) { audio.ui("deny"); return; }
    if (betLocked(next)) {
      audio.ui("deny");
      toast("下注 $" + next + " 需要 Lv." + META.level.betUnlock[next]);
      return;
    }
    MS.bet = next;
    save(); updateUI();
  }

  /* 下一档下注（不判断是否解锁，解锁在 stepBet / updateUI 里判） */
  function nextBet(dir) {
    var bets = MODE.ECONOMY.bets;
    var i = bets.indexOf(MS.bet);
    if (i < 0) i = 0;
    return bets[Math.min(bets.length - 1, Math.max(0, i + dir))];
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    renderer = new window.ASTER_RENDER.Renderer(el.reelCanvas);
    renderer.reducedMotion = state.reducedMotion;
    fx = new window.ASTER_FX.ScreenFX(el.fxCanvas, document.querySelector(".shell"));
    fx.reduced = state.reducedMotion;
    /* 画质档位由 fx 根据实测帧时间自动升降，盘面渲染跟着一起走 */
    renderer.quality = fx.tier;
    document.body.classList.toggle("low-fx", fx.tier === 0);
    fx.onTierChange = function (tier) {
      renderer.quality = tier;
      document.body.classList.toggle("low-fx", tier === 0);
    };
    el.optMotion.checked = state.reducedMotion;
    el.optQuickwin.checked = state.quickWin;
    document.body.classList.toggle("reduced-motion", state.reducedMotion);
    audio.setSfx(state.soundOn);
    audio.musicOn = state.musicOn;

    /* 模式（含钱包、彩金池、轮带、赔率表）在这里一次性装配好 */
    applyMode(state.mode || CONFIG.DEFAULT_MODE, { silent: true });

    renderAchievements();
    renderMissions();
    renderDaily();
    updateLevelUI();
    updateStreak(false);
    bind();
    updateUI();
    tickJackpot();

    window.__jinlong = {
      get engine() { return engine; },
      get renderer() { return renderer; },
      get fx() { return fx; },
      get state() { return state; },
      get phase() { return phase; },
      get session() { return session; },
      get awaitingPress() { return awaitingPress; },
      get modeId() { return MODEID; },
      press: pressSpin,
      spin: spin,
      buyIn: buyIn,
      applyMode: applyMode
    };

    window.addEventListener("load", function () { renderer.resize(); fx.resize(); }, { once: true });

    var params = new URLSearchParams(location.search);
    if (params.get("mode")) applyMode(params.get("mode"), { silent: true });
    var dev = params.get("dev");
    if (dev) {
      buyIn(MODE.ECONOMY.fixedBuyin);
      if (dev === "spin") {
        autoRemaining = 40;
        setTimeout(function () { updateUI(); spin(); }, 400);
      }
    } else if (dailyAvailable()) {
      /* 新的一天：先把签到推到玩家眼前，关掉之后再让他选买入 */
      pendingBuyinAfterDaily = true;
      renderDaily();
      el.dailyModal.classList.add("show");
    } else {
      openBuyin();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
