"""Web search CLI — Bing 爬虫 (国内直连) → Tavily (质量) → DDG (兜底)

Usage:
  python scripts/web_search.py search "<query>" [max_results] [tavily_key]
  python scripts/web_search.py fetch "<url>" [max_chars]

Bing 爬虫不需要 API key，国内网络环境可直接使用。
"""

import sys, json, os
from urllib.parse import quote

# Windows stdout 默认 GBK，Bing 搜索结果含 \xa0 等字符会崩
sys.stdout.reconfigure(encoding='utf-8')

MAX_BODY = 500
FETCH_DEFAULT = 5000


# ── Engines ─────────────────────────────────────────

def _bing_decode_url(href):
    """Decode Bing redirect URLs (u=base64url) or return direct URL."""
    import base64, re
    if not href:
        return ''
    # Bing sometimes wraps in /ck/a redirect, sometimes gives direct URL
    if 'bing.com/ck/a' in href or 'bing.com/ck/r' in href:
        m = re.search(r'[&?]u=([^&]+)', href)
        if m:
            try:
                b64 = m.group(1).replace('-', '+').replace('_', '/')
                b64 += '=' * (4 - len(b64) % 4)
                decoded = base64.b64decode(b64).decode('utf-8')
                if decoded.startswith('http'):
                    return decoded
            except Exception:
                pass
        return ''
    return href if href.startswith('http') else ''


def search_bing(query, max_results=5):
    """Bing 爬虫 — 国内直连，无需 API key"""
    try:
        import requests
        from bs4 import BeautifulSoup

        url = f"https://www.bing.com/search?q={quote(query)}"
        resp = requests.get(url, timeout=15, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "zh-CN,zh;q=0.9",
        })
        if resp.status_code != 200:
            return []

        soup = BeautifulSoup(resp.text, "html.parser")
        results = []
        for li in soup.select("li.b_algo"):
            a = li.select_one("h2 a")
            if not a: continue
            title = a.get_text(strip=True)
            href = _bing_decode_url(a.get("href", ""))
            if not href or not title: continue
            # Try multiple snippet selectors
            p = li.select_one(".b_caption p, .b_algoSlug, .b_lineclamp2, .b_lineclamp3, p")
            body = p.get_text(strip=True) if p else ""
            if len(body) > MAX_BODY:
                body = body[:MAX_BODY] + "..."
            results.append({"title": title, "href": href, "body": body, "source": "bing"})
            if len(results) >= max_results:
                break
        return results
    except Exception:
        return []


def search_tavily(query, api_key, max_results=5):
    try:
        from tavily import TavilyClient
        client = TavilyClient(api_key=api_key)
        response = client.search(query=query, max_results=max_results, search_depth="basic")
        results = []
        for item in response.get("results", []):
            body = item.get("content", "")
            if len(body) > MAX_BODY:
                body = body[:MAX_BODY] + "..."
            results.append({
                "title": item.get("title", ""),
                "href": item.get("url", ""),
                "body": body,
                "source": "tavily",
            })
        return results
    except Exception:
        return []


def search_ddg(query, max_results=5):
    try:
        from ddgs import DDGS
    except ImportError:
        from duckduckgo_search import DDGS
    with DDGS() as ddgs:
        results = []
        for r in ddgs.text(query, max_results=max_results):
            body = r.get("body", "")
            if len(body) > MAX_BODY:
                body = body[:MAX_BODY] + "..."
            results.append({
                "title": r.get("title", ""),
                "href": r.get("href", ""),
                "body": body,
                "source": "ddg",
            })
        return results
    return []


# ── Page fetcher ────────────────────────────────────

def fetch_page(url, max_chars=FETCH_DEFAULT):
    """抓取网页正文 — readability 正文提取 + markdown 转换 + 链接保留"""
    try:
        import requests
        from bs4 import BeautifulSoup
        from readability import Document
        import html2text

        resp = requests.get(url, timeout=15, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept-Language": "zh-CN,zh;q=0.9",
        })
        resp.raise_for_status()

        doc = Document(resp.text)
        title = doc.title() or ""

        # 提取 metadata（og:description，供 LLM 参考）
        soup = BeautifulSoup(resp.text, "html.parser")
        og_desc = soup.find("meta", property="og:description")
        description = ""
        if og_desc and og_desc.get("content"):
            description = og_desc["content"].strip()

        # readability 正文 → markdown
        content_html = doc.summary()
        h = html2text.HTML2Text()
        h.body_width = 0            # 不折行
        h.ignore_links = False      # 保留链接 [text](url)
        h.ignore_images = True      # skip 图片
        h.ignore_tables = False     # 保留表格
        h.ignore_emphasis = False   # 保留粗体斜体
        content = h.handle(content_html)

        # readability 失败时 fallback 到旧方法（SPA 页面等 JS 为空的情况）
        if not content or len(content.strip()) < 50:
            for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
                tag.decompose()
            text = soup.get_text(separator="\n", strip=True)
            lines = [l.strip() for l in text.splitlines() if l.strip()]
            content = "\n".join(lines)

        if len(content) > max_chars:
            content = content[:max_chars] + "..."

        return {
            "ok": True,
            "title": title,
            "description": description,
            "content": content,
            "url": url,
        }
    except Exception as e:
        return {"ok": False, "error": str(e), "url": url}


# ── Main ────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: web_search.py search|fetch ..."}))
        return

    cmd = sys.argv[1]

    if cmd == "fetch":
        url = sys.argv[2] if len(sys.argv) > 2 else ""
        max_chars = int(sys.argv[3]) if len(sys.argv) > 3 else FETCH_DEFAULT
        print(json.dumps(fetch_page(url, max_chars), ensure_ascii=False))
        return

    # Default: search
    query = sys.argv[1] if cmd != "search" else (sys.argv[2] if len(sys.argv) > 2 else "")
    if cmd == "search":
        query = sys.argv[2] if len(sys.argv) > 2 else ""
        max_results = int(sys.argv[3]) if len(sys.argv) > 3 else 5
        tavily_key = sys.argv[4] if len(sys.argv) > 4 else os.environ.get("TAVILY_API_KEY", "")
    else:
        # Legacy: python web_search.py "query" [max] [tavily_key]
        query = cmd
        max_results = int(sys.argv[2]) if len(sys.argv) > 2 else 5
        tavily_key = sys.argv[3] if len(sys.argv) > 3 else os.environ.get("TAVILY_API_KEY", "")

    results = []
    # Priority: Tavily (quality, if key) → Bing (free, works in China) → DDG
    if tavily_key:
        results = search_tavily(query, tavily_key, max_results)
    if not results:
        results = search_bing(query, max_results)
    if not results:
        results = search_ddg(query, max_results)

    print(json.dumps(results, ensure_ascii=False))


if __name__ == "__main__":
    main()
