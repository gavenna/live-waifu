// auth.rs — waifu-auth 激活码验证 + Gitee keys.txt 校验 (v3)
//
// 激活: Vercel API (waifu.eidolonagent.xyz) → Neon 校验激活码 → 写 Gitee keys.txt
// 验证: curl Gitee raw keys.txt → 本地 sha256(token) 比对
//
// Gitee raw URL, 可通过 GITEE_AUTH_REPO 环境变量覆盖
// 默认: https://gitee.com/gaven6666/waifu-agent-key/raw/master/keys.txt

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Sha256, Digest};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use tauri::Manager;

fn auth_base() -> String {
    if let Ok(url) = std::env::var("AUTH_API_URL") {
        return url;
    }
    "https://waifu.eidolonagent.xyz/api".into()
}

/// 计算 token 的 SHA256 哈希（用于跟 keys.txt 比对）
fn token_hash(token: &str) -> String {
    let mut h = Sha256::new();
    h.update(token.as_bytes());
    format!("{:x}", h.finalize())
}

// ── Types ─────────────────────────────────────

#[derive(Serialize)]
struct ActivateBody {
    activation_code: String,
    machine_code: String,
    device_name: String,
}

#[derive(Deserialize)]
struct ApiResponse {
    code: i32,
    data: Option<Value>,
    message: Option<String>,
}

fn extract<T: for<'de> Deserialize<'de>>(data: Option<Value>) -> Result<T, String> {
    match data {
        Some(v) => serde_json::from_value(v).map_err(|e| format!("解析: {}", e)),
        None => Err("响应缺少 data 字段".into()),
    }
}

fn check_err(resp: &ApiResponse) -> Result<(), String> {
    if resp.code == 0 { Ok(()) }
    else { Err(resp.message.clone().unwrap_or_else(|| "未知错误".into())) }
}

#[derive(Deserialize, Serialize, Clone)]
pub struct ActivateData {
    pub access_token: String,
    pub tier: String,
    pub device_limit: i32,
    pub device_count: i32,
    #[serde(default)]
    pub display_id: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AuthToken {
    pub access_token: String,
    pub tier: String,
    pub device_limit: i32,
    #[serde(default)]
    pub machine_code: String,
    #[serde(default)]
    pub display_id: String,
}

// ── Machine Code ──────────────────────────────

pub fn get_machine_code() -> String {
    use sysinfo::System;
    let host = System::host_name().unwrap_or_default();
    let os = System::long_os_version().unwrap_or_default();
    let fingerprint = format!("{}-{}", host, os);
    let mut h = Sha256::new();
    h.update(fingerprint.as_bytes());
    format!("{:x}", h.finalize())
}

// ── HTTP Helpers ──────────────────────────────

async fn api_post(path: &str, body: String, token: Option<&str>) -> Result<ApiResponse, String> {
    let url = format!("{}/{}", auth_base(), path);
    let client = reqwest::Client::new();
    let mut req = client.post(&url)
        .header("Content-Type", "application/json")
        .body(body);
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {}", t));
    }
    let resp = req.send().await.map_err(|e| format!("网络错误: {}", e))?;
    // 先读文本，再试 JSON — 方便调试非 JSON 响应（如 HTML 404）
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;
    serde_json::from_str::<ApiResponse>(&text)
        .map_err(|_e| format!("API 响应异常 (HTTP {}, body: {:.200})", status.as_u16(), text))
}

// ── API Functions ─────────────────────────────

pub async fn auth_activate(activation_code: &str, machine_code: &str, device_name: &str) -> Result<ActivateData, String> {
    let body = serde_json::to_string(&ActivateBody {
        activation_code: activation_code.to_string(),
        machine_code: machine_code.to_string(),
        device_name: device_name.to_string(),
    }).map_err(|e| format!("序列化: {}", e))?;
    let resp = api_post("auth-activate", body, None).await?;
    check_err(&resp)?;
    extract(resp.data)
}

/// 验证机器码是否匹配（token 从别的机器复制过来时拦截）
pub fn verify_machine_code(stored_machine: &str) -> Result<(), String> {
    let current = get_machine_code();
    if stored_machine.is_empty() || stored_machine == current {
        Ok(())
    } else {
        Err("机器码不匹配：token 可能来自其他设备，请重新激活".into())
    }
}

/// 通过 git pull 同步 keys.txt 到本地，零 API 调用，不受限流影响
pub fn auth_check_gitee(token: &str) -> Result<(), String> {
    let hash = token_hash(token);

    // 本地 repo 路径
    let repo_dir = dirs_next().unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("waifu-auth-repo");
    let keys_path = repo_dir.join("keys.txt");

    // 首次 clone 或更新
    let repo_url = std::env::var("GITEE_AUTH_REPO_URL")
        .unwrap_or_else(|_| "https://gitee.com/gaven6666/waifu-agent-key.git".into());

    if repo_dir.join(".git").exists() {
        // 已有 — git fetch + reset (兼容 detached HEAD、shallow clone)
        let fetch = std::process::Command::new("git")
            .creation_flags(0x08000000)
            .args(["-c", "http.proxy=", "-c", "https.proxy=", "-C", &repo_dir.to_string_lossy(), "fetch", "origin", "master"])
            .output()
            .map_err(|e| format!("git fetch: {}", e))?;
        if !fetch.status.success() {
            let stderr = String::from_utf8_lossy(&fetch.stderr);
            return Err(format!("git fetch 失败 (网络不通?): {}", stderr.trim()));
        }
        let reset = std::process::Command::new("git")
            .creation_flags(0x08000000)
            .args(["-C", &repo_dir.to_string_lossy(), "reset", "--hard", "origin/master"])
            .output()
            .map_err(|e| format!("git reset: {}", e))?;
        if !reset.status.success() {
            let stderr = String::from_utf8_lossy(&reset.stderr);
            return Err(format!("git reset 失败: {}", stderr.trim()));
        }
    } else {
        // 首次 — git clone
        let output = std::process::Command::new("git")
            .creation_flags(0x08000000)
            .args(["-c", "http.proxy=", "-c", "https.proxy=", "clone", "--depth", "1", &repo_url, &repo_dir.to_string_lossy()])
            .output()
            .map_err(|e| format!("git clone: {}", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git clone 失败 (URL: {}): {}", repo_url, stderr.trim()));
        }
    }

    // 读取本地 keys.txt
    let body = std::fs::read_to_string(&keys_path)
        .map_err(|e| format!("读取 keys.txt: {}", e))?;

    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if trimmed == hash {
            return Ok(());
        }
    }
    Err("未授权：token 不在许可列表中".into())
}

/// 获取 data dir 的跨平台路径
fn dirs_next() -> Option<std::path::PathBuf> {
    Some(std::path::PathBuf::from(
        std::env::var("APPDATA").or_else(|_| std::env::var("HOME")).unwrap_or_default()
    ))
}

// ── Token Persistence ─────────────────────────

fn token_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut p = app.path().app_data_dir().map_err(|e| format!("data dir: {}", e))?;
    std::fs::create_dir_all(&p).map_err(|e| format!("mkdir: {}", e))?;
    p.push("license.dat");
    Ok(p)
}

pub fn save_auth_token(app: &tauri::AppHandle, token: &AuthToken) -> Result<(), String> {
    let p = token_path(app)?;
    let json = serde_json::to_string(token).map_err(|e| format!("序列化: {}", e))?;
    std::fs::write(&p, json).map_err(|e| format!("写入: {}", e))
}

pub fn load_auth_token(app: &tauri::AppHandle) -> Result<Option<AuthToken>, String> {
    let p = token_path(app)?;
    if !p.exists() { return Ok(None); }
    let content = std::fs::read_to_string(&p).map_err(|e| format!("读取: {}", e))?;
    serde_json::from_str::<AuthToken>(&content)
        .map(Some)
        .map_err(|e| format!("解析: {}", e))
}

pub fn clear_auth_token(app: &tauri::AppHandle) -> Result<(), String> {
    let p = token_path(app)?;
    if p.exists() { std::fs::remove_file(&p).map_err(|e| format!("删除: {}", e))?; }
    Ok(())
}

/// Vercel auth_verify — 可靠校验（消耗 Vercel/Neon，Gitee 不通时回退用）
pub async fn auth_verify(access_token: &str, machine_code: &str) -> Result<Value, String> {
    let url = format!("{}/auth-verify?machine_code={}", auth_base(), machine_code);
    let client = reqwest::Client::new();
    let resp = client.get(&url)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("User-Agent", "waifu-agent")
        .timeout(std::time::Duration::from_secs(10))
        .send().await
        .map_err(|e| format!("Vercel 网络错误: {}", e))?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| format!("读取响应: {}", e))?;
    let data: Value = serde_json::from_str(&body)
        .map_err(|e| format!("解析 Vercel 响应 (HTTP {}): {} (body: {:.200})", status.as_u16(), e, body))?;
    if data["code"].as_i64() != Some(0) {
        return Err(data["message"].as_str().unwrap_or("未知错误").to_string());
    }
    Ok(data)
}
