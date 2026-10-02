#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify_adapted_map.py — 换图产物的**独立复核**（换一套逻辑，不复用工具的 check）。

为什么单独写一份：map_adapt_newdire.py 的 check 与它的 transform 出自同一个人同一套假设，
"自己验自己"抓不到系统性误解（HANDOFF 记过这个教训）。本脚本**不 import 工具**，
从零解析，专门做交叉验证。

用法：
    python verify_adapted_map.py <源图.tmx> <产物.tmx>

断言（逐条独立实现）：
  1. 除 Triggers / UnitObjects 两段外，源与产物**逐字节相同**
  2. 单位集合 (unit, 源team(0→2), x, y) 一一对应，条数相等
  3. 产物 UnitObjects 队伍集合恰为 {1,2} 且都非空；无 team 0、无 "(t:0)" 残留
  4. 产物 Triggers 含 map_info(winCondition + fog) + team_0..4_info，且 disabledAI ≥ 2
     （team_0_info 的 allyGroup 是防秒判负的关键，单独点名）
  5. 产物 XML 良构（ElementTree）
退出码 0 = 全过；1 = 有 FAIL。
"""
import collections
import os
import re
import sys
import xml.etree.ElementTree as ET

sys.stdout.reconfigure(encoding="utf-8")

TRIGGERS_RE = re.compile(r'<objectgroup\b[^>]*\bname="Triggers"[^>]*>.*?</objectgroup>', re.S)
UNITOBJ_RE = re.compile(r'(<objectgroup\b[^>]*\bname="UnitObjects"[^>]*>)(.*?)(</objectgroup>)', re.S)
OBJECT_RE = re.compile(r"<object\b[^>]*>.*?</object>", re.S)

fails = 0


def chk(name, ok, detail=""):
    global fails
    print(("OK   " if ok else "FAIL ") + name + (("  -- " + detail) if detail else ""))
    if not ok:
        fails += 1


def read(p):
    with open(p, encoding="utf-8", newline="") as fh:
        return fh.read()


def remove_objectgroup(text, name, placeholder):
    """扫描式（**非正则**）移除 <objectgroup name="X"> 整段，兼容自闭合 `/>` 与含内容 `>…</objectgroup>`。

    为什么不用正则：`<objectgroup[^>]*name="X"[^>]*>.*?</objectgroup>` 会把**空自闭合**标签
    `<objectgroup name="Triggers"/>` 的 `/>` 当成闭合 `>`，随后 `.*?` 一路吞到后面 UnitObjects 的
    `</objectgroup>` ⇒ 本检查假红（真实新图 LIVE_FOR_MAP_001_2P 的源图正是空 Triggers）。
    独立复核刻意换一套手段（本脚本不 import map_adapt），故用逐字符扫描而非正则。
    """
    needle = 'name="%s"' % name
    pos = 0
    while True:
        i = text.find('<objectgroup', pos)
        if i == -1:
            return text
        j = text.find('>', i)
        if j == -1:
            return text
        tag = text[i:j + 1]
        if needle in tag:
            if tag.endswith('/>'):
                return text[:i] + placeholder + text[j + 1:]
            k = text.find('</objectgroup>', j)
            if k == -1:
                return text
            return text[:i] + placeholder + text[k + len('</objectgroup>'):]
        pos = j + 1


def units(text):
    """[(unit, team, x, y)] —— 从 UnitObjects 段里逐 <object> 抽。"""
    body = UNITOBJ_RE.search(text).group(2)
    out = []
    for o in OBJECT_RE.findall(body):
        u = re.search(r'<property name="unit" value="([^"]*)"', o)
        t = re.search(r'<property name="team" value="([^"]*)"', o)
        x = re.search(r'\bx="([^"]*)"', o)
        y = re.search(r'\by="([^"]*)"', o)
        if u and t:
            out.append((u.group(1), t.group(1), x.group(1) if x else "", y.group(1) if y else ""))
    return out


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    src_p, dst_p = argv[0], argv[1]
    for p in (src_p, dst_p):
        if not os.path.exists(p):
            print("FAIL 文件不存在: %s" % p)
            return 1
    s, d = read(src_p), read(dst_p)

    # 1) 除两段外逐字节相同（扫描式剥离，兼容空自闭合 Triggers；见 remove_objectgroup 说明）
    s_rest = remove_objectgroup(remove_objectgroup(s, "UnitObjects", "<UO/>"), "Triggers", "<TR/>")
    d_rest = remove_objectgroup(remove_objectgroup(d, "UnitObjects", "<UO/>"), "Triggers", "<TR/>")
    diff = [i for i in range(min(len(s_rest), len(d_rest))) if s_rest[i] != d_rest[i]]
    chk("1) 除 Triggers/UnitObjects 外逐字节相同", s_rest == d_rest,
        "" if s_rest == d_rest else "首个差异在偏移 %s" % (diff[0] if diff else "长度不同"))

    # 2) 单位集合一一对应（源 team 0 → 2）
    su, du = units(s), units(d)
    mapped = sorted((u, ("2" if t == "0" else t), x, y) for (u, t, x, y) in su)
    chk("2) 单位集合(unit, 源0→2, x, y) 一一对应", mapped == sorted(du),
        "源 %d 条 / 产物 %d 条" % (len(su), len(du)))

    # 3) 队伍集合
    dcen = collections.Counter(t for (_u, t, _x, _y) in du)
    chk("3a) 产物队伍集合恰为 {1,2} 且都非空", set(dcen) == {"1", "2"} and all(v > 0 for v in dcen.values()),
        str(dict(dcen)))
    chk("3b) 无 team 0 单位、无 (t:0) 残留", dcen.get("0", 0) == 0 and "(t:0)" not in d,
        "team0 条数=%d, (t:0) 出现=%d" % (dcen.get("0", 0), d.count("(t:0)")))

    # 4) Triggers
    tg = TRIGGERS_RE.search(d)
    tg = tg.group(0) if tg else ""
    names = re.findall(r'name="(team_\d+_info|map_info)"', tg)
    chk("4a) Triggers 含 map_info + team_0..4_info",
        "map_info" in names and all(("team_%d_info" % i) in names for i in range(5)), str(names))
    chk("4b) map_info 含 winCondition 与 fog",
        'name="winCondition"' in tg and 'name="fog"' in tg)
    chk("4c) disabledAI ≥ 2（team_3/4 观众宿主）", tg.count('name="disabledAI"') >= 2,
        "disabledAI=%d" % tg.count('name="disabledAI"'))
    m0 = re.search(r'name="team_0_info"[^>]*>(.*?)</object>', tg, re.S)
    chk("4d) team_0_info 有 allyGroup（防秒判负的关键）",
        bool(m0) and 'name="allyGroup"' in m0.group(1))

    # 5) XML 良构
    try:
        ET.fromstring(d)
        chk("5) 产物 XML 良构", True)
    except Exception as e:  # noqa: BLE001
        chk("5) 产物 XML 良构", False, str(e))

    print("RESULT: %s" % ("PASS" if not fails else "FAIL"))
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
