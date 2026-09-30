# -*- coding: utf-8 -*-
"""用 XML 解析器（不是正则）独立复核地图 UnitObjects —— 补 switch-map 复核脚本的盲区。

为什么要这个：`.rivet/skills/switch-map/scripts/verify_adapted_map.py` 用正则只认
`<property name="unit" .../>`。地图里一旦出现 mod 兵种（走 `customUnit` 属性），
它会**只数到剩下的基础单位**（本次实测：产物 185 个对象，它只报 50 条 / {1:25,2:25}），
于是给出一个有损的 PASS。本脚本走 xml.etree 这条独立通道把全部对象读全。

用法:
    python tools/verify_units_et.py <map.tmx> [--expect-team 1=88 --expect-team 2=97]
"""
import sys
import xml.etree.ElementTree as ET
from collections import Counter


def collect(path):
    root = ET.parse(path).getroot()
    rows = []
    for og in root.iter("objectgroup"):
        if og.get("name") != "UnitObjects":
            continue
        for ob in og.iter("object"):
            props = {p.get("name"): p.get("value")
                     for p in ob.iter("property")}
            rows.append({
                "unit": props.get("unit"),
                "custom": props.get("customUnit"),
                "team": props.get("team"),
                "x": ob.get("x"), "y": ob.get("y"),
                "name": ob.get("name"),
            })
    return root, rows


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    path = sys.argv[1]
    expect = {}
    for a in sys.argv[2:]:
        if a.startswith("--expect-team"):
            k, v = a.split("=", 1)
            expect[k.split("=")[0]] = v
    try:
        root, rows = collect(path)
    except ET.ParseError as e:
        print("FAIL XML 解析失败: %s" % e)
        return 1
    print("OK   XML 良构（xml.etree 解析通过）")
    print("     UnitObjects 对象总数: %d" % len(rows))

    ok = True
    miss = [r for r in rows if not r["unit"] and not r["custom"]]
    if miss:
        ok = False
        print("FAIL 有 %d 个对象既无 unit 也无 customUnit：%s"
              % (len(miss), miss[:3]))
    else:
        print("OK   每个对象都有 unit 或 customUnit")

    byteam = Counter(r["team"] for r in rows)
    print("     按队伍: %s" % dict(sorted(byteam.items())))
    if "0" in byteam:
        ok = False
        print("FAIL 仍有 team 0 单位（源图标记该改判成 2）")
    else:
        print("OK   无 team 0 残留")

    n_base = sum(1 for r in rows if r["unit"])
    n_mod = sum(1 for r in rows if r["custom"])
    print("     基础单位(unit) %d 条 / mod 单位(customUnit) %d 条" % (n_base, n_mod))

    # 标签 name 里的 (t:N) 是否与 property team 一致
    bad = []
    for r in rows:
        nm = r["name"] or ""
        if " (t:" in nm and nm.rsplit(" (t:", 1)[1].rstrip(")") != r["team"]:
            bad.append(nm)
    if bad:
        ok = False
        print("FAIL %d 个对象的 name 标签队号与 team 属性不一致：%s" % (len(bad), bad[:3]))
    else:
        print("OK   name 标签 (t:N) 与 team 属性一致")

    print()
    print("     mod 单位明细:")
    for (u, tm), c in sorted(Counter(
            (r["custom"], r["team"]) for r in rows if r["custom"]).items()):
        print("       %-24s t:%-2s x%-3d" % (u, tm, c))

    if expect:
        for k, v in expect.items():
            print("     (期望 %s)" % v)

    print()
    print("RESULT: %s" % ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
