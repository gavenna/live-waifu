/// memory_bridge — 调用 waifu-memory Python CLI
///
/// 每次调用 spawn 一个 Python subprocess。
/// 配置通过 configure 写入 app_data_dir/memory/config.json，
/// 后续命令从该文件读取。
use std::os::windows::process::CommandExt;
use std::process::Command;
use serde_json::Value;
use tauri::Manager;

/// Python 可执行文件路径
fn python_cmd() -> String {
    if let Ok(p) = std::env::var("WAIFU_PYTHON") { return p; }
    if cfg!(target_os = "windows") { "python".into() } else { "python3".into() }
}

/// waifu-memory/cli.py 的路径
fn cli_path(app: &tauri::AppHandle) -> String {
    if let Ok(p) = std::env::var("WAIFU_MEMORY_CLI") {
        return p;
    }
    app.path().resource_dir()
        .map(|d| d.join("waifu-memory").join("cli.py"))
        .unwrap_or_else(|_| std::path::PathBuf::from("waifu-memory/cli.py"))
        .to_string_lossy()
        .to_string()
}

/// 调用 CLI, 返回 stdout (JSON)。CLI 文件不存在时返回 Ok(Value::Null)
fn call_cli(app: &tauri::AppHandle, args: &[&str]) -> Result<Value, String> {
    let path = cli_path(app);
    if !std::path::Path::new(&path).exists() {
        return Ok(Value::Null); // 打包环境无 CLI，静默跳过
    }
    let output = Command::new(python_cmd())
        .creation_flags(0x08000000)
        .arg(&path)
        .args(args)
        .output()
        .map_err(|e| format!("spawn memory CLI: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        let err_msg = if !stderr.is_empty() { &stderr } else { &stdout };
        return Err(format!("memory CLI error: {}", err_msg.trim()));
    }

    serde_json::from_str(&stdout)
        .map_err(|e| format!("parse CLI output ({}): {}", stdout.chars().take(200).collect::<String>(), e))
}

/// 初始化记忆系统配置（应用启动时调一次）
pub fn memory_configure(
    app: &tauri::AppHandle,
    memory_dir: &str,
    api_url: &str,
    api_key: &str,
    model: &str,
    character: &str,
    master: &str,
) -> Result<(), String> {
    let result = call_cli(app, &["configure", memory_dir, api_url, api_key, model, character, master])?;
    if result.is_null() { return Ok(()); } // CLI 不存在，静默跳过
    Ok(())
}

/// 语义召回 — 搜与 query 最相关的记忆
pub fn memory_recall(app: &tauri::AppHandle, query: &str, top_k: usize) -> Result<Vec<Value>, String> {
    let result = call_cli(app, &["recall", query, &top_k.to_string()])?;
    if result.is_null() { return Ok(vec![]); }
    Ok(result.as_array().cloned().unwrap_or_default())
}

/// 自动提取事实 — 从对话消息中提取
pub fn memory_extract(app: &tauri::AppHandle, messages: &[Value]) -> Result<Vec<Value>, String> {
    let json = serde_json::to_string(messages).map_err(|e| format!("serialize messages: {}", e))?;
    let result = call_cli(app, &["extract", &json])?;
    if result.is_null() { return Ok(vec![]); }
    Ok(result.as_array().cloned().unwrap_or_default())
}

