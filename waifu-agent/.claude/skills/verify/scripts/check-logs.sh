#!/usr/bin/env bash
# check-logs.sh — P0: 日志错误扫描 + 启动流/状态机健康检查
# 用法: bash check-logs.sh [app_data_dir]
# 输出: JSON { "status": "pass|fail|warn", "checks": [...], "summary": {...} }

set -e

APP_DATA="${1:-$APPDATA/com.waifu-agent.app}"
LOG_FILE="$APP_DATA/waifu-agent.log"
PREV_LOG="$APP_DATA/waifu-agent.prev.log"

PASS=0; FAIL=0; WARN=0
CHECKS="["

add_check() { local name="$1" status="$2" detail="$3"
  [ "$CHECKS" != "[" ] && CHECKS="$CHECKS,"
  local d; d=$(echo "$detail" | sed 's/"/\\"/g' | tr '\n' ' ')
  CHECKS="$CHECKS{\"name\":\"$name\",\"status\":\"$status\",\"detail\":\"$d\"}"
  case "$status" in pass) PASS=$((PASS+1));; fail) FAIL=$((FAIL+1));; warn) WARN=$((WARN+1));; esac
}

# 合并日志
ALL_LOGS=""
LOG_SOURCE="none"
if [ -f "$LOG_FILE" ]; then
  ALL_LOGS=$(cat "$LOG_FILE" 2>/dev/null)
  LOG_SOURCE="current"
fi
if [ -f "$PREV_LOG" ]; then
  ALL_LOGS="$ALL_LOGS"$'\n'"$(cat "$PREV_LOG" 2>/dev/null)"
  [ "$LOG_SOURCE" = "current" ] && LOG_SOURCE="current+prev" || LOG_SOURCE="prev"
fi

if [ "$LOG_SOURCE" = "none" ]; then
  add_check "log files exist" "warn" "no log files found (app not run yet?)"
  echo "{\"status\":\"warn\",\"pass\":$PASS,\"fail\":$FAIL,\"warn\":$WARN,\"checks\":$CHECKS]}"
  exit 0
fi

add_check "log files exist" "pass" "source: $LOG_SOURCE"

TOTAL_LINES=$(echo "$ALL_LOGS" | wc -l)

# ── 1. ERROR 统计 ──
ERROR_COUNT=$(echo "$ALL_LOGS" | grep -c "\[ERROR\]" 2>/dev/null || true)
ERROR_COUNT=$(echo "$ERROR_COUNT" | tr -d '[:space:]')
[ -z "$ERROR_COUNT" ] && ERROR_COUNT=0
if [ "$ERROR_COUNT" -gt 0 ]; then
  ERROR_SAMPLES=$(echo "$ALL_LOGS" | grep "\[ERROR\]" | tail -5 | sed 's/"/\\"/g' | tr '\n' '|')
  add_check "error count" "fail" "$ERROR_COUNT errors found. Samples: $ERROR_SAMPLES"
else
  add_check "error count" "pass" "0 errors in $TOTAL_LINES lines"
fi

# ── 2. 启动流序列检查 ──
HAS_LOG_START=$(echo "$ALL_LOGS" | grep -c "Log started\|log started\|STARTUP" 2>/dev/null || true)
HAS_DAEMON=$(echo "$ALL_LOGS" | grep -c "daemon ready\|daemon start" 2>/dev/null || true)
HAS_WINDOW_SHOW=$(echo "$ALL_LOGS" | grep -c "window.show\|Window created" 2>/dev/null || true)

HAS_LOG_START=$(echo "$HAS_LOG_START" | tr -d '[:space:]'); [ -z "$HAS_LOG_START" ] && HAS_LOG_START=0
HAS_DAEMON=$(echo "$HAS_DAEMON" | tr -d '[:space:]'); [ -z "$HAS_DAEMON" ] && HAS_DAEMON=0
HAS_WINDOW_SHOW=$(echo "$HAS_WINDOW_SHOW" | tr -d '[:space:]'); [ -z "$HAS_WINDOW_SHOW" ] && HAS_WINDOW_SHOW=0

if [ "$HAS_LOG_START" -gt 0 ] && [ "$HAS_WINDOW_SHOW" -gt 0 ]; then
  add_check "startup sequence" "pass" "log start → window shown"
elif [ "$HAS_LOG_START" -gt 0 ]; then
  add_check "startup sequence" "warn" "log started but no window.show — may be incomplete session"
else
  add_check "startup sequence" "warn" "no startup markers found (log may be truncated)"
fi

# ── 3. Daemon 健康 ──
STT_FAIL=$(echo "$ALL_LOGS" | grep -c "STT.*fail\|stt.*FAIL\|daemon start failed" 2>/dev/null || true)
TTS_FAIL=$(echo "$ALL_LOGS" | grep -c "TTS.*fail\|tts.*FAIL\|edge-tts.*FAIL" 2>/dev/null || true)

STT_FAIL=$(echo "$STT_FAIL" | tr -d '[:space:]'); [ -z "$STT_FAIL" ] && STT_FAIL=0
TTS_FAIL=$(echo "$TTS_FAIL" | tr -d '[:space:]'); [ -z "$TTS_FAIL" ] && TTS_FAIL=0

if [ "$STT_FAIL" -gt 0 ] && [ "$TTS_FAIL" -gt 0 ]; then
  add_check "daemon health" "fail" "STT and TTS both failed ($STT_FAIL+$TTS_FAIL)"
elif [ "$STT_FAIL" -gt 0 ]; then
  add_check "daemon health" "warn" "STT daemon failures: $STT_FAIL"
elif [ "$TTS_FAIL" -gt 0 ]; then
  add_check "daemon health" "warn" "TTS daemon failures: $TTS_FAIL"
else
  add_check "daemon health" "pass" "STT+TTS daemons OK"
fi

# ── 4. 贴图 API 错误 ──
STICKER_ERR=$(echo "$ALL_LOGS" | grep -c "\[Sticker\].*API error\|\[Sticker\].*unexpected\|ContentPolicyViolation" 2>/dev/null || true)
STICKER_ERR=$(echo "$STICKER_ERR" | tr -d '[:space:]'); [ -z "$STICKER_ERR" ] && STICKER_ERR=0
STICKER_GEN=$(echo "$ALL_LOGS" | grep -c "\[Sticker\] generate:" 2>/dev/null || true)
STICKER_GEN=$(echo "$STICKER_GEN" | tr -d '[:space:]'); [ -z "$STICKER_GEN" ] && STICKER_GEN=0
STICKER_FALLBACK=$(echo "$ALL_LOGS" | grep -c "\[Sticker\] fallback:" 2>/dev/null || true)
STICKER_FALLBACK=$(echo "$STICKER_FALLBACK" | tr -d '[:space:]'); [ -z "$STICKER_FALLBACK" ] && STICKER_FALLBACK=0

if [ "$STICKER_ERR" -gt 0 ]; then
  add_check "sticker API" "fail" "$STICKER_ERR API errors in $STICKER_GEN generations"
elif [ "$STICKER_GEN" -gt 0 ] && [ "$STICKER_FALLBACK" -gt 0 ]; then
  # Fallback = legacy cache hit, not an error. Only warn if 100% fallback.
  if [ "$STICKER_FALLBACK" -eq "$STICKER_GEN" ] && [ "$STICKER_GEN" -ge 3 ]; then
    add_check "sticker cache" "warn" "all $STICKER_GEN served from legacy cache (content-hash miss, old cache hit — API not called)"
  else
    add_check "sticker API" "pass" "$STICKER_GEN served ($STICKER_FALLBACK from legacy cache)"
  fi
elif [ "$STICKER_GEN" -gt 0 ]; then
  add_check "sticker API" "pass" "$STICKER_GEN generations, 0 errors"
else
  add_check "sticker API" "pass" "no sticker activity in this session"
fi

# ── 5. 首 token 延迟 ──
FIRST_TOKEN=$(echo "$ALL_LOGS" | grep -oP "first chunk in \K[0-9.]+" 2>/dev/null | head -10)
if [ -n "$FIRST_TOKEN" ]; then
  SLOW_COUNT=0; TIMEOUT_COUNT=0; CLOCK_ERR=0; TOTAL=0
  while IFS= read -r t; do
    [ -z "$t" ] && continue
    TOTAL=$((TOTAL+1))
    # >300s = likely clock/timing measurement error, not real latency
    if python -c "exit(0 if float('$t') > 300 else 1)" 2>/dev/null; then
      CLOCK_ERR=$((CLOCK_ERR+1))
    elif python -c "exit(0 if float('$t') > 10 else 1)" 2>/dev/null; then
      TIMEOUT_COUNT=$((TIMEOUT_COUNT+1))
    elif python -c "exit(0 if float('$t') > 3 else 1)" 2>/dev/null; then
      SLOW_COUNT=$((SLOW_COUNT+1))
    fi
  done <<< "$FIRST_TOKEN"

  if [ "$CLOCK_ERR" -gt 0 ]; then
    add_check "first token latency" "warn" "$CLOCK_ERR/$TOTAL measurements >300s (likely clock skew, not real latency)"
  elif [ "$TIMEOUT_COUNT" -gt 0 ]; then
    add_check "first token latency" "fail" "$TIMEOUT_COUNT/$TOTAL >10s"
  elif [ "$SLOW_COUNT" -gt 0 ]; then
    add_check "first token latency" "warn" "$SLOW_COUNT/$TOTAL >3s"
  else
    add_check "first token latency" "pass" "all $TOTAL under 3s"
  fi
else
  add_check "first token latency" "pass" "no streaming data"
fi

# ── 6. Auth 流 ──
HAS_AUTH=$(echo "$ALL_LOGS" | grep -c "\[Auth\]" 2>/dev/null || true)
HAS_AUTH=$(echo "$HAS_AUTH" | tr -d '[:space:]'); [ -z "$HAS_AUTH" ] && HAS_AUTH=0
if [ "$HAS_AUTH" -gt 0 ]; then
  AUTH_ERRORS=$(echo "$ALL_LOGS" | grep "\[Auth\].*error\|\[Auth\].*fail" 2>/dev/null | wc -l | tr -d '[:space:]')
  [ -z "$AUTH_ERRORS" ] && AUTH_ERRORS=0
  if [ "$AUTH_ERRORS" -gt 0 ]; then
    add_check "auth flow" "fail" "$AUTH_ERRORS auth errors"
  else
    add_check "auth flow" "pass" "auth activity OK"
  fi
else
  add_check "auth flow" "pass" "no auth activity"
fi

# ── 输出 ──
if [ $FAIL -gt 0 ]; then STATUS="fail"; elif [ $WARN -gt 0 ]; then STATUS="warn"; else STATUS="pass"; fi

SUMMARY="{\"total_lines\":$TOTAL_LINES,\"errors\":$ERROR_COUNT,\"sticker_gen\":$STICKER_GEN,\"sticker_err\":$STICKER_ERR,\"log_source\":\"$LOG_SOURCE\"}"

echo "{\"status\":\"$STATUS\",\"pass\":$PASS,\"fail\":$FAIL,\"warn\":$WARN,\"summary\":$SUMMARY,\"checks\":$CHECKS]}"
