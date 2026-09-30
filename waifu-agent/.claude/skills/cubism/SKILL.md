# /cubism — Live2D & Cubism 4

Live2D 模型渲染、动画参数、表情动作相关。你说"角色不显示"/"动画"/"表情"时触发。

## 核心文件

- `src/App.tsx` — PIXI + Live2D 初始化、动画循环、表情控制
- `src/animation/startupTimeline.ts` — 启动动画时间线
- `src/constants/emotion.ts` — 情绪→表情映射
- `src/persona.config.ts` — 角色预设配置
- `.claude/rules/cubism.md` — Cubism 4 运行时架构（详细）

## 更新管线（12 步，顺序不能乱）

1. Motion Manager 更新
2. Physics 评估
3. Pose 更新（呼吸）
4. Expression 应用（表情）
5. Eye Blink 更新（眨眼）
6. Lip Sync 更新（口型）
7. Model Matrix 计算
8. Physics 写入参数
9. Parameter Update
10. Part Opacity
11. Draw

## 常见问题

| 症状 | 可能原因 |
|------|---------|
| 角色不显示 | PIXI 未初始化 / generation counter 竞态 |
| 表情点不动 | 自动动画覆盖了参数 |
| 参数弹回 | 物理/呼吸每帧覆盖 |
| 口型不动 | lipsync 参数名不匹配 |

**核心原则：先读源码再动手，不要猜。**
