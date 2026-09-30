/* ------------------------------------------------------------------
 * 金龙聚宝 · 游戏主程序
 * 负责把引擎算出来的结果"演"出来：停轮节奏、神龙展开、钱币入账、
 * 分级大奖、免费游戏、聚宝盆，以及所有按钮的即时反馈。
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
    "reel-canvas", "stage", "result-line",
    "banner", "banner-title", "banner-amount", "banner-sub",
    "feature-card", "feature-title", "feature-sub", "feature-meta",
    "hold-hud", "hold-respins", "hold-total",
    "free-hud", "free-remaining", "free-multiplier", "free-total",
    "spin-btn", "spin-label", "bet-down", "bet-up", "auto-btn", "auto-label",
    "auto-select", "turbo-btn", "turbo-state", "collect-btn",
    "sound-btn", "music-btn", "settings-btn", "paytable-btn",
    "buyin-modal", "buyin-options", "buyin-wallet", "topup-btn",
    "paytable-modal", "paytable-body", "settings-modal",
    "opt-motion", "opt-quickwin", "reset-save",
    "log-list", "achievement-list", "achievement-count", "toast"
  ].forEach(function (id) { el[id.replace(/-(\w)/g, function (m, p) { return p.toUpperCase(); })] = $(id); });

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
    quickWin: false
  };

  var state = load();
  var session = 0;
  var phase = "idle";            // idle | spinning | presenting | hold | free
  var autoRemaining = 0;
  var skipRequested = false;
  var toastTimer = null;
  var displayedSession = 0;

  var audio = new window.ASTER_AUDIO.AudioEngine();
  var engine = new ENGINE.SlotEngine();
  var renderer = null;

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
        quickWin: state.quickWin
      }));
    } catch (err) { /* 隐私模式下写不进去，不影响游戏 */ }
  }

  /* ---------------- 小工具 ---------------- */
  var nf = new Intl.NumberFormat("zh-CN");
  function fmt(v) { return nf.format(Math.max(0, Math.round(v || 0))); }
  function wait(ms) {
    if (state.reducedMotion) ms = Math.min(ms, 120);
    if (state.turbo) ms *= 0.45;
    return new Promise(function (resolve) {
      var done = false;
      var finish = function () { if (!done) { done = true; clearInterval(poll); resolve(); } };
      var timer = setTimeout(finish, ms);
      var poll = setInterval(function () {
        if (skipRequested) { clearTimeout(timer); finish(); }
      }, 32);
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
    if (item) toast("成就达成 · " + item.title);
    save();
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
      { key: "S", title: "金锣 · 免费游戏", body: "任意位置 <b>3/4/5 个</b> → 分别赔 2× / 10× / 50×，并开启 <b>8 / 12 / 18</b> 次免费旋转。" },
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
      '<h3>免费游戏 · 龙门</h3><p class="pay-note">起始 <b>2×</b> 倍率，每有一次中奖旋转 <b>+1×</b>（最高 5×）。期间再出 3 个金锣可 <b>+5 次</b>。</p>' +
      '<h3>聚宝盆 · 龙气充满时自动开启</h3><p class="pay-note">盘面清空，落下的钱币<b>锁定</b>并带有面值；初始 3 次重转，每次落新币重置为 3 次。' +
      "填满 15 格额外奖励 <b>200×</b>。</p>" +
      '<p class="pay-note muted">单次旋转封顶 ' + F.maxWinPerSpin + '× 下注。全部为虚拟金币，不涉及任何真实货币。</p>';

    /* 赔率表里的图标也用同一支画笔画，保证和盘面一致 */
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
    el.wallet.textContent = fmt(state.wallet);
    el.buyinWallet.textContent = fmt(state.wallet);
    el.session.textContent = session > 0 ? fmt(displayedSession) : "—";
    el.betValue.textContent = fmt(state.bet);
    el.spinCount.textContent = fmt(state.spinCount);

    var free = engine.mode === "free";
    el.freeHud.classList.toggle("visible", free);
    if (free) {
      el.freeRemaining.textContent = engine.freeSpins;
      el.freeMultiplier.textContent = engine.freeMultiplier + "×";
      el.freeTotal.textContent = fmt(engine.freeWon);
    }
    el.modeLabel.textContent = free ? "龙门免费游戏"
      : phase === "hold" ? "聚宝盆"
        : phase === "spinning" ? "转动中…"
          : session > 0 ? "基础游戏" : "等待入座";

    var busy = phase !== "idle";
    el.spinBtn.disabled = busy || session <= 0;
    el.spinLabel.textContent = free ? "自动进行" : "旋 转";
    el.betDown.disabled = busy || free;
    el.betUp.disabled = busy || free;
    el.collectBtn.disabled = busy || session <= 0 || free;
    el.autoBtn.disabled = session <= 0 || free;
    el.autoBtn.classList.toggle("on", autoRemaining > 0);
    el.autoLabel.textContent = autoRemaining > 0 ? autoRemaining + " 次" : "自动";
    el.turboBtn.classList.toggle("on", state.turbo);
    el.turboState.textContent = state.turbo ? "开" : "关";
    el.soundBtn.classList.toggle("off", !state.soundOn);
    el.musicBtn.classList.toggle("off", !state.musicOn);

    document.querySelectorAll("#buyin-options button").forEach(function (b) {
      b.disabled = state.wallet < Number(b.dataset.amount);
    });
    updateCharge(false);
  }

  /* 余额数字滚动，比直接跳数好看，也给了大奖一个"变多"的过程 */
  function countSession(target, duration) {
    var from = displayedSession;
    var delta = target - from;
    if (Math.abs(delta) < 1 || state.reducedMotion) {
      displayedSession = target;
      el.session.textContent = fmt(target);
      return Promise.resolve();
    }
    var start = performance.now();
    var lastTick = 0;
    return new Promise(function (resolve) {
      function step(now) {
        var t = Math.min(1, (now - start) / duration);
        var eased = 1 - Math.pow(1 - t, 2.2);
        displayedSession = from + delta * eased;
        el.session.textContent = fmt(displayedSession);
        if (now - lastTick > 70) { lastTick = now; audio.countTick(t); }
        if (t < 1 && !skipRequested) requestAnimationFrame(step);
        else { displayedSession = target; el.session.textContent = fmt(target); resolve(); }
      }
      requestAnimationFrame(step);
    });
  }

  /* ---------------- 横幅 / 特写 ---------------- */
  function showBanner(tier, amount, sub) {
    hideFeature();                 // 两块特写不能叠在一起
    el.bannerTitle.textContent = tier.label;
    el.bannerAmount.textContent = "+" + fmt(amount);
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

  function computeAnticipation(grid) {
    /* 在停轮之前就知道结果，所以"期待"只出现在真的还有机会的时候 ——
     * 不制造假的擦边球。 */
    var out = {};
    var scatters = 0, dragons = 0;
    for (var c = 0; c < CONFIG.REELS; c++) {
      if (c >= 2 && scatters >= 2) out[c] = Math.min(2, scatters - 1);
      if (c === 3 && dragons >= 2) out[c] = Math.max(out[c] || 0, 2);
      var hasDragon = false;
      for (var r = 0; r < CONFIG.ROWS; r++) {
        if (grid[c][r] === "S") scatters++;
        if (grid[c][r] === "W") hasDragon = true;
      }
      if (hasDragon) dragons++;
    }
    return out;
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
    }
    updateUI();

    renderer.setStrips(free ? CONFIG.STRIPS.free : CONFIG.STRIPS.base);
    var outcome = engine.play(state.bet);
    var anticipate = computeAnticipation(outcome.grid);

    audio.startSpinLoop();
    var antStarted = false;
    renderer.onReelStop = function (index, hot) {
      audio.reelStop(index, hot);
      if (antStarted) { audio.stopAnticipation(); antStarted = false; }
      renderer.anticipation[index] = 0;
      var nextLevel = anticipate[index + 1];
      if (nextLevel) {
        /* 前一轴刚停，下一轴才开始"吊着" —— 视觉和声音同时进入期待状态 */
        renderer.anticipation[index + 1] = nextLevel;
        audio.startAnticipation(nextLevel);
        antStarted = true;
      }
    };

    await renderer.spin({ stops: outcome.stops, turbo: state.turbo, anticipate: anticipate });
    audio.stopSpinLoop();
    if (antStarted) audio.stopAnticipation();
    renderer.anticipation = {};

    phase = "presenting";
    await present(outcome);

    session += outcome.totalWin;
    displayedSession = session;
    if (outcome.totalWin > state.bestWin) state.bestWin = outcome.totalWin;
    save();

    phase = "idle";
    updateUI();
    await chainNext(outcome);
  }

  async function chainNext(outcome) {
    if (engine.mode === "free" && engine.freeSpins > 0) {
      await wait(state.turbo ? 220 : 520);
      if (phase === "idle") spin();
      return;
    }
    if (outcome.free.ended) {
      var won = outcome.free.won;
      showFeature("龙门已闭", "本次免费游戏共赢得", fmt(won) + " 金币", "gold");
      audio.gong({ vol: 0.3 });
      logEvent("免费游戏结束，合计 <b>" + fmt(won) + "</b>", "gold");
      await wait(1900);
      hideFeature();
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
      if (phase === "idle" && autoRemaining > 0) spin();
    }
  }

  async function present(outcome) {
    var bet = outcome.bet;

    /* 1. 神龙整轴展开 */
    if (outcome.wildReels.length) {
      audio.dragon();
      renderer.flash(0.5);
      renderer.shake(outcome.wildReels.length * 5);
      await renderer.expandWilds(outcome.wildReels);
      unlock("dragon");
      await wait(220);
    }

    /* 2. 特殊组合播报 */
    if (outcome.combos.indexOf("tripleDragon") >= 0) {
      unlock("triple");
      showFeature("三 龙 聚 顶", "龙气直接充满", "本次旋转 3× 加成", "dragon");
      renderer.burst(90, { speed: 420, size: 8 });
      renderer.shake(16);
      logEvent("<b>三龙聚顶</b>　龙气瞬间充满", "gold");
      await wait(1500);
      hideFeature();
      await wait(240);            // 让特写淡出完再进下一段演出
    } else if (outcome.combos.indexOf("twinDragon") >= 0) {
      unlock("twin");
      showFeature("双 龙 戏 珠", "本次旋转 2× 加成", "龙气大幅上涨", "dragon");
      renderer.burst(55, { speed: 340, size: 7 });
      renderer.shake(10);
      logEvent("<b>双龙戏珠</b>　2× 加成", "gold");
      await wait(1150);
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
        renderer.burst(10, { x: p.x, y: p.y, speed: 160, size: 5, lift: 60 });
        await wait(110);
      }
      updateCharge(true);
      audio.chargeTick(Math.min(1, engine.charge / F.charge.max));
      if (outcome.combos.indexOf("coinRush") >= 0) {
        toast("满堂金 · 龙气额外上涨");
        logEvent("满堂金：" + outcome.coinCount + " 枚招财钱币");
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
          audio.pluck(window.ASTER_AUDIO.note(k + 1, 4), { dur: 0.5, vol: 0.18 });
          await wait(520);
        }
        renderer.setHighlight(all, true);
      }
    }

    /* 5. 结算文案与奖级 */
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
      if (tier.threshold >= 10) {
        /* 达到"大奖"级别才做特写，小额回收不做庆祝 */
        showBanner(tier, spinWin, lines.join("　"));
        renderer.burst(tier.threshold >= 50 ? 120 : 60, { speed: 380, size: 8 });
        renderer.shake(tier.threshold >= 50 ? 18 : 10);
        renderer.flash(0.4);
        if (tier.threshold >= 25) renderer.coinRain(50);
        await countSession(session + spinWin, Math.min(tier.hold * 0.55, 2400));
        await wait(tier.hold * 0.45);
        hideBanner();
        logEvent(tier.label + "　<b>+" + fmt(spinWin) + "</b>　" + lines.join(" "), "gold");
      } else {
        await countSession(session + spinWin, spinWin >= bet ? 620 : 320);
        el.resultLine.textContent = "+" + fmt(spinWin) + "　" + lines.join("　");
        el.resultLine.className = "result-line" + (spinWin < bet ? " muted" : " win");
        if (spinWin >= bet) logEvent("赢得 <b>" + fmt(spinWin) + "</b>　" + lines.join(" "));
      }
      if (spinWin / bet >= 100) unlock("hundred");
    } else {
      el.resultLine.textContent = engine.mode === "free" ? "本轮未中" : "未中奖";
      el.resultLine.className = "result-line muted";
      await wait(state.turbo ? 80 : 200);
    }
    displayedSession = session + spinWin;

    /* 6. 聚宝盆 */
    if (outcome.hold) {
      await runHold(outcome);
    }

    /* 7. 免费游戏开启 */
    if (outcome.free.triggered) {
      unlock("free");
      audio.freeSpinsStart();
      renderer.clearHighlight();
      showFeature("龙 门 大 开", outcome.free.triggered + " 次免费旋转", "起始 " + F.freeSpins.startMultiplier + "× · 每次中奖再 +1×", "gong");
      renderer.burst(100, { speed: 400, size: 8, colors: ["#ffd76a", "#ff6f5e", "#fff2c8"] });
      renderer.shake(14);
      logEvent("<b>龙门大开</b>　" + outcome.free.triggered + " 次免费旋转（" + outcome.effectiveScatters + " 个金锣）", "gold");
      await wait(2100);
      hideFeature();
      audio.setIntensity(1);
      document.body.classList.add("free-mode");
    } else if (outcome.free.retriggered) {
      toast("金锣再鸣 · 免费旋转 +" + outcome.free.retriggered);
      audio.gong({ vol: 0.3 });
      logEvent("免费旋转 +" + outcome.free.retriggered);
    }
    if (outcome.free.ended) {
      audio.setIntensity(0);
      document.body.classList.remove("free-mode");
    }

    if (outcome.capped) toast("触及单次封顶 " + F.maxWinPerSpin + "×");
    renderer.clearHighlight();
    updateCharge(false);
  }

  /* ---------------- 聚宝盆 ---------------- */
  async function runHold(outcome) {
    var hold = outcome.hold;
    var size = CONFIG.REELS * CONFIG.ROWS;
    phase = "hold";
    unlock("hold");
    updateUI();

    audio.holdStart();
    audio.setIntensity(1);
    document.body.classList.add("hold-mode");
    showFeature("聚 宝 盆", "龙气充盈，钱币锁定", "落新币即重置重转次数", "gold");
    renderer.shake(12);
    renderer.flash(0.6);
    await wait(1700);
    hideFeature();

    var board = new Array(size).fill(0);
    renderer.enterHold(board);
    el.holdHud.classList.add("visible");
    var running = 0;

    for (var i = 0; i < hold.seeded.length; i++) {
      renderer.holdLand(hold.seeded[i].index, hold.seeded[i].value);
      audio.holdLock(i);
      running += hold.seeded[i].value * outcome.bet;
      el.holdTotal.textContent = fmt(running);
      await wait(200);
    }
    el.holdRespins.textContent = F.holdSpin.respins;

    for (var round = 0; round < hold.rounds.length; round++) {
      var step = hold.rounds[round];
      renderer.holdSpinning(true);
      audio.startSpinLoop();
      await wait(620);
      renderer.holdSpinning(false);
      audio.stopSpinLoop();

      for (var k = 0; k < step.landed.length; k++) {
        renderer.holdLand(step.landed[k].index, step.landed[k].value);
        audio.holdLock(k);
        running += step.landed[k].value * outcome.bet;
        el.holdTotal.textContent = fmt(running);
        await wait(260);
      }
      el.holdRespins.textContent = step.respinsLeft;
      if (step.landed.length) {
        el.holdHud.classList.remove("reset");
        void el.holdHud.offsetWidth;
        el.holdHud.classList.add("reset");
      }
      await wait(step.landed.length ? 320 : 180);
    }

    if (hold.grand) {
      unlock("grand");
      audio.grand();
      showFeature("大 满 贯", "十五格全满", "额外 " + F.holdSpin.grandPay + "× 下注", "grand");
      renderer.coinRain(140);
      renderer.shake(24);
      renderer.flash(0.85);
      await wait(2600);
      hideFeature();
    }

    await wait(450);
    el.holdHud.classList.remove("visible");
    renderer.exitHold();
    document.body.classList.remove("hold-mode");
    if (engine.mode !== "free") audio.setIntensity(0);

    var tier = ENGINE.winTier(hold.total, outcome.bet);
    showBanner(tier, hold.total, "聚宝盆 · " + hold.filled + " 枚钱币" + (hold.grand ? " · 大满贯" : ""));
    audio.win(tier.id);
    renderer.coinRain(60);
    await countSession(session + outcome.spinWin + hold.total, 1600);
    await wait(1100);
    hideBanner();
    logEvent("<b>聚宝盆</b>　" + hold.filled + " 枚 → <b>+" + fmt(hold.total) + "</b>" + (hold.grand ? "（大满贯）" : ""), "gold");
    updateCharge(true);
    phase = "presenting";
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
    audio.gong({ vol: 0.28, dur: 2.4 });
    logEvent("入座，带入 <b>" + fmt(amount) + "</b> 金币");
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
    audio.bell(window.ASTER_AUDIO.note(4, 5), { dur: 0.8, vol: 0.24 });
    logEvent("收手，带走 <b>" + fmt(amount) + "</b> 金币", "gold");
    toast("已收回 " + fmt(amount) + " 到金库");
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

    el.spinBtn.addEventListener("click", function () {
      if (phase === "idle") spin();
    });
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
      toast("已补充 " + fmt(CONFIG.ECONOMY.topUp) + " 虚拟金币");
    });

    el.optMotion.addEventListener("change", function () {
      state.reducedMotion = el.optMotion.checked;
      renderer.reducedMotion = state.reducedMotion;
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
      if (phase === "idle") { pressFeedback(el.spinBtn); spin(); }
      else skipRequested = true;
    });

    /* 演出过程中点画面即可快进 */
    el.stage.addEventListener("click", function () {
      if (phase === "presenting" || phase === "hold") skipRequested = true;
    });

    var resizeTimer = null;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { renderer.resize(); }, 140);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { audio.stopSpinLoop(); audio.stopAnticipation(); }
    });
  }

  function stepBet(dir) {
    var bets = CONFIG.ECONOMY.bets;
    var i = bets.indexOf(state.bet);
    if (i < 0) i = 0;
    var next = Math.min(bets.length - 1, Math.max(0, i + dir));
    if (next === i) { audio.ui("deny"); return; }
    state.bet = bets[next];
    save(); updateUI();
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    renderer = new window.ASTER_RENDER.Renderer(el.reelCanvas);
    renderer.reducedMotion = state.reducedMotion;
    engine.charge = Math.min(F.charge.max - 1, state.charge || 0);

    /* 开局摆一个不中奖的盘面，别一进来就像刚中了什么 */
    var stops = [4, 17, 31, 46, 9];
    renderer.setStops(stops);

    el.optMotion.checked = state.reducedMotion;
    el.optQuickwin.checked = state.quickWin;
    document.body.classList.toggle("reduced-motion", state.reducedMotion);
    audio.setSfx(state.soundOn);
    audio.musicOn = state.musicOn;

    el.buyinOptions.innerHTML = CONFIG.ECONOMY.buyins.map(function (b) {
      return '<button data-amount="' + b.amount + '"><b>' + fmt(b.amount) + "</b><span>" + b.title + "</span><small>" + b.note + "</small></button>";
    }).join("");

    renderPaytable();
    renderAchievements();
    bind();
    updateUI();

    /* 调试出口：tools/drive.py 的端到端检查靠它观察内部状态。
     * 纯前端虚拟币游戏，暴露这些不会带来额外风险。 */
    window.__jinlong = {
      get engine() { return engine; },
      get renderer() { return renderer; },
      get state() { return state; },
      get phase() { return phase; },
      get session() { return session; },
      spin: spin,
      buyIn: buyIn
    };

    /* 字体加载完成后布局可能变，重新量一次画布 */
    window.addEventListener("load", function () { renderer.resize(); }, { once: true });

    /* 开发与截图用：?dev=buyin 自动入座，?dev=spin 再自动转。
     * 只影响开局动作，不改变任何数值逻辑。 */
    var dev = new URLSearchParams(location.search).get("dev");
    if (dev) {
      buyIn(CONFIG.ECONOMY.buyins[1].amount);
      if (dev === "spin") {
        autoRemaining = 40;
        setTimeout(function () { updateUI(); spin(); }, 400);
      }
    } else {
      openBuyin();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
