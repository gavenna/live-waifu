"""PostToolUse Hook: 新语法标记出现时检查 TTS 清洗管线

用法: python .claude/hooks/check-tts-pipeline.py

返回 0 = OK，返回 1 = 警告
"""
import subprocess, sys, os

# Check if any file changes contain new [bracket] syntax
# that might need TTS pipeline updates
try:
    diff = subprocess.check_output(
        ["git", "diff", "HEAD"],
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        text=True, errors="replace",
    )
except Exception:
    sys.exit(0)

# Look for added lines with bracket-wrapped tags
bracket_patterns = [
    r"^\+\s*\[(\w+)\]",
    r"^\+\s*【(\w+)】",
]
import re
new_tags = set()
for pattern in bracket_patterns:
    for match in re.finditer(pattern, diff, re.MULTILINE):
        new_tags.add(match.group(1))

if not new_tags:
    sys.exit(0)

# Found new bracket tags — check if TTS cleaning handles them
check_files = [
    "src/utils/ttsClean.ts",
    "src-tauri/src/lib.rs",
]
missing = []
for f in check_files:
    full = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), f)
    if not os.path.exists(full):
        continue
    with open(full, "r", encoding="utf-8") as fh:
        content = fh.read()
    if "\\\\[" not in content and "【" not in content:
        missing.append(f)

if missing:
    print(
        f"\n[HARNESS] New bracket tags detected: {', '.join(new_tags)}\n"
        f"  These files may need updating to strip the tags from TTS:\n"
        f"  {', '.join(missing)}\n"
        f"  Add [...], 【...】 removal to cleanTtsText / clean_tts_text."
    )
    sys.exit(1)

sys.exit(0)
