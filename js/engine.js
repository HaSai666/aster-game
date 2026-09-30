/* ------------------------------------------------------------------
 * 金龙聚宝 · 数学引擎（纯逻辑，不碰 DOM）
 * 浏览器和 tools/sim.html 蒙特卡洛模拟跑的是同一份代码，
 * 所以 README 里的 RTP 数字就是这个引擎的真实表现。
 * ------------------------------------------------------------------ */
(function (root) {
  "use strict";

  var CONFIG = root.ASTER_CONFIG || (typeof require === "function" ? require("./config.js") : null);
  var F = CONFIG.FEATURES;
  var REELS = CONFIG.REELS;
  var ROWS = CONFIG.ROWS;

  function defaultRng() {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      var buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      return buf[0] / 4294967296;
    }
    return Math.random();
  }

  /* 停轮：为每条轮带挑一个起始位置，往下取 ROWS 格作为可见窗口。 */
  function spinGrid(strips, rng) {
    var stops = [];
    var grid = [];
    for (var c = 0; c < REELS; c++) {
      var strip = strips[c];
      var stop = Math.floor(rng() * strip.length) % strip.length;
      stops.push(stop);
      var col = [];
      for (var r = 0; r < ROWS; r++) col.push(strip[(stop + r) % strip.length]);
      grid.push(col);
    }
    return { stops: stops, grid: grid };
  }

  function countSymbol(grid, key) {
    var n = 0;
    for (var c = 0; c < REELS; c++) for (var r = 0; r < ROWS; r++) if (grid[c][r] === key) n++;
    return n;
  }

  function reelsWith(grid, key) {
    var list = [];
    for (var c = 0; c < REELS; c++) {
      for (var r = 0; r < ROWS; r++) {
        if (grid[c][r] === key) { list.push(c); break; }
      }
    }
    return list;
  }

  function cloneGrid(grid) {
    return grid.map(function (col) { return col.slice(); });
  }

  /* 神龙整轴展开。注意：金锣 / 招财钱币的计数在展开【之前】结算，
   * 所以神龙覆盖一整轴时不会吃掉玩家已经看到的锣或钱币。 */
  function expandWilds(grid, wildReels) {
    var out = cloneGrid(grid);
    wildReels.forEach(function (c) {
      for (var r = 0; r < ROWS; r++) out[c][r] = "W";
    });
    return out;
  }

  /* 243 Ways：从第 1 轮开始，每条相邻轮上"该图标 + 神龙"的数量连乘。
   * 同一图标只按最长链结算一次（不叠加 3 连 / 4 连）。 */
  function evaluateWays(grid, bet, multiplier) {
    var wins = [];
    var total = 0;
    for (var i = 0; i < CONFIG.PAYING.length; i++) {
      var sym = CONFIG.PAYING[i];
      var counts = [];
      for (var c = 0; c < REELS; c++) {
        var n = 0;
        for (var r = 0; r < ROWS; r++) if (grid[c][r] === sym || grid[c][r] === "W") n++;
        counts.push(n);
      }
      var ways = 1, reels = 0;
      for (var k = 0; k < REELS; k++) {
        if (!counts[k]) break;
        ways *= counts[k];
        reels++;
      }
      if (reels < 3) continue;
      var pay = CONFIG.PAYS[sym][reels];
      if (!pay) continue;
      var amount = pay * ways * bet * multiplier;
      var positions = [];
      for (var cc = 0; cc < reels; cc++) {
        for (var rr = 0; rr < ROWS; rr++) {
          if (grid[cc][rr] === sym || grid[cc][rr] === "W") positions.push({ c: cc, r: rr });
        }
      }
      wins.push({ symbol: sym, reels: reels, ways: ways, amount: amount, positions: positions });
      total += amount;
    }
    wins.sort(function (a, b) { return b.amount - a.amount; });
    return { wins: wins, total: total };
  }

  function tableLookup(table, count) {
    var best = 0;
    Object.keys(table).forEach(function (k) {
      var n = Number(k);
      if (count >= n && n >= best) best = n;
    });
    return best ? table[best] : 0;
  }

  /* ---------------- 聚宝盆 Hold & Spin ----------------
   * 触发时盘面上的招财钱币直接锁定，之后 3 次重转；
   * 只要落新币就把重转次数重置回 3，15 格填满额外给大满贯。
   * 返回一份完整"剧本"，表现层照着逐步播放即可。 */
  function drawCoinValue(rng) {
    var list = F.holdSpin.values;
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += list[i].weight;
    var roll = rng() * total;
    for (i = 0; i < list.length; i++) {
      roll -= list[i].weight;
      if (roll <= 0) return list[i].value;
    }
    return list[0].value;
  }

  function runHoldAndSpin(bet, seedCells, rng) {
    var size = REELS * ROWS;
    var board = new Array(size).fill(0);
    var seeded = [];
    seedCells.forEach(function (index) {
      if (board[index]) return;
      board[index] = drawCoinValue(rng);
      seeded.push({ index: index, value: board[index] });
    });
    var respins = F.holdSpin.respins;
    var rounds = [];
    var filled = seeded.length;
    while (respins > 0 && filled < size) {
      respins--;
      var landed = [];
      for (var i = 0; i < size; i++) {
        if (board[i]) continue;
        if (rng() < F.holdSpin.landChance) {
          board[i] = drawCoinValue(rng);
          landed.push({ index: i, value: board[i] });
          filled++;
        }
      }
      if (landed.length) respins = F.holdSpin.respins;
      rounds.push({ landed: landed, respinsLeft: respins, filled: filled });
    }
    var coinTotal = 0;
    for (var j = 0; j < size; j++) coinTotal += board[j];
    var grand = filled === size;
    var total = (coinTotal + (grand ? F.holdSpin.grandPay : 0)) * bet;
    return {
      seeded: seeded,
      rounds: rounds,
      board: board,
      filled: filled,
      grand: grand,
      coinTotal: coinTotal,
      total: total
    };
  }

  function winTier(win, bet) {
    var ratio = bet > 0 ? win / bet : 0;
    for (var i = 0; i < CONFIG.WIN_TIERS.length; i++) {
      if (ratio >= CONFIG.WIN_TIERS[i].threshold) return CONFIG.WIN_TIERS[i];
    }
    return CONFIG.WIN_TIERS[CONFIG.WIN_TIERS.length - 1];
  }

  /* ---------------- 引擎 ---------------- */
  function SlotEngine(options) {
    options = options || {};
    this.rng = options.rng || defaultRng;
    this.strips = options.strips || CONFIG.STRIPS;
    this.reset();
  }

  SlotEngine.prototype.reset = function () {
    this.charge = 0;
    this.freeSpins = 0;
    this.freeTotal = 0;
    this.freeIndex = 0;
    this.freeMultiplier = 1;
    this.freeWon = 0;
    this.mode = "base";
    this.jackpot = F.jackpot.initial;
    this.jackpotReserve = 0;
    this.boughtFeature = false;
  };

  /* 购买龙门：按自然触发的档位分布掷一个，然后直接进免费游戏。
   * 价格在 config 里，定成和免费游戏实测平均产出基本持平。 */
  SlotEngine.prototype.buyFreeSpins = function () {
    var weights = F.buyFeature.tierWeights;
    var keys = Object.keys(weights);
    var total = 0, i;
    for (i = 0; i < keys.length; i++) total += weights[keys[i]];
    var roll = this.rng() * total;
    var tier = keys[0];
    for (i = 0; i < keys.length; i++) {
      roll -= weights[keys[i]];
      if (roll <= 0) { tier = keys[i]; break; }
    }
    var spins = F.freeSpins.trigger[tier];
    this.mode = "free";
    this.freeSpins = spins;
    this.freeTotal = spins;
    this.freeIndex = 0;
    this.freeMultiplier = F.freeSpins.startMultiplier;
    this.freeWon = 0;
    this.boughtFeature = true;
    return { scatters: Number(tier), spins: spins };
  };

  SlotEngine.prototype.snapshot = function () {
    return {
      charge: this.charge,
      chargeMax: F.charge.max,
      chargeRatio: this.charge / F.charge.max,
      freeSpins: this.freeSpins,
      freeTotal: this.freeTotal,
      freeIndex: this.freeIndex,
      freeMultiplier: this.freeMultiplier,
      freeWon: this.freeWon,
      jackpot: this.jackpot,
      mode: this.mode
    };
  };

  /* 单次旋转。bet 是"单次下注"（243 Ways 不再乘线数）。 */
  SlotEngine.prototype.play = function (bet) {
    var rng = this.rng;
    var isFree = this.mode === "free";
    var strips = isFree ? this.strips.free : this.strips.base;
    /* 只有付费旋转才往彩金池和储备里投钱 */
    if (!isFree) {
      this.jackpot += bet * F.jackpot.contribution;
      this.jackpotReserve += bet * F.jackpot.reseed;
    }
    var spun = spinGrid(strips, rng);
    var grid = spun.grid;

    /* 1. 展开前先数特殊图标 */
    var scatterCount = countSymbol(grid, "S");
    var coinCells = [];
    for (var c = 0; c < REELS; c++) {
      for (var r = 0; r < ROWS; r++) if (grid[c][r] === "C") coinCells.push(c * ROWS + r);
    }
    var coinCount = coinCells.length;
    var wildReels = reelsWith(grid, "W");
    var wildCount = wildReels.length;

    /* 2. 特殊组合 */
    var combos = [];
    var spinMultiplier = 1;
    var chargeGain = coinCount * (isFree ? F.charge.perCoinFree : F.charge.perCoin);
    var chargeFull = false;

    if (wildCount >= F.combos.tripleDragon.wilds) {
      combos.push("tripleDragon");
      spinMultiplier = Math.max(spinMultiplier, F.combos.tripleDragon.spinMultiplier);
      chargeFull = true;
    } else if (wildCount >= F.combos.twinDragon.wilds) {
      combos.push("twinDragon");
      spinMultiplier = Math.max(spinMultiplier, F.combos.twinDragon.spinMultiplier);
      chargeGain += F.combos.twinDragon.charge;
    }
    if (coinCount >= F.combos.coinRush.coins) {
      combos.push("coinRush");
      chargeGain += F.combos.coinRush.charge;
    }
    /* 龙锣共鸣：差一个锣，神龙帮你补上 */
    var effectiveScatters = scatterCount;
    if (scatterCount === F.combos.gongResonance.scatters && wildCount >= F.combos.gongResonance.wilds) {
      combos.push("gongResonance");
      effectiveScatters += F.combos.gongResonance.grantsScatter;
    }

    /* 3. 展开神龙后结算 243 Ways */
    var finalGrid = F.wild.expands && wildReels.length ? expandWilds(grid, wildReels) : cloneGrid(grid);
    var multiplier = spinMultiplier * (isFree ? this.freeMultiplier : 1);
    var ways = evaluateWays(finalGrid, bet, multiplier);

    /* 4. 散落赔付 */
    var scatterPay = tableLookup(CONFIG.SCATTER_PAY, effectiveScatters) * bet;
    var coinPay = tableLookup(CONFIG.COIN_PAY, coinCount) * bet;

    /* 取整到"分"以上：基础赔率只有零点零几，不取整会出现赢了却显示 $0 的情况。
     * 只要赢了就至少给 1，对 RTP 的影响可以忽略。 */
    var spinWin = ways.total + scatterPay + coinPay;
    if (spinWin > 0) spinWin = Math.max(1, Math.round(spinWin));

    /* 5. 能量条 */
    var chargeBefore = this.charge;
    this.charge = chargeFull ? F.charge.max : Math.min(F.charge.max, this.charge + chargeGain);
    var holdTriggered = this.charge >= F.charge.max;

    /* 6. 免费游戏推进 / 触发 */
    var freeTriggered = 0;
    var retriggered = 0;
    if (isFree) {
      this.freeIndex++;
      this.freeSpins--;
      if (effectiveScatters >= F.freeSpins.retrigger.scatters) {
        retriggered = F.freeSpins.retrigger.spins;
        this.freeSpins += retriggered;
        this.freeTotal += retriggered;
      }
      if (ways.total > 0 && this.freeMultiplier < F.freeSpins.maxMultiplier) {
        this.freeMultiplier = Math.min(F.freeSpins.maxMultiplier, this.freeMultiplier + F.freeSpins.stepPerWin);
      }
      this.freeWon += spinWin;
    } else if (F.freeSpins.trigger[Math.min(effectiveScatters, REELS)]) {
      freeTriggered = F.freeSpins.trigger[Math.min(effectiveScatters, REELS)];
    }

    /* 7. 聚宝盆（能量满） */
    var hold = null;
    if (holdTriggered) {
      hold = runHoldAndSpin(bet, coinCells, rng);
      this.charge = 0;
    }

    var totalWin = spinWin + (hold ? hold.total : 0);
    /* 单次旋转封顶：告诉玩家封顶了，而不是悄悄砍掉。 */
    var capped = false;
    var cap = F.maxWinPerSpin * bet;
    if (F.maxWinPerSpin && totalWin > cap) {
      totalWin = cap;
      capped = true;
    }

    /* 累积彩金。整池带走后重新回到底金。彩金是独立奖项，不受单转封顶约束。 */
    var jackpotHit = false;
    var jackpotWin = 0;
    if ((F.jackpot.onTripleDragon && combos.indexOf("tripleDragon") >= 0) ||
        (!isFree && rng() < F.jackpot.chance)) {
      jackpotHit = true;
      jackpotWin = Math.round(this.jackpot);
      /* 新的底金从储备里出，储备不够就少垫一点 */
      var newSeed = Math.min(this.jackpotReserve, F.jackpot.seed);
      this.jackpotReserve -= newSeed;
      this.jackpot = newSeed;
    }
    totalWin += jackpotWin;

    if (isFree) this.freeWon += (hold ? hold.total : 0) + jackpotWin;

    /* 8. 免费游戏状态收尾 —— 聚宝盆结束后才判断是否退出 */
    var freeEnded = false;
    if (isFree && this.freeSpins <= 0) {
      freeEnded = true;
      this.mode = "base";
    }
    if (freeTriggered) {
      this.mode = "free";
      this.freeSpins = freeTriggered;
      this.freeTotal = freeTriggered;
      this.freeIndex = 0;
      this.freeMultiplier = F.freeSpins.startMultiplier;
      this.freeWon = 0;
    }

    return {
      bet: bet,
      mode: isFree ? "free" : "base",
      stops: spun.stops,
      grid: grid,
      finalGrid: finalGrid,
      wildReels: wildReels,
      wildCount: wildCount,
      scatterCount: scatterCount,
      effectiveScatters: effectiveScatters,
      coinCells: coinCells,
      coinCount: coinCount,
      combos: combos,
      spinMultiplier: spinMultiplier,
      multiplier: multiplier,
      wins: ways.wins,
      waysPay: ways.total,
      scatterPay: scatterPay,
      coinPay: coinPay,
      spinWin: spinWin,
      hold: hold,
      jackpot: { hit: jackpotHit, win: jackpotWin, pot: this.jackpot },
      totalWin: totalWin,
      capped: capped,
      tier: winTier(totalWin, bet),
      charge: { before: chargeBefore, after: this.charge, max: F.charge.max, gain: chargeGain, full: holdTriggered },
      free: {
        triggered: freeTriggered,
        retriggered: retriggered,
        ended: freeEnded,
        remaining: this.freeSpins,
        total: this.freeTotal,
        index: this.freeIndex,
        multiplier: this.freeMultiplier,
        won: this.freeWon
      }
    };
  };

  var ENGINE = {
    SlotEngine: SlotEngine,
    spinGrid: spinGrid,
    expandWilds: expandWilds,
    evaluateWays: evaluateWays,
    runHoldAndSpin: runHoldAndSpin,
    countSymbol: countSymbol,
    winTier: winTier,
    defaultRng: defaultRng
  };

  root.ASTER_ENGINE = ENGINE;
  if (typeof module === "object" && module.exports) module.exports = ENGINE;
})(typeof window !== "undefined" ? window : globalThis);
