# 弹幕前线 Godot MVP

这是一个独立于原 Canvas 前端的 Godot 4.7 客户端原型，重点验证“观众能否一眼看懂战况”。直播平台连接不包含在本工程中，外部接入层只需调用统一事件入口。

## 核心体验

- 红蓝双方在北境、王道、河谷三条兵线自动选敌、移动和攻击。
- 盾卫、弓手、骑兵和冠军拥有不同轮廓、射程、速度与伤害。
- 单位造成真实伤害，推进到敌方王城后直接攻城。
- 阵营能量充满后可释放带预警范围的流星火雨。
- 城堡血量低于 35% 时获得 15% 逆风强化，保留翻盘空间。
- 事件播报、冠军署名、阵营能量、倒计时和结算 MVP 均位于直播主画面。

## 运行

使用 Godot 4.7 或更高版本打开 `project.godot`，运行主场景即可。工程默认开启自动演示，不连接直播也会持续生成红蓝观众事件。

可以直接双击 `run.bat`，或者执行：

```powershell
godot --path D:\Projects\war-danmaku\godot
```

## 主播调试热键

| 按键 | 效果 |
| --- | --- |
| `Q` | 红方召唤小队 |
| `P` | 蓝方召唤小队 |
| `W` | 红方立即释放技能 |
| `O` | 蓝方立即释放技能 |
| `Space` | 暂停或恢复自动演示 |
| `R` | 重新开始本局 |

## 直播事件入口

接入层获得事件后，调用主节点的 `receive_event(event)`。统一格式示例：

```gdscript
receive_event({
    "type": "gift",
    "team": "red",
    "user": "观众A",
    "tier": 2,
    "lane": 1,
})
```

支持的事件类型：

| `type` | 必需字段 | 行为 |
| --- | --- | --- |
| `join` / `comment` / `spawn` | `team`, `user` | 召唤普通小队 |
| `gift` | `team`, `user`, `tier` | `tier >= 2` 时召唤冠军战团 |
| `like` | `team`, `count` | 为阵营技能充能 |
| `skill` | `team`, `user` | 立即释放阵营技能 |

`team` 为 `red` 或 `blue`；`lane` 为 `0..2`，缺省时随机选择兵线。

## 验证

```powershell
# 检查工程和脚本解析
godot --headless --editor --path . --quit

# 完整模拟对局：验证出兵、伤害、技能、城堡胜负和 MVP
godot --headless --path . --script res://scripts/test_battle.gd

# 验证统一直播事件入口
godot --headless --path . --script res://scripts/test_events.gd

# 运行约 10 秒，检查运行期错误
godot --headless --path . --quit-after 600

# 运行 7 秒并保存真实渲染截图
godot --path . -- --capture=D:\temp\mvp-preview.png
```