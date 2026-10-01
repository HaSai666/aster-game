#!/usr/bin/env python3
"""强制触发娱乐模式的稀有机制，确认它们的演出代码真的跑得通。

自然撞见金龙狂暴要 ~120 转、滚雪球满级要连中 4 把，靠运气测太慢；
这里直接把引擎状态掰到那个位置，再按一次旋转。
"""
import base64, json, os, subprocess, sys, tempfile, time, urllib.request
import websocket

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "tools", "_shots")
PORT = 9349


class Page:
    def __init__(self, u):
        self.ws = websocket.create_connection(u, timeout=300); self.id = 0

    def send(self, m, **p):
        self.id += 1
        self.ws.send(json.dumps({"id": self.id, "method": m, "params": p}))
        while True:
            r = json.loads(self.ws.recv())
            if r.get("id") == self.id:
                if "error" in r:
                    raise RuntimeError(f"{m}: {r['error']}")
                return r.get("result", {})

    def js(self, e):
        r = self.send("Runtime.evaluate", expression=e, returnByValue=True)
        if r.get("exceptionDetails"):
            raise RuntimeError(json.dumps(r["exceptionDetails"])[:600])
        return r["result"].get("value")

    def shot(self, n):
        os.makedirs(SHOTS, exist_ok=True)
        with open(os.path.join(SHOTS, n + ".png"), "wb") as fh:
            fh.write(base64.b64decode(self.send("Page.captureScreenshot", format="png")["data"]))


def main():
    profile = tempfile.mkdtemp(prefix="jl-force-")
    url = "file:///" + os.path.join(ROOT, "index.html").replace("\\", "/") + "?dev=1&mode=party"
    proc = subprocess.Popen([
        CHROME, f"--remote-debugging-port={PORT}", f"--user-data-dir={profile}",
        "--remote-allow-origins=*", "--no-first-run", "--no-default-browser-check",
        "--allow-file-access-from-files", "--window-size=1440,900", "--hide-scrollbars",
        "--autoplay-policy=no-user-gesture-required", url])
    try:
        ws_url = None
        for _ in range(60):
            try:
                for t in json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json").read()):
                    if t.get("type") == "page" and "index.html" in t.get("url", ""):
                        ws_url = t["webSocketDebuggerUrl"]
            except Exception:
                pass
            if ws_url:
                break
            time.sleep(0.4)
        p = Page(ws_url)
        p.send("Page.enable"); p.send("Runtime.enable")
        time.sleep(2.5)
        p.js("window.__jinlong.buyIn(window.ASTER_CONFIG.mode('party').ECONOMY.fixedBuyin)")
        time.sleep(1.0)

        def drive(seconds, shot_at=None, tag=None):
            """按住旋转键直到这一段演完（聚宝盆的手动重转也照按）。"""
            t0 = time.time()
            shot_done = False
            while time.time() - t0 < seconds:
                st = p.js("(function(){var g=window.__jinlong;return [g.phase,g.awaitingPress];})()")
                if shot_at and not shot_done and time.time() - t0 >= shot_at:
                    p.shot(tag); shot_done = True
                if st[1] or st[0] == "idle":
                    if st[0] == "idle" and not st[1] and time.time() - t0 > 1.2:
                        break
                    p.js("window.__jinlong.press()")
                time.sleep(0.3)
            if shot_at and not shot_done:
                p.shot(tag)

        print("1) 金龙狂暴")
        p.js("window.__jinlong.engine.rampageLeft = 3")
        drive(30, 2.0, "F-rampage")

        print("2) 滚雪球满级")
        p.js("window.__jinlong.engine.snowballStep = 4; window.__jinlong.press()")
        time.sleep(1.5); p.shot("F-snowball")
        drive(25)

        print("3) 龙门免费游戏")
        p.js("window.__jinlong.engine.buyFreeSpins()")
        drive(90, 3.0, "F-free")

        print("4) 聚宝盆（倍率币拉满）")
        p.js("window.__jinlong.engine.charge = "
             "window.ASTER_CONFIG.mode('party').FEATURES.charge.max - 1;"
             "var H = window.__jinlong.engine.F.holdSpin;"
             "H.multCoins.chance = 0.25; H.collector.chance = 0.12;")
        drive(120, 14.0, "F-hold")

        print("5) 累积彩金")
        p.js("window.__jinlong.engine.F.jackpot.chance = 1")
        drive(45, 6.0, "F-jackpot")
        p.js("window.__jinlong.engine.F.jackpot.chance = 1/1500")

        p.shot("F-final")
        print("错误:", p.js("JSON.stringify(window.__bootErrors || [])"))
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
