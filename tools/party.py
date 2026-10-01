#!/usr/bin/env python3
"""娱乐模式端到端检查。

一直按旋转（包括免费游戏和聚宝盆的手动重转），直到把所有娱乐模式专属机制
—— 滚雪球、金龙狂暴、天降横财、倍率币聚宝盆、累积彩金 —— 都撞见一次为止，
每撞见一个就截一张图。
"""
import base64, json, os, subprocess, sys, tempfile, time, urllib.request
import websocket

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "tools", "_shots")
PORT = 9343


class Page:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=90)
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

    def js(self, expr):
        r = self.send("Runtime.evaluate", expression=expr, returnByValue=True)
        if r.get("exceptionDetails"):
            raise RuntimeError(json.dumps(r["exceptionDetails"])[:600])
        return r["result"].get("value")

    def shot(self, name):
        os.makedirs(SHOTS, exist_ok=True)
        data = self.send("Page.captureScreenshot", format="png")["data"]
        with open(os.path.join(SHOTS, name + ".png"), "wb") as fh:
            fh.write(base64.b64decode(data))


PROBE = """(function () {
  var g = window.__jinlong, e = g.engine;
  return {
    phase: g.phase, await: g.awaitingPress, mode: g.modeId,
    session: g.session, wallet: g.state.modes[g.modeId].wallet,
    spins: g.state.modes[g.modeId].spinCount,
    snow: e.snowballStep, ramp: e.rampageLeft,
    free: e.freeSpins, jackpot: Math.round(e.jackpot),
    hold: document.getElementById('hold-hud').classList.contains('visible'),
    feature: (document.getElementById('feature-title') || {}).textContent || '',
    errs: (window.__bootErrors || []).length
  };
})()"""


def main():
    budget = float(sys.argv[1]) if len(sys.argv) > 1 else 420
    profile = tempfile.mkdtemp(prefix="jl-party-")
    url = ("file:///" + os.path.join(ROOT, "index.html").replace("\\", "/")
           + "?dev=1&mode=party")
    proc = subprocess.Popen([
        CHROME, f"--remote-debugging-port={PORT}", f"--user-data-dir={profile}",
        "--remote-allow-origins=*", "--no-first-run", "--no-default-browser-check",
        "--allow-file-access-from-files", "--window-size=1440,900", "--hide-scrollbars",
        "--autoplay-policy=no-user-gesture-required", url,
    ])
    seen = {}
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
        p.send("Page.enable")
        p.send("Runtime.enable")
        time.sleep(2.5)

        # ?mode=party 在 buyIn 之后生效，所以这里重新入座一次
        p.js("window.__jinlong.buyIn(window.ASTER_CONFIG.mode('party').ECONOMY.fixedBuyin)")
        time.sleep(1.0)

        def mark(key, label):
            if key in seen:
                return
            seen[key] = label
            p.shot("P-" + key)
            print(f"  ★ 撞见 {label}")

        t0 = time.time()
        presses = 0
        while time.time() - t0 < budget:
            st = p.js(PROBE)
            if st["errs"]:
                print("!! 脚本错误", p.js("JSON.stringify(window.__bootErrors)"))
                break
            if st["snow"] >= 3:
                mark("snowball", f"滚雪球 {st['snow'] + 1} 级")
            if st["ramp"] > 0:
                mark("rampage", "金龙狂暴")
            if st["hold"]:
                mark("hold", "聚宝盆")
            if st["free"] > 0:
                mark("free", "龙门免费游戏")
            f = st["feature"]
            if "天 降" in f:
                mark("coindrop", "天降横财")
            if "全 盆" in f:
                mark("holdmult", "聚宝盆加倍")
            if "累 积 彩 金" in f:
                mark("jackpot", "累积彩金")
            if "大 满 贯" in f:
                mark("grand", "大满贯")

            if st["phase"] == "idle" and st["session"] <= 0:
                p.js("document.getElementById('buyin-go').click()")
                time.sleep(0.5)
                continue
            if st["await"] or st["phase"] == "idle":
                p.js("window.__jinlong.press()")
                presses += 1
            time.sleep(0.35)

        st = p.js(PROBE)
        print(f"\n按了 {presses} 次 · 第 {st['spins']} 转 · 本局 ${st['session']:,} · "
              f"彩金 ${st['jackpot']:,}")
        print("撞见机制：", "、".join(seen.values()) or "（无）")
        missing = {"snowball": "滚雪球", "rampage": "金龙狂暴", "hold": "聚宝盆",
                   "free": "龙门", "coindrop": "天降横财"}
        gaps = [v for k, v in missing.items() if k not in seen]
        print("没撞见：", "、".join(gaps) or "（全中）")
        p.shot("P-final")
        print("最终错误:", p.js("JSON.stringify(window.__bootErrors || [])"))
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
