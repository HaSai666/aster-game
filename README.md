# Aster Game

霓虹宇宙老虎机：一个只使用虚拟金币的 5 轴、243 Ways 解压小游戏。

## 运行

直接用浏览器打开 index.html 即可。为了让 GitHub Pages 和本地浏览器都能正常加载，PixiJS 使用 CDN；如果 CDN 或 WebGL 不可用，游戏会自动切换到 DOM/CSS 盘面。

本地预览也可以运行任意静态文件服务器，例如：

    python -m http.server 8000

然后打开 http://localhost:8000/。

## 发布 GitHub Pages

把仓库推送到 GitHub，在仓库设置中将 Pages 的来源设为分支根目录（或 Actions 静态部署），即可发布根目录的 index.html。

设计规格见 docs/specs/2026-09-28-neon-cosmic-slots-design.html。

游戏只保存浏览器本地的虚拟金币、成就和设置，不接入账号、支付、提现或兑换。
