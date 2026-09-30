"""Config manager — 适配 waifu-agent 的配置到 N.E.K.O. 接口。"""
import os
import json
import threading
from pathlib import Path


class WaifuConfigManager:
    """N.E.K.O. ConfigManager 的 waifu 适配实现。

    memory/ 模块需要三个东西:
    1. memory_dir — 记忆文件存储目录
    2. get_model_api_config(tier) — 按 tier 取 LLM 配置
    3. get_character_data() — 角色名称和配置
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._llm_config: dict = {}
        self._character_name: str = "mao"
        self._master_name: str = "主人"
        self._memory_dir: str = ""

    # ── 设置入口（waifu 调用） ─────────────────

    def configure(
        self,
        memory_dir: str,
        llm_config: dict,
        character_name: str = "mao",
        master_name: str = "主人",
    ):
        """waifu-agent 初始化时调一次。"""
        with self._lock:
            self._memory_dir = memory_dir
            self._llm_config = llm_config
            self._character_name = character_name
            self._master_name = master_name

    # ── 路径 ──────────────────────────────────

    @property
    def memory_dir(self) -> str:
        if not self._memory_dir:
            raise RuntimeError("waifu-memory not configured — call configure() first")
        return self._memory_dir

    # ── LLM 配置 ──────────────────────────────

    def get_model_api_config(self, tier: str = "summary") -> dict:
        """返回 {model, api_key, base_url} 字典。

        所有 memory tiers 共用 waifu 的 LLM 配置。
        """
        cfg = self._llm_config
        return {
            "model": cfg.get("model", ""),
            "api_key": cfg.get("api_key", ""),
            "base_url": cfg.get("api_url", "https://api.deepseek.com/v1"),
        }

    # ── 角色数据 ──────────────────────────────

    def get_character_data(self):
        """返回 N.E.K.O. 兼容的角色数据 tuple。

        N.E.K.O. memory_server.py 需要的结构:
        (..., master_basic_config, lanlan_basic_config, name_mapping,
         ..., setting_store, ...)
        """
        master_cfg = {self._master_name: {}}
        char_cfg = {self._character_name: {}}
        name_mapping = {
            "human": self._master_name,
            "ai": self._character_name,
        }
        char_dir = os.path.join(self.memory_dir, self._character_name)
        os.makedirs(char_dir, exist_ok=True)
        setting_store = {
            self._character_name: os.path.join(char_dir, "settings.json"),
        }
        recent_log = {
            self._character_name: os.path.join(char_dir, "recent.json"),
        }
        time_store = {
            self._character_name: os.path.join(char_dir, "time_indexed.db"),
        }
        return (
            None,           # 0: master_name
            None,           # 1: her_name
            master_cfg,     # 2: master_basic_config
            char_cfg,       # 3: effective_character_data
            name_mapping,   # 4: name_mapping
            None,           # 5: lanlan_prompt_map
            time_store,     # 6: time_store
            setting_store,  # 7: setting_store
            recent_log,     # 8: recent_log
        )

    async def aget_character_data(self):
        """Async wrapper for get_character_data."""
        return self.get_character_data()

    @property
    def _cloudsave_root(self):
        return self.memory_dir


# ── 全局单例 ────────────────────────────────

_instance: WaifuConfigManager | None = None
_instance_lock = threading.Lock()


def get_config_manager() -> WaifuConfigManager:
    global _instance
    if _instance is None:
        with _instance_lock:
            if _instance is None:
                _instance = WaifuConfigManager()
    return _instance
