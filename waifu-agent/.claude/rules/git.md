## Git 分支管理

**核心原则：main 永远可编译、可运行。**

### 何时开分支

| 场景 | 分支？ | 原因 |
|------|:--:|------|
| 小修 (typo、改一个配置值) | ❌ | 直接 commit 到 main |
| 新功能 (可能影响现有功能) | ✅ | 改崩了不影响 main |
| 实验性改动 (不确定能不能成) | ✅ | 废了就 `git branch -D` |
| 重构 (大面积改动) | ✅ | 改一半可存档, 随时切回 main 对比 |
| 搬外部代码 (如这次 N.E.K.O.) | ✅ | 依赖没配好不能编译时, main 仍可用 |
| 多个独立任务并行 | ✅ | 各自分支, 互不阻塞 |

### 分支命名

```
feature/<功能名>     # 新功能, 如 feature/memory-system
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

1. **`cargo clean` 会删 MSI** — `src-tauri/target/` 里有编译缓存和打包产物 (MSI/exe ~28GB)。不要随便 `cargo clean`，除非明确要重建。
2. **`cargo clean` 可能损坏 crate 缓存** — 删掉 `target/` 后有些 crate (如 phf_macros) 可能重编译失败。症状: `can't find crate for 'phf_macros'`。修复: 删 `~/.cargo/registry/cache/` 下对应的 crate 目录后重新 `cargo build`。
3. **Python `__pycache__` 缓存过时代码** — Python subprocess 会把 `.py` 编译成 `__pycache__/*.pyc`，改源码后 python 可能仍用旧 `.pyc`。症状: 明明修了 bug，错误一模一样。修复: `find . -name "__pycache__" -type d -exec rm -rf {} +` 清理后重跑。`.gitignore` 必须包含 `__pycache__/` 和 `*.pyc`。
4. **Windows Defender 拦截编译产物** — 症状: `os error 4551` / `应用程序控制策略已阻止此文件`。修复: Windows 安全中心 → 排除项 → 添加项目文件夹。
5. **切分支前忘记 stash** — 症状: `error: Your local changes would be overwritten by checkout`。修复: `git stash` → 切分支 → `git stash pop`。
6. **子进程 cwd 不是项目根** — Tauri dev 时 Rust 子进程的 cwd 是 `src-tauri/`，相对路径 `waifu-memory/cli.py` 会解析为 `src-tauri/waifu-memory/cli.py`（错误）。修复: Rust 端用 `env!("CARGO_MANIFEST_DIR")` 的父目录拼绝对路径。
7. **TTS 清洗管线不同步** — 新增 `[tag]` 语法标记后忘了同步更新 `clean_tts_text`（Rust+TS 两边各有一个实现），导致 `[teasing]` 被 TTS 念出来。教训：新增任何文本语法 → `grep -rn "clean_tts\|cleanTts"` 检查所有清洗函数是否需要同步更新。

### 开发铁律 (第 2 批，从复发问题中总结)

7. **改功能前先 grep 全链路** — 改 auth 逻辑时只改了 App.tsx，漏了 AuthPanel 里独立的 auto-reauth。症状: 功能"修好了"但每次重启仍触发旧行为。修复: 改一个功能前 `grep -rn` 所有相关调用点，画完调用图再动手。

8. **"改了但没生效"先查缓存层** — 不要反复加日志重跑。症状和排查顺序: `.pyc` 字节码缓存 → CDN/raw URL 缓存 → 浏览器/Vite 热更新缓存 → Rust 编译缓存。5 次 `__pycache__` 问题和 Gitee raw URL CDN 延迟都是这个根因。

9. **Serverless 运行时在响应后冻结** — Vercel free tier 在 HTTP response 发出后立即冻结进程。fire-and-forget 的 async 函数不会执行完。`await` 所有异步操作再返回 response。

10. **用户说的外部信息不当作事实** — 用户说 "Gitee 用户名是 gaven"，结果是 gaven6666。关键配置项（仓库路径、API URL、用户名）必须自己打开看一眼确认。

11. **能本地验证的不推到用户端** — Python CLI、curl、单元测试自己先跑通。让用户当测试机每一轮浪费几分钟。

### 开发铁律 (第 3 批)

12. **方案类改动先陈明利弊再动手** — 任何涉及方案选择、架构变动的改动，必须先向用户解释：①作用与意义 ②利与弊 ③核心取舍。禁止直接写代码。让用户拍板，因为不是所有技术优化都有产品价值。反面案例：checksum 完整性校验、机器码校验——都是做了才问，用户反问你做这个干什么。同时，涉及二进制/模型文件的问题优先整目录替换干净源，不修修补补。

### 开发铁律 (第 4 批 — 2026-06-29)

13. **文档按路径分仓管理** — 项目专属文档放项目 `docs/`，通用方法论放个人知识库 `D:\Docs\项目学习\`。commit 时按文件路径判断：`D:\Docs\` 下的改动 → 知识库仓库，`D:\Projects\` 下的改动 → 项目仓库。每次会话收尾时扫描本次所有改动，按路径分别 commit。判断标准：换项目时这份文档需要跟着走吗？要 → 知识库，不要 → 项目 docs/。

### 开发铁律 (第 5 批 — 2026-06-29)

14. **禁止贴膏药：修根因不堵出口** — 看到 bug 先排查真正的泄漏源/断裂点，不写 prompt 护栏、不写兜底代码掩盖症状。反面案例（今日复现 4 次）：AI 回复出问题→加 SOUL.md "你不懂代码"（真正泄漏源是 read_clipboard）；AI 猜错事实→加 prompt "你没有联网能力"（真正解法是给搜索能力）。每条 prompt 护栏都要反问：这是修了根因，还是在堵出口？堵出口的改动必须撤回，重新找原因。

### 事件驱动约定

**emit 方只发事件，listener 统一处理持久化。** 不要在 emit 前或 emit 后自己写数据。反面案例：STT 路径既 emit 又自己 `save_turn`，每条消息写两次。

### 诊断日志

加 `log(tag, ...)` 前，先确认 tag 在 `src/config/logConfig.ts` 的 `LOG_SWITCH` 里。临时诊断用 `log("App", ...)` 最安全。

---
