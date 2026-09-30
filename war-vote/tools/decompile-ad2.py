import subprocess

java = r'D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15\jvm\bin\java.exe'
cfr = r'D:\Projects\live-waifu\war-vote\tools\cfr.jar'
clsfile = r'D:\Projects\live-waifu\war-vote\tools\decompiled\ad.class'

result = subprocess.run([java, '-jar', cfr, clsfile], capture_output=True, text=True, timeout=30)
lines = result.stdout.split('\n')

# 搜索包含 start 或 map 的行（不限制 if）
for i, line in enumerate(lines):
    ll = line.strip().lower()
    if ('-start' in ll or '-map' in ll) and ('string' in ll or 'equals' in ll or 'match' in ll):
        start = max(0, i-5)
        end = min(len(lines), i+20)
        for j in range(start, end):
            print('{}: {}'.format(j, lines[j].rstrip()))
        print('===')