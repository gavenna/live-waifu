# -*- coding: utf-8 -*-
"""给直播源图阵型补 Moo's Defence Agency 的炮塔（防御工事）。

用户交办：柱塔位置由实现方决定。选位规则（照 docs/地图设计与预设兵阵.md 的官方布防原则）：

  1. 落点必须 LAND-CLEAN —— 该点及其 5x5 格邻域没有任何纯水图块
     （规则与 _archive/ccresearch-game/terrain_at.py 一致）。
  2. 与任何已有单位/建筑的间距 >= MIN_SEP，避免叠在一起。
  3. 按「距本方指挥中心的层」分内/中/外三圈，各自配对应的炮塔；
     方位以「朝敌方指挥中心」为主轴，向两侧张开，避免堆成一条直线。

炮塔写进地图靠 `customUnit` 属性（见 tools/map_swap_mod_units.py 顶部的源码依据）。

用法:
    python tools/map_add_mod_towers.py plan    # 只读：列出将放的位置与兵种
    python tools/map_add_mod_towers.py apply   # 先备份，再写入，末尾自校验
    python tools/map_add_mod_towers.py revert  # 从备份还原
    python tools/map_add_mod_towers.py verify  # 只看当前状态
"""
import base64
import gzip
import math
import os
import re
import shutil
import sys
import time

GAME = ("D:/game/tiexiuzhanzheng_zhengshi_v1.15_anfensi.com/"
        "Rusted Warfare1.15")
DEFAULT_MAP = GAME + "/mods/maps/" + (
    "New New Dire Straight (2p) [by uber] - 21 九月 2026 - 22 九月 2026.tmx")

TILE = 20.0
MIN_SEP = 48.0            # 与已有单位的最小间距（px）
WATER_TILESETS = ("Shallow Water", "Water", "Deep Water")

# 每圈（距 CC 的 px 半径）配的炮塔 —— 由内到外由轻到重。
# AA 只放 1 个/方：本项目观众会花钱召唤飞机，AA 铺满会让飞机瞬间蒸发
# （这条克制沿用 docs/地图设计与预设兵阵.md §5 的既有决策）。
LAYERS = [
    (80, 140, ["mgTurret", "mgTurret", "mgTurret"]),
    (140, 200, ["rocket_turret", "rocket_turret", "mgTurretT2"]),
    (200, 300, ["turretArtyLight", "shredderAATurret", "turretArtyHeavy"]),
]
# 主轴左右张开的角度（度），从"朝敌方向"起算
ANGLES = [-64, -32, 0, 32, 64, -48, 16, 48, -16]


# ── 地图读取 ────────────────────────────────────────────────
def read(path):
    # newline=""：保持文件原有换行（源图是 CRLF；默认的通用换行会把整份文件转成 LF）
    return open(path, encoding="utf-8", newline="").read()


def ground_gids(t):
    m = re.search(r'<layer[^>]*name="Ground"[^>]*>.*?<data[^>]*>([^<]+)</data>',
                  t, re.S)
    raw = base64.b64decode(m.group(1).strip())
    if 'compression="gzip"' in t[m.start():m.start() + 600]:
        raw = gzip.decompress(raw)
    n = len(raw) // 4
    g = [raw[i * 4] | (raw[i * 4 + 1] << 8) | (raw[i * 4 + 2] << 16)
         | (raw[i * 4 + 3] << 24) for i in range(n)]
    w = int(re.search(r'<layer[^>]*name="Ground"[^>]*width="(\d+)"', t).group(1))
    return g, w


def water_set(t):
    ranges = []
    for m in re.finditer(r'<tileset[^>]*?firstgid="(\d+)"[^>]*?name="([^"]+)"', t):
        if m.group(2) in WATER_TILESETS:
            ranges.append(int(m.group(1)))
    keys = sorted(ranges)
    out = set()
    for i, fg in enumerate(keys):
        hi = keys[i + 1] - 1 if i + 1 < len(keys) else fg + 64
        out.update(range(fg, hi + 1))
    return out


def uosec(t):
    return re.search(r'(<objectgroup name="UnitObjects"[^>]*>)(.*?)(</objectgroup>)',
                     t, re.S)


def units_of(t):
    m = uosec(t)
    out = []
    for o in re.findall(r'<object\b[^>]*?>.*?</object>|<object\b[^>]*?/>',
                        m.group(2), re.S):
        u = re.search(r'<property\s+name="(?:unit|customUnit)"\s+value="([^"]*)"', o)
        tm = re.search(r'<property\s+name="team"\s+value="([^"]*)"', o)
        x = re.search(r'\bx="([-\d.]+)"', o)
        y = re.search(r'\by="([-\d.]+)"', o)
        if u and x and y:
            out.append((u.group(1), tm.group(1) if tm else "?",
                        float(x.group(1)), float(y.group(1))))
    return out


class Terrain:
    def __init__(self, t):
        self.g, self.w = ground_gids(t)
        self.h = len(self.g) // self.w
        self.water = water_set(t)

    def clean(self, px, py):
        tx, ty = int(px // TILE), int(py // TILE)
        if not (0 <= tx < self.w and 0 <= ty < self.h):
            return False
        if self.g[ty * self.w + tx] in self.water:
            return False
        for dy in (-2, -1, 0, 1, 2):
            for dx in (-2, -1, 0, 1, 2):
                x, y = tx + dx, ty + dy
                if 0 <= x < self.w and 0 <= y < self.h and self.g[y * self.w + x] in self.water:
                    return False
        return True


# ── 选位 ───────────────────────────────────────────────────
def plan(t):
    ter = Terrain(t)
    us = units_of(t)
    ccs = {}
    for n, tm, x, y in us:
        if n == "commandCenter":
            ccs[tm] = (x, y)
    if set(ccs) != {"0", "1"}:
        raise SystemExit("指挥中心不是恰好 team0 + team1：%s" % ccs)
    # team0 = 蓝(源图右侧)，team1 = 红(源图左侧)
    places = []
    for tm, tower_types in (("1", None), ("0", None)):
        cx, cy = ccs[tm]
        ox, oy = ccs["0"] if tm == "1" else ccs["1"]
        base = math.atan2(oy - cy, ox - cx)
        picked = []
        for lo, hi, kinds in LAYERS:
            n_here = 0
            for ang in ANGLES:
                if n_here >= len(kinds):
                    break
                a = base + math.radians(ang)
                placed = False
                for r in (lo, (lo + hi) / 2.0, hi):
                    px, py = cx + r * math.cos(a), cy + r * math.sin(a)
                    if not ter.clean(px, py):
                        continue
                    if any(math.hypot(px - ux, py - uy) < MIN_SEP
                           for _, _, ux, uy in us):
                        continue
                    if any(math.hypot(px - qx, py - qy) < MIN_SEP
                           for _, _, qx, qy in picked):
                        continue
                    picked.append((kinds[n_here], tm, round(px, 1), round(py, 1)))
                    n_here += 1
                    placed = True
                    break
                if not placed:
                    continue
        places.extend(picked)
    return ter, ccs, places


def fmt(places):
    lines = []
    for u, tm, x, y in places:
        lines.append("  t:%-2s (%7.1f,%7.1f)  %s" % (tm, x, y, u))
    return "\n".join(lines)


def cmd_plan(path):
    t = read(path)
    _, ccs, places = plan(t)
    print("指挥中心: 红(team1)=%s  蓝(team0)=%s" % (ccs["1"], ccs["0"]))
    print("将新增 %d 个炮塔:" % len(places))
    print(fmt(places))
    from collections import Counter
    print()
    print("兵种构成: %s" % dict(Counter(u for u, _, _, _ in places)))
    print("按队伍:   %s" % dict(Counter(tm for _, tm, _, _ in places)))
    return 0


def cmd_apply(path):
    t = read(path)
    m = uosec(t)
    _, _, places = plan(t)
    if not places:
        print("没有选出任何位置（未改文件）")
        return 1
    body = m.group(2)
    for u, tm, x, y in places:
        body += ('\n<object height="24" name="%s (t:%s)" width="24" x="%s" y="%s">'
                 '\n<properties>\n<property name="customUnit" value="%s"/>'
                 '\n<property name="team" value="%s"/>\n</properties>\n</object>'
                 % (u, tm, x, y, u, tm))
    backup = path + ".bak-towers-%s" % time.strftime("%Y%m%d-%H%M%S")
    shutil.copy2(path, backup)
    print("备份 -> %s" % backup.split("/")[-1])
    newt = t[:m.start(2)] + body + t[m.end(2):]
    open(path, "w", encoding="utf-8", newline="").write(newt)
    print("已写入 %d 个炮塔 -> %s" % (len(places), path.split("/")[-1]))
    return cmd_verify(path)


def cmd_verify(path):
    t = read(path)
    us = units_of(t)
    towers = [u for u, _, _, _ in us
              if u in {k for _, _, ks in LAYERS for k in ks}]
    from collections import Counter
    print()
    print("复核: 阵型内 Moo 炮塔 %d 个 %s" % (len(towers), dict(Counter(towers))))
    print("复核: UnitObjects 总数 %d" % len(us))
    need = sum(len(ks) for _, _, ks in LAYERS) * 2
    if len(towers) < need:
        print("RESULT: FAIL（少于预期 %d 个）" % need)
        return 1
    print("RESULT: PASS")
    return 0


def cmd_revert(path):
    d, b = os.path.dirname(path), os.path.basename(path)
    baks = sorted(x for x in os.listdir(d) if x.startswith(b + ".bak-towers-"))
    if not baks:
        print("没有备份可还原")
        return 1
    shutil.copy2(os.path.join(d, baks[-1]), path)
    print("已从 %s 还原" % baks[-1])
    return 0


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "plan"
    mp = os.environ.get("RW_TOWER_MAP", DEFAULT_MAP)
    if not os.path.exists(mp):
        raise SystemExit("地图不存在：%s" % mp)
    sys.exit({"plan": cmd_plan, "apply": cmd_apply,
              "verify": cmd_verify, "revert": cmd_revert}[mode](mp))
