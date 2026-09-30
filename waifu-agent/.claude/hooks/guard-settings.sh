#!/usr/bin/env bash
# PostToolUse hook — 检测 save_settings partial write 模式
# exit 0 = 通过, exit 1 = 警告, exit 2 = 阻断
set -e

PROJECT_DIR="$CLAUDE_PROJECT_DIR"
cd "$PROJECT_DIR"

CHANGED=$(git diff --name-only 2>/dev/null || true)

# 检查前端代码：invoke("save_settings" 是否传了完整对象
TS_CHANGED=$(echo "$CHANGED" | grep -E '\.(ts|tsx)$' || true)
if [ -n "$TS_CHANGED" ]; then
  # 找所有新增/修改的 save_settings 调用
  CALLS=$(git diff 2>/dev/null | grep -E '^\+\s*invoke\("save_settings"' | grep -v '^\+\+\+' || true)
  if [ -n "$CALLS" ]; then
    echo "=== [guard] 检测到 save_settings 调用变更 ==="
    # 检查是否包含展开操作符（... 表示传了完整对象）
    if echo "$CALLS" | grep -v '\.\.\.' | grep -q '.'; then
      echo "[guard] ❌ save_settings 疑似 partial write（缺少 ... 展开完整对象）"
      echo "[guard] 这会清空用户所有设置（API key / 窗口尺寸 / 角色配置等）"
      echo "$CALLS"
      exit 2
    fi
  fi
fi

# 检查 Rust 代码：save_settings 是否做了合并而非直接覆盖
RS_CHANGED=$(echo "$CHANGED" | grep -E '\.rs$' || true)
if [ -n "$RS_CHANGED" ]; then
  WRITES=$(git diff 2>/dev/null | grep -E '^\+\s*std::fs::write.*settings' | grep -v 'merged\|merge\|existing' || true)
  if [ -n "$WRITES" ]; then
    echo "[guard] ❌ Rust 端疑似直接覆盖 settings（未先读取合并）"
    echo "$WRITES"
    exit 2
  fi
fi

echo "[guard] ✅ save_settings 模式检查通过"
exit 0
