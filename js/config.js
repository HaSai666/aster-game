/* ------------------------------------------------------------------
 * 金龙聚宝 · 配置（单一数值来源）
 * 这里是唯一的数值来源：游戏本体和 tools/sim.html 蒙特卡洛验证共用。
 * 改动任何权重后，请重新跑一次 tools/sim.html 确认 RTP / 命中率。
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

  /* 每条 way 的赔付倍数（× 单次下注）。
   * 数值小是 243 Ways 的正常量级：实际赔付 = 这里的值 × Ways 数（最高 243）。
   * 这一组是把结构定死后用 tools/sim.html 反解出来的，整体线性缩放到 RTP 95%。 */
  var PAYS = {
    CN: { 3: 0.03, 4: 0.09, 5: 0.32 },
    FU: { 3: 0.05, 4: 0.15, 5: 0.48 },
    LT: { 3: 0.07, 4: 0.21, 5: 0.75 },
    JD: { 3: 0.09, 4: 0.30, 5: 1.15 },
    KO: { 3: 0.15, 4: 0.48, 5: 2.10 },
    YB: { 3: 0.30, 4: 1.05, 5: 4.60 },
    PX: { 3: 0.65, 4: 2.40, 5: 13.0 }
  };

  /* 金锣 = Scatter，落在任意位置即计数；同时给一笔即时赔付。 */
  var SCATTER_PAY = { 3: 2, 4: 10, 5: 50 };
  /* 招财钱币散落赔付（3 枚起）。钱币本身稀有，主要收益在聚宝盆里。 */
  var COIN_PAY = { 3: 0.5, 4: 2, 5: 8, 6: 30 };

  /* ---------------- 滚轮带 ----------------
   * 权重即该图标在这条轮带上出现的格数。轮带长度 = 权重之和。
   * 神龙只在 2/3/4 轮出现，这样第 1 轮永远需要真实图标，
   * 避免"纯 Wild 中奖"，也让神龙落轴这件事本身变成事件。          */
  var STRIP_WEIGHTS = {
    base: [
      { CN: 11, FU: 10, LT: 10, JD: 9, KO: 7, YB: 6, PX: 4, S: 2, C: 2 },
      { CN: 11, FU: 10, LT: 10, JD: 9, KO: 7, YB: 6, PX: 4, W: 1, S: 1, C: 1 },
      { CN: 11, FU: 10, LT: 10, JD: 9, KO: 7, YB: 6, PX: 4, W: 1, S: 2, C: 1 },
      { CN: 11, FU: 10, LT: 10, JD: 9, KO: 7, YB: 6, PX: 4, W: 1, S: 1, C: 1 },
      { CN: 11, FU: 10, LT: 10, JD: 9, KO: 7, YB: 6, PX: 4, S: 2, C: 2 }
    ],
    /* 免费游戏专用轮带：神龙翻倍、钱币更多、低分图标更少。 */
    free: [
      { CN: 8, FU: 8, LT: 9, JD: 9, KO: 8, YB: 7, PX: 5, S: 2, C: 3 },
      { CN: 8, FU: 8, LT: 9, JD: 9, KO: 8, YB: 7, PX: 5, W: 2, S: 1, C: 2 },
      { CN: 8, FU: 8, LT: 9, JD: 9, KO: 8, YB: 7, PX: 5, W: 2, S: 2, C: 2 },
      { CN: 8, FU: 8, LT: 9, JD: 9, KO: 8, YB: 7, PX: 5, W: 2, S: 1, C: 2 },
      { CN: 8, FU: 8, LT: 9, JD: 9, KO: 8, YB: 7, PX: 5, S: 2, C: 3 }
    ]
  };

  /* 堆叠：同一图标在轮带上成组出现的最大长度。
   * 堆叠不改变符号总数，但会让"中了就中一大片"——命中率下降、单次 Ways 数上升，
   * 正是中高波动想要的手感；滚动时成片的图标看起来也更有分量。 */
  var STACKS = {
    base: { CN: 2, FU: 2, LT: 3, JD: 2, KO: 3, YB: 2, PX: 3 },
    free: { CN: 2, FU: 3, LT: 3, JD: 3, KO: 3, YB: 3, PX: 3 }
  };

  /* 特殊图标（神龙/金锣/钱币）之间的最小间隔（格），避免挤在同一个可见窗口里。 */
  var SPECIAL_GAP = { W: 6, S: 5, C: 5 };
  var SPECIAL_KEYS = ["W", "S", "C"];

  var FEATURES = {
    /* 单次旋转封顶（× 下注）。触顶时会明确告诉玩家，避免出现天文数字。 */
    maxWinPerSpin: 2500,
    /* --- 神龙（Wild） --- */
    wild: {
      expands: true,          // 落轴后整轴展开
      reels: [1, 2, 3]        // 只出现在第 2/3/4 轮（0 基）
    },
    /* --- 特殊组合 --- */
    combos: {
      /* 双龙戏珠：2 条神龙同屏 → 本次旋转 2× + 能量大幅充能 */
      twinDragon: { wilds: 2, spinMultiplier: 2, charge: 12 },
      /* 三龙聚顶：3 条神龙同屏 → 本次旋转 3× + 能量直接充满（立刻进聚宝盆） */
      tripleDragon: { wilds: 3, spinMultiplier: 3, chargeFull: true },
      /* 满堂金：3 枚以上招财钱币 → 额外充能 */
      coinRush: { coins: 3, charge: 6 },
      /* 龙锣共鸣：2 个金锣 + 至少 1 条神龙 → 神龙化锣，补满 3 个触发免费游戏 */
      gongResonance: { scatters: 2, wilds: 1, grantsScatter: 1 }
    },
    /* --- 龙门免费游戏 --- */
    freeSpins: {
      trigger: { 3: 8, 4: 12, 5: 18 },
      retrigger: { scatters: 3, spins: 5 },
      startMultiplier: 2,
      stepPerWin: 1,
      maxMultiplier: 5
    },
    /* --- 隐藏能量条 → 聚宝盆（Hold & Spin） --- */
    charge: {
      max: 42,                // 玩家看不到这个数字，只看得到条的长度与光效
      perCoin: 1,             // 基础游戏每枚招财钱币
      perCoinFree: 2,         // 免费游戏中翻倍
      warnAt: 0.78            // 超过这个比例开始"快满了"的视觉/听觉暗示
    },
    holdSpin: {
      respins: 3,             // 初始重转次数；每次落新币重置
      landChance: 0.058,      // 每个空位每次重转的落币概率
      grandPay: 200,          // 15 格全满额外奖励（× 下注）
      values: [               // 单枚钱币面值（× 下注）与权重
        { value: 1, weight: 68 },
        { value: 2, weight: 20 },
        { value: 3, weight: 6 },
        { value: 5, weight: 3 },
        { value: 10, weight: 2 },
        { value: 20, weight: 1 }
      ]
    }
  };

  /* 大奖分级：阈值是"本次总赢 ÷ 单次下注"。 */
  var WIN_TIERS = [
    { id: "legend", label: "神话降临", threshold: 100, hold: 5200 },
    { id: "super", label: "超级巨奖", threshold: 50, hold: 4200 },
    { id: "mega", label: "巨奖", threshold: 25, hold: 3400 },
    { id: "big", label: "大奖", threshold: 10, hold: 2600 },
    { id: "nice", label: "不错", threshold: 3, hold: 1200 },
    { id: "small", label: "", threshold: 0, hold: 0 }
  ];

  var ECONOMY = {
    startingWallet: 10000,
    topUp: 5000,
    bets: [5, 10, 20, 50, 100],
    defaultBet: 10,
    buyins: [
      { amount: 600, title: "小试身手", note: "60 转起步" },
      { amount: 2500, title: "登堂入室", note: "撑得住一次免费游戏" },
      { amount: 10000, title: "一掷千金", note: "完整体验所有玩法" }
    ]
  };

  /* ---------------- 轮带生成 ----------------
   * 用固定种子的确定性算法，保证游戏本体和模拟器拿到完全一样的轮带、数值可复现。
   * 流程：普通图标按堆叠长度切成"块" → 洗牌 → 拆开相邻同名块 →
   *       把特殊图标按等间距插进块与块之间（不会切断堆叠）。          */
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

  /* 把某个图标的总权重切成若干堆叠块，例如 权重 11 / 堆叠 3 → [3,3,3,2]。 */
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
        /* 换过去之后两边都不能和自己同名 */
        if (blocks[prev].key === blocks[bad].key || blocks[after].key === blocks[bad].key) continue;
        var tmp = blocks[j]; blocks[j] = blocks[bad]; blocks[bad] = tmp;
        moved = true;
      }
      if (!moved) return blocks;
    }
    return blocks;
  }

  /* 把特殊图标按"尽量等间距"插入块序列。同名特殊图标之间再做一次间隔校验。 */
  function insertSpecials(blocks, specials, rnd) {
    /* 先把不同种类交错排开：W,S,C,S,C … */
    var groups = SPECIAL_KEYS.map(function (key) {
      var list = [];
      for (var i = 0; i < (specials[key] || 0); i++) list.push(key);
      return list;
    }).filter(function (g) { return g.length; });
    var order = [];
    for (var round = 0; order.length < groups.reduce(function (a, g) { return a + g.length; }, 0); round++) {
      for (var g = 0; g < groups.length; g++) if (groups[g][round]) order.push(groups[g][round]);
    }
    if (!order.length) return blocks;

    var slots = blocks.length;
    var spacing = slots / order.length;
    var out = blocks.slice();
    /* 从后往前插，前面的下标就不会被打乱 */
    var placements = order.map(function (key, i) {
      var jitter = Math.floor((rnd() - 0.5) * Math.max(1, spacing * 0.5));
      var at = Math.min(slots, Math.max(0, Math.round(i * spacing) + jitter));
      return { key: key, at: at };
    }).sort(function (a, b) { return b.at - a.at; });
    placements.forEach(function (p) {
      out.splice(p.at, 0, { key: p.key, n: 1 });
    });
    return out;
  }

  function flatten(blocks) {
    var items = [];
    blocks.forEach(function (b) {
      for (var i = 0; i < b.n; i++) items.push(b.key);
    });
    return items;
  }

  /* 最后一道校验：同名特殊图标若靠得太近，就和一个普通位置对调。
   * 只动单格的特殊图标，不会破坏堆叠（堆叠块内部不会被选为落点）。 */
  function enforceGaps(items, rnd) {
    var len = items.length;
    function insideStack(index) {
      var key = items[index];
      var prev = items[(index - 1 + len) % len];
      var next = items[(index + 1) % len];
      return key === prev || key === next;
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

  var STRIPS = {
    base: buildStripSet(STRIP_WEIGHTS.base, STACKS.base, 0x5f3a91),
    free: buildStripSet(STRIP_WEIGHTS.free, STACKS.free, 0x2c77e3)
  };

  var CONFIG = {
    REELS: REELS,
    ROWS: ROWS,
    WAYS: Math.pow(ROWS, REELS),
    SYMBOLS: SYMBOLS,
    PAYING: PAYING,
    PAYS: PAYS,
    SCATTER_PAY: SCATTER_PAY,
    COIN_PAY: COIN_PAY,
    STRIP_WEIGHTS: STRIP_WEIGHTS,
    STACKS: STACKS,
    STRIPS: STRIPS,
    FEATURES: FEATURES,
    WIN_TIERS: WIN_TIERS,
    ECONOMY: ECONOMY,
    buildStripSet: buildStripSet
  };

  root.ASTER_CONFIG = CONFIG;
  if (typeof module === "object" && module.exports) module.exports = CONFIG;
})(typeof window !== "undefined" ? window : globalThis);
