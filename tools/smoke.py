#!/usr/bin/env python3
"""最小启动检查：开一个真渲染的页面，看有没有脚本错误，顺便截几张图。"""
import base64, json, os, subprocess, sys, tempfile, time, urllib.request
import websocket

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "tools", "_shots")
PORT = 9341


class Page:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=600)
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

    def js(self, expr, await_promise=False):
        r = self.send("Runtime.evaluate", expression=expr, returnByValue=True,
                      awaitPromise=await_promise)
        if r.get("exceptionDetails"):
            raise RuntimeError(json.dumps(r["exceptionDetails"])[:800])
        return r["result"].get("value")

    def shot(self, name):
        os.makedirs(SHOTS, exist_ok=True)
        data = self.send("Page.captureScreenshot", format="png")["data"]
        with open(os.path.join(SHOTS, name + ".png"), "wb") as fh:
            fh.write(base64.b64decode(data))


def main():
    profile = tempfile.mkdtemp(prefix="jl-smoke-")
    url = ("file:///" + os.path.join(ROOT, "index.html").replace("\\", "/")
           + "?" + os.environ.get("JL_QUERY", "dev=1"))
    proc = subprocess.Popen([
        CHROME, f"--remote-debugging-port={PORT}", f"--user-data-dir={profile}",
        "--remote-allow-origins=*", "--no-first-run", "--no-default-browser-check", "--allow-file-access-from-files",
        "--window-size=1440,900", "--hide-scrollbars", "--autoplay-policy=no-user-gesture-required",
        url,
    ])
    try:
        ws_url = None
        for _ in range(60):
            try:
                tabs = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json").read())
                for t in tabs:
                    if t.get("type") == "page" and "index.html" in t.get("url", ""):
                        ws_url = t["webSocketDebuggerUrl"]
                        break
            except Exception:
                pass
            if ws_url:
                break
            time.sleep(0.4)
        if not ws_url:
            raise SystemExit("连不上页面")

        p = Page(ws_url)
        p.send("Page.enable")
        p.send("Runtime.enable")
        time.sleep(2.5)

        errs = p.js("JSON.stringify(window.__bootErrors || [])")
        print("启动错误:", errs)
        print("已装载:", p.js("typeof window.__jinlong"))
        print("当前厅:", p.js("window.__jinlong && window.__jinlong.modeId"))
        p.shot("A-boot")

        p.js("""window.__idle = function () {
          return new Promise(function (res) {
            var t = setInterval(function () {
              var g = window.__jinlong;
              if (g.phase === 'idle' && !g.awaitingPress) { clearInterval(t); res(1); }
            }, 150);
          });
        };""")

        for step in sys.argv[1:]:
            print("--", step)
            print("  →", p.js(step, await_promise=True))
            time.sleep(1.2)
        p.shot("Z-final")
        print("最终错误:", p.js("JSON.stringify(window.__bootErrors || [])"))
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
