#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""map_thermopylae.py — 确定性生成"温泉关战役"地图 thermopylae.tmx。

## 这是什么

把直播对战地图换成温泉关场景：一条从西（希腊营地）到东（波斯集结区）的走廊，
中段收窄成 **5 格宽**的隘口；红方(team1)扮演数量压倒的波斯攻方、蓝方(team2)扮演
扼守隘口的希腊守方。胜负规则沿用现有"拆指挥中心"。

## 两个关键的技术依据（都来自源码/文件实测）

1. **水的判定**：引擎读的是 tile 的 XML 属性 `water`（`game\\b\\g.java:191` →
   `((g)object).e = true`），**不是图片名**。图片名（water.png 等）只决定渲染水体类型
   （`g.java:237-243` 设置 n5=2/5）。
   本生成器因此**逐字复制模板地图的 `<tileset>` 声明**，直接复用模板里已经带
   `water` 属性的水图块——不自己造 tileset，避免属性漏写导致"水不挡人"。
2. **两栖单位能过水**：`movementType: HOVER` 的定义就是"可在陆地和水上移动"。
   所以本图的编成**刻意不含任何 HOVER 单位**（`hoverTank` / `heavyHoverTank` 全部
   换成 LAND 单位），否则单兵就能绕过隘口，整个场景失去意义。

## 用法

    python map_thermopylae.py check      # 校验（未生成/不符 => exit 1）
    python map_thermopylae.py apply      # 确定性生成
    python map_thermopylae.py terrain    # 只打印地形剖面 + 连通性断言
    python map_thermopylae.py dump       # 打印逐层摘要与各单位坐标
    python map_thermopylae.py revert --yes   # 删除本工具生成的图

环境变量：`RW_GAME_DIR` 覆盖游戏目录。
"""
import base64
import gzip
import os
import re
import struct
import sys

sys.stdout.reconfigure(encoding="utf-8")

GAME = os.environ.get("RW_GAME_DIR",
                      r"D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15")
MAPDIR = os.path.join(GAME, "mods", "maps")
TARGET = os.path.join(MAPDIR, "thermopylae.tmx")
TEMPLATE = os.path.join(MAPDIR, "live_dire.tmx")
UNITS_TSX = os.path.join(MAPDIR, "units.tsx")

W, H = 140, 60
CHOKE_X0, CHOKE_X1 = 70, 78      # 隘口所在 x 区间（闭开区间 [70,78)）
CHOKE_H = 5                      # 隘口宽度（格）
NARROW_START, FLARE_END = 40, 140
FULL_H = 60

WATER_TILESET_NAMES = ("Shallow Water", "Water", "Deep Water")


# ------------------------------------------------------------------ 地形

def land_h(x):
    """x 处可通行陆地的高度（格）。分段线性，纯函数、无随机。"""
    if x < NARROW_START:
        return FULL_H
    if x < CHOKE_X0:
        return round(FULL_H - (FULL_H - CHOKE_H) * (x - NARROW_START) / (CHOKE_X0 - NARROW_START))
    if x < CHOKE_X1:
        return CHOKE_H
    return round(CHOKE_H + (FULL_H - CHOKE_H) * (x - CHOKE_X1) / (W - CHOKE_X1))


def land_rows(x):
    h = land_h(x)
    y0 = (H - h) // 2
    return y0, y0 + h


def is_land(x, y):
    y0, y1 = land_rows(x)
    return y0 <= y < y1


# ------------------------------------------------------------------ 编成

# (team, unit, x, y)。全部为 LAND 单位（无 HOVER），保证隘口唯一可通行。
# 红=波斯攻方(team1) 32 个；蓝=希腊守方(team2) 10 个 —— 3.2:1。
LAYOUT = []
# 红：东端集结
LAYOUT += [(1, "commandCenter", 137, 30), (1, "builder", 134, 30)]
for i in range(22):                      # 22 辆 tank：4 列梯形
    col, row = i // 6, i % 6
    LAYOUT.append((1, "tank", 104 + col * 7, 27 + row))
for i in range(6):                       # 6 辆 heavyTank：分列坦克方阵上下两侧
    LAYOUT.append((1, "heavyTank", 108 + i * 5, 25 if i < 3 else 34))
LAYOUT += [(1, "artillery", 130, 26), (1, "artillery", 130, 34)]
# 蓝：隘口西侧（全部堆在最窄处两侧）
LAYOUT += [(2, "commandCenter", 4, 30), (2, "builder", 8, 30)]
LAYOUT += [(2, "heavyTank", 68, 29), (2, "heavyTank", 68, 30), (2, "heavyTank", 68, 31),
           (2, "heavyTank", 66, 30), (2, "heavyTank", 70, 30)]
LAYOUT += [(2, "turret", 73, 27), (2, "turret", 73, 31)]
LAYOUT += [(2, "antiAirTurret", 64, 30)]

RED_N = sum(1 for t, *_ in LAYOUT if t == 1)
BLUE_N = sum(1 for t, *_ in LAYOUT if t == 2)

# 观众召唤兵的无 AI 宿主席位（机制与现网一致，坐标随新图调整）
TEAM_INFO = [
    (40, 40, 1, {"team": "1", "credits": "99999", "allyGroup": "1"}),
    (2600, 560, 2, {"team": "2", "credits": "99999", "allyGroup": "2"}),
    (2600, 600, 3, {"team": "3", "allyGroup": "1", "disabledAI": "1"}),
    (40, 600, 4, {"team": "4", "allyGroup": "2", "disabledAI": "1"}),
]
CAMERA = (1480, 600)                     # 隘口中心 px
INTRO = "温泉关 480 BC · 波斯大军压境 · 希腊守军扼守隘口"

_LAYER_RE = r'(<layer\b[^>]*\bname="%s"[^>]*>\s*<data[^>]*?>)(.*?)(</data>)'


def read(p):
    with open(p, encoding="utf-8", errors="replace") as f:
        return f.read()


def tsx_tile_table():
    """units.tsx -> {(team, unit): tile_id}，优先取不带 type 的普通款。"""
    t = read(UNITS_TSX)
    plain, variant = {}, {}
    for m in re.finditer(r'<tile id="(\d+)">\s*<properties>(.*?)</properties>', t, re.S):
        tid = int(m.group(1))
        pr = dict(re.findall(r'<property name="([^"]+)" value="([^"]*)"', m.group(2)))
        if "unit" not in pr or "team" not in pr:
            continue
        key = (int(pr["team"]), pr["unit"])
        if "type" in pr:
            variant.setdefault(key, tid)
        elif key not in plain or tid < plain[key]:
            plain[key] = tid
    for k, v in variant.items():
        plain.setdefault(k, v)
    return plain


def template_parts():
    """从模板抽出：完整 <tileset> 块、水 gid、陆地 gid、units.tsx 的 firstgid。"""
    t = read(TEMPLATE)
    # ⚠️ 必须"先用完整闭合形式匹配，再退化到自闭合"。
    # 之前写成 `<tileset\b.*?(?:</tileset>|/>)`：非贪婪的 `.*?` 会撞上内联 tileset 里
    # `<image .../>` 的 `/>` 而**提前截断**，丢掉 `</tileset>` ⇒ 引擎解析崩溃
    # （`元素类型 "tileset" 必须由匹配的结束标记 "</tileset>" 终止`）。2026-09-20 实机踩到。
    ts_block = "\n".join(m.group(0) for m in
                         re.finditer(r'<tileset\b.*?</tileset>|<tileset\b[^>]*/>', t, re.S))
    if not ts_block:
        raise SystemExit("ABORT: 模板里找不到 <tileset> 声明")

    # 水 gid：内联 tileset 且 name 属水名 => 该 tileset 的 firstgid 起点
    water = []
    for m in re.finditer(r'<tileset\b([^>]*?)>', t):
        attrs = m.group(1)
        nm = re.search(r'\bname="([^"]+)"', attrs)
        fg = re.search(r'firstgid="(\d+)"', attrs)
        if nm and fg and nm.group(1) in WATER_TILESET_NAMES:
            water.append(int(fg.group(1)))
    if not water:
        raise SystemExit("ABORT: 模板里找不到水 tileset（%s）" % (WATER_TILESET_NAMES,))
    water_gid = min(water)

    # 陆地 gid：模板 Ground 层里出现最多、且不属于水范围的 gid
    m = re.search(_LAYER_RE % "Ground", t, re.S)
    raw = gzip.decompress(base64.b64decode(re.sub(r"\s+", "", m.group(2))))
    gids = struct.unpack("<%dI" % (len(raw) // 4), raw)
    wset = set()
    for m2 in re.finditer(r'<tileset\b([^>]*?)>', t):
        attrs = m2.group(1)
        nm = re.search(r'\bname="([^"]+)"', attrs)
        fg = re.search(r'firstgid="(\d+)"', attrs)
        if nm and fg and nm.group(1) in WATER_TILESET_NAMES:
            wset.add(int(fg.group(1)))
    counts = {}
    for g in gids:
        if g and g not in wset:
            counts[g] = counts.get(g, 0) + 1
    land_gid = max(counts, key=counts.get)

    um = re.search(r'<tileset\b[^>]*?firstgid="(\d+)"[^>]*?source="units\.tsx"', t)
    if not um:
        raise SystemExit("ABORT: 模板里没有 units.tsx 的 tileset 声明")
    return ts_block, water_gid, land_gid, int(um.group(1))


# ------------------------------------------------------------------ 组装

def build_layers():
    ground = [0] * (W * H)
    for y in range(H):
        for x in range(W):
            ground[y * W + x] = 1 if is_land(x, y) else 2
    items = [0] * (W * H)
    units = [0] * (W * H)
    return ground, items, units


def b64(gids):
    return base64.b64encode(gzip.compress(struct.pack("<%dI" % len(gids), *gids), mtime=0)).decode()


def build_tmx():
    ts_block, water_gid, land_gid, fg_units = template_parts()
    table = tsx_tile_table()

    # 用"陆地 gid / 水 gid"重映射：层的 gid 直接写模板里的真实 gid，
    # 这样无需自造 tileset，模板的水属性原样生效。
    ground, items, units = build_layers()
    ground = [land_gid if g == 1 else water_gid for g in ground]

    missing = []
    for team, unit, x, y in LAYOUT:
        tid = table.get((team, unit))
        if tid is None:
            missing.append((team, unit)); continue
        if not is_land(x, y):
            raise SystemExit("ABORT: 单位 %s/%s 落在水里 (%d,%d)" % (team, unit, x, y))
        if units[y * W + x]:
            raise SystemExit("ABORT: 单位重叠于 (%d,%d)" % (x, y))
        units[y * W + x] = fg_units + tid
    if missing:
        raise SystemExit("ABORT: units.tsx 缺图块 %s" % missing)

    info = ["  <object id=\"1\" name=\"map_info\" x=\"40\" y=\"40\" width=\"200\" height=\"120\">",
            "   <properties>",
            "    <property name=\"fog\" value=\"map\"/>",
            "    <property name=\"introText\" value=\"%s\"/>" % INTRO,
            "    <property name=\"type\" value=\"skirmish\"/>",
            "    <property name=\"winCondition\" value=\"commandCenter\"/>",
            "   </properties>",
            "  </object>",
            '  <object id="2" name="camera_start" x="%d" y="%d" width="0" height="0">' % CAMERA,
            "   <properties><property name=\"zoomTo\" value=\"1\"/></properties>",
            "  </object>"]
    for i, (x, y, team, props) in enumerate(TEAM_INFO, start=3):
        ps = "".join("<property name=\"%s\" value=\"%s\"/>" % kv for kv in props.items())
        info.append('  <object id="%d" name="team_%d_info" type="team_info" x="%d" y="%d" '
                    'width="160" height="140"><properties>%s</properties></object>' % (i, team, x, y, ps))
    triggers = "<objectgroup name=\"Triggers\">\n%s\n </objectgroup>" % "\n".join(info)

    def layer(name, gids):
        return (' <layer name="%s" width="%d" height="%d">\n'
                '  <data encoding="base64" compression="gzip">%s</data>\n </layer>' % (name, W, H, b64(gids)))

    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<map version="1.0" orientation="orthogonal" renderorder="right-down" '
            'width="%d" height="%d" tilewidth="20" tileheight="20" nextobjectid="20">\n'
            '%s\n%s\n%s\n%s\n%s\n</map>\n'
            % (W, H, ts_block, layer("Ground", ground), layer("Items", items),
               layer("Units", units), triggers))


# ------------------------------------------------------------------ 校验

def bfs_single_path():
    """陆地连通性：从西端 (0,30) 出发能否到达东端，且隘口处通路宽度 == CHOKE_H。"""
    seen = set()
    if not is_land(0, 30):
        return False, 0, "西端起点不是陆地"
    stack = [(0, 30)]
    seen.add((0, 30))
    while stack:
        x, y = stack.pop()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < W and 0 <= ny < H and is_land(nx, ny) and (nx, ny) not in seen:
                seen.add((nx, ny)); stack.append((nx, ny))
    reached_east = any(x >= W - 1 for x, _ in seen)
    widest = max(sum(1 for y in range(H) if is_land(x, y)) for x in range(CHOKE_X0, CHOKE_X1))
    return reached_east, widest, "连通" if reached_east else "东端不可达"


def cmd_terrain():
    ok = True
    print("地形剖面（每个采样点：x / 陆地高 / 行区间）:")
    for x in (0, 20, 40, 50, 60, 69, 70, 74, 77, 78, 90, 110, 139):
        y0, y1 = land_rows(x)
        print("   x=%-4d 高=%-3d y∈[%d,%d)" % (x, land_h(x), y0, y1))
    reach, widest, msg = bfs_single_path()
    print("连通性: %s（东端可达=%s）" % (msg, reach))
    print("隘口最宽处: %d 格（设计 %d 格）" % (widest, CHOKE_H))
    ok = reach and widest == CHOKE_H
    print("地形断言: %s" % ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


def cmd_check():
    ok = True
    if not os.path.exists(TARGET):
        print("FAIL 目标图不存在: %s（先运行 apply）" % TARGET)
        return 1
    want = build_tmx()
    got = read(TARGET)
    print("== 文件 ==")
    print("  生成一致: %s (%d bytes vs %d bytes)" % (want == got, len(want), len(got)))
    ok &= (want == got)

    # ⚠️ "重新生成结果一致"是**自洽**不是**正确**：同一个 bug 函数生成两次当然一致。
    # 2026-09-20 就是因为只比对自洽，漏掉了 `<tileset>` 闭合标签丢失，直到引擎崩溃才发现。
    # 这里补一道**结构良构性**门禁（独立于生成逻辑）。
    print("== XML 良构性（独立于生成逻辑的结构门禁） ==")
    try:
        import xml.etree.ElementTree as ET
        root = ET.fromstring(got)
        ts = list(root.iter("tileset"))
        print("  OK   XML 可解析；tileset 条目 %d 个" % len(ts))
        if not ts:
            print("  FAIL 没有解析出任何 tileset"); ok = False
    except Exception as e:
        print("  FAIL XML 不可解析: %s" % e); ok = False

    print("== 图层 ==")
    t = read(TARGET)
    for name in ("Ground", "Items", "Units"):
        m = re.search(_LAYER_RE % name, t, re.S)
        if not m:
            print("  FAIL 缺图层 %s" % name); ok = False; continue
        raw = gzip.decompress(base64.b64decode(re.sub(r"\s+", "", m.group(2))))
        g = struct.unpack("<%dI" % (len(raw) // 4), raw)
        print("  %-6s %d 格，非空 %d" % (name, len(g), sum(1 for v in g if v)))
    print("== Triggers ==")
    for key in ("winCondition", "camera_start", "team_3_info", "team_4_info", "disabledAI"):
        hit = key in t
        print("  %-16s %s" % (key, "OK" if hit else "FAIL")); ok &= hit
    print("== 地形 ==")
    ok &= (cmd_terrain() == 0)
    print("RESULT: %s" % ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


def cmd_apply():
    text = build_tmx()
    if os.path.exists(TARGET):
        old = read(TARGET)
        if old == text:
            print("目标图已是最新（确定性重建产出相同字节）")
            return cmd_check()
        bak = TARGET + ".bak-prev"
        if not os.path.exists(bak):
            open(bak, "w", encoding="utf-8", newline="").write(old)
            print("已备份旧文件 -> %s" % os.path.basename(bak))
    with open(TARGET, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    print("已生成 %s (%d bytes)" % (TARGET, len(text)))

    # 打印中继常量要用的坐标
    table = tsx_tile_table()
    for team, name in ((1, "红/波斯"), (2, "蓝/希腊")):
        for t_, u_, x_, y_ in LAYOUT:
            if t_ == team and u_ == "commandCenter":
                print("  %s 指挥中心 tile(%d,%d) -> px(%d,%d)" % (name, x_, y_, x_ * 20 + 10, y_ * 20 + 10))
    print("  红方 %d 个 / 蓝方 %d 个（比例 %.1f:1）" % (RED_N, BLUE_N, RED_N / BLUE_N))
    print("  隘口 x∈[%d,%d) 宽 %d 格；相机 px%s" % (CHOKE_X0, CHOKE_X1, CHOKE_H, CAMERA))
    print("== verify ==")
    return cmd_check()


def cmd_dump():
    cmd_terrain()
    print()
    print("各单位（tile 坐标 -> px）:")
    for team, unit, x, y in sorted(LAYOUT, key=lambda r: (r[0], r[2])):
        print("   team%d %-16s tile(%3d,%3d) px(%4d,%4d)" % (team, unit, x, y, x * 20 + 10, y * 20 + 10))
    return 0


def cmd_revert(argv):
    if "--yes" not in argv:
        print("将删除 %s （%s）\n确认请加 --yes" % (
            TARGET, ("%d bytes" % os.path.getsize(TARGET)) if os.path.exists(TARGET) else "不存在"))
        return 2
    if os.path.exists(TARGET):
        os.remove(TARGET)
        print("已删除 %s" % TARGET)
    else:
        print("目标不存在，无需删除")
    return 0


def main(argv):
    cmd = argv[0] if argv else ""
    if cmd == "check":
        return cmd_check()
    if cmd == "apply":
        return cmd_apply()
    if cmd == "terrain":
        return cmd_terrain()
    if cmd == "dump":
        return cmd_dump()
    if cmd == "revert":
        return cmd_revert(argv)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
