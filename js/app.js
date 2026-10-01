/* ------------------------------------------------------------------
 * 金龙聚宝 · 游戏主程序
 * 负责把引擎算出来的结果"演"出来：停轮节奏、擦边球、神龙展开、钱币入账、
 * 分级大奖、手动免费游戏、手动聚宝盆，以及所有按钮的即时反馈。
 * ------------------------------------------------------------------ */
(function () {
  "use strict";

  var CONFIG = window.ASTER_CONFIG;
  var ENGINE = window.ASTER_ENGINE;
  var F = CONFIG.FEATURES;
  var SAVE_KEY = "jinlong-slot-v1";

  var ACHIEVEMENTS = [
    { id: "first", icon: "初", title: "初鸣", desc: "完成第一次旋转" },
    { id: "dragon", icon: "龙", title: "龙抬头", desc: "让神龙整轴展开一次" },
    { id: "free", icon: "门", title: "龙门大开", desc: "触发一次免费游戏" },
    { id: "hold", icon: "盆", title: "聚宝成盆", desc: "触发一次聚宝盆" },
    { id: "twin", icon: "双", title: "双龙戏珠", desc: "两条神龙同时现身" },
    { id: "triple", icon: "三", title: "三龙聚顶", desc: "三条神龙同时现身" },
    { id: "grand", icon: "满", title: "大满贯", desc: "聚宝盆填满十五格" },
    { id: "hundred", icon: "百", title: "一本万利", desc: "单次旋转赢得 100 倍下注" }
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
    "buyin-modal", "buyin-options", "buyin-wallet", "topup-btn",
    "paytable-modal", "paytable-body", "settings-modal",
    "opt-motion", "opt-quickwin", "reset-save",
    "log-list", "achievement-list", "achievement-count", "toast"
  ].forEach(function (id) { el[id.replace(/-(\w)/g, function (m, p) { return p.toUpperCase(); })] = $(id); });

  var META = CONFIG.META;

  var defaults = {
    wallet: CONFIG.ECONOMY.startingWallet,
    bet: CONFIG.ECONOMY.defaultBet,
    charge: 0,
    spinCount: 0,
    bestWin: 0,
    achievements: {},
    soundOn: true,
    musicOn: true,
    turbo: false,
    reducedMotion: false,
    quickWin: false,
    /* 局外成长 */
    level: 1,
    xp: 0,
    missions: null,
    missionsDone: 0,
    lastDaily: "",
    dailyStreak: 0,
    bestStreak: 0,
    jackpotPot: null,
    jackpotReserve: 0
  };

  var state = load();
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
    try {
      var raw = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
      return Object.assign({}, defaults, raw || {});
    } catch (err) {
      return Object.assign({}, defaults);
    }
  }
  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        wallet: Math.max(0, Math.round(state.wallet)),
        bet: state.bet,
        charge: engine.charge,
        spinCount: state.spinCount,
        bestWin: state.bestWin,
        achievements: state.achievements,
        soundOn: state.soundOn,
        musicOn: state.musicOn,
        turbo: state.turbo,
        reducedMotion: state.reducedMotion,
        quickWin: state.quickWin,
        level: state.level,
        xp: state.xp,
        missions: state.missions,
        missionsDone: state.missionsDone,
        lastDaily: state.lastDaily,
        dailyStreak: state.dailyStreak,
        bestStreak: state.bestStreak,
        jackpotPot: engine.jackpot,
        jackpotReserve: engine.jackpotReserve
      }));
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
    }
    updateLevelUI();
    return gained;
  }

  async function celebrateLevelUp(levels) {
    var reward = 0;
    for (var i = 0; i < levels; i++) reward += META.level.reward(state.level - i);
    state.wallet += reward;
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
      state.wallet += m.coin;
      state.missionsDone++;
      var levels = addXp(m.xp);
      audio.impact(2);
      fx.burst(70, { y: window.innerHeight * 0.4, speed: 420, size: 8 });
      fx.flash(0.3);
      toast("任务完成 · " + m.label + "　+" + money(m.coin));
      logEvent("任务完成：" + m.label + "　<b>+" + money(m.coin) + "</b>", "gold");
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

  function renderMissions() {
    ensureMissions();
    el.missionList.innerHTML = state.missions.map(function (m) {
      var pctDone = Math.min(100, (m.progress / m.target) * 100);
      return '<div class="mission">' +
        '<div class="mission-top"><span>' + m.label + '</span><b>+' + money(m.coin) + "</b></div>" +
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
    el.dailyGrid.innerHTML = META.daily.rewards.map(function (r, i) {
      var cls = i < next ? "done" : i === next ? "next" : "";
      return '<div class="daily-cell ' + cls + '"><span>第 ' + (i + 1) + ' 天</span><b>' + money(r) + "</b></div>";
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
    var reward = META.daily.rewards[index];
    state.wallet += reward;
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
    var rows = CONFIG.PAYING.slice().reverse().map(function (key) {
      var s = CONFIG.SYMBOLS[key];
      var p = CONFIG.PAYS[key];
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
    el.wallet.textContent = money(state.wallet);
    el.buyinWallet.textContent = money(state.wallet);
    el.session.textContent = session > 0 ? money(displayedSession) : "—";
    el.betValue.textContent = money(state.bet);
    el.spinCount.textContent = fmt(state.spinCount);

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

    var price = state.bet * F.buyFeature.price;
    el.buyPrice.textContent = money(price);
    el.buyBtn.disabled = busy || free || session < price;
    el.buyBtn.classList.toggle("armed", buyArmed > Date.now());

    document.querySelectorAll("#buyin-options button").forEach(function (b) {
      b.disabled = state.wallet < Number(b.dataset.amount);
    });
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
      if (session < state.bet) { audio.ui("deny"); toast("本局余额不足，请收手或调低下注"); return; }
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
      session -= state.bet;
      displayedSession = session;
      state.spinCount++;
      unlock("first");
      /* 经验按下注额给：押得大升得快 */
      var levels = addXp(state.bet);
      bumpMission("spins", 1);
      bumpMission("wager", state.bet);
      if (levels) { state.__pendingLevels = (state.__pendingLevels || 0) + levels; }
    }
    updateUI();

    renderer.setStrips(free ? CONFIG.STRIPS.free : CONFIG.STRIPS.base);
    var outcome = engine.play(state.bet);
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
    if (outcome.totalWin > state.bestWin) state.bestWin = outcome.totalWin;

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
      if (session < state.bet) {
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
      var tier = ENGINE.winTier(spinWin, bet);
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
      var jTier = ENGINE.winTier(outcome.jackpot.win, bet);
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
      renderer.holdLand(hold.seeded[i].index, hold.seeded[i].value);
      audio.holdLock(i);
      running += hold.seeded[i].value * outcome.bet;
      el.holdTotal.textContent = money(running);
      flashHoldCell(hold.seeded[i].index, 1);
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
          renderer.holdLand(step.landed[k].index, step.landed[k].value);
          audio.holdLock(k);
          running += step.landed[k].value * outcome.bet;
          el.holdTotal.textContent = money(running);
          flashHoldCell(step.landed[k].index, step.landed[k].value);
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
    var tier = ENGINE.winTier(hold.total, outcome.bet);

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

  /* 聚宝盆落币时在屏幕坐标上也炸一下，面值越大越夸张 */
  function flashHoldCell(index, value) {
    var c = Math.floor(index / CONFIG.ROWS), r = index % CONFIG.ROWS;
    var p = renderer.cellCenter(c, r);
    var rect = el.stage.getBoundingClientRect();
    var big = value >= 5;
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
    var price = state.bet * F.buyFeature.price;
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
    updateUI();
    el.buyinModal.classList.add("show");
  }
  function buyIn(amount) {
    if (state.wallet < amount) { audio.ui("deny"); toast("金库余额不足"); return; }
    audio.unlock();
    state.wallet -= amount;
    session = amount;
    displayedSession = amount;
    autoRemaining = 0;
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
    var amount = Math.round(session);
    state.wallet += amount;
    session = 0;
    displayedSession = 0;
    autoRemaining = 0;
    audio.bell(window.ASTER_AUDIO.note(4, 5), { dur: 0.9, vol: 0.28 });
    audio.coinShower(900, 18);
    fx.burst(90, { y: window.innerHeight * 0.72, speed: 420, size: 9 });
    logEvent("收手，带走 <b>" + money(amount) + "</b>", "gold");
    toast("已收回 " + money(amount) + " 到金库");
    save();
    updateUI();
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
    el.levelChip.addEventListener("click", function () { toast("Lv." + state.level + " · 每次旋转按下注额获得经验"); });
    el.dailyClaim.addEventListener("click", claimDaily);
    document.querySelectorAll("[data-close]").forEach(function (btn) {
      btn.addEventListener("click", function () { $(btn.dataset.close).classList.remove("show"); });
    });
    document.querySelectorAll(".modal-backdrop").forEach(function (back) {
      back.addEventListener("click", function (e) {
        if (e.target === back && back.id !== "buyin-modal") back.classList.remove("show");
      });
    });

    el.buyinOptions.querySelectorAll("button").forEach(function (btn) {
      btn.addEventListener("click", function () { buyIn(Number(btn.dataset.amount)); });
    });
    el.topupBtn.addEventListener("click", function () {
      state.wallet += CONFIG.ECONOMY.topUp;
      save(); updateUI();
      toast("已补充 " + money(CONFIG.ECONOMY.topUp));
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
    if (next === state.bet) { audio.ui("deny"); return; }
    if (betLocked(next)) {
      audio.ui("deny");
      toast("下注 $" + next + " 需要 Lv." + META.level.betUnlock[next]);
      return;
    }
    state.bet = next;
    save(); updateUI();
  }

  /* 下一档下注（不判断是否解锁，解锁在 stepBet / updateUI 里判） */
  function nextBet(dir) {
    var bets = CONFIG.ECONOMY.bets;
    var i = bets.indexOf(state.bet);
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
    engine.charge = Math.min(F.charge.max - 1, state.charge || 0);
    /* 彩金池和储备跨会话延续，玩家离开时攒的钱不会白攒 */
    if (typeof state.jackpotPot === "number") engine.jackpot = state.jackpotPot;
    engine.jackpotReserve = state.jackpotReserve || 0;
    displayedJackpot = engine.jackpot;

    /* 开局摆一个不中奖的盘面，别一进来就像刚中了什么 */
    renderer.setStops([4, 17, 31, 46, 9]);

    el.optMotion.checked = state.reducedMotion;
    el.optQuickwin.checked = state.quickWin;
    document.body.classList.toggle("reduced-motion", state.reducedMotion);
    audio.setSfx(state.soundOn);
    audio.musicOn = state.musicOn;

    el.topupBtn.textContent = "领取 " + money(CONFIG.ECONOMY.topUp) + " 虚拟金币";
    el.buyinOptions.innerHTML = CONFIG.ECONOMY.buyins.map(function (b) {
      return '<button data-amount="' + b.amount + '"><b>' + money(b.amount) + "</b><span>" + b.title + "</span><small>" + b.note + "</small></button>";
    }).join("");

    renderPaytable();
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
      press: pressSpin,
      spin: spin,
      buyIn: buyIn
    };

    window.addEventListener("load", function () { renderer.resize(); fx.resize(); }, { once: true });

    var dev = new URLSearchParams(location.search).get("dev");
    if (dev) {
      buyIn(CONFIG.ECONOMY.buyins[1].amount);
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
