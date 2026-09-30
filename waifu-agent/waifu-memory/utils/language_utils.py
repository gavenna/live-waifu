"""Language detection — waifu-agent 中文优先。"""
_global_lang = "zh"

def get_global_language() -> str:
    return _global_lang

def set_global_language(lang: str):
    global _global_lang
    _global_lang = lang
