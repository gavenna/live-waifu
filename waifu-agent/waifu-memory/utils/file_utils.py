"""File utilities — 原子写入。"""
import json
import os
import tempfile


def atomic_write_json(path: str, data: object, indent: int = 2, ensure_ascii: bool = False):
    """原子写入 JSON：先写 temp 再 rename。"""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path) or ".", suffix=".json.tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=indent, ensure_ascii=ensure_ascii)
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def atomic_write_text(path: str, content: str):
    """原子写入文本。"""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path) or ".", suffix=".txt.tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def robust_json_loads(text: str):
    """容错 JSON 解析。"""
    import json
    return json.loads(text)


async def atomic_write_json_async(path: str, data: object, indent: int = 2, ensure_ascii: bool = False):
    """异步版原子写入 JSON。"""
    import asyncio
    await asyncio.to_thread(atomic_write_json, path, data, indent, ensure_ascii)


async def read_json_async(path: str) -> object:
    """异步读取 JSON 文件。"""
    import asyncio
    import json
    def _read():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return await asyncio.to_thread(_read)
