#!/usr/bin/env bash
# check-stickers.sh — P0: selectSticker() 纯函数测试 + 贴图缓存检查
# 用法: bash check-stickers.sh [project_dir]
# 输出: JSON { "status": "pass|fail", "checks": [...], "tests": [...] }

set -e

PROJECT_DIR="${1:-$(cd "$(dirname "$0")/../../../.." && pwd)}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DATA="${APPDATA}/com.waifu-agent.app"
STICKER_DIR="$APP_DATA/stickers"

PASS=0; FAIL=0; WARN=0
CHECKS="["
TESTS="["

add_check() { local name="$1" status="$2" detail="$3"
  [ "$CHECKS" != "[" ] && CHECKS="$CHECKS,"
  local d; d=$(echo "$detail" | sed 's/"/\\"/g' | tr '\n' ' ')
  CHECKS="$CHECKS{\"name\":\"$name\",\"status\":\"$status\",\"detail\":\"$d\"}"
  case "$status" in pass) PASS=$((PASS+1));; fail) FAIL=$((FAIL+1));; warn) WARN=$((WARN+1));; esac
}

add_test() { local name="$1" is_pass="$2" got="$3" expected="$4"
  [ "$TESTS" != "[" ] && TESTS="$TESTS,"
  TESTS="$TESTS{\"name\":\"$name\",\"pass\":$is_pass,\"got\":\"$got\",\"expected\":\"$expected\"}"
}

# ── 1. 跑 selectSticker() 纯函数测试 ──
echo "Running sticker selection tests..."

TEST_OUTPUT=$(cd "$PROJECT_DIR" && npx tsx "$SCRIPT_DIR/__sticker_test.ts" 2>&1)

# Parse JSON test results
PASSED_CNT=$(echo "$TEST_OUTPUT" | python -c "
import json,sys
results = json.load(sys.stdin)
passed = sum(1 for r in results if r.get('pass'))
total = len(results)
for r in results:
  p = 'true' if r['pass'] else 'false'
  print(f'TEST:{r[\"name\"]}|{p}|{r[\"got\"]}|{r[\"expected\"]}')
print(f'SUMMARY:{passed}/{total}')
" 2>&1)

# Parse each line
while IFS= read -r line; do
  case "$line" in
    TEST:*)
      test_name=$(echo "$line" | cut -d'|' -f1 | sed 's/TEST://')
      test_pass=$(echo "$line" | cut -d'|' -f2)
      test_got=$(echo "$line" | cut -d'|' -f3)
      test_exp=$(echo "$line" | cut -d'|' -f4)
      add_test "$test_name" "$test_pass" "$test_got" "$test_exp"
      ;;
    SUMMARY:*)
      summary=$(echo "$line" | sed 's/SUMMARY://')
      passed_cnt=$(echo "$summary" | cut -d'/' -f1)
      total_cnt=$(echo "$summary" | cut -d'/' -f2)
      if [ "$passed_cnt" = "$total_cnt" ]; then
        add_check "sticker selection tests" "pass" "$summary"
      else
        add_check "sticker selection tests" "fail" "$summary"
      fi
      ;;
  esac
done <<< "$PASSED_CNT"

# ── 2. 贴图缓存检查 ──
if [ -d "$STICKER_DIR" ]; then
  STICKER_COUNT=$(find "$STICKER_DIR" -name "*.png" 2>/dev/null | wc -l | tr -d '[:space:]')
  STICKER_SIZE=$(du -sh "$STICKER_DIR" 2>/dev/null | cut -f1 || echo "0")

  if [ "$STICKER_COUNT" -gt 100 ] 2>/dev/null; then
    add_check "sticker cache cap" "fail" "$STICKER_COUNT files (cap=100)"
  elif [ "$STICKER_COUNT" -gt 80 ] 2>/dev/null; then
    add_check "sticker cache cap" "warn" "$STICKER_COUNT files (approaching cap)"
  else
    add_check "sticker cache cap" "pass" "$STICKER_COUNT files ($STICKER_SIZE)"
  fi
else
  add_check "sticker cache dir" "warn" "stickers/ not found (no stickers generated yet)"
fi

# ── 输出 ──
if [ $FAIL -gt 0 ]; then STATUS="fail"; else STATUS="pass"; fi
echo "{\"status\":\"$STATUS\",\"pass\":$PASS,\"fail\":$FAIL,\"warn\":$WARN,\"tests\":$TESTS],\"checks\":$CHECKS]}"
