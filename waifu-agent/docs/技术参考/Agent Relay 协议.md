# Agent Relay 协议 v1

> waifu-agent 中继模式 (agentMode="relay") 的 WebSocket 通信协议。
> 外部 AI Agent 通过此协议与 waifu 角色前端双向通信。

---

## 1. 连接

- **URL**: `ws://127.0.0.1:9191/status`（可在设置中修改）
- **格式**: 所有消息为 JSON 文本帧
- **方向**: 双向

## 2. waifu → Agent（客户端到服务器）

waifu 在用户输入时发送：

| 类型 | 字段 | 说明 |
|------|------|------|
| `user:chat` | `text`: string | 用户输入文本 |
| | `mode`: "text" \| "voice" | 输入模式 |
| `user:skip` | `reason`: string | 用户中断当前响应 |

```json
{"type": "user:chat", "text": "帮我查天气", "mode": "text"}
{"type": "user:skip", "reason": "click"}
```

## 3. Agent → waifu（服务器到客户端）

Agent 推送事件给 waifu 渲染。事件按以下顺序发送：

```
agent:start → (agent:thinking | agent:tool | agent:emotion | agent:motion)* → agent:end → tts:audio
```

### 3.1 生命周期事件

| 类型 | 字段 | 说明 |
|------|------|------|
| `agent:start` | `message`: string | 触发此轮对话的用户输入（回显） |

```json
{"type": "agent:start", "message": "帮我查天气"}
```

| 类型 | 字段 | 说明 |
|------|------|------|
| `agent:end` | `response`: string | Agent 完整响应文本 |
| | `synthesize`: boolean? | **2026-09-20 扩展**：`true` ⇒ 请 waifu 用**自身 TTS**（edge-tts）朗读 `response`，无需再发 `tts:audio`。不传 = 维持旧行为（等 `tts:audio`，否则静默显示文字） |

```json
{"type": "agent:end", "response": "今天北京晴，22-30°C，适合出门。"}
{"type": "agent:end", "response": "红方获胜！", "synthesize": true}
```

### 3.2 思考状态（可选）

| 类型 | 字段 | 说明 |
|------|------|------|
| `agent:thinking` | `detail`: string | 当前思考/操作描述 |

```json
{"type": "agent:thinking", "detail": "正在查询天气 API..."}
```

| 类型 | 字段 | 说明 |
|------|------|------|
| `agent:tool` | `tool`: string | 工具名称 |
| | `arg`: string | 工具参数 |

```json
{"type": "agent:tool", "tool": "web_search", "arg": "北京 今天 天气"}
```

### 3.3 表现控制（可选）

| 类型 | 字段 | 说明 |
|------|------|------|
| `agent:emotion` | `emotion`: "happy"\|"sad"\|"angry"\|"surprised"\|"neutral"\|"shy"\|"loving" | 角色表情 |

```json
{"type": "agent:emotion", "emotion": "happy"}
```

| 类型 | 字段 | 说明 |
|------|------|------|
| `agent:motion` | `motion`: string | Live2D 动作组（如 "TapBody", "Idle"） |
| | `index`: number? | 动作索引 |
| | `priority`: number? | 优先级 1-3，默认 3 |

```json
{"type": "agent:motion", "motion": "TapBody", "index": 3, "priority": 3}
```

### 3.4 TTS 音频

| 类型 | 字段 | 说明 |
|------|------|------|
| `tts:audio` | `text`: string | 合成的文本（用于口型同步） |
| | `audio`: string | Base64 MP3/WAV 音频数据 |
| | `duration_ms`: number | 播放时长（毫秒） |

```json
{"type": "tts:audio", "text": "今天北京晴，22到30度", "audio": "//uQx...", "duration_ms": 3500}
```

waifu 收到 `tts:audio` 后自动解码播放 + Live2D 口型联动。
如果不发 `tts:audio`，角色在 `agent:end` 后静默显示文字。

**`synthesize` 扩展（2026-09-20）**：若 `agent:end` 带 `synthesize: true`，waifu 会改用**自身 TTS**
（`src-tauri/python-embed` 的 edge-tts）朗读 `response`，并驱动口型 + 表情 —— 外部 Agent 无需生成音频
（省去 base64 传输与中继侧的 TTS 依赖）。两条路径互斥：带 `tts:audio` 时走音频播放；只带 `synthesize`
时走本地合成。当前使用方：`danmaku-relay/battle/waifuBridge.js`（直播游戏事件播报 / 观众对话）。

---

## 4. 完整示例

### 用户问天气

```
→ waifu 发送:
{"type": "user:chat", "text": "今天天气怎么样？", "mode": "text"}

← Agent 回复:
{"type": "agent:start", "message": "今天天气怎么样？"}
{"type": "agent:emotion", "emotion": "neutral"}
{"type": "agent:thinking", "detail": "查询天气数据..."}
{"type": "agent:tool", "tool": "weather_api", "arg": "北京 2026-06-03"}
{"type": "agent:end", "response": "今天北京晴，22-30°C，适合出门。"}
{"type": "tts:audio", "text": "今天北京晴，22到30度，适合出门。", "audio": "...", "duration_ms": 4000}
```

### 用户中断

```
→ waifu 发送:
{"type": "user:skip", "reason": "click"}
```

Agent 收到后应停止当前推理。

---

## 5. 内置模式 vs 中继模式

| | 内置 (builtin) | 中继 (relay) |
|--|:--:|:--:|
| LLM API key | waifu 配置 | Agent 管理 |
| WebSocket | 可选（仅状态监听） | **必需** |
| 消息发送 | 直接调 LLM API | 通过 WS 发给 Agent |
| 响应渲染 | 流式 LLM → TTS | Agent 事件 → 角色动画 |
| 适用人群 | 日常用户 | 开发者 |

在设置面板中切换，或首次启动时选择。

---

## 6. 编写 Agent 适配器

三个步骤：
1. 连接 `ws://127.0.0.1:9191/status`
2. 监听 `user:chat` 消息
3. 发送 `agent:*` 和 `tts:audio` 事件

参考实现见 `agent-adapter/python/waifu_relay.py`。
