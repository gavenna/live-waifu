/**
 * 弹幕中继客户端 — 连接 danmaku-relay :8766 消费弹幕消息
 *
 * ws://localhost:8766 → 接收弹幕/礼物/进房消息 → gameEngine.handleMessage
 * 断线自动重连 (exponential backoff)，重连期间弹幕丢失（不缓存，实时消费）
 */

const WebSocket = require('ws');
const logger = require('./logger');

let ws = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
const MAX_DELAY = 30000;
let shutdown = false;
let messageHandler = null;

/**
 * 注册消息处理回调（GameEngine.handleMessage）
 * @param {(msg: object) => void} handler
 */
function onDanmaku(handler) {
  messageHandler = handler;
}

function connect(url) {
  if (shutdown) return;
  logger.info(`[RELAY] 连接弹幕中继 ${url}...`);
  const s = new WebSocket(url);
  ws = s;

  s.on('open', () => {
    logger.info(`[RELAY] 已连接弹幕中继 (${subCount()})`);
    reconnectDelay = 1000;
  });

  s.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (messageHandler) messageHandler(msg);
    } catch (e) {
      logger.error(`[RELAY] 无效消息: ${e.message}`);
    }
  });

  s.on('close', () => {
    logger.warn('[RELAY] 弹幕中继断连');
    ws = null;
    if (!shutdown) scheduleReconnect(url);
  });

  s.on('error', (err) => {
    logger.error(`[RELAY] 连接错误: ${err.message}`);
  });
}

function scheduleReconnect(url) {
  if (reconnectTimer) return;
  logger.warn(`[RELAY] ${reconnectDelay}ms 后重连...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(url);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);
  }, reconnectDelay);
}

function disconnect() {
  shutdown = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { try { ws.close(); } catch (e) {} ws = null; }
}

function isConnected() {
  return ws && ws.readyState === WebSocket.OPEN;
}

function subCount() {
  return ws && ws.readyState === WebSocket.OPEN ? '已连接' : '未连接';
}

module.exports = { onDanmaku, connect, disconnect, isConnected };
