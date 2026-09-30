#!/usr/bin/env bash
# check-content-quality.sh — P1: 对话日志分析
# 用法: bash check-content-quality.sh
set -e

python -c "
import json, os, sys
from collections import Counter

appdata = os.path.expandvars(r'%APPDATA%\com.waifu-agent.app')
conv_dir = os.path.join(appdata, 'conversations')

if not os.path.isdir(conv_dir):
  print(json.dumps({'status':'warn','pass':0,'fail':0,'warn':1,'summary':{},
    'checks':[{'name':'conversation logs','status':'warn','detail':'no conversations/ dir'}]}))
  sys.exit(0)

files = sorted([f for f in os.listdir(conv_dir) if f.endswith('.jsonl')])
if not files:
  print(json.dumps({'status':'warn','pass':0,'fail':0,'warn':1,'summary':{},
    'checks':[{'name':'conversation logs','status':'warn','detail':'no data'}]}))
  sys.exit(0)

recent = files[-3:]
all_turns = []
for fname in recent:
  fpath = os.path.join(conv_dir, fname)
  with open(fpath, encoding='utf-8') as f:
    for line in f:
      line = line.strip()
      if not line: continue
      try:
        turn = json.loads(line)
        all_turns.append(turn)
      except: pass

if not all_turns:
  print(json.dumps({'status':'warn','pass':0,'fail':0,'warn':1,'summary':{},
    'checks':[{'name':'conversation logs','status':'warn','detail':'empty'}]}))
  sys.exit(0)

assistant_turns = [t for t in all_turns if t.get('role') == 'assistant']
user_turns = [t for t in all_turns if t.get('role') == 'user']

lengths = [len(t.get('text','')) for t in assistant_turns] if assistant_turns else []
avg_len = round(sum(lengths)/len(lengths), 1) if lengths else 0

too_short = [l for l in lengths if l < 20]
too_long = [l for l in lengths if l > 1000]

emotion_keywords = ['开心','难过','生气','惊讶','害羞','喜欢','担心','温柔','调皮','傲娇']
emotions_found = set()
for t in assistant_turns:
  text = t.get('text','')
  for ek in emotion_keywords:
    if ek in text:
      emotions_found.add(ek)

ratios = []
for i in range(len(all_turns)-1):
  if all_turns[i].get('role')=='user' and all_turns[i+1].get('role')=='assistant':
    u_len = len(all_turns[i].get('text',''))
    a_len = len(all_turns[i+1].get('text',''))
    if u_len > 0: ratios.append(a_len/u_len)

repetitions = 0
for i in range(len(assistant_turns)):
  for j in range(i+1, min(i+6, len(assistant_turns))):
    a = assistant_turns[i].get('text','').strip()
    b = assistant_turns[j].get('text','').strip()
    if a == b and len(a) > 3:
      repetitions += 1
      break

non_chinese = 0
for t in assistant_turns:
  text = t.get('text','')[:50]
  cjk = sum(1 for c in text if '一' <= c <= '鿿')
  if len(text) > 10 and cjk < len(text) * 0.3:
    non_chinese += 1

checks = []
# Response length
if too_long:
  checks.append({'name':'response length','status':'warn','detail':f'{len(too_long)}/{len(lengths)} >1000 chars (avg={avg_len})'})
elif too_short:
  checks.append({'name':'response length','status':'fail','detail':f'{len(too_short)}/{len(lengths)} <20 chars (avg={avg_len})'})
else:
  checks.append({'name':'response length','status':'pass','detail':f'avg={avg_len}, min={min(lengths) if lengths else 0}, max={max(lengths) if lengths else 0} ({len(lengths)} responses)'})

# Emotion diversity
if len(emotions_found) >= 3:
  checks.append({'name':'emotion diversity','status':'pass','detail':f'{len(emotions_found)} emotions: {\", \".join(sorted(emotions_found))}'})
elif len(emotions_found) >= 1:
  checks.append({'name':'emotion diversity','status':'warn','detail':f'only {len(emotions_found)} emotions: {\", \".join(sorted(emotions_found))}'})
else:
  checks.append({'name':'emotion diversity','status':'warn','detail':'no emotion keywords detected'})

# IO ratio
if ratios:
  avg_ratio = round(sum(ratios)/len(ratios), 1)
  extreme = [r for r in ratios if r > 20 or r < 0.05]
  if extreme:
    checks.append({'name':'IO ratio','status':'warn','detail':f'{len(extreme)}/{len(ratios)} extreme (avg={avg_ratio})'})
  else:
    checks.append({'name':'IO ratio','status':'pass','detail':f'avg={avg_ratio} ({len(ratios)} pairs)'})
else:
  checks.append({'name':'IO ratio','status':'pass','detail':'no paired turns'})

# Repetition
if repetitions > 0:
  checks.append({'name':'repetition','status':'fail','detail':f'{repetitions} repeats in 5-turn window'})
else:
  checks.append({'name':'repetition','status':'pass','detail':'no repeats'})

# Language
if non_chinese > 0:
  checks.append({'name':'language','status':'warn','detail':f'{non_chinese} non-Chinese responses'})
else:
  checks.append({'name':'language','status':'pass','detail':'all Chinese'})

status = 'pass'
for c in checks:
  if c['status'] == 'fail': status = 'fail'; break
for c in checks:
  if c['status'] == 'warn' and status == 'pass': status = 'warn'

summary = {'turns':len(all_turns),'assistant_turns':len(assistant_turns),'avg_len':avg_len,
  'emotions':len(emotions_found),'repetitions':repetitions,'days':len(recent)}

print(json.dumps({'status':status,'pass':sum(1 for c in checks if c['status']=='pass'),
  'fail':sum(1 for c in checks if c['status']=='fail'),
  'warn':sum(1 for c in checks if c['status']=='warn'),
  'summary':summary,'checks':checks}, ensure_ascii=False))
" 2>&1
