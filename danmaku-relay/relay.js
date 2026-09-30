/**
 * 弹幕广播中继 — WebSocket 服务
 *
 * 适配器（B站/抖音）在进程内调用 broadcast() 推送翻译好的消息，
 * 所有已连接的订阅方（游戏服务器等）都会收到。
 *
 * 协议契约见 docs/协议.md
 */

const { WebSocketServer } = require('ws');
const logger = require('./logger');

const subscribers = new Set();
const internalHandlers = [];

/**
 * 注册内部消息处理器（不经过 WebSocket，直接回调）
 * @param {function} handler
 */
function onDanmaku(handler) {
  internalHandlers.push(handler);
}

/**
 * 启动中继服务
 * @param {number} port
 */
function startRelay(port) {
  const wss = new WebSocketServer({ port });

  wss.on('listening', () => {
    logger.info(`[RELAY] 弹幕广播 WebSocket on port ${port}`);
  });

  wss.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`[RELAY] 端口 ${port} 已被占用 — 请先关闭旧进程: netstat -ano | grep ${port}`);
      process.exit(1);
    }
    throw err;
  });

  wss.on('connection', (ws) => {
    subscribers.add(ws);
    logger.info(`[RELAY] 订阅方接入。当前订阅: ${subscribers.size}`);

    ws.on('close', () => {
      subscribers.delete(ws);
      logger.info(`[RELAY] 订阅方断开。当前订阅: ${subscribers.size}`);
    });

    ws.on('error', (err) => {
      logger.error(`[RELAY] 订阅方错误: ${err.message}`);
      subscribers.delete(ws);
    });
  });

  return wss;
}

/**
 * 广播消息给所有订阅方
 * @param {object} msg - 消息对象，必须带 type 字段
 */
function broadcast(msg) {
  if (!msg || !msg.type) return;
  const payload = JSON.stringify(msg);
  for (const ws of subscribers) {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(payload); } catch (e) { logger.error(`[RELAY] 推送失败: ${e.message}`); }
    }
  }
  // 内部处理器（战斗系统等）
  for (const handler of internalHandlers) {
    try { handler(msg); } catch (e) { logger.error(`[RELAY] 内部处理器错误: ${e.message}`); }
  }
}

/** 当前订阅方数量 */
function subscriberCount() { return subscribers.size; }

module.exports = { startRelay, broadcast, subscriberCount, onDanmaku };
