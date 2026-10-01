import ctypes, ctypes.wintypes as wt, os, subprocess, time, sys
user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
user32.SetProcessDPIAware()

EXE = os.path.join("dist", "金龙聚宝.exe")
print("exe 存在:", os.path.isfile(EXE), f"{os.path.getsize(EXE)/1048576:.1f} MB")

proc = subprocess.Popen([EXE])
found = None
deadline = time.time() + 40
while time.time() < deadline and found is None:
    titles = []
    @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def cb(hwnd, _):
        if not user32.IsWindowVisible(hwnd): return True
        n = user32.GetWindowTextLengthW(hwnd)
        if n == 0: return True
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(hwnd, buf, n + 1)
        # PyInstaller onefile 的引导程序会再 fork 一个子进程，
        # 窗口属于子进程，所以不能按 proc.pid 过滤，直接按标题找。
        titles.append((hwnd, buf.value))
        return True
    user32.EnumWindows(cb, 0)
    for hwnd, t in titles:
        if "金龙" in t or "243" in t:
            found = (hwnd, t); break
    time.sleep(0.5)

if proc.poll() is not None:
    print("进程已退出，返回码", proc.returncode); sys.exit(1)
if not found:
    print("没找到窗口"); proc.terminate(); sys.exit(1)

hwnd, title = found
print("窗口标题:", title)
time.sleep(9)   # 等游戏渲染出来

r = wt.RECT()
user32.GetClientRect(hwnd, ctypes.byref(r))
w, h = r.right, r.bottom
print(f"客户区尺寸: {w}x{h}")

hdc = user32.GetWindowDC(hwnd)
mem = gdi32.CreateCompatibleDC(hdc)
bmp = gdi32.CreateCompatibleBitmap(hdc, w, h)
gdi32.SelectObject(mem, bmp)
# PW_RENDERFULLCONTENT = 2，WebView2 需要这个标志才截得到
ok = user32.PrintWindow(hwnd, mem, 2)
print("PrintWindow:", bool(ok))

class BMIH(ctypes.Structure):
    _fields_ = [("biSize", wt.DWORD), ("biWidth", wt.LONG), ("biHeight", wt.LONG),
                ("biPlanes", wt.WORD), ("biBitCount", wt.WORD), ("biCompression", wt.DWORD),
                ("biSizeImage", wt.DWORD), ("biXPelsPerMeter", wt.LONG),
                ("biYPelsPerMeter", wt.LONG), ("biClrUsed", wt.DWORD), ("biClrImportant", wt.DWORD)]
bi = BMIH(); bi.biSize = ctypes.sizeof(BMIH); bi.biWidth = w; bi.biHeight = -h
bi.biPlanes = 1; bi.biBitCount = 32; bi.biCompression = 0
buf = ctypes.create_string_buffer(w * h * 4)
gdi32.GetDIBits(mem, bmp, 0, h, buf, ctypes.byref(bi), 0)

from PIL import Image
img = Image.frombuffer("RGBA", (w, h), buf, "raw", "BGRA", 0, 1).convert("RGB")
img.save("tools/_exe_shot.png")
nonblack = sum(1 for p in img.resize((80, 50)).getdata() if sum(p) > 40)
print(f"非黑像素占比: {nonblack/4000:.1%}  -> tools/_exe_shot.png")

gdi32.DeleteObject(bmp); gdi32.DeleteDC(mem); user32.ReleaseDC(hwnd, hdc)
proc.terminate()
try: proc.wait(timeout=5)
except Exception: proc.kill()
print("已关闭")
