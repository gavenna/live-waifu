---
name: 开始执行已批准方案-温泉关战役场景-thermopylae-scenario-实施计划-rive
description: 开始执行已批准方案「温泉关战役场景（Thermopylae Scenario）实施计划」(.rivet/plans/温泉关战役场景实施计划.md)。先 read_file 读取该计划,然后用 plan_task(execute=true) 或 team_orchestrate 把任务按波次并行执行、逐波过审查门;开工前用 todo 列出有序步骤跟踪进度,全部完成后 plan_close。 — ve
triggers: ['map_thermopylae', 'liveSpawner', 'index', 'verify_automation']
---

# 开始执行已批准方案-温泉关战役场景-thermopylae-scenario-实施计划-rive

> 自动从会话 86b9ac4f 蒸馏的草稿。审核后用 `/skill approve 开始执行已批准方案-温泉关战役场景-thermopylae-scenario-实施计划-rive` 入库，或 `/skill reject 开始执行已批准方案-温泉关战役场景-thermopylae-scenario-实施计划-rive` 丢弃。

## Steps
1. 阅读 / 搜索：{ echo "=== 反编译树里与水面/通行性相关的代码 ==="; grep -rn "Deep、{ echo "=== 全 war-vote 树里出现的水面相关字符串 ==="; grep -rI、{ echo "=== game/b 里 water 出现的行 ==="; grep -rniE "
2. 修改：D:/Projects/live-waifu/danmaku-relay/tools/map_thermopylae.py
3. 阅读 / 搜索：{ echo "###### terrain 断言 ######"; py danmaku-rela
4. 修改：D:/Projects/live-waifu/danmaku-relay/tools/map_thermopylae.py
5. 阅读 / 搜索：{ echo "###### terrain ######"; py danmaku-relay/t
6. 修改：D:/Projects/live-waifu/danmaku-relay/tools/map_thermopylae.py
7. 阅读 / 搜索：py danmaku-relay/tools/map_thermopylae.py apply 2>
8. 修改：D:/Projects/live-waifu/danmaku-relay/tools/map_thermopylae.py
9. 阅读 / 搜索：py danmaku-relay/tools/map_thermopylae.py apply 2>、GAME="D:/game/tiexiuzhanzheng_zhengshi_v1.15_anfen、D:/Projects/live-waifu/danmaku-relay/battle/liveSpawner.js
10. 修改：D:/Projects/live-waifu/danmaku-relay/battle/liveSpawner.js、D:/Projects/live-waifu/danmaku-relay/battle/index.js
11. 阅读 / 搜索：{ echo "=== 改了什么 ==="; git status --short; echo; e、{ echo "=== 测试里写死的旧地图坐标 ==="; grep -rn "1716\|1652、{ echo "### verify_automation.js 28-40"; sed -n '2
12. 修改：D:/Projects/live-waifu/danmaku-relay/tools/verify_automation.js、D:/Projects/live-waifu/danmaku-relay/tools/verify_economy.js、D:/Projects/live-waifu/danmaku-relay/tools/verify_viewer_team.js
13. 阅读 / 搜索：npm run verify 2>&1 | grep -E "PASS /|FAIL|check:
14. 修改：D:/Projects/live-waifu/danmaku-relay/tools/verify_viewer_team.js
15. 阅读 / 搜索：npm run verify 2>&1 | grep -E "PASS /|FAIL|check:、grep -n "560.0, 380.0\|A4" tools/verify_automation
16. 修改：D:/Projects/live-waifu/danmaku-relay/tools/verify_automation.js
17. 阅读 / 搜索：npm run verify 2>&1 | grep -E "PASS /|FAIL|check:
18. 操作：job
19. 阅读 / 搜索：sleep 3 && (netstat -ano 2>/dev/null | grep -E ":8
20. 操作：job
21. 阅读 / 搜索：py - <<'PYEOF' 2>&1 | tail -14
import json,subproc、GAME="D:/game/tiexiuzhanzheng_zhengshi_v1.15_anfen
22. 修改：D:/Projects/live-waifu/danmaku-relay/tools/map_thermopylae.py
23. 阅读 / 搜索：py danmaku-relay/tools/map_thermopylae.py apply 2>、py - <<'PYEOF' 2>&1 | tail -8
import json,subproce、D:/Projects/live-waifu/.rivet/tmp/thermo_wide.png
24. 操作：job

## Verified by
- cd "D:/Projects/live-waifu" && { echo "###### terrain 断言 ######"; py danmaku-relay/tools/map_thermopylae.py terrain 2>&1 | tail -8; echo; echo "###### check（预期 FAIL = RED）######"; py danmaku-relay/too (passed 0)
- cd "D:/Projects/live-waifu/danmaku-relay" && { echo "=== 改了什么 ==="; git status --short; echo; echo "=== npm run verify ==="; npm run verify 2>&1 | grep -E "PASS /|FAIL|check: OK"; echo "verify exit=${ (passed 0)
- cd "D:/Projects/live-waifu/danmaku-relay" && npm run verify 2>&1 | grep -E "PASS /|FAIL|check: OK"; echo "verify exit=${PIPESTATUS[0]}" (passed 0)
- cd "D:/Projects/live-waifu/danmaku-relay" && npm run verify 2>&1 | grep -E "PASS /|FAIL|check: OK"; echo "verify exit=${PIPESTATUS[0]}" (passed 0)
- cd "D:/Projects/live-waifu/danmaku-relay" && npm run verify 2>&1 | grep -E "PASS /|FAIL|check: OK"; echo "verify exit=${PIPESTATUS[0]}" (passed 0)

<!-- skill-draft-key: ba91e203587a -->
<!-- source-session: 86b9ac4f -->
