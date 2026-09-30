"""Stop Hook: Claude 回复结束 → 提取文本 → edge-tts → WS → waifu 朗读

启动方式: 由 Claude Code Stop hook 自动调用，无需手动运行。
依赖: pip install edge-tts websockets

协议:
  读取 stdin JSON → { session_id, transcript_path, cwd }
  → 定位 session JSONL → 提取最后一段 assistant text
  → 规则清洗 → edge-tts → base64
  → WS 连接 127.0.0.1:9191 → agent:start → agent:end → tts:audio
"""
import asyncio, json, os, re, sys, base64
from pathlib import Path
from typing import Optional

# ── 配置 ──────────────────────────────────
WS_URL = os.environ.get("WAIFU_WS_URL", "ws://127.0.0.1:9191/status")
TTS_VOICE = "zh-CN-XiaoxiaoNeural"
TTS_CHAR_MS = 200       # 每字估算时长
MAX_PREVIEW = 80        # 最多取 80 字朗读
MIN_TEXT = 10           # 少于 10 字就跳过
# ──────────────────────────────────────────


async def tts(text: str, retries: int = 2) -> tuple[str, int]:
    """edge-tts → base64 MP3 + 估算时长(ms)，间歇性 NoAudio 自动重试"""
    import edge_tts
    last_err = None
    for attempt in range(retries + 1):
        try:
            communicate = edge_tts.Communicate(text, TTS_VOICE, rate="-10%")
            data = b""
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    data += chunk["data"]
            if not data:
                last_err = "NoAudioReceived"
                if attempt < retries:
                    await asyncio.sleep(1)
                    continue
                return "", 0
            b64 = base64.b64encode(data).decode("ascii")
            dur = max(2000, min(15000, len(text) * TTS_CHAR_MS))
            return b64, dur
        except Exception as e:
            last_err = str(e)
            if attempt < retries:
                await asyncio.sleep(1)
                continue
            raise
    return "", 0


def extract_last_assistant(session_dir: Path) -> Optional[str]:
    """从 session JSONL 提取最后一轮 assistant text"""
    jsonl_path = session_dir.with_suffix(".jsonl")
    if not jsonl_path.exists():
        return None

    with open(jsonl_path, encoding="utf-8") as f:
        lines = f.readlines()

    last_text = ""
    for line in lines:
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        msg = d.get("message", {})
        if msg.get("role") != "assistant":
            continue
        content = msg.get("content", [])
        if not isinstance(content, list):
            continue
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                last_text = block.get("text", "")

    return last_text if last_text else None


def clean(text: str) -> str:
    """规则清洗：去代码块 / inline code / URL / 标记 → 取前 80 字"""
    # 去代码块 ```...```
    text = re.sub(r"```[\s\S]*?```", "", text)
    # 去 inline code `...`
    text = re.sub(r"`[^`]+`", "", text)
    # 去 URL
    text = re.sub(r"https?://\S+", "", text)
    # 去 Markdown 标记
    text = re.sub(r"[#*_~>{}\[\]|]", "", text)
    # 去表格行
    text = re.sub(r"\|.*\|", "", text)
    # 去空行
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    text = "，".join(lines)
    # 合并空白
    text = re.sub(r"\s+", " ", text).strip()
    # 取前 N 字（按字符取，不按字节）
    short = text[:MAX_PREVIEW]
    # 如果截断点不是句子结束，在最后一个句号/问号/感叹号处截断
    if len(text) > MAX_PREVIEW:
        for sep in ["。", "！", "？", "\n"]:
            idx = short.rfind(sep)
            if idx > 0:
                short = short[: idx + 1]
                break
    return short


async def send_ws(text: str, audio_b64: str, duration_ms: int):
    """连接 WS → 发送 agent:start → agent:end → tts:audio"""
    import websockets
    try:
        async with websockets.connect(WS_URL) as ws:
            await ws.send(json.dumps({
                "type": "agent:start",
                "message": "waifu companion reading",
            }))
            await ws.send(json.dumps({
                "type": "agent:end",
                "response": text,
            }))
            await ws.send(json.dumps({
                "type": "tts:audio",
                "text": text,
                "audio": audio_b64,
                "duration_ms": duration_ms,
            }))
    except (ConnectionRefusedError, OSError, websockets.WebSocketException):
        pass  # waifu 未启动 → 静默跳过


def is_conversational(text: str) -> bool:
    """快速判断回复是不是对话（而非文档/代码/表格）。含大量标记语法 → 跳过。"""
    # 含表格 → 文档
    if "\n|" in text:
        return False
    # 含代码块 → 技术回复
    if "```" in text:
        return False
    # 超过 500 字 → 大概率是长文档
    if len(text) > 500:
        return False
    return True


async def main():
    try:
        # 1. 读 hook 上下文
        try:
            hook_input = json.loads(sys.stdin.read())
        except (json.JSONDecodeError, OSError):
            return
        session_id = hook_input.get("session_id", "")
        if not session_id:
            return

        # 2. 定位 session JSONL（使用 hook 提供的 transcript_path，无需硬编码项目名）
        transcript_path = hook_input.get("transcript_path", "")
        if not transcript_path:
            return
        jsonl_path = Path(transcript_path)
        if not jsonl_path.exists():
            return

        # 3. 提取 assistant text
        raw_text = extract_last_assistant(jsonl_path)
        if not raw_text:
            return

        # 4. 非对话类回复直接跳过（文档/表格/代码 → 不需要朗读）
        if not is_conversational(raw_text):
            return

        # 5. 清洗
        spoken = clean(raw_text)
        if len(spoken) < MIN_TEXT:
            return

        # 6. TTS
        audio_b64, dur = await tts(spoken)
        if not audio_b64:
            return

        # 7. 发 WS
        await send_ws(spoken, audio_b64, dur)

        # 输出到 Claude transcript 可见，只一行
        print(f"[waifu] 已朗读 {len(spoken)} 字 / {dur}ms", flush=True)
    except Exception:
        # 任何未预期的错误都静默，不喷 traceback 到用户终端
        pass


if __name__ == "__main__":
    asyncio.run(main())
