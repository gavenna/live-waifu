/**
 * war-danmaku 游戏服务器
 *
 *   :8765  HTTP+WS  (游戏前端 + WebSocket通信)
 *   :3000  HTTP     (纯游戏画面, OBS 用)
 *   :8760  HTTP     (工具箱管理面板, 自动打开浏览器)
 *
 * 弹幕数据由 danmaku-relay 工具提供 (ws://localhost:8766)。
 * 弹幕控制由工具箱跨进程调用 danmaku-relay :8767 API。
 *
 * 用法: node server/index.js  或  war-danmaku.exe (双击)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { startWSServer } = require('./wsServer');
const { GameEngine } = require('./gameEngine');
const { Announcer } = require('./announcer');
const DB = require('./db');
const config = require('./config');
const logger = require('./logger');

// ====== 路径 ======
const baseDir = __dirname.endsWith('server') ? path.resolve(__dirname, '..') : __dirname;
const dataDir = path.resolve(baseDir, 'data');
const secretsPath = path.join(baseDir, 'server', 'secrets.json');
const frontendDir = path.join(baseDir, 'frontend');
const toolboxDir = path.join(baseDir, 'toolbox');
const assetsDir = path.join(baseDir, 'assets');

// ====== 日志环形缓冲 (工具箱 /api/logs 轮询用) ======
const LOG_RING = [];
const LOG_RING_MAX = 500;
let logSeq = 0;

// 将 logger 输出转发到面板环缓冲 (供工具箱事件日志展示)
logger.onLog = (level, msg) => {
  const d = new Date();
  const ts = d.toISOString().replace('T', ' ').substring(0, 19);
  LOG_RING.push({ seq: ++logSeq, ts, level, msg });
  if (LOG_RING.length > LOG_RING_MAX) LOG_RING.shift();
};


// ====== MIME ======
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
};

function serveStatic(req, res, rootDir) {
  const url = new URL(req.url, 'http://localhost');
  let fp = path.join(rootDir, url.pathname === '/' ? '/index.html' : url.pathname);
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('Not Found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(fp).pipe(res);
}

// ====== 工具箱 HTTP 服务器 (:8760) ======
function startToolboxServer(port) {
  const toolboxServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
        handleToolboxAPI(req, res, body, url);
      });
    } else {
      serveStatic(req, res, toolboxDir);
    }
  });

  toolboxServer.listen(port, () => {
    logger.info( `Toolbox: http://localhost:${port}`);
  });

  toolboxServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') logger.error( `Toolbox port ${port} 已被占用`);
    else throw err;
  });
}

function sendJSON(res, data, code) {
  res.writeHead(code || 200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function handleToolboxAPI(req, res, body, url) {
  try {
    switch (url.pathname) {

      case '/api/status': {
        sendJSON(res, {
          game: gameRunning,
          relayConnected: relayClient ? relayClient.isConnected() : false,
          frontend: true,
          gamePid: process.pid,
          toolboxPort: 8760,
        });
        break;
      }

      case '/api/start-game': {
        if (gameRunning) { sendJSON(res, { ok: true, msg: '已在运行中' }); break; }
        if (engine) {
          engine.start();
          gameRunning = true;
          logger.info('游戏引擎已启动');
        }
        sendJSON(res, { ok: !!engine });
        break;
      }

      case '/api/stop-game': {
        if (!gameRunning) { sendJSON(res, { ok: true, msg: '未在运行' }); break; }
        if (engine) { engine.reset(); gameRunning = false; }
        sendJSON(res, { ok: true });
        break;
      }


      case '/api/stop':
        logger.info('STOP game');
        if (gameRunning && engine) { engine.reset(); gameRunning = false; }
        sendJSON(res, { ok: true });
        break;

      case '/api/config': {
        if (!fs.existsSync(secretsPath)) {
          const ex = path.join(baseDir, 'server', 'secrets.json.example');
          if (fs.existsSync(ex)) { fs.copyFileSync(ex, secretsPath); logger.info( 'Created secrets.json from example'); }
          else { sendJSON(res, { error: 'secrets.json 不存在' }, 404); break; }
        }
        sendJSON(res, JSON.parse(fs.readFileSync(secretsPath, 'utf-8')));
        break;
      }

      case '/api/announcer/status': {
        const a = announcer;
        sendJSON(res, {
          enabled: a ? a.enabled : false,
          dryRun: a ? a.dryRun : false,
          traceLevel: a ? a.traceLevel : 0,
          connected: a ? a.ws.connected : false,
          queueLength: a ? a.scheduler.queueLength : 0,
          stats: a ? a.stats : {},
        });
        break;
      }

      case '/api/announcer/config':
        if (req.method === 'POST') {
          if (announcer) {
            if (body.dryRun !== undefined) announcer.dryRun = body.dryRun;
            if (body.traceLevel !== undefined) announcer.traceLevel = body.traceLevel;
            if (body.reportInterval !== undefined) announcer._lastReportTime = 0; // 重置以立即生效
            if (body.castleDmgThreshold !== undefined) announcer._castleDmgThreshold = body.castleDmgThreshold;
            if (body.enabled !== undefined) announcer.enabled = body.enabled;
            // 同步更新 config 中的调度器参数
            if (body.giftCooldown !== undefined) announcer.scheduler.cfg.giftCooldown = body.giftCooldown;
            if (body.killCooldown !== undefined) announcer.scheduler.cfg.killCooldown = body.killCooldown;
            if (body.siegeCooldown !== undefined) announcer.scheduler.cfg.siegeCooldown = body.siegeCooldown;
            if (body.reportInterval !== undefined) announcer.scheduler.cfg.reportInterval = body.reportInterval;
            logger.info('[ANNOUNCER] 配置已更新 (面板)');
          }
          sendJSON(res, { ok: true });
        } else {
          sendJSON(res, {
            enabled: announcer ? announcer.enabled : false,
            dryRun: announcer ? announcer.dryRun : false,
            traceLevel: announcer ? announcer.traceLevel : 0,
            autoReset: true,
            castleDmgThreshold: announcer ? announcer._castleDmgThreshold : 100,
            giftCooldown: announcer ? announcer.scheduler.cfg.giftCooldown : 2000,
            killCooldown: announcer ? announcer.scheduler.cfg.killCooldown : 4000,
            siegeCooldown: announcer ? announcer.scheduler.cfg.siegeCooldown : 5000,
            reportInterval: announcer ? announcer.scheduler.cfg.reportInterval : 30000,
          });
        }
        break;

      case '/api/config/save':
        if (req.method !== 'POST') { sendJSON(res, {}, 405); break; }
        fs.writeFileSync(secretsPath, JSON.stringify(body, null, 2), 'utf-8');
        logger.info( 'Config saved');
        sendJSON(res, { ok: true });
        break;

      case '/api/logs': {
        const since = parseInt(url.searchParams.get('since')) || 0;
        const entries = LOG_RING.filter(e => e.seq > since);
        sendJSON(res, { entries, latestSeq: logSeq });
        break;
      }

      case '/api/open-folder':
        execSync(`explorer "${url.searchParams.get('path') || path.join(baseDir, 'server', 'logs')}"`, { stdio: 'ignore' });
        sendJSON(res, { ok: true });
        break;

      default:
        sendJSON(res, { error: 'Unknown API' }, 404);
    }
  } catch (err) {
    logger.error( `API crash: ${err.message}`);
    sendJSON(res, { error: err.message }, 500);
  }
}

// ====== 前端服务器 (:3000, OBS 用) ======
function startFrontendServer(port) {
  const frontendServer = http.createServer((req, res) => serveStatic(req, res, frontendDir));
  frontendServer.listen(port, () => {
    logger.info( `Frontend: http://localhost:${port} (OBS 浏览器源)`);
  });
  frontendServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') logger.error( `Frontend port ${port} 已被占用`);
    else throw err;
  });
}

// ====== 游戏引擎状态（模块级，供 API 控制）======
let engine = null;
let announcer = null;
let relayClient = null;
let gameRunning = false;
let _db = null;

// ====== 主入口 ======
async function main() {
  logger.info( '===== START ' + new Date().toISOString().replace('T', ' ').substring(0, 19) + ' =====');
  logger.info( 'war-danmaku starting...');
  logger.info( `Node: ${process.version} | Config: port=8765 roundTime=${config.ROUND_TIME / 1000}s`);

  // 目录
  if (!fs.existsSync(dataDir)) { fs.mkdirSync(dataDir, { recursive: true }); logger.info( `Created ${dataDir}`); }

  // 数据库
  const dbPath = path.resolve(baseDir, config.DB_PATH);
  _db = new DB(dbPath);
  await _db.init();
  logger.info(`DB: ${dbPath}`);

  // 游戏 WS + HTTP (:8765)
  startWSServer(config.WS_PORT);
  logger.info( `Port :8765 OK (game WS+HTTP)`);

  // 前端服务器 (:3000, OBS)
  startFrontendServer(3000);
  logger.info(`Port :3000 OK (OBS frontend)`);

  // 工具箱服务器 (:8760)
  startToolboxServer(8760);
  logger.info(`Port :8760 OK (toolbox)`);

  // 游戏引擎 — 等待用户点击"启动游戏"后创建并启动
  engine = new GameEngine(config, _db);

  // 虚拟主播话术引擎 — 监听游戏事件 → TTS → waifu-agent
  if (config.ANNOUNCER && config.ANNOUNCER.ENABLED) {
    try {
      // 读 LLM API Key
      if (fs.existsSync(secretsPath)) {
        const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf-8'));
        if (secrets.announcer?.llmApiKey) config._llmApiKey = secrets.announcer.llmApiKey;
      }
      announcer = new Announcer(config);
      engine.onEvent((events, summary) => announcer.handleEvents(events, summary));
      logger.info('虚拟主播话术引擎已就绪');
    } catch (e) {
      logger.warn(`虚拟主播引擎启动失败: ${e.message} — 游戏正常运行但不播报`);
    }
  }

  // 弹幕中继客户端 — 连接 danmaku-relay :8766 消费弹幕数据
  relayClient = require('./relayClient');
  relayClient.connect(config.DANMAKU_RELAY_WS);
  relayClient.onDanmaku((msg) => { if (engine) engine.handleMessage(msg); });
  logger.info(`Relay client → ${config.DANMAKU_RELAY_WS}`);

  // 弹幕由独立工具管理 — 用户通过 danmaku-relay :8767 控制各适配器
  // 或使用统一启动脚本 start.ps1 一键启动所有进程

  logger.info( 'READY. Toolbox → http://localhost:8760');
  logger.info( '弹幕控制请使用 danmaku-relay :8767');
  logger.info( `Logs → ${path.join(baseDir, 'server', 'logs', 'combined.log')}`);

  // 自动打开浏览器
  try {
    execSync('start "" "http://localhost:8760"', { stdio: 'ignore' });
  } catch (e) { /* ok */ }

  // 优雅退出
  process.on('SIGINT', () => {
    logger.info( 'Shutting down...');
    relayClient.disconnect();
    if (announcer) announcer.shutdown();
    if (engine) engine.stop();
    if (_db) _db.close();
    logger.info( '===== STOP =====');
    process.exit(0);
  });
}

main().catch(err => {
  logger.error( `FATAL: ${err.message}`);
  logger.error( err.stack || '');
  process.exit(1);
});
