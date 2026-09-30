# war-danmaku

> 弹幕互动阵营对抗游戏 · 抖音平台 · Node.js + Canvas

## 我的工作流（给人看的）

```
开新会话 → /pickup → 干活 → /wrapup
```

| 命令 | 用途 |
|------|------|
| `/pickup` | 恢复上次状态（读 HANDOVER + git 对比） |
| `/wrapup` | 收尾复盘（覆写 HANDOVER + 追加 PROGRESS + 日志） |
| `/artist` `/game` `/review` `/verify` | 美术 / 数值 / 审查 / 验证 |

**资产在哪:** `./CLAUDE.md`（AI规则） `./HANDOVER.md`（状态） `./PROGRESS.md`（时间线） `.claude/rules/pitfalls.md`（踩坑） `docs/wrapup-logs/`（记录） `docs/技术文档/`（资料）

---

## 项目概览

> 观众发弹幕选阵营、刷礼物出兵，双方对战推城堡。

---

## 怎么跑

```powershell
# 开发时一键启动
.\start.ps1

# 或直接用 Node
node server/index.js
```

浏览器打开：
- `http://localhost:3000` — OBS 游戏画面
- `http://localhost:8760` — 控制面板

控制面板三按钮：▶ 启动游戏 / 📡 启动抖音 / 📺 启动B站

分发版见 `docs/构建指南.md`。

---

## 当前阶段

**Phase 5+8 已完成** — 程序化动画、精灵图渲染、战斗深度、音效系统、抖音弹幕已全部跑通。

- 状态机：WAITING → COUNTDOWN → PLAYING → ROUND_END 自动循环
- 战斗：三线战场（北境/王道/河谷）、克制链、城堡攻防
- 弹幕：抖音 douyinLive + B站 bilibili.js 双平台
- 可视化：程序化动画（idle/walk/attack/death）、精灵图渲染、多档分辨率

---

## 关键文件

| 想看什么 | 读这个 |
|----------|--------|
| 游戏设计（兵种/付费/话术） | `docs/项目规划/游戏设计.md` |
| 话术引擎完整参考 | `docs/话术引擎参考.md` |
| 服务器入口 | `server/index.js` |
| 游戏状态机 + 指令处理 | `server/gameEngine.js` |
| 战斗计算 | `server/battle.js` |
| WS 通信 | `server/wsServer.js` |
| 兵种属性 + 数值 | `server/config.js` |
| 积分/段位/排行榜 | `server/ranking.js` |
| 日志系统 | `server/logger.js` |
| Canvas 渲染（前端） | `frontend/renderer.js` |
| 精灵绘制 + 程序化动画 | `frontend/sprites.js` |
| 音效引擎 | `frontend/audio.js` |
| 控制面板前端 | `toolbox/app.js` |
| 抖音适配器 | `server/danmaku/douyin.js` |
| B站适配器 | `server/danmaku/bilibili.js` |

---

## 常用命令

```bash
node --check server/*.js                # JS 语法检查
npm run test:anim                       # 一键动画测试
node build.js                           # 构建 dist exe
```

---

## 架构概览

```
B站弹幕 → bilibili.js → :8766 (Relay WS)
抖音弹幕 → douyinLive.exe :1088 → douyin.js → :8766
                                                    ↓
                                              Game Engine
                                                    ↓
                                           WebSocket :8765 → 前端 Canvas
                                           HTTP :8760 → 控制面板
                                           HTTP :3000 → OBS 画面
                                                    ↓
                                           积分/排行（SQLite 持久化）
```
