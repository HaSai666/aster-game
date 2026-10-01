#!/usr/bin/env python3
"""把金龙聚宝打包成单文件 Windows exe。

    python tools/build_exe.py            # 产出 dist/金龙聚宝.exe
    python tools/build_exe.py --clean    # 先清掉上次的中间产物

依赖：pyinstaller、pywebview
    pip install pyinstaller pywebview

运行时依赖 WebView2 Runtime —— Win10 1803+ / Win11 都自带，
没有的话 pywebview 会提示去装（微软官方免费分发）。
"""

import argparse
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = "金龙聚宝"

# 需要打进 exe 的游戏文件。tools/ 和 docs/specs 是开发用的，不打包。
ASSETS = [
    "index.html",
    "styles.css",
    "manifest.webmanifest",
    "js",
    "docs/images/icon-192.png",
    "docs/images/icon-512.png",
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clean", action="store_true", help="先清掉 build/ 和 dist/")
    args = ap.parse_args()

    if args.clean:
        for d in ("build", "dist"):
            shutil.rmtree(os.path.join(ROOT, d), ignore_errors=True)
        spec = os.path.join(ROOT, NAME + ".spec")
        if os.path.exists(spec):
            os.remove(spec)

    sep = ";" if os.name == "nt" else ":"
    add_data = []
    for rel in ASSETS:
        src = os.path.join(ROOT, rel)
        if not os.path.exists(src):
            raise SystemExit("缺少资源：" + rel)
        native = rel.replace("/", os.sep)
        # PyInstaller 的 --add-data 对目录是"把内容拷进 dest"，
        # 所以目录要把自己的名字写进 dest，否则 js/*.js 会被摊平到 game/ 根下，
        # index.html 再去取 js/config.js 就 404 了（页面能上样式但一行脚本都跑不起来）。
        if os.path.isdir(src):
            dest = os.path.join("game", native)
        else:
            parent = os.path.dirname(native)
            dest = os.path.join("game", parent) if parent else "game"
        add_data += ["--add-data", f"{src}{sep}{dest}"]

    icon = os.path.join(ROOT, "docs", "images", "app.ico")
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm", "--clean",
        "--onefile",
        "--windowed",                       # 不弹控制台黑窗
        "--name", NAME,
        "--distpath", os.path.join(ROOT, "dist"),
        "--workpath", os.path.join(ROOT, "build"),
        "--specpath", ROOT,
    ]
    if os.path.exists(icon):
        cmd += ["--icon", icon]
    cmd += add_data
    cmd += [os.path.join(ROOT, "tools", "desktop.py")]

    print("正在打包…（第一次会比较慢）")
    r = subprocess.run(cmd, cwd=ROOT)
    if r.returncode != 0:
        raise SystemExit("PyInstaller 失败，返回码 " + str(r.returncode))

    out = os.path.join(ROOT, "dist", NAME + ".exe")
    if os.path.exists(out):
        mb = os.path.getsize(out) / 1024 / 1024
        print(f"\n完成：{out}  ({mb:.1f} MB)")
    else:
        raise SystemExit("没有生成 exe")


if __name__ == "__main__":
    main()
