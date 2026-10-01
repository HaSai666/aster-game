#!/usr/bin/env python3
"""跑 tools/sim.html 并把结果打印出来（headless 下 rAF 不推进，但纯计算不受影响）。"""
import json, os, subprocess, sys, tempfile, time, urllib.request
import websocket

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 9347

query = sys.argv[1] if len(sys.argv) > 1 else "spins=400000&modes=normal,party"
profile = tempfile.mkdtemp(prefix="jl-sim-")
url = "file:///" + os.path.join(ROOT, "tools", "sim.html").replace("\\", "/") + "?" + query
proc = subprocess.Popen([
    CHROME, f"--remote-debugging-port={PORT}", f"--user-data-dir={profile}",
    "--remote-allow-origins=*", "--no-first-run", "--no-default-browser-check",
    "--allow-file-access-from-files", "--headless=new", url,
])
try:
    ws_url = None
    for _ in range(80):
        try:
            for t in json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json").read()):
                if t.get("type") == "page" and "sim.html" in t.get("url", ""):
                    ws_url = t["webSocketDebuggerUrl"]
        except Exception:
            pass
        if ws_url:
            break
        time.sleep(0.4)
    ws = websocket.create_connection(ws_url, timeout=1800)
    i = 0
    def js(expr):
        global i
        i += 1
        ws.send(json.dumps({"id": i, "method": "Runtime.evaluate",
                            "params": {"expression": expr, "returnByValue": True,
                                       "awaitPromise": True}}))
        while True:
            m = json.loads(ws.recv())
            if m.get("id") == i:
                return m["result"]["result"].get("value")
    print(js("new Promise(function(r){var t=setInterval(function(){"
             "var x=document.getElementById('out').textContent;"
             "if(x&&x.indexOf('轮带长度')>=0){clearInterval(t);r(x);}},500);})"))
finally:
    proc.terminate()
