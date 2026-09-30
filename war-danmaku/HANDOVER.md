# HANDOVER.md

> 每次 `/wrapup` 覆写。新会话先读这个 ↔ 再对比 `git status`。

## current_state

### verified
- 可编译: 是（`node --check` 全量通过，announcer test L1-L3 13 PASS）
- 可运行: 是（`node server/index.js` 四端口全启）
- 单 exe 架构: `build.js` → `dist/war-danmaku/war-danmaku.exe` (~89 MB)
- 抖音弹幕: ✅ 全链路通
- B站弹幕: ⚠ Cookie 过期

### 本轮完成（07-25~08-05）— 话术引擎调试闭环

**设计变更：WAITING 与 COUNTDOWN 合并**
- 游戏循环: `ROUND_END → COUNTDOWN(30s) → PLAYING → ROUND_END → ...`（不再经 WAITING）
- WAITING 仅服务器首启时出现一次（round=0，主播手动点"启动游戏"）
- COUNTDOWN 30s（DEV 模式从 5s 改为 30s）：进入时播招募话术 `countdown_recruit`，最后 5s 播读秒
- `endRound()` 结算后直接 `startRound()`，删除中间 WAITING 态

**修复的话术 bug（8 个）**:
1. observer 通知被包在 `PLAYING/ROUND_END` 条件内 → WAITING/COUNTDOWN 阶段 Announcer 收不到事件，开场/倒计时全静默 → 通知块移到条件外，所有状态都通知
2. `_gameStarted` 在 `_maybePhaseTrigger` 之前置 true → `game_start` 判定永远 false → 调整调用顺序
3. cheap/medium 档礼物只 push `danmaku_text`（进 LLM 缓冲区），不 push `spawn_preview` → 礼物无反应 → 补 spawn_preview
4. cheap/medium 的 `spawn_preview` 缺 `text` 字段 → 前端 `renderer.js:250` 显示 undefined → 补 `text: previewText`
5. 上游 `bilibili.js` / `douyin.js` 关注奖励 gift 消息缺 `giftName` → 话术念 "undefined" → 全部补上（含 SuperChat/舰长/关注奖励）
6. ⚔🔥 emoji 被 TTS 逐字朗读 → `cleanForTts()` 清洗后再送 TTS（画面仍保留原文本）
7. 模板插值 `val !== undefined` 不防 null → 改 `val != null` + 残留 `{xxx}` 占位符兜底清除
8. Announcer 播报 `giftName` 缺失时用 `troopName` 兜底

**新增资产**:
- `docs/话术引擎参考.md` — 完整话术清单 + 调度规则 + LLM 引擎文档
- `docs/话术验收清单.md` — 按游戏时间线的话术验收表（主播对照听）
- `docs/assets/召唤指南.svg` — 直播间挂图（阵营加入/免费指令/礼物→兵种表），OBS 媒体源直接挂

### assumed（未逐条验证）
- LLM 话术：代码完整但 `LLM_ENABLED=false`，缺 API Key
- 真实弹幕/礼物链路未经实际观众验证（undefined 问题修复后未直播实测）
- waifu-agent 口型音频不同步（vowel ~220ms/字 vs edge-tts ~500ms/字）
- 召唤指南 SVG 已生成但未挂到 OBS 验收

## failed_approaches

- **observer 绑 pendingEvents**: `if (pendingEvents.length > 0)` → 纯状态切换不可见。修复：去掉条件。
- **observer 绑 PLAYING 条件**: 通知块在 `if (state === PLAYING || ROUND_END)` 内 → WAITING/COUNTDOWN 静默。修复：通知块提到条件外。
- **`_gameStarted` 标记放 phase 触发前**: game_start 判空永远 false → 调整顺序，phase 触发先执行。
- **cheap/medium 礼物只发 danmaku_text**: Announcer 不播礼物感谢 → 改为 spawn_preview。
- **premium 与 cheap/medium 事件结构不一致**: cheap/medium 的 spawn_preview 缺 text → 前端 undefined。修复：结构对齐（text + giftName 都有）。
- **phase 共用 eventType**: 6 个阶段触发器全用 `eventType: 'phase'` → 类型冷却互杀。修复：各自独立命名。
- **TTS 公式 `audioSize/2000`**: 按 16kbps 算，实际 ~64kbps → 改 `audioSize/6`。
- **test.js 顶层 await**: Node.js 报 module 歧义 → 改 async main() IIFE。

## next_steps

1. **实测 undefined 修复效果**：重启 server + 模拟礼物（`node server/danmaku/douyin-test.js`）→ 确认控制面板/前端/话术三处都不再显示 undefined
2. 召唤指南 SVG 挂 OBS 验收（尺寸/排版/信息准确）
3. LLM 话术：配 API Key → `LLM_ENABLED=true`
4. waifu-agent 口型同步修
5. 真实直播测试 douyin → Announcer 全链路
6. LLM 部分需要用户提供 DeepSeek API key

## drift_warning
⚠️ 如果本文件超过 24 小时未更新，先 `git status` / `git diff` 再信它。
