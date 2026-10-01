#!/usr/bin/env python3
"""手机端布局检查：按真实视口截图，并量出各块的实际高度 / 是否溢出。"""
import base64, json, os, subprocess, sys, tempfile, time, urllib.request
import websocket

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "tools", "_shots")
PORT = 9353

DEVICES = [
    ("galaxy-s8", 360, 740, 3),
    ("iphone-se", 375, 667, 2),
    ("iphone-14", 390, 844, 3),
    ("pixel-7", 412, 915, 2.6),
]


class Page:
    def __init__(self, u):
        self.ws = websocket.create_connection(u, timeout=120); self.id = 0

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
            raise RuntimeError(json.dumps(r["exceptionDetails"])[:500])
        return r["result"].get("value")

    def shot(self, n):
        os.makedirs(SHOTS, exist_ok=True)
        with open(os.path.join(SHOTS, n + ".png"), "wb") as fh:
            fh.write(base64.b64decode(self.send("Page.captureScreenshot", format="png")["data"]))


PROBE = """(function () {
  function box(sel) {
    var e = document.querySelector(sel);
    if (!e) return null;
    var r = e.getBoundingClientRect();
    return {t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height),
            l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width)};
  }
  var tb = document.querySelector('.topbar');
  return {
    vw: innerWidth, vh: innerHeight,
    docH: document.documentElement.scrollHeight,
    scrollable: document.documentElement.scrollHeight - innerHeight,
    topbar: box('.topbar'),
    topbarScrollW: tb ? tb.scrollWidth : 0,
    topbarClientW: tb ? tb.clientWidth : 0,
    brand: box('.brand'),
    modeSwitch: box('#mode-switch'),
    levelChip: box('.level-chip'),
    badge: box('.virtual-badge'),
    jackpot: box('#jackpot-bar'),
    stage: box('#stage'),
    spin: box('#spin-btn'),
    partyBar: box('#party-bar')
  };
})()"""


def main():
    profile = tempfile.mkdtemp(prefix="jl-mob-")
    url = "file:///" + os.path.join(ROOT, "index.html").replace("\\", "/") + "?dev=1"
    proc = subprocess.Popen([
        CHROME, f"--remote-debugging-port={PORT}", f"--user-data-dir={profile}",
        "--remote-allow-origins=*", "--no-first-run", "--no-default-browser-check",
        "--allow-file-access-from-files", "--window-size=1400,1100", url])
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
        time.sleep(2.0)

        for name, w, h, dpr in DEVICES:
            p.send("Emulation.setDeviceMetricsOverride", width=w, height=h,
                   deviceScaleFactor=dpr, mobile=True,
                   screenWidth=w, screenHeight=h, positionX=0, positionY=0)
            p.send("Emulation.setTouchEmulationEnabled", enabled=True, maxTouchPoints=5)
            time.sleep(1.4)
            p.js("window.dispatchEvent(new Event('resize'))")
            time.sleep(1.0)
            st = p.js(PROBE)
            print(f"\n=== {name}  {w}x{h} @{dpr}x ===")
            print(f"  视口 {st['vw']}x{st['vh']}  文档高 {st['docH']}  可滚 {st['scrollable']}px")
            tbw, tbc = st["topbarScrollW"], st["topbarClientW"]
            print(f"  顶栏 高 {st['topbar']['h']}  内容宽 {tbw} / 可见 {tbc}"
                  + ("  ← 横向溢出 %dpx" % (tbw - tbc) if tbw > tbc + 1 else ""))
            for k in ("brand", "modeSwitch", "levelChip", "badge"):
                b = st[k]
                if not b:
                    continue
                flag = "  ← 被裁掉" if b["r"] > st["vw"] + 1 or b["l"] < -1 else ""
                print(f"    {k:<11} x {b['l']}..{b['r']} (宽 {b['w']}){flag}")
            for k in ("jackpot", "stage", "spin"):
                b = st[k]
                if b:
                    print(f"  {k:<9} y {b['t']}..{b['b']}"
                          + ("  ← 在首屏外" if b["t"] > st["vh"] else ""))
            p.shot("M-" + name)
        print("\n错误:", p.js("JSON.stringify(window.__bootErrors || [])"))
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
