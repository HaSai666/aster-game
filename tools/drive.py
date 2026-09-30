#!/usr/bin/env python3
"""金龙聚宝 · 浏览器端到端检查（CDP 驱动）

headless Chrome 的 --screenshot/--dump-dom 模式下 requestAnimationFrame 基本不推进，
所以滚轮动画、中奖高亮、聚宝盆这些都截不到。这里改用 DevTools Protocol 接管一个
真正在渲染的页面：可以点按钮、等状态、按帧截图。

用法：
    python tools/drive.py                 # 跑默认剧本，截图输出到 tools/_shots/
    python tools/drive.py --keep          # 跑完不关浏览器
"""

import argparse
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

import websocket  # websocket-client

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "tools", "_shots")
PORT = 9333


class Page:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=30)
        self.id = 0

    def send(self, method, **params):
        self.id += 1
        self.ws.send(json.dumps({"id": self.id, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self.id:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def js(self, expression, await_promise=False):
        res = self.send(
            "Runtime.evaluate",
            expression=expression,
            returnByValue=True,
            awaitPromise=await_promise,
        )
        if res.get("exceptionDetails"):
            raise RuntimeError(json.dumps(res["exceptionDetails"])[:600])
        return res["result"].get("value")

    def shot(self, name):
        os.makedirs(SHOTS, exist_ok=True)
        data = self.send("Page.captureScreenshot", format="png")["data"]
        path = os.path.join(SHOTS, name + ".png")
        with open(path, "wb") as fh:
            fh.write(base64.b64decode(data))
        print(f"  -> {name}.png")
        return path

    def wait_for(self, expression, timeout=40, label=""):
        """轮询一个返回 bool 的表达式。"""
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.js(expression):
                return True
            time.sleep(0.12)
        raise TimeoutError(f"等待超时: {label or expression}")

    def press_while(self, condition, timeout=180, label="", shots=None):
        """手动环节：只要游戏在等玩家按，就替玩家按下去，直到 condition 为假。
        shots 是 {截图名: 触发表达式}，抓到一次就不再抓。"""
        taken = set()
        deadline = time.time() + timeout
        presses = 0
        while time.time() < deadline:
            if shots:
                for name, expr in list(shots.items()):
                    if name not in taken and self.js(expr):
                        self.shot(name)
                        taken.add(name)
            if not self.js(condition):
                return presses
            if self.js("window.__jinlong.awaitingPress"):
                self.js("document.getElementById('spin-btn').click()")
                presses += 1
                time.sleep(0.25)
            else:
                time.sleep(0.15)
        raise TimeoutError(f"手动环节没有结束: {label or condition}")


def launch(width, height):
    profile = tempfile.mkdtemp(prefix="jinlong-cdp-")
    proc = subprocess.Popen(
        [
            CHROME,
            "--headless=new",
            f"--remote-debugging-port={PORT}",
            "--remote-allow-origins=*",
            f"--user-data-dir={profile}",
            f"--window-size={width},{height}",
            "--hide-scrollbars",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-extensions",
            "--mute-audio",
            "--autoplay-policy=no-user-gesture-required",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(120):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=1):
                return proc, profile
        except Exception:
            time.sleep(0.25)
    proc.kill()
    raise RuntimeError("Chrome 没有起来")


def attach():
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=5) as fh:
        targets = json.load(fh)
    page = next(t for t in targets if t["type"] == "page")
    return Page(page["webSocketDebuggerUrl"])


def run(keep):
    if shutil.rmtree and os.path.isdir(SHOTS):
        shutil.rmtree(SHOTS, ignore_errors=True)
    proc, profile = launch(1440, 900)
    failures = []
    try:
        page = attach()
        page.send("Page.enable")
        page.send("Runtime.enable")

        errors = []
        page.send("Log.enable")
        page.send("Console.enable")

        url = "file:///" + os.path.join(ROOT, "index.html").replace("\\", "/")
        page.send("Page.navigate", url=url)
        time.sleep(2.0)

        # 页面里挂一个错误收集器
        page.js("window.__errs=[];window.addEventListener('error',e=>window.__errs.push(''+e.message));"
                "window.addEventListener('unhandledrejection',e=>window.__errs.push('rejection: '+e.reason));")

        # rAF 真的在跑吗
        page.js("window.__f=0;(function l(){window.__f++;requestAnimationFrame(l);})();")
        time.sleep(1.0)
        frames = page.js("window.__f")
        print(f"1 秒内 rAF 帧数: {frames}")
        if frames < 20:
            failures.append(f"rAF 没有正常运行（{frames} 帧/秒），动画类检查不可信")

        print("[1] 买入弹窗")
        page.shot("01-buyin")

        print("[2] 入座 2,500")
        page.js("document.querySelector('#buyin-options button[data-amount=\"2500\"]').click()")
        time.sleep(0.6)
        page.shot("02-table")

        print("[3] 单次旋转全过程")
        page.js("document.getElementById('spin-btn').click()")
        time.sleep(0.55)
        page.shot("03-spinning")           # 滚动中（动态模糊）
        page.wait_for("document.getElementById('mode-label').textContent!=='转动中…'",
                      timeout=30, label="第一次旋转结束")
        page.shot("04-settled")

        print("[4] 连续旋转，抓自然出现的状态（神龙 / 大奖）")
        page.js("document.getElementById('turbo-btn').click()")   # 快速模式，取样更快
        page.js("document.getElementById('auto-select').value='100';"
                "document.getElementById('auto-btn').click()")

        wanted = {
            "05-wild": "Object.keys(window.__jinlong.renderer.wildGrow).length>0",
            "06-bigwin": "document.getElementById('banner').classList.contains('show')",
        }
        captured = set()
        deadline = time.time() + 120
        while time.time() < deadline and len(captured) < len(wanted):
            for name, expr in wanted.items():
                if name in captured:
                    continue
                if page.js(expr):
                    page.shot(name)
                    captured.add(name)
            if not page.js("Number(document.getElementById('auto-label').textContent.replace(/\\D/g,''))>0"):
                if page.js("document.getElementById('session').textContent") in ("—", "0"):
                    break
                page.js("document.getElementById('auto-btn').click()")
            time.sleep(0.2)
        for name in wanted:
            if name not in captured:
                failures.append(f"没能在 120 秒内抓到场景 {name}")

        # 停掉自动旋转，回到可控状态
        page.js("if(Number(document.getElementById('auto-label').textContent.replace(/\\D/g,''))>0)"
                "document.getElementById('auto-btn').click()")
        page.wait_for("window.__jinlong.phase==='idle'", timeout=40, label="自动旋转停下")

        print("[4b] 擦边球（最后一轴先差一点点停住）")
        page.js("window.__teaseSeen=false;"
                "window.ASTER_CONFIG.FEATURES.tease.chance = 1;")
        page.js("document.getElementById('turbo-btn').click()")   # 关掉快速，看清楚
        page.js("document.getElementById('spin-btn').click()")
        deadline = time.time() + 30
        teased = False
        while time.time() < deadline:
            if page.js("window.__jinlong.renderer.reels[4].teasing"):
                page.shot("06b-tease")
                teased = True
                break
            time.sleep(0.05)
        if not teased:
            failures.append("没有观察到擦边球（最后一轴的顿停）")
        else:
            print("    捕捉到擦边球顿停")
        page.js("window.ASTER_CONFIG.FEATURES.tease.chance = 0.22")
        page.wait_for("window.__jinlong.phase==='idle'", timeout=40, label="擦边球那一转结束")

        # 玩法触发是小概率事件，靠等运气不可靠 —— 直接把状态摆到触发点上，
        # 检查的是"表现层能不能正确演出来"，不是概率本身（概率由 sim.html 负责）。
        print("[5] 强制触发聚宝盆（每次重转都要玩家自己按）")
        page.js("window.__jinlong.engine.charge = window.ASTER_CONFIG.FEATURES.charge.max - 1;"
                "window.__jinlong.engine.strips = {base: window.ASTER_CONFIG.STRIPS.base.map(function(s,i){"
                "  return i===0 ? s.map(function(){return 'C';}) : s;}),"
                " free: window.ASTER_CONFIG.STRIPS.free};")
        page.js("document.getElementById('spin-btn').click()")
        page.wait_for("document.getElementById('feature-card').classList.contains('show')",
                      timeout=40, label="聚宝盆特写")
        time.sleep(0.7)
        page.shot("07-hold-intro")
        page.wait_for("document.getElementById('hold-hud').classList.contains('visible')",
                      timeout=40, label="聚宝盆开启")
        time.sleep(1.0)
        page.shot("08-hold-board")

        presses = page.press_while(
            "document.getElementById('hold-hud').classList.contains('visible')",
            timeout=180, label="聚宝盆",
            shots={"09-hold-await": "window.__jinlong.awaitingPress",
                   "10-hold-spinning": "document.getElementById('hold-hud').classList.contains('spinning')"})
        print(f"    玩家手动按了 {presses} 次重转")
        if presses < 1:
            failures.append("聚宝盆没有出现需要玩家手动按的环节")
        time.sleep(1.4)
        page.shot("11-hold-finale")
        page.wait_for("window.__jinlong.phase==='idle'", timeout=90, label="聚宝盆结算完")

        print("[6] 强制触发龙门免费游戏（手动逐次按）")
        page.js("""
          var C = window.ASTER_CONFIG;
          window.__savedStrips = C.STRIPS.base.map(function (s) { return s.slice(); });
          [0, 2, 4].forEach(function (i) {
            for (var k = 0; k < C.STRIPS.base[i].length; k++) C.STRIPS.base[i][k] = 'S';
          });
          window.__jinlong.engine.strips = C.STRIPS;
        """)
        page.js("document.getElementById('spin-btn').click()")
        page.wait_for("document.getElementById('feature-card').classList.contains('show')",
                      timeout=40, label="龙门大开特写")
        time.sleep(0.8)
        page.shot("12-free-intro")
        page.js("""
          var C = window.ASTER_CONFIG;
          C.STRIPS.base.forEach(function (s, i) {
            for (var k = 0; k < s.length; k++) s[k] = window.__savedStrips[i][k];
          });
        """)
        page.wait_for("document.getElementById('free-hud').classList.contains('visible')",
                      timeout=40, label="免费游戏 HUD")
        time.sleep(0.8)
        page.shot("13-free-spins")

        fs = page.press_while(
            "document.getElementById('free-hud').classList.contains('visible')",
            timeout=240, label="免费游戏")
        print(f"    玩家手动按了 {fs} 次免费旋转")
        if fs < 5:
            failures.append(f"免费游戏只按了 {fs} 次，手动模式可能没生效")
        time.sleep(1.0)
        page.shot("14-free-summary")

        print("[7] 赔率弹窗")
        page.wait_for("window.__jinlong.phase==='idle'", timeout=60, label="回到空闲")
        page.js("document.getElementById('paytable-btn').click()")
        time.sleep(0.6)
        page.shot("15-paytable")
        page.js("document.querySelector('[data-close=\"paytable-modal\"]').click()")
        time.sleep(0.4)

        errs = page.js("window.__errs")
        if errs:
            failures.append("页面报错: " + "; ".join(errs[:6]))

        money_ok = page.js("document.getElementById('wallet').textContent.indexOf('$')===0")
        if not money_ok:
            failures.append("货币没有加上 $ 前缀")

        print("\n最终状态:", page.js(
            "JSON.stringify({wallet:wallet.textContent,session:session.textContent,"
            "spins:document.getElementById('spin-count').textContent,"
            "achv:document.getElementById('achievement-count').textContent,"
            "unlocked:Object.keys(window.__jinlong.state.achievements)})"))
        page.shot("16-final")

    finally:
        if not keep:
            proc.kill()
            shutil.rmtree(profile, ignore_errors=True)

    print()
    if failures:
        print("检查未通过：")
        for f in failures:
            print(" [x]", f)
        return 1
    print("全部检查通过。")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", action="store_true")
    sys.exit(run(ap.parse_args().keep))
