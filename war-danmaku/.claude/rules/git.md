## Git 分支管理

**核心原则：main 永远可编译、可运行。**

### 何时开分支

| 场景 | 分支？ | 原因 |
|------|:--:|------|
| 小修 (typo、改一个配置值) | ❌ | 直接 commit 到 main |
| 新功能 (可能影响现有功能) | ✅ | 改崩了不影响 main |
| 实验性改动 (不确定能不能成) | ✅ | 废了就 `git branch -D` |
| 重构 (大面积改动) | ✅ | 改一半可存档, 随时切回 main 对比 |
| 多个独立任务并行 | ✅ | 各自分支, 互不阻塞 |

### 分支命名

```
feature/<功能名>     # 新功能, 如 feature/ranking-system
fix/<问题>           # 修 bug
experiment/<尝试>    # 实验, 可能废弃
```

### 日常流程

```bash
# 开始
git checkout main
git checkout -b feature/xxx

# 过程中随时存档
git add -A && git commit -m "checkpoint: 干了什么"

# 完成后合回
git checkout main
git merge feature/xxx
git branch -d feature/xxx
```

**关键习惯**：改动超过 50 行或超过 2 个文件 → 开分支。一个人开发不丢人, 这是保护自己。

### 踩过的坑

1. **Python `__pycache__` 缓存过时代码** — Python subprocess 会把 `.py` 编译成 `__pycache__/*.pyc`，改源码后 python 可能仍用旧 `.pyc`。症状: 明明修了 bug，错误一模一样。修复: `find . -name "__pycache__" -type d -exec rm -rf {} +` 清理后重跑。`.gitignore` 必须包含 `__pycache__/` 和 `*.pyc`。
2. **Windows Defender 拦截编译产物** — 症状: `os error 4551` / `应用程序控制策略已阻止此文件`。修复: Windows 安全中心 → 排除项 → 添加项目文件夹。
3. **切分支前忘记 stash** — 症状: `error: Your local changes would be overwritten by checkout`。修复: `git stash` → 切分支 → `git stash pop`。
4. **子进程 cwd 不是项目根** — Node.js 子进程的 cwd 通常是项目根，但通过某些启动器（如 VS Code task）运行时可能不同。症状: `fs.readFile('./config.json')` 找不到文件。修复: 用 `path.resolve(__dirname, ...)` 或 `process.cwd()` 确认后再用相对路径。

### 开发铁律 (第 2 批，从复发问题中总结)

5. **改功能前先 grep 全链路** — 改一个功能前 `grep -rn` 所有相关调用点，画完调用图再动手。反面案例: 改了 A 处漏了 B/C/D 处，功能"修好了"但下次重现。

6. **"改了但没生效"先查缓存层** — 不要反复加日志重跑。症状和排查顺序: `.pyc` 字节码缓存 → CDN/raw URL 缓存 → 浏览器缓存 → Node.js 模块缓存。5 次 `__pycache__` 问题都是这个根因。

7. **Serverless 运行时在响应后冻结** — Vercel free tier 在 HTTP response 发出后立即冻结进程。fire-and-forget 的 async 函数不会执行完。`await` 所有异步操作再返回 response。

8. **用户说的外部信息不当作事实** — 关键配置项（仓库路径、API URL、用户名）必须自己打开看一眼确认。

9. **能本地验证的不推到用户端** — 自己先跑通。让用户当测试机每一轮浪费几分钟。

### 开发铁律 (第 3 批)

10. **方案类改动先陈明利弊再动手** — 任何涉及方案选择、架构变动的改动，必须先向用户解释：①作用与意义 ②利与弊 ③核心取舍。禁止直接写代码。让用户拍板，因为不是所有技术优化都有产品价值。

### 开发铁律 (第 4 批 — 2026-06-29)

11. **文档按路径分仓管理** — 项目专属文档放项目 `docs/`，通用方法论放个人知识库 `D:\Docs\项目学习\`。commit 时按文件路径判断：`D:\Docs\` 下的改动 → 知识库仓库，`D:\Projects\` 下的改动 → 项目仓库。每次会话收尾时扫描本次所有改动，按路径分别 commit。判断标准：换项目时这份文档需要跟着走吗？要 → 知识库，不要 → 项目 docs/。

### 开发铁律 (第 5 批 — 2026-06-29)

12. **禁止贴膏药：修根因不堵出口** — 看到 bug 先排查真正的泄漏源/断裂点，不写 prompt 护栏、不写兜底代码掩盖症状。每条 prompt 护栏都要反问：这是修了根因，还是在堵出口？堵出口的改动必须撤回，重新找原因。

### 事件驱动约定

**emit 方只发事件，listener 统一处理持久化。** 不要在 emit 前或 emit 后自己写数据。

### 诊断日志

加 `console.log('[tag]', ...)` 前，先确认 tag 在项目的日志配置中有对应开关。临时诊断用 `console.log('[DEBUG]', ...)` 最安全。

---
