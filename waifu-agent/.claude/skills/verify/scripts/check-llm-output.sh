#!/usr/bin/env bash
# check-llm-output.sh — P0: 验证 LLM 是否按 SOUL.md 格式输出
# 构造与 Rust build_system_prompt 完全相同的 prompt，调真实 API 检查输出格式
# 用法: bash check-llm-output.sh
# 输出: JSON { "status": "pass|fail|skip", "checks": [...] }

set -e

APP_DATA="${APPDATA}/com.waifu-agent.app"

PYTHONIOENCODING=utf-8 python -c "
import json, os, sys, urllib.request, re

appdata = os.path.expandvars(r'%APPDATA%\com.waifu-agent.app')

# 1. Load config
try:
    with open(os.path.join(appdata, 'settings.json'), encoding='utf-8') as f:
        config = json.load(f)
    api_key = config['llm']['apiKey']
    api_url = config['llm']['apiUrl']
    model = config['llm']['model']
    if not api_key:
        print(json.dumps({'status':'skip','pass':0,'fail':0,'warn':0,'skip':1,
            'checks':[{'name':'llm output format','status':'skip','detail':'no API key configured'}]}))
        sys.exit(0)
except Exception as e:
    print(json.dumps({'status':'skip','pass':0,'fail':0,'warn':0,'skip':1,
        'checks':[{'name':'llm output format','status':'skip','detail':f'config error: {e}'}]}))
    sys.exit(0)

# 2. Build system prompt (mirrors Rust build_system_prompt exactly)
sp = '【必须遵守】你的每条回复必须严格按此格式输出：第一行（中文动作描写），第二行[img: 英文场景描述]，第三行开始对话内容。禁止跳过[img:]行。禁止用括号内容替代[img:]行。\n\n'

soul_path = os.path.join(appdata, 'SOUL.md')
if os.path.exists(soul_path):
    with open(soul_path, encoding='utf-8') as f:
        sp += f.read()

sp += '\n\n[重要规则] 你没有预装任何关于主人的知识。关于主人的一切来自下方的记忆区。如果记忆区为空，说明你还不了解他。被问到不了解的事直接说不知道——不要编造细节，不要用玩笑或反问转移话题。'

for fname, title in [('USER.md', '关于主人'), ('MEMORY.md', '你和主人的重要记忆')]:
    fp = os.path.join(appdata, fname)
    if os.path.exists(fp):
        with open(fp, encoding='utf-8') as f:
            content = f.read()
        if content.strip():
            sp += f'\n\n## {title}\n\n{content}'

sp += '\n\n## 可用工具\n现在是2026年07月06日 北京时间 (UTC+8)。\n- web_search：搜索网页获取实时信息。\n- fetch_page：打开搜索结果中的链接，抓取完整网页正文。\n- read_clipboard：读系统剪贴板，仅在用户明确要求时使用\n- system_info：获取操作系统、CPU、主机名'

sp += '\n\n## 回复风格\n说短话是你的风格。对话只保留核心意思，不绕弯不啰嗦。'

sp = sp[:10000]  # same truncation as Rust

# 3. Test messages that should trigger different emotional responses
test_messages = [
    '熬夜对身体有什么影响？我最近越来越晚睡了',
    '哈哈，今天心情特别好！',
]

checks = []
total_pass = 0
total_fail = 0

for msg in test_messages:
    messages = [
        {'role': 'system', 'content': sp},
        {'role': 'user', 'content': msg},
    ]

    req = urllib.request.Request(
        api_url,
        data=json.dumps({
            'model': model,
            'messages': messages,
            'stream': True,
            'max_tokens': 250,
        }).encode(),
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
        }
    )

    try:
        full_text = ''
        with urllib.request.urlopen(req, timeout=25) as resp:
            for line in resp:
                line = line.decode('utf-8').strip()
                if line.startswith('data: ') and line[6:] != '[DONE]':
                    try:
                        chunk = json.loads(line[6:])
                        content = chunk['choices'][0].get('delta', {}).get('content', '')
                        full_text += content
                    except: pass
    except Exception as e:
        checks.append({
            'name': f'llm format: \"{msg[:20]}...\"',
            'status': 'fail',
            'detail': f'API error: {str(e)[:100]}'
        })
        total_fail += 1
        continue

    has_img = '[img:' in full_text
    has_action = '（' in full_text and '）' in full_text
    has_dialogue = len(re.sub(r'[（(].*?[）)]|\[img:.*?\]', '', full_text).strip()) > 5

    img_quality = ''
    if has_img:
        m = re.search(r'\[img:\s*([^\]]+)\]', full_text)
        if m:
            prompt = m.group(1)
            words = len(prompt.split())
            has_layers = all(kw in prompt.lower() for kw in ['chibi', 'sticker'])
            img_quality = f' ({words} words, layers_ok={has_layers})'

    if has_img and has_action and has_dialogue:
        checks.append({
            'name': f'llm format: \"{msg[:20]}...\"',
            'status': 'pass',
            'detail': f'{len(full_text)} chars, img+action+dialogue OK{img_quality}'
        })
        total_pass += 1
    else:
        missing = []
        if not has_img: missing.append('img')
        if not has_action: missing.append('action')
        if not has_dialogue: missing.append('dialogue')
        checks.append({
            'name': f'llm format: \"{msg[:20]}...\"',
            'status': 'fail',
            'detail': f'missing: {\", \".join(missing)} | response: {full_text[:120]}'
        })
        total_fail += 1

status = 'pass' if total_fail == 0 else 'fail'
print(json.dumps({
    'status': status,
    'pass': total_pass,
    'fail': total_fail,
    'warn': 0,
    'summary': {'tests': len(test_messages), 'passed': total_pass, 'failed': total_fail},
    'checks': checks,
}, ensure_ascii=False))
" 2>&1
