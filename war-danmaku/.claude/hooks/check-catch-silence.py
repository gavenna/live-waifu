"""PreToolUse Hook: 拦截静默吞错 .catch(() => {})

用法: python .claude/hooks/check-catch-silence.py <tool> <params_json>

返回 0 = 正常，返回 2 = 发现静默吞错（反馈给 AI 修正）
"""
import json, sys, os

if len(sys.argv) < 2:
    sys.exit(0)

tool = sys.argv[1]

# Only check Edit/Write operations
if tool not in ("Edit", "Write"):
    sys.exit(0)

# Get the file path from params if available
try:
    params = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    file_path = params.get("file_path", "")
except json.JSONDecodeError:
    file_path = ""

# Only check TypeScript/JavaScript files
if not file_path or not file_path.endswith((".ts", ".tsx", ".js", ".jsx")):
    sys.exit(0)

# Read the old_string param
old_text = params.get("old_string", "")
new_text = params.get("new_string", "")

# Check if removing a catch block
silent_catch_patterns = [
    r"\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)",
    r"\.catch\(\s*\(\s*err\s*\)\s*=>\s*\{\s*\}\s*\)",
]

import re
for pattern in silent_catch_patterns:
    removed = re.findall(pattern, old_text) if old_text else []
    added = re.findall(pattern, new_text) if new_text else []

    if added and len(added) > 0:
        print(
            "\n[HARNESS] WARNING: .catch(() => {}) detected in changes.\n"
            "  This silently swallows errors. Add at least console.error:\n"
            "  .catch((e) => console.error('...', e))\n"
        )
        sys.exit(2)  # Block and feed back to AI

sys.exit(0)
