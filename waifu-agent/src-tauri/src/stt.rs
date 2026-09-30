// stt.rs — faster-whisper 常驻 daemon（stdin/stdout JSON）
//
// 启动时 spawn 一次 Python 进程，加载模型后保持运行。
// 每次转录请求通过 stdin 发送 JSON → stdout 读取结果。

use std::io::{BufRead, BufReader, Write};
use std::os::windows::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

static STT_DAEMON: Mutex<Option<SttDaemon>> = Mutex::new(None);

struct SttDaemon {
    child: Child,
}

/// 启动 STT daemon（应用启动时调一次，后台加载模型不阻塞转录请求）
pub fn start_daemon(python_path: &str, model_path: &str) -> Result<(), String> {
    // 先杀旧 daemon（锁持有时间极短）
    {
        let mut daemon = STT_DAEMON.lock().map_err(|e| format!("lock: {}", e))?;
        if let Some(ref mut d) = *daemon {
            let _ = d.child.kill();
            let _ = d.child.wait();
        }
        *daemon = None; // 清空，加载期间转录走 oneshot
    }

    let daemon_code = format!(r#"
import sys, json
from faster_whisper import WhisperModel
model = WhisperModel(r"{}", device="cpu", compute_type="int8")
print(json.dumps({{"ready": True}}), flush=True)
for line in sys.stdin:
    line = line.strip()
    if not line or line == "exit": break
    try:
        req = json.loads(line)
        segs, _ = model.transcribe(req["wav"], language=req.get("language") or None, beam_size=5, initial_prompt="以下是普通话的句子。")
        text = " ".join(x.text.strip() for x in segs)
        print(json.dumps({{"text": text}}), flush=True)
    except Exception as e:
        print(json.dumps({{"error": str(e)}}), flush=True)
"#, model_path);

    let mut child = Command::new(python_path)
        .args(["-c", &daemon_code])
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .spawn()
        .map_err(|e| format!("spawn stt daemon: {}", e))?;

    // 等待就绪信号 — 不持锁，加载期间转录请求走 oneshot 回退
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
        return Err(format!("stt daemon unexpected: {} (stderr: {})", ready_line.trim(), stderr));
    }

    // 模型就绪 — 写入 daemon 供转录使用
    {
        let mut daemon = STT_DAEMON.lock().map_err(|e| format!("lock: {}", e))?;
        *daemon = Some(SttDaemon { child });
    }

    Ok(())
}

/// 通过 daemon 转录（每次录音时调）
pub fn transcribe(wav_path: &str, python_path: &str, model_path: &str, language: &str) -> Result<String, String> {
    let mut guard = STT_DAEMON.lock().map_err(|e| format!("lock: {}", e))?;

    match guard.as_mut() {
        Some(daemon) => {
            // 发送请求
            let req = serde_json::json!({"wav": wav_path, "language": if language.is_empty() { "zh" } else { language }});
            if let Some(ref mut stdin) = daemon.child.stdin {
                writeln!(stdin, "{}", req).map_err(|e| format!("write stdin: {}", e))?;
                stdin.flush().map_err(|e| format!("flush: {}", e))?;
            }

            // 读取结果
            if let Some(ref mut stdout) = daemon.child.stdout {
                let mut reader = BufReader::new(stdout);
                let mut line = String::new();
                reader.read_line(&mut line).map_err(|e| format!("read stdout: {}", e))?;
                let resp: serde_json::Value = serde_json::from_str(&line)
                    .map_err(|e| format!("parse: {} ({})", e, line.trim()))?;
                if let Some(text) = resp["text"].as_str() {
                    if text.is_empty() {
                        return Err("stt returned empty transcript".into());
                    }
                    return Ok(text.to_string());
                }
                if let Some(err) = resp["error"].as_str() {
                    return Err(format!("stt error: {}", err));
                }
                return Err(format!("unexpected response: {}", line.trim()));
            }
            Err("daemon stdout gone".into())
        }
        None => {
            // Daemon 未启动 — 回退到单次模式
            drop(guard);
            transcribe_oneshot(wav_path, python_path, model_path, language)
        }
    }
}

/// 单次模式（daemon 未启动时的回退）
fn transcribe_oneshot(wav_path: &str, python_path: &str, model_path: &str, language: &str) -> Result<String, String> {
    let stt_code = r#"
import sys
from faster_whisper import WhisperModel
wav, model_dir, lang = sys.argv[1], sys.argv[2], sys.argv[3]
model = WhisperModel(model_dir, device="cpu", compute_type="int8")
segs, _ = model.transcribe(
    wav,
    language=lang or None,
    beam_size=5,
    initial_prompt="以下是普通话的句子。",
)
s = " ".join(x.text.strip() for x in segs)
print(s, end="")
"#;

    let output = Command::new(python_path)
        .args(["-c", stt_code, wav_path, model_path, language])
        .env("PYTHONIOENCODING", "utf-8")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("stt python: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("stt failed: {}", stderr.trim()));
    }

    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        return Err("stt returned empty transcript".into());
    }
    Ok(text)
}
