"""
精灵图透明通道修复脚本 v2

v1 bug: 背景像素设成了半透明(alpha=127)而非完全透明(alpha=0)
v2 修复: 背景色区域 → alpha=0，仅边缘做 2px 羽化过渡

用法: python server/fix-sprites.py [--keep-size]
"""

from PIL import Image
import os, sys, collections

SPRITES_DIR = 'frontend/assets/sprites'

# Art Bible 尺寸规范
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

KEEP_SIZE = '--keep-size' in sys.argv

def get_edge_pixels(img):
    """采样图片四边所有像素"""
    w, h = img.size
    pixels = []
    for x in range(w):
        pixels.append(img.getpixel((x, 0)))       # 顶边
        pixels.append(img.getpixel((x, h-1)))     # 底边
    for y in range(1, h-1):
        pixels.append(img.getpixel((0, y)))       # 左边
        pixels.append(img.getpixel((w-1, y)))     # 右边
    return pixels

def get_dominant_background(img):
    """从四边像素中找出主背景色（出现最多的颜色族）"""
    edge_pixels = get_edge_pixels(img)
    # 量化颜色到 16 级以减少噪声
    quantized = {}
    for px in edge_pixels:
        r, g, b = px[0], px[1], px[2]
        qr, qg, qb = r // 16, g // 16, b // 16
        key = (qr, qg, qb)
        quantized[key] = quantized.get(key, 0) + 1
    # 取出现最多的颜色族
    best = max(quantized, key=quantized.get)
    return (best[0] * 16 + 8, best[1] * 16 + 8, best[2] * 16 + 8)

def remove_background(img, threshold=60):
    """背景区域 → alpha=0，边缘 2px 羽化"""
    img = img.convert('RGBA')
    bg = get_dominant_background(img)
    pixels = img.load()
    w, h = img.size
    print(f"    bg color=({bg[0]},{bg[1]},{bg[2]}) threshold={threshold}")

    def dist(c1, c2):
        return abs(c1[0]-c2[0]) + abs(c1[1]-c2[1]) + abs(c1[2]-c2[2])

    # 第一遍：标记每个像素离背景的"距离级"
    distance_map = {}
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            d = dist((r, g, b), bg)
            distance_map[(x, y)] = d

    # 第二遍：根据距离设置 alpha
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            d = distance_map[(x, y)]

            if d < threshold:
                # 背景区域 → 完全透明
                pixels[x, y] = (r, g, b, 0)
            elif d < threshold + 15:
                # 过渡带 → 羽化 (alpha 从 0 渐变到 255)
                alpha = int((d - threshold) / 15 * 255)
                pixels[x, y] = (r, g, b, alpha)
            # else: 前景 → 保持原样

    return img

def resize_to_spec(img, key):
    """缩放到 Art Bible 规范尺寸"""
    if KEEP_SIZE: return img
    target = SIZE_SPECS.get(key.replace('.png', ''))
    if not target: return img
    if img.width <= target[0] and img.height <= target[1]:
        return img
    img.thumbnail(target, Image.LANCZOS)
    canvas = Image.new('RGBA', target, (0, 0, 0, 0))
    ox = (target[0] - img.width) // 2
    oy = (target[1] - img.height) // 2
    canvas.paste(img, (ox, oy))
    return canvas

def main():
    if not os.path.isdir(SPRITES_DIR):
        print(f"Error: {SPRITES_DIR} not found")
        sys.exit(1)

    files = sorted(f for f in os.listdir(SPRITES_DIR) if f.endswith('.png'))
    print(f"Processing {len(files)} sprites...\n")

    for f in files:
        path = os.path.join(SPRITES_DIR, f)
        img = Image.open(path)
        old_mode, old_size = img.mode, img.size

        # 1. 去背景
        img = remove_background(img)

        # 2. 缩放
        key = f.replace('.png', '')
        img = resize_to_spec(img, f)

        img.save(path, 'PNG')
        print(f"  {f:30s} {old_mode}->RGBA  {old_size[0]}x{old_size[1]}->{img.size[0]}x{img.size[1]}  OK")

    print(f"\nDone! All sprites: RGBA + fully transparent background")

if __name__ == '__main__':
    main()
