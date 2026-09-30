#!/usr/bin/env bash
# check-settings.sh — P0: settings.json 结构完整性 + 默认值覆盖检测
# 用法: bash check-settings.sh [app_data_dir]
# 输出: JSON { "status": "pass|fail|warn", "checks": [...], "summary": "..." }

set -e

APP_DATA="${1:-$APPDATA/com.waifu-agent.app}"
SETTINGS_FILE="$APP_DATA/settings.json"
WINDOW_POS="$APP_DATA/window_pos.json"
HISTORY="$APP_DATA/history.json"
PORTRAIT="$APP_DATA/portrait.json"

PASS=0; FAIL=0; WARN=0
CHECKS="["

add_check() { local name="$1" status="$2" detail="$3"
  [ "$CHECKS" != "[" ] && CHECKS="$CHECKS,"
  CHECKS="$CHECKS{\"name\":\"$name\",\"status\":\"$status\",\"detail\":\"$detail\"}"
  case "$status" in pass) PASS=$((PASS+1));; fail) FAIL=$((FAIL+1));; warn) WARN=$((WARN+1));; esac
}

# ── 1. settings.json 存在且有效 JSON ──
if [ ! -f "$SETTINGS_FILE" ]; then
  add_check "settings.json exists" "fail" "file not found at $SETTINGS_FILE"
  echo "{\"status\":\"fail\",\"pass\":$PASS,\"fail\":$FAIL,\"warn\":$WARN,\"checks\":$CHECKS]}"
  exit 0
fi

JSON_OK=$(python -c "
import json, sys
try:
  with open(r'$SETTINGS_FILE', encoding='utf-8') as f:
    json.load(f)
  print('OK')
except Exception as e:
  print(f'INVALID: {e}')
" 2>&1)

if [ "$JSON_OK" = "OK" ]; then
  add_check "settings.json valid JSON" "pass" ""
else
  add_check "settings.json valid JSON" "fail" "$JSON_OK"
  echo "{\"status\":\"fail\",\"pass\":$PASS,\"fail\":$FAIL,\"warn\":$WARN,\"checks\":$CHECKS]}"
  exit 0
fi

# ── 2. 关键字段存在性检查 ──
python -c "
import json, sys
with open(r'$SETTINGS_FILE', encoding='utf-8') as f:
  s = json.load(f)

required = {
  'character': ['scale', 'posX', 'posY'],
  'appearance': ['bgColor', 'borderRadius'],
  'llm': ['apiUrl', 'apiKey', 'model', 'timeoutSecs'],
  'window': ['alwaysOnTop', 'ttsVolume', 'width', 'height'],
  'websocket': ['url', 'reconnectDelayMs'],
  'chat': ['userBubbleColor', 'aiBubbleBg'],
  'layout': ['chatPanelWidth', 'statusPosition'],
}

missing = []
for section, keys in required.items():
  if section not in s:
    missing.append(f'missing section: {section}')
    continue
  for k in keys:
    if k not in s[section]:
      missing.append(f'{section}.{k}')

if missing:
  print('MISSING:' + ';'.join(missing))
else:
  print('OK')
" 2>&1 | while read line; do
  if echo "$line" | grep -q "^OK$"; then
    add_check "required keys present" "pass" ""
  else
    add_check "required keys present" "fail" "$(echo "$line" | sed 's/MISSING://')"
  fi
  echo "$line"
done

# ── 3. 值范围检查 ──
python -c "
import json
with open(r'$SETTINGS_FILE', encoding='utf-8') as f:
  s = json.load(f)

issues = []

# agentMode
mode = s.get('agentMode', '')
if mode not in ('builtin', 'relay'):
  issues.append(f'agentMode={mode} (expected builtin|relay)')

# ttsVolume
vol = s.get('window', {}).get('ttsVolume', 0)
if not (0 <= vol <= 100):
  issues.append(f'window.ttsVolume={vol} (expected 0-100)')

# character.scale — 默认值覆盖检测
scale = s.get('character', {}).get('scale', 0)
if scale == 0.25:
  issues.append('character.scale=0.25 (equals default — may be overwritten)')

# character pos
posX = s.get('character', {}).get('posX', 0)
posY = s.get('character', {}).get('posY', 0)
if abs(posX) > 2000 or abs(posY) > 2000:
  issues.append(f'character position ({posX},{posY}) out of range')

# timeout
timeout = s.get('llm', {}).get('timeoutSecs', 0)
if timeout < 10 or timeout > 300:
  issues.append(f'llm.timeoutSecs={timeout} (expected 10-300)')

if issues:
  print('RANGE:' + ';'.join(issues))
else:
  print('OK')
" 2>&1 | while read line; do
  if echo "$line" | grep -q "^OK$"; then
    add_check "value ranges" "pass" ""
  else
    detail="$(echo "$line" | sed 's/RANGE://')"
    # scale=0.25 是警告, 其他是失败
    if echo "$detail" | grep -q "scale=0.25"; then
      add_check "value ranges" "warn" "$detail"
    else
      add_check "value ranges" "fail" "$detail"
    fi
  fi
  echo "$line"
done

# ── 4. 相关文件检查 ──
for f in "$WINDOW_POS" "$HISTORY" "$PORTRAIT"; do
  fname=$(basename "$f")
  if [ -f "$f" ]; then
    python -c "
import json
with open(r'$f', encoding='utf-8') as fh:
  json.load(fh)
print('OK')
" 2>/dev/null && add_check "$fname valid" "pass" "" || add_check "$fname valid" "fail" "invalid JSON"
  else
    add_check "$fname exists" "warn" "file not found (may be first run)"
  fi
done

# ── 输出 ──
if [ $FAIL -gt 0 ]; then STATUS="fail"; elif [ $WARN -gt 0 ]; then STATUS="warn"; else STATUS="pass"; fi
echo "{\"status\":\"$STATUS\",\"pass\":$PASS,\"fail\":$FAIL,\"warn\":$WARN,\"checks\":$CHECKS]}"
