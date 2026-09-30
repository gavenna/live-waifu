use std::io::{Cursor, Write};
use std::os::windows::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tokio::time::{timeout, Duration};
use serde::Deserialize;
use tauri::Manager;
use base64::Engine;
use image::ImageEncoder;

mod auth;
mod llm_client;
mod memory_bridge;
mod stt;
mod tts_daemon;
mod ws_relay;

/// Resolve Python from bundled resources, falling back to system PATH
fn bundled_python(app: &tauri::AppHandle) -> String {
    // Try bundled python-embed first
    if let Ok(dir) = app.path().resource_dir() {
        let bundled = dir.join("python-embed").join("python.exe");
        if bundled.exists() {
            log_debug(&format!("using bundled python: {}", bundled.display()));
            return bundled.to_string_lossy().to_string();
        }
    }
    // Fall back to env var or system python
    python_cmd()
}

/// Cross-platform Python command: checks WAIFU_PYTHON env var, then "python3", then "python"
fn python_cmd() -> String {
    std::env::var("WAIFU_PYTHON")
        .or_else(|_| std::env::var("WAIFU_HERMES_PYTHON"))
        .unwrap_or_else(|_| {
            // On Windows, python3 is usually just "python"
            if cfg!(target_os = "windows") { "python".into() } else { "python3".into() }
        })
}

static APP_LOG_PATH: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();

/// 热点新闻缓存：格式 "1. 标题\n2. 标题..."
static TRENDING_CACHE: std::sync::RwLock<String> = std::sync::RwLock::new(String::new());

fn cached_trending() -> String {
    TRENDING_CACHE.read().ok().map(|g| g.clone()).unwrap_or_default()
}

/// 异步抓取知乎热榜 Top N，返回格式化的标题列表
async fn fetch_trending(top_n: usize) -> Option<String> {
    let url = "https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=10";
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .build().ok()?;
    let resp = client.get(url).timeout(std::time::Duration::from_secs(8)).send().await.ok()?;
    let json: serde_json::Value = resp.json().await.ok()?;
    let data = json["data"].as_array()?;
    let items: Vec<String> = data.iter()
        .take(top_n)
        .filter_map(|item| {
            let title = item["target"]["title"].as_str().unwrap_or("");
            if title.is_empty() { None }
            else { Some(title.to_string()) }
        })
        .collect();
    if items.is_empty() { return None; }
    Some(items.iter().enumerate().map(|(i, t)| format!("{}. {}", i + 1, t)).collect::<Vec<_>>().join("\n"))
}

/// 后台任务：定期刷新热点
async fn trending_refresh_loop() {
    loop {
        match fetch_trending(5).await {
            Some(text) => {
                if let Ok(mut cache) = TRENDING_CACHE.write() {
                    *cache = text;
                }
                log_debug("[trending] refreshed");
            }
            None => log_debug("[trending] fetch returned empty"),
        }
        tokio::time::sleep(std::time::Duration::from_secs(7200)).await; // 2h
    }
}

static LOG_ENABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

pub(crate) fn log_debug(msg: &str) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap_or_default()
        .as_secs_f64();
    let line = format!("[{:.3}] {}", ts, msg);

    // stderr only in debug mode (console noise)
    if LOG_ENABLED.load(std::sync::atomic::Ordering::Relaxed) {
        eprintln!("{}", line);
    }

    // Log file always written — even in USER mode, for debugging
    if let Some(p) = APP_LOG_PATH.get() {
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
            let _ = writeln!(f, "{}", line);
        }
    }
    // Also write to temp as backup
    let tmp = std::env::temp_dir().join("waifu-agent.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&tmp) {
        let _ = writeln!(f, "{}", line);
    }
}

#[tauri::command]
fn set_log_enabled(enabled: bool) { LOG_ENABLED.store(enabled, std::sync::atomic::Ordering::Relaxed); }

static CURRENT_TTS: Mutex<Option<Child>> = Mutex::new(None);

/// Analyze audio file and return RMS energy per 100ms window (normalized 0~1)
fn analyze_audio_energy(path: &str) -> Vec<f32> {
    let start = std::time::Instant::now();
    let output = match Command::new("ffmpeg")
        .creation_flags(0x08000000)
        .args(["-i", path, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
    {
        Ok(o) => o,
        Err(e) => { log_debug(&format!("energy analyze ffmpeg failed: {}", e)); return vec![]; }
    };

    let raw = output.stdout;
    if raw.len() < 2 { return vec![]; }

    let window_samples = 800; // 100ms at 8000Hz
    let mut energy = Vec::new();
    let mut i = 0;

    while i + 1 < raw.len() {
        let mut sum_sq = 0.0f64;
        let mut count = 0usize;
        let end = (i + window_samples * 2).min(raw.len());
        while i + 1 < end {
            let sample = i16::from_le_bytes([raw[i], raw[i + 1]]);
            sum_sq += (sample as f64 / 32768.0).powi(2);
            count += 1;
            i += 2;
        }
        if count > 0 {
            energy.push((sum_sq / count as f64).sqrt() as f32);
        }
    }

    // Normalize to 0~1
    let max = energy.iter().cloned().fold(0.0f32, f32::max);
    if max > 0.0 {
        for e in energy.iter_mut() {
            *e = (*e / max).min(1.0);
        }
    }

    log_debug(&format!("energy analyze: {} windows in {:?}", energy.len(), start.elapsed()));
    energy
}

#[derive(serde::Serialize)]
pub struct TtsResult {
    pub ok: bool,
    /// RMS energy per 100ms window, normalized 0~1
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub energy: Vec<f32>,
    /// Error message if any
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn stop_current_tts() {
    log_debug("stop_current_tts called");
    if let Ok(mut guard) = CURRENT_TTS.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
            log_debug("ffplay process killed");
        } else {
            log_debug("no ffplay process to kill");
        }
    }
}

#[tauri::command]
fn start_dragging_window(window: tauri::Window) {
    let _ = window.start_dragging();
}

#[tauri::command]
fn play_tts_audio(audio_base64: String, volume: u32) -> Result<TtsResult, String> {
    log_debug(&format!("play_tts_audio called, volume={}", volume));
    stop_current_tts();
    use base64::Engine;
    let engine = base64::engine::general_purpose::STANDARD;
    let audio_bytes = match engine.decode(&audio_base64) {
        Ok(b) => { log_debug(&format!("base64 decode OK: {} bytes", b.len())); b }
        Err(e) => {
            log_debug(&format!("base64 DECODE FAILED: {}", e));
            return Ok(TtsResult { ok: false, energy: vec![], error: Some(format!("base64 decode failed: {}", e)) });
        }
    };
    let tmp_path = std::env::temp_dir().join(format!("waifu-tts-{}.wav", std::process::id()));
    let tmp_path = tmp_path.to_str().unwrap_or("waifu-tts.wav").to_string();
    {
        let mut f = std::fs::File::create(&tmp_path).map_err(|e| format!("temp file create: {}", e))?;
        f.write_all(&audio_bytes).map_err(|e| format!("temp file write: {}", e))?;
    }
    log_debug(&format!("WAV file written: {} ({} bytes)", tmp_path, audio_bytes.len()));
    let vol_str = volume.to_string();
    let child = match Command::new("ffplay")
        .creation_flags(0x08000000)
        .args(["-nodisp", "-autoexit", "-loglevel", "quiet", "-volume", &vol_str, &tmp_path])
        .stdout(Stdio::null()).stderr(Stdio::null())
        .spawn()
    {
        Ok(c) => { log_debug("ffplay spawned OK"); c }
        Err(e) => {
            log_debug(&format!("ffplay SPAWN FAILED: {}", e));
            return Ok(TtsResult { ok: false, energy: vec![], error: Some(format!("ffplay spawn failed: {}", e)) });
        }
    };
    if let Ok(mut guard) = CURRENT_TTS.lock() {
        *guard = Some(child);
        log_debug("child stored in CURRENT_TTS");
    }

    // Analyze audio energy for lip-sync
    let energy = analyze_audio_energy(&tmp_path);
    Ok(TtsResult { ok: true, energy, error: None })
}

#[tauri::command]
fn stop_tts_audio() -> Result<(), String> {
    log_debug("stop_tts_audio command called");
    stop_current_tts();
    Ok(())
}

// ── Quick chat: OpenAI adapter ─────────────────────
#[tauri::command]
async fn quick_chat(
    app: tauri::AppHandle,
    message: String,
    history: Vec<(String, String)>,
    user_md: String,
    memory_md: String,
    api_url: String,
    api_key: String,
    model: String,
    provider: String,
    timeout_secs: u64,
) -> Result<String, String> {
    let (resolved_url, resolved_model) = llm_client::resolve_provider(&provider, &api_url, &model);
    let config = llm_client::AdapterConfig { api_url: resolved_url, api_key, model: resolved_model, timeout_secs };
    llm_client::chat(&app, &config, &message, &history, &user_md, &memory_md, "").await
}

/// Streaming version: emits chat-chunk / chat-tool-call / chat-done / chat-error events
/// tools_json: optional JSON array of OpenAI tool definitions
/// tool_choice_json: optional JSON for forced tool choice (e.g. {"type":"function","function":{"name":"read_clipboard"}})
#[tauri::command]
async fn quick_chat_stream(
    app: tauri::AppHandle,
    message: String,
    history: Vec<(String, String)>,
    user_md: String,
    memory_md: String,
    recall_text: String,
    api_url: String,
    api_key: String,
    model: String,
    provider: String,
    timeout_secs: u64,
    tools_json: Option<String>,
    tool_choice_json: Option<String>,
) -> Result<(), String> {
    log_debug(&format!("[quick_chat_stream] ENTER: provider={} url={} model={} key_len={} user_md_len={} hist_turns={} has_tools={} forced_tool={}",
        provider, api_url, model, api_key.len(), user_md.len(), history.len(), tools_json.is_some(), tool_choice_json.is_some()));
    let (resolved_url, resolved_model) = llm_client::resolve_provider(&provider, &api_url, &model);
    let config = llm_client::AdapterConfig { api_url: resolved_url, api_key, model: resolved_model, timeout_secs };
    llm_client::chat_stream(&config, &message, &history, &user_md, &memory_md, &recall_text,
        tools_json.as_deref(), tool_choice_json.as_deref(), app).await
}

/// Agent loop continuation: rebuild system prompt + base messages, then append extra messages
/// (assistant tool_calls + tool results from previous rounds).
/// extra_messages_json: JSON array of Message objects to append after the base conversation
/// tool_choice_json: optional JSON for forced tool choice
#[tauri::command]
async fn chat_stream_continue(
    app: tauri::AppHandle,
    message: String,
    history: Vec<(String, String)>,
    user_md: String,
    memory_md: String,
    recall_text: String,
    extra_messages_json: String,
    tools_json: Option<String>,
    tool_choice_json: Option<String>,
    api_url: String,
    api_key: String,
    model: String,
    provider: String,
    timeout_secs: u64,
) -> Result<(), String> {
    log_debug(&format!("[chat_stream_continue] ENTER: provider={} url={} model={} has_tools={} forced_tool={}",
        provider, api_url, model, tools_json.is_some(), tool_choice_json.is_some()));
    let extra: Vec<llm_client::Message> = serde_json::from_str(&extra_messages_json)
        .map_err(|e| format!("parse extra_messages_json: {}", e))?;

    // Rebuild the full message list: system + history + user + extra (tool_calls/results)
    let system_prompt = llm_client::build_system_prompt(&app, &user_md, &memory_md, &recall_text);
    let mut messages: Vec<llm_client::Message> = vec![
        llm_client::Message::text("system", &system_prompt),
    ];
    for (role, content) in &history {
        messages.push(llm_client::Message::text(role, content));
    }
    messages.push(llm_client::Message::text("user", &message));
    messages.extend(extra);

    let (resolved_url, resolved_model) = llm_client::resolve_provider(&provider, &api_url, &model);
    let config = llm_client::AdapterConfig { api_url: resolved_url, api_key, model: resolved_model, timeout_secs };
    llm_client::chat_stream_with_messages(&config, messages, tools_json.as_deref(), tool_choice_json.as_deref(), app).await
}

/// Capture screen + vision analysis.
/// xcap (Win32 COM) is !Send — runs on a dedicated OS thread so UI doesn't freeze.
#[tauri::command]
async fn analyze_screen(
    prompt: String,
    api_url: String,
    api_key: String,
    model: String,
    provider: String,
) -> Result<String, String> {
    let (resolved_url, resolved_model) = llm_client::resolve_provider(&provider, &api_url, &model);

    // xcap is !Send — run capture+encode on a dedicated OS thread
    let b64 = std::thread::spawn(move || -> Result<String, String> {
        let monitors = xcap::Monitor::all().map_err(|e| format!("list monitors: {}", e))?;
        let primary = monitors.into_iter().next().ok_or("no monitor found")?;
        let img = primary.capture_image().map_err(|e| format!("capture: {}", e))?;

        let img = image::DynamicImage::ImageRgba8(img).to_rgb8();
        let img = image::DynamicImage::ImageRgb8(img);
        let (w, h) = (img.width(), img.height());
        let img = if w.max(h) > 768 {
            let ratio = 768.0 / (w.max(h) as f32);
            img.resize((w as f32 * ratio) as u32, (h as f32 * ratio) as u32,
                image::imageops::FilterType::Lanczos3)
        } else { img };

        let mut buf = Cursor::new(Vec::new());
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 65);
        encoder.write_image(img.as_bytes(), img.width(), img.height(), img.color().into())
            .map_err(|e| format!("encode: {}", e))?;
        Ok(base64::engine::general_purpose::STANDARD.encode(buf.into_inner()))
    }).join().map_err(|e| format!("thread: {:?}", e))??;

    // Async HTTP call — doesn't block UI
    let config = llm_client::AdapterConfig {
        api_url: resolved_url, api_key, model: resolved_model, timeout_secs: 30,
    };
    llm_client::screen_vision_analyze(&b64, &prompt, &config).await
}

/// Execute a built-in desktop tool by name
#[tauri::command]
async fn execute_builtin_tool(app: tauri::AppHandle, name: String, args: serde_json::Value) -> Result<String, String> {
    log_debug(&format!("[execute_builtin_tool] name={} args={}", name, args));
    match name.as_str() {
        "read_clipboard" => {
            let mut clipboard = arboard::Clipboard::new()
                .map_err(|e| format!("无法打开剪贴板: {}", e))?;
            let text = clipboard.get_text()
                .map_err(|e| format!("无法读取剪贴板: {}", e))?;
            let preview: String = text.chars().take(80).collect();
            log_debug(&format!("[execute_builtin_tool] read_clipboard → {} chars: \"{}\"",
                text.len(), preview));
            if text.trim().is_empty() {
                Ok("(剪贴板为空)".to_string())
            } else {
                Ok(text)
            }
        }
        "system_info" => {
            let info = serde_json::json!({
                "os": std::env::consts::OS,
                "arch": std::env::consts::ARCH,
                "hostname": hostname(),
            });
            Ok(info.to_string())
        }
        "web_search" => {
            let query = args.get("query")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if query.trim().is_empty() {
                return Err("搜索关键词为空".to_string());
            }
            let query = query.to_string();
            let tavily_key = load_settings(app.clone())
                .ok()
                .and_then(|s| s.get("llm").cloned())
                .and_then(|l| l.get("tavilyApiKey").cloned())
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_default();
            let app_clone = app.clone();
            let result = tokio::task::spawn_blocking(move || {
                let script = app_clone.path().resource_dir()
                    .map(|d| d.join("scripts").join("web_search.py"))
                    .unwrap_or_else(|_| std::path::PathBuf::from("scripts/web_search.py"));
                log_debug(&format!("[web_search] python {} \"{}\" tavily={}", script.display(), query, !tavily_key.is_empty()));
                let py = bundled_python(&app_clone);
                let mut cmd = std::process::Command::new(&py);
                cmd.creation_flags(0x08000000)
                    .arg(script.to_str().unwrap_or("scripts/web_search.py"))
                    .arg(&query)
                    .arg("5");
                if !tavily_key.is_empty() {
                    cmd.arg(&tavily_key);
                }
                let output = cmd.output()
                    .map_err(|e| format!("spawn Python: {}", e))?;
                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    return Err(format!("搜索脚本失败: {}", stderr.trim()));
                }
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let results: serde_json::Value = serde_json::from_str(&stdout)
                    .map_err(|e| format!("解析搜索结果: {}", e))?;
                if results.as_array().map_or(true, |a| a.is_empty()) {
                    Ok("(未找到搜索结果)".to_string())
                } else {
                    let arr = results.as_array().unwrap();
                    log_debug(&format!("[web_search] got {} results", arr.len()));
                    let mut text = String::new();
                    text.push_str("（搜索结果包含页面摘要和链接，请综合所有信息回答。如需具体数据可告诉用户访问对应链接。）\n\n");
                    for (i, r) in arr.iter().enumerate() {
                        let title = r.get("title").and_then(|v| v.as_str()).unwrap_or("");
                        let body = r.get("body").and_then(|v| v.as_str()).unwrap_or("");
                        let href = r.get("href").and_then(|v| v.as_str()).unwrap_or("");
                        log_debug(&format!("[web_search] #{}. {} | {}", i+1, title, href));
                        text.push_str(&format!("{}. {}\n   {}\n   {}\n\n", i+1, title, body, href));
                    }
                    // Dump full results for debugging
                    let _ = std::fs::write(app.path().app_data_dir().unwrap().join("last_search.txt"), &text);
                    Ok(text)
                }
            }).await.map_err(|e| format!("spawn: {}", e))?;
            result
        }
        "fetch_page" => {
            let url = args.get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if url.is_empty() {
                return Err("URL 为空".to_string());
            }
            let url = url.to_string();
            let max_chars = args.get("max_chars")
                .and_then(|v| v.as_u64())
                .unwrap_or(5000) as usize;
            let app_clone = app.clone();
            let result = tokio::task::spawn_blocking(move || {
                let script = app_clone.path().resource_dir()
                    .map(|d| d.join("scripts").join("web_search.py"))
                    .unwrap_or_else(|_| std::path::PathBuf::from("scripts/web_search.py"));
                let py = bundled_python(&app_clone);
                let output = std::process::Command::new(&py)
                    .creation_flags(0x08000000)
                    .arg(script.to_str().unwrap_or("scripts/web_search.py"))
                    .arg("fetch")
                    .arg(&url)
                    .arg(max_chars.to_string())
                    .output()
                    .map_err(|e| format!("spawn Python: {}", e))?;
                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    return Err(format!("抓取失败: {}", stderr.trim()));
                }
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let parsed: serde_json::Value = serde_json::from_str(&stdout)
                    .map_err(|e| format!("解析结果: {}", e))?;
                if parsed.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
                    let title = parsed.get("title").and_then(|v| v.as_str()).unwrap_or("");
                    let content = parsed.get("content").and_then(|v| v.as_str()).unwrap_or("");
                    let description = parsed.get("description").and_then(|v| v.as_str()).unwrap_or("");
                    log_debug(&format!("[fetch_page] {} → {} chars (markdown)", url, content.len()));
                    let text = if description.is_empty() {
                        format!("[页面标题：{}]\n\n{}", title, content)
                    } else {
                        format!("[页面标题：{}]\n[摘要：{}]\n\n{}", title, description, content)
                    };
                    let _ = std::fs::write(app.path().app_data_dir().unwrap().join("last_fetch.txt"), &text);
                    Ok(text)
                } else {
                    let err = parsed.get("error").and_then(|v| v.as_str()).unwrap_or("unknown");
                    Err(format!("抓取失败: {}", err))
                }
            }).await.map_err(|e| format!("spawn: {}", e))?;
            result
        }
        _ => Err(format!("Unknown tool: {}", name)),
    }
}


fn hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown".to_string())
}

/// Check if a char is an emoji (Unicode blocks commonly used for emoji)
fn is_emoji(c: char) -> bool {
    let u = c as u32;
    matches!(u,
        0x1F600..=0x1F64F | // Emoticons
        0x1F300..=0x1F5FF | // Misc symbols & pictographs
        0x1F680..=0x1F6FF | // Transport & map
        0x1F1E0..=0x1F1FF | // Flags
        0x2600..=0x27BF |   // Misc symbols, dingbats
        0x1F900..=0x1F9FF | // Supplemental symbols
        0x1FA00..=0x1FAFF | // Extended-A (chess, etc.)
        0xFE00..=0xFE0F |   // Variation selectors
        0x200D              // ZWJ (emoji sequence joiner)
    )
}

/// Shared text cleaning for TTS:
/// 1. Remove parenthesized content entirely — both (…) and （…）
/// 2. Remove bracket-wrapped content entirely — both […] and 【…】 (stage directions)
/// 3. Strip emoji
/// 4. Strip ASCII punctuation except CJK-essential chars
/// 5. Cap at 500 chars
/// Strip `<think>...</think>` blocks from text. MiniMax M3 may output these
/// even when thinking is disabled. The streaming filter in llm_client.rs is the
/// primary defense; this is a belt-and-suspenders safety net.
fn strip_think_tags(text: &str) -> String {
    let mut s = text.to_string();
    while let Some(start) = s.find("<think>") {
        if let Some(rel_end) = s[start + 7..].find("</think>") {
            s.replace_range(start..start + 7 + rel_end + 8, "");
        } else {
            s.truncate(start);
            break;
        }
    }
    s
}

fn clean_tts_text(text: &str) -> String {
    let text = strip_think_tags(text);
    let mut result = String::with_capacity(text.len().min(500));
    let mut paren_depth = 0u32;
    let mut bracket_depth = 0u32;

    for c in text.chars() {
        if result.len() >= 500 { break; }

        // Track parenthesized regions — skip everything inside
        match c {
            '(' | '（' => { paren_depth += 1; continue; }
            ')' | '）' => { paren_depth = paren_depth.saturating_sub(1); continue; }
            _ => {}
        }
        if paren_depth > 0 { continue; }

        // Track bracket-wrapped regions — skip everything inside (stage directions)
        match c {
            '[' | '【' => { bracket_depth += 1; continue; }
            ']' | '】' => { bracket_depth = bracket_depth.saturating_sub(1); continue; }
            _ => {}
        }
        if bracket_depth > 0 { continue; }

        // Emoji
        if is_emoji(c) { continue; }

        // Keep CJK punctuation; strip all other ASCII punctuation
        if c.is_ascii_punctuation() && c != '，' && c != '。' && c != '？' && c != '！' { continue; }

        result.push(c);
    }

    result
}

/// Generate TTS for fast mode (via edge-tts subprocess + ffplay)
#[tauri::command]
async fn quick_speak(text: String, volume: u32) -> Result<TtsResult, String> {
    log_debug(&format!("quick_speak called: {} chars, volume={}", text.len(), volume));
    let tts_python = python_cmd();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();
    let tmp_path = std::env::temp_dir().join(format!("waifu-fast-{}-{}.mp3", std::process::id(), ts));
    let tmp_path = tmp_path.to_str().unwrap_or("waifu-fast.mp3").to_string();

    let clean = clean_tts_text(&text);
    log_debug(&format!("quick_speak clean: {} chars", clean.len()));

    let tts_code = r#"
import sys, asyncio
from edge_tts import Communicate
async def main():
    c = Communicate(sys.argv[1], voice='zh-CN-XiaoxiaoNeural')
    await c.save(sys.argv[2])
asyncio.run(main())
"#;
    let output = Command::new(tts_python)
        .creation_flags(0x08000000)
        .args(["-c", tts_code, &clean, &tmp_path])
        .output()
        .map_err(|e| format!("edge-tts spawn: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        log_debug(&format!("quick_speak edge-tts FAIL: {}", stderr));
        return Ok(TtsResult { ok: false, energy: vec![], error: Some(format!("edge-tts failed: {}", stderr)) });
    }
    log_debug(&format!("quick_speak saved: {}", tmp_path));

    let vol_str = volume.to_string();
    let child = Command::new("ffplay")
        .creation_flags(0x08000000)
        .args(["-nodisp", "-autoexit", "-loglevel", "quiet", "-volume", &vol_str, &tmp_path])
        .stdout(Stdio::null()).stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("ffplay: {}", e))?;
    log_debug("quick_speak ffplay spawned");

    if let Ok(mut guard) = CURRENT_TTS.lock() {
        *guard = Some(child);
    }

    // Analyze audio energy for lip-sync
    let energy = analyze_audio_energy(&tmp_path);
    Ok(TtsResult { ok: true, energy, error: None })
}

/// Edge TTS → base64 MP3 (for Web Audio API playback, no ffplay)
#[tauri::command]
async fn edge_tts(app: tauri::AppHandle, text: String) -> Result<String, String> {
    let python = bundled_python(&app);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();
    let tmp_prefix = std::env::temp_dir().join(format!("waifu-tts-{}-{}", std::process::id(), ts));
    let tmp_prefix = tmp_prefix.to_str().unwrap_or("waifu-tts").to_string();
    let mp3_path = format!("{}.mp3", tmp_prefix);

    let clean = clean_tts_text(&text);
    let tts_preview: String = clean.chars().take(80).collect();
    log_debug(&format!("[TTS] text_in={} clean_out={} preview=\"{}\"", text.len(), clean.len(), tts_preview));

    tts_daemon::generate(&python, &clean, &mp3_path)?;

    let audio = std::fs::read(&mp3_path).map_err(|e| format!("read mp3: {}", e))?;
    let _ = std::fs::remove_file(&mp3_path);

    if audio.is_empty() { return Err("empty audio".into()); }
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&audio))
}

/// Save a conversation turn to daily log
#[tauri::command]
fn save_turn(app: tauri::AppHandle, role: String, text: String, mode: String) -> Result<(), String> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut p = app.path().app_data_dir().map_err(|e| format!("data dir: {}", e))?;
    p.push("conversations");
    std::fs::create_dir_all(&p).map_err(|e| format!("create dir: {}", e))?;
    p.push(format!("{}.jsonl", today));

    let entry = serde_json::json!({
        "role": role,
        "text": text,
        "time": chrono::Local::now().to_rfc3339(),
        "mode": mode,
    });

    let mut f = std::fs::OpenOptions::new()
        .create(true).append(true)
        .open(&p)
        .map_err(|e| format!("open log: {}", e))?;
    writeln!(f, "{}", serde_json::to_string(&entry).unwrap())
        .map_err(|e| format!("write log: {}", e))?;
    Ok(())
}

/// Let the character reflect on recent conversations and form thoughts
#[tauri::command]
async fn distill_memory(
    app: tauri::AppHandle,
    api_url: String,
    api_key: String,
    model: String,
    timeout_secs: u64,
) -> Result<Vec<String>, String> {
    let config = llm_client::AdapterConfig { api_url, api_key, model, timeout_secs };

    let base_dir = app.path().app_data_dir().map_err(|e| format!("data dir: {}", e))?;
    let conversation_dir = base_dir.join("conversations");
    let memory_dir = base_dir.join("memory");

    let dates = [
        (chrono::Local::now() - chrono::Duration::days(1)).format("%Y-%m-%d").to_string(),
        chrono::Local::now().format("%Y-%m-%d").to_string(),
    ];

    let mut all_turns = String::new();
    for date in &dates {
        let conv_file = conversation_dir.join(format!("{}.jsonl", date));
        if let Ok(content) = std::fs::read_to_string(&conv_file) {
            for line in content.lines() {
                if let Ok(turn) = serde_json::from_str::<serde_json::Value>(line) {
                    all_turns.push_str(&format!(
                        "[{}] {}: {}\n",
                        turn["time"].as_str().unwrap_or(""),
                        turn["role"].as_str().unwrap_or("?"),
                        turn["text"].as_str().unwrap_or(""),
                    ));
                }
            }
        }
    }

    if all_turns.is_empty() {
        return Ok(vec![]);
    }

    let truncated: String = all_turns.chars().take(3500).collect();

    let distillation_prompt = format!(
        "你是桌面角色waifu。从你的视角，写下1~3条对以下对话的念头。\
         每条一句话，用中文。只记对你有情感意义的事。\
         没值得记的就输出空数组[]。\n\
         格式: [{{\"feeling\":\"...\", \"thought\":\"...\"}}]\n\n对话:\n{}",
        truncated
    );

    let thoughts_text = llm_client::chat(&app, &config, &distillation_prompt, &[], "", "", "").await?;

    let thoughts: Vec<serde_json::Value> = serde_json::from_str(&thoughts_text).unwrap_or_default();
    if thoughts.is_empty() {
        return Ok(vec![]);
    }

    std::fs::create_dir_all(&memory_dir).map_err(|e| format!("create memo dir: {}", e))?;
    let memo_file = memory_dir.join("thoughts.jsonl");
    let mut f = std::fs::OpenOptions::new()
        .create(true).append(true)
        .open(&memo_file)
        .map_err(|e| format!("open memo: {}", e))?;

    let mut saved = Vec::new();
    for t in &thoughts {
        let entry = serde_json::json!({
            "feeling": t["feeling"].as_str().unwrap_or(""),
            "thought": t["thought"].as_str().unwrap_or(""),
            "time": chrono::Local::now().to_rfc3339(),
        });
        writeln!(f, "{}", serde_json::to_string(&entry).unwrap())
            .map_err(|e| format!("write memo: {}", e))?;
        saved.push(entry["thought"].as_str().unwrap_or("").to_string());
    }
    Ok(saved)
}

// ── Window position ────────────────────────────────
#[tauri::command]
fn frontend_log(msg: String) -> Result<(), String> {
    log_debug(&format!("[FRONTEND] {}", msg));
    Ok(())
}

#[tauri::command]
fn save_window_position(app: tauri::AppHandle, x: i32, y: i32) -> Result<(), String> {
    let mut p = app.path().app_data_dir().map_err(|e| format!("data dir: {}", e))?;
    p.push("window_pos.json");
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create dir: {}", e))?;
    }
    let data = serde_json::json!({"x": x, "y": y});
    std::fs::write(&p, serde_json::to_string_pretty(&data).unwrap())
        .map_err(|e| format!("write pos: {}", e))?;
    Ok(())
}

#[tauri::command]
fn load_window_position(app: tauri::AppHandle) -> Result<Option<(i32, i32)>, String> {
    let mut p = app.path().app_data_dir().map_err(|e| format!("data dir: {}", e))?;
    p.push("window_pos.json");
    if !p.exists() { return Ok(None); }
    let content = std::fs::read_to_string(&p).map_err(|e| format!("read pos: {}", e))?;
    let data: serde_json::Value = serde_json::from_str(&content).map_err(|e| format!("parse pos: {}", e))?;
    let x = data["x"].as_i64().ok_or("missing x")? as i32;
    let y = data["y"].as_i64().ok_or("missing y")? as i32;
    Ok(Some((x, y)))
}

/// [DEPRECATED] Use relay mode (agentMode="relay") with WebSocket instead.
/// Kept for backward compatibility with old deep-mode clients.
#[tauri::command]
async fn send_message(message: String) -> Result<String, String> {
    eprintln!("[DEPRECATED] send_message called — use relay mode (agentMode='relay') instead");
    let hermes_python = python_cmd();
    let hermes_module = "hermes_cli.main";
    let io_result = timeout(Duration::from_secs(120), async move {
        match tokio::task::spawn_blocking(move || {
            Command::new(hermes_python)
                .creation_flags(0x08000000)
                .args(["-m", hermes_module, "chat", "-q", &message, "--quiet"])
                .output()
        }).await {
            Ok(r) => r,
            Err(e) => Err(std::io::Error::new(std::io::ErrorKind::Other, format!("task join: {}", e))),
        }
    }).await.map_err(|_| "hermes timeout (120s)".to_string())?;
    let output = io_result.map_err(|e| format!("hermes spawn: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if output.status.success() { Ok(stdout) }
    else { if !stdout.is_empty() { Ok(stdout) } else { Err(format!("hermes error: {} (stderr: {})", output.status, stderr.trim())) } }
}

// ── USER.md & MEMORY.md ──────────────────────────

fn default_user_md_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let mut p = app.path().app_data_dir().map_err(|e| format!("data dir: {}", e))?;
    std::fs::create_dir_all(&p).map_err(|e| format!("create dir: {}", e))?;
    p.push("USER.md");
    Ok(p)
}

fn default_memory_md_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let mut p = app.path().app_data_dir().map_err(|e| format!("data dir: {}", e))?;
    std::fs::create_dir_all(&p).map_err(|e| format!("create dir: {}", e))?;
    p.push("MEMORY.md");
    Ok(p)
}

#[tauri::command]
fn load_user_md(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let p = if path.is_empty() {
        default_user_md_path(&app)?
    } else {
        std::path::PathBuf::from(&path)
    };
    if !p.exists() {
        let template = "<!-- 在这里写关于你的信息，角色在对话中会看到 -->\n";
        std::fs::write(&p, template).map_err(|e| format!("create USER.md: {}", e))?;
        return Ok(template.to_string());
    }
    std::fs::read_to_string(&p).map_err(|e| format!("read USER.md: {}", e))
}

#[tauri::command]
fn load_memory_md(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let p = if path.is_empty() {
        default_memory_md_path(&app)?
    } else {
        std::path::PathBuf::from(&path)
    };
    if !p.exists() {
        let template = "# 共同记忆\n\n（AI 会在你说\"记住\"时自动在这里写入内容）\n";
        std::fs::write(&p, template).map_err(|e| format!("create MEMORY.md: {}", e))?;
        return Ok(template.to_string());
    }
    std::fs::read_to_string(&p).map_err(|e| format!("read MEMORY.md: {}", e))
}

#[tauri::command]
fn save_user_md(app: tauri::AppHandle, content: String, path: String) -> Result<(), String> {
    let p = if path.is_empty() {
        default_user_md_path(&app)?
    } else {
        std::path::PathBuf::from(&path)
    };
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create dir: {}", e))?;
    }
    std::fs::write(&p, content).map_err(|e| format!("write USER.md: {}", e))
}

// ── User portrait (入门配置向导) ──────────

#[derive(Deserialize)]
struct PortraitAnswer {
    question_id: String,
    #[serde(rename = "type")]
    _type: String,
    value: String,
}

fn generate_portrait_text(answers: &[PortraitAnswer]) -> String {
    let mut parts: Vec<String> = Vec::new();

    for a in answers {
        match a.question_id.as_str() {
            "name" => {
                parts.push(format!("## 称呼\n主人让我叫TA「{}」。", a.value));
            }
            "personality" => {
                let desc = match a.value.as_str() {
                    "mao-girlfriend" => "主人选的是「女朋友」。我会用温柔亲昵、带点撒娇的方式跟TA说话，护着TA、鼓励TA。",
                    "mao-teasing" => "主人选的是「毒舌损友」。我会用调侃的方式跟TA说话，但心里是关心TA的。",
                    "mao-warm" => "主人选的是「温柔体贴」。我会多鼓励、多陪伴，做一个温暖的存在。",
                    "mao-cool" => "主人选的是「冷静理性」。有事说事，不废话，保持高效简洁。",
                    "mao-energetic" => "主人选的是「元气满满」。活泼话多，给TA带来能量和好心情。",
                    "mao-rebel" => "主人选的是「叛逆不羁」。不按套路出牌，保持新鲜感和惊喜。",
                    _ => "",
                };
                if !desc.is_empty() {
                    parts.push(format!("## 性格\n{}", desc));
                }
            }
            "usage" => {
                let desc = match a.value.as_str() {
                    "chat" => "主人主要想让我陪聊，有个能说话的对象。",
                    "work" => "主人主要把我当工作/学习帮手，讨论问题、整理思路。",
                    "vent" => "主人主要需要情绪陪伴，有人听、有人懂。",
                    "mixed" => "主人什么都需要一点，看心情切换。",
                    _ => "",
                };
                if !desc.is_empty() {
                    parts.push(format!("## 用途\n{}", desc));
                }
            }
            "topics" => {
                if !a.value.is_empty() {
                    parts.push(format!("## 话题偏好\n{}", a.value));
                }
            }
            _ => {}
        }
    }

    format!(
        "（以下是主人告诉我的基本信息。自然使用，不要背诵。）\n\n{}",
        parts.join("\n\n")
    )
}

#[tauri::command]
fn portrait_save(app: tauri::AppHandle, answers: Vec<PortraitAnswer>) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("data dir: {}", e))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create dir: {}", e))?;

    // 1. 写入 portrait.json
    let portrait_path = dir.join("portrait.json");
    let summary: Vec<serde_json::Value> = answers.iter().map(|a| {
        serde_json::json!({"question_id": a.question_id, "type": a._type, "value": a.value})
    }).collect();
    let portrait_value = serde_json::json!({
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "answerSummary": summary,
    });
    let json_str = serde_json::to_string_pretty(&portrait_value).map_err(|e| format!("serialize: {}", e))?;
    std::fs::write(&portrait_path, json_str).map_err(|e| format!("write portrait.json: {}", e))?;

    // 2. 如果选了性格，同步到 settings.json
    for a in &answers {
        if a.question_id == "personality" && !a.value.is_empty() {
            let settings_path = dir.join("settings.json");
            if let Ok(existing) = std::fs::read_to_string(&settings_path) {
                if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&existing) {
                    json["soulPreset"] = serde_json::Value::String(a.value.clone());
                    if let Ok(content) = serde_json::to_string_pretty(&json) {
                        let _ = std::fs::write(&settings_path, content);
                    }
                }
            }
            break;
        }
    }

    // 3. 生成 USER.md 文本并写入
    let portrait_text = generate_portrait_text(&answers);
    let user_md_path = dir.join("USER.md");
    std::fs::write(&user_md_path, &portrait_text).map_err(|e| format!("write USER.md: {}", e))?;

    Ok(portrait_text)
}

#[tauri::command]
fn get_trending() -> String {
    cached_trending()
}

/// 从 Gitee 拉取最新赞助者名单，失败时读本地缓存
#[tauri::command]
async fn fetch_sponsors(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("data_dir: {}", e))?;
    let cache_path = dir.join("sponsors.json");
    let gitee_url = "https://gitee.com/gaven6666/waifu-agent-key/raw/master/sponsors.json";

    log_debug(&format!("[fetch_sponsors] GET {}", gitee_url));

    // 1. 尝试从 Gitee 拉取最新
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("client: {}", e))?;
    match client.get(gitee_url).send().await {
        Ok(resp) => {
            let status = resp.status();
            log_debug(&format!("[fetch_sponsors] Gitee response: {}", status));
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                // 缓存到本地
                if let Ok(s) = serde_json::to_string_pretty(&json) {
                    std::fs::write(&cache_path, s).ok();
                    log_debug("[fetch_sponsors] cached to app_data");
                }
                return Ok(json);
            }
            log_debug("[fetch_sponsors] Gitee response not valid JSON");
        }
        Err(e) => {
            log_debug(&format!("[fetch_sponsors] Gitee request failed: {}", e));
        }
    }

    // 2. Gitee 不通 → 读本地缓存
    if cache_path.exists() {
        log_debug("[fetch_sponsors] reading from cache");
        let content = std::fs::read_to_string(&cache_path)
            .map_err(|e| format!("read cache: {}", e))?;
        return serde_json::from_str(&content)
            .map_err(|e| format!("parse cache: {}", e));
    }

    log_debug("[fetch_sponsors] no cache, returning error");
    Err("no sponsors data (Gitee unreachable, no cache)".into())
}

/// 读本地缓存（上次 fetch_sponsors 成功保存的），不联网，毫秒级返回
#[tauri::command]
fn read_sponsors_cache(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("data_dir: {}", e))?;
    let cache_path = dir.join("sponsors.json");
    if cache_path.exists() {
        let content = std::fs::read_to_string(&cache_path)
            .map_err(|e| format!("read cache: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("parse cache: {}", e))
    } else {
        Err("no cache".into())
    }
}

#[tauri::command]
fn portrait_exists(app: tauri::AppHandle) -> Result<bool, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("data dir: {}", e))?;
    let path = dir.join("portrait.json");
    Ok(path.exists())
}

/// 检查是否有记忆基础（facts.json 有内容 或 USER.md 非空）
/// 用于防止冷读反馈循环：无基础时不自动提取记忆
#[tauri::command]
fn has_knowledge_base(app: tauri::AppHandle) -> Result<bool, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("data dir: {}", e))?;

    // 检查 USER.md 是否有内容
    let user_md = dir.join("USER.md");
    if user_md.exists() {
        let content = std::fs::read_to_string(&user_md).unwrap_or_default();
        if content.trim().len() > 20 {
            return Ok(true);
        }
    }

    // 检查 memory/ 下是否有 facts 目录/文件
    let facts_dir = dir.join("memory");
    if facts_dir.exists() {
        for entry in std::fs::read_dir(&facts_dir).map_err(|e| format!("read memory/: {}", e))? {
            let entry = entry.map_err(|e| format!("entry: {}", e))?;
            let facts_file = entry.path().join("facts.json");
            if facts_file.exists() {
                let content = std::fs::read_to_string(&facts_file).unwrap_or_default();
                let v: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();
                if let Some(arr) = v.as_array() {
                    if !arr.is_empty() {
                        return Ok(true);
                    }
                }
            }
        }
    }

    Ok(false)
}

// ── History persistence ────────────────────────────

#[tauri::command]
fn save_history(app: tauri::AppHandle, history: Vec<(String, String)>) -> Result<(), String> {
    let mut p = app.path().app_data_dir().map_err(|e| format!("data dir: {}", e))?;
    std::fs::create_dir_all(&p).map_err(|e| format!("create dir: {}", e))?;
    p.push("history.json");
    // Only keep last 10 turns (20 entries)
    let limited: Vec<_> = history.iter().rev().take(20).rev().cloned().collect();
    let json = serde_json::to_string(&limited).map_err(|e| format!("serialize: {}", e))?;
    std::fs::write(&p, json).map_err(|e| format!("write history.json: {}", e))
}

#[tauri::command]
fn load_history(app: tauri::AppHandle) -> Result<Vec<(String, String)>, String> {
    let mut p = app.path().app_data_dir().map_err(|e| format!("data dir: {}", e))?;
    p.push("history.json");
    if !p.exists() { return Ok(vec![]); }
    let content = std::fs::read_to_string(&p).map_err(|e| format!("read history.json: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("deserialize: {}", e))
}

/// 清空所有角色记忆：对话记录、记忆库、历史、用户画像
#[tauri::command]
fn clear_memory(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("data dir: {}", e))?;
    let mut deleted = vec![];

    // 删除记忆目录
    let memory_dir = dir.join("memory");
    if memory_dir.exists() {
        std::fs::remove_dir_all(&memory_dir).map_err(|e| format!("删除 memory/: {}", e))?;
        deleted.push("记忆库");
    }

    // 删除对话记录
    let conv_dir = dir.join("conversations");
    if conv_dir.exists() {
        std::fs::remove_dir_all(&conv_dir).map_err(|e| format!("删除 conversations/: {}", e))?;
        deleted.push("对话记录");
    }

    // 删除对话历史
    let history_file = dir.join("history.json");
    if history_file.exists() {
        std::fs::remove_file(&history_file).map_err(|e| format!("删除 history.json: {}", e))?;
        deleted.push("对话历史");
    }

    // 删除用户画像
    let portrait_file = dir.join("portrait.json");
    if portrait_file.exists() {
        std::fs::remove_file(&portrait_file).map_err(|e| format!("删除 portrait.json: {}", e))?;
        deleted.push("用户画像");
    }

    // 重置 MEMORY.md
    let memory_md = dir.join("MEMORY.md");
    std::fs::write(&memory_md, "").map_err(|e| format!("重置 MEMORY.md: {}", e))?;
    deleted.push("MEMORY.md");

    // 重置 USER.md（否则重启后 memory_extract 会从这里重建 facts）
    let user_md = dir.join("USER.md");
    std::fs::write(&user_md, "").map_err(|e| format!("重置 USER.md: {}", e))?;
    deleted.push("USER.md");

    // 删除用户自定义 SOUL.md（回落内置预设）
    let soul_md = dir.join("SOUL.md");
    if soul_md.exists() {
        std::fs::remove_file(&soul_md).map_err(|e| format!("删除 SOUL.md: {}", e))?;
        deleted.push("SOUL.md");
    }

    Ok(format!("已清空: {}", deleted.join("、")))
}

#[tauri::command]
async fn append_memory(
    app: tauri::AppHandle,
    user_message: String,
    ai_response: String,
    memory_path: String,
    api_url: String,
    api_key: String,
    model: String,
    timeout_secs: u64,
) -> Result<String, String> {
    let p = if memory_path.is_empty() {
        default_memory_md_path(&app)?
    } else {
        std::path::PathBuf::from(&memory_path)
    };

    // Build extraction prompt with embedded rules
    let rules = include_str!("../../MEMORY_RULES.md");
    let extract_prompt = format!(
        "{}\n\n---\n\n根据以上规则，从以下对话中提取值得长期记住的内容：\n\n主人: {}\n\nwaifu: {}\n\n只输出记忆条目，格式 YYYY-MM-DD | 一句话。如果没有值得记的，输出\"无\"。",
        rules, user_message, ai_response
    );

    // Call LLM for extraction
    let config = llm_client::AdapterConfig { api_url, api_key, model, timeout_secs };
    let entry = llm_client::chat(&app, &config, &extract_prompt, &[], "", "", "").await?;
    let entry = entry.trim().to_string();

    if entry.is_empty() || (entry.contains('无') && entry.len() < 10) {
        return Ok(String::new());
    }

    // Ensure directory
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create dir: {}", e))?;
    }

    // Append with timestamp if needed
    let line = if entry.contains('|') {
        entry
    } else {
        format!("{} | {}", chrono::Local::now().format("%Y-%m-%d"), entry)
    };

    let mut f = std::fs::OpenOptions::new()
        .create(true).append(true)
        .open(&p)
        .map_err(|e| format!("open MEMORY.md: {}", e))?;
    writeln!(f, "{}", line).map_err(|e| format!("write MEMORY.md: {}", e))?;

    Ok(line)
}

// ── Memory Bridge ────────────────────────────────

#[tauri::command]
async fn memory_configure(
    app: tauri::AppHandle,
    api_url: String,
    api_key: String,
    model: String,
    provider: String,
) -> Result<(), String> {
    let memory_dir = app.path().app_data_dir()
        .map_err(|e| format!("data dir: {}", e))?
        .join("memory");
    let dir_str = memory_dir.to_string_lossy().to_string();
    // Rust 侧解析 provider → 实际 url/model，再传给 Python
    let (resolved_url, resolved_model) = llm_client::resolve_provider(&provider, &api_url, &model);
    // 启动时 Python spawn 放后台线程，不阻塞 UI
    tokio::task::spawn_blocking(move || {
        memory_bridge::memory_configure(&app, &dir_str, &resolved_url, &api_key, &resolved_model, "mao", "主人")?;
        Ok::<_, String>(())
    }).await.map_err(|e| format!("join: {}", e))?
}

#[tauri::command]
fn memory_recall(app: tauri::AppHandle, query: String, top_k: usize) -> Result<Vec<serde_json::Value>, String> {
    memory_bridge::memory_recall(&app, &query, top_k)
}

#[tauri::command]
fn memory_extract(app: tauri::AppHandle, messages_json: String) -> Result<(), String> {
    let messages: Vec<serde_json::Value> = serde_json::from_str(&messages_json)
        .map_err(|e| format!("parse messages: {}", e))?;
    // 全部在后台线程跑，立刻返回，不阻塞 invoke 管道
    std::thread::spawn(move || {
        match memory_bridge::memory_extract(&app, &messages) {
            Ok(facts) if !facts.is_empty() => {
                log_debug(&format!("[Memory] extracted {} facts", facts.len()));
            }
            Ok(_) => {} // 无新事实，跳过
            Err(e) => log_debug(&format!("[Memory] extract failed: {}", e)),
        }
    });
    Ok(())
}

// ── License check ────────────────────────────────

fn bundled_ffmpeg(app: &tauri::AppHandle) -> String {
    if let Ok(dir) = app.path().resource_dir() {
        let bundled = dir.join("tools").join("ffmpeg.exe");
        if bundled.exists() {
            return bundled.to_string_lossy().to_string();
        }
    }
    "ffmpeg".into()
}

// ── STT: speech-to-text ────────────────────────────

#[tauri::command]
async fn stt_transcribe(app: tauri::AppHandle, audio_base64: String, language: String) -> Result<String, String> {
    use base64::Engine;
    let audio_bytes = base64::engine::general_purpose::STANDARD
        .decode(&audio_base64)
        .map_err(|e| format!("base64 decode: {}", e))?;

    let tmp_dir = std::env::temp_dir().join("waifu-stt");
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("mkdir: {}", e))?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();
    let webm_path = tmp_dir.join(format!("input_{}.webm", ts));
    let wav_path = tmp_dir.join(format!("input_{}.wav", ts));

    // 1. Write WebM
    std::fs::write(&webm_path, &audio_bytes).map_err(|e| format!("write webm: {}", e))?;

    // 2. ffmpeg: WebM → 16kHz mono WAV
    let ffmpeg = bundled_ffmpeg(&app);
    let ffmpeg_result = std::process::Command::new(&ffmpeg)
        .args(["-y", "-i"])
        .arg(&webm_path)
        .args(["-ar", "16000", "-ac", "1", "-sample_fmt", "s16"])
        .arg(&wav_path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .creation_flags(0x08000000)
        .status()
        .map_err(|e| format!("ffmpeg: {}", e))?;

    if !ffmpeg_result.success() {
        log_debug(&format!("[STT] ffmpeg failed: {}", ffmpeg));
        let _ = std::fs::remove_file(&webm_path);
        let _ = std::fs::remove_file(&wav_path);
        return Err("ffmpeg conversion failed".into());
    }

    // 3. faster-whisper transcription (走常驻 daemon，首次自动加载模型)
    let python = bundled_python(&app);
    let models_dir = std::path::Path::new(&python).parent().unwrap().join("models");
    let small_model = models_dir.join("faster-whisper-small");
    let base_model = models_dir.join("faster-whisper-base");
    let model_path = if small_model.join("model.bin").exists() { &small_model } else { &base_model };
    let model_arg = model_path.to_string_lossy().to_string().strip_prefix(r"\\?\").unwrap_or(&model_path.to_string_lossy()).to_string();
    let lang = if language.is_empty() { "zh" } else { &language };
    let result = stt::transcribe(
        &wav_path.to_string_lossy(),
        &python,
        &model_arg,
        lang,
    );
    if let Err(ref e) = result {
        log_debug(&format!("[STT] transcription failed: {}", e));
    }

    // 4. Save copy for test, then cleanup
    let test_dir = tmp_dir.join("test-wav");
    let _ = std::fs::create_dir_all(&test_dir);
    let test_wav = test_dir.join(format!("stt_{}.wav", ts));
    let _ = std::fs::copy(&wav_path, &test_wav);
    let _ = std::fs::remove_file(&webm_path);
    let _ = std::fs::remove_file(&wav_path);

    result
}

// ── Settings persistence ──────────────────────────

fn settings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let mut p = app.path().app_data_dir().map_err(|e| format!("data dir: {}", e))?;
    std::fs::create_dir_all(&p).map_err(|e| format!("create settings dir: {}", e))?;
    p.push("settings.json");
    Ok(p)
}

#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let p = settings_path(&app)?;
    eprintln!("[startup] load_settings path={} exists={}", p.display(), p.exists());
    if !p.exists() {
        return Ok(serde_json::json!({}));
    }
    let content = std::fs::read_to_string(&p).map_err(|e| format!("read settings: {}", e))?;
    eprintln!("[startup] settings.json size={}", content.len());
    serde_json::from_str(&content).map_err(|e| format!("parse settings: {}", e))
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: serde_json::Value) -> Result<(), String> {
    let p = settings_path(&app)?;
    // Merge with existing to prevent partial overwrites from losing data
    let existing: serde_json::Value = std::fs::read_to_string(&p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
    let merged = match (existing.as_object(), settings.as_object()) {
        (Some(existing_obj), Some(new_obj)) => {
            let mut out = existing_obj.clone();
            for (k, v) in new_obj { out.insert(k.clone(), v.clone()); }
            serde_json::Value::Object(out)
        }
        _ => settings,
    };
    let content = serde_json::to_string_pretty(&merged).map_err(|e| format!("serialize: {}", e))?;
    std::fs::write(&p, content).map_err(|e| format!("write settings: {}", e))
}

#[tauri::command]
fn set_always_on_top(window: tauri::Window, enabled: bool) -> Result<(), String> {
    window.set_always_on_top(enabled).map_err(|e| format!("set always on top: {}", e))
}

#[tauri::command]
fn set_skip_taskbar(window: tauri::Window, enabled: bool) -> Result<(), String> {
    window.set_skip_taskbar(enabled).map_err(|e| format!("set skip taskbar: {}", e))
}

#[tauri::command]
fn set_window_size(window: tauri::Window, width: u32, height: u32) -> Result<(), String> {
    window.set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| format!("set size: {}", e))
}

#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let al = app.autolaunch();
    if enabled {
        al.enable().map_err(|e| format!("enable autostart: {}", e))
    } else {
        // disable() fails when autostart was never enabled — that's fine
        match al.disable() {
            Ok(()) => Ok(()),
            Err(e) => {
                let msg = format!("{}", e);
                if msg.contains("os error 2") || msg.contains("not found") {
                    Ok(()) // already disabled
                } else {
                    Err(format!("disable autostart: {}", msg))
                }
            }
        }
    }
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

// ── Auth commands (v2: 激活码模式) ────────────

#[tauri::command]
fn get_machine_code() -> Result<String, String> {
    Ok(auth::get_machine_code())
}

#[tauri::command]
async fn auth_activate(activation_code: String, machine_code: String, device_name: String) -> Result<serde_json::Value, String> {
    let data = auth::auth_activate(&activation_code, &machine_code, &device_name).await?;
    serde_json::to_value(data).map_err(|e| format!("序列化: {}", e))
}

#[tauri::command]
fn verify_machine_code(machine_code: String) -> Result<(), String> {
    auth::verify_machine_code(&machine_code)
}

#[tauri::command]
async fn auth_check_gitee(access_token: String) -> Result<serde_json::Value, String> {
    let token = access_token.clone();
    let result = tokio::task::spawn_blocking(move || auth::auth_check_gitee(&token))
        .await.map_err(|e| format!("join: {}", e))?;
    result?;
    Ok(serde_json::json!({"ok": true}))
}

#[tauri::command]
async fn auth_verify(access_token: String, machine_code: String) -> Result<serde_json::Value, String> {
    auth::auth_verify(&access_token, &machine_code).await
}

#[tauri::command]
fn save_auth_token(app: tauri::AppHandle, token: serde_json::Value) -> Result<(), String> {
    let t: auth::AuthToken = serde_json::from_value(token).map_err(|e| format!("解析: {}", e))?;
    auth::save_auth_token(&app, &t)
}

#[tauri::command]
fn load_auth_token(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    match auth::load_auth_token(&app)? {
        Some(t) => {
            let v = serde_json::to_value(t).map_err(|e| format!("序列化: {}", e))?;
            Ok(Some(v))
        }
        None => Ok(None),
    }
}

#[tauri::command]
fn clear_auth_token(app: tauri::AppHandle) -> Result<(), String> {
    auth::clear_auth_token(&app)
}

// ── 运维面板 commands ──

#[derive(serde::Serialize)]
struct FileEntry {
    path: String,
    size: u64,
    modified: String,
    is_dir: bool,
}

#[derive(serde::Serialize)]
struct OpsStats {
    memory_facts_count: usize,
    today_conversations: usize,
    total_conversations: usize,
    last_prompt_size: usize,
    log_size: u64,
    total_app_data_size: u64,
}

#[tauri::command]
fn read_log_lines(app: tauri::AppHandle, tail: usize) -> Result<Vec<String>, String> {
    let mut p = app.path().app_data_dir().map_err(|e| format!("data dir: {}", e))?;
    p.push("waifu-agent.log");
    if !p.exists() {
        return Ok(vec![]);
    }
    let content = std::fs::read_to_string(&p).map_err(|e| format!("read log: {}", e))?;
    let lines: Vec<&str> = content.lines().collect();
    let start = if lines.len() > tail { lines.len() - tail } else { 0 };
    Ok(lines[start..].iter().map(|s| s.to_string()).collect())
}

#[tauri::command]
fn list_app_data(app: tauri::AppHandle) -> Result<Vec<FileEntry>, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("data dir: {}", e))?;
    let mut entries = Vec::new();
    let mut walk = vec![dir.clone()];
    while let Some(current) = walk.pop() {
        let read_dir = std::fs::read_dir(&current).map_err(|e| format!("read dir {}: {}", current.display(), e))?;
        for entry in read_dir {
            let entry = entry.map_err(|e| format!("entry: {}", e))?;
            let path = entry.path();
            let relative = path.strip_prefix(&dir).unwrap_or(&path).to_string_lossy().to_string();
            let metadata = entry.metadata().ok();
            let modified = metadata.as_ref().and_then(|m| m.modified().ok())
                .map(|t| {
                    let secs = t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
                    chrono::DateTime::from_timestamp(secs as i64, 0)
                        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
                        .unwrap_or_default()
                })
                .unwrap_or_default();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            entries.push(FileEntry {
                path: relative,
                size: metadata.as_ref().map(|m| m.len()).unwrap_or(0),
                modified,
                is_dir,
            });
            if is_dir {
                walk.push(path);
            }
        }
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(entries)
}

#[tauri::command]
fn get_ops_stats(app: tauri::AppHandle) -> Result<OpsStats, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("data dir: {}", e))?;
    let mut total_size = 0u64;
    let mut memory_facts = 0usize;

    let mut walk = vec![dir.clone()];
    while let Some(current) = walk.pop() {
        let read_dir = match std::fs::read_dir(&current) {
            Ok(d) => d,
            Err(_) => continue,
        };
        for entry in read_dir {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    walk.push(entry.path());
                } else {
                    total_size += meta.len();
                }
            }
        }
    }

    let memory_dir = dir.join("memory");
    if memory_dir.exists() {
        if let Ok(read_dir) = std::fs::read_dir(&memory_dir) {
            for entry in read_dir {
                if let Ok(entry) = entry {
                    // count thoughts.jsonl lines
                    let thoughts = entry.path().join("thoughts.jsonl");
                    if thoughts.exists() {
                        if let Ok(content) = std::fs::read_to_string(&thoughts) {
                            memory_facts += content.lines().count();
                        }
                    }
                    // count facts.json entries
                    let facts = entry.path().join("facts.json");
                    if facts.exists() {
                        if let Ok(content) = std::fs::read_to_string(&facts) {
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                                if let Some(arr) = v.as_array() {
                                    memory_facts += arr.len();
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let conv_dir = dir.join("conversations");
    let today_path = conv_dir.join(format!("{}.jsonl", today));
    let today_convs = if today_path.exists() {
        std::fs::read_to_string(&today_path).map(|c| c.lines().count()).unwrap_or(0)
    } else {
        0
    };

    let total_convs = if conv_dir.exists() {
        let mut total = 0;
        if let Ok(read_dir) = std::fs::read_dir(&conv_dir) {
            for entry in read_dir {
                if let Ok(entry) = entry {
                    if let Ok(content) = std::fs::read_to_string(&entry.path()) {
                        total += content.lines().count();
                    }
                }
            }
        }
        total
    } else {
        0
    };

    let last_prompt_size = {
        let p = dir.join("last_prompt.txt");
        if p.exists() {
            std::fs::metadata(&p).map(|m| m.len() as usize).unwrap_or(0)
        } else {
            0
        }
    };

    let log_size = {
        let p = dir.join("waifu-agent.log");
        if p.exists() {
            std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0)
        } else {
            0
        }
    };

    Ok(OpsStats {
        memory_facts_count: memory_facts,
        today_conversations: today_convs,
        total_conversations: total_convs,
        last_prompt_size,
        log_size,
        total_app_data_size: total_size,
    })
}

#[tauri::command]
fn read_file_content(app: tauri::AppHandle, relative_path: String) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("data dir: {}", e))?;
    let full_path = dir.join(&relative_path);
    // Security: ensure resolved path stays inside app_data_dir
    let canonical_dir = dir.canonicalize().map_err(|e| format!("canonicalize dir: {}", e))?;
    let canonical_path = full_path.canonicalize().map_err(|e| format!("file not found: {}", e))?;
    if !canonical_path.starts_with(&canonical_dir) {
        return Err("Access denied".to_string());
    }
    let metadata = std::fs::metadata(&canonical_path).map_err(|e| format!("stat: {}", e))?;
    if metadata.len() > 1_048_576 {
        return Err("File too large (>1MB)".to_string());
    }
    std::fs::read_to_string(&canonical_path).map_err(|e| format!("read file: {}", e))
}

#[tauri::command]
fn ops_open_explorer(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("data dir: {}", e))?;
    let path = dir.to_string_lossy().to_string();
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("open explorer: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("open: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("open: {}", e))?;
    }
    Ok(path)
}

#[tauri::command]
fn ops_clear_log(app: tauri::AppHandle) -> Result<(), String> {
    let mut p = app.path().app_data_dir().map_err(|e| format!("data dir: {}", e))?;
    p.push("waifu-agent.log");
    std::fs::write(&p, "").map_err(|e| format!("clear log: {}", e))
}

// ── 运维面板 commands end ──

// ── Sticker generation ────────────────────────────

const STICKER_EMOTIONS: &[(&str, &str)] = &[
    ("happy", "A cute anime cat-girl chibi sticker, silver hair blue eyes, happy excited expression with sparkles, white background, clean kawaii style, perfect for emoji sticker"),
    ("surprised", "A cute anime cat-girl chibi sticker, silver hair blue eyes, surprised shocked expression with wide eyes, white background, clean kawaii style, emoji sticker"),
    ("angry", "A cute anime cat-girl chibi sticker, silver hair blue eyes, pouting angry expression blushing, white background, clean kawaii style, emoji sticker"),
    ("sad", "A cute anime cat-girl chibi sticker, silver hair blue eyes, sleepy tired sad expression, white background, clean kawaii style, emoji sticker"),
    ("shy", "A cute anime cat-girl chibi sticker, silver hair blue eyes, shy blushing expression looking away embarrassed, white background, clean kawaii style, emoji sticker"),
    ("loving", "A cute anime cat-girl chibi sticker, silver hair blue eyes, loving affectionate expression with hearts, white background, clean kawaii style, emoji sticker"),
];

const IMAGE_API_URL: &str = "https://litechipcloud.cn/v1/images/generations";

#[tauri::command]
async fn generate_sticker(
    app: tauri::AppHandle,
    emotion: String,
    api_key: String,
    model: String,
    key: Option<String>,
    prompt: Option<String>,
    user_text: Option<String>,
) -> Result<String, String> {
    let key = key.unwrap_or_default();
    let prompt_override = prompt.unwrap_or_default();

    let cache_dir = app.path().app_data_dir().map_err(|e| format!("data dir: {}", e))?
        .join("stickers");
    let _ = std::fs::create_dir_all(&cache_dir);

    // Cache key = sticker key + context hash.
    // Cache key = hash(user_text). Pure content-based dedup.
    // No scene prefix — same input always maps to the same file,
    // regardless of which emotion/sticker was matched.
    let cache_filename = {
        let raw = user_text.as_deref().unwrap_or("");
        if raw.is_empty() {
            format!("{}.png", emotion) // fallback: no user text
        } else {
            let h = raw.bytes().fold(5381u64, |h, b| h.wrapping_mul(33).wrapping_add(b as u64));
            format!("{:08x}.png", h)
        }
    };
    let cache_path = cache_dir.join(&cache_filename);
    log_debug(&format!("[Sticker] generate: emotion={} key={} user_text_len={} cache={}", emotion, key, user_text.as_deref().unwrap_or("").len(), cache_path.display()));

    // ── Content-hash cache hit: return immediately ──
    if cache_path.exists() {
        log_debug(&format!("[Sticker] content-hash hit: {}", cache_path.display()));
        return Ok(cache_path.to_string_lossy().to_string());
    }

    // ── Determine prompt ──
    let prompt = if !prompt_override.is_empty() {
        prompt_override
    } else {
        STICKER_EMOTIONS.iter()
            .find(|(e, _)| *e == emotion)
            .map(|(_, p)| *p)
            .unwrap_or("A cute anime cat-girl chibi sticker, silver hair blue eyes, neutral expression, white background, clean kawaii style")
            .to_string()
    };

    // ── Log prompt for ops/debug ──
    let prompt_preview: String = prompt.chars().take(120).collect();
    log_debug(&format!("[Sticker] prompt: {}...", prompt_preview));

    // ── Try API generation; fallback to legacy cache on failure ──
    let client = reqwest::Client::new();
    let api_outcome: Result<Vec<u8>, String> = async {
        let resp: serde_json::Value = client
            .post(IMAGE_API_URL)
            .header("Authorization", format!("Bearer {}", api_key))
            .json(&serde_json::json!({
                "model": model,
                "prompt": prompt,
                "size": "1024x1024",
            }))
            .send().await.map_err(|e| format!("API request: {}", e))?
            .json().await.map_err(|e| format!("API response: {}", e))?;

        if let Some(err) = resp.get("error") {
            let msg = err["message"].as_str().unwrap_or("unknown error");
            return Err(format!("API error: {}", msg));
        }

        if let Some(url) = resp["data"][0]["url"].as_str() {
            let dl = reqwest::get(url).await.map_err(|e| format!("download: {}", e))?;
            Ok(dl.bytes().await.map_err(|e| format!("read bytes: {}", e))?.to_vec())
        } else if let Some(b64) = resp["data"][0]["b64_json"].as_str() {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|e| format!("base64 decode: {}", e))
        } else {
            Err(format!("no image url or b64_json in response"))
        }
    }.await;

    match api_outcome {
        Ok(image_data) => {
            std::fs::write(&cache_path, &image_data).map_err(|e| format!("save: {}", e))?;
            log_debug(&format!("[Sticker] API success → saved: {}", cache_path.display()));

            // Append prompt record for ops panel
            let record = serde_json::json!({
                "time": chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                "emotion": emotion,
                "key": key,
                "prompt": prompt,
                "cache": cache_path.to_string_lossy(),
            });
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(cache_dir.join("prompts.jsonl")) {
                use std::io::Write;
                let _ = writeln!(f, "{}", record);
            }
        }
        Err(api_err) => {
            log_debug(&format!("[Sticker] API failed: {} — trying legacy fallback", api_err));
            // Legacy cache as fallback: {key}.png, {emotion}.png
            let legacy_names: Vec<String> = if !key.is_empty() {
                vec![format!("{}.png", key), format!("{}.png", emotion)]
            } else {
                vec![format!("{}.png", emotion)]
            };
            for name in &legacy_names {
                let fallback = cache_dir.join(name);
                if fallback.exists() {
                    log_debug(&format!("[Sticker] legacy fallback: {}", fallback.display()));
                    return Ok(fallback.to_string_lossy().to_string());
                }
            }
            // No legacy cache — better to show nothing than a wrong sticker
            return Err(api_err);
        }
    }

    // Global cap: keep at most 100 sticker images
    if let Ok(entries) = std::fs::read_dir(&cache_dir) {
        let mut files: Vec<_> = entries
            .flatten()
            .filter(|e| e.path().extension().map_or(false, |ext| ext == "png"))
            .filter_map(|e| {
                let modified = e.metadata().ok()?.modified().ok()?;
                Some((e.path(), modified))
            })
            .collect();
        if files.len() > 100 {
            files.sort_by_key(|(_, m)| *m);
            for (path, _) in files.iter().take(files.len() - 100) {
                let _ = std::fs::remove_file(path);
            }
        }
    }

    Ok(cache_path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            start_dragging_window,
            play_tts_audio,
            stop_tts_audio,
            send_message,
            quick_chat,
            quick_chat_stream,
            chat_stream_continue,
            analyze_screen,
            execute_builtin_tool,
            quick_speak,
            edge_tts,
            save_turn,
            distill_memory,
            frontend_log,
            save_window_position,
            load_window_position,
            load_settings,
            save_settings,
            load_user_md,
            load_memory_md,
            save_user_md,
            get_trending,
            fetch_sponsors,
            read_sponsors_cache,
            portrait_save,
            portrait_exists,
            has_knowledge_base,
            save_history,
            load_history,
            append_memory,
            memory_configure,
            memory_recall,
            memory_extract,
            stt_transcribe,
            set_always_on_top,
            set_skip_taskbar,
            set_window_size,
            set_autostart,
            exit_app,
            get_machine_code,
            auth_activate,
            verify_machine_code,
            auth_check_gitee,
            auth_verify,
            save_auth_token,
            load_auth_token,
            clear_auth_token,
            set_log_enabled,
            clear_memory,
            read_log_lines,
            list_app_data,
            get_ops_stats,
            read_file_content,
            ops_open_explorer,
            ops_clear_log,
            generate_sticker,
        ])
        .setup(|app| {
            // Initialize app log path
            if let Ok(dir) = app.path().app_data_dir() {
                let _ = std::fs::create_dir_all(&dir);
                let log_path = dir.join("waifu-agent.log");
                let prev_path = dir.join("waifu-agent.prev.log");
                // 轮转：上次的日志保留为 .prev.log，当前清空
                if log_path.exists() {
                    let _ = std::fs::rename(&log_path, &prev_path);
                }
                let _ = std::fs::write(&log_path, "");
                // temp 目录同理
                let tmp_log = std::env::temp_dir().join("waifu-agent.log");
                let tmp_prev = std::env::temp_dir().join("waifu-agent.prev.log");
                if tmp_log.exists() {
                    let _ = std::fs::rename(&tmp_log, &tmp_prev);
                }
                let _ = std::fs::write(&tmp_log, "");
                APP_LOG_PATH.set(log_path.clone()).ok();
                log_debug(&format!("Log started: {}", log_path.display()));
            }

            // ── STT daemon: 后台加载 whisper 模型，避免每次录音重新加载 ──
            let stt_python = bundled_python(&app.handle());
            let stt_small = std::path::Path::new(&stt_python)
                .parent().unwrap()
                .join("models").join("faster-whisper-small");
            let stt_base = std::path::Path::new(&stt_python)
                .parent().unwrap()
                .join("models").join("faster-whisper-base");
            let stt_model_dir = if stt_small.join("model.bin").exists() {
                log_debug("[STT] using small model");
                stt_small.to_string_lossy().to_string().strip_prefix(r"\\?\").unwrap_or(&stt_small.to_string_lossy()).to_string()
            } else if stt_base.join("model.bin").exists() {
                log_debug("[STT] using base model");
                stt_base.to_string_lossy().to_string().strip_prefix(r"\\?\").unwrap_or(&stt_base.to_string_lossy()).to_string()
            } else {
                log_debug("[STT] no model found, STT disabled");
                "".to_string()
            };
            std::thread::spawn(move || {
                match stt::start_daemon(&stt_python, &stt_model_dir) {
                    Ok(()) => log_debug("[STT] daemon ready"),
                    Err(e) => log_debug(&format!("[STT] daemon start failed (will use oneshot): {}", e)),
                }
            });

            // ── Trending news: 启动时抓一次，之后 2h 刷新 ──
            tauri::async_runtime::spawn(async move {
                match fetch_trending(5).await {
                    Some(text) => {
                        if let Ok(mut cache) = TRENDING_CACHE.write() {
                            *cache = text;
                        }
                        log_debug("[trending] initial fetch OK");
                    }
                    None => log_debug("[trending] initial fetch empty"),
                }
                trending_refresh_loop().await;
            });

            // ── TTS daemon: 后台启动 edge-tts daemon ──
            let tts_python = bundled_python(&app.handle());
            std::thread::spawn(move || {
                match tts_daemon::start_daemon(&tts_python) {
                    Ok(()) => log_debug("[TTS] daemon ready"),
                    Err(e) => log_debug(&format!("[TTS] daemon start failed (will use oneshot): {}", e)),
                }
            });

            // ── WS relay: 内置 WebSocket 中继 (companion + relay 模式共用) ──
            tauri::async_runtime::spawn(async move {
                ws_relay::start().await;
            });

            // ── Restore window position BEFORE showing ──
            // 避免窗口先出现在默认位置再跳到保存位置
            log_debug("[STARTUP] setup() begin — restoring window position");
            if let Some(window) = app.get_webview_window("main") {
                // 消除 Windows 无框透明窗口的系统阴影 (细边框)
                let _ = window.set_shadow(false);
                let mut positioned = false;
                if let Ok(dir) = app.path().app_data_dir() {
                    let pos_path = dir.join("window_pos.json");
                    if pos_path.exists() {
                        if let Ok(content) = std::fs::read_to_string(&pos_path) {
                            if let Ok(data) = serde_json::from_str::<serde_json::Value>(&content) {
                                if let (Some(x), Some(y)) = (data["x"].as_i64(), data["y"].as_i64()) {
                                    let _ = window.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
                                    positioned = true;
                                    log_debug(&format!("[STARTUP] restored position ({}, {})", x, y));
                                }
                            }
                        }
                    }
                }
                // 没有保存位置时, 居中显示 (首次启动)
                if !positioned {
                    if let Ok(Some(monitor)) = window.primary_monitor() {
                        let ms = monitor.size();
                        let ws = window.outer_size().unwrap_or(tauri::PhysicalSize::new(600, 800));
                        let cx = ((ms.width as i32) - (ws.width as i32)) / 2;
                        let cy = ((ms.height as i32) - (ws.height as i32)) / 2;
                        let _ = window.set_position(tauri::PhysicalPosition::new(cx.max(0), cy.max(0)));
                        log_debug(&format!("[STARTUP] centered at ({}, {})", cx.max(0), cy.max(0)));
                    }
                }
                // 恢复保存的窗口尺寸 (在 show 之前，避免启动动画一闪)
                if let Ok(dir) = app.path().app_data_dir() {
                    let settings_path = dir.join("settings.json");
                    if let Ok(content) = std::fs::read_to_string(&settings_path) {
                        if let Ok(data) = serde_json::from_str::<serde_json::Value>(&content) {
                            if let (Some(w), Some(h)) = (
                                data["window"]["width"].as_u64(),
                                data["window"]["height"].as_u64(),
                            ) {
                                let _ = window.set_size(tauri::LogicalSize::new(w as f64, h as f64));
                                log_debug(&format!("[STARTUP] restored size {}×{}", w, h));
                            }
                        }
                    }
                }
                log_debug("[STARTUP] calling window.show()");
                let _ = window.show();
                log_debug("[STARTUP] window.show() returned");
            }

            use tauri::tray::{TrayIconBuilder, TrayIconEvent};
            use tauri::menu::{MenuBuilder, MenuItemBuilder};

            let show_item = MenuItemBuilder::with_id("show", "显示").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .item(&quit_item)
                .build()?;

            let _tray = TrayIconBuilder::with_id("waifu-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("waifu-agent")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            // 退出前保存窗口位置
                            if let Some(w) = app.get_webview_window("main") {
                                if let Ok(pos) = w.outer_position() {
                                    if let Ok(dir) = app.path().app_data_dir() {
                                        let pos_path = dir.join("window_pos.json");
                                        let data = serde_json::json!({"x": pos.x, "y": pos.y});
                                        let _ = std::fs::write(&pos_path, serde_json::to_string_pretty(&data).unwrap_or_default());
                                    }
                                }
                            }
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::DoubleClick {
                        button: tauri::tray::MouseButton::Left, ..
                    } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // On window close, hide to tray instead of quitting
            // 同时保存当前窗口位置, 确保下次启动在同一位置
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // 保存位置
                        if let Ok(pos) = window_clone.outer_position() {
                            if let Ok(dir) = window_clone.app_handle().path().app_data_dir() {
                                let pos_path = dir.join("window_pos.json");
                                let data = serde_json::json!({"x": pos.x, "y": pos.y});
                                let _ = std::fs::write(&pos_path, serde_json::to_string_pretty(&data).unwrap_or_default());
                            }
                        }
                        let _ = window_clone.hide();
                        api.prevent_close();
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
