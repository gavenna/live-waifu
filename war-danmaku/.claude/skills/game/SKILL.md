# /game — 游戏数值与机制调优

弹幕游戏专属 skill。覆盖：数值平衡、兵种配置、弹幕协议、游戏节奏。

## 触发

- "调数值" / "兵种平衡" / "XX太强了"
- "加个兵种" / "改伤害" / "调整时长"
- "弹幕协议" / "礼物映射" / "抖音接入"
- 任何涉及 `server/config.js` 或兵种属性的改动

## 工作流程

### 1. 读当前配置

```bash
# 确认当前数值
cat server/config.js | grep -A 20 "TROOPS"
```

### 2. 改数值 → 验证三步曲

```
Step A: 改 server/config.js 中的数值
Step B: node --check server/config.js（语法验证）
Step C: 重启 server，模拟弹幕测试
```

改数值的原则：
- 免费层（点赞/弹幕）不能削弱太多 → 否则零氪观众流失
- 核心层（10~100元）是营收主力，改动要谨慎
- 顶级层（100~500元）保持"碾压感"，差距要肉眼可见
- 动态平衡系数（人数平衡、劣势保护）改 5% 以内

### 3. 新兵种 → 全链路检查

新增兵种需要同步更新：
- `server/config.js` — 兵种属性定义
- `server/battle.js` — 克制关系
- `frontend/sprites.js` — 精灵绘制（几何图形或精灵图）
- `frontend/renderer.js` — 进场特效

用 `grep -rn "DRAGON\|dragon" server/ frontend/` 参考已有兵种的所有引用点。

### 4. 弹幕协议

B站协议：`blivedm` Python 库 → WebSocket 转发 → server Danmaku Adapter
抖音协议：第三方工具（可遇AI等）→ WebSocket 转发 → server Danmaku Adapter

新增弹幕指令时：
- 指令名要短（1-2 个字），中文优先
- 在 Danmaku Adapter 中注册映射
- 在前端弹幕滚动区显示"XXX 发动了 YYY"

### 5. 游戏节奏调优

改时长 → 改 `server/config.js` 中的 `ROUND_TIME` 相关参数
改单局节奏 → 考虑：
- 准备阶段时长（当前 30s）
- 碾压加速触发时间（当前 5 分钟）
- 决胜期（最后 2 分钟）的特殊逻辑
