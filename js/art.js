/* ------------------------------------------------------------------
 * 金龙聚宝 · 图标绘制
 * 十个图标全部是 Canvas 矢量手绘，没有图片素材。
 * 统一美术语言：金箔浮雕 —— 主体走金属渐变，底部压深色轮廓，
 * 顶部留一道高光，剪影优先于细节，缩到 40px 也能一眼认出是什么。
 * 所有画笔都以 (0,0) 为中心、在 ±size/2 的方框内作画。
 * ------------------------------------------------------------------ */
(function (root) {
  "use strict";

  /* ---------- 颜色工具 ---------- */
  function hexToRgb(hex) {
    var h = hex.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbStr(c, alpha) {
    return "rgba(" + Math.round(c.r) + "," + Math.round(c.g) + "," + Math.round(c.b) + "," + (alpha === undefined ? 1 : alpha) + ")";
  }
  function mix(a, b, t) {
    var x = hexToRgb(a), y = hexToRgb(b);
    return { r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t };
  }
  function lighten(hex, t) { return rgbStr(mix(hex, "#ffffff", t)); }
  function darken(hex, t) { return rgbStr(mix(hex, "#1a0607", t)); }

  /* 金属渐变：亮 → 本色 → 暗 → 回弹一点亮，这一下"回弹"是金属感的来源。 */
  function metal(ctx, size, color, accent) {
    var g = ctx.createLinearGradient(0, -size * 0.5, 0, size * 0.5);
    g.addColorStop(0, lighten(accent || color, 0.55));
    g.addColorStop(0.28, lighten(color, 0.18));
    g.addColorStop(0.52, color);
    g.addColorStop(0.74, darken(color, 0.42));
    g.addColorStop(1, lighten(color, 0.1));
    return g;
  }

  function goldMetal(ctx, size) {
    var g = ctx.createLinearGradient(0, -size * 0.5, 0, size * 0.5);
    g.addColorStop(0, "#fff3c4");
    g.addColorStop(0.25, "#ffd766");
    g.addColorStop(0.5, "#e8b640");
    g.addColorStop(0.72, "#a86f14");
    g.addColorStop(0.9, "#f0c85a");
    g.addColorStop(1, "#ffe08a");
    return g;
  }

  /* 描边 + 填充的通用收尾：深色外轮廓让剪影在任何背景上都站得住。 */
  function seal(ctx, size, fill, rim, lineWidth) {
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineJoin = "round";
    ctx.lineWidth = lineWidth || size * 0.035;
    ctx.strokeStyle = rim;
    ctx.stroke();
  }

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /* 顶部弧形高光，给平面图形一点"鼓起来"的错觉。 */
  function topGloss(ctx, size, strength) {
    ctx.save();
    ctx.globalCompositeOperation = "source-atop";
    var g = ctx.createLinearGradient(0, -size * 0.5, 0, size * 0.05);
    g.addColorStop(0, "rgba(255,255,255," + (strength || 0.38) + ")");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(-size, -size, size * 2, size * 2);
    ctx.restore();
  }

  function cjkFont(px, weight) {
    return (weight || 700) + " " + px + 'px "Noto Serif SC","Source Han Serif SC","Songti SC","SimSun","STSong","Microsoft YaHei",serif';
  }

  /* ---------- 单个图标 ---------- */

  /* 铜钱：外圆内方，边缘一圈联珠。青铜色，哑光。 */
  function drawCoin(ctx, s, sym) {
    var r = s * 0.40;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.moveTo(-s * 0.13, -s * 0.13);
    ctx.lineTo(s * 0.13, -s * 0.13);
    ctx.lineTo(s * 0.13, s * 0.13);
    ctx.lineTo(-s * 0.13, s * 0.13);
    ctx.closePath();
    ctx.fillStyle = metal(ctx, s, sym.color, sym.accent);
    ctx.fill("evenodd");
    ctx.lineWidth = s * 0.035;
    ctx.strokeStyle = sym.rim;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    roundRect(ctx, -s * 0.13, -s * 0.13, s * 0.26, s * 0.26, s * 0.02); ctx.stroke();
    /* 内圈联珠 */
    ctx.fillStyle = rgbStr(mix(sym.accent, "#ffffff", 0.3), 0.8);
    for (var i = 0; i < 12; i++) {
      var a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82, s * 0.018, 0, Math.PI * 2);
      ctx.fill();
    }
    topGloss(ctx, s, 0.3);
  }

  /* 福字：菱形匾额 + 金边 + 反贴的"福"。 */
  function drawFu(ctx, s, sym) {
    ctx.save();
    ctx.rotate(Math.PI / 4);
    roundRect(ctx, -s * 0.30, -s * 0.30, s * 0.60, s * 0.60, s * 0.06);
    seal(ctx, s, metal(ctx, s, sym.color, sym.accent), sym.rim);
    roundRect(ctx, -s * 0.245, -s * 0.245, s * 0.49, s * 0.49, s * 0.045);
    ctx.lineWidth = s * 0.02;
    ctx.strokeStyle = "rgba(255,221,130,.85)";
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#ffe9a8";
    ctx.strokeStyle = "rgba(90,15,20,.65)";
    ctx.lineWidth = s * 0.02;
    ctx.font = cjkFont(Math.round(s * 0.40));
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeText("福", 0, s * 0.015);
    ctx.fillText("福", 0, s * 0.015);
    topGloss(ctx, s, 0.22);
  }

  /* 宫灯：上下金冠 + 灯身竖棱 + 流苏，内部有暖光。 */
  function drawLantern(ctx, s, sym) {
    var bodyW = s * 0.34, bodyH = s * 0.30;
    /* 流苏 */
    ctx.strokeStyle = "#f4c04a";
    ctx.lineWidth = s * 0.022;
    ctx.lineCap = "round";
    for (var i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * s * 0.035, s * 0.34);
      ctx.lineTo(i * s * 0.055, s * 0.46);
      ctx.stroke();
    }
    /* 灯身 */
    ctx.beginPath();
    ctx.ellipse(0, 0, bodyW, bodyH, 0, 0, Math.PI * 2);
    seal(ctx, s, metal(ctx, s, sym.color, sym.accent), sym.rim);
    /* 内部暖光 */
    var glow = ctx.createRadialGradient(0, -s * 0.04, 0, 0, 0, bodyW);
    glow.addColorStop(0, "rgba(255,246,200,.55)");
    glow.addColorStop(1, "rgba(255,200,90,0)");
    ctx.save();
    ctx.beginPath(); ctx.ellipse(0, 0, bodyW, bodyH, 0, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = glow;
    ctx.fillRect(-s, -s, s * 2, s * 2);
    /* 竖棱 */
    ctx.strokeStyle = "rgba(150,50,10,.45)";
    ctx.lineWidth = s * 0.016;
    for (var k = -2; k <= 2; k++) {
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.abs(k) * bodyW * 0.3 + 0.001, bodyH, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    /* 金冠 */
    [-1, 1].forEach(function (dir) {
      roundRect(ctx, -s * 0.13, dir * s * 0.30 - s * 0.045, s * 0.26, s * 0.09, s * 0.025);
      ctx.fillStyle = metal(ctx, s * 0.4, "#e8b640", "#fff0b8");
      ctx.fill();
      ctx.lineWidth = s * 0.018; ctx.strokeStyle = "#8a5a0a"; ctx.stroke();
    });
    /* 提钩 */
    ctx.beginPath();
    ctx.arc(0, -s * 0.40, s * 0.05, Math.PI * 0.15, Math.PI * 0.85, true);
    ctx.strokeStyle = "#e8b640"; ctx.lineWidth = s * 0.022; ctx.stroke();
    topGloss(ctx, s, 0.26);
  }

  /* 玉葫芦：上小下大的双球轮廓 + 束腰红绸 + 小柄。
   * （试过玉如意，云头在 56px 下会糊成一根横杠，葫芦的剪影硬得多，
   *   而且"葫芦"谐音福禄，主题上同样成立。） */
  function drawGourd(ctx, s, sym) {
    var fill = metal(ctx, s, sym.color, sym.accent);

    /* 柄 */
    ctx.beginPath();
    roundRect(ctx, -s * 0.035, -s * 0.46, s * 0.07, s * 0.12, s * 0.03);
    seal(ctx, s, "#7ba05b", "#3d5a2a", s * 0.022);

    /* 葫芦本体 */
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.38);
    ctx.bezierCurveTo(s * 0.17, -s * 0.38, s * 0.21, -s * 0.21, s * 0.12, -s * 0.09);
    ctx.bezierCurveTo(s * 0.07, -s * 0.03, s * 0.32, s * 0.01, s * 0.32, s * 0.17);
    ctx.bezierCurveTo(s * 0.32, s * 0.36, s * 0.17, s * 0.43, 0, s * 0.43);
    ctx.bezierCurveTo(-s * 0.17, s * 0.43, -s * 0.32, s * 0.36, -s * 0.32, s * 0.17);
    ctx.bezierCurveTo(-s * 0.32, s * 0.01, -s * 0.07, -s * 0.03, -s * 0.12, -s * 0.09);
    ctx.bezierCurveTo(-s * 0.21, -s * 0.21, -s * 0.17, -s * 0.38, 0, -s * 0.38);
    ctx.closePath();
    seal(ctx, s, fill, sym.rim, s * 0.034);

    /* 束腰红绸 + 两条飘带 */
    ctx.beginPath();
    roundRect(ctx, -s * 0.16, -s * 0.10, s * 0.32, s * 0.085, s * 0.035);
    ctx.fillStyle = "#c0202c";
    ctx.fill();
    ctx.lineWidth = s * 0.018;
    ctx.strokeStyle = "#7d1119";
    ctx.stroke();
    [-1, 1].forEach(function (dir) {
      ctx.beginPath();
      ctx.moveTo(dir * s * 0.13, -s * 0.06);
      ctx.quadraticCurveTo(dir * s * 0.30, s * 0.00, dir * s * 0.27, s * 0.10);
      ctx.quadraticCurveTo(dir * s * 0.20, s * 0.02, dir * s * 0.12, s * 0.00);
      ctx.closePath();
      ctx.fillStyle = "#d8353f";
      ctx.fill();
      ctx.lineWidth = s * 0.014;
      ctx.strokeStyle = "#7d1119";
      ctx.stroke();
    });

    /* 玉的通透高光 */
    ctx.fillStyle = "rgba(255,255,255,.5)";
    ctx.beginPath();
    ctx.ellipse(-s * 0.07, -s * 0.27, s * 0.045, s * 0.075, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-s * 0.14, s * 0.14, s * 0.06, s * 0.11, 0.25, 0, Math.PI * 2);
    ctx.fill();
    topGloss(ctx, s, 0.24);
  }

  /* 锦鲤：弓身 + 分叉尾 + 背鳍，身上几道鳞弧。 */
  function drawKoi(ctx, s, sym) {
    ctx.save();
    ctx.rotate(-0.22);
    /* 尾 */
    ctx.beginPath();
    ctx.moveTo(-s * 0.10, s * 0.02);
    ctx.quadraticCurveTo(-s * 0.34, -s * 0.22, -s * 0.44, -s * 0.06);
    ctx.quadraticCurveTo(-s * 0.36, s * 0.02, -s * 0.34, s * 0.06);
    ctx.quadraticCurveTo(-s * 0.36, s * 0.22, -s * 0.44, s * 0.26);
    ctx.quadraticCurveTo(-s * 0.26, s * 0.24, -s * 0.10, s * 0.10);
    ctx.closePath();
    seal(ctx, s, metal(ctx, s, sym.color, sym.accent), sym.rim, s * 0.026);
    /* 背鳍 */
    ctx.beginPath();
    ctx.moveTo(-s * 0.05, -s * 0.10);
    ctx.quadraticCurveTo(s * 0.02, -s * 0.34, s * 0.16, -s * 0.20);
    ctx.quadraticCurveTo(s * 0.06, -s * 0.14, 0, -s * 0.06);
    ctx.closePath();
    seal(ctx, s, metal(ctx, s, sym.color, sym.accent), sym.rim, s * 0.024);
    /* 身体 */
    ctx.beginPath();
    ctx.moveTo(-s * 0.12, -s * 0.02);
    ctx.bezierCurveTo(s * 0.02, -s * 0.22, s * 0.30, -s * 0.20, s * 0.40, s * 0.00);
    ctx.bezierCurveTo(s * 0.32, s * 0.20, s * 0.04, s * 0.24, -s * 0.12, s * 0.12);
    ctx.closePath();
    seal(ctx, s, metal(ctx, s, sym.color, sym.accent), sym.rim, s * 0.03);
    /* 鳞弧 */
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-s * 0.12, -s * 0.02);
    ctx.bezierCurveTo(s * 0.02, -s * 0.22, s * 0.30, -s * 0.20, s * 0.40, s * 0.00);
    ctx.bezierCurveTo(s * 0.32, s * 0.20, s * 0.04, s * 0.24, -s * 0.12, s * 0.12);
    ctx.closePath();
    ctx.clip();
    ctx.strokeStyle = "rgba(255,255,255,.34)";
    ctx.lineWidth = s * 0.018;
    for (var i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(s * (0.04 + i * 0.10), s * 0.02, s * 0.11, -Math.PI * 0.62, Math.PI * 0.62);
      ctx.stroke();
    }
    ctx.restore();
    /* 眼 */
    ctx.fillStyle = "#2a103f";
    ctx.beginPath(); ctx.arc(s * 0.30, -s * 0.045, s * 0.032, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.9)";
    ctx.beginPath(); ctx.arc(s * 0.315, -s * 0.055, s * 0.012, 0, Math.PI * 2); ctx.fill();
    /* 须 */
    ctx.strokeStyle = sym.rim; ctx.lineWidth = s * 0.016; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(s * 0.39, s * 0.03);
    ctx.quadraticCurveTo(s * 0.47, s * 0.10, s * 0.42, s * 0.19);
    ctx.stroke();
    ctx.restore();
    topGloss(ctx, s, 0.22);
  }

  /* 元宝：船形底 + 两只上翘的角 + 中间凸起的宝颈。
   * 关键是那两只角 —— 没有角就只是个面包。 */
  function drawIngot(ctx, s, sym) {
    var fill = metal(ctx, s, sym.color, sym.accent);

    /* 两只翘角（先画，让船体压住根部） */
    [-1, 1].forEach(function (dir) {
      ctx.beginPath();
      ctx.moveTo(dir * s * 0.20, s * 0.04);
      ctx.quadraticCurveTo(dir * s * 0.40, -s * 0.10, dir * s * 0.46, -s * 0.28);
      ctx.quadraticCurveTo(dir * s * 0.30, -s * 0.20, dir * s * 0.22, -s * 0.06);
      ctx.closePath();
      seal(ctx, s, fill, sym.rim, s * 0.028);
    });

    /* 中间宝颈 */
    ctx.beginPath();
    roundRect(ctx, -s * 0.19, -s * 0.28, s * 0.38, s * 0.30, s * 0.11);
    seal(ctx, s, fill, sym.rim, s * 0.03);

    /* 船体 */
    ctx.beginPath();
    ctx.moveTo(-s * 0.44, s * 0.02);
    ctx.quadraticCurveTo(-s * 0.46, s * 0.24, -s * 0.22, s * 0.30);
    ctx.lineTo(s * 0.22, s * 0.30);
    ctx.quadraticCurveTo(s * 0.46, s * 0.24, s * 0.44, s * 0.02);
    ctx.quadraticCurveTo(s * 0.24, s * 0.10, 0, s * 0.10);
    ctx.quadraticCurveTo(-s * 0.24, s * 0.10, -s * 0.44, s * 0.02);
    ctx.closePath();
    seal(ctx, s, fill, sym.rim, s * 0.034);

    /* 船体上沿的一道亮边，把"颈"和"身"分开 */
    ctx.beginPath();
    ctx.moveTo(-s * 0.40, s * 0.035);
    ctx.quadraticCurveTo(0, s * 0.125, s * 0.40, s * 0.035);
    ctx.lineWidth = s * 0.026;
    ctx.strokeStyle = "rgba(255,247,204,.6)";
    ctx.stroke();

    /* 宝颈上的高光 */
    ctx.fillStyle = "rgba(255,255,255,.4)";
    ctx.beginPath();
    ctx.ellipse(-s * 0.06, -s * 0.20, s * 0.075, s * 0.035, -0.18, 0, Math.PI * 2);
    ctx.fill();
    topGloss(ctx, s, 0.3);
  }

  /* 貔貅：正面兽首。鬃毛只绕下半圈（上一版绕满一圈，结果像向日葵）。 */
  function drawPixiu(ctx, s, sym) {
    var fill = metal(ctx, s, sym.color, sym.accent);

    /* 鬃毛：从左耳下方绕过下巴到右耳下方 */
    ctx.beginPath();
    for (var i = 0; i <= 9; i++) {
      var a = Math.PI * (0.12 + (i / 9) * 0.76);   // 只走下半圈
      ctx.moveTo(Math.cos(a) * s * 0.40, Math.sin(a) * s * 0.34 + s * 0.04);
      ctx.arc(Math.cos(a) * s * 0.40, Math.sin(a) * s * 0.34 + s * 0.04, s * 0.095, 0, Math.PI * 2);
    }
    ctx.fillStyle = "#c8922b";
    ctx.fill();
    ctx.lineWidth = s * 0.022;
    ctx.strokeStyle = sym.rim;
    ctx.stroke();

    /* 双角：明确越过头顶再向外扫，不越过头顶就看不出是角 */
    [-1, 1].forEach(function (dir) {
      ctx.beginPath();
      ctx.moveTo(dir * s * 0.11, -s * 0.24);
      ctx.quadraticCurveTo(dir * s * 0.18, -s * 0.56, dir * s * 0.38, -s * 0.44);
      ctx.quadraticCurveTo(dir * s * 0.28, -s * 0.34, dir * s * 0.27, -s * 0.19);
      ctx.closePath();
      seal(ctx, s, metal(ctx, s, "#e8b640", "#fff3c4"), sym.rim, s * 0.026);
    });

    /* 耳 */
    [-1, 1].forEach(function (dir) {
      ctx.beginPath();
      ctx.ellipse(dir * s * 0.30, -s * 0.05, s * 0.075, s * 0.11, dir * 0.4, 0, Math.PI * 2);
      seal(ctx, s, "#d9a84a", sym.rim, s * 0.022);
    });

    /* 脸：宽而方，下颌收成圆角 */
    ctx.beginPath();
    ctx.moveTo(-s * 0.31, -s * 0.12);
    ctx.quadraticCurveTo(-s * 0.33, s * 0.16, -s * 0.14, s * 0.30);
    ctx.quadraticCurveTo(0, s * 0.37, s * 0.14, s * 0.30);
    ctx.quadraticCurveTo(s * 0.33, s * 0.16, s * 0.31, -s * 0.12);
    ctx.quadraticCurveTo(s * 0.22, -s * 0.31, 0, -s * 0.29);
    ctx.quadraticCurveTo(-s * 0.22, -s * 0.31, -s * 0.31, -s * 0.12);
    ctx.closePath();
    seal(ctx, s, fill, sym.rim, s * 0.034);

    /* 红眉 */
    [-1, 1].forEach(function (dir) {
      ctx.beginPath();
      ctx.moveTo(dir * s * 0.05, -s * 0.16);
      ctx.quadraticCurveTo(dir * s * 0.19, -s * 0.25, dir * s * 0.27, -s * 0.11);
      ctx.lineWidth = s * 0.042;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#b8321d";
      ctx.stroke();
    });

    /* 眼：大而圆，瞳孔偏内侧显得凶 */
    [-1, 1].forEach(function (dir) {
      ctx.beginPath();
      ctx.ellipse(dir * s * 0.155, -s * 0.035, s * 0.085, s * 0.065, dir * -0.18, 0, Math.PI * 2);
      ctx.fillStyle = "#fffaf0";
      ctx.fill();
      ctx.lineWidth = s * 0.024;
      ctx.strokeStyle = sym.rim;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(dir * s * 0.125, -s * 0.03, s * 0.038, 0, Math.PI * 2);
      ctx.fillStyle = "#24120a";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(dir * s * 0.135, -s * 0.048, s * 0.013, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,.9)";
      ctx.fill();
    });

    /* 吻部 + 鼻 + 獠牙 */
    ctx.beginPath();
    roundRect(ctx, -s * 0.155, s * 0.06, s * 0.31, s * 0.18, s * 0.075);
    seal(ctx, s, "rgba(255,250,236,.95)", sym.rim, s * 0.026);
    ctx.beginPath();
    ctx.moveTo(-s * 0.065, s * 0.105);
    ctx.quadraticCurveTo(0, s * 0.055, s * 0.065, s * 0.105);
    ctx.quadraticCurveTo(0, s * 0.165, -s * 0.065, s * 0.105);
    ctx.fillStyle = "#b8321d";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    [-1, 1].forEach(function (dir) {
      ctx.beginPath();
      ctx.moveTo(dir * s * 0.075, s * 0.20);
      ctx.lineTo(dir * s * 0.125, s * 0.20);
      ctx.lineTo(dir * s * 0.095, s * 0.30);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = s * 0.016;
      ctx.strokeStyle = sym.rim;
      ctx.stroke();
    });
    topGloss(ctx, s, 0.28);
  }

  /* 神龙（Wild）：侧面龙首，面朝右。
   * 上一版把鬃毛做成放射状尖刺，结果像食蚁兽 —— 这一版改成向后飘的火焰卷，
   * 并把头颅加宽、吻部缩短，让它一眼就是"龙"。 */
  function drawDragon(ctx, s, sym) {
    var fill = metal(ctx, s, sym.color, "#fff3c4");

    /* 向后飘的火焰鬃（画在头后面） */
    [[-0.12, -0.20, -0.46, -0.26, -0.30, -0.06],
     [-0.16, -0.06, -0.50, -0.02, -0.28, 0.08],
     [-0.14, 0.06, -0.44, 0.22, -0.22, 0.20]].forEach(function (p) {
      ctx.beginPath();
      ctx.moveTo(s * p[0], s * p[1]);
      ctx.quadraticCurveTo(s * p[2], s * p[3], s * p[4], s * p[5]);
      ctx.quadraticCurveTo(s * (p[2] * 0.55), s * (p[3] * 0.5 + 0.06), s * p[0], s * p[1]);
      ctx.closePath();
      ctx.fillStyle = "#d8362f";
      ctx.fill();
      ctx.lineWidth = s * 0.02;
      ctx.strokeStyle = sym.rim;
      ctx.stroke();
    });

    /* 鹿角：两枝带分叉 */
    [[0.02, -0.26, -0.10, -0.46], [0.16, -0.24, 0.14, -0.46]].forEach(function (p) {
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(s * p[0], s * p[1]);
      ctx.quadraticCurveTo(s * (p[0] - 0.06), s * (p[3] + 0.06), s * p[2], s * p[3]);
      ctx.lineWidth = s * 0.05;
      ctx.strokeStyle = sym.rim;
      ctx.stroke();
      ctx.lineWidth = s * 0.032;
      ctx.strokeStyle = "#f0c85a";
      ctx.stroke();
      /* 分叉 */
      ctx.beginPath();
      ctx.moveTo(s * (p[0] + p[2]) / 2 - s * 0.01, s * (p[1] + p[3]) / 2);
      ctx.lineTo(s * (p[2] + (p[2] < 0 ? -0.10 : 0.10)), s * (p[3] + 0.06));
      ctx.lineWidth = s * 0.038;
      ctx.strokeStyle = sym.rim;
      ctx.stroke();
      ctx.lineWidth = s * 0.024;
      ctx.strokeStyle = "#f0c85a";
      ctx.stroke();
    });

    /* 头颅 + 上颌 */
    ctx.beginPath();
    ctx.moveTo(-s * 0.20, s * 0.00);
    ctx.quadraticCurveTo(-s * 0.20, -s * 0.28, s * 0.04, -s * 0.30);   // 后脑到额顶
    ctx.quadraticCurveTo(s * 0.22, -s * 0.31, s * 0.26, -s * 0.16);    // 额头下到眉骨
    ctx.quadraticCurveTo(s * 0.34, -s * 0.20, s * 0.44, -s * 0.14);    // 上翘的鼻梁
    ctx.quadraticCurveTo(s * 0.50, -s * 0.06, s * 0.42, -s * 0.01);    // 鼻头
    ctx.quadraticCurveTo(s * 0.30, s * 0.02, s * 0.18, s * 0.02);      // 上唇往回
    ctx.quadraticCurveTo(s * 0.00, s * 0.04, -s * 0.10, s * 0.06);
    ctx.closePath();
    seal(ctx, s, fill, sym.rim, s * 0.032);

    /* 下颌（张口） */
    ctx.beginPath();
    ctx.moveTo(-s * 0.06, s * 0.08);
    ctx.quadraticCurveTo(s * 0.16, s * 0.10, s * 0.34, s * 0.14);
    ctx.quadraticCurveTo(s * 0.24, s * 0.24, s * 0.06, s * 0.26);
    ctx.quadraticCurveTo(-s * 0.10, s * 0.26, -s * 0.16, s * 0.14);
    ctx.closePath();
    seal(ctx, s, fill, sym.rim, s * 0.03);

    /* 颌下火焰须 */
    ctx.beginPath();
    ctx.moveTo(-s * 0.06, s * 0.24);
    ctx.quadraticCurveTo(-s * 0.16, s * 0.42, -s * 0.30, s * 0.38);
    ctx.quadraticCurveTo(-s * 0.18, s * 0.32, -s * 0.14, s * 0.20);
    ctx.closePath();
    ctx.fillStyle = "#d8362f";
    ctx.fill();
    ctx.lineWidth = s * 0.02;
    ctx.strokeStyle = sym.rim;
    ctx.stroke();

    /* 长须：从鼻侧向前甩出 */
    ctx.lineCap = "round";
    [[0.42, -0.02, 0.56, 0.10, 0.40, 0.26], [0.40, -0.06, 0.54, -0.20, 0.36, -0.30]].forEach(function (p) {
      ctx.beginPath();
      ctx.moveTo(s * p[0], s * p[1]);
      ctx.quadraticCurveTo(s * p[2], s * p[3], s * p[4], s * p[5]);
      ctx.lineWidth = s * 0.026;
      ctx.strokeStyle = "#f0c85a";
      ctx.stroke();
    });

    /* 红眉 + 眼 */
    ctx.beginPath();
    ctx.moveTo(s * 0.06, -s * 0.21);
    ctx.quadraticCurveTo(s * 0.20, -s * 0.28, s * 0.28, -s * 0.17);
    ctx.lineWidth = s * 0.04;
    ctx.strokeStyle = "#b8321d";
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(s * 0.17, -s * 0.11, s * 0.072, s * 0.055, -0.22, 0, Math.PI * 2);
    ctx.fillStyle = "#fffaf0";
    ctx.fill();
    ctx.lineWidth = s * 0.022;
    ctx.strokeStyle = sym.rim;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(s * 0.195, -s * 0.105, s * 0.032, 0, Math.PI * 2);
    ctx.fillStyle = "#24120a";
    ctx.fill();

    /* 鼻孔 */
    ctx.beginPath();
    ctx.arc(s * 0.405, -s * 0.085, s * 0.024, 0, Math.PI * 2);
    ctx.fillStyle = sym.rim;
    ctx.fill();

    /* 獠牙：上下各一 */
    ctx.fillStyle = "#fffdf4";
    ctx.beginPath();
    ctx.moveTo(s * 0.26, s * 0.01);
    ctx.lineTo(s * 0.33, s * 0.02);
    ctx.lineTo(s * 0.28, s * 0.13);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(s * 0.13, s * 0.19);
    ctx.lineTo(s * 0.19, s * 0.19);
    ctx.lineTo(s * 0.17, s * 0.09);
    ctx.closePath();
    ctx.fill();
    topGloss(ctx, s, 0.3);
  }

  /* 金锣（Scatter）：红木架 + 金盘，盘面同心圈与中心凸起。 */
  function drawGong(ctx, s, sym) {
    /* 架子 */
    ctx.strokeStyle = "#a8252f";
    ctx.lineWidth = s * 0.05; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-s * 0.36, s * 0.40); ctx.lineTo(-s * 0.30, -s * 0.36);
    ctx.lineTo(s * 0.30, -s * 0.36); ctx.lineTo(s * 0.36, s * 0.40);
    ctx.stroke();
    /* 吊绳 */
    ctx.strokeStyle = "#e8b640"; ctx.lineWidth = s * 0.018;
    ctx.beginPath();
    ctx.moveTo(-s * 0.17, -s * 0.34); ctx.lineTo(-s * 0.05, -s * 0.22);
    ctx.moveTo(s * 0.17, -s * 0.34); ctx.lineTo(s * 0.05, -s * 0.22);
    ctx.stroke();
    /* 锣面 */
    ctx.beginPath(); ctx.arc(0, s * 0.06, s * 0.30, 0, Math.PI * 2);
    seal(ctx, s, metal(ctx, s, sym.color, sym.accent), sym.rim, s * 0.034);
    ctx.strokeStyle = "rgba(120,60,10,.42)";
    ctx.lineWidth = s * 0.016;
    [0.72, 0.5].forEach(function (k) {
      ctx.beginPath(); ctx.arc(0, s * 0.06, s * 0.30 * k, 0, Math.PI * 2); ctx.stroke();
    });
    ctx.beginPath(); ctx.arc(0, s * 0.06, s * 0.09, 0, Math.PI * 2);
    ctx.fillStyle = "#fff0bd"; ctx.fill();
    ctx.lineWidth = s * 0.02; ctx.strokeStyle = sym.rim; ctx.stroke();
    topGloss(ctx, s, 0.3);
  }

  /* 招财钱币：亮金圆钱 + 红绸 + 放射光芒，和哑光的铜钱明确区分。 */
  function drawLuckyCoin(ctx, s, sym) {
    /* 放射光 */
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = "#ffe9a0";
    ctx.lineWidth = s * 0.016;
    for (var i = 0; i < 8; i++) {
      var a = (i / 8) * Math.PI * 2 + 0.2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * s * 0.40, Math.sin(a) * s * 0.40);
      ctx.lineTo(Math.cos(a) * s * 0.49, Math.sin(a) * s * 0.49);
      ctx.stroke();
    }
    ctx.restore();
    /* 红绸 */
    ctx.fillStyle = "#c0202c";
    ctx.beginPath();
    ctx.moveTo(-s * 0.06, -s * 0.30);
    ctx.quadraticCurveTo(-s * 0.30, -s * 0.34, -s * 0.36, -s * 0.16);
    ctx.quadraticCurveTo(-s * 0.20, -s * 0.18, -s * 0.10, -s * 0.22);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(s * 0.06, -s * 0.30);
    ctx.quadraticCurveTo(s * 0.30, -s * 0.34, s * 0.36, -s * 0.16);
    ctx.quadraticCurveTo(s * 0.20, -s * 0.18, s * 0.10, -s * 0.22);
    ctx.closePath(); ctx.fill();
    /* 钱体 */
    var r = s * 0.34;
    ctx.beginPath();
    ctx.arc(0, s * 0.04, r, 0, Math.PI * 2);
    ctx.moveTo(-s * 0.10, s * 0.04 - s * 0.10);
    ctx.lineTo(s * 0.10, s * 0.04 - s * 0.10);
    ctx.lineTo(s * 0.10, s * 0.04 + s * 0.10);
    ctx.lineTo(-s * 0.10, s * 0.04 + s * 0.10);
    ctx.closePath();
    ctx.fillStyle = metal(ctx, s, sym.color, sym.accent);
    ctx.fill("evenodd");
    ctx.lineWidth = s * 0.034; ctx.strokeStyle = sym.rim;
    ctx.beginPath(); ctx.arc(0, s * 0.04, r, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = s * 0.024;
    roundRect(ctx, -s * 0.10, s * 0.04 - s * 0.10, s * 0.20, s * 0.20, s * 0.02); ctx.stroke();
    /* 四个方位的小点，暗示"招财进宝" */
    ctx.fillStyle = "#b02a2a";
    [[0, -0.19], [0.19, 0], [0, 0.19], [-0.19, 0]].forEach(function (p) {
      ctx.beginPath();
      ctx.arc(s * p[0], s * 0.04 + s * p[1], s * 0.028, 0, Math.PI * 2);
      ctx.fill();
    });
    topGloss(ctx, s, 0.4);
  }

  var PAINTERS = {
    coin: drawCoin,
    fu: drawFu,
    lantern: drawLantern,
    gourd: drawGourd,
    koi: drawKoi,
    ingot: drawIngot,
    pixiu: drawPixiu,
    dragon: drawDragon,
    gong: drawGong,
    luckycoin: drawLuckyCoin
  };

  /* 画一个图标。size 是它的外接方框边长。
   * 先画到独立的暂存画布再合成 —— topGloss 用的是 source-atop，
   * 直接画在目标上会把高光也糊到底板上。 */
  var SCRATCH = 256;
  var MARGIN = 0.82;          // 留给投影和超出主体的笔画
  var scratch = null;

  function drawSymbol(ctx, key, sym, size) {
    var painter = PAINTERS[sym.shape];
    if (!painter) return;
    if (!scratch) {
      scratch = document.createElement("canvas");
      scratch.width = SCRATCH;
      scratch.height = SCRATCH;
    }
    var c = scratch.getContext("2d");
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, SCRATCH, SCRATCH);
    c.save();
    c.translate(SCRATCH / 2, SCRATCH / 2);
    painter(c, SCRATCH * MARGIN, sym);
    c.restore();
    /* 投影加在合成这一步，只跟着剪影走，不会在图标内部到处结块 */
    var box = size / MARGIN;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.65)";
    ctx.shadowBlur = size * 0.09;
    ctx.shadowOffsetY = size * 0.035;
    ctx.drawImage(scratch, -box / 2, -box / 2, box, box);
    ctx.restore();
  }

  /* 图标底板（漆器格子）。特殊图标用不同的板底色，一眼能分出来。 */
  function drawPlate(ctx, w, h, opts) {
    opts = opts || {};
    var r = Math.min(w, h) * 0.13;
    var g = ctx.createLinearGradient(0, 0, 0, h);
    if (opts.special === "wild") {
      g.addColorStop(0, "#5a1417"); g.addColorStop(0.5, "#3d0d10"); g.addColorStop(1, "#24070a");
    } else if (opts.special === "scatter") {
      g.addColorStop(0, "#4b2a0c"); g.addColorStop(0.5, "#331b07"); g.addColorStop(1, "#1e0f04");
    } else if (opts.special === "coin") {
      g.addColorStop(0, "#4a3308"); g.addColorStop(0.5, "#332204"); g.addColorStop(1, "#1d1302");
    } else {
      g.addColorStop(0, "#2b1114"); g.addColorStop(0.5, "#200c0f"); g.addColorStop(1, "#160709");
    }
    roundRect(ctx, 0, 0, w, h, r);
    ctx.fillStyle = g;
    ctx.fill();
    /* 内嵌金线 */
    roundRect(ctx, w * 0.035, h * 0.03, w * 0.93, h * 0.94, r * 0.8);
    ctx.lineWidth = Math.max(1, w * 0.012);
    ctx.strokeStyle = opts.special ? "rgba(232,182,64,.55)" : "rgba(232,182,64,.22)";
    ctx.stroke();
    /* 外框 */
    roundRect(ctx, 0.5, 0.5, w - 1, h - 1, r);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0,0,0,.6)";
    ctx.stroke();
    /* 顶部一道漆光 */
    var gloss = ctx.createLinearGradient(0, 0, 0, h * 0.45);
    gloss.addColorStop(0, "rgba(255,255,255,.09)");
    gloss.addColorStop(1, "rgba(255,255,255,0)");
    roundRect(ctx, w * 0.04, h * 0.035, w * 0.92, h * 0.4, r * 0.7);
    ctx.fillStyle = gloss;
    ctx.fill();
  }

  root.ASTER_ART = {
    drawSymbol: drawSymbol,
    drawPlate: drawPlate,
    roundRect: roundRect,
    metal: metal,
    goldMetal: goldMetal,
    lighten: lighten,
    darken: darken,
    mix: mix,
    rgbStr: rgbStr,
    hexToRgb: hexToRgb,
    cjkFont: cjkFont
  };
})(typeof window !== "undefined" ? window : globalThis);
