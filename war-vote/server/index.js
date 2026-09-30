// war-vote 服务入口 —— 前端画面 + 控制面板 API + WS 广播 + 弹幕接入
//
//   :3001  前端画面（OBS 浏览器源），并把 /rw/* 映射到游戏的 mods/maps/
//   :8768  控制面板 / API / WS 广播

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const config = require('./config');
const logger = require('./logger');
const relayClient = require('./relayClient');
const mapGen = require('./mapGen');
const { VoteEngine } = require('./voteEngine');
const spawner = require('./liveSpawner');
const { generateArenaMap } = require('./arenaMap');

const ROOT = path.join(__dirname, '..');
const engine = new VoteEngine();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
};

function sendFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 ' + path.basename(file));
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

// 把 URL 解析到 root 之内，越界返回 null
function resolveIn(root, urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p === '/') p = '/index.html';
  const normRoot = path.resolve(root);
  const full = path.resolve(normRoot, '.' + p);
  if (full !== normRoot && !full.startsWith(normRoot + path.sep)) return null;
  return full;
}

// ===== 前端画面 :3001 =====
// /rw/* 直接映射到游戏 mods/maps/，前端就能用游戏原生素材画阵型
const frontendServer = http.createServer((req, res) => {
  if (req.url.startsWith('/rw/')) {
    const file = resolveIn(mapGen.rwMapsDir(), '/' + req.url.slice(4));
    if (!file) { res.writeHead(403); return res.end('forbidden'); }
    return sendFile(res, file);
  }
  const file = resolveIn(path.join(ROOT, 'frontend'), req.url);
  if (!file) { res.writeHead(403); return res.end('forbidden'); }
  sendFile(res, file);
});

// ===== 模拟投票（无需真弹幕中继）=====
const DEMO_NAMES = ['路人甲', '路人乙', '小明', '阿强', '奶茶', '猫猫', '汪汪', '大熊',
  '阿飞', '老张', '小雅', '阿杰', '面条', '火锅', '西瓜', '土豆', '芝麻', '花卷'];

function runFakeVotes(n) {
  const seq = Date.now();
  let red = 0;
  let blue = 0;
  for (let i = 0; i < n; i++) {
    const isRed = i % 2 === 0;
    const slot = isRed ? ++red : ++blue;
    setTimeout(() => {
      engine.handleMessage({
        type: 'danmaku',
        playerId: `demo_${seq}_${i}`,
        playerName: DEMO_NAMES[i % DEMO_NAMES.length] + (i >= DEMO_NAMES.length ? i : ''),
        text: (isRed ? '红' : '蓝') + slot,
      });
    }, i * 70);
  }
  return n;
}

// ===== 主服务 :8768（API + 控制面板 + WS）=====
function handleApi(req, res) {
  const url = req.url.split('?')[0];
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const ok = (extra) => { res.writeHead(200); res.end(JSON.stringify(Object.assign({ ok: true }, extra))); };
  const bad = (msg) => { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: msg })); };

  if (url === '/api/state') return ok({ snapshot: engine.snapshot() });
  if (url.startsWith('/api/fake')) {
    const q = new URL(req.url, 'http://localhost').searchParams;
    const n = Math.min(200, Math.max(1, parseInt(q.get('n') || '20', 10)));
    runFakeVotes(n);
    return ok({ count: n });
  }
  if (url === '/api/demo') {
    engine.start();
    runFakeVotes(30);
    return ok({ count: 30 });
  }
  if (url === '/api/start') { return engine.start() ? ok() : bad('当前状态不能开始'); }
  if (url === '/api/lock') { return engine.lock() ? ok() : bad('当前状态不能锁定'); }
  if (url === '/api/reset') { engine.reset(); return ok(); }
  return bad('未知接口 ' + url);
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return handleApi(req, res);
  const file = resolveIn(path.join(ROOT, 'toolbox'), req.url);
  if (!file) { res.writeHead(403); return res.end('forbidden'); }
  sendFile(res, file);
});

const wss = new WebSocket.Server({ server });

function broadcast() {
  const data = JSON.stringify(engine.snapshot());
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify(engine.snapshot()));
});

engine.on('state', broadcast);
engine.on('change', broadcast);
// VOTING 状态每秒广播一次倒计时
setInterval(() => { if (engine.state === 'VOTING') broadcast(); }, 1000);
engine.on('failed', (e) => logger.error('引擎错误：' + e.message));

// 地图生成后自动启动游戏（通过 Debug Socket 远程控制）
engine.on('state', () => {
  if (engine.state !== 'READY') return;
  const srcMap = path.join(config.RW_DIR, 'mods', 'maps', 'live_battle.tmx');
  const dstDir = path.join(config.RW_DIR, 'assets', 'assets', 'maps', 'skirmish');
  if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
  if (fs.existsSync(srcMap)) {
    fs.copyFileSync(srcMap, path.join(dstDir, 'live_battle.tmx'));
    logger.info('[AUTO-LAUNCH] 地图已复制到 assets 目录');
  }
  const pyScript = path.join(__dirname, 'autoStartGame.py');
  logger.info('[AUTO-LAUNCH] 通过 Debug Socket 启动游戏...');
  const py = require('child_process').execFile('python', [pyScript], { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) logger.error('[AUTO-LAUNCH] ' + err.message);
    if (stdout) logger.info('[AUTO-LAUNCH] ' + stdout.trim());
    if (stderr) logger.warn('[AUTO-LAUNCH] ' + stderr.trim());
  });
});

// 广播生成事件到前端
function broadcastSpawn (result, msg) {
  const payload = JSON.stringify({
    type: 'spawn',
    team: result.team,
    teamName: result.teamName,
    unitType: result.unitType,
    position: result.position,
    user: msg.nickname || msg.userId || '观众'
  });
  clients.forEach(ws => { try { ws.send(payload) } catch (e) {} });
}

// 生成竞技场地图 + 启动游戏 + 连接 Debug Socket
generateArenaMap();
spawner.connect();
logger.info('[SPAWNER] 实时生兵系统已启动');

frontendServer.listen(config.FRONTEND_PORT, () => {
  logger.info(`前端画面 http://localhost:${config.FRONTEND_PORT} （OBS 浏览器源）`);
});

server.listen(config.WS_PORT, () => {
  logger.info(`控制面板 http://localhost:${config.WS_PORT}`);
});

if (config.USE_RELAY) {
  relayClient.onDanmaku((msg) => {
    // 投票模式处理
    engine.handleMessage(msg);
    // 实时生兵模式处理
    const result = spawner.handleDanmaku(msg);
    if (result && result.success) {
      broadcastSpawn(result, msg);
    }
  });
  relayClient.connect(config.DANMAKU_RELAY_WS);
  logger.info(`正在连接弹幕中继 ${config.DANMAKU_RELAY_WS}`);
} else {
  logger.info('已禁用弹幕中继（config.USE_RELAY=false），可用控制面板的「一键演示」');
}

process.on('SIGINT', () => {
  logger.info('收到 SIGINT，退出');
  relayClient.disconnect();
  process.exit(0);
});
