#!/usr/bin/env bash
# verify-all.sh — 产品验证编排器
# 用法: bash verify-all.sh [--offline] [--quick]
#   --offline  跳过需要 app 运行的检查
#   --quick    只跑 P0 检查
# 退出码: 0=全部通过, 1=有警告, 2=有失败

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
mkdir -p "$SCRIPT_DIR/../results"
RESULTS_DIR="$(cd "$SCRIPT_DIR/../results" && pwd)"
REPORT_FILE="$RESULTS_DIR/latest-report.md"
TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")

mkdir -p "$RESULTS_DIR"

OFFLINE=false; QUICK=false
for arg in "$@"; do
  case "$arg" in --offline) OFFLINE=true ;; --quick) QUICK=true ;; esac
done

# ── Detect environment ──
APP_RUNNING=false
if tasklist 2>/dev/null | grep -qi "waifu-agent"; then
  APP_RUNNING=true
fi

echo ""
echo "╔══════════════════════════════════╗"
echo "║   waifu-agent Product Verify    ║"
echo "╚══════════════════════════════════╝"
echo ""
echo "App running: $APP_RUNNING"
echo "Mode: $([ "$OFFLINE" = true ] && echo 'offline' || echo 'full')$([ "$QUICK" = true ] && echo ' (quick)')"
echo ""

# ── Phase 1: P0 Checks (always run) ──
echo "━━━ Phase 1: P0 Checks ━━━"

echo "  [1/3] Settings Integrity..."
bash "$SCRIPT_DIR/check-settings.sh" > "$RESULTS_DIR/check-settings.txt" 2>&1
SETTINGS_STATUS=$(tail -1 "$RESULTS_DIR/check-settings.txt" | python -c "import json,sys; print(json.load(sys.stdin).get('status','fail'))" 2>/dev/null || echo "fail")
echo "        $SETTINGS_STATUS"

echo "  [2/3] Sticker Selection..."
bash "$SCRIPT_DIR/check-stickers.sh" "$PROJECT_DIR" > "$RESULTS_DIR/check-stickers.txt" 2>&1
STICKER_STATUS=$(tail -1 "$RESULTS_DIR/check-stickers.txt" | python -c "import json,sys; print(json.load(sys.stdin).get('status','fail'))" 2>/dev/null || echo "fail")
echo "        $STICKER_STATUS"

echo "  [3/4] Log Analysis..."
bash "$SCRIPT_DIR/check-logs.sh" > "$RESULTS_DIR/check-logs.txt" 2>&1
LOG_STATUS=$(tail -1 "$RESULTS_DIR/check-logs.txt" | python -c "import json,sys; print(json.load(sys.stdin).get('status','fail'))" 2>/dev/null || echo "fail")
echo "        $LOG_STATUS"

echo "  [4/4] LLM Output Format..."
bash "$SCRIPT_DIR/check-llm-output.sh" > "$RESULTS_DIR/check-llm-output.txt" 2>&1
LLM_STATUS=$(tail -1 "$RESULTS_DIR/check-llm-output.txt" | python -c "import json,sys; print(json.load(sys.stdin).get('status','fail'))" 2>/dev/null || echo "fail")
echo "        $LLM_STATUS"

# ── Phase 2: P1 Checks (skip if quick mode) ──
if [ "$QUICK" != true ]; then
  echo ""
  echo "━━━ Phase 2: P1 Checks ━━━"

  echo "  [4/5] Content Quality..."
  if [ -f "$SCRIPT_DIR/check-content-quality.sh" ]; then
    bash "$SCRIPT_DIR/check-content-quality.sh" > "$RESULTS_DIR/check-content-quality.txt" 2>&1
    CQ_STATUS=$(tail -1 "$RESULTS_DIR/check-content-quality.txt" | python -c "import json,sys; print(json.load(sys.stdin).get('status','skip'))" 2>/dev/null || echo "skip")
    echo "        $CQ_STATUS"
  else
    echo "        skip (not implemented yet)"
  fi

  echo "  [5/5] UI Commands..."
  if [ "$APP_RUNNING" = true ] && [ "$OFFLINE" != true ]; then
    if [ -f "$SCRIPT_DIR/check-ui-commands.sh" ]; then
      bash "$SCRIPT_DIR/check-ui-commands.sh" > "$RESULTS_DIR/check-ui-commands.txt" 2>&1
      UI_STATUS=$(tail -1 "$RESULTS_DIR/check-ui-commands.txt" | python -c "import json,sys; print(json.load(sys.stdin).get('status','skip'))" 2>/dev/null || echo "skip")
      echo "        $UI_STATUS"
    else
      echo "        skip (not implemented yet)"
    fi
  else
    echo "        skip (app not running)"
  fi
fi

# ── Phase 3: Generate Report ──
echo ""
echo "━━━ Report ━━━"
bash "$SCRIPT_DIR/report.sh" "$RESULTS_DIR" "$REPORT_FILE" "$APP_RUNNING" "$TIMESTAMP"

# ── Compute exit code ──
FAIL_COUNT=0
for f in "$RESULTS_DIR"/check-*.txt; do
  [ ! -f "$f" ] && continue
  s=$(tail -1 "$f" | python -c "import json,sys; print(json.load(sys.stdin).get('status','pass'))" 2>/dev/null || echo "pass")
  [ "$s" = "fail" ] && FAIL_COUNT=$((FAIL_COUNT+1))
done

echo ""
if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "═══════════════════════════════════"
  echo "  ❌ VERIFY FAILED — $FAIL_COUNT checks failed"
  echo "  Report: $REPORT_FILE"
  echo "═══════════════════════════════════"
  exit 2
else
  echo "═══════════════════════════════════"
  echo "  ✅ VERIFY PASSED"
  echo "  Report: $REPORT_FILE"
  echo "═══════════════════════════════════"
  exit 0
fi
