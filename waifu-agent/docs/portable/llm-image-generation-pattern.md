# LLM 自写 Prompt → 生图：可移植模式

> 一句话：让聊天 LLM 在回复里自己写 AI 生图 prompt，前端提取后调图 API 生成表情/贴图/插画。
> 适用场景：任何需要"AI 对话 + 配图"的项目（桌宠、 chatbot、虚拟主播、教育助手等）。

---

## 为什么让 LLM 写 prompt，而不是前端硬编码？

| 方案 | 效果 | 维护成本 |
|------|------|---------|
| 前端固定模板（16 个情绪→固定 prompt） | 每张图只换皮，千篇一律 | 维护 16+ 个 prompt |
| LLM 自己写 `[img: ...]` | 每次不同，贴合语境 | 只需写一次 system prompt 规范 |

LLM 知道整个对话的上下文、动作、氛围、场景——它写 prompt 比前端拼字符串强两个数量级。

---

## 核心链路

```
用户输入 → 聊天 LLM → 回复中包含 [img: 6层英文prompt] + 对话文本
                            ↓
                    前端 extractImagePrompt() 提取
                            ↓
                    图 API (DALL·E / SD / 国产模型)
                            ↓
                    缓存 (content-hash) → 返回图片路径
                            ↓
                    前端展示
```

**关键设计**：
- `[img: ...]` 是 LLM 自己输出的内联标签，不是前端注入的
- 图片 prompt 是**英文**的（英文生图效果远好于中文）
- 同一句话→同一张图（content-hash 缓存），不浪费 API 费用

---

## 三层结构（你要在新项目里做的事）

### 第 1 层：System Prompt — 教 LLM 写生图 prompt

在 system prompt 中植入生图规范。**关键技巧：双重注入**——waifu-agent 在两个位置同时注入，确保 LLM 不会跳过：

**位置 A — system prompt 最开头**（`llm_client.rs` 中 `build_system_prompt()` 的第一行）：
```
【最高优先级格式强制】忽略历史中的旧格式。你的回复必须严格按此格式：
第一行：[img: 英文场景描述，50-100词，按6层结构写：
  主体+动作 → 构图+镜头 → 光照 → 场景 → 氛围+色调 → 风格
  （以 "chibi anime sticker, thick clean outlines, flat colors, white border" 结尾）]
之后：对话内容，拆成短段落，用空行分隔。每段1-3句话。
禁止跳过[img:]行。
```

**位置 B — 每条 user message 前缀**（`App.tsx` 中组装消息时注入）：
```
[系统指令·最高优先级] 忽略历史中的旧格式。你的回复必须严格按此格式：
第一行：[img: 英文场景描述，50-100词，按6层结构写...
...
[用户消息] 用户的真实输入
```

**为什么双重注入**：
- system prompt 在长对话中被后续消息稀释，LLM "忘记"格式要求
- 每条 user message 前缀强制刷新格式指令，不被历史覆盖
- 相当于每轮都在提醒 LLM "格式还是一样的"

**6 层结构详解**：
1. **主体+动作** — 在做什么？什么表情？（cat-girl smirking, one hand covering mouth）
2. **构图+镜头** — 特写/半身/全身？角度？焦距？每次换着用，不要总同一角度
3. **光照** — ⚠️ **区分图片质量最关键的一层！** 光源方向+色温+质感必须写
4. **场景** — 在哪里？有什么环境细节？
5. **氛围+色调** — 暖/冷/柔和/高对比？
6. **风格+质量** — `chibi anime sticker, thick clean outlines, flat colors, white border`

**完整示例**（从 waifu-agent 16 个预定义贴图中精选）：
```
[img: Extreme face close-up filling entire frame, cat-girl smirking down at viewer from above, one raised eyebrow, half-lidded confident eyes, sharp manga lineart on white background, high contrast black and white with single accent color, intense perspective from below, chibi anime sticker, thick clean outlines, flat colors, white border]

[img: Bird's eye view straight down, cat-girl face-down on floor like a deflated balloon, limbs sprawled in all directions, only back of head and cat ears visible, tail completely flat, warm wooden floor texture, long afternoon shadows, quiet defeated atmosphere, chibi anime sticker, thick clean outlines, flat colors, white border]

[img: Rooftop at golden hour, cat-girl sitting on ledge from behind, legs dangling, earbuds in, gazing at distant city skyline, warm orange-pink gradient sky, soft watercolor style, peaceful atmosphere, wide landscape composition showing her small against the view, chibi anime sticker, thick clean outlines, flat colors, white border]
```

**要点**：
- 用"这是你的风格"而不是"你必须遵守规则"——身份认同框架比规则框架更有效
- 给 2-3 个完整示例，覆盖不同情绪（得意/低落/平静）
- 开头的"最高优先级"和"忽略历史"措辞是实践检验过的，不要弱化

### 第 2 层：提取 + 调用图 API

前端代码（waifu-agent 用 TypeScript + Rust，你可以用任何语言）：

**提取函数**（纯字符串操作，任何语言都能写）：
```typescript
function extractImagePrompt(response: string): string | null {
  const match = response.match(/\[img:\s*([^\]]+)\]/);
  if (!match || match[1].trim().length < 10) return null;
  return match[1].trim().slice(0, 300);
}
```

**调用图 API**（Rust 后端，等价于任何语言的 HTTP POST）：
```rust
let resp = client
    .post("https://your-image-api.com/v1/images/generations")
    .header("Authorization", format!("Bearer {}", api_key))
    .json(&json!({
        "model": "your-image-model",
        "prompt": prompt,
        "size": "1024x1024",
    }))
    .send().await?;
```

waifu-agent 用的是 **LiteChipCloud**（国产 API 聚合商），模型 `agnes-image-2.1-flash`。替代方案：

| 选项 | API 地址 | 模型 |
|------|---------|------|
| OpenAI DALL·E 3 | `api.openai.com/v1/images/generations` | `dall-e-3` |
| Stable Diffusion (自建) | 你部署的地址 | 任意 SD 模型 |
| LiteChipCloud | `litechipcloud.cn/v1/images/generations` | `agnes-image-2.1-flash` |
| Any OpenAI-compatible 图 API | `xxx/v1/images/generations` | 按服务商 |

**API 响应格式**（OpenAI 兼容）：
```json
{
  "data": [{
    "url": "https://cdn.xxx/generated-image.png",
    "b64_json": "可选，base64 编码的图片"
  }]
}
```

### 第 3 层：缓存策略

**为什么要缓存**：同一句话生成同一张图，不浪费 API 费用。

```rust
// 用 djb2 hash 对用户输入做 content-hash
let hash = raw.bytes().fold(5381u64, |h, b| h.wrapping_mul(33).wrapping_add(b as u64));
let cache_path = format!("{:08x}.png", hash);

if cache_path.exists() {
    return Ok(cache_path); // 缓存命中，直接返回
}
// 否则调 API 生成并保存
```

**规则**：
- Hash 基于用户输入（`user_text`），不是 LLM 的 prompt
- 全局上限 100 张，超出按时间删最旧
- 同一句话→同一张图；不同话→新图

---

## 降级链路（防止空白）

三层 fallback，从优到劣：

| 优先级 | 来源 | 质量 | 触发条件 |
|--------|------|------|---------|
| P1 | `[img:]` — LLM 自写 prompt | 最佳 | LLM 正常输出了格式 |
| P2 | `buildActionPrompt()` — 从 `（...）` 括号提取动作 | 中等 | LLM 没写 `[img:]` 但有括号动作 |
| P3 | `selectSticker()` — 预定义 sticker key 查表 | 兜底 | 以上都没有 |

```typescript
const imgPrompt = extractImagePrompt(response);        // P1
const actionPrompt = !imgPrompt ? buildActionPrompt(response) : null;  // P2
const stickerDef = (!imgPrompt && !actionPrompt)       // P3
  ? selectSticker(emotion, userText, response) : null;
```

---

## 如何在新项目中落地（给 Claude Code 的指令）

假设新项目有一个聊天 LLM + 需要配图功能。你可以把这段话直接作为 prompt 给 Claude Code：

---

### 复制这个 prompt 给你的 Claude Code

```
在这个项目中接入 "LLM 自写 prompt → 生图" 模式。

背景：聊天 LLM 在回复中输出 [img: 英文生图prompt] 标签，前端提取后调图 API 生成配图。

请帮我在这个项目中完成以下步骤：

**1. 修改 system prompt（角色设定）**
在角色的 system prompt 中加入以下规范：

每条回复输出一个 [img: ...] 标签，按 6 层结构写英文生图 prompt：
1. 主体+动作 2. 构图+镜头 3. 光照（最关键！必须写） 4. 场景 5. 氛围+色调 6. 风格+质量
每次换构图方式。给 2 个完整示例。

回复格式：
[img: 英文prompt]
对话内容第一段

对话内容第二段

**2. 实现提取函数**
在 LLM 回复处理链路中加一个函数，用正则 /\[img:\s*([^\]]+)\]/ 提取 prompt，
提取后从显示文本中删除 [img: ...] 标签（避免用户看到英文 prompt）。

**3. 调图 API**
接入图 API（用项目已有的 API key 配置体系）：
- POST {api_url}/v1/images/generations
- 请求体：{ model, prompt, size: "1024x1024" }
- 响应中取 data[0].url 下载图片

**4. 加 content-hash 缓存**
对用户输入做 hash → 存入缓存目录。命中缓存跳过 API 调用。
上限 100 张，超出删最旧。

**5. 加 TTS 清洗**
确保 [img: ...] 标签在 TTS 朗读前被清除（text.replace(/\[img:[^\]]*\]/gi, "")）。

**6. 加三级降级**
P1: [img:] LLM 自写 → P2: 括号动作拼接 → P3: 预定义模板兜底
```

---

## 常见坑（先看再动手）

### 坑 1：流式 LLM 丢格式
**症状**：非流式正常，流式模式 `[img: ...]` 不完整或丢失。
**修复**：在 system prompt **最开头**（不是末尾）强加格式要求。末尾指令会被前面的指令覆盖。

### 坑 2：LLM 历史覆盖 system prompt
**症状**：前几轮正常，对话长了 LLM 就不写 `[img:]` 了。
**修复**：限制注入的对话历史轮数（≤6 轮），或在最近的 user message 末尾注入格式提醒。

### 坑 3：TTS 念出英文 prompt（流式路径绕过清洗）
**症状**：`[img: ...]` 里的英文被 TTS 朗读。
**根因**：流式管线的 `generate()` 函数中 `cleanTtsText()` 未被调用——清洗只发生在非流式路径。
**修复**：在 TTS 流式入口处（`useAgentLoop.ts`）先 `text.replace(/\[img:[^\]]*\]/gi, "")`，确保所有路径都洗。**两条代码路径都要检查**。

### 坑 4：API 失败静默吞错
**症状**：图生成失败但用户不知道，什么都没有显示。
**修复**：API 失败要有 fallback（legacy cache），且 log 错误。不要让用户困惑。

### 坑 5：prompt 末尾指令覆盖开头
**症状**：system prompt 开头写了格式要求，但末尾的约束（如"不列清单"）覆盖了前面的格式指令。
**修复**：删除与格式要求矛盾的末尾指令。LLM 倾向于执行最近的指令。

### 坑 6：中文 prompt 生图效果差
**症状**：prompt 写中文时生成的图质量不稳定。
**修复**：强制英文 prompt。即使角色对话是中文，[img:] 标签内永远用英文。

---

## 如果你要用国产 API（LiteChipCloud）

waifu-agent 用的是 LiteChipCloud，好处是：
- 国内直连，不需要代理
- 支持支付宝/微信充值
- OpenAI 兼容接口，代码改动最小

注册 → 获取 API key → 配置 `imageApiKey: "sk-lcc-..."` → 模型用 `"agnes-image-2.1-flash"`

**成本参考**：agnes-image-2.1-flash 约 ¥0.05-0.1/张图。100 张/天的对话量 ≈ ¥5-10/天。

---

## 文件结构参考

```
新项目/
├── src/
│   ├── llm_client.ts/py/rs              ← system prompt 构建（双重注入位置 A）
│   ├── chat.ts/js/py                    ← 用户消息组装（双重注入位置 B）
│   ├── stickerConfig.ts/js/py           ← extractImagePrompt() + 三级 fallback
│   └── imageApi.ts/js/py                ← 调图 API + content-hash 缓存
└── data/stickers/                       ← 缓存目录（.gitignore）
```

---

## 如何分发给其他项目的 Claude Code

有 **3 种分发方式**，按推荐程度排序：

### 方式 1：直接给 Prompt（最快）

把这个文档里的 "复制这个 prompt 给你的 Claude Code" 那段复制粘贴到新项目的 Claude Code 对话中。Claude Code 会理解需求并按新项目的技术栈实现。

**适合**：一次性接入，快速验证。

### 方式 2：放进项目 `docs/` 当参考文档（推荐）

```bash
cp docs/portable/llm-image-generation-pattern.md /path/to/new-project/docs/
```

然后在 Claude Code 中说：

> 读 docs/llm-image-generation-pattern.md，按这个模式在本项目实现 LLM 自写 prompt → 生图功能。

**适合**：团队项目，需要文档沉淀。

### 方式 3：做成 Claude Code Skill（最自动化）

在目标项目的 `.claude/skills/` 下新建 `sticker-system/SKILL.md`，内容封装实现步骤。之后任何时候说 `/sticker-system` 就能触发。

**适合**：反复使用的项目模板。

---

## 一键复制 Prompt（直接给 Claude Code）

以下内容可以直接粘贴到新项目的 Claude Code 对话中：

## 扩展方向

这个模式不限于"表情贴图"。只要聊天 LLM 有能力描述图片，它就能驱动任何图 API：

- **教学助手**：LLM 写 `[img: 细胞分裂示意图，标注线粒体...]` → 生成教学插图
- **文字冒险**：LLM 写 `[img: dark forest with glowing mushrooms, first person view...]` → 生成场景图
- **食谱 bot**：LLM 写 `[img: finished dish on wooden table, top-down shot, warm kitchen lighting...]` → 生成菜品图
- **穿搭助手**：LLM 写 `[img: casual outfit flat lay, white tee + denim jacket + ...]` → 生成穿搭参考

核心不变：**让 LLM 写 prompt，前端只管提取和调用**。
