"""
waifu_relay.py — waifu-agent Agent Relay 参考适配器

最小实现：连接 waifu WebSocket → 接收 user:chat → 调用 LLM → 发送 agent:* 事件 + TTS

用法:
    python waifu_relay.py [--port 9191] [--api-key sk-xxx]

依赖:
    pip install websocket-client edge-tts openai
"""

import json
import time
import base64
import asyncio
import sys
import os
import threading
from argparse import ArgumentParser

try:
    import websocket
except ImportError:
    print("请安装: pip install websocket-client")
    sys.exit(1)


class WaifuRelayAdapter:
    """连接到 waifu-agent 并将消息转发给 LLM"""

    def __init__(self, ws_url: str, llm_api_key: str, llm_base_url: str = "https://api.deepseek.com/v1"):
        self.ws_url = ws_url
        self.llm_api_key = llm_api_key
        self.llm_base_url = llm_base_url
        self.ws: websocket.WebSocketApp | None = None
        self.running = False

    def send_json(self, data: dict):
        if self.ws:
            self.ws.send(json.dumps(data, ensure_ascii=False))
            print(f"  → {data['type']}: {str(data.get(list(data.keys())[1], ''))[:60]}")

    # ── LLM call ──────────────────────────────

    def call_llm(self, message: str) -> str:
        """调用 OpenAI 兼容 API"""
        try:
            from openai import OpenAI
            client = OpenAI(api_key=self.llm_api_key, base_url=self.llm_base_url)
            resp = client.chat.completions.create(
                model=os.environ.get("LLM_MODEL", "deepseek-chat"),
                messages=[{"role": "user", "content": message}],
                temperature=0.7,
                max_tokens=500,
            )
            return resp.choices[0].message.content or "(empty)"
        except Exception as e:
            return f"抱歉，出了点问题: {e}"

    # ── TTS generation ──────────────────────────

    async def _generate_tts(self, text: str) -> tuple[str, int]:
        """用 edge-tts 生成音频"""
        try:
            import edge_tts
            import tempfile
            communicate = edge_tts.Communicate(text, "zh-CN-XiaoxiaoNeural")
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
                tmp = f.name
            await communicate.save(tmp)
            with open(tmp, "rb") as f:
                data = f.read()
            os.unlink(tmp)
            b64 = base64.b64encode(data).decode("ascii")
            dur = len(data) * 8 / 32000  # rough estimate (32kbps MP3)
            return b64, int(dur)
        except Exception as e:
            print(f"  [TTS] failed: {e}")
            return "", 0

    def send_tts(self, text: str):
        """异步生成 TTS 并发送"""
        if not text.strip():
            return
        # Clean text for TTS
        clean = text.replace("*", "").replace("`", "").replace("#", "").strip()
        clean = clean[:500]  # edge-tts max

        async def _do():
            b64, dur = await self._generate_tts(clean)
            if b64:
                self.send_json({
                    "type": "tts:audio",
                    "text": clean,
                    "audio": b64,
                    "duration_ms": dur,
                })

        threading.Thread(target=lambda: asyncio.run(_do()), daemon=True).start()

    # ── Handle incoming messages ────────────────

    def on_message(self, ws, raw: str):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return

        msg_type = data.get("type", "")
        print(f"  ← {msg_type}")

        if msg_type == "user:chat":
            text = data.get("text", "")
            self.handle_chat(text)

    def handle_chat(self, text: str):
        """处理用户输入"""
        # 1. Start
        self.send_json({"type": "agent:start", "message": text})

        # 2. Thinking
        self.send_json({"type": "agent:thinking", "detail": "正在思考..."})

        # 3. LLM call
        time.sleep(0.2)  # simulate thinking
        response = self.call_llm(text)

        # 4. End
        self.send_json({"type": "agent:end", "response": response})

        # 5. TTS
        self.send_tts(response)

    # ── Connection lifecycle ────────────────────

    def on_open(self, ws):
        print(f"✓ 已连接 waifu-agent ({self.ws_url})")
        print("  等待用户输入...")
        self.running = True

    def on_close(self, ws, status, msg):
        print(f"✗ 连接断开 (status={status})")
        self.running = False

    def on_error(self, ws, error):
        print(f"✗ WS error: {error}")

    def connect(self):
        print(f"正在连接 waifu-agent... ({self.ws_url})")
        self.ws = websocket.WebSocketApp(
            self.ws_url,
            on_open=self.on_open,
            on_message=self.on_message,
            on_close=self.on_close,
            on_error=self.on_error,
        )
        self.ws.run_forever()


# ── CLI ──────────────────────────────────────

def main():
    ap = ArgumentParser(description="waifu-agent Relay 适配器")
    ap.add_argument("--port", type=int, default=9191, help="WebSocket 端口 (default: 9191)")
    ap.add_argument("--api-key", type=str, default="", help="OpenAI API key (default: $OPENAI_API_KEY)")
    ap.add_argument("--base-url", type=str, default="https://api.deepseek.com/v1", help="LLM API base URL")
    args = ap.parse_args()
    api_key = args.api_key or os.environ.get("OPENAI_API_KEY") or os.environ.get("DEEPSEEK_API_KEY") or ""
    if not api_key:
        print("请设置 OPENAI_API_KEY 环境变量或传 --api-key")
        sys.exit(1)

    ws_url = f"ws://127.0.0.1:{args.port}/status"
    adapter = WaifuRelayAdapter(ws_url, api_key, args.base_url)
    adapter.connect()


if __name__ == "__main__":
    main()
