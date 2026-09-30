/**
 * WebSocket + HTTP 服务
 *
 * 职责: 维护前端连接池，推送游戏状态，接收前端事件 & 模拟器指令，
 *       同时提供静态文件服务（浏览器直接打开即可看到游戏画面）。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const logger = require('./logger');
const assert = require('./assert');

const baseDir = __dirname.endsWith('server') ? path.resolve(__dirname, '..') : __dirname;
const FRONTEND_DIR = path.resolve(baseDir, 'frontend');
const ASSETS_DIR = path.resolve(baseDir, 'assets');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.ogg':  'audio/ogg',
};

function serveStatic(req, res) {
  let urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  let filePath;

  // /assets/ → assets 目录
  if (urlPath.startsWith('/assets/')) {
    filePath = path.join(ASSETS_DIR, urlPath.slice(8));
  } else {
    filePath = path.join(FRONTEND_DIR, urlPath);
  }

  // 安全检查：防止目录遍历
  const allowedRoot = urlPath.startsWith('/assets/') ? ASSETS_DIR : FRONTEND_DIR;
  if (!filePath.startsWith(allowedRoot)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not Found');
      } else {
        res.writeHead(500);
        res.end('Server Error');
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

/** @type {Set<import('ws').WebSocket>} */
const clients = new Set();

/** @type {Map<string, import('ws').WebSocket>} 按 playerId 索引的连接 */
const playerConns = new Map();

/** 消息处理回调（由 GameEngine 注册） */
let messageHandler = null;

/**
 * 注册消息处理回调
 * @param {(msg: object, ws: import('ws').WebSocket) => void} handler
 */
function onMessage(handler) {
  messageHandler = handler;
}

/**
 * 启动 WebSocket + HTTP 服务
 * @param {number} port
 */
function startWSServer(port) {
  const server = http.createServer(serveStatic);
  const wss = new WebSocketServer({ server, perMessageDeflate: false });

  server.listen(port, () => {
    logger.info(`[WS] HTTP + WebSocket on http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`[WS] Port ${port} 已被占用 — 请先关闭旧进程: netstat -ano | grep ${port}`);
      process.exit(1);
    }
    throw err;
  });

  setupConnections(wss);
}

/** 为 WSS 注册连接处理 */
function setupConnections(wss) {

  wss.on('connection', (ws) => {
    logger.info(`[WS] Client connected. Total: ${clients.size + 1}`);
    clients.add(ws);

    ws.on('close', (code, reason) => {
      clients.delete(ws);
      for (const [pid, conn] of playerConns) {
        if (conn === ws) { playerConns.delete(pid); break; }
      }
      logger.info(`[WS] Client disconnected. Total: ${clients.size} code=${code || '?'} reason=${reason || '?'}`);
    });

    ws.on('error', (err) => {
      logger.error(`[WS] Client error: ${err.message}`);
      clients.delete(ws);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        assert.assert(!!msg.type, 'WS 消息缺少 type 字段');

        if (assert.knownMsgType(msg.type)) {
          logger.debug(`[WS] Received: type=${msg.type} player=${msg.playerId || '?'}`);
        }

        // 记录 playerId → ws 映射
        if (msg.playerId) {
          playerConns.set(msg.playerId, ws);
        }

        // 路由到游戏引擎
        if (messageHandler) {
          messageHandler(msg, ws);
        }
      } catch (e) {
        if (e.name === 'AssertionError') throw e; // 断言错误上抛
        logger.error(`[WS] Invalid message: ${e.message}`);
      }
    });
  });

  logger.info('[WS] Server started');
}

/**
 * 推送游戏状态到所有前端客户端
 * @param {object} state - 游戏状态对象
 */
function broadcast(state) {
  assert.assert(state && state.type, 'broadcast: state 缺失 type 字段');

  const payload = JSON.stringify(state);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}

/**
 * 发送消息到特定玩家
 * @param {string} playerId
 * @param {object} msg
 */
function sendToPlayer(playerId, msg) {
  const ws = playerConns.get(playerId);
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

module.exports = { startWSServer, broadcast, onMessage, sendToPlayer };
