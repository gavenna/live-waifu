"""waifu-memory CLI — 供 Rust 通过 subprocess 调用。

用法:
    python waifu-memory/cli.py configure <memory_dir> <api_url> <api_key> <model> [character] [master]
    python waifu-memory/cli.py extract '<json_messages>'
    python waifu-memory/cli.py recall '<query>' [top_k]
    python waifu-memory/cli.py persona

configure 写入配置文件，后续命令从配置文件读取。
"""
import sys
import os
import json
import asyncio
from pathlib import Path

# 确保 waifu-memory 在 import 路径里
_pkg_dir = os.path.dirname(os.path.abspath(__file__))
if _pkg_dir not in sys.path:
    sys.path.insert(0, _pkg_dir)


def _config_path() -> Path:
    """配置文件路径 — 与 configure 命令写入的一致。"""
    return Path(os.path.expanduser("~/.waifu-agent/memory/config.json"))


def _auto_configure():
    """从配置文件自动初始化 MemoryAPI。"""
    cfg_path = _config_path()
    if not cfg_path.exists():
        raise RuntimeError(
            f"Memory config not found at {cfg_path}. "
            f"Run 'configure' command first."
        )
    with open(cfg_path, encoding="utf-8") as f:
        cfg = json.load(f)

    from api import get_api
    api = get_api()
    api.configure(
        memory_dir=cfg["memory_dir"],
        llm_config={
            "api_url": cfg["api_url"],
            "api_key": cfg["api_key"],
            "model": cfg["model"],
        },
        character_name=cfg.get("character", "mao"),
        master_name=cfg.get("master", "主人"),
    )


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: cli.py <command> [args...]"}))
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "configure":
        memory_dir = sys.argv[2]
        api_url = sys.argv[3]
        api_key = sys.argv[4]
        model = sys.argv[5]
        character = sys.argv[6] if len(sys.argv) > 6 else "mao"
        master = sys.argv[7] if len(sys.argv) > 7 else "主人"

        # Write config file
        cfg_path = _config_path()
        cfg_path.parent.mkdir(parents=True, exist_ok=True)
        cfg = {
            "memory_dir": memory_dir,
            "api_url": api_url,
            "api_key": api_key,
            "model": model,
            "character": character,
            "master": master,
        }
        with open(cfg_path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)

        # Also init the in-process API (for daemon mode testing)
        from api import get_api
        get_api().configure(
            memory_dir=memory_dir,
            llm_config={"api_url": api_url, "api_key": api_key, "model": model},
            character_name=character,
            master_name=master,
        )
        print(json.dumps({"ok": True, "config": str(cfg_path)}))

    elif cmd == "extract":
        _auto_configure()
        messages = json.loads(sys.argv[2])

        from api import get_api
        api = get_api()

        async def _run():
            facts = await api.extract_facts(api._character_name, messages)
            # Stage 2: 吸收未处理事实到 persona
            absorbed = await api.absorb_unabsorbed_facts(api._character_name)
            return facts, absorbed

        facts, absorbed = asyncio.run(_run())
        print(json.dumps(facts, ensure_ascii=False))

    elif cmd == "recall":
        _auto_configure()
        query = sys.argv[2]
        top_k = int(sys.argv[3]) if len(sys.argv) > 3 else 5

        from api import get_api
        api = get_api()
        results = asyncio.run(api.recall(api._character_name, query, top_k))
        print(json.dumps(results, ensure_ascii=False))

    elif cmd == "persona":
        _auto_configure()

        from api import get_api
        api = get_api()
        prompt = asyncio.run(api.get_persona_prompt(api._character_name))
        print(json.dumps({"text": prompt}, ensure_ascii=False))

    else:
        print(json.dumps({"error": f"unknown command: {cmd}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
