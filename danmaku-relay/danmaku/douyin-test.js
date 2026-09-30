/**
 * 抖音适配器测试工具 — 模拟 douyinLive 代理输出
 *
 * 启动 WS Server 在 :12011，douyin.js 连接后手动发送测试事件。
 * 消息格式对齐 douyinLive 协议 (WebcastXxxMessage)，见 douyin.js 的 douyinLiveToLegacy。
 *
 * 用法: node danmaku/douyin-test.js
 * 前提: douyin.js 已在运行 (secrets.json → douyin.enabled = true, proxyUrl → ws://localhost:12011)
 * 自动化: 由 test.js 一键测试调用
 */

const WebSocket = require('ws');
const readline = require('readline');

const PORT = 12011;
let clients = [];

function startServer() {
  const wss = new WebSocket.Server({ port: PORT });

  wss.on('listening', () => {
    console.log(`[test] 模拟 douyinLive → ws://localhost:${PORT}`);
    console.log('[test] 输入 help 查看测试指令');
    process.stdout.write('> ');
  });

  wss.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('[test] 端口 12011 已被占用（douyinLive 正在运行？先关掉它再测）');
      process.exit(1);
    }
    throw err;
  });

  wss.on('connection', (ws) => {
    console.log('[test] douyin.js 已连接');
    clients.push(ws);
    ws.on('close', () => {
      clients = clients.filter(c => c !== ws);
      console.log('[test] douyin.js 断开');
    });
  });
}

function broadcast(msg) {
  if (clients.length === 0) {
    console.log('[test] ⚠ douyin.js 未连接，请先启动 douyin.js');
    return;
  }
  const json = JSON.stringify(msg);
  for (const ws of clients) ws.send(json);
  console.log(`[test] → ${JSON.stringify(msg).slice(0, 100)}`);
}

// 随机 uid 模拟不同用户
let counter = 0;
function uid() { return `test_${++counter}_${Date.now()}`; }
function user(name) { return { id: uid(), nickname: name }; }

// douyinLive 协议消息 → 见 douyin.js douyinLiveToLegacy
function msg(method, extra) {
  return { type: 'message', method, user: user(''), ...extra };
}

function handle(input) {
  const line = input.trim();
  if (!line) { process.stdout.write('> '); return; }

  const parts = line.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case 'help':
    case 'h':
      console.log(`
  测试指令 (douyinLive 协议格式):
    dm <文本>          发送弹幕 (WebcastChatMessage)
    gift <名称> [单价]  发送礼物 (WebcastGiftMessage, 单价=钻石数，默认1)
    like [次数]         发送点赞 (WebcastLikeMessage, 默认1)
    enter               发送进房 (WebcastMemberMessage)
    follow              发送关注 (WebcastSocialMessage)
    share               发送分享 (WebcastShareMessage)

  快速测试:
    dm 杀          → 弹幕
    dm 1           → 弹幕(游戏侧入红方)
    gift 小心心 1   → swordsman (1钻)
    gift 城堡 520  → giant (520钻)
    gift 嘉年华 3000 → wrathOfGod (3000钻)
    like 100        → 百赞连击
`);
      break;

    case 'dm':
    case 'd': {
      if (!parts[1]) { console.log('用法: dm <文本>'); break; }
      const text = parts.slice(1).join(' ');
      broadcast(msg('WebcastChatMessage', { content: text }));
      break;
    }

    case 'gift':
    case 'g': {
      if (!parts[1]) { console.log('用法: gift <名称> [单价]'); break; }
      const giftName = parts[1];
      const price = parseInt(parts[2]) || 1;
      broadcast(msg('WebcastGiftMessage', {
        gift: { id: String(price), name: giftName, diamondCount: price, count: 1 },
      }));
      break;
    }

    case 'like':
    case 'l': {
      const count = parseInt(parts[1]) || 1;
      broadcast(msg('WebcastLikeMessage', { count }));
      break;
    }

    case 'enter':
    case 'e':
      broadcast(msg('WebcastMemberMessage', { memberCount: 100 + counter }));
      break;

    case 'follow':
    case 'f':
      broadcast(msg('WebcastSocialMessage'));
      break;

    case 'share':
    case 's':
      broadcast(msg('WebcastShareMessage'));
      break;

    case 'exit':
    case 'quit':
    case 'q':
      console.log('退出');
      process.exit(0);

    default:
      // 默认当弹幕
      broadcast(msg('WebcastChatMessage', { content: line }));
  }

  process.stdout.write('> ');
}

// ====== 启动 ======
console.log('=== 抖音适配器测试工具 (douyinLive 协议) ===');
console.log('先启动 douyin.js，再运行本测试工具');
console.log('');

startServer();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.setPrompt('');
rl.prompt();
rl.on('line', handle);
rl.on('close', () => process.exit(0));
