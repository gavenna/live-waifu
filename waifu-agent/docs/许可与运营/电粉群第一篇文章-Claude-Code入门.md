# Claude Code CLI 小白使用指导篇：从安装到最佳实践

> 作者：gaven · 2026-07-08
> 电粉群第一篇文章

---

这篇文章是写给谁看的？**想用 AI 写代码、但不确定从哪开始的人。**

我自己用 Claude Code 做了 waifu-agent 这个项目——一个带 Live2D 角色表情+口型同步的桌面 AI 前端。写了几万行 TypeScript + Rust，大部分代码是 Claude Code 帮我写的。这篇文章把我从零到一的经验整理出来，希望能帮你少走弯路。

---

## 一、Claude Code 到底是什么

很多人第一反应是"又一个 AI 聊天工具"。不是。

Claude Code 是一个**跑在终端里的 AI 编程助手**。它和 ChatGPT/Cursor/Copilot 的本质区别：

| 工具 | 定位 | 你能干什么 |
|------|------|-----------|
| ChatGPT | 通用对话 | 聊天、问答、写文案 |
| Cursor | AI 编辑器 | 在编辑器里让 AI 补全/重构代码 |
| GitHub Copilot | 代码补全 | 写代码时自动补全下一行 |
| **Claude Code** | **AI Agent** | **让它自己读代码→改代码→跑命令→验证** |

关键差异：Claude Code **会自己动手**。你告诉它"在设置面板加一个语音开关"，它会自己找到设置组件、加上开关、更新类型定义、注册事件——整个过程你只需要确认。

当然，它不是魔法。它也会犯错、也会理解偏、也会写出你需要改的代码。但如果你理解它的边界、学会怎么用好它，它能帮你做的事情远超其他工具。

---

## 二、安装（3 分钟）

### 前置条件

- 有 Git（版本 2.38+）
- 有终端（Windows Terminal / macOS Terminal / Linux 终端）

> **2026 年更新**：Claude Code 现在是原生二进制安装，不再依赖 Node.js。装完就能用。

### macOS / Linux / WSL

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

### Windows（PowerShell）

```powershell
irm https://claude.ai/install.ps1 | iex
```

### 其他方式

```bash
# Homebrew (macOS)
brew install --cask claude-code

# WinGet (Windows)
winget install Anthropic.ClaudeCode
```

### 验证安装

```bash
claude --version
claude doctor   # 检查环境是否正常
```

装完之后，在任意项目目录里敲 `claude` 就启动了。

---

## 三、第一次启动：认证 + 初始化

### 认证

首次运行 `claude` 会自动打开浏览器做 OAuth 登录。用你的 Anthropic 账号（就是 claude.ai 那个账号）授权就行。

如果你有 API Key（从 [console.anthropic.com](https://console.anthropic.com) 获取），可以这样：

```bash
export ANTHROPIC_API_KEY=sk-ant-...
claude
```

**注意一个坑**：API Key 的优先级 > 订阅登录。如果你设了 API Key，即使你有 Pro 订阅，也会走 API 按量付费。不确定当前走的是哪种认证时，在会话里敲 `/status` 查看。

### 生成 CLAUDE.md

进项目后，先敲 `/init`。Claude 会自动扫描你的项目结构，生成一个 `CLAUDE.md` 文件。

这个文件是 Claude 的"项目说明书"——每次启动会话时自动读取。里面应该写什么、不写什么，后面会详细讲。

### 设为中文

```bash
claude config set -g language zh
```

这样 Claude 会用中文回复你。

---

## 四、基础操作：10 分钟上手

### 4.1 核心概念：这不是聊天，是指挥 Agent

你给 Claude Code 的每一句话都是一条**指令**，它会：

1. 理解你的意图
2. 自己读相关文件
3. 做修改
4. （如果需要）跑命令验证
5. 告诉你结果

所以**说清楚比说得多重要**。与其写三行描述，不如直接说：

```
在 src/App.tsx 的 handleSave 函数里加一个 try-catch，catch 里用 console.error 打印错误信息
```

### 4.2 权限系统：谁在控制谁

Claude Code 的权限分 6 级，用 `Shift+Tab` 循环切换：

| 模式 | 行为 | 什么时候用 |
|------|------|-----------|
| **default** | 除了读文件，其他都问你 | 日常开发（推荐） |
| **plan** | 只能读，不能改 | 出方案、分析代码 |
| **acceptEdits** | 自动改文件，命令问你 | 信任它改代码，但不想它乱跑命令 |
| **bypassPermissions** | 全自动，不问你 | 跑批处理、你100%确定安全的场景 |

**新手建议**：日常用 `default` 模式。你要对每一步有掌控。等用熟了再放宽。

### 4.3 对话技巧

几个立刻见效的技巧：

**① 用 `@` 引用文件**

```
@src/types/settings.ts 参考这个类型定义，帮我加一个 voiceEnabled 字段
```

Claude 会自动读取这个文件作为上下文。

**② 大任务先用 plan mode**

```
/plan
我想在设置面板加一个语音开关，先分析一下涉及哪些文件和改动点
```

出方案 → 审核 → 再切回 default 执行。这是我写 waifu-agent 养成的习惯：复杂的跨文件改动先进 plan mode 出方案，避免改一半发现方向错了。

**③ 给它验证手段**

```
...改完之后跑 npm run build 确认编译通过
```

不要只让它改——让它自己验证。这条 prompt 技巧至少帮我拦住了几十次低级错误。

**④ 任务切换用 `/clear`**

一个会话只干一件事。干了三件事还不清上下文，Claude 会越来越"糊涂"——它会把前面任务的上下文和当前需求混在一起。

**⑤ 同一问题纠正 3 次不行 → `/clear` 重来**

不要在错误的上下文中反复修正。清掉历史，重新描述需求，往往比原地打转快得多。

### 4.4 常用命令速查

| 命令 | 作用 |
|------|------|
| `/help` | 列出所有命令 |
| `/clear` | 清空对话历史（任务切换必用） |
| `/compact` | 压缩上下文释放空间 |
| `/plan` | 进入计划模式 |
| `/diff` | 查看本次会话改了什么 |
| `/cost` | 查看 Token 用量和花费 |
| `/context` | 看上下文用了多少 |
| `/status` | 查看认证状态 |
| `/init` | 生成 CLAUDE.md |
| `Esc` | 中断 Claude 回复 |
| `Esc, Esc` | 回滚菜单（后悔药） |

---

## 五、进阶功能：从小白到熟练

以下内容你可能不会第一天就用，但知道它们存在能帮你理解 Claude Code 的完整能力。

### 5.1 CLAUDE.md：给 AI 写"项目说明书"

这是我踩坑最多的地方。一开始我把 CLAUDE.md 写到了 300+ 行——架构图、API 文档、命名规范、格式化规则全塞进去。结果 Claude 每条回复都先花大量 token 去"消化"这个说明书，反而变慢了。

**CLAUD.md 只写 Claude 猜不到的东西。**

✅ 应该写：

```markdown
# 命令
npm run dev          # 启动开发服务器
npx tauri build      # 打包 MSI
./node_modules/.bin/tsc --noEmit   # TS 类型检查

# 架构
三窗口系统：MainWindow + SettingsWindow + ChatWindow
数据流：用户输入 → LLM → TTS + 口型 + 贴图

# 核心规则（Claude 最容易搞错）
- 静态资产用 bundle.resources，运行时数据用 app_data_dir()
- 无框窗口所有交互元素必须拦截 onMouseDown + onMouseUp
- save_settings 传完整对象，禁止 partial write
```

❌ 不该写：

```
- 代码格式化规则（用 PostToolUse hook 做）
- API 文档（Claude 会自己读代码）
- 团队不遵守的"理论规范"
- 每行超过 120 字符要换行
```

**每写一行都问自己："如果删掉这行，Claude 会犯错误吗？"** 不会就删。

我的 waifu-agent 的 CLAUDE.md 浓缩后大约 150 行，包括了启动命令、架构概览、10 条核心规则、关键文件表。这个量对大多数项目足够。

另外，`.claude/rules/` 目录可以放**路径限定规则**——只在 Claude 碰到特定文件时才加载：

```markdown
---
paths:
  - "src-tauri/**/*.rs"
---

# Rust 规则
- 新增 Tauri command: lib.rs 实现 → invoke_handler![] 注册
- 错误不能 unwrap_or_default() 吞掉
```

### 5.2 Hooks：自动化检查防线

Hooks 是我最喜欢的功能。它在 Claude Code 生命周期的固定时机触发你的自定义脚本——相当于给 AI Agent 装了四道安检门。

我 waifu-agent 项目配了这样的四层防护：

| 层级 | Hook | 检查什么 | 失败后果 |
|------|------|---------|---------|
| PreToolUse | `check-catch-silence.py` | `.catch(() => {})` 静默吞错 | **阻断**，不让代码写进去 |
| PostToolUse | `validate-settings.py` | `settings.json` 被部分覆盖 | 警告 |
| PostToolUse | `check-tts-pipeline.py` | 新增语法标记时管线同步 | 警告 |
| Stop | `verify.sh` | 自动跑 tsc + cargo check | **阻断**，编译不过不结束 |
| Stop | `waifu-speak.py` | 对话类回复用 TTS 朗读 | 静默容错 |

**Hook 类型速览**：

| 事件 | 触发时机 | 能阻断吗 |
|------|---------|---------|
| `PreToolUse` | 工具调用**前** | ✅ exit 2 直接拦截 |
| `PostToolUse` | 工具调用**后** | ❌ 工具已执行 |
| `Stop` | Claude 回复完毕 | ✅ 可以阻止结束 |
| `SessionStart` | 会话开始时 | ❌ |

配置示例（放在 `.claude/settings.json`）：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{
          "type": "command",
          "command": "python .claude/hooks/check-code-quality.py",
          "timeout": 30
        }]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [{
          "type": "command",
          "command": "bash .claude/hooks/verify.sh"
        }]
      }
    ]
  }
}
```

对于个人项目，你可能不需要这么重的防护。但至少配一个 **Stop hook 跑编译检查**——这是性价比最高的防线，能拦住 80% 的低级错误。

### 5.3 Memory：持久记忆系统

Claude Code 有一个持久化记忆系统，跨会话保留重要信息。

我 waifu-agent 项目用 memory 存了大约 30 条项目记忆，比如：

- `afdian-launch-strategy.md` — 爱发电首帖策略
- `no-bandaid-fixes.md` — 禁止贴膏药：修根因不堵出口
- `tts-pipeline-img-tag-leak.md` — TTS 管线 bug 的完整复盘

每条记忆是一个 markdown 文件，有 frontmatter 标签。`MEMORY.md` 是索引文件，启动时自动注入上下文。

**什么时候用**：一个经验跨会话反复踩 → 写成 memory。Claude 下次启动自动读到，不会再犯。

### 5.4 Skills & Subagents：让 Claude 分工

**Skills** 是自定义 slash 命令（`/xxx`），触发时会自动加载该领域的专属知识。我 waifu-agent 配了 6 个 skill：

| 命令 | 用途 |
|------|------|
| `/deploy` | 构建发布 |
| `/review` | 代码审查 + 体验审查 |
| `/verify` | 自动验证改动 |
| `/prompt` | 调整 AI prompt |
| `/cubism` | Live2D 角色相关 |
| `/backend` | Rust 后端改动 |
| `/frontend` | React 前端改动 |

每个 skill 对应一个 `SKILL.md` 文件，里面是这个领域的专属规则和注意事项。

**Subagents** 是隔离的"子 Agent"——你派一个任务出去，它在独立上下文里跑完，只把结果汇报给你。不占用主会话的上下文窗口。

**什么时候用 skill vs subagent**：

- 需要领域知识 → skill（例如"改 Rust 代码前先加载 Rust 相关规则"）
- 需要独立执行不影响主会话 → subagent（例如"帮我在全项目里搜索所有用到 X 的地方"）

### 5.5 MCP：连接外部工具

MCP（Model Context Protocol）让 Claude 可以直接操作外部服务——数据库、浏览器、Slack、GitHub。

最实用的几个：

- **Playwright MCP** — Claude 可以打开网页、截图、测试 UI
- **GitHub MCP** — 直接管理 PR/Issue
- **PostgreSQL MCP** — 查数据库

```bash
claude mcp add playwright -- npx @anthropic-ai/mcp-playwright
```

对大多数个人开发者来说，**MCP 不是必需品**。但你如果做全栈开发，接一个数据库 MCP 能让 Claude 直接帮你写 SQL 并验证。

---

## 六、最佳实践：我用血的教训换来的

以下不是官方文档，是我写 waifu-agent 这几个月用 Claude Code 的真实经验。

### 6.1 上下文窗口是最宝贵的资源

Claude Code 的上下文窗口有限（Pro 约 44K tokens/5小时）。每次对话、每个文件读取、每条 CLAUDE.md 都在消耗这个窗口。所以：

- **CLAUDE.md 写精不写多**（150 行以内）
- **大任务用 subagent**，不要全在主会话做
- **感觉上下文不够了立刻 `/compact`**，别硬撑
- **一个会话只干一件事**，任务切换用 `/clear`

### 6.2 从 Plan Mode 开始

在 waifu-agent 的开发中，我养成了"先 plan 再动手"的习惯：

```
/plan
需求：在设置面板加语音开关
先分析涉及哪些文件、每种方案的利弊
```

出方案后审核 → 切回 default 执行。这个流程帮我避免了至少 10 次"改了一半发现方案有问题"的情况。

### 6.3 禁止贴膏药——修根因，不堵出口

这是 waifu-agent 开发中最深刻的教训。

算上今天，我的项目里至少发生了 4 次同样的问题：AI 写出的回复有问题 → 我在 prompt 里加了一句"你不要这样" → 治标不治本 → 下次从另一个出口泄漏。

正确的做法：**顺着数据流往上追溯，找到真正的泄漏源。** 不是给 AI 加更多规则——是找到为什么规则没生效。

在 Claude Code 的语境下：如果 Claude 反复犯同一个错误，不要写更长的 prompt，先去检查：
1. CLAUDE.md 里的规则是否矛盾
2. 上下文是否已经污染
3. Hook 是否有失效的防线

### 6.4 让它自己验证

每次让 Claude 改完代码，在 prompt 末尾加一句：

```
改完跑 npm run build 确认编译通过
```

或者配一个 Stop hook（见 5.2），自动在每次回复结束时跑编译检查。不要等你自己发现。

### 6.5 Writer/Reviewer 模式

对于重要改动：**A 会话写代码 → `/clear` → B 新会话审代码。**

原因是 Claude 在同一个会话里会对自己刚写的代码"手软"——它已经有了思维定式。新会话的上下文是干净的，更容易发现问题。

如果你只有一个人、而且不懂代码呢？至少做到：**A 会话改完 → 等几小时 → 新会话 `/diff` 检查改了哪些文件 → 让 Claude 解释每个改动。**

### 6.6 给成功条件，而不是给命令

❌ 不好的 prompt：
```
把我的设置系统改一下
```

✅ 好的 prompt：
```
参考 src/types/settings.ts 的类型定义，在设置面板加一个语音开关：
- 默认值是 true
- 关闭时 TTS 不发声但文字正常显示
- 开关状态保存到 settings.json
改完跑 npm run build 确认编译通过
```

后者给了：
- 具体位置（参考哪个文件）
- 明确需求（开关行为）
- 验收标准（编译通过）

### 6.7 总结：一条口诀

> **说清楚、给范围、配验证、清上下文、修根因。**

---

## 七、Windows 用户特别指南

### 终端选择

**强烈推荐 Windows Terminal + PowerShell 7**。不要用旧版 CMD 或直接开 Git Bash 跑 Claude Code。

我自己的环境：Windows 11 + Git Bash（在 Claude Code 里执行命令用）+ Windows Terminal。

### 中文编码问题

Windows 默认代码页是 GBK（936），Claude Code 输出 UTF-8——中文可能显示为乱码。

**最快修复**：

```powershell
chcp 65001   # 当前终端切换为 UTF-8
```

**永久方案**（PowerShell profile 里加）：

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
```

**终极方案**：用 WSL2。在 WSL Ubuntu 里装 Claude Code，完全规避 Windows 的编码问题。

### 其他 Windows 坑

- **`claude` 命令找不到**：把 `C:\Users\<用户名>\AppData\Roaming\npm` 加入系统 PATH
- **PowerShell 不让运行脚本**：管理员权限跑 `Set-ExecutionPolicy RemoteSigned`
- **`/copy` 命令复制中文乱码**：这是已知 bug（GitHub Issue #27709），暂时手动选中文字 Ctrl+C

---

## 八、套餐怎么选

| 套餐 | 价格 | 适合谁 |
|------|------|--------|
| **Pro** | $20/月 | **多数人**。日均 10-40 条消息，够用 |
| **Max 5x** | $100/月 | 整天用 Claude 写代码的人。Pro 容量的 5 倍 |
| **Max 20x** | $200/月 | 重度 Agent 工作流、多项目并行 |
| **API 按量** | 按 Token | CI/CD、不想被窗口限制、用量波动大 |

**我的建议**：新手直接 Pro $20/月。用一阵子如果发现容量不够再升。没必要一上来就 Max。

如果你用量波动大（有时好几天不用，有时一用一整天），可以考虑 API 按量付费。粗略参考：Pro $20/月 = 每天约 $0.67。如果你日均 API 花费低于这个数，API 更划算。

配置 API Key：

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

---

## 九、写在最后

Claude Code 不是一个"用 AI 替代码"的工具——它是一个让你和 AI **协同编程**的环境。

你仍然需要理解自己在做什么、做出决策、验证结果。但你可以把大量"找到文件→读懂→改几行→验证"的机械劳动交给它，把精力集中在真正需要判断的事情上。

我写 waifu-agent 这几个月，Claude Code 处理了大约 80% 的代码量。但它不能替代我对产品的判断、对架构的选择、对"什么该做什么不该做"的取舍。它放大了我的能力——但方向盘还是在我手里。

希望这篇文章对你有用。有问题直接在电粉群里问。

---

> **下一篇预告**：我是怎么用 CLAUDE.md + Hooks + Memory 搭建 waifu-agent 开发工作流的——完整配置拆解 + 踩坑记录。
