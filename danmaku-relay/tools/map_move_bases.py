#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""map_move_bases.py — 把两座基地（指挥中心 + **基地/经济建筑**）沿「两 CC 连线」各向外挪。

为什么单独一个工具（而不是手改地图）：这是「换图流水线」的一步，可复用——
  源图（主播摆阵）→ map_adapt_newdire.py → **map_move_bases.py** → gen_map_contract.js。

只移**指挥中心**（默认）：按**单位类型**挑，BASE_TYPES = {'commandCenter'}；
  其他一律原地不动（防御/经济/墙都留下）。--types 可传逗号列表扩到别的类型。
  只改 UnitObjects 的 x/y；Ground/Items 层逐字不动。
  （早期版本用「距 CC ≤radius」挑选，半径一大就把整个防御圈也带走了——故改为按类型，radius 仅作备选。）

用法：
    python map_move_bases.py <产物.tmx> [--out <产物.tmx>] [--dist 500] [--radius-mode --radius 650] [--dry-run]
    python map_move_bases.py --selftest
"""
import argparse
import math
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

_UNITOBJ_RE = re.compile(r'(<objectgroup\b[^>]*\bname="UnitObjects"[^>]*>)([\s\S]*?)(</objectgroup>)')
_OBJ_RE = re.compile(r'<object\b[^>]*>[\s\S]*?</object>')
_OPEN_RE = re.compile(r'<object\b[^>]*>')
_TAG_X = re.compile(r'\bx="(-?[\d.]+)"')
_TAG_Y = re.compile(r'\by="(-?[\d.]+)"')
_TAG_U = re.compile(r'<property\s+name="unit"\s+value="([^"]*)"')
_TAG_T = re.compile(r'<property\s+name="team"\s+value="([^"]*)"')

# ★ 2026-09-27：用户明确「移动 Command 就行了，其他的不用动」⇒ **默认只移指挥中心**。
#   （早前版本还含 viewer_king/经济建筑；要恢复某个类型：加回本集合，或 --types 传逗号列表。）
BASE_TYPES = {'commandCenter'}


def _fmt(v):
    s = ('%.4f' % v).rstrip('0')
    return s if not s.endswith('.') else s + '0'


def _objects(body):
    out = []
    for m in _OBJ_RE.finditer(body):
        full = m.group(0)
        op = _OPEN_RE.search(full)
        if not op:
            continue
        tag = op.group(0)
        u = _TAG_U.search(full)
        t = _TAG_T.search(full)
        x = _TAG_X.search(tag)
        y = _TAG_Y.search(tag)
        if not (u and x and y):
            continue
        out.append({'tag': tag, 'unit': u.group(1), 'team': t.group(1) if t else None,
                    'x': float(x.group(1)), 'y': float(y.group(1)), 'start': m.start(), 'end': m.end()})
    return out


def move_bases(text, dist=500.0, radius=650.0, types=None):
    """红 CC 沿「蓝→红」方向外移 dist、蓝 CC 沿「红→蓝」方向外移 dist。
    types 非 None（含空集）⇒ **类型模式**：只平移 unit ∈ types 的本方对象；
    types 为 None ⇒ 半径模式：平移距本队 CC ≤radius 的本方对象。返回 (新文本, info)。"""
    m = _UNITOBJ_RE.search(text)
    if not m:
        raise SystemExit('ABORT: 找不到 UnitObjects 段')
    body = m.group(2)
    objs = _objects(body)
    cc = {}
    for o in objs:
        if o['unit'] == 'commandCenter' and o['team'] in ('1', '2'):
            cc[o['team']] = (o['x'], o['y'])
    if '1' not in cc or '2' not in cc:
        raise SystemExit('ABORT: 缺红(team1)/蓝(team2) 的 commandCenter')
    rx, ry = cc['1']
    bx, by = cc['2']
    dx, dy = rx - bx, ry - by
    n = math.hypot(dx, dy) or 1.0
    ux, uy = dx / n, dy / n
    shift = {'1': (ux * dist, uy * dist), '2': (-ux * dist, -uy * dist)}

    moved = {'1': 0, '2': 0}
    pieces = []
    prev = 0
    for o in objs:
        t = o['team']
        if t in ('1', '2'):
            if types is not None:
                sel = o['unit'] in types
            else:
                cx, cy = cc[t]
                sel = math.hypot(o['x'] - cx, o['y'] - cy) <= radius
            if sel:
                sx, sy = shift[t]
                nx, ny = o['x'] + sx, o['y'] + sy
                newtag = _TAG_X.sub('x="%s"' % _fmt(nx), o['tag'], count=1)
                newtag = _TAG_Y.sub('y="%s"' % _fmt(ny), newtag, count=1)
                pieces.append(body[prev:o['start']])
                full = body[o['start']:o['end']]
                pieces.append(full.replace(o['tag'], newtag, 1))
                prev = o['end']
                moved[t] += 1
    pieces.append(body[prev:])
    out = text[:m.start(2)] + ''.join(pieces) + text[m.end(2):]
    info = {'redCC': (cc['1'], (rx + shift['1'][0], ry + shift['1'][1])),
            'blueCC': (cc['2'], (bx + shift['2'][0], by + shift['2'][1])),
            'moved': moved, 'distOld': n,
            'distNew': math.hypot((rx + shift['1'][0]) - (bx + shift['2'][0]),
                                  (ry + shift['1'][1]) - (by + shift['2'][1]))}
    return out, info


def _layer(text, name):
    m = re.search(r'(<layer\b[^>]*\bname="%s"[^>]*>\s*<data[^>]*>)(.*?)(</data>)' % name, text, re.S)
    return m.group(2) if m else None


def cmd_selftest():
    def obj(u, t, x, y):
        return ('<object name="%s (t:%d)" x="%s" y="%s"><properties>'
                '<property name="unit" value="%s"/><property name="team" value="%d"/>'
                '</properties></object>\n' % (u, t, x, y, u, t))
    body = (obj('commandCenter', 1, 200, 100) + obj('Ek_solarFarmSation', 1, 230, 100) +
            obj('c_turret_t3_gun', 1, 250, 100) + obj('EkBrickwall1Y', 1, 500, 100) +
            obj('commandCenter', 2, 100, 100) + obj('Ek_solarFarmSation', 2, 70, 100) +
            obj('c_turret_t3_gun', 2, 60, 100))
    text = ('<?xml version="1.0"?>\n<map width="60" height="60" tilewidth="20" tileheight="20" version="1.2">\n'
            '<layer name="Ground" width="60" height="60"><data encoding="base64" compression="gzip"></data></layer>\n'
            '<layer name="Items" width="60" height="60"><data encoding="base64" compression="gzip"></data></layer>\n'
            '<objectgroup name="Triggers"/>\n<objectgroup name="UnitObjects">\n' + body + '</objectgroup>\n</map>')
    fails = 0
    def chk(name, ok, d=''):
        nonlocal fails
        print(('OK   ' if ok else 'FAIL ') + name + (('  -- ' + d) if d else ''))
        if not ok:
            fails += 1
    def xy(out, u, t):
        for o in _objects(_UNITOBJ_RE.search(out).group(2)):
            if o['unit'] == u and o['team'] == str(t):
                return (o['x'], o['y'])
        return None
    # 类型模式（显式传入类型集，与默认 BASE_TYPES 解耦）
    out, info = move_bases(text, dist=50, types={'commandCenter', 'Ek_solarFarmSation'})
    chk('S1 类型模式：CC 外移 +dist', xy(out, 'commandCenter', 1) == (250.0, 100.0), str(xy(out, 'commandCenter', 1)))
    chk('S2 类型模式：经济建筑随基地外移', xy(out, 'Ek_solarFarmSation', 1) == (280.0, 100.0), str(xy(out, 'Ek_solarFarmSation', 1)))
    chk('S3 类型模式：炮塔**不动**', xy(out, 'c_turret_t3_gun', 1) == (250.0, 100.0), str(xy(out, 'c_turret_t3_gun', 1)))
    chk('S4 两 CC 间距 +2*dist', abs(info['distNew'] - 200.0) < 1e-6, '%.1f' % info['distNew'])
    chk('S5 Ground/Items 层逐字不动', _layer(out, 'Ground') == _layer(text, 'Ground') and _layer(out, 'Items') == _layer(text, 'Items'))
    chk('S6 平移对象数 = 每方 CC+太阳能 = 2+2', info['moved'] == {'1': 2, '2': 2}, str(info['moved']))
    # 半径模式（备选）
    out2, info2 = move_bases(text, dist=50, radius=60, types=None)
    chk('S7 半径模式：≤radius 者随基地外移（红 CC+太阳能+炮塔=3）', info2['moved'] == {'1': 3, '2': 3}, str(info2['moved']))
    print('RESULT: ' + ('PASS' if not fails else 'FAIL'))
    return 1 if fails else 0


def main(argv):
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument('src', nargs='?')
    ap.add_argument('--out')
    ap.add_argument('--dist', type=float, default=500.0)
    ap.add_argument('--radius', type=float, default=650.0)
    ap.add_argument('--radius-mode', action='store_true', help='改用半径挑选（默认按 BASE_TYPES 类型）')
    ap.add_argument('--types', help='逗号分隔的类型名，覆盖默认 BASE_TYPES（默认只 commandCenter）')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args(argv)
    if a.selftest:
        return cmd_selftest()
    if not a.src:
        print(__doc__)
        return 2
    text = open(a.src, encoding='utf-8', newline='').read()
    types = None if a.radius_mode else (set(t.strip() for t in a.types.split(',')) if a.types else BASE_TYPES)
    out, info = move_bases(text, a.dist, a.radius, types)
    print('红CC %.0f,%.0f → %.0f,%.0f   蓝CC %.0f,%.0f → %.0f,%.0f' % (
        info['redCC'][0][0], info['redCC'][0][1], info['redCC'][1][0], info['redCC'][1][1],
        info['blueCC'][0][0], info['blueCC'][0][1], info['blueCC'][1][0], info['blueCC'][1][1]))
    print('间距 %.0f → %.0f px  平移对象 红%d/蓝%d（%s模式）' % (
        info['distOld'], info['distNew'], info['moved']['1'], info['moved']['2'],
        '半径' if a.radius_mode else '基地类型'))
    if a.dry_run:
        print('(dry-run，未写盘)')
        return 0
    open(a.out or a.src, 'w', encoding='utf-8', newline='').write(out)
    print('已写入 ' + (a.out or a.src))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
