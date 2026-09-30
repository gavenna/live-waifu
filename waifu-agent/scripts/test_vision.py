"""Test: screenshot -> MiniMax M3 vision -> response"""
import json, urllib.request, base64, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from PIL import ImageGrab

# 1. Capture screen
img = ImageGrab.grab()
w, h = img.size
if max(w, h) > 768:
    ratio = 768 / max(w, h)
    img = img.resize((int(w * ratio), int(h * ratio)))
print(f"Screenshot: {img.size}")

# 2. Encode to base64 (PNG for best quality)
buf = io.BytesIO()
img.save(buf, format='JPEG', quality=65)
b64 = base64.b64encode(buf.getvalue()).decode()
print(f"JPEG base64: {len(b64)} bytes")

# 3. Send to MiniMax M3
url = 'https://litechipcloud.cn/v1/chat/completions'
api_key = 'sk-lcc-5c2603d860ed434793ff8b6fd33509da'

data = json.dumps({
    'model': 'minimax-m3',
    'messages': [{
        'role': 'user',
        'content': [
            {'type': 'text', 'text': 'Look at this screenshot. What apps or windows do you see? Reply in Chinese, 1-2 short sentences.'},
            {'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{b64}'}}
        ]
    }],
    'max_tokens': 300,
    'thinking': {'type': 'disabled'}
}).encode()

req = urllib.request.Request(url, data=data, headers={
    'Authorization': f'Bearer {api_key}',
    'Content-Type': 'application/json'
})

print("Calling vision API...")
try:
    resp = urllib.request.urlopen(req, timeout=60)
    result = json.loads(resp.read())
    content = result['choices'][0]['message']['content']
    print(f"Response: [{content.strip()}]")
    usage = result.get('usage', {})
    print(f"Tokens: in={usage.get('prompt_tokens')} out={usage.get('completion_tokens')}")
except Exception as e:
    body = e.read().decode() if hasattr(e, 'read') else str(e)
    print(f"ERROR: {body[:800]}")
