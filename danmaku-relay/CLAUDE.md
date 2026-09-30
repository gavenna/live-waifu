# CLAUDE.md — danmaku-relay

> B站/抖音弹幕中继工具。连接直播间 → 翻译弹幕/礼物 → 广播给订阅方。
> **独立项目，通过 :8766 WS 协议供 war-danmaku 游戏消费。**

## 命令

```bash
node index.js           # 启动中继 (:8766 WS + :8767 HTTP API)
node index.js --auto-start  # 启动后自动拉起全部适配器
start-all.bat           # 一键启动 (等价于 node index.js --auto-start)
node test.js            # 一键端到端测试 (模拟器链路,自动 PASS/FAIL)
npm run build           # 打包独立 exe → dist/danmaku-relay/
npm run check           # JS 语法检查
```

## 架构

```
B站弹幕服务器 (wss://)
    ↓ bilibili.js (Node.js, B站协议编解码)
    │
douyinLive.exe (WS Proxy :1088)
    ↓ douyin.js (Node.js, 格式翻译 + 礼物映射)
    │
    └──────── relay.js (WS Server :8766) ────→ 订阅方 (游戏...)
                  :8767 HTTP API (启停控制)
```

- **relay.js**: 进程内广播。适配器调用 `relay.broadcast(msg)`，所有已连接的 WS 订阅方收到
- **bilibili.js**: 连 B站 wss://，解 B站 二进制协议，翻译成统一消息格式
- **douyin.js**: 连 douyinLive.exe :1088，翻译 douyinLive 格式 → 统一消息，价格阶梯映射兵种
- **index.js**: 入口，启动 relay + 控制 API + douyinLive 进程管理 + 控制面板静态托管
- **toolbox/**: 控制面板网页 (从 war-danmaku 迁移适配)，:8767 托管，启停/状态/日志/设置

## 关键文件

| 文件 | 作用 |
|------|------|
| `config.js` | 端口、礼物映射、适配器配置 |
| `relay.js` | WS 广播服务，`broadcast()` + `subscriberCount()` |
| `danmaku/bilibili.js` | B站适配器，协议编解码 + relay.broadcast |
| `danmaku/douyin.js` | 抖音适配器，EventTranslator + relay.broadcast |
| `danmaku/douyin-test.js` | douyinLive 协议模拟器 (:12011)，供 test.js 调用 |
| `index.js` | 入口，启动 relay + 控制 API + douyinLive 管理 + 面板托管 |
| `toolbox/` | 控制面板网页 (启停/状态/日志/设置)，:8767 静态托管 |
| `test.js` | 一键端到端测试 (模拟器 → 适配器 → relay → WS 断言) |
| `build.js` | esbuild + SEA 打包 |

## 协议

消息契约见 `docs/协议.md`。三种类型: `danmaku` / `gift` / `join`。

## 订阅方接入

```js
const ws = new WebSocket('ws://localhost:8766');
ws.on('message', (data) => {
  const msg = JSON.parse(data);
  // msg.type: 'danmaku' | 'gift' | 'join'
});
```

## 环境

Windows 11 · Node.js v18+ · ws 库 · 无 UI
