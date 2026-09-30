# 修复 hook 路径

`settings.local.json` 里 hook 命令多了 `..`，导致 Edit/Write 工具报错。

## 运行修复

```bash
cd D:/Projects/waifu-agent && python -c "
with open('.claude/settings.local.json', 'r') as f: c=f.read()
c=c.replace('python ../.claude/hooks/', 'python .claude/hooks/')
with open('.claude/settings.local.json', 'w') as f: f.write(c)
print('done')
"
```
