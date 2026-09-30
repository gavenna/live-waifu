"""Stub — waifu-agent 角色名校验。"""
def validate_character_name(name: str) -> str:
    """简单字符过滤，禁止路径遍历。"""
    if not name or ".." in name or "/" in name or "\\" in name:
        raise ValueError(f"Invalid character name: {name}")
    return name.strip() or "default"
