# -*- coding: utf-8 -*-
"""把直播源图阵型里的基础兵种换成 Moo's Defence Agency 的对应兵种。

用法（在 danmaku-relay/ 下）:
    python tools/map_swap_mod_units.py check     # 只读：报当前状态与将要做的替换
    python tools/map_swap_mod_units.py dryrun    # 只读：打印每一条替换明细
    python tools/map_swap_mod_units.py apply     # 先备份，再写入
    python tools/map_swap_mod_units.py revert    # 从备份还原
    python tools/map_swap_mod_units.py verify    # 复核产物是否与 MAP 一致

地图路径可用 --map <path> 或环境变量 RW_SWAP_MAP 覆盖。

## 为什么用 customUnit 属性（而不是 unit）

反编译 `game\\b\\a.java:104-170` 确认引擎造兵读的是对象的 properties：

    string2 = getProperty("unit");        // 基础单位表
    string4 = getProperty("customUnit");  // 自定义(mod)单位注册表
    if (string4 != null) { ...custom.l.n(string4)... }   // ← 优先分支
    else                 { ...ar.a(string2)... }

即 `customUnit` 有值就走 mod 单位注册表，查不到会抛
`Could not find custom unit of:<name>`；`gid` 只用于解析 tileset，不影响兵种/队伍。

⚠️ 因此 **mod 一旦没启用，这张图会加载失败**——这是引入 mod 兵种换来
的硬依赖，不是可以绕过的。

## 只动产线

工厂 / 经济 / 指挥中心 / 核与反核 一律不动（`KEEP` 之外的 `unit` 值原样保留）。
"""
import argparse
import os
import re
import shutil
import sys
import time

GAME = ("D:/game/tiexiuzhanzheng_zhengshi_v1.15_anfensi.com/"
        "Rusted Warfare1.15")
DEFAULT_MAP = GAME + "/mods/maps/" + (
    "New New Dire Straight (2p) [by uber] - 21 九月 2026 - 22 九月 2026.tmx")

# ─────────────────────────────────────────────────────────────
# 基础单位 → Moo's Defence Agency 单位。
#
# 选型原则：同角色内按官方价位由轻到重对齐（不整体位移阵型强度），
# mod 缺该角色的整类（如潜艇）就保留原单位、不强套。
# 括号里是两边的官方 price / maxHp。
# ─────────────────────────────────────────────────────────────
MAP = {
    # ── 地面装甲 ──（按官方价位由轻到重逐位对齐）
    "heavyTank":             "lynxTank",             # 重坦 800/600   -> 山猫 275/120
    "c_artillery":           "cometTank",            # 火炮 900/140   -> 彗星 950/350
    "plasmaTank":            "saberTank",            # 等离子 1000/220-> Saber 1200/600
    "mechArtillery":         "zephyrTank",           # 机甲炮 1400/500-> Zephyr 1400/650
    "missileTank":           "buffaloTank",          # 导弹坦 2500/1100 -> Buffalo 2500/550
    "heavyArtillery":        "dusterTank",           # 重火炮 3100/600-> 粉尘 2900/700
    "c_mammothTank":         "achillesTank",         # 猛犸 3900/2600 -> 阿喀琉斯 3450/1250
    "mechLightning":         "paladinTank",          # 机甲闪电 5200/2000 -> 圣骑士 5000/350
    "mechLaser":             "wyvernTankDeployed",   # 机甲激光 7000/1200 -> 部署飞龙 7500/750
    "mechHeavyMissile":      "monarch",              # 机甲重导 8500/2500 -> 君主 9000/3500
    "c_experimentalTank":    "wyvernTank",           # 实验坦克 14000/6000 -> 飞龙 12500/750

    # ── 水面舰艇 ──（mod 无潜艇类：heavySub / attackSubmarine 保留）
    "battleShip":            "destroyerShip",        # 战列舰        -> 驱逐舰 3000/650
    "heavyAAShip":           "dinghyShip",           # 防空舰 3500/1800 -> 小艇 3500/650
    "heavyBattleship":       "cruiserShip",          # 重战列 6000/4000 -> 巡洋舰 6500/3600
    "heavyMissileShip":      "dreadnoughtShip",      # 重导弹舰 18000/3000 -> 无畏舰 15000/6000
    "experiementalCarrier":  "mooClassBattleship",   # 航母 30000/6000 -> Moo级战列舰 200000/25000

    # ── 空中 ──
    "bomber":                "grandSlamBomber",      # 轰炸机 4000/3000 -> Grand Slam 轰炸机 20000/4250
    "missileAirship":        "harbingerGunship",     # 导弹飞艇 3900/1000 -> 先驱炮艇 17500/3750
    "experimentalGunship":   "typeUGunship",         # 实验炮艇 140000/8000 -> Type-U 200000/20000
}

# 明确不动（留档用，实际逻辑是"不在 MAP 里就不动"）
KEEP = {
    # 工厂 / 经济 / 指挥
    "commandCenter", "builder", "landFactory", "airFactory", "seaFactory",
    "experimentalLandFactory", "mechFactoryT2", "laboratory",
    "extractorT3_reinforced", "repairbay",
    # 核与反核（mod 无同类）
    "antiNukeLauncherC", "nukeLauncherC",
    # 潜艇（mod 海军 7 个单位全是水面舰，没有潜艇类）
    "heavySub", "attackSubmarine",
    # 查不到单位定义与价档（assets/units 下无独立 ini），无从定档
    "experimentalHoverTank",
}

UNIT_PROP = re.compile(
    r'(<property\s+name=")unit("\s+value=")([^"]*)("\s*/?>)')
OBJ_RE = re.compile(r'<object\b[^>]*?>.*?</object>|<object\b[^>]*?/>', re.S)
UOSEC_RE = re.compile(
    r'(<objectgroup name="UnitObjects"[^>]*>)(.*?)(</objectgroup>)', re.S)


def split(path):
    # newline=""：保持文件原有换行（源图是 CRLF；默认的通用换行会把整份文件转成 LF）
    t = open(path, encoding="utf-8", newline="").read()
    m = UOSEC_RE.search(t)
    if not m:
        raise SystemExit("找不到 UnitObjects 段：%s" % path)
    return t, m


def scan(path):
    """返回 [(unit, team, x, y)]，只读。"""
    _, m = split(path)
    out = []
    for o in OBJ_RE.findall(m.group(2)):
        u = re.search(r'<property\s+name="(?:unit|customUnit)"\s+value="([^"]*)"', o)
        tm = re.search(r'<property\s+name="team"\s+value="([^"]*)"', o)
        x = re.search(r'\bx="([-\d.]+)"', o)
        y = re.search(r'\by="([-\d.]+)"', o)
        if u:
            out.append((u.group(1), tm.group(1) if tm else "?",
                        x.group(1) if x else "?", y.group(1) if y else "?"))
    return out


def cmd_check(path):
    rows = scan(path)
    from collections import Counter
    cur = Counter(u for u, _, _, _ in rows)
    print("地图: %s" % path.split("/")[-1])
    print("UnitObjects 对象数: %d" % len(rows))
    print("按队伍: %s" % dict(sorted(Counter(t for _, t, _, _ in rows).items())))
    todo = sorted({u for u, _, _, _ in rows if u in MAP})
    print()
    print("待替换的基础兵种（%d 种）:" % len(todo))
    for u in todo:
        n = sum(1 for r in rows if r[0] == u)
        print("  %-24s x%-3d -> %s" % (u, n, MAP[u]))
    done = sorted({u for u, _, _, _ in rows if u in set(MAP.values())})
    if done:
        print()
        print("已是 mod 单位（%d 种）: %s" % (len(done), ", ".join(done)))
    untouched = sorted({u for u, _, _, _ in rows
                        if u not in MAP and u not in set(MAP.values())})
    print()
    print("不动（%d 种）: %s" % (len(untouched), ", ".join(untouched)))
    print()
    if any(u in MAP for u, _, _, _ in rows):
        print("RESULT: PENDING（还有基础单位没换）")
    else:
        print("RESULT: APPLIED（阵型已全部换成 mod 单位）")
    return 0


def cmd_dryrun(path):
    _, m = split(path)
    n = 0
    for o in OBJ_RE.findall(m.group(2)):
        um = UNIT_PROP.search(o)
        tm = re.search(r'<property\s+name="team"\s+value="([^"]*)"', o)
        x = re.search(r'\bx="([-\d.]+)"', o)
        if um and um.group(3) in MAP:
            n += 1
            print("  t:%-2s (%s,%s)  %s -> %s" % (
                tm.group(1) if tm else "?", x.group(1) if x else "?",
                (re.search(r'\by="([-\d.]+)"', o) or [None, "?"])[1],
                um.group(3), MAP[um.group(3)]))
    print()
    print("合计 %d 条替换" % n)
    return 0


def cmd_apply(path):
    t, m = split(path)
    body = m.group(2)
    n = [0]

    def sub(mo):
        o = mo.group(0)
        um = UNIT_PROP.search(o)
        if not um or um.group(3) not in MAP:
            return o
        n[0] += 1
        return o[:um.start()] + um.group(1) + "customUnit" + \
            um.group(2) + MAP[um.group(3)] + um.group(4) + o[um.end():]

    newbody = OBJ_RE.sub(sub, body)
    if n[0] == 0:
        print("没有需要替换的单位 —— 已经是 mod 版？（未改文件）")
        return 1

    backup = path + ".bak-modswap-%s" % time.strftime("%Y%m%d-%H%M%S")
    shutil.copy2(path, backup)
    print("备份 -> %s" % backup.split("/")[-1])

    newt = t[:m.start(2)] + newbody + t[m.end(2):]
    open(path, "w", encoding="utf-8", newline="").write(newt)
    print("已写入 %d 条替换 -> %s" % (n[0], path.split("/")[-1]))
    return cmd_verify(path)


def cmd_verify(path):
    rows = scan(path)
    left = sorted({u for u, _, _, _ in rows if u in MAP})
    used = sorted({u for u, _, _, _ in rows if u in set(MAP.values())})
    print()
    print("复核: 仍是基础单位 = %s" % (left or "无"))
    print("复核: 已换成 mod 单位 = %s" % (used or "无"))
    if left:
        print("RESULT: FAIL")
        return 1
    print("RESULT: PASS")
    return 0


def cmd_revert(path):
    baks = sorted(b for b in os.listdir(os.path.dirname(path))
                  if b.startswith(os.path.basename(path) + ".bak-modswap-"))
    if not baks:
        print("没有找到备份，无法回退")
        return 1
    src = os.path.join(os.path.dirname(path), baks[-1])
    shutil.copy2(src, path)
    print("已从 %s 还原 -> %s" % (baks[-1], path.split("/")[-1]))
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["check", "dryrun", "apply", "revert", "verify"])
    ap.add_argument("--map", default=os.environ.get("RW_SWAP_MAP", DEFAULT_MAP))
    a = ap.parse_args()
    if not os.path.exists(a.map):
        raise SystemExit("地图不存在：%s" % a.map)
    return {"check": cmd_check, "dryrun": cmd_dryrun, "apply": cmd_apply,
            "revert": cmd_revert, "verify": cmd_verify}[a.mode](a.map)


if __name__ == "__main__":
    sys.exit(main())
