#!/usr/bin/env python3
"""聚宝盆结算 / 累积彩金 / 正常模式 的 CG 各走一遍。"""
import base64, json, os, subprocess, sys, tempfile, time, urllib.request
import websocket

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "tools", "_shots")
PORT = 9357


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
    fails = []
    profile = tempfile.mkdtemp(prefix="jl-cg2-")
    url = "file:///" + os.path.join(ROOT, "index.html").replace("\\", "/") + "?dev=1"
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

        def drive_until_cg(limit, label):
            """一路按，直到 CG 亮出「收下」。聚宝盆的手动重转也照按。"""
            t0 = time.time()
            while time.time() - t0 < limit:
                if p.js("document.getElementById('cg').classList.contains('ready')"):
                    return True
                if p.js("document.getElementById('cg').classList.contains('show')"):
                    time.sleep(0.3); continue
                st = p.js("[window.__jinlong.phase, window.__jinlong.awaitingPress]")
                if st[1] or st[0] == "idle":
                    p.js("window.__jinlong.press()")
                time.sleep(0.35)
            fails.append(f"{label}：没等到 CG")
            return False

        print("[A] 正常模式 · 普通旋转大奖（门槛 25×）")
        p.js("""
          var e = window.__jinlong.engine;
          window.__saved = e.strips.base.map(function (s) { return s.slice(); });
          e.strips = { base: e.cfg.STRIPS.base.map(function (s) {
            return s.map(function () { return 'PX'; });
          }), free: e.cfg.STRIPS.free };
        """)
        if drive_until_cg(90, "正常模式大奖"):
            print("    " + p.js("JSON.stringify({t: document.getElementById('cg-title').textContent,"
                                " a: document.getElementById('cg-amount').textContent,"
                                " m: document.getElementById('cg-mult').textContent,"
                                " k: document.getElementById('cg-kicker').textContent})"))
            p.shot("CG-normal")
            p.js("document.getElementById('cg-go').click()")
            time.sleep(2.0)
        p.js("window.__jinlong.engine.strips = { base: window.__saved,"
             " free: window.__jinlong.engine.cfg.STRIPS.free }")
        while p.js("window.__jinlong.phase") != "idle":
            time.sleep(0.3)

        print("[B] 聚宝盆结算（面值拉满，保证超过 25×）")
        p.js("""
          var g = window.__jinlong, e = g.engine;
          e.charge = e.F.charge.max - 1;
          e.F.holdSpin.values = [{value: 60, weight: 1}];
          e.F.holdSpin.landChance = 0.45;
          e.strips = { base: e.cfg.STRIPS.base.map(function (s, i) {
            return i === 0 ? s.map(function () { return 'C'; }) : s;
          }), free: e.cfg.STRIPS.free };
        """)
        if drive_until_cg(180, "聚宝盆结算"):
            print("    " + p.js("JSON.stringify({t: document.getElementById('cg-title').textContent,"
                                " a: document.getElementById('cg-amount').textContent,"
                                " k: document.getElementById('cg-kicker').textContent,"
                                " l: document.getElementById('cg-lines').textContent})"))
            p.shot("CG-hold")
            if p.js("document.getElementById('cg-kicker').textContent").find("聚") < 0:
                fails.append("聚宝盆的 CG 标头不对")
            p.js("document.getElementById('cg-go').click()")
            time.sleep(2.5)
        p.js("window.__jinlong.engine.strips = { base: window.__saved,"
             " free: window.__jinlong.engine.cfg.STRIPS.free }")
        t0 = time.time()
        while time.time() - t0 < 40 and p.js("window.__jinlong.phase") != "idle":
            time.sleep(0.3)

        print("[C] 累积彩金（必中）")
        p.js("window.__jinlong.engine.F.jackpot.chance = 1")
        if drive_until_cg(120, "累积彩金"):
            print("    " + p.js("JSON.stringify({t: document.getElementById('cg-title').textContent,"
                                " a: document.getElementById('cg-amount').textContent,"
                                " k: document.getElementById('cg-kicker').textContent})"))
            p.shot("CG-jackpot")
            if p.js("document.getElementById('cg-title').textContent").find("彩") < 0:
                fails.append("彩金的 CG 标题不对")
            p.js("document.getElementById('cg-go').click()")
            time.sleep(2.0)
        p.js("window.__jinlong.engine.F.jackpot.chance = 1/1500")

        errs = p.js("JSON.stringify(window.__bootErrors || [])")
        if errs not in ("[]", None):
            fails.append("脚本错误 " + str(errs))
        print()
        if fails:
            print("未通过：")
            for f in fails:
                print(" [x]", f)
            return 1
        print("全部检查通过。")
        return 0
    finally:
        proc.terminate()


if __name__ == "__main__":
    sys.exit(main())
