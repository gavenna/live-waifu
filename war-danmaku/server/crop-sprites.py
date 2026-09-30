"""
精灵图裁切 —— 按角色内容边界裁掉所有透明区域

思路: 每张精灵图只保留有内容的像素范围,
      角色就是角色, 没有多余的透明画布。
用法: python server/crop-sprites.py
"""

from PIL import Image
import os, json, sys

SPRITES_DIR = 'frontend/assets/sprites'
CROP_INFO_FILE = 'frontend/assets/sprites/_crop_info.json'

# 不裁切的文件（背景、特效——它们是全画布用的）
SKIP_CROP = {'battlefield', 'fireArrow_effect', 'wrathOfGod_effect', 'siege_impact'}

def get_content_bbox(img):
    """找到非透明像素的包围盒"""
    alpha = img.split()[-1]  # alpha channel
    # 从左、右、上、下找到第一个非透明像素
    w, h = img.size
    left, right, top, bottom = w, 0, h, 0

    # 快速扫描
    pixels = img.load()
    for y in range(h):
        for x in range(w):
            if pixels[x, y][3] > 10:  # 有内容（忽略几乎透明的像素）
                if x < left: left = x
                if x > right: right = x
                if y < top: top = y
                if y > bottom: bottom = y

    if left > right or top > bottom:
        return (0, 0, w, h)  # 全透明, 保持原样

    # 加 2px 边距防止裁太紧
    left = max(0, left - 2)
    top = max(0, top - 2)
    right = min(w - 1, right + 2)
    bottom = min(h - 1, bottom + 2)

    return (left, top, right + 1, bottom + 1)

def main():
    if not os.path.isdir(SPRITES_DIR):
        print(f"Error: {SPRITES_DIR} not found")
        sys.exit(1)

    files = sorted(f for f in os.listdir(SPRITES_DIR)
                   if f.endswith('.png') and not f.startswith('_'))

    print(f"Cropping {len(files)} sprites...\n")
    crop_info = {}

    for f in files:
        path = os.path.join(SPRITES_DIR, f)
        key = f.replace('.png', '')
        if key in SKIP_CROP:
            print(f"  {f:30s} SKIP (background/effect)")
            continue
        img = Image.open(path)

        if img.mode != 'RGBA':
            img = img.convert('RGBA')

        old_w, old_h = img.size
        bbox = get_content_bbox(img)
        left, top, right, bottom = bbox
        new_w = right - left
        new_h = bottom - top

        # 裁切
        cropped = img.crop(bbox)

        # 居中放在透明画布上（保持锚点 = 底部中心）
        # 新画布高度不变，宽度取裁切后的宽度
        canvas = Image.new('RGBA', (new_w, new_h), (0, 0, 0, 0))
        canvas.paste(cropped, (0, 0))

        canvas.save(path, 'PNG')

        # 记录裁切信息
        crop_info[f] = {
            'origSize': [old_w, old_h],
            'cropBox': [left, top, right, bottom],
            'newSize': [new_w, new_h],
            'anchorOffset': [left, old_h - bottom],  # 底部中心偏移
        }

        pct = 100 * (new_w * new_h) // (old_w * old_h)
        print(f"  {f:30s} {old_w}x{old_h} -> {new_w}x{new_h} ({pct}% of original)")

    # 保存裁切信息供渲染器使用
    with open(CROP_INFO_FILE, 'w') as fp:
        json.dump(crop_info, fp, indent=2)

    total_old = sum(v['origSize'][0] * v['origSize'][1] for v in crop_info.values())
    total_new = sum(v['newSize'][0] * v['newSize'][1] for v in crop_info.values())
    print(f"\nTotal: {total_old//1000}K -> {total_new//1000}K pixels ({100*total_new//total_old}%)")
    print(f"Crop info saved to {CROP_INFO_FILE}")

if __name__ == '__main__':
    main()
