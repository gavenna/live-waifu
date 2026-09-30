"""LLM client — 把 waifu 的 OpenAI 兼容 API 封装成 N.E.K.O. 接口。"""
from __future__ import annotations

import time
from typing import Any

# ── 消息类型 (LangChain 兼容) ────────────────

class SystemMessage(dict):
    def __init__(self, content: str):
        super().__init__(role="system", content=content)

class HumanMessage(dict):
    def __init__(self, content: str):
        super().__init__(role="user", content=content)

class AIMessage(dict):
    def __init__(self, content: str):
        super().__init__(role="assistant", content=content)
        self.content = content

def messages_to_dict(msgs: list) -> list[dict]:
    return [dict(m) for m in msgs]

def messages_from_dict(data: list[dict]) -> list:
    mapping = {"system": SystemMessage, "user": HumanMessage, "assistant": AIMessage}
    return [mapping.get(d.get("role", ""), HumanMessage)(d.get("content", "")) for d in data]

# ── SQLChatMessageHistory stub ───────────────

class SQLChatMessageHistory:
    """waifu 用内存列表替代 SQLite，但保留 N.E.K.O. 接口兼容。"""
    _engine_cache: dict = {}

    def __init__(self, connection_string: str = "", session_id: str = "", table_name: str = "message_store"):
        self.messages: list[dict] = []
        self.session_id = session_id

    def add_message(self, msg):
        self.messages.append(dict(msg))

    def clear(self):
        self.messages.clear()

    @property
    def messages_list(self) -> list[dict]:
        return list(self.messages)

# ── LLM 创建 ─────────────────────────────────

def create_chat_llm(
    model: str = "",
    base_url: str = "",
    api_key: str = "",
    temperature: float | None = None,
    timeout: int = 110,
    max_retries: int = 2,
    **kwargs,
):
    """创建 LangChain 兼容的 ChatOpenAI 实例。

    N.E.K.O. memory 模块大量调用此函数。
    waifu 直接用 openai SDK 包装成 LangChain 接口。
    """
    return _WaifuChatLLM(
        model=model,
        base_url=base_url,
        api_key=api_key,
        temperature=temperature,
        timeout=timeout,
    )


class _WaifuChatLLM:
    """最小的 LangChain ChatModel 兼容实现 — 仅支持 .invoke() 和 .ainvoke()。"""

    def __init__(self, model: str, base_url: str, api_key: str,
                 temperature: float | None, timeout: int):
        self.model_name = model
        self.base_url = base_url
        self.api_key = api_key
        self.temperature = temperature
        self.timeout = timeout

    def _call_openai(self, messages: list[dict] | str) -> str:
        import urllib.request
        import urllib.error
        import json as _json

        # 兼容纯文本 prompt → 包装为 HumanMessage
        if isinstance(messages, str):
            msg_list = [{"role": "user", "content": messages}]
        else:
            msg_list = [dict(m) for m in messages]

        url = self.base_url.rstrip('/')
        if not url.endswith('/chat/completions'):
            url = f"{url}/chat/completions"
        body = {
            "model": self.model_name,
            "messages": msg_list,
            "stream": False,
        }
        if self.temperature is not None:
            body["temperature"] = self.temperature

        req = urllib.request.Request(
            url,
            data=_json.dumps(body).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = _json.loads(resp.read().decode("utf-8"))
            return data["choices"][0]["message"]["content"]
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"LLM HTTP {e.code}: {body}")
        except Exception as e:
            raise RuntimeError(f"LLM call failed: {e}")

    def invoke(self, messages: list[dict]) -> AIMessage:
        content = self._call_openai(messages)
        return AIMessage(content=content)

    async def ainvoke(self, messages: list[dict]) -> AIMessage:
        import asyncio
        loop = asyncio.get_running_loop()
        content = await loop.run_in_executor(None, self._call_openai, messages)
        return AIMessage(content=content)

    async def aclose(self):
        """N.E.K.O. cleanup — no-op for waifu."""
        pass

    def close(self):
        """Sync cleanup — no-op for waifu."""
        pass


def convert_to_messages(msgs: list[dict]) -> list:
    """N.E.K.O. 用的消息格式转换。"""
    mapping = {"system": SystemMessage, "user": HumanMessage, "assistant": AIMessage}
    return [mapping.get(m.get("role", "user"), HumanMessage)(m.get("content", "")) for m in msgs]
