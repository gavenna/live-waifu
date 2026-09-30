"""PostToolUse Hook: 验证 settings.json 关键字段未被默认值覆盖。

用法: python .claude/hooks/validate-settings.py

返回 0 = 正常，返回 1 = 发现默认值覆盖（警告）
"""
import json, os, sys

SETTINGS_PATH = os.path.expandvars(
    r"%APPDATA%\com.waifu-agent.app\settings.json"
)
# 关键字段及其默认值（从 App.tsx getDefaultSettings 同步）
# 仅检查 UI 布局关键字段（设为默认值会明显破坏体验）
CRITICAL_FIELDS = {
    "character.scale": 0.25,  # PRESETS 默认，用户通常设为 0.03-0.06
}


def get_nested(data, path):
    for key in path.split("."):
        if isinstance(data, dict):
            data = data.get(key)
        else:
            return None
    return data


def main():
    if not os.path.exists(SETTINGS_PATH):
        return 0  # 首次运行，无文件

    with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
        try:
            settings = json.load(f)
        except json.JSONDecodeError:
            return 0

    warnings = []
    for path, default in CRITICAL_FIELDS.items():
        actual = get_nested(settings, path)
        if actual is not None and actual == default:
            warnings.append(
                f"⚠️  {path} = {actual}（等于默认值，可能被误覆盖）"
            )

    if warnings:
        print("\n[Harness] settings.json check - WARNING:")
        for w in warnings:
            print(f"  {w}")
        print(
            "  If this just happened, the last Edit/Write may have overwritten user settings.\n"
            "  Confirm whether this is expected. If not, fix immediately."
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
