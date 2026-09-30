"use strict";
/* ------------------------------------------------------------------
 * 蒙特卡洛验证：跑的是 js/engine.js —— 也就是游戏里真正在用的那份代码。
 * 用法（headless）：
 *   chrome --headless --disable-gpu --dump-dom "file:///.../tools/sim.html?spins=1000000"
 * 或者直接用浏览器打开 tools/sim.html。
 * ------------------------------------------------------------------ */
(function () {
  var CONFIG = window.ASTER_CONFIG;
  var ENGINE = window.ASTER_ENGINE;

  /* mulberry32：短小、统计性质经过验证的 32 位 PRNG。
   * （第一版用的自制 xorshift 变体在连续取值间有相关性，会让多图标同现
   *   的概率被系统性低估 —— 模拟器的随机源本身必须先站得住。） */
  function seededRng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pct(x) { return (x * 100).toFixed(2) + "%"; }
  function num(x, d) { return Number(x).toFixed(d === undefined ? 2 : d); }

  function run(spins, seed) {
    var bet = 10;
    var engine = new ENGINE.SlotEngine({ rng: seededRng(seed) });
    var totalBet = 0, totalWin = 0;
    var baseSpins = 0, freeSpinsPlayed = 0;
    var paidRounds = 0, rounds = 0;
    var ldw = 0;                       // 赢了但少于下注（loss disguised as win）
    var acc = { ways: 0, scatter: 0, coin: 0, hold: 0, freeWays: 0, freeScatter: 0, freeCoin: 0, freeHold: 0 };
    var freeTriggers = 0, holdTriggers = 0, grands = 0;
    var jackpotHits = 0, jackpotPaid = 0, jackpotPeak = 0;
    var comboCount = {};
    var maxRound = 0, maxSingle = 0;
    var roundWin = 0, sumSq = 0;
    var buckets = [0, 0, 0, 0, 0, 0, 0, 0];   // 0 / <1 / 1-3 / 3-10 / 10-25 / 25-50 / 50-100 / 100+
    var holdWinSum = 0, holdCoinSum = 0;
    var freeWinSum = 0;
    var perSymbol = {};     // 每个图标按连线长度贡献多少 RTP
    var wildSpins = 0, wildReelHits = 0;
    CONFIG.PAYING.forEach(function (k) { perSymbol[k] = { 3: 0, 4: 0, 5: 0, hits: 0 }; });

    function bucketFor(ratio) {
      if (ratio <= 0) return 0;
      if (ratio < 1) return 1;
      if (ratio < 3) return 2;
      if (ratio < 10) return 3;
      if (ratio < 25) return 4;
      if (ratio < 50) return 5;
      if (ratio < 100) return 6;
      return 7;
    }

    for (var i = 0; i < spins; i++) {
      var wasFree = engine.mode === "free";
      if (!wasFree) {
        totalBet += bet;
        baseSpins++;
        roundWin = 0;
        rounds++;
      } else {
        freeSpinsPlayed++;
      }

      var r = engine.play(bet);
      totalWin += r.totalWin;
      roundWin += r.totalWin;

      if (wasFree) {
        acc.freeWays += r.waysPay; acc.freeScatter += r.scatterPay; acc.freeCoin += r.coinPay;
        acc.freeHold += r.hold ? r.hold.total : 0;
      } else {
        acc.ways += r.waysPay; acc.scatter += r.scatterPay; acc.coin += r.coinPay;
        acc.hold += r.hold ? r.hold.total : 0;
      }

      r.combos.forEach(function (k) { comboCount[k] = (comboCount[k] || 0) + 1; });
      r.wins.forEach(function (w) {
        perSymbol[w.symbol][w.reels] += w.amount;
        perSymbol[w.symbol].hits++;
      });
      if (r.wildCount) { wildSpins++; wildReelHits += r.wildCount; }
      if (r.free.triggered) freeTriggers++;
      if (r.hold) {
        holdTriggers++;
        holdWinSum += r.hold.total;
        holdCoinSum += r.hold.filled;
        if (r.hold.grand) grands++;
      }
      if (r.jackpot.hit) { jackpotHits++; jackpotPaid += r.jackpot.win; }
      if (r.jackpot.pot > jackpotPeak) jackpotPeak = r.jackpot.pot;
      if (r.free.ended) freeWinSum += r.free.won;
      if (r.totalWin / bet > maxSingle) maxSingle = r.totalWin / bet;

      /* 一"轮"= 一次付费旋转 + 它引发的所有免费旋转 */
      var roundOver = engine.mode !== "free";
      if (roundOver) {
        var ratio = roundWin / bet;
        if (roundWin > 0) paidRounds++;
        if (roundWin > 0 && roundWin < bet) ldw++;
        if (ratio > maxRound) maxRound = ratio;
        sumSq += ratio * ratio;
        buckets[bucketFor(ratio)]++;
      }
    }

    var rtp = totalWin / totalBet;
    var meanRound = totalWin / rounds / bet;
    var variance = sumSq / rounds - meanRound * meanRound;

    var lines = [];
    lines.push("=== 金龙聚宝 · 数学验证 ===");
    lines.push("旋转总数        " + spins.toLocaleString() + "  (付费 " + baseSpins.toLocaleString() + " / 免费 " + freeSpinsPlayed.toLocaleString() + ")");
    lines.push("随机种子        " + seed);
    lines.push("");
    lines.push("RTP             " + pct(rtp));
    lines.push("命中率(按轮)    " + pct(paidRounds / rounds));
    lines.push("其中小于下注    " + pct(ldw / rounds) + "   ← 这部分不播放中奖庆祝");
    lines.push("单轮标准差      " + num(Math.sqrt(Math.max(0, variance))) + "   (波动性指标)");
    lines.push("最大单轮        " + num(maxRound, 1) + "×   最大单转 " + num(maxSingle, 1) + "×");
    lines.push("");
    lines.push("--- RTP 构成 ---");
    lines.push("基础 243Ways    " + pct(acc.ways / totalBet));
    lines.push("基础 金锣散赔   " + pct(acc.scatter / totalBet));
    lines.push("基础 钱币散赔   " + pct(acc.coin / totalBet));
    lines.push("基础 聚宝盆     " + pct(acc.hold / totalBet));
    lines.push("免费 243Ways    " + pct(acc.freeWays / totalBet));
    lines.push("免费 金锣散赔   " + pct(acc.freeScatter / totalBet));
    lines.push("免费 钱币散赔   " + pct(acc.freeCoin / totalBet));
    lines.push("免费 聚宝盆     " + pct(acc.freeHold / totalBet));
    lines.push("累积彩金        " + pct(jackpotPaid / totalBet) + "   (投入 " + pct(CONFIG.FEATURES.jackpot.contribution) + ")");
    lines.push("");
    lines.push("--- 玩法频率 ---");
    lines.push("龙门免费游戏    每 " + num(baseSpins / Math.max(1, freeTriggers), 0) + " 转一次   (共 " + freeTriggers.toLocaleString() + " 次, 平均产出 " + num(freeWinSum / Math.max(1, freeTriggers) / bet, 1) + "×)");
    lines.push("聚宝盆          每 " + num(spins / Math.max(1, holdTriggers), 0) + " 转一次   (共 " + holdTriggers.toLocaleString() + " 次, 平均 " + num(holdWinSum / Math.max(1, holdTriggers) / bet, 1) + "× / " + num(holdCoinSum / Math.max(1, holdTriggers), 1) + " 枚)");
    lines.push("大满贯(15格)    " + grands.toLocaleString() + " 次  = 每 " + num(spins / Math.max(1, grands), 0) + " 转");
    lines.push("彩金命中        每 " + num(spins / Math.max(1, jackpotHits), 0) + " 转一次   (平均 " + num(jackpotPaid / Math.max(1, jackpotHits) / bet, 1) + "× / 峰值 " + num(jackpotPeak / bet, 0) + "×)");
    Object.keys(comboCount).sort().forEach(function (k) {
      lines.push("组合 " + (k + "            ").slice(0, 14) + "每 " + num(spins / comboCount[k], 0) + " 转一次");
    });
    lines.push("");
    lines.push("--- 逐图标 RTP 贡献（含免费游戏与倍率） ---");
    lines.push("图标        3连      4连      5连      合计     命中频率");
    CONFIG.PAYING.forEach(function (k) {
      var s = perSymbol[k];
      var sum = s[3] + s[4] + s[5];
      lines.push(
        (CONFIG.SYMBOLS[k].name + "        ").slice(0, 8) +
        (pct(s[3] / totalBet) + "       ").slice(0, 9) +
        (pct(s[4] / totalBet) + "       ").slice(0, 9) +
        (pct(s[5] / totalBet) + "       ").slice(0, 9) +
        (pct(sum / totalBet) + "       ").slice(0, 9) +
        "每 " + num(spins / Math.max(1, s.hits), 1) + " 转"
      );
    });
    lines.push("神龙落轴        " + pct(wildSpins / spins) + " 的旋转有神龙，平均 " + num(wildReelHits / Math.max(1, wildSpins), 2) + " 轴");
    lines.push("");
    lines.push("--- 单轮回报分布 ---");
    var names = ["0×(未中)", "0-1×", "1-3×", "3-10×", "10-25×", "25-50×", "50-100×", "100×+"];
    buckets.forEach(function (n, idx) {
      var bar = "#".repeat(Math.round(n / rounds * 120));
      lines.push((names[idx] + "          ").slice(0, 10) + (pct(n / rounds) + "      ").slice(0, 8) + bar);
    });
    lines.push("");
    lines.push("--- 轮带长度 ---");
    lines.push("base " + CONFIG.STRIPS.base.map(function (s) { return s.length; }).join(" / ") +
      "    free " + CONFIG.STRIPS.free.map(function (s) { return s.length; }).join(" / "));
    return lines.join("\n");
  }

  var params = new URLSearchParams(location.search);
  var spins = Number(params.get("spins") || 400000);
  var seedList = (params.get("seeds") || "12345").split(",").map(Number);
  var out = [];
  seedList.forEach(function (seed) {
    var t0 = Date.now();
    out.push(run(spins, seed));
    out.push("耗时 " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
    out.push("");
  });
  document.getElementById("out").textContent = out.join("\n");
})();
