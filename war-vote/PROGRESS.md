# PROGRESS.md

## 2026-09-12 — 组件创建：弹幕抢位 → 生成 Rusted Warfare 地图

**背景**：直播互动链路已有三个组件（danmaku-relay / war-danmaku / waifu-agent）。本次新增第四个，让观众用弹幕投票决定开战阵容，生成真实游戏 Rusted Warfare 的地图。

**为什么走"生成地图"而不是"控制游戏"**：RW 没有任何外部输入通道（无控制台/API/脚本接口/文件热重载），所有触发器只能由游戏世界内部状态激活。因此拆两层——静态层（本组件，开战前生成地图，绕开游戏内操作）+ 动态层（后续，RPA 点固定 UI 按钮）。

**完成**：
- `server/config.js` 端口与全部可调参数（RW 路径、阵型、指令表）
- `server/mapGen.js` 阵型槽位生成 + tmx 编码（纯函数，前后端共用同一网格）
- `server/voteEngine.js` 抢位状态机（IDLE→VOTING→LOCKED→READY）
- `server/index.js` 服务入口 + 模拟投票 API（**不用真弹幕也能演示**）
- `frontend/` OBS 画面，切游戏原生 `units.png` 渲染
- `toolbox/` 控制面板
- `tools/mock-frontend.py` 不用打开浏览器就能看前端效果的 1:1 渲染器
- 从 war-danmaku 零改动复制 `logger.js` / `relayClient.js`

**玩法演进**：一票一个兵 → 观众报位置号抢槽位。槽位号直接标在地图上，兵种由槽位预设（1-3 号重坦、后面依次坦克/激光/火炮/炮塔），好位置稀缺、先到先得。阵型为锋矢阵，每方 50 位，红方设计 + 蓝方镜像，建筑固定。

**验证**：三层测试全绿；生成的 tmx 用独立渲染器反向验证逐格一致；`demo_swarm.tmx` 已在游戏内实机加载成功。

**未完成**：游戏内加载 `live_battle.tmx` 未实测；高并发未压测；阵营配色与游戏素材不一致。
