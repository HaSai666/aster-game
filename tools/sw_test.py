#!/usr/bin/env python3
"""验证 Service Worker 的更新路径：发了新版之后，玩家**第一次**刷新就该看到。

起一个本地静态服务器 → 用持久化 profile 打开（SW 装好、缓存写满）→
改掉一个文件 → 只刷新一次 → 断言看到的是改后的内容。
上一版 cache-first 会在这一步失败（第一次刷新拿的还是旧缓存）。
"""
import json, os, shutil, subprocess, sys, tempfile, threading, time, urllib.request
import http.server, socketserver
import websocket

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT, HTTP = 9351, 8731


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        # 模拟 GitHub Pages 的 max-age=600：SW 必须自己绕开它
        self.send_header("Cache-Control", "max-age=600")
        super().end_headers()


def serve(directory):
    handler = lambda *a, **k: Quiet(*a, directory=directory, **k)
    srv = socketserver.TCPServer(("127.0.0.1", HTTP), handler)
    srv.allow_reuse_address = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    stage = tempfile.mkdtemp(prefix="jl-sw-site-")
    for name in ("index.html", "styles.css", "sw.js", "manifest.webmanifest", "js"):
        src = os.path.join(ROOT, name)
        dst = os.path.join(stage, name)
        shutil.copytree(src, dst) if os.path.isdir(src) else shutil.copy2(src, dst)
    srv = serve(stage)

    profile = tempfile.mkdtemp(prefix="jl-sw-prof-")
    url = f"http://127.0.0.1:{HTTP}/index.html"
    proc = subprocess.Popen([
        CHROME, f"--remote-debugging-port={PORT}", f"--user-data-dir={profile}",
        "--remote-allow-origins=*", "--no-first-run", "--no-default-browser-check",
        "--window-size=1200,800", "--hide-scrollbars", url])
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
        ws = websocket.create_connection(ws_url, timeout=120)
        n = [0]

        def js(e):
            n[0] += 1
            ws.send(json.dumps({"id": n[0], "method": "Runtime.evaluate",
                                "params": {"expression": e, "returnByValue": True,
                                           "awaitPromise": True}}))
            while True:
                m = json.loads(ws.recv())
                if m.get("id") == n[0]:
                    d = m["result"]
                    if d.get("exceptionDetails"):
                        raise RuntimeError(json.dumps(d["exceptionDetails"])[:400])
                    return d["result"].get("value")

        time.sleep(3.0)
        js("navigator.serviceWorker.ready")
        time.sleep(1.5)
        ver = js("window.ASTER_CONFIG.BUILD")
        active = js("navigator.serviceWorker.controller ? 'yes' : 'no'")
        print(f"第一次打开：BUILD={ver}  SW 接管={active}")
        if active != "yes":
            print("!! SW 没接管，这次测试说明不了问题"); return 1

        # 发一个"新版本"
        cfg = os.path.join(stage, "js", "config.js")
        txt = open(cfg, encoding="utf-8").read().replace(
            'var BUILD = "%s"' % ver, 'var BUILD = "NEWBUILD"')
        open(cfg, "w", encoding="utf-8").write(txt)
        print("已在服务器上替换 js/config.js")

        js("location.reload()")
        time.sleep(4.0)
        ver2 = js("window.ASTER_CONFIG.BUILD")
        print(f"刷新一次后：BUILD={ver2}")

        # 再测离线
        ws.send(json.dumps({"id": 900, "method": "Network.enable", "params": {}}))
        time.sleep(0.3)
        ws.send(json.dumps({"id": 901, "method": "Network.emulateNetworkConditions",
                            "params": {"offline": True, "latency": 0,
                                       "downloadThroughput": 0, "uploadThroughput": 0}}))
        time.sleep(0.5)
        js("location.reload()")
        time.sleep(8.0)
        offline_ok = js("typeof window.ASTER_CONFIG === 'object' && "
                        "!!document.getElementById('reel-canvas')")
        print(f"断网再刷：还能跑={offline_ok}")

        ok = (ver2 == "NEWBUILD") and offline_ok
        print("\n" + ("通过：发新版后第一次刷新就生效，且断网仍可玩。" if ok else
                      "未通过：" + ("第一次刷新还是旧版。" if ver2 != "NEWBUILD" else "断网跑不起来。")))
        return 0 if ok else 1
    finally:
        proc.terminate()
        srv.shutdown()


if __name__ == "__main__":
    sys.exit(main())
