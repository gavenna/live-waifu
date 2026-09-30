"""Fix backslash paths to forward slashes in settings.json and .mcp.json"""
import json
import os

# Fix settings.json
settings_path = os.path.expanduser(r"~/.claude/settings.json")
with open(settings_path, "r") as f:
    data = json.load(f)

for hook_name, hook_groups in data.get("hooks", {}).items():
    for group in hook_groups:
        for hook in group.get("hooks", []):
            cmd = hook.get("command", "")
            if "D:" in cmd and "\\" in cmd:
                hook["command"] = cmd.replace("\\", "/")

with open(settings_path, "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
print("settings.json: OK")

# Fix .mcp.json for both projects
for proj in [r"D:/Projects/waifu-agent", r"D:/Projects/war-danmaku"]:
    mcp_path = os.path.join(proj, ".mcp.json")
    if os.path.exists(mcp_path):
        with open(mcp_path, "r") as f:
            data = json.load(f)
        for name, cfg in data.get("mcpServers", {}).items():
            if "args" in cfg:
                cfg["args"] = [a.replace("\\", "/") for a in cfg["args"]]
        with open(mcp_path, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"{proj}/.mcp.json: OK")
