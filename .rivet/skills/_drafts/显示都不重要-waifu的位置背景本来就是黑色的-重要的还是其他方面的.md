---
name: 显示都不重要-waifu的位置背景本来就是黑色的-重要的还是其他方面的
description: 显示都不重要，waifu的位置背景本来就是黑色的，重要的还是其他方面的 — verified by 1 check
triggers: ['verify_director', 'waifuDirector', 'index', '显示都不重要']
---

# 显示都不重要-waifu的位置背景本来就是黑色的-重要的还是其他方面的

> 自动从会话 c1771e51 蒸馏的草稿。审核后用 `/skill approve 显示都不重要-waifu的位置背景本来就是黑色的-重要的还是其他方面的` 入库，或 `/skill reject 显示都不重要-waifu的位置背景本来就是黑色的-重要的还是其他方面的` 丢弃。

## Steps
1. 修改：D:\Projects\live-waifu\danmaku-relay\tools\verify_director.js
2. 阅读 / 搜索：node tools/verify_director.js 2>&1 | grep -E "A6|A
3. 修改：D:\Projects\live-waifu\danmaku-relay\battle\waifuDirector.js、D:\Projects\live-waifu\danmaku-relay\battle\index.js
4. 阅读 / 搜索：echo "=== verify:director ==="; npm run verify:dir、npm run verify 2>&1 | grep -E "FAIL|RESULT|Error"、git add battle/index.js battle/waifuDirector.js to
5. 操作：todo

## Verified by
- cd /d/Projects/live-waifu/danmaku-relay && echo "=== verify:director ==="; npm run verify:director 2>&1 | grep -E "A6|A7|A8|A9|G5|PASS /|FAIL"; echo "=== check ==="; npm run check 2>&1 | tail -1; echo (passed 0)

<!-- skill-draft-key: b579e435025b -->
<!-- source-session: c1771e51 -->
