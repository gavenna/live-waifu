"""Token counting — waifu 用简单字符估算（不依赖 tiktoken）。"""

def tokenizer_identity():
    """返回一个估算 token 数的 callable — CJK 每字 ~1.5 token, ASCII 每字 ~0.3 token。"""
    def _count(text: str) -> int:
        if not text:
            return 0
        cjk = sum(1 for c in text if '一' <= c <= '鿿' or '぀' <= c <= 'ヿ')
        other = len(text) - cjk
        return int(cjk * 1.5 + other * 0.3)
    return _count

def count_tokens(text: str) -> int:
    return tokenizer_identity()(text)

async def acount_tokens(text: str) -> int:
    return count_tokens(text)
