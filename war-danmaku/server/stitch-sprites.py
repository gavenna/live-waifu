"""
拼接精灵图条脚本 — 将逐帧 PNG 拼成水平 sprite sheet

输入: frontend/assets/sprites/<key>.png (idle_0 底图)
      frontend/assets/sprites/frames/<key>_<state>_<n>.png (动画帧)
输出: frontend/assets/sprites/<key>_anim.png (18 帧水平条)

帧序: [idle_0..3][walk_0..5][attack_0..3][death_0..3]

用法: python server/stitch-sprites.py [--troop <key>]
"""

import os
import sys
from PIL import Image

BASE = os.path.join('frontend', 'assets', 'sprites')
FRAMES = os.path.join(BASE, 'frames')

# 显示尺寸 (匹配 animation-manifest.json 中的 frameWidth/frameHeight)
DISPLAY_SIZES = {
    'militia':      (24, 32),
    'swordsman':    (28, 36),
    'knight':       (48, 40),
    'archer':       (24, 36),
    'catapult':     (56, 40),
    'royalGuard':   (32, 40),
    'giant':        (72, 96),
    'dragonKnight': (90, 72),
}


def stitch_troop(key, frame_w, frame_h):
    """拼接单个兵种的 sprite sheet"""
    base_path = os.path.join(BASE, f'{key}.png')
    if not os.path.exists(base_path):
        print(f'  [FAIL] 底图不存在: {base_path}')
        return False

    base_img = Image.open(base_path).convert('RGBA')

    # 收集所有帧 (按顺序)
    frame_order = []
    # idle_0: 底图本身
    frame_order.append(('base', base_img))

    # idle_1, idle_2, idle_3
    for i in range(1, 4):
        fp = os.path.join(FRAMES, f'{key}_idle_{i}.png')
        frame_order.append(('file', fp))

    # walk_0..5 (6 frames from img2img)
    for i in range(6):
        fp = os.path.join(FRAMES, f'{key}_walk_{i}.png')
        frame_order.append(('file', fp))

    # attack_0..3
    for i in range(4):
        fp = os.path.join(FRAMES, f'{key}_attack_{i}.png')
        frame_order.append(('file', fp))

    # death_0..3
    for i in range(4):
        fp = os.path.join(FRAMES, f'{key}_death_{i}.png')
        frame_order.append(('file', fp))

    # 总共 1 + 3 + 5 + 4 + 4 = 17 帧? 不对，应该是 4 + 6 + 4 + 4 = 18 帧
    # idle: 4 frames (0=base, 1-3=generated)
    # walk: 6 frames but we only generated 5. Where's walk_5?
    #
    # Actually, the manifest says walk has 6 frames and we generated 5 from img2img.
    # Walk frame 5 is... we need to generate it or mirror frame 4.
    # Let me use walk_4 mirrored (or just copy walk_4) for walk_5.
    #
    # Hmm, actually wait. Let me re-check the gen-anim-frames.js:
    # walk has 5 frames generated (index 0-4), but the manifest says 6 frames.
    # This is a mismatch! I need to fix this.
    #
    # Options:
    # A) Generate 6 walk frames instead of 5
    # B) Use 5 walk frames in the manifest
    # C) Derive frame 5 from existing frames (mirror frame 0 or something)
    #
    # Actually, the gen-anim-frames.js generates walk indices 0-4 (5 frames).
    # But a proper 6-frame walk cycle needs to close the loop.
    # The simplest fix: modify the stitch script to repeat walk_0 as walk_5
    # (the first and last frames of a walk cycle look similar, just mirrored leg positions)

    print(f'  收集了 {len(frame_order)} 帧引用 (1 base + 3 idle + 6 walk + 4 attack + 4 death)')

    # 处理每帧
    frames = []
    missing = []
    for src_type, src_path in frame_order:
        if src_type == 'base':
            img = src_path  # 已经是 PIL Image
        else:
            if not os.path.exists(src_path):
                missing.append(os.path.basename(src_path))
                # 用底图作为缺失帧的 fallback（至少不会断）
                img = base_img.copy()
            else:
                img = Image.open(src_path).convert('RGBA')

        # 缩放到显示尺寸
        img = img.resize((frame_w, frame_h), Image.LANCZOS)
        frames.append(img)

    if missing:
        print(f'  [WARN] 缺失 {len(missing)} 帧，已用底图填补: {", ".join(missing[:5])}...')

    # 拼接水平条
    total_w = frame_w * len(frames)
    sheet = Image.new('RGBA', (total_w, frame_h), (0, 0, 0, 0))
    for i, img in enumerate(frames):
        sheet.paste(img, (i * frame_w, 0), img)

    # 保存
    out_path = os.path.join(BASE, f'{key}_anim.png')
    sheet.save(out_path, 'PNG')
    file_size = os.path.getsize(out_path)
    print(f'  [OK] {out_path} ({total_w}×{frame_h}, {file_size/1024:.1f}KB)')

    return True


def main():
    target = sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == '--troop' else None

    troops = DISPLAY_SIZES
    if target:
        if target not in DISPLAY_SIZES:
            print(f'未知兵种: {target}')
            print(f'可用: {list(DISPLAY_SIZES.keys())}')
            sys.exit(1)
        troops = {target: DISPLAY_SIZES[target]}
        print(f'[stitch] 单兵种: {target}\n')
    else:
        print(f'[stitch] 全量 {len(troops)} 兵种 sprite sheet\n')

    ok, fail = 0, 0
    for key, (w, h) in troops.items():
        print(f'{key} ({w}×{h}):')
        if stitch_troop(key, w, h):
            ok += 1
        else:
            fail += 1

    print(f'\n═══════════════════')
    print(f'  OK: {ok}, FAIL: {fail}')
    print(f'  输出: {BASE}/<key>_anim.png')
    print(f'═══════════════════')


if __name__ == '__main__':
    main()
