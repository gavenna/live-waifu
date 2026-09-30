"""游戏菜单 OCR 自动识别 — PaddleOCR"""
import sys, os, ctypes, json
from PIL import ImageGrab

GAME_TITLE = "Rusted Warfare"

def find_game_window():
    user32 = ctypes.windll.user32
    class RECT(ctypes.Structure):
        _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                     ("right", ctypes.c_long), ("bottom", ctypes.c_long)]
    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    results = []
    def enum_cb(hwnd, _):
        if user32.IsWindowVisible(hwnd):
            length = user32.GetWindowTextLengthW(hwnd)
            if length > 0:
                buf = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buf, length + 1)
                title = buf.value
                rect = RECT()
                user32.GetWindowRect(hwnd, ctypes.byref(rect))
                w, h = rect.right - rect.left, rect.bottom - rect.top
                if w > 200 and h > 200 and ("rusted" in title.lower() or "warfare" in title.lower()):
                    results.append({"title": title, "left": rect.left, "top": rect.top, "width": w, "height": h})
        return True
    user32.EnumWindows(EnumWindowsProc(enum_cb), 0)
    return results[0] if results else None

def main():
    print("=== 游戏菜单 OCR 自动识别 (PaddleOCR) ===\n")
    win = find_game_window()
    if not win:
        print("未找到游戏窗口"); sys.exit(1)
    print(f"窗口: {win['title']} ({win['width']}x{win['height']})")

    img = ImageGrab.grab(bbox=(win["left"], win["top"], win["left"]+win["width"], win["top"]+win["height"]))
    shot = os.path.join(os.path.dirname(__file__), "..", "tools", "ocr-screenshot.png")
    os.makedirs(os.path.dirname(shot), exist_ok=True)
    img.save(shot)
    print(f"截图: {shot}\n")

    print("PaddleOCR 识别中...")
    from paddleocr import PaddleOCR
    ocr = PaddleOCR(use_angle_cls=True, lang='en', show_log=False)
    result = ocr.ocr(shot, cls=True)

    if not result or not result[0]:
        print("未识别到文字"); sys.exit(1)

    print(f"\n{'文字':<25} {'置信度':>6} {'相对坐标':>18}")
    print("-" * 55)
    steps = []
    for line in result[0]:
        box, (text, conf) = line
        if conf < 0.3: continue
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        cx = (min(xs) + max(xs)) / 2 / win["width"]
        cy = (min(ys) + max(ys)) / 2 / win["height"]
        print(f"{text:<25} {conf*100:>5.1f}% ({cx:.3f}, {cy:.3f})")
        steps.append({"text": text, "x": round(cx, 4), "y": round(cy, 4), "conf": round(conf, 2)})

    out = os.path.join(os.path.dirname(__file__), "..", "tools", "ocr-results.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"window": win, "buttons": steps}, f, indent=2, ensure_ascii=False)
    print(f"\n结果已保存: {out}")

if __name__ == "__main__":
    main()