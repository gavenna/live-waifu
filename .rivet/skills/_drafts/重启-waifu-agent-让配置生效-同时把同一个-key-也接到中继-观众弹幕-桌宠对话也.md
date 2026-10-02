---
name: 重启-waifu-agent-让配置生效-同时把同一个-key-也接到中继-观众弹幕-桌宠对话也
description: 重启 waifu-agent 让配置生效；同时把同一个 key 也接到中继（观众弹幕→桌宠对话也能用，中继需再重启一 次） — verified by 2 checks
triggers: ['waifuChat', 'verify_waifu_bridge', 'llm', 'waifu-agent']
---

# 重启-waifu-agent-让配置生效-同时把同一个-key-也接到中继-观众弹幕-桌宠对话也

> 自动从会话 2005bb66 蒸馏的草稿。审核后用 `/skill approve 重启-waifu-agent-让配置生效-同时把同一个-key-也接到中继-观众弹幕-桌宠对话也` 入库，或 `/skill reject 重启-waifu-agent-让配置生效-同时把同一个-key-也接到中继-观众弹幕-桌宠对话也` 丢弃。

## Steps
1. 阅读 / 搜索：cd /d/Projects/live-waifu/danmaku-relay
echo "===
2. 修改：D:\Projects\live-waifu\danmaku-relay\battle\waifuChat.js、D:\Projects\live-waifu\danmaku-relay\tools\verify_waifu_bridge.js
3. 阅读 / 搜索：node tools/verify_waifu_bridge.js 2>&1 | grep -E "
4. 修改：D:\Projects\live-waifu\danmaku-relay\data\llm.json
5. 阅读 / 搜索：cd /d/Projects/live-waifu/danmaku-relay
echo "===、cd /d/Projects/live-waifu/danmaku-relay
git add ba

## Verified by
- cd /d/Projects/live-waifu/danmaku-relay
echo "=== .gitignore ==="; cat .gitignore 2>/dev/null
echo "=== 这些路径是否被忽略 ==="
for p in "data" "data/llm.json" "server/secrets.json" "logs"; do
  printf '%-22s  (passed 0)
- cd /d/Projects/live-waifu/danmaku-relay
echo "=== 确认 llm.json 不会被 git 跟踪 ==="
git check-ignore -v data/llm.json
git status --porcelain=v1 | grep -i "llm.json" && echo "!!! 出现在 git status，危险" || echo " (passed 0)

<!-- skill-draft-key: 2fd1827fbffa -->
<!-- source-session: 2005bb66 -->
