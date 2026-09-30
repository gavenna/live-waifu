#!/usr/bin/env bash
# Stop hook — 硬阻断验证。Claude 声明"做完了"前必须通过。
# exit 0 = 通过, exit 1 = 警告, exit 2 = 阻断（不准结束）
set -e

PROJECT_DIR="$CLAUDE_PROJECT_DIR"
cd "$PROJECT_DIR"

CHANGED_TS=$(git diff --name-only 2>/dev/null | grep -E '\.(ts|tsx)$' || true)
CHANGED_RS=$(git diff --name-only 2>/dev/null | grep -E '\.rs$' || true)

FAILED=0

if [ -n "$CHANGED_TS" ]; then
  echo "=== [verify] TypeScript 类型检查 ==="
  if ! ./node_modules/.bin/tsc --noEmit 2>&1 | head -30; then
    echo "[verify] ❌ tsc 失败，修复后再结束"
    FAILED=1
  else
    echo "[verify] ✅ tsc 通过"
  fi
fi

if [ -n "$CHANGED_RS" ]; then
  echo "=== [verify] Rust 编译检查 ==="
  if ! (cd src-tauri && cargo check 2>&1 | tail -20); then
    echo "[verify] ❌ cargo check 失败，修复后再结束"
    FAILED=1
  else
    echo "[verify] ✅ cargo check 通过"
  fi
fi

if [ "$FAILED" -eq 1 ]; then
  exit 2
fi

echo "[verify] ✅ 全部通过"
exit 0
