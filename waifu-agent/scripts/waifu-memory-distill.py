#!/usr/bin/env python3
"""
从 Hermes 会话中提炼 waifu-agent 相关记忆 → 角色视角的日记

流程:
  1. 扫描 ~/.hermes/sessions/ 最近 N 天的 session 文件
  2. 关键词匹配筛出 waifu-agent 相关会话
  3. LLM 从角色视角提炼"今天发生了什么"
  4. 去重后追加到 ~/.waifu-agent/memory/thoughts.jsonl

用法:
  python3 waifu-memory-distill.py              # 提炼最近 1 天
  python3 waifu-memory-distill.py --days 3     # 最近 3 天
  python3 waifu-memory-distill.py --dry-run    # 只预览不写入
"""

import json, os, glob, re, sys, textwrap
from datetime import datetime, timezone, timedelta
from pathlib import Path

# ─── 配置 ─────────────────────────────────────────────────────
HERMES_SESSIONS_DIR = os.path.expanduser("~/.hermes/sessions/")
WAIFU_MEMORY_DIR = os.path.expanduser("~/.waifu-agent/memory/")
LLM_CONFIG_PATH = os.path.expanduser("~/waifu-agent/llm_config.json")
THOUGHTS_FILE = os.path.join(WAIFU_MEMORY_DIR, "thoughts.jsonl")

# 关键词命中 >= 2 才算相关
KEYWORDS = [
    "waifu", "口型", "lipsync", "lipsync", "TT", "桌面角色",
    "live2d", "haru", "persona", "人格", "yuanqi", "角色",
    "quick_chat", "send_message", "ffplay", "edge-tts",
    "tauri", "记忆系统", "SOUL", "调参", "嘴", "说话",
    "快速模式", "深度模式", "适配器", "表达", "表情",
    "distill", "thought", "waifu-agent", "桌面",
    "打断", "截断", "托盘", "窗口位置", "闪屏",
]


def load_llm_config():
    with open(LLM_CONFIG_PATH) as f:
        return json.load(f)


def find_recent_session_files(days: int) -> list[str]:
    """找到最近 N 天内的 session 文件"""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    files = []

    for fname in os.listdir(HERMES_SESSIONS_DIR):
        fpath = os.path.join(HERMES_SESSIONS_DIR, fname)
        if not os.path.isfile(fpath):
            continue
        # 只处理 session_*.json 和 *.jsonl 格式
        if not (fname.startswith("session_") or fname.endswith(".jsonl")):
            continue
        mtime = datetime.fromtimestamp(os.path.getmtime(fpath), tz=timezone.utc)
        if mtime >= cutoff:
            files.append(fpath)

    files.sort(key=os.path.getmtime, reverse=True)
    return files


def scan_session_for_relevance(fpath: str) -> tuple[bool, list[str]]:
    """快速扫描文件，判断是否和 waifu-agent 相关。返回 (相关?, [用户消息片段])"""
    try:
        size = os.path.getsize(fpath)
        if size > 5_000_000:  # >5MB, 只读开头和结尾
            with open(fpath, "rb") as f:
                head = f.read(500_000).decode("utf-8", errors="replace")
                f.seek(-500_000, 2)
                tail = f.read(500_000).decode("utf-8", errors="replace")
            text = head + tail
        else:
            with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                text = f.read()
    except Exception as e:
        return False, [f"读取失败: {e}"]

    hits = 0
    for kw in KEYWORDS:
        if kw.lower() in text.lower():
            hits += 1

    if hits < 2:
        return False, []

    # 提取用户消息（给 LLM 的素材）
    user_msgs = _extract_user_messages(text, fpath)
    return True, user_msgs


def _extract_user_messages(text: str, fpath: str) -> list[str]:
    """从 session JSON/JSONL 中提取用户消息"""
    msgs = []
    try:
        data = json.loads(text)
        if isinstance(data, dict) and "messages" in data:
            for m in data["messages"]:
                if m.get("role") == "user":
                    content = m.get("content", "")
                    if isinstance(content, list):
                        texts = [c["text"] for c in content if c.get("type") == "text"]
                        content = " ".join(texts)
                    if content and isinstance(content, str) and len(content) > 10:
                        msgs.append(content.strip()[:1000])
    except json.JSONDecodeError:
        # JSONL 格式: 每行一个 JSON
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                if entry.get("role") == "user":
                    content = entry.get("content", "")
                    if content and isinstance(content, str) and len(content) > 10:
                        msgs.append(content.strip()[:1000])
            except json.JSONDecodeError:
                continue

    return msgs[:20]  # 最多 20 条


def distill_to_thoughts(user_msgs: list[str], llm_cfg: dict) -> list[dict]:
    """调用 LLM 将用户消息蒸馏为角色视角的念头"""
    if not user_msgs:
        return []

    messages_text = "\n".join(f"- {m}" for m in user_msgs[:10])

    prompt = f"""你是一个桌面角色 AI，叫 waifu-agent（桌面动漫角色助手）。
以下是你主人最近和 AI 助手（Hermes）聊天时提到和你相关的内容。

请从**你的视角**（角色的内心独白）写出 1-3 条你今天"记住"的事。
每条 10-30 字，中文，用第一人称，感觉像日记里随手写的话。

规则:
- 只记对你有意义的事: 被调整了、被测试了、声音变了、主人熬夜了
- 不记技术细节: 不写"改了什么参数"、"编译通过了"——写"主人今天在调整我的口型"
- 每条独立，不要重复
- 如果没什么好记的，返回空数组

对话记录:
{messages_text}

返回 JSON 数组: ["念头1", "念头2", ...]
"""

    try:
        resp = _call_llm(prompt, llm_cfg)
        thoughts = json.loads(resp)
        if isinstance(thoughts, list):
            return [{"text": t, "time": datetime.now().isoformat(), "source": "hermes-distill"} for t in thoughts if t.strip()]
    except Exception as e:
        print(f"LLM 调用或解析失败: {e}", file=sys.stderr)
        return []

    return []


def _call_llm(prompt: str, cfg: dict) -> str:
    """调用 OpenAI 兼容 API"""
    import urllib.request

    body = json.dumps({
        "model": cfg.get("model", "deepseek-chat"),
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 300,
        "temperature": 0.7,
    }).encode()

    req = urllib.request.Request(
        cfg["api_url"],
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {cfg['api_key']}",
        },
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read())
        return result["choices"][0]["message"]["content"].strip()


def load_existing_thoughts() -> set[str]:
    """加载已有的 thoughts 用于去重"""
    existing = set()
    if os.path.exists(THOUGHTS_FILE):
        with open(THOUGHTS_FILE) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    text = entry.get("text", "")
                    if text:
                        existing.add(text[:30])  # 用前 30 字做指纹
                except json.JSONDecodeError:
                    continue
    return existing


def deduplicate(new_thoughts: list[dict], existing_fingerprints: set[str]) -> list[dict]:
    """去重"""
    result = []
    for t in new_thoughts:
        fp = t["text"][:30]
        if fp not in existing_fingerprints:
            existing_fingerprints.add(fp)
            result.append(t)
    return result


def append_thoughts(thoughts: list[dict]):
    os.makedirs(os.path.dirname(THOUGHTS_FILE), exist_ok=True)
    with open(THOUGHTS_FILE, "a") as f:
        for t in thoughts:
            f.write(json.dumps(t, ensure_ascii=False) + "\n")


def main():
    import argparse

    parser = argparse.ArgumentParser(description="从 Hermes 会话中提炼 waifu-agent 记忆")
    parser.add_argument("--days", type=int, default=1, help="回溯天数 (默认 1)")
    parser.add_argument("--dry-run", action="store_true", help="只预览不写入")
    args = parser.parse_args()

    # 1. 找最近会话文件
    files = find_recent_session_files(args.days)
    print(f"🔍 找到 {len(files)} 个近期会话文件")

    if not files:
        print("没有近期会话，跳过")
        return

    # 2. 筛选相关会话
    all_user_msgs = []
    for fpath in files:
        relevant, msgs = scan_session_for_relevance(fpath)
        if relevant:
            fname = os.path.basename(fpath)
            print(f"  ✅ {fname} — {len(msgs)} 条相关消息")
            all_user_msgs.extend(msgs)

    if not all_user_msgs:
        print("没有 waifu-agent 相关会话，跳过")
        return

    # 3. LLM 蒸馏
    print(f"🧠 调用 LLM 提炼 {len(all_user_msgs)} 条消息...")
    llm_cfg = load_llm_config()
    thoughts = distill_to_thoughts(all_user_msgs, llm_cfg)

    if not thoughts:
        print("没有提炼出新的记忆")
        return

    # 4. 去重
    existing = load_existing_thoughts()
    new_thoughts = deduplicate(thoughts, existing)

    if not new_thoughts:
        print("所有念头已存在（去重后为空）")
        return

    # 5. 写入
    print(f"\n📝 新记忆 ({len(new_thoughts)} 条):")
    for t in new_thoughts:
        print(f"  💭 {t['text']}")

    if not args.dry_run:
        append_thoughts(new_thoughts)
        print(f"\n✅ 已追加到 {THOUGHTS_FILE}")
    else:
        print("\n⏸️  dry-run 模式，未写入")


if __name__ == "__main__":
    main()
