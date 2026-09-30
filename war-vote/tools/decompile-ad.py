import subprocess

java = r'D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15\jvm\bin\java.exe'
cfr = r'D:\Projects\live-waifu\war-vote\tools\cfr.jar'
clsfile = r'D:\Projects\live-waifu\war-vote\tools\decompiled\ad.class'

result = subprocess.run([java, '-jar', cfr, clsfile], capture_output=True, text=True, timeout=30)
lines = result.stdout.split('\n')

for i, line in enumerate(lines):
    ll = line.strip()
    if ll.startswith('if') and ('"-start"' in ll or '"-map"' in ll):
        start = max(0, i-2)
        end = min(len(lines), i+20)
        for j in range(start, end):
            print('{}: {}'.format(j, lines[j].rstrip()))
        print('===')