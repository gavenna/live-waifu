"""
waifu-tts Hermes Plugin — TTS voice synthesis for waifu-agent desktop app.

Architecture: one shared WS server on 9191. The first process binds 9191
and serves desktop clients. Subsequent processes detect 9191 is taken and
connect as WebSocket *clients* to push their TTS messages through it.

This avoids port conflicts between CLI and Gateway processes.
"""

import asyncio
import base64
import json
import logging
import re
import socket
import threading
import time
from datetime import datetime

logger = logging.getLogger(__name__)

# ---- WebSocket server state ----
_ws_server = None       # non-None = we own the WS server on 9191
_ws_loop = None         # event loop of our WS server/client thread
_ws_is_proxy = False    # True = we send via existing WS server on 9191
_clients = set()        # connected desktop clients (only if we own server)

# ---- TTS constants ----
_TTS_MAX_CHARS = 500
_TTS_VOICE = "zh-CN-XiaoxiaoNeural"

# ---- Response capture ----
_last_response = ""

# Unicode emoji ranges
_EMOJI_REGEX = re.compile(
    "["
    "\U0001F600-\U0001F64F" "\U0001F300-\U0001F5FF" "\U0001F680-\U0001F6FF"
    "\U0001F1E0-\U0001F1FF" "\U0001F900-\U0001F9FF" "\U0001FA00-\U0001FA6F"
    "\U0001FA70-\U0001FAFF" "\U00002702-\U000027B0" "\U0000200D" "\U0000FE0F"
    "]+"
)


# ---------------------------------------------------------------------------
# WS server / client
# ---------------------------------------------------------------------------

async def _ws_handler(websocket):
    """Handle a client connection.

    Two types of clients connect:
    - Desktop (WebView): never sends messages, just receives broadcasts.
    - Proxy (Hermes CLI/Gateway): sends JSON messages that must be relayed
      to all desktop clients.

    The ``async for`` loop below captures messages from proxy clients and
    relays them to all other connected clients (the desktop WebViews).
    Also handles ``user:chat`` from waifu-agent relay mode.
    """
    remote = websocket.remote_address
    logger.info("waifu-tts client connected: %s", remote)
    _clients.add(websocket)
    is_waifu = False
    try:
        await websocket.send(json.dumps({"type": "connected", "port": 9191}))
        async for message in websocket:
            try:
                data = json.loads(message)
            except json.JSONDecodeError:
                continue

            msg_type = data.get("type", "")

            # ── Relay mode: waifu sends user chat → forward to Hermes CLI ──
            if msg_type == "user:chat":
                is_waifu = True
                text = data.get("text", "")
                logger.info("waifu-tts: user:chat from waifu — spawning Hermes")
                _run_async(_handle_user_chat(text))
                continue

            # ── Relay to all other clients (desktop WebViews) ──
            logger.info("waifu-tts: relay %s from %s", msg_type, remote)
            for client in list(_clients):
                if client is websocket:
                    continue
                try:
                    await client.send(message)
                except Exception:
                    _clients.discard(client)
    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.debug("waifu-tts client disconnected: %s", e)
    finally:
        _clients.discard(websocket)


async def _broadcast(payload: dict):
    """Send payload to all connected desktop clients."""
    logger.info("waifu-tts: _broadcast type=%s _clients=%d", payload.get("type"), len(_clients))
    if not _clients:
        logger.warning("waifu-tts: _broadcast no clients, dropping type=%s", payload.get("type"))
        return
    message = json.dumps(payload)
    dead = set()
    for ws in list(_clients):
        try:
            await ws.send(message)
            logger.info("waifu-tts: send OK to %s", ws.remote_address)
        except Exception as e:
            logger.warning("waifu-tts: send FAILED to %s: %s", ws.remote_address, e)
            dead.add(ws)
    if dead:
        _clients -= dead
        logger.info("waifu-tts: removed %d dead clients, remaining=%d", len(dead), len(_clients))


async def _send_via_proxy(payload: dict):
    """Send payload to the existing WS server on 9191 (we don't own it)."""
    import websockets
    try:
        async with websockets.connect("ws://127.0.0.1:9191/status") as ws:
            # Send the message; the server relays it to desktop clients.
            await ws.send(json.dumps(payload))
            # Keep connection briefly to let the message arrive
            await asyncio.sleep(0.1)
    except Exception as e:
        logger.warning("waifu-tts: proxy send failed: %s", e)


async def _do_send(payload: dict):
    """Send a payload — via our own server or via proxy."""
    if _ws_is_proxy:
        await _send_via_proxy(payload)
    else:
        await _broadcast(payload)


# ---------------------------------------------------------------------------
# TTS text cleaning
# ---------------------------------------------------------------------------

def _clean_tts_text(text: str) -> str:
    text = re.sub(r"```[\s\S]*?```", "", text)
    text = re.sub(r"`[^`\n]+`", "", text)
    text = _EMOJI_REGEX.sub("", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"\[.*?\]", "", text)
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"/mnt/[^\s]+", "", text)
    text = re.sub(r"~/\S+", "", text)
    text = re.sub(r"[*_]{1,3}", "", text)
    text = re.sub(r"~~[^~]+~~", "", text)
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^>\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^[-=*]{3,}\s*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\|", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*\d+[.)]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r" {2,}", " ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    return text.strip()


# ---------------------------------------------------------------------------
# TTS generation
# ---------------------------------------------------------------------------

async def _generate_tts(text: str) -> tuple[str, str]:
    text = _clean_tts_text(text).strip()
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


# ---------------------------------------------------------------------------
# Async handlers
# ---------------------------------------------------------------------------

async def _handle_user_chat(text: str):
    """Relay mode: waifu sent user:chat → spawn Hermes CLI in background.

    The spawned Hermes CLI loads its own hermes-plugin which connects to us
    in proxy mode and pushes agent:start/end/tts:audio events. So we don't
    need to read stdout — just spawn and let plugin hooks do their thing.
    """
    import subprocess, threading
    logger.info("waifu-tts: handling user:chat, spawning Hermes CLI for '%s'", text[:60])
    # Send agent:start immediately so waifu shows thinking state
    await _do_status_think()
    # Spawn Hermes CLI in background thread (don't block WS event loop)
    def _run_hermes():
        try:
            proc = subprocess.run(
                ["python", "-m", "hermes_cli.main", "chat", "-q", text, "--quiet"],
                capture_output=True, text=True, timeout=120,
            )
            logger.info("waifu-tts: Hermes CLI done (rc=%d)", proc.returncode)
        except Exception as e:
            logger.warning("waifu-tts: Hermes CLI failed: %s", e)
    threading.Thread(target=_run_hermes, daemon=True).start()


async def _do_status_think():
    payload = {
        "type": "agent:start",
        "timestamp": datetime.now().isoformat(),
        "message": "",
        "platform": "plugin",
        "user_id": "",
    }
    await _do_send(payload)


async def _do_tts(response_text: str):
    await _do_send({
        "type": "agent:end",
        "timestamp": datetime.now().isoformat(),
        "response": response_text[:500],
    })

    try:
        tts_text, audio_b64 = await _generate_tts(response_text)
        if audio_b64:
            duration_ms = min(max(len(tts_text) * 250, 1000), 15000)
            await _do_send({
                "type": "tts:audio",
                "text": tts_text,
                "audio": audio_b64,
                "duration_ms": duration_ms,
            })
    except Exception as e:
        logger.warning("TTS broadcast failed: %s", e)


# ---------------------------------------------------------------------------
# WS server or proxy: decide and run
# ---------------------------------------------------------------------------

def _start_ws_or_proxy():
    """Try to bind port 9191. If taken, act as proxy to the existing server."""
    global _ws_loop, _ws_is_proxy, _ws_server

    def _run():
        global _ws_loop, _ws_is_proxy, _ws_server
        _ws_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_ws_loop)

        try:
            import websockets
        except ImportError:
            logger.warning("waifu-tts: 'websockets' not installed")
            return

        # Try to bind 9191 with retries
        for attempt in range(10):
            try:
                async def _bind():
                    return await websockets.serve(
                        _ws_handler, "127.0.0.1", 9191,
                        reuse_address=True,
                    )
                _ws_server = _ws_loop.run_until_complete(_bind())
                _ws_is_proxy = False
                logger.info("waifu-tts: own WS server on ws://127.0.0.1:9191/status")
                break
            except OSError:
                if attempt == 0:
                    logger.info("waifu-tts: port 9191 busy, retrying...")
                time.sleep(0.5)
        else:
            # All retries failed → port 9191 is held by another instance
            _ws_is_proxy = True
            _ws_server = None
            logger.info("waifu-tts: port 9191 owned by another process, using proxy mode")

        logger.info("waifu-tts: WS thread running (mode=%s)",
                    "server" if not _ws_is_proxy else "proxy")
        _ws_loop.run_forever()

    t = threading.Thread(target=_run, daemon=True, name="waifu-tts-ws")
    t.start()


# ---------------------------------------------------------------------------
# Sync dispatch
# ---------------------------------------------------------------------------

def _run_async(coro):
    """Schedule a coroutine on the WS server thread's event loop."""
    for attempt in range(10):
        if _ws_loop is not None:
            break
        if attempt == 0:
            logger.info("waifu-tts: waiting for WS loop...")
        time.sleep(0.5)
    if _ws_loop is None:
        logger.warning("waifu-tts: WS loop not ready, dropping work")
        return None
    return asyncio.run_coroutine_threadsafe(coro, _ws_loop)


# ---------------------------------------------------------------------------
# Plugin hooks
# ---------------------------------------------------------------------------

def register(ctx):
    ctx.register_hook("pre_llm_call", _on_pre_llm_call)
    ctx.register_hook("post_llm_call", _on_post_llm_call)
    ctx.register_hook("on_session_end", _on_session_end)
    _start_ws_or_proxy()
    logger.info("waifu-tts: plugin loaded")


def _on_pre_llm_call(**kwargs):
    logger.debug("waifu-tts: pre_llm_call")
    _run_async(_do_status_think())


def _on_post_llm_call(assistant_response="", **kwargs):
    global _last_response
    if assistant_response:
        _last_response = assistant_response
        logger.debug("waifu-tts: captured %d chars", len(assistant_response))


def _on_session_end(**kwargs):
    global _last_response
    text = _last_response.strip()
    if not text:
        return
    _last_response = ""
    logger.info("waifu-tts: TTS for %d chars", len(text))
    _run_async(_do_tts(text))
