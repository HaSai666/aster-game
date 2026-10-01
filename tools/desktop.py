#!/usr/bin/env python3
"""金龙聚宝 · Windows 桌面版入口

用 pywebview 开一个原生窗口，里面跑 WebView2（Win10/11 自带的 Edge 内核）。
游戏文件被 PyInstaller 打进 exe，运行时解包到临时目录再以 file:// 打开 ——
整个 exe 自包含，断网、没装浏览器都能玩。

打包：python tools/build_exe.py
"""

import os
import sys
import time


def asset_root():
    """打包后资源在 PyInstaller 解包出来的 _MEIPASS 里；源码运行时就是仓库根目录。"""
    if getattr(sys, "frozen", False):
        return os.path.join(sys._MEIPASS, "game")
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def log_dir():
    """日志写在 exe 旁边，方便用户直接看到。"""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def main():
    import webview

    index = os.path.join(asset_root(), "index.html")
    if not os.path.isfile(index):
        raise SystemExit("找不到 index.html：" + index)

    window = webview.create_window(
        "金龙聚宝 · 243 Ways",
        url="file:///" + index.replace("\\", "/"),
        width=1280,
        height=860,
        min_size=(900, 620),
        background_color="#13070a",
        text_select=False,
        confirm_close=False,
    )

    def report_errors():
        """桌面版没有控制台：把页面里的脚本错误写到 exe 同级的日志里。"""
        try:
            errs = window.evaluate_js("JSON.stringify(window.__bootErrors || [])")
            if errs and str(errs) not in ("[]", "null", "None"):
                line = time.strftime("%Y-%m-%d %H:%M:%S ") + str(errs)
                with open(os.path.join(log_dir(), "jinlong-error.log"), "a", encoding="utf-8") as fh:
                    fh.write(line + "\n")
                print("页面脚本错误:", errs)
        except Exception as ex:
            print("读取错误信息失败:", ex)

    def on_loaded():
        """桌面版没有浏览器地址栏，补两个本来靠浏览器提供的能力：F11 全屏、Ctrl+R 重载。"""
        try:
            window.evaluate_js(
                "document.addEventListener('keydown', function (e) {"
                "  if (e.key === 'F11') { e.preventDefault(); window.pywebview.api.toggle_fullscreen(); }"
                "  if (e.ctrlKey && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); location.reload(); }"
                "});"
                "document.addEventListener('contextmenu', function (e) { e.preventDefault(); });"
            )
        except Exception:
            pass
        report_errors()

    class Api:
        def toggle_fullscreen(self):
            window.toggle_fullscreen()

    window.expose(Api().toggle_fullscreen)
    window.events.loaded += on_loaded

    # gui=None 让 pywebview 自己挑后端；Windows 上会选 EdgeChromium(WebView2)
    webview.start(debug=False)


if __name__ == "__main__":
    main()
