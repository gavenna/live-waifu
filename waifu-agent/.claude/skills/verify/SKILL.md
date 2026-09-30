---
name: verify
description: >
  产品验证 — 行为级回归检测。检查设置完整性、贴图逻辑、日志错误、对话质量、UI 命令。
  用法: /verify 或说"验证一下"/"检查改动"
---

# /verify — 产品验证

> "功能正常吗？" — 确定性的，pass/fail。
> 与 `/review` 互补：verify 验正确性，review 验体验。

## 快速开始

```bash
# 跑全部检查
bash .claude/skills/verify/scripts/verify-all.sh

# 只跑离线检查（不需要 app 运行）
bash .claude/skills/verify/scripts/verify-all.sh --offline
```

报告输出到 `.claude/skills/verify/results/latest-report.md`。

## 检查维度

| # | 检查 | 优先级 | 需要 app | 耗时 |
|---|------|:--:|:--:|:--:|
| 1 | Settings Integrity | P0 | ❌ | <1s |
| 2 | Sticker Selection Logic | P0 | ❌ | <3s |
| 3 | Log Error Detection | P0 | ❌ | <2s |
| 4 | Chat Content Quality | P1 | ❌ | <5s |
| 5 | UI Command Round-Trip | P1 | ✅ | <10s |

**P0** = 必须通过，失败即功能坏了。**P1** = 应该通过，失败是疑似回归。

## 与 /review 的分工

| | /verify | /review |
|---|---|---|
| 问题 | "功能正常吗？" | "体验好吗？" |
| 性质 | 确定性的，脚本判断 | 主观的，人眼判断 |
| 运行 | 脚本自动执行 | Claude 读文件 + 评估 |
| 时机 | 改完代码就跑 | 准备发布前跑 |

## 脚本说明

所有脚本在 `scripts/` 下，由 `verify-all.sh` 统一编排。

- `check-settings.sh` — 读 settings.json，验证结构 + 默认值覆盖
- `check-stickers.sh` — 跑 selectSticker() 的 9 个纯函数测试用例
- `check-logs.sh` — 扫描日志找 ERROR + 验证启动流健康
- `check-content-quality.sh` — 分析对话日志的响应质量指标
- `check-ui-commands.sh` — 调 Tauri 命令验证往返（需 app 运行）
- `report.sh` — 合并结果生成 markdown 报告

## 退出码

- 0 = 全部通过
- 1 = 有 P1/P2 失败或警告
- 2 = 有 P0 失败（需修复）
