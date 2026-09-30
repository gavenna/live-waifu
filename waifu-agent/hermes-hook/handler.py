"""
waifu-agent status pusher — Hermes Gateway Hook

Listens for agent:start / agent:step / agent:end events from the gateway
and pushes them to the waifu-agent desktop app via WebSocket.

v0.4.0 — Added TTS support: after agent:end, generates audio via edge-tts
and broadcasts base64-encoded WAV data to the desktop for playback.

The handler starts a small WebSocket server on first invocation and keeps
it running. The desktop app connects to ws://localhost:9191/status to
receive real-time agent status updates.
"""

import asyncio
import base64
import json
import logging
import re
import socket
from datetime import datetime

logger = logging.getLogger(__name__)

# WebSocket server state
_ws_server = None
_ws_port = 9191
_clients = set()  # set of websocket connections

# ---- TTS background tasks ----
# Keep strong references to asyncio tasks to prevent garbage collection
# (Python 3.10 may GC unreferenced tasks before they complete)
_tts_tasks = set()

# ---- TTS constants ----
_TTS_MAX_CHARS = 500      # max text chars to synthesize
_TTS_VOICE = "zh-CN-XiaoxiaoNeural"


def _find_free_port(start: int) -> int:
    """Find a free port starting from 'start'."""
    port = start
    while port < start + 100:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.bind(("127.0.0.1", port))
            s.close()
            return port
        except OSError:
            port += 1
    return start  # fallback — let it fail later with a clearer error


async def _ws_handler(websocket):
    """Handle a new WebSocket client connection."""
    remote = websocket.remote_address
    logger.info("waifu-agent status client connected: %s", remote)
    _clients.add(websocket)
    try:
        # Send a "connected" message to confirm the link
        await websocket.send(json.dumps({"type": "connected", "port": _ws_port}))
        # Keep the connection alive, waiting for close/disconnect
        async for _ in websocket:
            pass  # consume any incoming messages (we don't send anything from client)
    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.debug("waifu-agent client disconnected: %s", e)
    finally:
        _clients.discard(websocket)


async def _start_ws_server():
    """Start the WebSocket server (lazy init on first event)."""
    global _ws_server, _ws_port

    if _ws_server is not None:
        return  # already started

    try:
        import websockets
    except ImportError:
        logger.warning(
            "waifu-agent hook: 'websockets' not installed. "
            "Run: pip install websockets"
        )
        return

    _ws_port = _find_free_port(9191)

    async def handler(websocket):
        await _ws_handler(websocket)

    _ws_server = await websockets.serve(handler, "127.0.0.1", _ws_port)
    logger.info(
        "waifu-agent status WebSocket server started on ws://127.0.0.1:%d/status",
        _ws_port,
    )


async def _broadcast(payload: dict):
    """Send a JSON payload to all connected WebSocket clients."""
    global _clients
    if not _clients:
        return
    message = json.dumps(payload)
    dead = set()
    for ws in _clients:
        try:
            await ws.send(message)
        except Exception:
            dead.add(ws)
    _clients -= dead


# ---- TTS text cleaning ----

# Unicode emoji ranges compiled once
_EMOJI_REGEX = re.compile(
    "["
    "\U0001F600-\U0001F64F"  # emoticons
    "\U0001F300-\U0001F5FF"  # symbols & pictographs
    "\U0001F680-\U0001F6FF"  # transport & map symbols
    "\U0001F1E0-\U0001F1FF"  # flags (region indicators)
    "\U0001F900-\U0001F9FF"  # Supplemental Symbols
    "\U0001FA00-\U0001FA6F"  # Chess symbols
    "\U0001FA70-\U0001FAFF"  # Symbols Extended-A
    "\U00002702-\U000027B0"  # Dingbats
    "\U0000200D"             # Zero-width joiner
    "\U0000FE0F"             # Variation selector (emoji presentation)
    "]+"
)


def _clean_tts_text(text: str) -> str:
    """Clean up response text for TTS — remove formatting, emojis, code etc.

    Only pure human-readable speech content is kept.
    """
    # 1. Remove fenced code blocks (```...```)
    text = re.sub(r"```[\s\S]*?```", "", text)

    # 2. Remove inline code (`code`)
    text = re.sub(r"`[^`\n]+`", "", text)

    # 3. Remove emoji characters
    text = _EMOJI_REGEX.sub("", text)

    # 4. Remove markdown links: [text](url) -> keep text
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)

    # 4b. Remove standalone [tag] brackets (not part of markdown links)
    text = re.sub(r"\[.*?\]", "", text)

    # 5. Remove standalone URLs and file paths
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"/mnt/[^\s]+", "", text)
    text = re.sub(r"~/\S+", "", text)

    # 6. Remove markdown formatting markers
    text = re.sub(r"[*_]{1,3}", "", text)       # bold/italic
    text = re.sub(r"~~[^~]+~~", "", text)       # strikethrough
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^>\s+", "", text, flags=re.MULTILINE)

    # 7. Remove decorative separators and table markers
    text = re.sub(r"^[-=*]{3,}\s*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\|", "", text, flags=re.MULTILINE)

    # 8. Remove list markers
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*\d+[.)]\s+", "", text, flags=re.MULTILINE)

    # 9. Collapse multiple blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)

    # 10. Collapse multiple spaces
    text = re.sub(r" {2,}", " ", text)

    # 11. Strip per-line whitespace
    text = "\n".join(line.strip() for line in text.split("\n"))

    # 12. Trim start/end
    text = text.strip()

    return text


# ---- TTS ----

async def _generate_tts(text: str) -> tuple[str, str]:
    """Generate TTS audio using edge-tts.

    Returns (cleaned_text, base64_encoded_audio) tuple.
    Returns ("", "") on failure or empty input.
    Text is cleaned of formatting before synthesis, then truncated.
    """
    # Clean text first — remove emoji, markdown, code, URLs
    text = _clean_tts_text(text)
    text = text.strip()
    if not text:
        return "", ""

    tts_text = text[:_TTS_MAX_CHARS]

    try:
        import edge_tts

        communicate = edge_tts.Communicate(tts_text, voice=_TTS_VOICE)
        audio_bytes = b""
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_bytes += chunk["data"]

        if not audio_bytes:
            return tts_text, ""

        audio_b64 = base64.b64encode(audio_bytes).decode("ascii")
        return tts_text, audio_b64

    except Exception as e:
        logger.warning("TTS generation failed: %s", e)
        return tts_text, ""


async def _tts_and_broadcast(response_text: str, task_ref: set):
    """Fire-and-forget: generate TTS audio and broadcast to clients."""
    try:
        tts_text, audio_b64 = await _generate_tts(response_text)
        if audio_b64:
            # Estimate playback duration: ~250ms per Chinese character
            duration_ms = min(max(len(tts_text) * 250, 1000), 15000)
            await _broadcast({
                "type": "tts:audio",
                "text": tts_text,
                "audio": audio_b64,
                "duration_ms": duration_ms,
            })
    except Exception as e:
        logger.warning("TTS broadcast failed: %s", e)
    finally:
        # Remove self from the global task set (release the reference)
        task_ref.discard(asyncio.current_task())


# ---- Hook handler ----

async def handle(event_type: str, context: dict):
    """Hermes hook handler — called for each subscribed event."""
    await _start_ws_server()

    payload = {
        "type": event_type,
        "timestamp": datetime.now().isoformat(),
    }

    if event_type == "gateway:startup":
        # WS server already started in handle() below
        pass

    elif event_type == "agent:start":
        payload.update({
            "session_id": context.get("session_id", ""),
            "message": str(context.get("message", ""))[:200],
            "platform": context.get("platform", ""),
            "user_id": context.get("user_id", ""),
        })
        await _broadcast(payload)

    elif event_type == "agent:step":
        payload.update({
            "session_id": context.get("session_id", ""),
            "iteration": context.get("iteration", 0),
            "tool_names": context.get("tool_names", []),
        })
        await _broadcast(payload)

    elif event_type == "agent:end":
        response_text = str(context.get("response", ""))
        payload.update({
            "session_id": context.get("session_id", ""),
            "message": str(context.get("message", ""))[:200],
            "response": response_text[:500],
        })
        await _broadcast(payload)

        # Fire TTS generation as a background task (keep ref to prevent GC)
        if response_text.strip():
            task = asyncio.create_task(_tts_and_broadcast(response_text, _tts_tasks))
            _tts_tasks.add(task)
