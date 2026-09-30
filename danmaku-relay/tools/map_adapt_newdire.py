#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""map_adapt_newdire.py — 把用户自制的 "New Dire Straight" 适配给直播链路。

源（用户在游戏编辑器里摆的阵，编辑器导出为 UnitObjects 对象）：
  <GAME>\\mods\\maps\\New Dire Straight (2p) [by uber] - 21 九月 2026.tmx
产物：
  <GAME>\\mods\\maps\\new_dire.tmx

为什么需要适配（全部有独立证据，不是猜测）：
  1. 用户图是**标准 2 人对战图**：team 1（红）基地在左上、team 0（蓝）在右下。
     但引擎里 **team 0 = 本地人类槽**——没有 AI、不会自己打（中继自己的注释：
     "team 0 一个兵都不生 ⇒ 人类兵站着不动"）。直播需要的是 team 1 = 红 /
     team 2 = 蓝，team 0 留作纯观战（不给任何单位）。
  2. 引擎读地图单位用的是 `<object>` 的**内联 unit/team 属性**，team 命中
     spectator 队会被直接跳过（`game\\b\\a.java:104-127` → 日志
     "Unit team is marked as spectator: ... (skipping unit)"）。
  3. 用户图的 Triggers 只有 `map_info(type=skirmish)`，缺 `winCondition` / `fog`，
     也没有观众兵的无 AI 宿主队（`team_3/4_info`）。省掉 winCondition 会让引擎
     回落到"以 team 0 判定" ⇒ 一进游戏弹 Defeat（2026-09-19 实测踩过）。

改动（只这两项；`Ground`/`Items`/`set` 三层逐字节不动，单位坐标/兵种/朝向全保留）：
  1. `UnitObjects` 里所有 team 0 的单位 → team 2（含 name 里的 "(t:0)"）。
  2. `Triggers` 重写为 live_dire 同款：`map_info(fog=map/winCondition=commandCenter)`
     + `team_1/2/3/4_info`（3/4 = 观众兵的无 AI 宿主队）。

地形已核实与 live_dire 逐字节相同（Ground md5 `96ef1d59…`）⇒ 中继的
`PATROL_TARGETS` 坐标**无需改动**。⚠️ 但 UnitObjects（单位层）随用户重摆阵而变、指挥中心会移位，
`SPAWN_AREAS`（= 指挥中心坐标）**必须按产物重取**（解析 new_dire.tmx 的 commandCenter；见 liveSpawner.js 注释）。

用法：
    python map_adapt_newdire.py selftest # 守卫自检（合成输入，不需要 SRC 存在；改守卫后必跑）
    python map_adapt_newdire.py check   # 只读校验产物（缺产物/未适配/非单位层漂移 => FAIL, exit 1）
    python map_adapt_newdire.py apply   # 从源确定性生成产物（幂等，每次都从头重算）
    python map_adapt_newdire.py dump    # 打印产物队伍构成 + 层摘要

环境变量：
    RW_GAME_DIR      覆盖游戏根
    RW_NEWDIRE_SRC   覆盖源路径
    RW_NEWDIRE_DST   覆盖产物路径

安全约定：
    只改 Triggers 与 UnitObjects 的 team 值；其余字节原样。源图 UnitObjects 的队伍集合
    不是 {team0, team1}（或某队为空）时 **ABORT**，绝不静默改写被别的工具动过的源图。
"""
import base64
import gzip
import hashlib
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

GAME = os.environ.get(
    "RW_GAME_DIR",
    r"D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15")
# 当前源 = 用户最新一次的摆阵存档（游戏编辑器每次另存为 "New ... - <日期>"）。
# ★ 换源 = 改这一行（或设 RW_NEWDIRE_SRC）。产物路径 new_dire.tmx 保持不变，
#   所以中继的 MAP_FILE_DEFAULT / 坐标常量都不用动。
SRC = os.environ.get(
    "RW_NEWDIRE_SRC",
    os.path.join(GAME, "mods", "maps",
                 "New New Dire Straight (2p) [by uber] - 21 九月 2026 - 22 九月 2026.tmx"))
DST = os.environ.get(
    "RW_NEWDIRE_DST",
    os.path.join(GAME, "mods", "maps", "new_dire.tmx"))

# live_dire 同款 Triggers（逐字抄自 mods\maps\live_dire.tmx，保留源图 Triggers 的 visible="0"）
TRIGGERS = '''<objectgroup name="Triggers" visible="0">
  <object id="1" name="map_info" x="64" y="45" width="203" height="122">
   <properties>
    <property name="fog" value="map"/>
    <property name="introText" value="弹幕送兵 - 发红/蓝+兵种出兵"/>
    <property name="type" value="skirmish"/>
    <property name="winCondition" value="commandCenter"/>
   </properties>
  </object>
  <!-- ★ team_0_info：本地人类槽（观战），开局即声明 allyGroup=1（与红方同盟）。
       为什么必需：引擎判负逻辑（gameFramework\\n\\f.java:918-967）在 winCondition=commandCenter 下
       查"本地队的同盟组里还有没有指挥中心"（bl5）——team0 自己没基地，若同盟组未生效就先查到
       "无盟友 CC" ⇒ 一进游戏弹 Defeat（实测：team0 无此声明时 Game Time 00:00 秒判负）。
       中继运行时的 setTeamAllyGroup(0,1) 要到起局后约 10s 才发，晚于引擎首次判定 ⇒ 必须写进地图。
       给了 allyGroup 但**不给任何单位/基地** ⇒ 视角仍是观战全图（见地图指南 §6.1）。 -->
  <object id="10" name="team_0_info" type="team_info" x="64" y="45" width="160" height="140">
   <properties><property name="team" value="0"/><property name="allyGroup" value="1"/><property name="disabledAI" value="1"/></properties>
  </object>
  <object id="11" name="team_1_info" type="team_info" x="460" y="360" width="160" height="140">
   <properties><property name="team" value="1"/><property name="credits" value="99999"/><property name="allyGroup" value="1"/></properties>
  </object>
  <object id="12" name="team_2_info" type="team_info" x="1700" y="1700" width="160" height="140">
   <properties><property name="team" value="2"/><property name="credits" value="99999"/><property name="allyGroup" value="2"/></properties>
  </object>
  <object id="13" name="team_3_info" type="team_info" x="460" y="360" width="160" height="140">
   <properties><property name="team" value="3"/><property name="allyGroup" value="1"/><property name="disabledAI" value="1"/></properties>
  </object>
  <object id="14" name="team_4_info" type="team_info" x="1700" y="1700" width="160" height="140">
   <properties><property name="team" value="4"/><property name="allyGroup" value="2"/><property name="disabledAI" value="1"/></properties>
  </object>
 </objectgroup>'''

# 结构不变量（**不是**死数字）：源图 UnitObjects 只允许 team 0（蓝）/ team 1（红）两队，且都非空。
# 条数随用户每次摆阵而变，故不写死 —— 写死会让用户每存一次新图就得改工具（2026-09-22 踩到：
# 新图从 88/91 变成 79/88）。真正要拦的是"结构被别的工具动过"（冒出 team 2+ 或段缺失）。
SRC_TEAMS = {0, 1}
DST_TEAMS = {1, 2}   # team 0 整体改判给 team 2

# ★ 2026-09-27：源图 Triggers 可能是**空自闭合**标签 `<objectgroup name="Triggers"/>`
#   （用户新图 LIVE_FOR_MAP_001_2P 就是这样）。旧正则 `[^>]*>.*?</objectgroup>` 会把
#   自闭合标签的 `/>` 当成闭合 `>`，随后 `.*?` 一路吞到 **UnitObjects 的 `</objectgroup>`**，
#   导致 transform 抹掉整段单位、`_UNITOBJ_RE.search` 返回 None 后 `m2.group(2)` 崩溃
#   （已复现 AttributeError）。故显式区分两形态：自闭合 `/>` 或含内容 `>...</objectgroup>`。
_TRIGGERS_RE = re.compile(r'<objectgroup\b[^>]*\bname="Triggers"[^>]*?(?:/>|>.*?</objectgroup>)', re.S)
_UNITOBJ_RE = re.compile(r'(<objectgroup\b[^>]*\bname="UnitObjects"[^>]*>)(.*?)(</objectgroup>)', re.S)
_OBJECT_RE = re.compile(r"<object\b[^>]*>.*?</object>", re.S)
_TEAM_PROP_RE = re.compile(r'<property name="team" value="([^"]*)"')
_UNIT_TILE_RE = re.compile(r'<property name="unit" value="([^"]*)"')
_LAYER_RE = r'(<layer\b[^>]*\bname="%s"[^>]*>\s*<data[^>]*?>)(.*?)(</data>)'


def read(p):
    with open(p, encoding="utf-8", newline="") as fh:
        return fh.read()


def write(p, t):
    with open(p, "w", encoding="utf-8", newline="") as fh:
        fh.write(t)


def team_census(unit_body):
    """UnitObjects 段里每个 team 值的单位数（字符串键）。"""
    out = {}
    for obj in _OBJECT_RE.findall(unit_body):
        m = _TEAM_PROP_RE.search(obj)
        if m:
            out[m.group(1)] = out.get(m.group(1), 0) + 1
    return out


def layer_md5(text, name):
    m = re.search(_LAYER_RE % re.escape(name), text, re.S)
    if not m:
        return None
    raw = gzip.decompress(base64.b64decode(re.sub(r"\s+", "", m.group(2))))
    return hashlib.md5(raw).hexdigest()


def non_unit_layers_md5(text):
    return {n: layer_md5(text, n) for n in ("Ground", "Items", "set")}


def transform(src_text):
    """源文本 -> 适配后文本。只动 Triggers 与 UnitObjects 的 team 值。"""
    if not _TRIGGERS_RE.search(src_text):
        raise SystemExit('ABORT: 源图里找不到 <objectgroup name="Triggers">')
    m = _UNITOBJ_RE.search(src_text)
    if not m:
        raise SystemExit('ABORT: 源图里找不到 <objectgroup name="UnitObjects">')
    src_census = {int(k): v for k, v in team_census(m.group(2)).items()}
    src_teams = set(src_census)
    if src_teams != SRC_TEAMS or any(v <= 0 for v in src_census.values()):
        raise SystemExit(
            "ABORT: 源图 UnitObjects 的队伍集合是 %s（期望恰好 %s 且都非空）——"
            "结构被别的工具动过？拒绝覆盖。" % (sorted(src_teams), sorted(SRC_TEAMS)))

    # 1) Triggers 整体替换（用 lambda 避免替换串里的反斜杠被解释）
    out = _TRIGGERS_RE.sub(lambda _: TRIGGERS, src_text, count=1)

    # 2) UnitObjects：team 0 -> 2（只在本段内；不影响 Items 层的 team="none" 装饰）
    m2 = _UNITOBJ_RE.search(out)
    body = m2.group(2)
    body2 = body.replace('<property name="team" value="0"/>',
                         '<property name="team" value="2"/>')
    body2 = re.sub(r"\(t:0\)", "(t:2)", body2)
    if body2 == body:
        raise SystemExit("ABORT: UnitObjects 里没有 team 0 可改——源图看起来已适配过？")
    out = out[:m2.start(2)] + body2 + out[m2.end(2):]
    return out


def cmd_apply(_):
    src = read(SRC)
    out = transform(src)
    write(DST, out)
    print("已生成 %s (%d B)" % (DST, os.path.getsize(DST)))
    print("== verify ==")
    return cmd_check(None)


def cmd_check(_):
    ok = True
    if not os.path.exists(DST):
        print("FAIL: 产物不存在 %s" % DST)
        return 1
    dst = read(DST)

    # a) XML 良构
    import xml.etree.ElementTree as ET
    try:
        ET.fromstring(dst)
        print("OK   XML 良构")
    except Exception as e:  # noqa: BLE001
        ok = False
        print("FAIL XML 解析失败: %s" % e)

    # b) 队伍构成：只允许 {1,2}（team 0 全部改判给 2）；有源图时再核对"改判后一致"
    m = _UNITOBJ_RE.search(dst)
    cen = {int(k): v for k, v in team_census(m.group(2)).items()} if m else {}
    if set(cen) != DST_TEAMS or any(v <= 0 for v in cen.values()):
        ok = False
        print("FAIL 产物队伍集合 %s（期望恰好 %s 且都非空）" % (sorted(cen), sorted(DST_TEAMS)))
    elif os.path.exists(SRC):
        ms = _UNITOBJ_RE.search(read(SRC))
        sc = {int(k): v for k, v in team_census(ms.group(2)).items()} if ms else {}
        want = {1: sc.get(1, 0), 2: sc.get(0, 0)}   # 源 1 原样；源 0 → 2
        if cen == want:
            print("OK   队伍构成 %s（与源 %s 改判后一致；team0=0 观战）" % (cen, sc))
        else:
            ok = False
            print("FAIL 队伍构成 %s 与源改判后 %s 不一致" % (cen, want))
    else:
        print("OK   队伍构成 %s（team0=0 观战；无源图可比对）" % cen)
    if "(t:0)" in dst:
        ok = False
        print("FAIL 产物里仍有 name=\"... (t:0)\" 残留")
    else:
        print("OK   无 (t:0) 残留")

    # c) 非单位层与原图逐字节一致
    if os.path.exists(SRC):
        if non_unit_layers_md5(read(SRC)) == non_unit_layers_md5(dst):
            print("OK   Ground/Items/set 三层与源逐字节一致")
        else:
            ok = False
            print("FAIL 非单位层被改动")

    # d) Triggers 必需项
    mt = _TRIGGERS_RE.search(dst)
    tg = mt.group(0) if mt else ""
    need = ['<property name="winCondition" value="commandCenter"/>',
            '<property name="fog" value="map"/>',
            "team_0_info", "team_1_info", "team_2_info", "team_3_info", "team_4_info",
            '<property name="disabledAI" value="1"/>']
    lack = [w for w in need if w not in tg]
    if lack:
        ok = False
        print("FAIL Triggers 缺: %s" % lack)
    else:
        print("OK   Triggers: winCondition/fog + team_1..4_info(3/4 disabledAI)")

    print("RESULT: %s" % ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


def cmd_selftest(_):
    """自检：把 transform 的守卫行为钉住（**合成输入**，不碰真图、不需要 SRC 存在）。

    为什么有它：2026-09-22 换图时把守卫从"死基线"改成了结构不变量，必须先有失败用例
    把新行为钉住，否则以后改守卫没人拦得住回归。
    """
    fails = 0

    def chk(name, ok, detail=""):
        nonlocal fails
        print(("OK   " if ok else "FAIL ") + name + (("  -- " + detail) if detail else ""))
        if not ok:
            fails += 1

    def mk(teams):
        """最小源图：只有 map_info + UnitObjects（结构与真源同形，够 transform 跑）。"""
        objs = "".join(
            '  <object gid="1" name="tank (t:%d)" x="1" y="1" width="20" height="20">\n'
            '   <properties><property name="unit" value="tank"/><property name="team" value="%d"/></properties>\n'
            '  </object>\n' % (t, t) for t in teams)
        return ('<?xml version="1.0"?>\n<map version="1.0" width="110" height="110">\n'
                ' <layer name="Ground" width="110" height="110"><data encoding="base64" compression="gzip"></data></layer>\n'
                ' <layer name="Items" width="110" height="110"><data encoding="base64" compression="gzip"></data></layer>\n'
                ' <objectgroup name="Triggers" visible="0">\n'
                '  <object id="1" name="map_info" x="64" y="45" width="203" height="122">\n'
                '   <properties><property name="type" value="skirmish"/></properties>\n  </object>\n </objectgroup>\n'
                ' <objectgroup name="UnitObjects">\n' + objs + ' </objectgroup>\n</map>')

    def expect_abort(name, text):
        try:
            transform(text)
            chk(name, False, "居然没拦")
        except SystemExit:
            chk(name, True)

    # 合法源：team 0/1 → 能转换；team 0 全部改判成 2
    # ⚠️ 断言必须只看 UnitObjects 段：Triggers 里的 team_0_info 本来就带
    #    <property name="team" value="0"/>，拿整份文档判"不含 team 0"永远不成立。
    try:
        out = transform(mk([0, 1, 1]))
        uo = _UNITOBJ_RE.search(out).group(2)
        chk("S1 合法源(team 0/1)可转换：UnitObjects 内 team0→2、无 (t:0) 残留",
            '<property name="team" value="2"/>' in uo and '<property name="team" value="0"/>' not in uo
            and '(t:2)' in uo and '(t:0)' not in uo)
        chk("S2 转换后 Triggers 已换成直播同款（winCondition + team_0_info）",
            'name="winCondition"' in out and 'team_0_info' in out)
    except SystemExit as e:
        chk("S1 合法源可转换", False, str(e))
        chk("S2 Triggers 已替换", False, "S1 已失败")

    # 守卫（本次由"死基线"改成结构不变量后的行为，必须拦住结构被动的源）
    expect_abort("S3 源里冒出 team 2 → ABORT", mk([0, 1, 2]))
    expect_abort("S4 源缺 team 0（只剩红） → ABORT", mk([1, 1]))
    expect_abort("S5 源缺 UnitObjects 段 → ABORT",
                 re.sub(r'<objectgroup name="UnitObjects">.*?</objectgroup>', '', mk([0, 1]), flags=re.S))
    expect_abort("S6 源缺 Triggers 段 → ABORT",
                 re.sub(r'<objectgroup name="Triggers".*?</objectgroup>', '', mk([0, 1]), flags=re.S))

    # ★ 2026-09-27：空自闭合 Triggers（真实新图 LIVE_FOR_MAP_001_2P 的形态）——
    #   旧正则会把自闭合 `/>` 当闭合、吞掉 UnitObjects ⇒ 崩溃。此用例把它钉死。
    def mk_triggers_empty():
        objs = ('  <object gid="1" name="tank (t:0)" x="1" y="1" width="20" height="20">\n'
                '   <properties><property name="unit" value="tank"/><property name="team" value="0"/></properties>\n'
                '  </object>\n'
                '  <object gid="1" name="tank (t:1)" x="2" y="2" width="20" height="20">\n'
                '   <properties><property name="unit" value="tank"/><property name="team" value="1"/></properties>\n'
                '  </object>\n')
        return ('<?xml version="1.0"?>\n<map version="1.0" width="110" height="110">\n'
                ' <layer name="Ground" width="110" height="110"><data encoding="base64" compression="gzip"></data></layer>\n'
                ' <layer name="Items" width="110" height="110"><data encoding="base64" compression="gzip"></data></layer>\n'
                ' <objectgroup name="Triggers"/>\n'
                ' <objectgroup name="UnitObjects">\n' + objs + ' </objectgroup>\n</map>')
    try:
        out = transform(mk_triggers_empty())
        uo = _UNITOBJ_RE.search(out)
        chk("S7 空自闭合 Triggers 源可转换：不崩溃且 UnitObjects 保留(team0→2)",
            bool(uo) and '<property name="team" value="2"/>' in uo.group(2)
            and '<property name="team" value="0"/>' not in uo.group(2))
        chk("S8 空自闭合源转换后 Triggers 已替换为直播同款",
            'name="winCondition"' in out and 'team_0_info' in out)
    except SystemExit as e:
        chk("S7 空自闭合 Triggers 源可转换", False, str(e))
        chk("S8 Triggers 已替换", False, "S7 已失败")

    print("RESULT: %s" % ("PASS" if not fails else "FAIL"))
    return 0 if not fails else 1


def cmd_dump(_):
    dst = read(DST)
    m = _UNITOBJ_RE.search(dst)
    cen = team_census(m.group(2)) if m else {}
    print("产物: %s (%d B)" % (DST, os.path.getsize(DST)))
    print("队伍构成:", cen)
    print("Ground/Items/set md5:", non_unit_layers_md5(dst))
    units = sorted(set(_UNIT_TILE_RE.findall(m.group(2)))) if m else []
    print("单位类型 (%d): %s" % (len(units), ", ".join(units)))
    return 0


def main(argv):
    cmd = argv[0] if argv else None
    # selftest 用合成输入，不需要 SRC 存在 ⇒ 在 SRC 检查之前分派
    if cmd == "selftest":
        return cmd_selftest(None)
    fn = {"check": cmd_check, "apply": cmd_apply, "dump": cmd_dump}.get(cmd)
    if not fn:
        print(__doc__)
        return 2
    if not os.path.exists(SRC):
        raise SystemExit("ABORT: 源图不存在 %s" % SRC)
    return fn(None)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
