import subprocess, zipfile, os

jar = r'D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15\game-lib.jar'
out = r'D:\Projects\live-waifu\war-vote\tools\decompiled'
java = r'D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15\jvm\bin\java.exe'
cfr = r'D:\Projects\live-waifu\war-vote\tools\cfr.jar'

with zipfile.ZipFile(jar) as z:
    data = z.read('com/corrodinggames/rts/game/units/ar.class')
    with open(os.path.join(out, 'UnitTypes.class'), 'wb') as f:
        f.write(data)

result = subprocess.run([java, '-jar', cfr, os.path.join(out, 'UnitTypes.class')], capture_output=True, text=True, timeout=30)
lines = result.stdout.split('\n')

# 搜索所有单位类型字符串
import re
unit_types = set()
for line in lines:
    # 找 a("xxx") 模式 - 单位注册
    matches = re.findall(r'a\("([a-zA-Z]+)"', line)
    for m in matches:
        if len(m) > 2 and m not in ['get', 'set', 'add', 'new', 'the', 'and', 'for', 'not', 'null', 'true', 'false', 'int', 'long', 'float', 'void', 'this', 'super', 'class', 'return', 'static', 'final', 'public', 'private', 'protected', 'abstract', 'interface', 'extends', 'implements', 'import', 'package', 'throw', 'throws', 'catch', 'try', 'finally', 'if', 'else', 'while', 'for', 'do', 'switch', 'case', 'break', 'continue', 'default', 'new', 'instanceof', 'assert', 'enum', 'synchronized', 'transient', 'volatile', 'strictfp', 'native']:
            unit_types.add(m)

print('找到的单位类型:')
for u in sorted(unit_types):
    print(' ', u)