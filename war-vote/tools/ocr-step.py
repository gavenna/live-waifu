"""单步 OCR — 截取游戏窗口 + 识别文字 + 输出 JSON"""
import ctypes, json, os, sys
from PIL import Image

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32

class RECT(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                 ("right", ctypes.c_long), ("bottom", ctypes.c_long)]

PW = 0x00000002
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

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
    bh = BH(); bh.biSize = ctypes.sizeof(BH); bh.biWidth = w; bh.biHeight = -h; bh.biPlanes = 1; bh.biBitCount = 32
    buf = (c_ubyte * (w * h * 4))()
    gdi32.GetDIBits(mdc, hbmp, 0, h, buf, ctypes.byref(bh), 0)
    img = Image.frombuffer("RGBA", (w, h), buf, "raw", "BGRA", 0, 1).convert("RGB")
    gdi32.DeleteObject(hbmp); gdi32.DeleteDC(mdc); user32.ReleaseDC(hwnd, hdc)
    return img, w, h

def main():
    hwnd = user32.FindWindowW(None, "Rusted Warfare")
    if not hwnd:
        print("NOT_FOUND")
        sys.exit(1)

    img, w, h = capture(hwnd)
    if img is None:
        print("CAPTURE_FAIL")
        sys.exit(1)

    shot_path = os.path.join(SCRIPT_DIR, "ocr-step-shot.png")
    img.save(shot_path)

    from rapidocr_onnxruntime import RapidOCR
    ocr = RapidOCR()
    result, _ = ocr(shot_path)

    buttons = []
    if result:
        for item in result:
            box, text, conf = item
            if conf < 0.3:
                continue
            xs = [p[0] for p in box]
            ys = [p[1] for p in box]
            cx = (min(xs) + max(xs)) / 2 / w
            cy = (min(ys) + max(ys)) / 2 / h
            buttons.append({"text": text, "x": round(cx, 4), "y": round(cy, 4), "conf": round(conf, 2)})

    result_path = os.path.join(SCRIPT_DIR, "ocr-step-result.json")
    with open(result_path, "w", encoding="utf-8") as f:
        json.dump(buttons, f, ensure_ascii=False, indent=2)

    print("OK {} buttons".format(len(buttons)))

if __name__ == "__main__":
    main()