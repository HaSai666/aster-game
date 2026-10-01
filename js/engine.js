/* ------------------------------------------------------------------
 * 金龙聚宝 · 数学引擎（纯逻辑，不碰 DOM）
 * 浏览器和 tools/sim.html 蒙特卡洛模拟跑的是同一份代码，
 * 所以 README 里的 RTP 数字就是这个引擎的真实表现。
 *
 * 引擎实例绑定一份模式配置（正常 / 娱乐），所有数值都从 this.cfg 取，
 * 不再读全局 —— 这样模拟器可以同时测两个模式。
 * ------------------------------------------------------------------ */
(function (root) {
  "use strict";

  var CONFIG = root.ASTER_CONFIG || (typeof require === "function" ? require("./config.js") : null);
  var REELS = CONFIG.REELS;
  var ROWS = CONFIG.ROWS;
  var SIZE = REELS * ROWS;

  function defaultRng() {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      var buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      return buf[0] / 4294967296;
    }
    return Math.random();
  }

  /* 按权重抽一项。列表元素形如 { value, weight }。 */
  function pickWeighted(list, rng) {
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += list[i].weight;
    var roll = rng() * total;
    for (i = 0; i < list.length; i++) {
      roll -= list[i].weight;
      if (roll <= 0) return list[i].value;
    }
    return list[0].value;
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
  function evaluateWays(cfg, grid, bet, multiplier) {
    var wins = [];
    var total = 0;
    for (var i = 0; i < cfg.PAYING.length; i++) {
      var sym = cfg.PAYING[i];
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
      var pay = cfg.PAYS[sym][reels];
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
   * 返回一份完整"剧本"，表现层照着逐步播放即可。
   *
   * 格子内容：0 = 空，否则 { t, v }
   *   t "v" 面值币，值 v（× 下注）
   *   t "m" 倍率币，结算时总额 × v        —— 仅娱乐模式
   *   t "c" 收集器，结算时总额 × 固定倍数  —— 仅娱乐模式
   */
  function drawCoin(H, rng) {
    if (H.collector && rng() < H.collector.chance) {
      return { t: "c", v: H.collector.mult };
    }
    if (H.multCoins && rng() < H.multCoins.chance) {
      return { t: "m", v: pickWeighted(H.multCoins.values, rng) };
    }
    return { t: "v", v: pickWeighted(H.values, rng) };
  }

  function runHoldAndSpin(cfg, bet, seedCells, rng) {
    var H = cfg.FEATURES.holdSpin;
    var board = new Array(SIZE).fill(0);
    var seeded = [];
    seedCells.forEach(function (index) {
      if (board[index]) return;
      board[index] = drawCoin(H, rng);
      seeded.push({ index: index, coin: board[index] });
    });
    var respins = H.respins;
    var rounds = [];
    var filled = seeded.length;
    while (respins > 0 && filled < SIZE) {
      respins--;
      var landed = [];
      for (var i = 0; i < SIZE; i++) {
        if (board[i]) continue;
        if (rng() < H.landChance) {
          board[i] = drawCoin(H, rng);
          landed.push({ index: i, coin: board[i] });
          filled++;
        }
      }
      if (landed.length) respins = H.respins;
      rounds.push({ landed: landed, respinsLeft: respins, filled: filled });
    }

    var coinTotal = 0, multiplier = 1, multCount = 0, collectorCount = 0;
    for (var j = 0; j < SIZE; j++) {
      var cell = board[j];
      if (!cell) continue;
      if (cell.t === "v") coinTotal += cell.v;
      else if (cell.t === "m") { multiplier *= cell.v; multCount++; }
      else if (cell.t === "c") { multiplier *= cell.v; collectorCount++; }
    }
    var grand = filled === SIZE;
    var total = (coinTotal * multiplier + (grand ? H.grandPay : 0)) * bet;
    return {
      seeded: seeded,
      rounds: rounds,
      board: board,
      filled: filled,
      grand: grand,
      coinTotal: coinTotal,
      multiplier: multiplier,
      multCount: multCount,
      collectorCount: collectorCount,
      total: total
    };
  }

  function winTier(cfg, win, bet) {
    var ratio = bet > 0 ? win / bet : 0;
    var tiers = cfg.WIN_TIERS;
    for (var i = 0; i < tiers.length; i++) {
      if (ratio >= tiers[i].threshold) return tiers[i];
    }
    return tiers[tiers.length - 1];
  }

  /* ---------------- 引擎 ---------------- */
  function SlotEngine(options) {
    options = options || {};
    this.rng = options.rng || defaultRng;
    this.setMode(options.mode || CONFIG.DEFAULT_MODE);
  }

  SlotEngine.prototype.setMode = function (id) {
    this.cfg = CONFIG.mode(id);
    this.modeId = this.cfg.id;
    this.F = this.cfg.FEATURES;
    this.strips = this.cfg.STRIPS;
    this.reset();
  };

  SlotEngine.prototype.reset = function () {
    var F = this.F;
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
    /* 娱乐模式专属状态 */
    this.snowballStep = 0;
    this.rampageLeft = 0;
  };

  SlotEngine.prototype.snowballMult = function () {
    var s = this.F.snowball;
    return s ? s.steps[Math.min(this.snowballStep, s.steps.length - 1)] : 1;
  };

  /* 购买龙门：按自然触发的档位分布掷一个，然后直接进免费游戏。 */
  SlotEngine.prototype.buyFreeSpins = function () {
    var F = this.F;
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
      chargeMax: this.F.charge.max,
      chargeRatio: this.charge / this.F.charge.max,
      freeSpins: this.freeSpins,
      freeTotal: this.freeTotal,
      freeIndex: this.freeIndex,
      freeMultiplier: this.freeMultiplier,
      freeWon: this.freeWon,
      jackpot: this.jackpot,
      snowball: this.snowballMult(),
      rampageLeft: this.rampageLeft,
      mode: this.mode
    };
  };

  /* 单次旋转。bet 是"单次下注"（243 Ways 不再乘线数）。 */
  SlotEngine.prototype.play = function (bet) {
    var rng = this.rng;
    var cfg = this.cfg;
    var F = this.F;
    var isFree = this.mode === "free";
    var strips = isFree ? this.strips.free : this.strips.base;

    /* 只有付费旋转才往彩金池和储备里投钱 */
    if (!isFree) {
      this.jackpot += bet * F.jackpot.contribution;
      this.jackpotReserve += bet * F.jackpot.reseed;
    }

    var spun = spinGrid(strips, rng);
    var grid = spun.grid;

    /* 天降横财：随机往空位上砸一把招财钱币（在计数之前） */
    var dropped = [];
    if (F.coinDrop && rng() < F.coinDrop.chance) {
      var want = F.coinDrop.min + Math.floor(rng() * (F.coinDrop.max - F.coinDrop.min + 1));
      var free = [];
      for (var dc = 0; dc < REELS; dc++) {
        for (var dr = 0; dr < ROWS; dr++) {
          if (grid[dc][dr] !== "C" && grid[dc][dr] !== "W" && grid[dc][dr] !== "S") free.push([dc, dr]);
        }
      }
      for (var d = 0; d < want && free.length; d++) {
        var pick = Math.floor(rng() * free.length);
        var cell = free.splice(pick, 1)[0];
        grid[cell[0]][cell[1]] = "C";
        dropped.push(cell[0] * ROWS + cell[1]);
      }
    }

    /* 1. 展开前先数特殊图标。
     * 双龙/三龙这些组合只认【自然落下】的神龙 —— 金龙狂暴是强行把整轴刷成神龙的，
     * 如果也算进去，就会变成"狂暴 → 三龙聚顶 → 龙气充满 + 必中彩金"的连锁，
     * 实测会把聚宝盆打到每 4 转一次、彩金每 5 转一次。 */
    var scatterCount = countSymbol(grid, "S");
    var coinCells = [];
    for (var c = 0; c < REELS; c++) {
      for (var r = 0; r < ROWS; r++) if (grid[c][r] === "C") coinCells.push(c * ROWS + r);
    }
    var coinCount = coinCells.length;
    var naturalWilds = reelsWith(grid, "W");
    var wildCount = naturalWilds.length;

    /* 金龙狂暴：这几转第 2/3/4 轴直接全是神龙（只影响结算，不算组合） */
    var rampageActive = false;
    if (this.rampageLeft > 0) {
      rampageActive = true;
      this.rampageLeft--;
      F.wild.reels.forEach(function (c) {
        for (var r = 0; r < ROWS; r++) grid[c][r] = "W";
      });
    }
    var wildReels = reelsWith(grid, "W");

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
    var effectiveScatters = scatterCount;
    if (scatterCount === F.combos.gongResonance.scatters && wildCount >= F.combos.gongResonance.wilds) {
      combos.push("gongResonance");
      effectiveScatters += F.combos.gongResonance.grantsScatter;
    }
    if (dropped.length) combos.push("coinDrop");
    if (rampageActive) {
      combos.push("rampage");
      spinMultiplier = Math.max(spinMultiplier, F.rampage.multiplier || 1);
    }

    /* 3. 展开神龙后结算 243 Ways。滚雪球倍率只作用在 Ways 上。 */
    var finalGrid = F.wild.expands && wildReels.length ? expandWilds(grid, wildReels) : cloneGrid(grid);
    /* 滚雪球只作用在基础游戏：免费游戏自带递增倍率，两者相乘会直接起飞 */
    var snowMult = isFree ? 1 : this.snowballMult();
    var multiplier = spinMultiplier * (isFree ? this.freeMultiplier : 1) * snowMult;
    var ways = evaluateWays(cfg, finalGrid, bet, multiplier);

    /* 4. 散落赔付 */
    var scatterPay = tableLookup(cfg.SCATTER_PAY, effectiveScatters) * bet;
    var coinPay = tableLookup(cfg.COIN_PAY, coinCount) * bet;

    /* 取整到整数：基础赔率只有零点零几，不取整会出现赢了却显示 $0 的情况。 */
    var spinWin = ways.total + scatterPay + coinPay;
    if (spinWin > 0) spinWin = Math.max(1, Math.round(spinWin));

    /* 5. 滚雪球推进：中了就往上爬一级，没中就清零 */
    var snowBefore = snowMult;
    if (F.snowball) {
      if (ways.total > 0) this.snowballStep = Math.min(F.snowball.steps.length - 1, this.snowballStep + 1);
      else this.snowballStep = 0;
    }

    /* 6. 金龙狂暴触发（本次不生效，从下一转开始） */
    var rampageTriggered = 0;
    if (F.rampage && !rampageActive && rng() < F.rampage.chance) {
      rampageTriggered = F.rampage.spins;
      this.rampageLeft = rampageTriggered;
    }

    /* 7. 能量条 */
    var chargeBefore = this.charge;
    this.charge = chargeFull ? F.charge.max : Math.min(F.charge.max, this.charge + chargeGain);
    var holdTriggered = this.charge >= F.charge.max;

    /* 8. 免费游戏推进 / 触发 */
    var freeTriggered = 0;
    var retriggered = 0;
    if (isFree) {
      this.freeIndex++;
      this.freeSpins--;
      /* 重触发有总量上限：娱乐模式金锣极密，不封顶的话一轮免费游戏能跑到地老天荒 */
      var cap = F.freeSpins.maxTotal || Infinity;
      if (effectiveScatters >= F.freeSpins.retrigger.scatters && this.freeTotal < cap) {
        retriggered = Math.min(F.freeSpins.retrigger.spins, cap - this.freeTotal);
        this.freeSpins += retriggered;
        this.freeTotal += retriggered;
      }
      if (ways.total > 0 && this.freeMultiplier < F.freeSpins.maxMultiplier) {
        this.freeMultiplier = Math.min(F.freeSpins.maxMultiplier,
          this.freeMultiplier + F.freeSpins.stepPerWin);
      }
      this.freeWon += spinWin;
    } else if (F.freeSpins.trigger[Math.min(effectiveScatters, REELS)]) {
      freeTriggered = F.freeSpins.trigger[Math.min(effectiveScatters, REELS)];
    }

    /* 9. 聚宝盆（能量满） */
    var hold = null;
    if (holdTriggered) {
      hold = runHoldAndSpin(cfg, bet, coinCells, rng);
      this.charge = 0;
    }

    var totalWin = spinWin + (hold ? hold.total : 0);
    var capped = false;
    var cap = F.maxWinPerSpin * bet;
    if (F.maxWinPerSpin && totalWin > cap) {
      totalWin = cap;
      capped = true;
    }

    /* 10. 累积彩金。整池带走后从储备里垫出新底金；彩金不受单转封顶约束。 */
    var jackpotHit = false;
    var jackpotWin = 0;
    var comboJackpot = (F.jackpot.onTripleDragon && combos.indexOf("tripleDragon") >= 0) ||
                       (F.jackpot.onTwinDragon && combos.indexOf("twinDragon") >= 0);
    if (comboJackpot || (!isFree && rng() < F.jackpot.chance)) {
      jackpotHit = true;
      jackpotWin = Math.round(this.jackpot);
      var newSeed = Math.min(this.jackpotReserve, F.jackpot.seed);
      this.jackpotReserve -= newSeed;
      this.jackpot = newSeed;
    }
    totalWin += jackpotWin;

    if (isFree) this.freeWon += (hold ? hold.total : 0) + jackpotWin;

    /* 11. 免费游戏收尾 —— 聚宝盆结束后才判断是否退出 */
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
      modeId: this.modeId,
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
      droppedCells: dropped,
      combos: combos,
      spinMultiplier: spinMultiplier,
      snowball: { mult: snowBefore, step: this.snowballStep },
      rampage: { active: rampageActive, triggered: rampageTriggered, left: this.rampageLeft },
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
      tier: winTier(cfg, totalWin, bet),
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
