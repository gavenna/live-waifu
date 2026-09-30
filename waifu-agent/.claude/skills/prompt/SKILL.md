# /prompt — Prompt & LLM 调优

LLM 提示词、模型配置、对话质量相关。你说"调 prompt"/"对话质量"/"模型参数"时触发。

## 核心文件

- `SOUL.md` — 角色系统提示（最大影响因子）
- `USER.md` — 用户信息注入
- `llm_config.json` — API key / model / timeout
- `src-tauri/src/llm_client.rs` — LLM 客户端实现
- `src/config/stickerConfig.ts` — 贴图选择 prompt

## 铁律

### 禁止贴膏药
AI 回复出问题 → 先找根因，不加 prompt 护栏掩盖：
- AI 猜错 → 给搜索能力，不是加"你没有联网能力"
- TTS 念 tag → 修 `clean_tts_text`，不是加"别输出标签"
- 上下文泄漏 → 修工具权限，不是加"你不懂代码"

### 新增语法标记 → grep 全管线
```
grep -rn "cleanTts\|clean_tts\|stripTag" src/ src-tauri/
```
Rust + TS 双端实现必须同步更新。

### 改 prompt 必须可复现
用固定输入验证前后差异，不凭感觉说"应该更好了"。

### emit 只发事件，listener 统一持久化
不要 emit 后又自己 save。

## 常用操作

- 改 SOUL.md 角色设定 → 验证对话风格变化
- 换模型 → 改 `llm_config.json` 的 model 字段
- 调 API 参数 → 改 `llm_client.rs` 的 temperature/top_p
- 调贴图 prompt → 改 `stickerConfig.ts` 后清缓存
