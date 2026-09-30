import subprocess, zipfile, os, re

jar = r'D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15\game-lib.jar'
out = r'D:\Projects\live-waifu\war-vote\tools\decompiled'
java = r'D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15\jvm\bin\java.exe'
cfr = r'D:\Projects\live-waifu\war-vote\tools\cfr.jar'

result = subprocess.run([java, '-jar', cfr, os.path.join(out, 'UnitTypes.class')], capture_output=True, text=True, timeout=30)
text = result.stdout

# 找所有字符串字面量
strings = re.findall(r'"([a-zA-Z][a-zA-Z0-9]{2,25})"', text)
# 过滤 Java 关键词
keywords = {'String', 'Integer', 'Boolean', 'Long', 'Float', 'Double', 'Object', 'Class', 'void', 'null', 'true', 'false', 'this', 'super', 'return', 'static', 'final', 'public', 'private', 'protected', 'abstract', 'interface', 'extends', 'implements', 'import', 'package', 'throw', 'throws', 'catch', 'try', 'finally', 'else', 'while', 'switch', 'case', 'break', 'continue', 'default', 'new', 'instanceof', 'assert', 'enum', 'synchronized', 'transient', 'volatile', 'native', 'Runtime', 'Exception', 'Error', 'System', 'Thread', 'Runnable', 'Override'}
for s in sorted(set(strings)):
    if s not in keywords and not s.startswith('get') and not s.startswith('set') and not s.startswith('is') and not s.startswith('on'):
        print(s)