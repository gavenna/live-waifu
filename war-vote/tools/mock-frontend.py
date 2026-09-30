# -*- coding: utf-8 -*-
"""按 frontend/renderer.js 的地图区参数 1:1 渲染一张 PNG，用于目视检查编号可读性。

需要服务在跑（读它的 /api/state），不需要浏览器。
用法: python tools/mock-frontend.py
"""

import json
import re
import urllib.request
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
ROOT = HERE.parent

cfg = (ROOT / 'server' / 'config.js').read_text(encoding='utf-8')
RW_DIR = Path(re.search(r"RW_DIR:\s*'([^']+)'", cfg).group(1))
UNITS_FIRSTGID = int(re.search(r"UNITS_FIRSTGID:\s*(\d+)", cfg).group(1))

# 与 renderer.js 的 UI_POS.map 保持一致
MAP_X, MAP_Y, MAP_SIZE = 530, 92, 860
TILE, SHEET_COLS, SHEET_SP, SHEET_MG = 20, 9, 1, 1

state = json.loads(urllib.request.urlopen('http://localhost:8768/api/state').read())['snapshot']
W, H = state['mapW'], state['mapH']
cell = MAP_SIZE // W
font_size = max(11, int(cell * 0.7))

try:
    font = ImageFont.truetype('C:/Windows/Fonts/consolab.ttf', font_size)
except OSError:
    font = ImageFont.load_default()

sheet = Image.open(RW_DIR / 'mods' / 'maps' / 'bitmaps' / 'units.png').convert('RGBA')
grass = Image.open(RW_DIR / 'mods' / 'maps' / 'terrain' / 'bitmaps' / 'shortgrass.png').convert('RGBA')

canvas = Image.new('RGBA', (MAP_SIZE, MAP_SIZE), (0, 0, 0, 255))
draw = ImageDraw.Draw(canvas, 'RGBA')

gt = grass.resize((cell, cell), Image.NEAREST)
for y in range(H):
    for x in range(W):
        canvas.paste(gt, (x * cell, y * cell))

ACCENT = {'red': (255, 192, 192), 'blue': (192, 216, 255)}
BG = {'red': (110, 20, 20, 66), 'blue': (20, 45, 95, 66)}
OVER_BG = (95, 75, 10, 128)

empty = 0
for side in ('red', 'blue'):
    for s in state['slots'][side]:
        if s['filled']:
            continue
        empty += 1
        px, py = s['x'] * cell, s['y'] * cell
        fill = OVER_BG if s.get('overflow') else BG[side]
        draw.rectangle([px, py, px + cell - 1, py + cell - 1], fill=fill)
        color = (255, 209, 102) if s.get('overflow') else ACCENT[side]
        draw.text((px + cell / 2, py + cell / 2), str(s['n']),
                  font=font, fill=color, anchor='mm',
                  stroke_width=2, stroke_fill=(0, 0, 0, 235))

for gx, gy, tile_id in state['grid']:
    sx = SHEET_MG + (tile_id % SHEET_COLS) * (TILE + SHEET_SP)
    sy = SHEET_MG + (tile_id // SHEET_COLS) * (TILE + SHEET_SP)
    sprite = sheet.crop((sx, sy, sx + TILE, sy + TILE)).resize((cell, cell), Image.NEAREST)
    canvas.paste(sprite, (gx * cell, gy * cell), sprite)

out = HERE / 'mock-frontend.png'
canvas.save(out)
print('wrote:', out)
print('地图 %dx%d  每格 %dpx  编号字号 %dpx' % (W, H, cell, font_size))
print('空位 %d 个 | 红 %d/%d  蓝 %d/%d' % (
    empty, state['totals']['red'], state['slotTotal'],
    state['totals']['blue'], state['slotTotal']))
