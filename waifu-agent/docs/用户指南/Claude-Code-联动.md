# Claude Code 联动 — waifu 朗读你的 AI 回复

> 让 Claude Code 的每一次回复，都由 waifu-agent 角色朗读出来。

## 你需要

- waifu-agent 已安装并运行（任务栏有图标）
- Claude Code 已安装
- 本文档附件中的 `waifu-speak.py`

## 配置

**把 `waifu-speak.py` 放到你当前项目的根目录，然后对 Claude Code 说：**

```
帮我在当前项目配置 waifu-agent 朗读联动。

步骤：
1. 把根目录的 waifu-speak.py 移动到 .claude/hooks/waifu-speak.py
2. 运行 pip install edge-tts websockets
3. 在 .claude/settings.local.json 添加 Stop hook，
   command 用 python <项目绝对路径>/.claude/hooks/waifu-speak.py
   如果已有其他 Stop hook，追加到数组里，不要覆盖
4. 完事告诉我，我试一句"你好"验证
```

> 就这一句话。之后每次 Claude Code 回复结束，waifu 角色自动开口朗读。

---

## 验证

对 Claude Code 说"你好"，回复结束后角色开口说话 = 成功。

没反应？对 Claude Code 说"检查 waifu hook 为什么没生效"，它自己会排查。

---

## 定制

| 想改的 | 怎么做 |
|--------|--------|
| 换声音 | 编辑 `waifu-speak.py` 顶部的 `TTS_VOICE`，可选 `zh-CN-YunxiNeural`（男声）、`zh-CN-XiaoyiNeural`（温柔女声） |
| 调朗读长度 | 改 `MAX_PREVIEW`（默认 80 字） |
| 关闭朗读 | 删掉 `.claude/settings.local.json` 里对应的 Stop hook |

也可以对 Claude Code 说"帮我改 waifu-speak.py"，让它帮你改。

---

## 常见问题

**每次回复都念吗？** 不。代码块、表格、长文档（>500 字）、超短句（<10 字）自动跳过。

**怎么卸载？** 对 Claude Code 说"帮我去掉 waifu hook"。
