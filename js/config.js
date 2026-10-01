/* ------------------------------------------------------------------
 * 金龙聚宝 · 配置（单一数值来源）
 * 游戏本体和 tools/sim.html 蒙特卡洛验证共用这一份。
 * 改动任何权重后，请重新跑 tools/sim.html 确认 RTP / 命中率。
 *
 * 两个模式各自是一份完整数值：
 *   normal —— 正常模式，RTP 96%，固定带入，有排行榜，数值严格配平过
 *   party  —— 娱乐模式，RTP 远超 100%，纯粹为了爽，赔率不是设计目标
 * 共享的只有美术（图标）、轮带生成算法和局外成长系统。
 * ------------------------------------------------------------------ */
(function (root) {
  "use strict";

  var REELS = 5;
  var ROWS = 3;

  /* 图标定义。tier 只用于展示分组；shape 决定 render.js 里用哪支画笔。 */
  var SYMBOLS = {
    CN: { name: "铜钱", tier: "low", shape: "coin", color: "#5ac8a0", accent: "#d6fff0", rim: "#1d7f62" },
    FU: { name: "福字", tier: "low", shape: "fu", color: "#ef4a55", accent: "#ffd7c8", rim: "#8e1620" },
    LT: { name: "宫灯", tier: "low", shape: "lantern", color: "#ff9a2f", accent: "#ffe7bd", rim: "#9c4a06" },
    JD: { name: "玉葫芦", tier: "mid", shape: "gourd", color: "#4fc3f7", accent: "#e2f9ff", rim: "#12667f" },
    KO: { name: "锦鲤", tier: "mid", shape: "koi", color: "#b884ff", accent: "#f0e4ff", rim: "#5a2a9c" },
    YB: { name: "元宝", tier: "high", shape: "ingot", color: "#ffcf4d", accent: "#fff4c8", rim: "#9a6a05" },
    PX: { name: "貔貅", tier: "high", shape: "pixiu", color: "#f6efe0", accent: "#ffffff", rim: "#8d7a4a" },
    W: { name: "神龙", tier: "wild", shape: "dragon", color: "#ffd75e", accent: "#ff6a5e", rim: "#8e2318" },
    S: { name: "金锣", tier: "scatter", shape: "gong", color: "#f2a83b", accent: "#ffe9b0", rim: "#a32731" },
    C: { name: "招财钱币", tier: "coin", shape: "luckycoin", color: "#ffdf7a", accent: "#fff8dc", rim: "#b02a2a" }
  };

  /* 参与 243 Ways 结算的普通图标，按价值从低到高。 */
  var PAYING = ["CN", "FU", "LT", "JD", "KO", "YB", "PX"];

  /* 特殊图标（神龙/金锣/钱币）之间的最小间隔（格），避免挤在同一个可见窗口里。 */
  var SPECIAL_GAP = { W: 6, S: 5, C: 5 };
  var SPECIAL_KEYS = ["W", "S", "C"];

  /* ================= 轮带生成（两个模式共用） =================
   * 固定种子的确定性算法，保证游戏本体和模拟器拿到一样的轮带、数值可复现。
   * 流程：普通图标按堆叠长度切成"块" → 洗牌 → 拆开相邻同名块 →
   *       把特殊图标按等间距插进块与块之间（不会切断堆叠）。 */
  function makeLcg(seed) {
    var s = seed >>> 0;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function circularDistance(a, b, len) {
    var d = Math.abs(a - b);
    return Math.min(d, len - d);
  }

  function toBlocks(key, weight, stackSize) {
    var blocks = [];
    var left = weight;
    while (left > 0) {
      var take = Math.min(stackSize || 1, left);
      blocks.push({ key: key, n: take });
      left -= take;
    }
    return blocks;
  }

  /* 洗牌后拆散相邻的同名块，避免出现 6 连、9 连这种过长的堆叠。 */
  function separateAdjacent(blocks, rnd) {
    for (var pass = 0; pass < 200; pass++) {
      var bad = -1;
      for (var i = 0; i < blocks.length; i++) {
        var next = (i + 1) % blocks.length;
        if (blocks[i].key === blocks[next].key) { bad = next; break; }
      }
      if (bad < 0) return blocks;
      var moved = false;
      for (var t = 0; t < blocks.length * 2 && !moved; t++) {
        var j = Math.floor(rnd() * blocks.length);
        var prev = (j - 1 + blocks.length) % blocks.length;
        var after = (j + 1) % blocks.length;
        if (j === bad) continue;
        if (blocks[j].key === blocks[bad].key) continue;
        if (blocks[prev].key === blocks[bad].key || blocks[after].key === blocks[bad].key) continue;
        var tmp = blocks[j]; blocks[j] = blocks[bad]; blocks[bad] = tmp;
        moved = true;
      }
      if (!moved) return blocks;
    }
    return blocks;
  }

  /* 把特殊图标按"尽量等间距"插入块序列。 */
  function insertSpecials(blocks, specials, rnd) {
    var groups = SPECIAL_KEYS.map(function (key) {
      var list = [];
      for (var i = 0; i < (specials[key] || 0); i++) list.push(key);
      return list;
    }).filter(function (g) { return g.length; });
    var order = [];
    var total = groups.reduce(function (a, g) { return a + g.length; }, 0);
    for (var round = 0; order.length < total; round++) {
      for (var g = 0; g < groups.length; g++) if (groups[g][round]) order.push(groups[g][round]);
    }
    if (!order.length) return blocks;

    var slots = blocks.length;
    var spacing = slots / order.length;
    var out = blocks.slice();
    var placements = order.map(function (key, i) {
      var jitter = Math.floor((rnd() - 0.5) * Math.max(1, spacing * 0.5));
      var at = Math.min(slots, Math.max(0, Math.round(i * spacing) + jitter));
      return { key: key, at: at };
    }).sort(function (a, b) { return b.at - a.at; });
    placements.forEach(function (p) { out.splice(p.at, 0, { key: p.key, n: 1 }); });
    return out;
  }

  function flatten(blocks) {
    var items = [];
    blocks.forEach(function (b) {
      for (var i = 0; i < b.n; i++) items.push(b.key);
    });
    return items;
  }

  /* 同名特殊图标若靠得太近，就和一个普通位置对调（不会破坏堆叠）。 */
  function enforceGaps(items, rnd) {
    var len = items.length;
    function insideStack(index) {
      var key = items[index];
      return key === items[(index - 1 + len) % len] || key === items[(index + 1) % len];
    }
    for (var pass = 0; pass < 300; pass++) {
      var conflict = -1, conflictKey = null;
      for (var k = 0; k < SPECIAL_KEYS.length && conflict < 0; k++) {
        var key = SPECIAL_KEYS[k];
        var gap = SPECIAL_GAP[key];
        var spots = [];
        for (var i = 0; i < len; i++) if (items[i] === key) spots.push(i);
        for (var a = 0; a < spots.length && conflict < 0; a++) {
          for (var b = a + 1; b < spots.length; b++) {
            if (circularDistance(spots[a], spots[b], len) < gap) { conflict = spots[b]; conflictKey = key; break; }
          }
        }
      }
      if (conflict < 0) return items;
      var moved = false;
      for (var t = 0; t < len * 2 && !moved; t++) {
        var target = Math.floor(rnd() * len);
        if (SPECIAL_GAP[items[target]]) continue;
        if (insideStack(target)) continue;
        var ok = true;
        for (var j = 0; j < len; j++) {
          if (j === conflict) continue;
          if (items[j] === conflictKey && circularDistance(target, j, len) < SPECIAL_GAP[conflictKey]) { ok = false; break; }
        }
        if (!ok) continue;
        var tmp = items[target]; items[target] = items[conflict]; items[conflict] = tmp;
        moved = true;
      }
      if (!moved) return items;
    }
    return items;
  }

  function buildStrip(weights, stacks, seed) {
    var rnd = makeLcg(seed);
    var blocks = [];
    var specials = {};
    Object.keys(weights).forEach(function (key) {
      if (SPECIAL_KEYS.indexOf(key) >= 0) { specials[key] = weights[key]; return; }
      blocks = blocks.concat(toBlocks(key, weights[key], stacks[key] || 1));
    });
    for (var i = blocks.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var tmp = blocks[i]; blocks[i] = blocks[j]; blocks[j] = tmp;
    }
    blocks = separateAdjacent(blocks, rnd);
    blocks = insertSpecials(blocks, specials, rnd);
    return enforceGaps(flatten(blocks), rnd);
  }

  function buildStripSet(weightList, stacks, baseSeed) {
    return weightList.map(function (w, index) {
      return buildStrip(w, stacks, baseSeed + index * 7919);
    });
  }

  /* 把一份模式定义补全成可直接使用的配置（生成轮带、补上共享字段）。 */
  function makeMode(def) {
    /* freeSeed 单独给，是为了让正常模式沿用重构之前那套免费轮带 ——
     * 换种子会改变堆叠的相邻关系，实测能让 RTP 偏出好几个百分点。 */
    def.STRIPS = {
      base: buildStripSet(def.STRIP_WEIGHTS.base, def.STACKS.base, def.seed),
      free: buildStripSet(def.STRIP_WEIGHTS.free, def.STACKS.free,
                          def.freeSeed === undefined ? def.seed + 0x1d3f1 : def.freeSeed)
    };
    def.REELS = REELS;
    def.ROWS = ROWS;
    def.SYMBOLS = SYMBOLS;
    def.PAYING = PAYING;
    return def;
  }

  /* ================= 正常模式 =================
   * 3000 万次旋转实测 RTP 96.2% / 命中率 20.8% / 单轮标准差 16.4。
   * 基础游戏刻意压得薄（只占 RTP 三成），七成押在玩法上。 */
  var NORMAL = makeMode({
    id: "normal",
    name: "正常模式",
    tagline: "RTP 96% · 认真配平过的一台机器",
    seed: 0x5f3a91,
    freeSeed: 0x2c77e3,

    PAYS: {
      CN: { 3: 0.020, 4: 0.051, 5: 0.187 },
      FU: { 3: 0.031, 4: 0.093, 5: 0.270 },
      LT: { 3: 0.041, 4: 0.112, 5: 0.400 },
      JD: { 3: 0.051, 4: 0.177, 5: 0.650 },
      KO: { 3: 0.093, 4: 0.280, 5: 1.080 },
      YB: { 3: 0.177, 4: 0.600, 5: 2.320 },
      PX: { 3: 0.380, 4: 1.380, 5: 6.250 }
    },
    SCATTER_PAY: { 3: 2, 4: 10, 5: 50 },
    COIN_PAY: { 3: 0.5, 4: 2, 5: 8, 6: 30 },

    STRIP_WEIGHTS: {
      base: [
        { CN: 11, FU: 10, LT: 10, JD: 9, KO: 7, YB: 6, PX: 4, S: 2, C: 2 },
        { CN: 11, FU: 10, LT: 10, JD: 9, KO: 7, YB: 6, PX: 4, W: 1, S: 1, C: 1 },
        { CN: 11, FU: 10, LT: 10, JD: 9, KO: 7, YB: 6, PX: 4, W: 1, S: 2, C: 1 },
        { CN: 11, FU: 10, LT: 10, JD: 9, KO: 7, YB: 6, PX: 4, W: 1, S: 1, C: 1 },
        { CN: 11, FU: 10, LT: 10, JD: 9, KO: 7, YB: 6, PX: 4, S: 2, C: 2 }
      ],
      free: [
        { CN: 8, FU: 8, LT: 9, JD: 9, KO: 8, YB: 7, PX: 5, S: 2, C: 3 },
        { CN: 8, FU: 8, LT: 9, JD: 9, KO: 8, YB: 7, PX: 5, W: 2, S: 1, C: 2 },
        { CN: 8, FU: 8, LT: 9, JD: 9, KO: 8, YB: 7, PX: 5, W: 2, S: 2, C: 2 },
        { CN: 8, FU: 8, LT: 9, JD: 9, KO: 8, YB: 7, PX: 5, W: 2, S: 1, C: 2 },
        { CN: 8, FU: 8, LT: 9, JD: 9, KO: 8, YB: 7, PX: 5, S: 2, C: 3 }
      ]
    },
    STACKS: {
      base: { CN: 2, FU: 2, LT: 3, JD: 2, KO: 3, YB: 2, PX: 3 },
      free: { CN: 2, FU: 3, LT: 3, JD: 3, KO: 3, YB: 3, PX: 3 }
    },

    FEATURES: {
      maxWinPerSpin: 2500,
      wild: { expands: true, reels: [1, 2, 3] },
      combos: {
        twinDragon: { wilds: 2, spinMultiplier: 2, charge: 12 },
        tripleDragon: { wilds: 3, spinMultiplier: 3, chargeFull: true },
        coinRush: { coins: 3, charge: 6 },
        gongResonance: { scatters: 2, wilds: 1, grantsScatter: 1 }
      },
      freeSpins: {
        trigger: { 3: 9, 4: 14, 5: 20 },
        retrigger: { scatters: 3, spins: 5 },
        startMultiplier: 4,
        stepPerWin: 1,
        maxMultiplier: 8
      },
      charge: { max: 60, perCoin: 1, perCoinFree: 2, warnAt: 0.78 },
      holdSpin: {
        respins: 3,
        landChance: 0.065,
        grandPay: 200,
        manual: true,
        spinMs: 1600, spinMsStep: 280, spinMsMax: 3600,
        values: [
          { value: 1, weight: 38 }, { value: 2, weight: 26 }, { value: 3, weight: 15 },
          { value: 5, weight: 11 }, { value: 10, weight: 6 }, { value: 25, weight: 3 },
          { value: 100, weight: 1 }
        ]
      },
      manualFreeSpins: true,
      jackpot: {
        contribution: 0.020, reseed: 0.005, seed: 250, initial: 2000,
        chance: 1 / 2500, onTripleDragon: true
      },
      buyFeature: { price: 50, tierWeights: { 3: 950, 4: 48, 5: 2 } },
      tease: { cells: 2, chance: 0.22, onScatter: true, onTopSymbol: true }
    },

    WIN_TIERS: [
      { id: "legend", label: "神 话 降 临", threshold: 100, hold: 6200, fx: 4 },
      { id: "super", label: "超 级 巨 奖", threshold: 50, hold: 5000, fx: 4 },
      { id: "mega", label: "巨 奖", threshold: 25, hold: 4000, fx: 3 },
      { id: "big", label: "大 奖", threshold: 10, hold: 3000, fx: 3 },
      { id: "nice", label: "不 错", threshold: 3, hold: 1700, fx: 2 },
      { id: "small", label: "小 赢", threshold: 1, hold: 1100, fx: 1 },
      { id: "tiny", label: "小 赏", threshold: 0, hold: 850, fx: 1 }
    ],

    ECONOMY: {
      startingWallet: 20000,
      topUp: 10000,
      bets: [10, 25, 50, 100, 250],
      defaultBet: 25,
      /* 固定带入：每一局条件一致，排行榜才可比 */
      fixedBuyin: 10000
    }
  });

  /* ================= 娱乐模式 =================
   * 目标不是配平，是爽。RTP 远超 100%，钱会一直涨。
   * 四个额外机制（滚雪球 / 金龙狂暴 / 倍率币 / 天降横财）只在这里开。 */
  var PARTY = makeMode({
    id: "party",
    name: "娱乐模式",
    tagline: "不讲道理 · 只讲爽",
    seed: 0x7ac3b5,

    PAYS: {
      CN: { 3: 0.0045, 4: 0.011, 5: 0.040 },
      FU: { 3: 0.0070, 4: 0.020, 5: 0.061 },
      LT: { 3: 0.0090, 4: 0.026, 5: 0.088 },
      JD: { 3: 0.0115, 4: 0.039, 5: 0.146 },
      KO: { 3: 0.0200, 4: 0.061, 5: 0.236 },
      YB: { 3: 0.0390, 4: 0.132, 5: 0.506 },
      PX: { 3: 0.0825, 4: 0.304, 5: 1.365 }
    },
    SCATTER_PAY: { 3: 3, 4: 12, 5: 60 },
    COIN_PAY: { 6: 2, 8: 10 },

    /* 神龙、金锣、钱币全部加密 —— 玩法要来得勤 */
    STRIP_WEIGHTS: {
      base: [
        { CN: 9, FU: 9, LT: 9, JD: 8, KO: 7, YB: 6, PX: 5, S: 2, C: 3 },
        { CN: 9, FU: 9, LT: 9, JD: 8, KO: 7, YB: 6, PX: 5, W: 1, S: 2, C: 2 },
        { CN: 9, FU: 9, LT: 9, JD: 8, KO: 7, YB: 6, PX: 5, W: 2, S: 2, C: 2 },
        { CN: 9, FU: 9, LT: 9, JD: 8, KO: 7, YB: 6, PX: 5, W: 1, S: 2, C: 2 },
        { CN: 9, FU: 9, LT: 9, JD: 8, KO: 7, YB: 6, PX: 5, S: 2, C: 3 }
      ],
      free: [
        { CN: 6, FU: 7, LT: 8, JD: 8, KO: 8, YB: 8, PX: 7, S: 1, C: 4 },
        { CN: 6, FU: 7, LT: 8, JD: 8, KO: 8, YB: 8, PX: 7, W: 2, S: 1, C: 3 },
        { CN: 6, FU: 7, LT: 8, JD: 8, KO: 8, YB: 8, PX: 7, W: 3, S: 2, C: 3 },
        { CN: 6, FU: 7, LT: 8, JD: 8, KO: 8, YB: 8, PX: 7, W: 2, S: 1, C: 3 },
        { CN: 6, FU: 7, LT: 8, JD: 8, KO: 8, YB: 8, PX: 7, S: 1, C: 4 }
      ]
    },
    STACKS: {
      base: { CN: 3, FU: 3, LT: 3, JD: 3, KO: 3, YB: 3, PX: 3 },
      free: { CN: 3, FU: 3, LT: 3, JD: 3, KO: 3, YB: 3, PX: 3 }
    },

    FEATURES: {
      maxWinPerSpin: 50000,
      wild: { expands: true, reels: [1, 2, 3] },
      combos: {
        twinDragon: { wilds: 2, spinMultiplier: 3, charge: 8 },
        tripleDragon: { wilds: 3, spinMultiplier: 8, chargeFull: true },
        coinRush: { coins: 3, charge: 5 },
        gongResonance: { scatters: 2, wilds: 1, grantsScatter: 1 }
      },
      freeSpins: {
        trigger: { 3: 8, 4: 12, 5: 18 },
        retrigger: { scatters: 4, spins: 5 },
        maxTotal: 24,
        startMultiplier: 2,
        stepPerWin: 1,
        maxMultiplier: 8
      },
      charge: { max: 70, perCoin: 1, perCoinFree: 2, warnAt: 0.7 },
      holdSpin: {
        respins: 3,
        landChance: 0.075,
        grandPay: 1200,
        manual: true,
        spinMs: 1500, spinMsStep: 240, spinMsMax: 3200,
        values: [
          { value: 1, weight: 50 }, { value: 2, weight: 28 }, { value: 4, weight: 13 },
          { value: 8, weight: 6 }, { value: 20, weight: 2 }, { value: 60, weight: 1 }
        ],
        /* 倍率币与收集器：结束时把总额乘起来 */
        multCoins: {
          chance: 0.03,
          values: [{ value: 2, weight: 60 }, { value: 3, weight: 28 }, { value: 5, weight: 12 }]
        },
        collector: { chance: 0.015, mult: 2 }
      },
      manualFreeSpins: true,
      jackpot: {
        contribution: 0.150, reseed: 0.010, seed: 20000, initial: 1000000,
        chance: 1 / 1500, onTripleDragon: true
      },
      buyFeature: { price: 60, tierWeights: { 3: 820, 4: 150, 5: 30 } },
      tease: { cells: 2, chance: 0.3, onScatter: true, onTopSymbol: true },

      /* ---- 娱乐模式专属机制 ---- */
      /* 滚雪球：连续中奖时全局倍率一级级往上爬，断了才清零 */
      snowball: { steps: [1, 2, 3, 4, 5] },
      /* 金龙狂暴：随机进入若干转，2/3/4 轴全部变神龙 */
      rampage: { chance: 1 / 350, spins: 3, multiplier: 1 },
      /* 天降横财：随机往盘面砸一把招财钱币 */
      coinDrop: { chance: 0.04, min: 3, max: 6 }
    },

    /* 娱乐模式的赢钱量级完全不同，奖级阈值整体抬高 */
    WIN_TIERS: [
      { id: "legend", label: "富 可 敌 国", threshold: 2000, hold: 6800, fx: 4 },
      { id: "super", label: "超 级 巨 奖", threshold: 800, hold: 5600, fx: 4 },
      { id: "mega", label: "巨 奖", threshold: 300, hold: 4400, fx: 4 },
      { id: "big", label: "大 奖", threshold: 100, hold: 3200, fx: 3 },
      { id: "nice", label: "不 错", threshold: 30, hold: 1800, fx: 2 },
      { id: "small", label: "小 赢", threshold: 5, hold: 1100, fx: 1 },
      { id: "tiny", label: "小 赏", threshold: 0, hold: 800, fx: 1 }
    ],

    ECONOMY: {
      startingWallet: 1000000,
      topUp: 500000,
      bets: [1000, 2500, 5000, 10000, 25000],
      defaultBet: 2500,
      fixedBuyin: 100000
    }
  });

  var MODES = { normal: NORMAL, party: PARTY };

  /* ---------------- 局外成长（不参与 RTP，两个模式共享等级）----------------
   * 等级、任务、签到、洗码返水发的都是"金库"里的虚拟金币，属于水龙头，
   * 和老虎机本身的赔付是两套账，不要混在一起算。 */
  var META = {
    level: {
      /* 经验 = 流水（下注额）。娱乐模式流水按 partyXpRate 折算，否则一局就满级。 */
      curve: function (n) { return Math.round(400 * Math.pow(n, 1.5)); },
      reward: function (n) { return 500 * n; },
      betUnlock: { 100: 4, 250: 8 },
      maxLevel: 99,
      partyXpRate: 0.02
    },
    /* 贵宾厅段位：每 8 级一段，名字往土里写。
     * rebate 是洗码返水比例 —— 按累计流水定期返到金库，澳门那套的灵魂。 */
    vip: {
      levelsPerTier: 8,
      rebateEvery: 20000,
      tiers: [
        { name: "散客",       card: "#8b6a4a", rebate: 0.000, daily: 1.0, mission: 1.0, perk: "——" },
        { name: "熟客",       card: "#a8805a", rebate: 0.002, daily: 1.0, mission: 1.0, perk: "洗码返水 0.2%" },
        { name: "银卡贵宾",   card: "#c9d2dc", rebate: 0.004, daily: 1.2, mission: 1.0, perk: "返水 0.4% · 签到 ×1.2" },
        { name: "金卡贵宾",   card: "#e8b640", rebate: 0.006, daily: 1.5, mission: 1.2, perk: "返水 0.6% · 签到 ×1.5 · 任务 ×1.2" },
        { name: "白金贵宾",   card: "#dfe8ef", rebate: 0.008, daily: 1.5, mission: 1.5, perk: "返水 0.8% · 签到/任务 ×1.5" },
        { name: "钻石贵宾",   card: "#7fe7ff", rebate: 0.010, daily: 1.8, mission: 1.8, perk: "返水 1.0% · 签到/任务 ×1.8" },
        { name: "翡翠至尊",   card: "#3fd1a0", rebate: 0.012, daily: 2.0, mission: 2.0, perk: "返水 1.2% · 签到/任务 ×2" },
        { name: "至尊黑卡",   card: "#2b2b31", rebate: 0.015, daily: 2.5, mission: 2.5, perk: "返水 1.5% · 签到/任务 ×2.5" },
        { name: "龙厅贵宾",   card: "#ff7a4a", rebate: 0.018, daily: 3.0, mission: 3.0, perk: "返水 1.8% · 签到/任务 ×3" },
        { name: "天字一号房", card: "#ff4d4d", rebate: 0.022, daily: 4.0, mission: 4.0, perk: "返水 2.2% · 签到/任务 ×4" },
        { name: "赌　神",     card: "#fff1a8", rebate: 0.026, daily: 5.0, mission: 5.0, perk: "返水 2.6% · 签到/任务 ×5 · 封顶" }
      ]
    },
    daily: {
      rewards: [1500, 2200, 3200, 4500, 6500, 9500, 18000],
      cycle: 7
    },
    missions: {
      active: 3,
      pool: [
        { key: "spins", label: "旋转 {n} 次", targets: [20, 40, 80], coin: 6, xp: 4 },
        { key: "wager", label: "累计下注 ${n}", targets: [1500, 4000, 10000], coin: 0.3, xp: 0.2 },
        { key: "won", label: "累计赢得 ${n}", targets: [2500, 7000, 18000], coin: 0.18, xp: 0.12 },
        { key: "dragons", label: "让神龙展开 {n} 次", targets: [3, 6, 12], coin: 45, xp: 30 },
        { key: "coins", label: "收集 {n} 枚招财钱币", targets: [10, 25, 50], coin: 13, xp: 9 },
        { key: "scatters", label: "落下 {n} 个金锣", targets: [8, 20, 40], coin: 15, xp: 10 },
        { key: "frees", label: "触发 {n} 次龙门免费游戏", targets: [1, 2], coin: 450, xp: 260 },
        { key: "holds", label: "触发 {n} 次聚宝盆", targets: [1, 2], coin: 350, xp: 200 },
        { key: "bestX", label: "单次旋转赢得 {n} 倍下注", targets: [10, 25, 50], coin: 17, xp: 11 },
        { key: "wins", label: "中奖 {n} 次", targets: [10, 20, 40], coin: 13, xp: 9 },
        { key: "streak", label: "达成 {n} 连胜", targets: [3, 5, 8], coin: 75, xp: 48 }
      ]
    },
    /* 本地排行榜：只记正常模式，固定带入才可比 */
    leaderboard: { size: 20 }
  };

  var CONFIG = {
    REELS: REELS,
    ROWS: ROWS,
    SYMBOLS: SYMBOLS,
    PAYING: PAYING,
    MODES: MODES,
    DEFAULT_MODE: "normal",
    META: META,
    buildStripSet: buildStripSet,
    mode: function (id) { return MODES[id] || MODES.normal; }
  };

  root.ASTER_CONFIG = CONFIG;
  if (typeof module === "object" && module.exports) module.exports = CONFIG;
})(typeof window !== "undefined" ? window : globalThis);
