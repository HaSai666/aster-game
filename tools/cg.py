#!/usr/bin/env python3
"""大奖结算 CG：确认它真的打断游戏、停掉自动旋转、必须玩家按才继续。"""
import base64, json, os, subprocess, sys, tempfile, time, urllib.request
import websocket

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "tools", "_shots")
PORT = 9355


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
    profile = tempfile.mkdtemp(prefix="jl-cg-")
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

        print("[1] 开 20 次自动旋转，然后把下一转做成必中大奖")
        p.js("document.getElementById('auto-select').value='25';"
             "document.getElementById('auto-btn').click()")
        time.sleep(1.5)
        auto0 = p.js("window.__jinlong.state && document.getElementById('auto-label').textContent")
        print("    自动旋转：" + str(auto0))

        # 第 1/3/5 轴全铺貔貅，必定 5 连大奖
        p.js("""
          var e = window.__jinlong.engine;
          window.__saved = e.strips.base.map(function (s) { return s.slice(); });
          e.strips = { base: e.cfg.STRIPS.base.map(function (s) {
            return s.map(function () { return 'PX'; }); }), free: e.cfg.STRIPS.free };
        """)

        # 等 CG 冒出来
        t0 = time.time()
        while time.time() - t0 < 60:
            if p.js("document.getElementById('cg').classList.contains('show')"):
                break
            time.sleep(0.25)
        else:
            print("!! 60 秒内没等到 CG"); return 1

        time.sleep(1.2)
        p.shot("CG-counting")
        st = p.js("JSON.stringify({cls: document.getElementById('cg').className,"
                  " amount: document.getElementById('cg-amount').textContent,"
                  " title: document.getElementById('cg-title').textContent,"
                  " auto: document.getElementById('auto-label').textContent,"
                  " autoOn: document.getElementById('auto-btn').classList.contains('on')})")
        print("    滚数字中:", st)
        if json.loads(st)["autoOn"]:
            fails.append("CG 弹出后自动旋转没有停")

        print("[2] 数字滚完前按下去应该没反应")
        before = p.js("document.getElementById('cg').classList.contains('show')")
        p.js("window.__jinlong.press()")
        time.sleep(0.4)
        if not p.js("document.getElementById('cg').classList.contains('show')"):
            fails.append("数字还没滚完就能按掉")

        print("[3] 等它亮出「收下」")
        t0 = time.time()
        while time.time() - t0 < 20:
            if p.js("document.getElementById('cg').classList.contains('ready')"):
                break
            time.sleep(0.2)
        else:
            fails.append("一直没有进入可按状态")
        time.sleep(0.6)
        p.shot("CG-ready")
        st2 = p.js("JSON.stringify({amount: document.getElementById('cg-amount').textContent,"
                   " title: document.getElementById('cg-title').textContent,"
                   " kicker: document.getElementById('cg-kicker').textContent,"
                   " mult: document.getElementById('cg-mult').textContent,"
                   " lines: document.getElementById('cg-lines').textContent})")
        print("    " + st2)

        print("[4] 不按的话必须一直停在这儿")
        time.sleep(6.0)
        if not p.js("document.getElementById('cg').classList.contains('show')"):
            fails.append("没人按它自己消失了 —— 这就又会一闪而过")
        if p.js("window.__jinlong.phase") == "idle":
            fails.append("CG 还开着游戏就回到 idle 了")

        print("[4b] 空格也该是「收下」，不是快进")
        p.send("Input.dispatchKeyEvent", type="keyDown", code="Space",
               key=" ", windowsVirtualKeyCode=32, nativeVirtualKeyCode=32)
        p.send("Input.dispatchKeyEvent", type="keyUp", code="Space",
               key=" ", windowsVirtualKeyCode=32, nativeVirtualKeyCode=32)
        time.sleep(2.2)
        if p.js("document.getElementById('cg').classList.contains('show')"):
            fails.append("空格关不掉 CG")
        else:
            print("    空格收下了")

        print("[5] 再来一次，用「收下」按钮")
        t0 = time.time()
        while time.time() - t0 < 60:
            if p.js("document.getElementById('cg').classList.contains('ready')"):
                break
            if p.js("window.__jinlong.phase") == "idle":
                p.js("window.__jinlong.press()")
            time.sleep(0.3)
        p.js("document.getElementById('cg-go').click()")
        time.sleep(2.5)
        if p.js("document.getElementById('cg').classList.contains('show')"):
            fails.append("按了「收下」没有关掉")
        p.js("window.__jinlong.engine.strips = { base: window.__saved,"
             " free: window.__jinlong.engine.cfg.STRIPS.free }")
        t0 = time.time()
        while time.time() - t0 < 30 and p.js("window.__jinlong.phase") != "idle":
            time.sleep(0.3)
        print("    本局 " + str(p.js("document.getElementById('session').textContent")))
        p.shot("CG-after")

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
