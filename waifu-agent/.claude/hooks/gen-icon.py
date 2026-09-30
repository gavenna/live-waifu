"""Generate waifu-agent app icon via LiteChipCloud API."""
import json, base64, os, requests, sys
from pathlib import Path

settings_path = Path(os.environ["APPDATA"]) / "com.waifu-agent.app" / "settings.json"
with open(settings_path, encoding="utf-8") as f:
    s = json.load(f)

api_key = s["llm"]["imageApiKey"]
model = s["llm"].get("imageModel", "agnes-image-2.1-flash")
out_dir = Path("D:/Projects/waifu-agent/src-tauri/icons")

prompt = (
    "App icon design: A cute chibi anime cat-girl face, silver hair, blue eyes, "
    "happy expression with a gentle smile, clean vector art style, circular composition, "
    "soft gradient background, centered on white, minimal details suitable for small icon sizes, "
    "professional app icon quality, 1024x1024, no text"
)

print(f"Generating with model={model}...")
resp = requests.post(
    "https://litechipcloud.cn/v1/images/generations",
    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    json={"model": model, "prompt": prompt, "size": "1024x1024"},
    timeout=120,
).json()

if "error" in resp:
    print(f"API error: {resp['error']}")
    sys.exit(1)

data = resp["data"][0]
if "url" in data and data["url"]:
    img = requests.get(data["url"], timeout=60).content
elif "b64_json" in data and data["b64_json"]:
    img = base64.b64decode(data["b64_json"])
else:
    print(f"Unexpected response: {list(data.keys())}")
    sys.exit(1)

main = out_dir / "icon-1024.png"
main.write_bytes(img)
print(f"  icon-1024.png: {len(img)} bytes")

try:
    from PIL import Image
    import io
    original = Image.open(io.BytesIO(img))
    sizes = {
        "32x32.png": (32, 32),
        "128x128.png": (128, 128),
        "128x128@2x.png": (256, 256),
        "icon.png": (256, 256),
    }
    for name, size in sizes.items():
        resized = original.resize(size, Image.LANCZOS)
        resized.save(out_dir / name, "PNG")
        print(f"  {name}: {size}")
    ico = out_dir / "icon.ico"
    original.resize((256, 256), Image.LANCZOS).save(
        ico, "ICO", sizes=[(256,256),(128,128),(64,64),(48,48),(32,32),(16,16)]
    )
    print(f"  icon.ico: {ico.stat().st_size} bytes")
except ImportError:
    print("Pillow not installed — only icon-1024.png saved. Run: pip install Pillow")

print("Done!")
