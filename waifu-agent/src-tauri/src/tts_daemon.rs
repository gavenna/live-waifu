// tts_daemon.rs — edge-tts 常驻 daemon（stdin/stdout JSON）
//
// 避免每句话重新 spawn Python 加载 edge_tts 库。

use std::io::{BufRead, BufReader, Write};
use std::os::windows::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

static TTS_DAEMON: Mutex<Option<Child>> = Mutex::new(None);

/// 启动 TTS daemon（应用启动时调一次）
pub fn start_daemon(python_path: &str) -> Result<(), String> {
    // 先杀旧 daemon
    {
        let mut guard = TTS_DAEMON.lock().map_err(|e| format!("lock: {}", e))?;
        if let Some(ref mut child) = *guard {
            let _ = child.kill();
            let _ = child.wait();
        }
        *guard = None;
    }

    let daemon_code = r#"
import sys, json, asyncio, base64
from edge_tts import Communicate

async def handle(text, path):
    last_err = None
    for attempt in range(3):
        try:
            c = Communicate(text, voice='zh-CN-XiaoxiaoNeural')
            await c.save(path)
            return
        except Exception as e:
            last_err = e
            if attempt < 2:
                await asyncio.sleep(1.0 * (attempt + 1))
    raise last_err

async def main():
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line or line == "exit": break
        try:
            req = json.loads(line)
            await handle(req["text"], req["path"])
            print(json.dumps({"ok": True}), flush=True)
        except Exception as e:
            print(json.dumps({"ok": False, "error": str(e)}), flush=True)

asyncio.run(main())
"#;

    let mut child = Command::new(python_path)
        .args(["-c", daemon_code])
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(0x08000000)
        .spawn()
        .map_err(|e| format!("spawn tts daemon: {}", e))?;

    // 等待就绪
    let ready_line = {
        if let Some(ref mut stdout) = child.stdout {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            reader.read_line(&mut line).map_err(|e| format!("read ready: {}", e))?;
            line
        } else {
            return Err("no stdout".into());
        }
    };

    if !ready_line.contains("\"ready\"") {
        let stderr = child.stderr.as_mut()
            .map(|s| BufReader::new(s).lines().filter_map(|l| l.ok()).collect::<Vec<_>>().join("\n"))
            .unwrap_or_default();
        return Err(format!("tts daemon unexpected: {} (stderr: {})", ready_line.trim(), stderr));
    }

    {
        let mut guard = TTS_DAEMON.lock().map_err(|e| format!("lock: {}", e))?;
        *guard = Some(child);
    }

    Ok(())
}

/// 通过 daemon 生成 TTS 音频
/// 返回 Ok(()) 表示 mp3_path 已写入，调用方读取文件
pub fn generate(python_path: &str, text: &str, mp3_path: &str) -> Result<(), String> {
    let mut guard = TTS_DAEMON.lock().map_err(|e| format!("lock: {}", e))?;

    match guard.as_mut() {
        Some(ref mut child) => {
            let req = serde_json::json!({"text": text, "path": mp3_path});
            if let Some(ref mut stdin) = child.stdin {
                writeln!(stdin, "{}", req).map_err(|e| format!("write stdin: {}", e))?;
                stdin.flush().map_err(|e| format!("flush: {}", e))?;
            } else {
                return Err("daemon stdin gone".into());
            }

            if let Some(ref mut stdout) = child.stdout {
                let mut reader = BufReader::new(stdout);
                let mut line = String::new();
                reader.read_line(&mut line).map_err(|e| format!("read response: {}", e))?;
                let resp: serde_json::Value = serde_json::from_str(&line)
                    .map_err(|e| format!("parse: {} ({})", e, line.trim()))?;
                if resp["ok"].as_bool() == Some(true) {
                    return Ok(());
                }
                let err = resp["error"].as_str().unwrap_or("unknown");
                return Err(format!("tts daemon: {}", err));
            }
            Err("daemon stdout gone".into())
        }
        None => {
            // Daemon 未启动 — 回退到单次模式
            drop(guard);
            generate_oneshot(python_path, text, mp3_path)
        }
    }
}

/// 单次模式回退
fn generate_oneshot(python_path: &str, text: &str, mp3_path: &str) -> Result<(), String> {
    let code = r#"
import sys, asyncio
from edge_tts import Communicate
async def main():
    c = Communicate(sys.argv[1], voice='zh-CN-XiaoxiaoNeural')
    await c.save(sys.argv[2])
asyncio.run(main())
"#;
    let output = Command::new(python_path)
        .args(["-c", code, text, mp3_path])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("python: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("edge-tts: {}", stderr.trim()));
    }
    Ok(())
}
