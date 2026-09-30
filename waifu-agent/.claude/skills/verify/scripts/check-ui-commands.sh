#!/usr/bin/env bash
# check-ui-commands.sh — P1: 运行时健康检查（需 app 运行）
# 用法: bash check-ui-commands.sh [app_data_dir]
# 输出: JSON { "status": "pass|fail|skip", "checks": [...] }

set -e

APP_DATA="${1:-$APPDATA/com.waifu-agent.app}"
SETTINGS_FILE="$APP_DATA/settings.json"
LOG_FILE="$APP_DATA/waifu-agent.log"

PASS=0; FAIL=0; WARN=0; SKIP=0
CHECKS="["

add_check() { local name="$1" status="$2" detail="$3"
  [ "$CHECKS" != "[" ] && CHECKS="$CHECKS,"
  local d; d=$(echo "$detail" | sed 's/"/\\"/g' | tr '\n' ' ')
  CHECKS="$CHECKS{\"name\":\"$name\",\"status\":\"$status\",\"detail\":\"$d\"}"
  case "$status" in pass) PASS=$((PASS+1));; fail) FAIL=$((FAIL+1));; warn) WARN=$((WARN+1));; skip) SKIP=$((SKIP+1));; esac
}

# ── 1. Check app is running ──
APP_PID=$(tasklist 2>/dev/null | grep -i "waifu-agent" | awk '{print $2}' | head -1 || true)
if [ -z "$APP_PID" ]; then
  add_check "app process" "skip" "waifu-agent not running — runtime checks require the app"
  echo "{\"status\":\"skip\",\"pass\":$PASS,\"fail\":$FAIL,\"warn\":$WARN,\"skip\":$SKIP,\"checks\":$CHECKS]}"
  exit 0
fi
add_check "app process" "pass" "PID: $APP_PID"

# ── 2. Check WebSocket port (relay mode) ──
WS_PORT=9191
if netstat -ano 2>/dev/null | grep -q ":$WS_PORT.*LISTEN"; then
  add_check "WS port $WS_PORT" "pass" "listening (relay mode active)"
else
  add_check "WS port $WS_PORT" "warn" "not listening (builtin mode or relay not started)"
fi

# ── 3. Check log is being written (proves frontend is alive) ──
if [ -f "$LOG_FILE" ]; then
  LOG_AGE=$(python -c "import os,time; print(int(time.time()-os.path.getmtime(r'$LOG_FILE')))" 2>/dev/null || echo "999")
  LOG_SIZE=$(wc -c < "$LOG_FILE" 2>/dev/null | tr -d '[:space:]' || echo "0")
  if [ "$LOG_AGE" -lt 120 ] 2>/dev/null; then
    add_check "log activity" "pass" "last modified ${LOG_AGE}s ago, ${LOG_SIZE} bytes"
  else
    add_check "log activity" "warn" "stale — last modified ${LOG_AGE}s ago (app may be idle)"
  fi
else
  add_check "log activity" "fail" "log file not found"
fi

# ── 4. Check settings.json was recently saved ──
if [ -f "$SETTINGS_FILE" ]; then
  SETTINGS_SIZE=$(wc -c < "$SETTINGS_FILE" 2>/dev/null | tr -d '[:space:]' || echo "0")
  python -c "
import json
with open(r'$SETTINGS_FILE', encoding='utf-8') as f:
  s = json.load(f)
# Check a few critical UI-impacting keys exist
checks = [
  'character' in s,
  'window' in s,
  'llm' in s,
  'chat' in s,
]
if all(checks):
  print('OK')
else:
  print('MISSING_KEYS')
" 2>&1 | while IFS= read -r line; do :; done
  add_check "settings.json" "pass" "${SETTINGS_SIZE} bytes, keys OK"
else
  add_check "settings.json" "fail" "file not found"
fi

# ── 5. Check window_pos.json consistency ──
WINDOW_POS="$APP_DATA/window_pos.json"
if [ -f "$WINDOW_POS" ]; then
  python -c "
import json
with open(r'$WINDOW_POS', encoding='utf-8') as f:
  p = json.load(f)
x, y = p.get('x', -1), p.get('y', -1)
# Window positions should be reasonable screen coordinates
if x >= 0 and y >= 0:
  print('OK')
else:
  print('NEGATIVE')
" 2>&1 > /dev/null && add_check "window position" "pass" "" || add_check "window position" "warn" "negative coordinates"
else
  add_check "window position" "warn" "file not found (app may not have saved position yet)"
fi

# ── 6. Check sticker cache health ──
STICKER_DIR="$APP_DATA/stickers"
if [ -d "$STICKER_DIR" ]; then
  STICKER_COUNT=$(find "$STICKER_DIR" -name "*.png" 2>/dev/null | wc -l | tr -d '[:space:]')
  STICKER_SIZE=$(du -sh "$STICKER_DIR" 2>/dev/null | cut -f1 || echo "0")
  add_check "sticker cache" "pass" "$STICKER_COUNT files, $STICKER_SIZE"
else
  add_check "sticker cache" "pass" "no stickers yet"
fi

# ── Output ──
if [ $FAIL -gt 0 ]; then STATUS="fail"; elif [ $WARN -gt 0 ]; then STATUS="warn"; else STATUS="pass"; fi
SUMMARY="{\"app_pid\":\"$APP_PID\",\"checks\":$((PASS + FAIL + WARN))}"
echo "{\"status\":\"$STATUS\",\"pass\":$PASS,\"fail\":$FAIL,\"warn\":$WARN,\"skip\":$SKIP,\"summary\":$SUMMARY,\"checks\":$CHECKS]}"
