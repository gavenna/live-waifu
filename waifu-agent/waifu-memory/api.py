"""waifu-memory 公开 API — 供 Rust (via Python embedded) 或测试脚本调用。"""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger("waifu.memory.api")

# ── 单例 ─────────────────────────────────────

_api_instance: MemoryAPI | None = None


def get_api() -> "MemoryAPI":
    global _api_instance
    if _api_instance is None:
        _api_instance = MemoryAPI()
    return _api_instance


# 同步快捷方式（Rust 通过 embedded Python 调用）
def configure(memory_dir: str, llm_config: dict, character_name: str = "mao", master_name: str = "主人"):
    api = get_api()
    api.configure(memory_dir, llm_config, character_name, master_name)


def extract_facts_sync(character_name: str, messages_json: str) -> str:
    """同步版 — 从 JSON 字符串的消息列表中提取事实, 返回 JSON 结果。"""
    import json
    msgs = json.loads(messages_json)
    api = get_api()
    facts = asyncio.run(api.extract_facts(character_name, msgs))
    return json.dumps(facts, ensure_ascii=False)


def recall_sync(character_name: str, query: str, top_k: int = 5) -> str:
    """同步版 — 语义召回, 返回 JSON。"""
    import json
    api = get_api()
    results = asyncio.run(api.recall(character_name, query, top_k))
    return json.dumps(results, ensure_ascii=False)


def get_persona_sync(character_name: str) -> str:
    """同步版 — 获取人格 prompt, 返回纯文本。"""
    api = get_api()
    return asyncio.run(api.get_persona_prompt(character_name))


# ── API 实现 ─────────────────────────────────

class MemoryAPI:
    """waifu-agent 记忆系统 API。

    底层使用 N.E.K.O. 的 memory/ 模块, 通过适配层连接 waifu 的配置。
    """

    def __init__(self):
        self._configured = False
        self._character_name = "mao"

    def configure(
        self,
        memory_dir: str,
        llm_config: dict,
        character_name: str = "mao",
        master_name: str = "主人",
    ):
        """初始化记忆系统。

        Args:
            memory_dir: 记忆文件存储根目录 (~/.waifu-agent/memory/)
            llm_config: {"api_url": "...", "api_key": "...", "model": "..."}
            character_name: 角色名 (mao)
            master_name: 主人名 (主人)
        """
        from utils.config_manager import get_config_manager
        from memory import ensure_character_dir

        cfg = get_config_manager()
        cfg.configure(
            memory_dir=str(Path(memory_dir).expanduser().resolve()),
            llm_config=llm_config,
            character_name=character_name,
            master_name=master_name,
        )
        # 确保角色目录存在
        ensure_character_dir(cfg.memory_dir, character_name)
        self._configured = True
        self._character_name = character_name
        logger.info("waifu-memory configured: dir=%s character=%s", cfg.memory_dir, character_name)

    def _ensure_configured(self):
        if not self._configured:
            raise RuntimeError("MemoryAPI not configured — call configure() first")

    # ── 事实提取 ──────────────────────────────

    async def extract_facts(self, character_name: str, messages: list[dict]) -> list[dict]:
        """从对话消息中自动提取事实。

        Args:
            character_name: 角色名
            messages: [{"role": "user/assistant", "content": "..."}]

        Returns:
            提取到的事实列表: [{"text": "...", "importance": 7, ...}]
        """
        self._ensure_configured()
        from memory.facts import FactStore
        from memory.timeindex import TimeIndexedMemory
        from memory.recent import CompressedRecentHistoryManager
        from utils.config_manager import get_config_manager

        cfg = get_config_manager()
        # 初始化 recent history manager（自动从 config_manager 读取路径）
        recent_mgr = CompressedRecentHistoryManager()

        # 初始化 time-indexed memory
        time_idx = TimeIndexedMemory(recent_mgr)

        # 初始化 fact store
        fact_store = FactStore(time_indexed_memory=time_idx)

        # 把消息转为 recent history 格式
        from utils.llm_client import SystemMessage, HumanMessage, AIMessage
        role_map = {"user": HumanMessage, "assistant": AIMessage, "system": SystemMessage}
        converted = []
        for m in messages:
            cls = role_map.get(m.get("role", "user"), HumanMessage)
            converted.append(cls(m.get("content", "")))

        # 提取事实
        try:
            new_facts = await fact_store.extract_facts(converted, character_name)
            logger.info("extract_facts: %d new facts for %s", len(new_facts), character_name)
            return new_facts
        except Exception as e:
            logger.warning("extract_facts failed: %s", e)
            return []

    # ── 事实吸收 ──────────────────────────────

    async def absorb_unabsorbed_facts(self, character_name: str) -> int:
        """将未吸收的高重要性事实合并到 persona，标记已吸收。

        不额外调 LLM —— 事实已经是 LLM 提取的高质量观测，
        直接通过 PersonaManager.aadd_fact() 移入 persona，
        自带矛盾检测（防角色卡冲突）。

        Returns:
            成功吸收的数量。
        """
        self._ensure_configured()
        from memory.facts import FactStore
        from memory.persona import PersonaManager

        fact_store = FactStore()
        persona_mgr = PersonaManager()

        unabsorbed = await fact_store.aget_unabsorbed_facts(character_name, min_importance=5)
        if not unabsorbed:
            logger.info("absorb: nothing to absorb for %s", character_name)
            return 0

        absorbed = 0
        for fact in unabsorbed:
            entity = fact.get('entity', 'master')
            text = fact.get('text', '')
            fid = fact.get('id', '')
            result = await persona_mgr.aadd_fact(
                character_name, text, entity=entity,
                source='fact_absorption', source_id=fid,
            )
            if result == persona_mgr.FACT_ADDED:
                absorbed += 1
                logger.info("absorbed [%s]: %s", entity, text[:60])
            else:
                logger.warning("absorb skip (%s) [%s]: %s", result, entity, text[:60])

        # 标记所有处理过的事实（含被拒的），避免反复尝试
        all_ids = [f['id'] for f in unabsorbed]
        await fact_store.amark_absorbed(character_name, all_ids)
        logger.info("absorb: %d/%d facts absorbed for %s", absorbed, len(unabsorbed), character_name)
        return absorbed

    # ── 语义召回 ──────────────────────────────

    async def recall(self, character_name: str, query: str, top_k: int = 5) -> list[dict]:
        """语义召回 — 搜与 query 最相关的记忆。

        Returns:
            [{"text": "...", "score": 0.85, "entity": "master/neko", ...}]
        """
        self._ensure_configured()
        from memory.facts import FactStore
        from memory.persona import PersonaManager
        from utils.config_manager import get_config_manager

        cfg = get_config_manager()
        fact_store = FactStore()
        persona_mgr = PersonaManager()

        # 加载 facts + persona
        facts = await fact_store.aload_facts(character_name)
        persona = await persona_mgr.aget_persona(character_name)

        # 收集候选
        candidates = []
        for f in facts:
            candidates.append({
                "text": f.get("text", ""),
                "entity": f.get("entity", "unknown"),
                "score": f.get("importance", 5),
                "source": "fact",
            })
        # 从 persona 各 entity 收集
        for entity_key, entity_data in persona.items():
            if not isinstance(entity_data, dict):
                continue
            entries = entity_data.get("facts", [])
            for entry in entries:
                candidates.append({
                    "text": entry.get("text", ""),
                    "entity": entity_key,
                    "score": 8,  # persona facts 权重更高
                    "source": "persona",
                })

        # 简单关键词匹配排序 (不引入 embedding 服务时)
        def _match_score(candidate: dict) -> float:
            text = candidate.get("text", "")
            score = float(candidate.get("score", 5))
            # 简单的关键词重叠
            query_words = set(query)
            text_words = set(text)
            overlap = len(query_words & text_words)
            if overlap > 0:
                score += overlap * 2
            return score

        sorted_candidates = sorted(candidates, key=_match_score, reverse=True)
        return sorted_candidates[:top_k]

    # ── 人格渲染 ──────────────────────────────

    async def get_persona_prompt(self, character_name: str) -> str:
        """获取角色人格作为 system prompt 片段。

        Returns:
            格式化的 prompt 文本, 可直接注入 system prompt。
        """
        self._ensure_configured()
        from memory.persona import PersonaManager
        from memory.facts import FactStore
        from utils.config_manager import get_config_manager

        persona_mgr = PersonaManager()
        fact_store = FactStore()

        persona = await persona_mgr.aget_persona(character_name)
        facts = await fact_store.aload_facts(character_name)

        # Entity label mapping
        entity_labels = {
            "master": "[关于主人] 以下是主人是什么样的人——你可以引用但不要说「你说过」",
            "neko": "[关于你自己] 以下是你的自我认知——不是主人的特征",
            "relationship": "[关于你们的关系]",
        }

        lines = ["[以下是你通过对话积累的认知。每条已标注是关于谁的，不要跨实体引用。]\n"]
        for entity_key, entity_data in persona.items():
            if not isinstance(entity_data, dict):
                continue
            facts_list = entity_data.get("facts", [])
            if facts_list:
                label = entity_labels.get(entity_key, f"## {entity_key}")
                lines.append(label)
                for f in facts_list[-10:]:
                    text = f.get("text", "")
                    lines.append(f"- {text}")
                lines.append("")

        # 最近记忆 — 标注来源实体
        if facts:
            lines.append("[最近观察] 每条已标注是关于谁的:")
            recent_facts = sorted(
                facts,
                key=lambda f: f.get("created_at", ""),
                reverse=True,
            )[:10]
            for f in recent_facts:
                entity = f.get("entity", "unknown")
                prefix = {"master": "[关于主人]", "neko": "[关于你自己]", "relationship": "[关于你们]"}.get(entity, f"[{entity}]")
                lines.append(f"- {prefix} {f.get('text', '')}")

        return "\n".join(lines)

    # ── 近期对话 (用于注入 system prompt) ─────

    async def get_recent_context(self, character_name: str) -> str:
        """获取近期对话摘要。"""
        from memory.recent import CompressedRecentHistoryManager
        from utils.config_manager import get_config_manager
        from utils.character_name import validate_character_name

        cfg = get_config_manager()
        recent_mgr = CompressedRecentHistoryManager()
        recent_mgr.configure(cfg.memory_dir, validate_character_name(character_name))
        return recent_mgr.get_recent_context() or ""


def validate_character_name(name: str) -> str:
    from utils.character_name import validate_character_name as _v
    return _v(name)
