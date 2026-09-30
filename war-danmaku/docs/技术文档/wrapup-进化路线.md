# /wrapup 进化路线

> 2026-07-18 调研决定。来源：CoachSteff `handover-skills`、zeshuochen `session-end`、context-governor、Terry Li hook 自动化、Anthropic 40万会话数据分析。

## 本次执行（5项）

| # | 项目 | 说明 |
|---|------|------|
| 1 | `/wrapup` SKILL.md 强制输出约束 | 6.2/6.3 每条资产类型必须写"有→创建"或"无→原因" |
| 2 | `/pickup` skill | 新会话入口：读 HANDOVER → git 对比 → 报告漂移 → 恢复计划 |
| 3 | `HANDOVER.md` 模板 | 根目录单文件，四个区：current_state / failed_approaches / next / drift_warning。每次 /wrapup 覆写 |
| 4 | `PROGRESS.md` | 根目录单文件追加式时间线。每次 /wrapup 末尾追加一条 |
| 5 | 更新 `wrapup-logs/` 模板 | 加 Top 5 待办、强制错误复盘条目 |

---

## 暂缓（6项）

| # | 项目 | 不做原因 | 触发条件（什么时候该重新考虑） |
|---|------|---------|------|
| 1 | Hook 自动触发 | 需改 settings.json，侵入性强。手动 `/wrapup` 的摩擦合理 | 用户频繁忘记执行 /wrapup 导致状态丢失 |
| 2 | 上下文预算 50%/60% 自动切 | Claude Code 不暴露 `contextUsed%` API，skill 拿不到数据 | Anthropic 开放上下文 API |
| 3 | `handover/` 存档快照 | solo 项目，git 历史 + PROGRESS.md 等效 | 多人协作 / 需要跨周追溯旧 handover |
| 4 | Memory 压缩 | 依赖 `dream` 插件，memory <30 条手动维护够用 | memory 膨胀到 50+ 条或装了 dream 插件 |
| 5 | XML 标签 + source-of-truth 排名 | markdown 标题足够人读，XML 过度工程 | 需要机器解析 handover / 自动化恢复 |
| 6 | 跨 agent/跨机器 transport | solo 单机，零需求 | 换机器工作 / 多人多 agent 协作 |

---

## 已落地（现有资产）

| 资产 | 对应顶级做法 | 说明 |
|------|------------|------|
| `docs/wrapup-logs/` | CoachSteff handover/ 存档 | 每次会话详细执行记录 |
| `.claude/skills/wrapup/references/template.md` | 模板规范 | wrapup-log 格式模板 |
| `CLAUDE.md` | CoachSteff init.sh | 新会话自动注入上下文 |
| `.claude/rules/pitfalls.md` | Memory 文件 | 踩坑登记 |
| `C:\Users\gaven\.claude\projects\...\memory\` | session-end memory | 项目级持久记忆 |

---

## 工作流

```
开新会话（Claude 自动加载 CLAUDE.md + memory）
    │
    ▼
/pickup     ← 手动触发。读 HANDOVER.md → git status 对比 → 报告漂移 → 恢复 next_steps
    │
    ▼
干活
    │
    ▼
/wrapup     ← 手动触发。
              Step 1-5: 代码盘点 → 文档同步 → bug 登记 → 清理 → Git
              Step 6:   强制复盘（6.2/6.3 表格必填）
              Step 7:   覆写 HANDOVER.md + 追加 PROGRESS.md + 写 docs/wrapup-logs/
```

### 安装位置

```
~/.claude/skills/
├── pickup/SKILL.md         ← /pickup 会话恢复
└── wrapup/
    ├── SKILL.md             ← /wrapup 会话收尾 (v4.0)
    └── references/
        ├── template.md          ← wrapup-log 模板
        └── handover-template.md ← HANDOVER.md 模板
```

项目级只有数据文件：`HANDOVER.md`、`PROGRESS.md`、`docs/wrapup-logs/`。

---

## 更新记录

| 日期 | 变更 |
|------|------|
| 2026-07-18 | 搬至用户级：`/wrapup` + `/pickup` 从项目 `.claude/skills/` → `~/.claude/skills/`，所有项目复用 |
| 2026-07-18 | 初始版本：调研 + 决定做5项、不做6项 |
