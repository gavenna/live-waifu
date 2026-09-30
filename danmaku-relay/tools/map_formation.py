#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""map_formation.py — 给 live_dire.tmx 的红/蓝两军加"开局布防"（改 Units 层瓦片）。

## 布防依据（不是拍脑袋，是从游戏自带的官方地图里量出来的）

铁锈战争自带 `assets/maps/challenge/*` 与 `assets/maps/normal/*`（战役/挑战图），
里面有**官方设计的预设布防**。把它们按"距本方指挥中心多少格"量化后，模式非常一致：

| 层 | 内容 | 距 CC | 证据（官方图） |
|---|---|---|---|
| 核心 | `commandCenter` | 0 | 所有图 |
| 生产区 | `landFactory` / `airFactory` **紧贴基地** | 2–8 格 | Beachhead Landing: landFactory×2 @4格, airFactory@6格 |
| 防御带 | `turret` + `antiAirTurret` **交替混编**，沿必经通道铺开 | 10–90 格 | Island Base: turret×25 + AA×24；Beachhead: turret×16 + AA×12 |
| 机动预备队 | `tank` / `heavyTank`，**在防御带之后或更外圈** | 20–110 格 | Beachhead: tank×12 @45–90格 |
| 后勤 | `repairbay` / `extractor` | 中后场 | Island Base: repairbay×4 在防线后 |

三条可复用的原则：
1. **静态防御（炮塔）是数量主力**，机动部队是补充 —— 官方图里 turret+AA 常是坦克的 3–5 倍。
2. **防御沿"进犯通道"分片布置**，不是以基地为圆心的均匀圆环（看坐标，成组贴在通行方向上）。
3. **生产建筑贴着指挥中心**，不放在外圈。

本图（live_dire，110×110 对角水陆图）红蓝基地各在左上/右下，敌人方向是斜对角，
所以防御带沿"垂直于对角线"的方向铺开，并向前伸出一个前哨阵位（纵深防御）。

## 每方编成（18 个）

    生产区    landFactory ×1, airFactory ×1
    内层防御   turret ×5, antiAirTurret ×2      ← 贴基地的防御带
    机动预备队 tank ×2, heavyTank ×2, heavyHoverTank ×2
    前哨阵位   turret ×2, antiAirTurret ×1      ← 前出 16–22 格，纵深防御

## ⚠️ 两条本项目特有的偏差（有意为之，不是照抄官方）

- **防空比例刻意压低**：官方 AA:对地 ≈ 1:1，但本项目观众会花钱召唤飞机；
  AA 铺满会让飞机瞬间蒸发、观众觉得被骗。这里 AA 只占炮塔的 ~1/3。
- **规模刻意控制**：官方防守图 56–70 单位，这里每方只 18 个 —— 本局是 5 分钟一轮的直播，
  兵力太厚会让 AI 平推、节奏变快。要调就改下面的 `LAYOUT`。

## 用法

    python map_formation.py check     # 校验（未布防 / 有遗留 / 地形不合格 => FAIL，exit 1）
    python map_formation.py apply     # 写入（幂等，会自动清掉本工具旧版留下的阵位）
    python map_formation.py revert    # 撤销，回到只有 4 个基地瓦片
    python map_formation.py terrain   # 只重验阵位地形

地图路径可用 `--map <path>` 或环境变量 `RW_MAP` 覆盖。

## 安全约定

- **只改 `Units` 层**，其余层字节保持原样。
- 目标格/遗留格之外若出现**本工具不认识**的单位瓦片 ⇒ **ABORT**，绝不覆盖别人的东西。
- `gzip.compress(..., mtime=0)` ⇒ 同输入同字节，可做漂移校验。
- (team, unit) ↔ tile_id 从 map 同级或 `assets/maps/` 的 `units.tsx` 解析，不硬编码。
"""
import base64
import gzip
import os
import re
import struct
import sys

sys.stdout.reconfigure(encoding="utf-8")

DEFAULT_MAP = os.environ.get("RW_MAP") or os.path.join(
    os.environ.get("RW_GAME_DIR",
                   r"D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15"),
    "mods", "maps", "live_dire.tmx")

# ---------------------------------------------------------------- 布防定义

# 两军指挥中心所在 tile（从 live_dire.tmx 的 Units 层实测）
BASE_TILE = {1: (23, 18), 2: (89, 85)}

# (dx, dy, unit, role)；dx/dy 相对本方指挥中心，红方坐标系（敌方在 +x/+y）。
# 蓝方按 (-dx, -dy) 镜像，保证两边严格对称。
LAYOUT = [
    (-3,  5, "landFactory",     "生产区"),
    (5,  5, "airFactory",      "生产区"),

    (-5, 10, "turret",         "内层防御"),
    (-2,  9, "turret",         "内层防御"),
    (1,  8, "antiAirTurret",   "内层防御"),
    (4,  9, "turret",          "内层防御"),
    (7,  8, "antiAirTurret",   "内层防御"),
    (10,  9, "turret",         "内层防御"),
    (13, 10, "turret",         "内层防御"),

    (-4, 13, "heavyHoverTank", "机动预备队"),
    (0, 12, "heavyTank",       "机动预备队"),
    (3, 11, "tank",            "机动预备队"),
    (5, 11, "tank",            "机动预备队"),
    (8, 12, "heavyTank",       "机动预备队"),
    (12, 13, "heavyHoverTank", "机动预备队"),

    (16, 18, "turret",         "前哨阵位"),
    (19, 17, "antiAirTurret",  "前哨阵位"),
    (22, 18, "turret",         "前哨阵位"),
]

# 本工具历史版本写过的阵位（apply 时会一并清掉，避免新旧叠加）。
# v1 = 2026-09-20 首版"两排坦克"布局（过于几何化，已被 LAYOUT 取代）。
LEGACY_V1 = [
    (-1,  4, "turret"), (7, 4, "turret"),
    (1, 6, "tank"), (3, 6, "tank"), (5, 6, "tank"), (7, 6, "tank"), (9, 6, "tank"),
    (1, 9, "heavyTank"), (5, 9, "heavyTank"), (9, 9, "heavyTank"),
    (0, 12, "heavyHoverTank"), (10, 12, "heavyHoverTank"),
]

# 加布防之前，Units 层只有这 4 个瓦片
BASE_CENSUS_TILES = {(23, 18): (1, "commandCenter"),
                     (27, 18): (1, "builder"),
                     (85, 85): (2, "builder"),
                     (89, 85): (2, "commandCenter")}

WATER_TILESETS = ("Shallow Water", "Water", "Deep Water")   # 同 terrain_at.py
TILE_PX = 20.0

_UNITS_LAYER_RE = (r'(<layer\b[^>]*\bname="Units"[^>]*>\s*<data[^>]*?>)(.*?)(</data>)')
_LAYER_ANY_RE = r'(<layer\b[^>]*\bname="%s"[^>]*>\s*<data[^>]*?>)(.*?)(</data>)'
_TS_RE = re.compile(r'<tileset\b[^>]*?firstgid="(\d+)"[^>]*?source="([^"]*units\.tsx)"')
_TILE_RE = re.compile(r'<tile id="(\d+)">\s*<properties>(.*?)</properties>', re.S)
_PROP_RE = re.compile(r'<property name="([^"]+)" value="([^"]*)"')


def read(path):
    with open(path, encoding="utf-8", newline="") as fh:
        return fh.read()


def write(path, text):
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)


def units_tsx_candidates(map_path):
    """官方图常把 units.tsx 放在 assets/maps/ 而非地图同级目录。"""
    GAME = os.environ.get("RW_GAME_DIR",
                          r"D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15")
    return [os.path.join(os.path.dirname(os.path.abspath(map_path)), "units.tsx"),
            os.path.join(GAME, "assets", "maps", "units.tsx"),
            os.path.join(GAME, "assets", "tilesets", "units.tsx")]


def _parse_tsx(path):
    t = open(path, encoding="utf-8", errors="replace").read()
    plain, variant, allk = {}, {}, {}
    for m in _TILE_RE.finditer(t):
        tid = int(m.group(1))
        props = dict(_PROP_RE.findall(m.group(2)))
        if "unit" not in props or "team" not in props:
            continue
        key = (int(props["team"]), props["unit"])
        allk.setdefault(tid, key)
        if "type" in props:
            variant.setdefault(key, tid)
        elif key not in plain or tid < plain[key]:
            plain[key] = tid
    for key, tid in variant.items():
        plain.setdefault(key, tid)
    return plain, allk


def load_tile_table(map_path):
    """-> ({(team,unit): tile_id} 写入用优选表, {tile_id: (team,unit)} 含变体的识别表)"""
    for c in units_tsx_candidates(map_path):
        if os.path.exists(c):
            plain, allk = _parse_tsx(c)
            if plain:
                return plain, allk
    raise SystemExit("ABORT: 找不到任何 units.tsx（阵型的 (team,unit)->tile_id 只能从它解析）")


def firstgids(text):
    out = [int(m.group(1)) for m in _TS_RE.finditer(text)]
    if not out:
        raise SystemExit('ABORT: 地图里没有 source="??units.tsx" 的 tileset')
    return sorted(out)


def resolver(text, tid2key):
    """gid -> (team, unit)，覆盖 map 里每个 units.tsx 实例与**全部变体**。"""
    m = {}
    for fg in firstgids(text):
        for tid, key in tid2key.items():
            m[fg + tid] = key
    return m


def get_layer(text, name="Units"):
    m = re.search(_LAYER_ANY_RE % re.escape(name), text, re.S)
    if not m:
        return None, None
    raw = gzip.decompress(base64.b64decode(re.sub(r"\s+", "", m.group(2))))
    gids = list(struct.unpack("<%dI" % (len(raw) // 4), raw))
    wm = re.search(r'<layer\b[^>]*\bname="%s"[^>]*\bwidth="(\d+)"' % re.escape(name), text)
    return gids, (int(wm.group(1)) if wm else 110)


def pack(gids):
    return base64.b64encode(gzip.compress(struct.pack("<%dI" % len(gids), *gids), mtime=0)).decode()


def cells_of(layout, with_role=False):
    out = {}
    for team, (bx, by) in BASE_TILE.items():
        sign = 1 if team == 1 else -1
        for item in layout:
            dx, dy, unit = item[0], item[1], item[2]
            role = item[3] if with_role and len(item) > 3 else None
            out[(bx + sign * dx, by + sign * dy)] = (team, unit, role)
    return out


def formation_cells(with_role=False):
    return cells_of(LAYOUT, with_role)


def legacy_cells():
    return cells_of(LEGACY_V1)


# ---------------------------------------------------------------- 地形判定

def water_gids(text):
    names, out = {}, set()
    for m in re.finditer(r'<tileset\b([^>]*?)>', text):
        attrs = m.group(1)
        fg = re.search(r'firstgid="(\d+)"', attrs)
        nm = re.search(r'\bname="([^"]+)"', attrs)
        if fg and nm:
            names[int(fg.group(1))] = nm.group(1)
    keys = sorted(names)
    for fg, nm in names.items():
        if nm in WATER_TILESETS:
            nxt = min([k for k in keys if k > fg], default=fg + 64)
            out.update(range(fg, nxt))
    return out


def terrain_check(text, cells):
    gids, w = get_layer(text, "Ground")
    if gids is None:
        raise SystemExit("ABORT: 没有 Ground 层，无法验地形")
    h = len(gids) // w
    water = water_gids(text)
    bad = []
    for (x, y) in sorted(cells):
        hits = sum(1 for dy in (-2, -1, 0, 1, 2) for dx in (-2, -1, 0, 1, 2)
                   if 0 <= x + dx < w and 0 <= y + dy < h and gids[(y + dy) * w + (x + dx)] in water)
        if hits:
            bad.append(((x, y), hits))
    return bad


# ---------------------------------------------------------------- 命令

def _survey(text, map_path):
    """返回 (gids, w, rev, want, legacy, 未知瓦片列表)。"""
    tt, allk = load_tile_table(map_path)
    rev = resolver(text, allk)
    gids, w = get_layer(text, "Units")
    if gids is None:
        raise SystemExit("ABORT: 没有 base64+gzip 的 Units 层")
    want, legacy = formation_cells(), legacy_cells()
    known = set(want) | set(legacy) | set(BASE_CENSUS_TILES)
    unknown = []
    for i, g in enumerate(gids):
        if g:
            xy = (i % w, i // w)
            if xy not in known:
                unknown.append((xy[0], xy[1], g, rev.get(g)))
    return tt, rev, gids, w, want, legacy, unknown


def cmd_check(map_path):
    text = read(map_path)
    tt, rev, gids, w, want, legacy, unknown = _survey(text, map_path)
    ok = True

    print("== 基线（原有 4 个基地瓦片必须还在） ==")
    for (x, y), (team, unit) in sorted(BASE_CENSUS_TILES.items()):
        got = rev.get(gids[y * w + x])
        cond = got == (team, unit)
        ok &= cond
        print("  %s (%2d,%2d) 期望 team%d/%s 实际 %s" % ("OK  " if cond else "FAIL", x, y, team, unit, got))

    fg = firstgids(text)[0]
    print("== 布防校验（%d 格，gid 精确匹配 firstgid=%d + tile_id） ==" % (len(want), fg))
    miss = []
    for (x, y), (team, unit, _) in sorted(want.items()):
        gid, want_gid = gids[y * w + x], fg + tt[(team, unit)]
        if gid != want_gid:
            why = "  ← 同队同兵但 gid 不同（换错 tileset 实例或选成变体）" if rev.get(gid) == (team, unit) else ""
            miss.append("(%d,%d) 期望 gid=%d(team%d/%s) 实际 gid=%d%s" % (x, y, want_gid, team, unit, gid, why))
    if miss:
        ok = False
        print("  FAIL %d 格不符：" % len(miss))
        for s in miss[:20]:
            print("     " + s)
    else:
        print("  OK   %d 格全部就位" % len(want))

    print("== 遗留/异物校验 ==")
    left = [xy for xy in legacy if rev.get(gids[xy[1] * w + xy[0]]) == legacy[xy][:2]]
    if left:
        ok = False
        print("  FAIL 还有 %d 个旧版(v1)阵位未清：%s" % (len(left), left[:8]))
    else:
        print("  OK   无 v1 遗留")
    if unknown:
        ok = False
        print("  FAIL %d 个不认识的瓦片（可能被别的东西改过）：%s" % (len(unknown), unknown[:8]))
    else:
        print("  OK   无本工具之外的额外瓦片")

    print("== 地形校验 ==")
    bad = terrain_check(text, want)
    if bad:
        ok = False
        print("  FAIL 有水：%s" % bad)
    else:
        print("  OK   %d 格 5x5 邻域无水域" % len(want))

    print("RESULT: %s" % ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


def cmd_apply(map_path):
    text = read(map_path)
    tt, rev, gids, w, want, legacy, unknown = _survey(text, map_path)
    if unknown:
        raise SystemExit("ABORT: 有 %d 个本工具不认识的瓦片，拒绝覆盖：%s" % (len(unknown), unknown[:6]))
    fg = firstgids(text)[0]

    for (x, y) in list(want) + list(legacy):
        gids[y * w + x] = 0
    for (x, y), (team, unit, _) in sorted(want.items()):
        tid = tt.get((team, unit))
        if tid is None:
            raise SystemExit("ABORT: units.tsx 里没有 team%d/%s 的图块" % (team, unit))
        gids[y * w + x] = fg + tid

    payload = pack(gids)
    m = re.search(_UNITS_LAYER_RE, text, re.S)
    new_text = text[:m.start(2)] + payload + text[m.end(2):]
    if new_text == text:
        print("Units 层无变化（布防已是最新）")
    else:
        write(map_path, new_text)
        print("写入 %d 格布防 -> %s" % (len(want), map_path))
    print("== verify ==")
    return cmd_check(map_path)


def cmd_revert(map_path):
    text = read(map_path)
    tt, rev, gids, w, want, legacy, unknown = _survey(text, map_path)
    n = 0
    for xy in list(want) + list(legacy):
        if rev.get(gids[xy[1] * w + xy[0]]):
            gids[xy[1] * w + xy[0]] = 0
            n += 1
    m = re.search(_UNITS_LAYER_RE, text, re.S)
    write(map_path, text[:m.start(2)] + pack(gids) + text[m.end(2):])
    print("移除 %d 格" % n)
    return 0


def cmd_terrain(map_path):
    text = read(map_path)
    want = formation_cells(True)
    bad = terrain_check(text, want)
    roles = {}
    for (x, y), (team, unit, role) in want.items():
        roles.setdefault(role, []).append(unit)
    for role, units in roles.items():
        print("  %-8s %d 个: %s" % (role, len(units), ", ".join(sorted(units))))
    print("水域邻域命中：%s" % (bad if bad else "无（全部 LAND-CLEAN）"))
    return 1 if bad else 0


def main(argv):
    map_path = DEFAULT_MAP
    cmd = None
    it = iter(argv)
    for a in it:
        if a == "--map":
            map_path = next(it)
        else:
            cmd = a
    if not os.path.exists(map_path):
        raise SystemExit("ABORT: 地图不存在 %s" % map_path)
    return {"check": cmd_check, "apply": cmd_apply,
            "revert": cmd_revert, "terrain": cmd_terrain}.get(cmd, lambda p: (print(__doc__), 2)[1])(map_path)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
