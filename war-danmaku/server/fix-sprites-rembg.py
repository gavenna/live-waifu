"""
精灵图去背景 — rembg (U²-Net 深度学习) 方案

与 fix-sprites.py 颜色距离方案的对比:
  fix-sprites: 简单色差 → 边缘羽化 → 半透明残留 → 方块感
  rembg:     U²-Net 语义分割 → 精确蒙版 → 干净透明 → 专业品质

用法: python server/fix-sprites-rembg.py [sprite_name]
      不带参数 = 处理全部，带参数 = 只处理指定文件
"""

import os, sys
from PIL import Image
import numpy as np

SPRITES_DIR = 'frontend/assets/sprites'

SIZE_SPECS = {
    'militia': (512, 512), 'swordsman': (512, 512), 'archer': (512, 512),
    'knight': (512, 512), 'royalGuard': (512, 512),
    'catapult': (768, 512),
    'giant': (768, 768), 'dragonKnight': (768, 768),
    'castle_red': (1024, 512), 'castle_blue': (1024, 512),
    'battlefield': (1920, 1080),
    'fireArrow_effect': (512, 512), 'wrathOfGod_effect': (512, 512),
    'siege_impact': (512, 512),
}

def process_sprite(path):
    """用 rembg 去除背景"""
    from rembg import remove

    img = Image.open(path)
    old_size = img.size

    # rembg 需要 RGB 输入
    if img.mode == 'RGBA':
        rgb = img.convert('RGB')
    else:
        rgb = img

    # AI 去背景
    output = remove(rgb)

    # 确保是 RGBA
    if output.mode != 'RGBA':
        output = output.convert('RGBA')

    # 缩放
    key = os.path.basename(path)
    target = SIZE_SPECS.get(key.replace('.png', ''))
    if target and (output.width > target[0] or output.height > target[1]):
        output.thumbnail(target, Image.LANCZOS)
        canvas = Image.new('RGBA', target, (0, 0, 0, 0))
        ox = (target[0] - output.width) // 2
        oy = (target[1] - output.height) // 2
        canvas.paste(output, (ox, oy))
        output = canvas

    return output, old_size

def main():
    if not os.path.isdir(SPRITES_DIR):
        print(f"Error: {SPRITES_DIR} not found")
        sys.exit(1)

    # 确定处理范围
    if len(sys.argv) > 1:
        files = [f for f in sys.argv[1:] if f.endswith('.png')]
    else:
        files = sorted(f for f in os.listdir(SPRITES_DIR) if f.endswith('.png'))

    if not files:
        print("No PNG files to process")
        return

    print(f"rembg processing {len(files)} sprites...")
    print("(First run downloads U2Net model ~170MB)\n")

    # 首次调用会下载模型
    for f in files:
        path = os.path.join(SPRITES_DIR, f)
        print(f"  {f:30s} ...", end=' ', flush=True)

        try:
            output, old_size = process_sprite(path)
            output.save(path, 'PNG')
            # 统计
            total = output.width * output.height
            arr = np.array(output)
            transparent = (arr[:, :, 3] == 0).sum()
            pct = 100 * transparent // total
            print(f"OK  {old_size[0]}x{old_size[1]}->{output.size[0]}x{output.size[1]}  {transparent}/{total} transparent ({pct}%)")
        except Exception as e:
            print(f"FAIL: {e}")

    print(f"\nDone!")

if __name__ == '__main__':
    main()
