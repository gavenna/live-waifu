---
name: 更新一下docs-兵种与收益一览-md
description: 更新一下docs\兵种与收益一览.md — verified by 1 check
triggers: ['unit-table-new', '兵种与收益一览', 'null', '更新一下docs']
---

# 更新一下docs-兵种与收益一览-md

> 自动从会话 ab2d992f 蒸馏的草稿。审核后用 `/skill approve 更新一下docs-兵种与收益一览-md` 入库，或 `/skill reject 更新一下docs-兵种与收益一览-md` 丢弃。

## Steps
1. 阅读 / 搜索：D:\Projects\live-waifu\docs\兵种与收益一览.md、repo_map、glob
2. 操作：git
3. 验证：deliver_task

## Verified by
- cd /d/Projects/live-waifu/danmaku-relay
cp "../docs/兵种与收益一览.md" "../.rivet/scratch/unit-table-old.md"
node tools/gen_unit_table.js > "../docs/兵种与收益一览.md" 2> "../.rivet/scratch/gen_err2.txt"
echo "gen  (passed 0)

<!-- skill-draft-key: 64afe7b71f66 -->
<!-- source-session: ab2d992f -->
