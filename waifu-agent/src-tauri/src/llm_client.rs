// llm_client.rs — OpenAI-compatible chat adapter
//
// 统一适配器接口：send(text, history) → response
// 支持任何 OpenAI 兼容 API（OpenAI / DeepSeek / Ollama / 等）
// v0.10.0: 新增 tool calling 支持

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

// ── Config ──────────────────────────────────────────

#[derive(Debug, Deserialize, Clone)]
pub struct AdapterConfig {
    pub api_url: String,
    pub api_key: String,
    pub model: String,
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
}

fn default_timeout() -> u64 { 30 }

// ── Provider registry ────────────────────────────────
/// 解析 provider → 实际的 api_url + model。
/// "minimax-relay" 的 URL/Model 硬编码在二进制中，前端不可见。
/// 其他 provider（含 "deepseek"）使用用户提供的 fallback 值。
pub fn resolve_provider(provider: &str, fallback_url: &str, fallback_model: &str) -> (String, String) {
    match provider {
        "minimax-relay" => (
            "https://litechipcloud.cn/v1/chat/completions".to_string(),
            "minimax-m3".to_string(),
        ),
        _ => (fallback_url.to_string(), fallback_model.to_string()),
    }
}

// ── Think tag filter ─────────────────────────────────
/// Streaming filter for `<think>...</think>` blocks.
/// Some models (MiniMax M3) output reasoning in `<think>` tags even when
/// thinking is disabled — this strips them from the stream in real time.
struct ThinkFilter {
    in_think: bool,
    pending: String,
}

impl ThinkFilter {
    fn new() -> Self { ThinkFilter { in_think: false, pending: String::new() } }

    /// Feed new text; returns clean text ready to emit (if any).
    fn feed(&mut self, text: &str) -> Option<String> {
        self.pending.push_str(text);
        let mut emit = String::new();

        loop {
            if !self.in_think {
                if let Some(pos) = self.pending.find("<think>") {
                    emit.push_str(&self.pending[..pos]);
                    self.pending = self.pending[pos + 7..].to_string();
                    self.in_think = true;
                } else {
                    let safe = self.safe_len("<think>");
                    if safe > 0 { emit.push_str(&self.pending[..safe]); }
                    self.pending = self.pending[safe..].to_string();
                    break;
                }
            } else {
                if let Some(pos) = self.pending.find("</think>") {
                    self.pending = self.pending[pos + 8..].to_string();
                    self.in_think = false;
                } else {
                    let safe = self.safe_len("</think>");
                    self.pending = self.pending[safe..].to_string();
                    break;
                }
            }
        }

        if emit.is_empty() { None } else { Some(emit) }
    }

    /// Flush remaining safe text (not inside a partial tag).
    fn flush(&mut self) -> Option<String> {
        if self.in_think { self.pending.clear(); return None; }
        if self.pending.is_empty() { return None; }
        let r = self.pending.clone();
        self.pending.clear();
        Some(r)
    }

    /// Longest prefix of `pending` that can't be a partial start of `tag`.
    fn safe_len(&self, tag: &str) -> usize {
        for len in (1..tag.len()).rev() {
            if len <= self.pending.len() && self.pending.ends_with(&tag[..len]) {
                return self.pending.len() - len;
            }
        }
        self.pending.len()
    }
}

// ── Message types ───────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Message {
    pub role: String,       // "user" | "assistant" | "system" | "tool"
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// Legacy helper: create a simple text message
impl Message {
    pub fn text(role: &str, content: &str) -> Self {
        Message {
            role: role.to_string(),
            content: Some(content.to_string()),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }
}

// ── Tool types ──────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ToolDef {
    #[serde(rename = "type")]
    pub tool_type: String,  // always "function"
    pub function: FunctionDef,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FunctionDef {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,  // JSON Schema
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,  // "function"
    pub function: ToolCallFunction,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ToolCallFunction {
    pub name: String,
    pub arguments: String,  // JSON string
}

// ── Request / Response ──────────────────────────────

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<Message>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<ToolDef>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<serde_json::Value>,
    /// 显式关闭 DeepSeek thinking mode，避免干扰 tool calling
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<ThinkingControl>,
}

#[derive(Debug, Serialize)]
struct ThinkingControl {
    #[serde(rename = "type")]
    thinking_type: String,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: ChoiceMessage,
}

#[derive(Debug, Deserialize)]
struct ChoiceMessage {
    content: Option<String>,
}

// ── Helpers ─────────────────────────────────────────

fn read_soul_file(app: &tauri::AppHandle, preset: &str) -> Option<String> {
    // 1. app_data_dir/souls/{preset}.md — user override
    if let Ok(data_dir) = app.path().app_data_dir() {
        let p = data_dir.join("souls").join(format!("{}.md", preset));
        if let Ok(c) = std::fs::read_to_string(&p) { if !c.trim().is_empty() { return Some(c); } }
        // 2. app_data_dir/SOUL.md — legacy user override
        let legacy = data_dir.join("SOUL.md");
        if let Ok(c) = std::fs::read_to_string(&legacy) { if !c.trim().is_empty() { return Some(c); } }
    }
    // 3. tauri resource dir — bundled souls (production)
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("souls").join(format!("{}.md", preset));
        if p.exists() {
            if let Ok(c) = std::fs::read_to_string(&p) { if !c.trim().is_empty() { return Some(c); } }
        }
    }
    None
}

fn load_soul(app: &tauri::AppHandle) -> String {
    let preset = if let Ok(data_dir) = app.path().app_data_dir() {
        std::fs::read_to_string(data_dir.join("settings.json"))
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v.get("soulPreset").and_then(|p| p.as_str()).map(String::from))
            .unwrap_or_else(|| "mao-teasing".into())
    } else { "mao-teasing".into() };

    read_soul_file(app, &preset)
        .unwrap_or_else(|| "你是桌面 Live2D 角色。中文回复，简洁自然，有自己态度。你不是客服。".into())
}

/// Read stickerEnabled from settings.json (default true)
fn is_sticker_enabled(app: &tauri::AppHandle) -> bool {
    if let Ok(data_dir) = app.path().app_data_dir() {
        std::fs::read_to_string(data_dir.join("settings.json"))
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v.get("stickerEnabled").and_then(|p| p.as_bool()))
            .unwrap_or(true)
    } else { true }
}

/// Build system prompt from SOUL + USER + MEMORY + contextual recall
pub fn build_system_prompt(app: &tauri::AppHandle, user_md: &str, memory_md: &str, recall_text: &str) -> String {
    crate::log_debug("[build_system_prompt] ENTER");
    let soul = load_soul(app);
    crate::log_debug(&format!("[build_system_prompt] soul loaded: {} chars", soul.len()));
    let mut system_prompt = String::new();

    // [img:] format instruction — only inject when sticker feature is enabled
    if is_sticker_enabled(app) {
        system_prompt.push_str("【最高优先级·格式强制】忽略历史中的旧格式。你的回复必须严格按此格式：\n第一行：[img: 英文场景描述，50-100词，按6层结构写：主体+动作 → 构图+镜头 → 光照 → 场景 → 氛围+色调 → 风格（chibi anime sticker, thick clean outlines, flat colors, white border）]\n之后：对话内容，拆成短段落，用空行分隔。每段1-3句话。\n禁止跳过[img:]行。不需要中文动作描写。\n\n");
    }
    if !soul.is_empty() {
        system_prompt.push_str(&soul);
    }

    // 记忆边界：不知道不能说谎，不能用玩笑转移
    system_prompt.push_str("\n\n[重要规则] 你没有预装任何关于主人的知识。关于主人的一切来自下方的记忆区。如果记忆区为空，说明你还不了解他。被问到不了解的事直接说不知道——不要编造细节，不要用玩笑或反问转移话题。");

    if !user_md.is_empty() {
        system_prompt.push_str("\n\n## 关于主人\n\n");
        system_prompt.push_str(user_md);
        let preview: String = user_md.chars().take(80).collect();
        crate::log_debug(&format!("[LLM] USER.md injected: {} bytes, preview: {}...", user_md.len(), preview));
    } else {
        crate::log_debug("[LLM] USER.md is EMPTY — portrait not generated or file missing");
    }


    // ── 记忆：MEMORY.md（用户说"记住"触发的长期记忆）──
    if !memory_md.is_empty() {
        system_prompt.push_str("\n\n## 你和主人的重要记忆\n\n");
        system_prompt.push_str(memory_md);
    }


    // ── 上下文召回：与当前话题相关的记忆 ──
    if !recall_text.is_empty() {
        system_prompt.push_str("\n\n## 相关记忆\n\n");
        system_prompt.push_str(recall_text);
    }

    if system_prompt.is_empty() {
        system_prompt = "你是桌面角色，中文回复，简洁自然，≤150字。".to_string();
    }

    // 工具使用说明
    let today = chrono::Local::now().format("%Y年%m月%d日 北京时间 (UTC+8)").to_string();
    system_prompt.push_str(&format!(
        "\n\n## 可用工具\n现在是{}。搜索返回的时间可能是其他时区（UTC/ET/PT），回答时必须换算成北京时间。\n\
         工具调用规则：涉及实时事件（天气/台风/比赛/新闻/股价等）、需要核对事实的问题，必须先调 web_search。凡工具箱里有工具能查的，绝不用训练数据猜。\n\
         - web_search：搜索网页获取实时信息。返回 5 条摘要。如果结果只有门户首页（BBC/VOA/WSJ/新华网等）、导航页、搜索列表页，说明没拿到具体内容——不要根据链接标题猜测细节，告诉用户「搜到的是首页，没有具体信息」。搜不到就说搜不到，**绝对禁止**编造任何事实。\n\
         - fetch_page：**搜索后必调**。至少挑一条最相关的链接打开抓取完整正文。摘要不是答案——标题和一句话描述不够，正文里的细节才是用户要的。搜索返回的结果列表不等于信息收集完毕。\n\
         - read_clipboard：读系统剪贴板，仅在用户明确要求时使用\n\
         - system_info：获取操作系统、CPU、主机名\n\
         - analyze_screen：截取并分析当前屏幕内容。当用户提到'看看屏幕''帮我看看这段''看一下'等指代屏幕上可见内容时调用。返回屏幕内容的文字描述。", today));

    // ── 回复风格：简洁，不啰嗦 ──
    system_prompt.push_str("\n\n## 回复风格\n说短话是你的风格。对话只保留核心意思，不绕弯不啰嗦。");

    let final_prompt: String = system_prompt.chars().take(10000).collect();

    // Dump full prompt to disk for debugging
    if let Ok(data_dir) = app.path().app_data_dir() {
        let _ = std::fs::write(data_dir.join("last_prompt.txt"), &final_prompt);
    }

    final_prompt
}

fn build_messages(
    system_prompt: &str,
    message: &str,
    history: &[(String, String)],
) -> Vec<Message> {
    let mut messages: Vec<Message> = vec![Message::text("system", system_prompt)];
    for (role, content) in history {
        messages.push(Message::text(role, content));
    }
    messages.push(Message::text("user", message));
    messages
}

// ── Chat (non-streaming, kept for backward compat) ──

pub async fn chat(
    app: &tauri::AppHandle,
    config: &AdapterConfig,
    message: &str,
    history: &[(String, String)],
    user_md: &str,
    memory_md: &str,
    recall_text: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let system_prompt = build_system_prompt(app, user_md, memory_md, recall_text);
    let messages = build_messages(&system_prompt, message, history);

    let request = ChatRequest {
        model: config.model.clone(),
        messages,
        stream: false,
        tools: None,
        tool_choice: None,
        thinking: Some(ThinkingControl { thinking_type: "disabled".into() }),
    };

    let response = client
        .post(&config.api_url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .json(&request)
        .timeout(std::time::Duration::from_secs(config.timeout_secs))
        .send()
        .await
        .map_err(|e| format!("HTTP error: {}", e))?;

    let status = response.status();
    let body = response.text().await.map_err(|e| format!("read body: {}", e))?;

    if !status.is_success() {
        return Err(format!("API {}: {}", status, body));
    }

    let chat_response: ChatResponse =
        serde_json::from_str(&body).map_err(|e| format!("parse: {}", e))?;

    chat_response
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
        .ok_or("no response".into())
}

// ── Tool call accumulator ───────────────────────────

/// Accumulate streaming tool_call deltas into complete ToolCall objects
struct ToolCallAccumulator {
    calls: Vec<ToolCallAccum>,
}

struct ToolCallAccum {
    id: String,
    name: String,
    arguments: String,
}

impl ToolCallAccumulator {
    fn new() -> Self {
        ToolCallAccumulator { calls: vec![] }
    }

    fn apply_delta(&mut self, index: usize, id: Option<&str>, name: Option<&str>, arguments: Option<&str>) {
        while self.calls.len() <= index {
            self.calls.push(ToolCallAccum {
                id: String::new(),
                name: String::new(),
                arguments: String::new(),
            });
        }
        let acc = &mut self.calls[index];
        if let Some(id) = id { acc.id = id.to_string(); }
        if let Some(name) = name { acc.name = name.to_string(); }
        if let Some(args) = arguments { acc.arguments.push_str(args); }
    }

    fn into_tool_calls(self) -> Vec<ToolCall> {
        self.calls.into_iter().map(|acc| ToolCall {
            id: acc.id,
            call_type: "function".to_string(),
            function: ToolCallFunction {
                name: acc.name,
                arguments: acc.arguments,
            },
        }).collect()
    }
}

/// Resolve tool_choice: use forced value from frontend if provided, else "auto"
fn resolve_tool_choice(has_tools: bool, forced_json: Option<&str>) -> Option<serde_json::Value> {
    if !has_tools { return None; }
    match forced_json {
        Some(json) => {
            // Handle string literals: "none", "auto", "required"
            match json {
                "none" => Some(serde_json::json!("none")),
                "auto" => Some(serde_json::json!("auto")),
                "required" => Some(serde_json::json!("required")),
                _ => match serde_json::from_str::<serde_json::Value>(json) {
                    Ok(v) => Some(v),
                    Err(_) => Some(serde_json::json!("auto")),
                },
            }
        }
        None => Some(serde_json::json!("auto")),
    }
}

// ── Chat streaming ──────────────────────────────────

/// Stream LLM response via Tauri events.
/// Emits:
///   "chat-chunk" { content: String }       — each text delta from the model
///   "chat-tool-call" { tool_calls: [...] }  — tool calls requested by model
///   "chat-done"  {}                         — stream completed successfully
///   "chat-error" { error: String }          — stream failed
///
/// When `tools_json` is provided, the model may respond with tool calls
/// instead of text. Tool calls are accumulated and emitted as "chat-tool-call"
/// followed by "chat-done".
pub async fn chat_stream(
    config: &AdapterConfig,
    message: &str,
    history: &[(String, String)],
    user_md: &str,
    memory_md: &str,
    recall_text: &str,
    tools_json: Option<&str>,
    tool_choice_json: Option<&str>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    crate::log_debug("[chat_stream] ENTER — about to build system prompt");
    let client = reqwest::Client::new();
    let system_prompt = build_system_prompt(&app, user_md, memory_md, recall_text);
    crate::log_debug(&format!("[chat_stream] system prompt built: {} chars", system_prompt.len()));
    crate::log_debug(&format!("[chat_stream] prompt_head: {}", system_prompt.chars().take(500).collect::<String>()));
    let messages = build_messages(&system_prompt, message, history);
    let has_tools = tools_json.is_some();

    let prompt_chars: usize = messages.iter().map(|m| m.content.as_deref().unwrap_or("").chars().count()).sum();
    let est_tokens = (prompt_chars as f64 / 2.0) as usize;

    let tools: Option<Vec<ToolDef>> = match tools_json {
        Some(json) => {
            match serde_json::from_str(json) {
                Ok(t) => Some(t),
                Err(e) => {
                    crate::log_debug(&format!("[chat_stream] parse tools_json failed: {}", e));
                    None
                }
            }
        }
        None => None,
    };

    let request = ChatRequest {
        model: config.model.clone(),
        messages,
        stream: true,
        tools,
        tool_choice: resolve_tool_choice(has_tools, tool_choice_json),
        thinking: Some(ThinkingControl { thinking_type: "disabled".into() }),
    };

    let t0 = std::time::Instant::now();
    crate::log_debug(&format!("[chat_stream] POST {} model={} turns={} est_tokens≈{}K msg_len={} has_tools={}",
        config.api_url, config.model, history.len() / 2, est_tokens / 1000, message.len(), has_tools));

    let mut response = client
        .post(&config.api_url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .json(&request)
        .timeout(std::time::Duration::from_secs(config.timeout_secs))
        .send()
        .await;
    // 首次请求偶发连接失败（TLS 初始化 / 子进程干扰），重试一次
    if response.is_err() {
        crate::log_debug("[chat_stream] first attempt failed, retrying in 500ms...");
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let client2 = reqwest::Client::new();
        response = client2
            .post(&config.api_url)
            .header("Authorization", format!("Bearer {}", config.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .timeout(std::time::Duration::from_secs(config.timeout_secs))
            .send()
            .await;
    }
    let response = response.map_err(|e| {
            let err = format!("HTTP error: {}", e);
            crate::log_debug(&format!("[chat_stream] HTTP ERROR: {}", err));
            let _ = app.emit("chat-error", serde_json::json!({ "error": &err }));
            err
        })?;

    crate::log_debug(&format!("[chat_stream] response {} in {:?}", response.status(), t0.elapsed()));

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let err = format!("API {}: {}", status, body);
        crate::log_debug(&format!("[chat_stream] HTTP ERROR: {}", err));
        let _ = app.emit("chat-error", serde_json::json!({ "error": &err }));
        return Err(err);
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut chunk_count: u32 = 0;
    let mut raw_response = String::new();
    let mut tool_call_acc = ToolCallAccumulator::new();
    let mut has_tool_calls = false;
    let mut think_filter = ThinkFilter::new();
    let chunk_timeout = std::time::Duration::from_secs(config.timeout_secs.max(10));

    loop {
        let chunk_result = match tokio::time::timeout(chunk_timeout, stream.next()).await {
            Ok(Some(result)) => result,
            Ok(None) => break,
            Err(_elapsed) => {
                let err = format!("流超时: {}s 内未收到数据", chunk_timeout.as_secs());
                crate::log_debug(&format!("[chat_stream] TIMEOUT: {} after {} chunks", err, chunk_count));
                let _ = app.emit("chat-error", serde_json::json!({ "error": &err }));
                return Err(err);
            }
        };
        match chunk_result {
            Ok(chunk) => {
                let text = String::from_utf8_lossy(&chunk);
                buffer.push_str(&text);

                while let Some(line_end) = buffer.find('\n') {
                    let line = buffer[..line_end].trim().to_string();
                    buffer = buffer[line_end + 1..].to_string();

                    if line.is_empty() {
                        continue;
                    }

                    if let Some(data) = line.strip_prefix("data: ") {
                        if data == "[DONE]" {
                            let has_img = raw_response.contains("[img:");
                            // Dump full raw response for debugging
                            let preview: String = raw_response.chars().take(600).collect();
                            crate::log_debug(&format!("[chat_stream] RAW_RESPONSE: {}", preview));
                            crate::log_debug(&format!("[chat_stream] DONE: {} chunks, has_img_tag={}, response_len={}, has_tool_calls={} in {:?}",
                                chunk_count, has_img, raw_response.len(), has_tool_calls, t0.elapsed()));

                            // Emit accumulated tool calls before done
                            if has_tool_calls {
                                let calls = tool_call_acc.into_tool_calls();
                                let _ = app.emit("chat-tool-call", serde_json::json!({
                                    "tool_calls": calls,
                                }));
                            }
                            // Flush remaining clean text before done
                            if let Some(clean) = think_filter.flush() {
                                let _ = app.emit("chat-chunk", serde_json::json!({ "content": clean }));
                            }
                            let _ = app.emit("chat-done", serde_json::json!({}));
                            return Ok(());
                        }

                        match serde_json::from_str::<serde_json::Value>(data) {
                            Ok(v) => {
                                let delta = &v["choices"][0]["delta"];

                                // ── Text content delta ──
                                if let Some(content) = delta["content"].as_str() {
                                    if !content.is_empty() {
                                        chunk_count += 1;
                                        raw_response.push_str(content);
                                        if chunk_count == 1 {
                                            crate::log_debug(&format!("[chat_stream] first chunk in {:?}", t0.elapsed()));
                                        }
                                        // Filter <think> blocks before emitting
                                        if let Some(clean) = think_filter.feed(content) {
                                            let _ = app.emit("chat-chunk", serde_json::json!({ "content": clean }));
                                        }
                                    }
                                }

                                // ── Tool calls delta ──
                                if let Some(tool_calls) = delta["tool_calls"].as_array() {
                                    has_tool_calls = true;
                                    for tc in tool_calls {
                                        let index = tc["index"].as_u64().unwrap_or(0) as usize;
                                        let id = tc["id"].as_str();
                                        let name = tc["function"]["name"].as_str();
                                        let arguments = tc["function"]["arguments"].as_str();
                                        tool_call_acc.apply_delta(index, id, name, arguments);
                                    }
                                }
                            }
                            Err(_) => {
                                // Skip unparseable lines
                            }
                        }
                    }
                }
            }
            Err(e) => {
                let err = format!("stream error: {}", e);
                crate::log_debug(&format!("[chat_stream] stream ERROR: {}", err));
                let _ = app.emit("chat-error", serde_json::json!({ "error": &err }));
                return Err(err);
            }
        }
    }

    // Stream ended without [DONE]
    if has_tool_calls {
        let calls = tool_call_acc.into_tool_calls();
        let _ = app.emit("chat-tool-call", serde_json::json!({
            "tool_calls": calls,
        }));
    }
    // Flush remaining clean text before done
    if let Some(clean) = think_filter.flush() {
        let _ = app.emit("chat-chunk", serde_json::json!({ "content": clean }));
    }
    let _ = app.emit("chat-done", serde_json::json!({}));
    Ok(())
}

/// Stream with pre-built messages (for agent loop continuation).
/// Unlike `chat_stream`, this does NOT build the system prompt or append
/// user/assistant messages — it uses the provided messages as-is.
pub async fn chat_stream_with_messages(
    config: &AdapterConfig,
    messages: Vec<Message>,
    tools_json: Option<&str>,
    tool_choice_json: Option<&str>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    crate::log_debug("[chat_stream_with_messages] ENTER");
    let client = reqwest::Client::new();
    let has_tools = tools_json.is_some();

    let prompt_chars: usize = messages.iter()
        .map(|m| m.content.as_deref().unwrap_or("").chars().count())
        .sum();
    let est_tokens = (prompt_chars as f64 / 2.0) as usize;

    let tools: Option<Vec<ToolDef>> = match tools_json {
        Some(json) => match serde_json::from_str(json) {
            Ok(t) => Some(t),
            Err(e) => {
                crate::log_debug(&format!("[chat_stream_with_messages] parse tools_json failed: {}", e));
                None
            }
        },
        None => None,
    };

    let request = ChatRequest {
        model: config.model.clone(),
        messages,
        stream: true,
        tools,
        tool_choice: resolve_tool_choice(has_tools, tool_choice_json),
        thinking: Some(ThinkingControl { thinking_type: "disabled".into() }),
    };

    let t0 = std::time::Instant::now();
    crate::log_debug(&format!("[chat_stream_with_messages] POST {} model={} est_tokens≈{}K has_tools={}",
        config.api_url, config.model, est_tokens / 1000, has_tools));

    let mut response = client
        .post(&config.api_url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .json(&request)
        .timeout(std::time::Duration::from_secs(config.timeout_secs))
        .send()
        .await;
    if response.is_err() {
        crate::log_debug("[chat_stream_with_messages] first attempt failed, retrying in 500ms...");
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let client2 = reqwest::Client::new();
        response = client2
            .post(&config.api_url)
            .header("Authorization", format!("Bearer {}", config.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .timeout(std::time::Duration::from_secs(config.timeout_secs))
            .send()
            .await;
    }
    let response = response.map_err(|e| {
            let err = format!("HTTP error: {}", e);
            crate::log_debug(&format!("[chat_stream_with_messages] HTTP ERROR: {}", err));
            let _ = app.emit("chat-error", serde_json::json!({ "error": &err }));
            err
        })?;

    crate::log_debug(&format!("[chat_stream_with_messages] response {} in {:?}", response.status(), t0.elapsed()));

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let err = format!("API {}: {}", status, body);
        crate::log_debug(&format!("[chat_stream_with_messages] HTTP ERROR: {}", err));
        let _ = app.emit("chat-error", serde_json::json!({ "error": &err }));
        return Err(err);
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut chunk_count: u32 = 0;
    let mut tool_call_acc = ToolCallAccumulator::new();
    let mut has_tool_calls = false;
    let mut think_filter = ThinkFilter::new();
    let chunk_timeout = std::time::Duration::from_secs(config.timeout_secs.max(10));

    loop {
        let chunk_result = match tokio::time::timeout(chunk_timeout, stream.next()).await {
            Ok(Some(result)) => result,
            Ok(None) => break,
            Err(_elapsed) => {
                let err = format!("流超时: {}s 内未收到数据", chunk_timeout.as_secs());
                crate::log_debug(&format!("[chat_stream_with_messages] TIMEOUT: {} after {} chunks", err, chunk_count));
                let _ = app.emit("chat-error", serde_json::json!({ "error": &err }));
                return Err(err);
            }
        };
        match chunk_result {
            Ok(chunk) => {
                let text = String::from_utf8_lossy(&chunk);
                buffer.push_str(&text);

                while let Some(line_end) = buffer.find('\n') {
                    let line = buffer[..line_end].trim().to_string();
                    buffer = buffer[line_end + 1..].to_string();

                    if line.is_empty() { continue; }

                    if let Some(data) = line.strip_prefix("data: ") {
                        if data == "[DONE]" {
                            crate::log_debug(&format!("[chat_stream_with_messages] DONE: {} chunks, has_tool_calls={} in {:?}",
                                chunk_count, has_tool_calls, t0.elapsed()));

                            if has_tool_calls {
                                let calls = tool_call_acc.into_tool_calls();
                                let _ = app.emit("chat-tool-call", serde_json::json!({
                                    "tool_calls": calls,
                                }));
                            }
                            // Flush remaining clean text before done
                            if let Some(clean) = think_filter.flush() {
                                let _ = app.emit("chat-chunk", serde_json::json!({ "content": clean }));
                            }
                            let _ = app.emit("chat-done", serde_json::json!({}));
                            return Ok(());
                        }

                        match serde_json::from_str::<serde_json::Value>(data) {
                            Ok(v) => {
                                let delta = &v["choices"][0]["delta"];

                                if let Some(content) = delta["content"].as_str() {
                                    if !content.is_empty() {
                                        chunk_count += 1;
                                        if chunk_count == 1 {
                                            crate::log_debug(&format!("[chat_stream_with_messages] first chunk in {:?}", t0.elapsed()));
                                        }
                                        if let Some(clean) = think_filter.feed(content) {
                                            let _ = app.emit("chat-chunk", serde_json::json!({ "content": clean }));
                                        }
                                    }
                                }

                                if let Some(tool_calls) = delta["tool_calls"].as_array() {
                                    has_tool_calls = true;
                                    for tc in tool_calls {
                                        let index = tc["index"].as_u64().unwrap_or(0) as usize;
                                        let id = tc["id"].as_str();
                                        let name = tc["function"]["name"].as_str();
                                        let arguments = tc["function"]["arguments"].as_str();
                                        tool_call_acc.apply_delta(index, id, name, arguments);
                                    }
                                }
                            }
                            Err(_) => {}
                        }
                    }
                }
            }
            Err(e) => {
                let err = format!("stream error: {}", e);
                crate::log_debug(&format!("[chat_stream_with_messages] stream ERROR: {}", err));
                let _ = app.emit("chat-error", serde_json::json!({ "error": &err }));
                return Err(err);
            }
        }
    }

    if has_tool_calls {
        let calls = tool_call_acc.into_tool_calls();
        let _ = app.emit("chat-tool-call", serde_json::json!({
            "tool_calls": calls,
        }));
    }
    // Flush remaining clean text before done
    if let Some(clean) = think_filter.flush() {
        let _ = app.emit("chat-chunk", serde_json::json!({ "content": clean }));
    }
    let _ = app.emit("chat-done", serde_json::json!({}));
    Ok(())
}

// ── Vision analysis ─────────────────────────────────
/// Send a screenshot to MiniMax M3 for vision analysis via OpenAI-compatible format.
pub async fn screen_vision_analyze(
    image_base64: &str,
    prompt: &str,
    config: &AdapterConfig,
) -> Result<String, String> {
    let client = reqwest::Client::new();

    let content = serde_json::json!([
        {"type": "text", "text": prompt},
        {"type": "image_url", "image_url": {"url": format!("data:image/jpeg;base64,{}", image_base64)}}
    ]);

    let body = serde_json::json!({
        "model": config.model,
        "messages": [{"role": "user", "content": content}],
        "max_tokens": 300,
        "thinking": {"type": "disabled"}
    });

    let resp = client.post(&config.api_url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("vision HTTP: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("vision API {}: {}", status, text));
    }

    let v: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("vision parse: {} — {}", e, &text[..200.min(text.len())]))?;

    Ok(v["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("(no response)")
        .to_string())
}

