"""Waifu Companion WS Relay — WebSocket 中继

启动: python .claude/hooks/waifu-relay.py
监听 ws://127.0.0.1:9191/status，任何客户端发来的消息广播给其他客户端。
WAIFU_WS_PORT 环境变量可覆盖端口。
"""
import asyncio, json, os
import websockets

HOST = "127.0.0.1"
PORT = int(os.environ.get("WAIFU_WS_PORT", "9191"))


async def handler(ws):
    peers = handler.peers
    peers.add(ws)
    try:
        await ws.send(json.dumps({"type": "connected", "port": PORT}))
        async for raw in ws:
            try:
                json.loads(raw)
            except json.JSONDecodeError:
                continue
            dead = set()
            for c in peers:
                if c is not ws:
                    try:
                        await c.send(raw)
                    except websockets.ConnectionClosed:
                        dead.add(c)
            peers -= dead
    except websockets.ConnectionClosed:
        pass
    finally:
        peers.discard(ws)


handler.peers = set()


async def main():
    print(f"[waifu-relay] ws://{HOST}:{PORT}/status", flush=True)
    async with websockets.serve(handler, HOST, PORT):
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[waifu-relay] stopped", flush=True)
