# HANDOVER.md

> 每次 `/wrapup` 覆写。新会话先读这个 ↔ 再对比 `git status`。
> 最后更新：2026-09-13

## current_state

### verified

- 可运行：`node server/index.js` 双端口全启（:8768 面板 / :3001 画面）
- 三层测试全绿：`test-mapgen.js` / `test-voteEngine.js` / `test-e2e.js`
- 生成的 `live_battle.tmx` 能被 `RW/mods/maps/_render_preview.py` 逐格还原（单位数完全一致）
- 前端素材路由 `/rw/*` 通（游戏原生 `units.png` 直接喂给浏览器）
- 地图尺寸 40×40、每方 50 槽位、每格 21px、编号字号 14px + 黑描边

### assumed

- ⚠️ **游戏内加载 `live_battle.tmx` 未实测**——生成流程通了，但"生成后能否不重启就在地图列表看到"没验
- 浏览器实际分辨率下的观感未确认（只用 `tools/mock-frontend.py` 1:1 渲染过地图区）
- 高并发（几百人同时抢位）未压测，只模拟过 30 票

## 架构速查

```
danmaku-relay :8766  ──弹幕──→  war-vote
                                   ├─ voteEngine  抢位状态机
                                   ├─ mapGen      槽位 → tmx（纯函数）
                                   ├─ frontend    :3001 OBS 画面
                                   ├─ toolbox     :8768 控制面板
                                   └─ 生成 → RW/mods/maps/live_battle.tmx
```

**数据模型**：`occupants[side] = Map<槽位号, {playerId, name}>`。槽位坐标与预设兵种由 `mapGen.formationSlots()` 决定，观众只选号。

**契约**：前端渲染与 tmx 生成**共用同一个 grid 对象**，保证「前端看到的」与「游戏里出现的」逐格一致。一切都以**单位名 + 队伍**为准，绝不依赖 tile id（不同地图调色板不同）。

## 关键文件

| 文件 | 说明 |
|---|---|
| `server/config.js` | 端口、`RW_DIR`（换机器必改）、`FORMATION` 阵型参数、`JOIN_COMMANDS`、`MAX_VOTES_PER_PLAYER` |
| `server/mapGen.js` | `formationSlots()` 槽位生成、`buildBattle()` 排布、`buildTmx()` 编码。**注意 layers 里 `depth` 是离顶点的层数** |
| `server/voteEngine.js` | `parse()` 指令解析、`takeSlot()` 抢位、`snapshot()` 快照 |
| `frontend/renderer.js` | `UI_POS` 集中所有坐标，**渲染函数不硬编码**；编号必须 `strokeText` 描边 |
| `tools/mock-frontend.py` | 改完前端跑一次，看 PNG 就知道效果，不用开浏览器 |

## failed_approaches

- **地图 60×60**：每格 16px，槽位编号必然看不清。**改成 40×40**（21px/格）。放大显示区没用——显示区受屏幕高度限制，还会顶到滚动条。
- **靠空位底色提升编号可读性**：底色调深则画面花，调淡则编号糊。**正解是给编号加黑色描边**（`strokeText`），底色只需极淡。
- **测试断言把溢出位算进槽位表**：有人报超出槽位总数的号时，`slots[side].length` 会比 `slotCount()` 多。断言要 `filter(s => !s.overflow)`。
- **一人一票 + 一人只能占一位**：`takeSlot` 里 `p.slot` 已存在就拒绝。换阵营会释放原槽位（`setTeam` 里处理），否则一个观众能占两边。

## next_steps

1. **游戏内实测 `live_battle.tmx`** —— 跑完整循环确认地图可见性（唯一未消的风险）
2. **前端阵营配色**：游戏素材 team0 是绿色、team1 是红色，与面板「红方/蓝方」认知相反。建议在兵下方加一条阵营色条
3. **阵型可继续调**：现在是细长锋矢阵。想换雁行/方圆/三线，改 `FORMATION` 即可；想可视化编辑阵型需要另做工具
4. **压测**：几百人同时抢位时的去重与广播表现

## drift_warning

⚠️ 如果本文件超过 24 小时未更新，先 `git status` / `git diff` 再信它。
> 本项目**尚未初始化 git 仓库**（其余三个兄弟组件都有）。
