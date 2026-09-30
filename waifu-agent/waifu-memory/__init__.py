"""waifu-memory — N.E.K.O. 记忆子系统 + waifu 适配层。

用法:
    from waifu_memory.api import MemoryAPI
    mem = MemoryAPI()
    mem.configure(memory_dir="~/.waifu-agent/memory", llm_config={...})
    facts = await mem.extract_facts("character_name", conversation_msgs)
    recalled = await mem.recall("character_name", "用户喜欢喝咖啡吗", top_k=5)
"""
import os
import sys
import logging

# ── 确保当前包路径在最前面, memory/ 子模块能找到 config/utils ──
_pkg_dir = os.path.dirname(os.path.abspath(__file__))
if _pkg_dir not in sys.path:
    sys.path.insert(0, _pkg_dir)

# ── 确保 waifu-memory 的 config/ 和 utils/ 能被 import ──
# memory/ 里的代码写的是 "from config import ..." 和 "from utils.xxx import ..."
# 标准 Python: 从 sys.path 里找 config 包 → 我们这里的 config/ 就是

logging.basicConfig(level=logging.INFO, format="[waifu.memory] %(levelname)s %(message)s")
