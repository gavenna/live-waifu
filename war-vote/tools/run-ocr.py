from paddleocr import PaddleOCR
from PIL import Image
import json, logging
logging.disable(logging.WARNING)

shot = "tools/ocr-screenshot.png"
img = Image.open(shot)
w, h = img.size
print("图片: {}x{}".format(w, h))
print("PaddleOCR 识别中...")

ocr = PaddleOCR(lang="en")
result = ocr.ocr(shot)

if not result or not result[0]:
    print("未识别到文字")
else:
    lines = result[0]
    print("\n找到 {} 个文字区域:\n".format(len(lines)))
    steps = []
    for line in lines:
        box, (text, conf) = line
        if conf < 0.3:
            continue
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        cx = (min(xs) + max(xs)) / 2 / w
        cy = (min(ys) + max(ys)) / 2 / h
        print("  {:<25} {:>5.1f}% ({:.3f}, {:.3f})".format(text, conf*100, cx, cy))
        steps.append({"text": text, "x": round(cx, 4), "y": round(cy, 4)})

    with open("tools/ocr-results.json", "w", encoding="utf-8") as f:
        json.dump({"buttons": steps}, f, indent=2, ensure_ascii=False)
    print("\n结果已保存: tools/ocr-results.json")