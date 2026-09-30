/**
 * 命令行模拟器 — 开发期替代弹幕输入
 *
 * 用法: node server/simulator.js
 * 连接 ws://localhost:8765，手动输入指令测试游戏逻辑。
 *
 * 指令:
 *   join red|blue          — 加入阵营
 *   red/1 或 blue/2        — 快捷加入
 *   gift <兵种key>         — 模拟送礼出兵
 *   danmaku <弹幕文本>     — 模拟弹幕
 *   status                 — 查看当前状态
 *   help                   — 显示帮助
 */

const WebSocket = require('ws');
const path = require('path');

// 延迟加载 config + logger（避免 simulator 独立运行时依赖顺序问题）
let config, logger;

try {
  config = require('./config');
  const logModule = require('./logger');
  // simulator 不主动 init logger（由 server 入口统一 init），
  // 但如果独立运行则 init
  logModule.init(config.LOG);
  logger = logModule;
} catch (_) {
  // 如果 server 没启动，logger 可能未初始化，fallback 到 console
  logger = {
    info: (t, m) => console.log(`[${t}] ${m}`),
    debug: (t, m) => console.log(`[${t}] ${m}`),
    warn: (t, m) => console.warn(`[${t}] ${m}`),
    error: (t, m) => console.error(`[${t}] ${m}`),
  };
}

const WS_URL = 'ws://localhost:8765';
let ws;
let playerId = 'player_' + Math.random().toString(36).slice(2, 8);
let reconnectTimer = null;

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    logger.info(`[SIMULATOR] 已连接 (${playerId})`);
    process.stdout.write('> ');
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'game_state') {
        if (msg.state === 'PLAYING' || msg.state === 'ROUND_END') {
          const r = msg.red, b = msg.blue;
          process.stdout.write(`\r[${msg.state}] R${msg.round} | 红:${r.playerCount}人 ${r.castleHP}HP | 蓝:${b.playerCount}人 ${b.castleHP}HP | 战线:${msg.frontLine ?? 0} | 兵:${(msg.troops||[]).length}\n> `);
        }
      }
    } catch (_) { /* ignore */ }
  });

  ws.on('close', () => {
    logger.warn('[SIMULATOR] 断开，5秒后重连...');
    reconnectTimer = setTimeout(connect, 5000);
  });

  ws.on('error', (err) => {
    logger.error(`[SIMULATOR] 连接失败: ${err.message}`);
  });
}

function send(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    process.stdout.write('[未连接，请等待...]\n> ');
    return;
  }
  ws.send(JSON.stringify(msg));
}

function handle(input) {
  const line = input.trim();
  if (!line) { process.stdout.write('> '); return; }

  const parts = line.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case 'help':
    case 'h':
    case '?':
      process.stdout.write(`
  指令列表:
    join red|blue         加入阵营
    red / 1               快捷加入红方
    blue / 2              快捷加入蓝方
    gift <兵种key>        模拟送礼
    danmaku <弹幕文本>    模拟弹幕
    status                查看连接状态
    help                  显示帮助
    exit                  退出

  兵种key: militia swordsman knight archer catapult royalGuard giant dragonKnight wrathOfGod warChest
> `);
      return;

    case 'join':
      if (parts[1] === 'red' || parts[1] === 'r' || parts[1] === '1') {
        send({ type: 'join', team: 'red', playerId, playerName: playerId });
        logger.info('[SIMULATOR] → 加入红方');
      } else if (parts[1] === 'blue' || parts[1] === 'b' || parts[1] === '2') {
        send({ type: 'join', team: 'blue', playerId, playerName: playerId });
        logger.info('[SIMULATOR] → 加入蓝方');
      } else {
        process.stdout.write('用法: join red|blue\n> ');
        return;
      }
      break;

    case 'red': case 'r': case '1':
      send({ type: 'join', team: 'red', playerId, playerName: playerId });
      logger.info('[SIMULATOR] → 加入红方');
      break;

    case 'blue': case 'b': case '2':
      send({ type: 'join', team: 'blue', playerId, playerName: playerId });
      logger.info('[SIMULATOR] → 加入蓝方');
      break;

    case 'gift': case 'g':
      if (parts[1]) {
        send({ type: 'gift', giftId: parts[1], troopKey: parts[1], playerId, playerName: playerId });
        logger.info(`[SIMULATOR] → 送礼: ${parts[1]}`);
      } else {
        process.stdout.write('用法: gift <兵种key>\n  可用: militia swordsman knight archer catapult royalGuard giant dragonKnight wrathOfGod warChest\n> ');
        return;
      }
      break;

    case 'danmaku': case 'd':
      if (parts[1]) {
        const text = parts.slice(1).join(' ');
        send({ type: 'danmaku', text, playerId, playerName: playerId });
        logger.info(`[SIMULATOR] → 弹幕: "${text}"`);
      } else {
        process.stdout.write('用法: danmaku <文本>\n> ');
        return;
      }
      break;

    case 'status': case 's':
      process.stdout.write(`玩家: ${playerId}\n连接: ${ws && ws.readyState === WebSocket.OPEN ? '已连接' : '未连接'}\n> `);
      return;

    case 'exit': case 'quit': case 'q':
      process.stdout.write('退出\n');
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
      process.exit(0);

    default:
      send({ type: 'danmaku', text: line, playerId, playerName: playerId });
      logger.info(`[SIMULATOR] → 弹幕: "${line}"`);
  }

  process.stdout.write('> ');
}

// 启动
process.stdout.write('=== 战争弹幕模拟器 ===\n输入 help 查看指令\n');
connect();

const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.setPrompt('');
rl.prompt();

rl.on('line', (line) => {
  handle(line);
});

rl.on('close', () => {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) ws.close();
  process.exit(0);
});
