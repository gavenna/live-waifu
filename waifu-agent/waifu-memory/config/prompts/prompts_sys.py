"""System prompt fragments — 来自 N.E.K.O. 的最小依赖。"""
def _loc(d: dict, lang: str) -> str:
    if lang not in d:
        print(f"WARNING: Unexpected lang code {lang}")
    return d.get(lang, d['en'])
