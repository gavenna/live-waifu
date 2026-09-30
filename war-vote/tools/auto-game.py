"""
自适应游戏自动化 — 每步 OCR 识别 → 点击 → 等待 → 下一步
用法: python tools/auto-game.py
"""
import ctypes, ctypes.wintypes, time, json, os, sys
from PIL import Image

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32

class RECT(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                 ("right", ctypes.c_long), ("bottom", ctypes.c_long)]
class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

PW = 0x00000002
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# === 截图 ===
def capture(hwnd):
    cr = RECT()
    user32.GetClientRect(hwnd, ctypes.byref(cr))
    w, h = cr.right, cr.bottom
    if w <= 0 or h <= 0:
        return None, 0, 0
    hdc = user32.GetDC(hwnd)
    mdc = gdi32.CreateCompatibleDC(hdc)
    hbmp = gdi32.CreateCompatibleBitmap(hdc, w, h)
    gdi32.SelectObject(mdc, hbmp)
    user32.PrintWindow(hwnd, mdc, PW)
    from ctypes import c_ubyte, byref
    class BH(ctypes.Structure):
        _fields_ = [("biSize", ctypes.c_uint), ("biWidth", ctypes.c_long), ("biHeight", ctypes.c_long),
                     ("biPlanes", ctypes.c_ushort), ("biBitCount", ctypes.c_ushort),
                     ("biCompression", ctypes.c_uint), ("biSizeImage", ctypes.c_uint),
                     ("biXPelsPerMeter", ctypes.c_long), ("biYPelsPerMeter", ctypes.c_long),
                     ("biClrUsed", ctypes.c_uint), ("biClrImportant", ctypes.c_uint)]
    bh = BH()
    bh.biSize = ctypes.sizeof(BH)
    bh.biWidth = w
    bh.biHeight = -h
    bh.biPlanes = 1
    bh.biBitCount = 32
    buf = (c_ubyte * (w * h * 4))()
    gdi32.GetDIBits(mdc, hbmp, 0, h, buf, ctypes.byref(bh), 0)
    img = Image.frombuffer("RGBA", (w, h), buf, "raw", "BGRA", 0, 1).convert("RGB")
    gdi32.DeleteObject(hbmp)
    gdi32.DeleteDC(mdc)
    user32.ReleaseDC(hwnd, hdc)
    return img, w, h

# === OCR ===
_ocr = None
def get_ocr():
    global _ocr
    if _ocr is None:
        from rapidocr_onnxruntime import RapidOCR
        _ocr = RapidOCR()
    return _ocr

def ocr_image(img_path):
    ocr = get_ocr()
    result, _ = ocr(img_path)
    buttons = []
    if result:
        img = Image.open(img_path)
        w, h = img.size
        for item in result:
            box, text, conf = item
            if conf < 0.3:
                continue
            xs = [p[0] for p in box]
            ys = [p[1] for p in box]
            cx = (min(xs) + max(xs)) / 2 / w
            cy = (min(ys) + max(ys)) / 2 / h
            buttons.append({"text": text, "x": round(cx, 4), "y": round(cy, 4)})
    return buttons

# === 点击 ===
def click_at(hwnd, x_pct, y_pct):
    # 先激活窗口
    orig = user32.GetForegroundWindow()
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.2)

    # 客户区坐标转屏幕坐标
    cr2 = RECT()
    user32.GetClientRect(hwnd, ctypes.byref(cr2))
    pt = POINT(int(cr2.right * x_pct), int(cr2.bottom * y_pct))
    user32.ClientToScreen(hwnd, ctypes.byref(pt))

    # 移动 + 点击
    user32.SetCursorPos(pt.x, pt.y)
    time.sleep(0.1)
    user32.mouse_event(0x0002, 0, 0, 0, 0)
    time.sleep(0.15)
    user32.mouse_event(0x0004, 0, 0, 0, 0)

    # 切回原窗口
    time.sleep(0.2)
    if orig:
        user32.SetForegroundWindow(orig)

# === 查找按钮 ===
def find_button(buttons, text):
    for b in buttons:
        if text.lower() in b["text"].lower():
            return b
    return None

# === 主流程 ===
def main():
    print("=== 自适应游戏自动化 ===\n")

    hwnd = user32.FindWindowW(None, "Rusted Warfare")
    if not hwnd:
        print("ERROR: 游戏未运行")
        sys.exit(1)

    # 客户区大小
    cr = RECT()
    user32.GetClientRect(hwnd, ctypes.byref(cr))
    client_w, client_h = cr.right, cr.bottom
    print("客户区: {}x{}".format(client_w, client_h))

    # 步骤定义
    steps = [
        {"find": "单人战役", "label": "主菜单→单人战役", "wait": 3},
        {"find": "Skirmish", "label": "→Skirmish", "wait": 2},
        {"find": "Start", "label": "→开始游戏", "wait": 5},
    ]

    for i, step in enumerate(steps):
        print("\n[{}/{}] {}".format(i + 1, len(steps), step["label"]))

        # 截图
        img, w, h = capture(hwnd)
        if img is None:
            print("  ERROR: 截图失败")
            continue

        shot_path = os.path.join(SCRIPT_DIR, "step-{}.png".format(i))
        img.save(shot_path)

        # OCR
        buttons = ocr_image(shot_path)
        print("  OCR 识别到 {} 个文字".format(len(buttons)))
        for b in buttons:
            print("    {:<20} ({:.3f}, {:.3f})".format(b["text"], b["x"], b["y"]))

        # 查找目标
        target = find_button(buttons, step["find"])
        if not target:
            print("  WARN: 未找到 '{}'，跳过".format(step["find"]))
            continue

        print("  -> 点击 '{}' @ ({:.3f}, {:.3f})".format(target["text"], target["x"], target["y"]))
        click_at(hwnd, target["x"], target["y"])

        print("  等待 {} 秒...".format(step["wait"]))
        time.sleep(step["wait"])

    print("\n=== 完成 ===")

if __name__ == "__main__":
    main()