---
name: b-不止列出-把-mod-单位也变成可召唤-扩-unit-map-单价-文档随之生成
description: B：不止列出——把 mod 单位也变成可召唤（扩 UNIT_MAP + 单价），文档随之生成 — verified by 8 checks
triggers: ['gen_mod_units', 'liveSpawner', 'economy', 'gen_unit_table']
---

# b-不止列出-把-mod-单位也变成可召唤-扩-unit-map-单价-文档随之生成

> 自动从会话 ab2d992f 蒸馏的草稿。审核后用 `/skill approve b-不止列出-把-mod-单位也变成可召唤-扩-unit-map-单价-文档随之生成` 入库，或 `/skill reject b-不止列出-把-mod-单位也变成可召唤-扩-unit-map-单价-文档随之生成` 丢弃。

## Steps
1. 阅读 / 搜索：T=$(ls -d /tmp/rwmods-* 2>/dev/null | head -1); d=、C:\Users\gaven\AppData\Local\Temp\rivet-raw\55896d6042442e1a1f99f81f.raw
2. 操作：todo
3. 阅读 / 搜索：cd /d/Projects/live-waifu/danmaku-relay
echo "===、GAME="/d/game/tiexiuzhanzheng_zhengshi_v1.15_anfen
4. 修改：D:\Projects\live-waifu\danmaku-relay\tools\gen_mod_units.js
5. 阅读 / 搜索：cd /d/Projects/live-waifu/danmaku-relay
node --che
6. 修改：D:\Projects\live-waifu\danmaku-relay\tools\gen_mod_units.js
7. 阅读 / 搜索：cd /d/Projects/live-waifu/danmaku-relay
node --che、cd /d/Projects/live-waifu/danmaku-relay
echo "===、D:\Projects\live-waifu\danmaku-relay\battle\economy.js
8. 修改：D:\Projects\live-waifu\danmaku-relay\tools\gen_mod_units.js
9. 阅读 / 搜索：cd /d/Projects/live-waifu/danmaku-relay
node --che、D:\Projects\live-waifu\danmaku-relay\battle\liveSpawner.js
10. 修改：D:\Projects\live-waifu\danmaku-relay\battle\liveSpawner.js、D:\Projects\live-waifu\danmaku-relay\battle\economy.js、D:\Projects\live-waifu\danmaku-relay\tools\gen_unit_table.js
11. 阅读 / 搜索：cd /d/Projects/live-waifu/danmaku-relay
node --che
12. 修改：D:\Projects\live-waifu\danmaku-relay\tools\gen_unit_table.js
13. 阅读 / 搜索：cd /d/Projects/live-waifu/danmaku-relay
for f in t、cd /d/Projects/live-waifu/danmaku-relay
node tools
14. 修改：D:\Projects\live-waifu\danmaku-relay\tools\gen_mod_units.js
15. 阅读 / 搜索：cd /d/Projects/live-waifu/danmaku-relay
node --che
16. 修改：D:\Projects\live-waifu\danmaku-relay\package.json
17. 阅读 / 搜索：cd /d/Projects/live-waifu
rm -f .rivet/scratch/uni、C:\Users\gaven\AppData\Local\Temp\rivet-raw\3e2d79b346da9170f627a2aa.raw、cd /d/Projects/live-waifu/danmaku-relay
git add ba
18. 验证：deliver_task
19. 操作：todo
20. 阅读 / 搜索：cd /d/Projects/live-waifu/danmaku-relay
echo "===、D:\Projects\live-waifu\danmaku-relay\battle\liveSpawner.js
21. 操作：todo
22. 阅读 / 搜索：cd /d/Projects/live-waifu/danmaku-relay
node -e "
23. 操作：todo

## Verified by
- cd /d/Projects/live-waifu/danmaku-relay
node --check tools/gen_mod_units.js && echo "SYNTAX OK"
echo "=== --print ==="
node tools/gen_mod_units.js --print 2>&1 | head -40 (passed 0)
- cd /d/Projects/live-waifu/danmaku-relay
node --check tools/gen_mod_units.js && echo "SYNTAX OK"
node tools/gen_mod_units.js --print 2>&1 | head -30 (passed 0)
- cd /d/Projects/live-waifu/danmaku-relay
node --check tools/gen_mod_units.js && node tools/gen_mod_units.js --print 2>&1 | head -12
echo; echo "=== 净化后：中文名带空格/含英文的（可能是未本地化）统计 ==="
node tools/gen_mod_un (passed 0)
- cd /d/Projects/live-waifu/danmaku-relay
node --check tools/gen_mod_units.js && node tools/gen_mod_units.js 2>&1 | head -6
node -e "const m=require('./battle/mod-units.json'); console.log('mods:', JSON (passed 0)
- cd /d/Projects/live-waifu/danmaku-relay
for f in tools/gen_unit_table.js tools/gen_mod_units.js battle/liveSpawner.js battle/economy.js; do node --check "$f" && echo "SYNTAX OK: $f"; done
echo; echo " (passed 0)

<!-- skill-draft-key: 1df83c66f6aa -->
<!-- source-session: ab2d992f -->
