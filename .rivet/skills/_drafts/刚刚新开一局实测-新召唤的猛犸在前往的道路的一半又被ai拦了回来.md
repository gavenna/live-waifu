---
name: 刚刚新开一局实测-新召唤的猛犸在前往的道路的一半又被ai拦了回来
description: 刚刚新开一局实测，新召唤的猛犸在前往的道路的一半又被AI拦了回来 — verified by 3 checks
triggers: ['verify_patrol_refresh', 'liveSpawner', 'index', 'package']
---

# 刚刚新开一局实测-新召唤的猛犸在前往的道路的一半又被ai拦了回来

> 自动从会话 f639f747 蒸馏的草稿。审核后用 `/skill approve 刚刚新开一局实测-新召唤的猛犸在前往的道路的一半又被ai拦了回来` 入库，或 `/skill reject 刚刚新开一局实测-新召唤的猛犸在前往的道路的一半又被ai拦了回来` 丢弃。

## Steps
1. 阅读 / 搜索：repo_map、.、ls -la D:/Projects/live-waifu/ && echo "=== war-da
2. 操作：todo
3. 修改：D:\Projects\live-waifu\danmaku-relay\tools\verify_patrol_refresh.js
4. 阅读 / 搜索：node tools/verify_patrol_refresh.js; echo "exit=$?
5. 修改：D:\Projects\live-waifu\danmaku-relay\battle\liveSpawner.js
6. 阅读 / 搜索：node tools/verify_patrol_refresh.js; echo "exit=$?
7. 操作：todo
8. 修改：D:\Projects\live-waifu\danmaku-relay\battle\index.js、D:\Projects\live-waifu\danmaku-relay\package.json
9. 阅读 / 搜索：echo "=== npm run check ===" && npm run check 2>&1、cat "C:\Users\gaven\AppData\Local\Temp\rivet-raw\5、G="D:/game/tiexiuzhanzheng_zhengshi_v1.15_anfensi.
10. 操作：todo
11. 修改：D:\Projects\live-waifu\.rivet\HANDOFF.md
12. 验证：deliver_task
13. 阅读 / 搜索：echo "=== 根仓库 ==="; cd D:/Projects/live-waifu && g、git add battle/liveSpawner.js battle/index.js pack
14. 操作：todo

## Verified by
- cd D:/Projects/live-waifu/danmaku-relay && echo "=== npm run check ===" && npm run check 2>&1 | tail -3 && echo "=== npm run verify:patrol ===" && npm run verify:patrol 2>&1 | tail -20; echo "exit=${P (passed 0)
- cat "C:\Users\gaven\AppData\Local\Temp\rivet-raw\5aba332b4f9ca2ae18f3c646.raw" 2>/dev/null | head -8; echo "---recheck---"; cd D:/Projects/live-waifu/danmaku-relay && npm run check 2>&1 | tail -2 (passed 0)
- echo "=== 根仓库 ==="; cd D:/Projects/live-waifu && git status --short 2>&1 | head -20; echo "=== 根仓库 .rivet 是否被忽略 ==="; git check-ignore -v .rivet/HANDOFF.md 2>&1; git ls-files --error-unmatch .rivet/HA (passed 0)

<!-- skill-draft-key: d2fb5279860d -->
<!-- source-session: f639f747 -->
