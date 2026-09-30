/**
 * WebSocket 客户端 — 连接游戏服务器，接收状态更新
 */

const WS_URL = 'ws://localhost:8765';
let ws = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;

/** @type {object|null} 最新游戏状态 */
let gameState = null;

/** @type {Function|null} 状态更新回调 */
let onStateUpdate = null;

/** 是否已初始化画布分辨率 */
let canvasInited = false;

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  console.log('[WS] Connecting to', WS_URL);
  document.getElementById('status').textContent = '⚔ 连接中...';

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('[WS] Connected');
    document.getElementById('status').textContent = '⚔ 已连接 — 等待开播';
    reconnectDelay = 1000; // reset backoff
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'game_state') {
        if (!canvasInited && msg.canvas && window.initCanvas) {
          window.initCanvas(msg.canvas);
          canvasInited = true;
        }
        gameState = msg;
        window.gameState = msg; // 让 renderer 也能读到
        document.getElementById('status').textContent =
          `⚔ ${msg.state} — Round ${msg.round}`;
        if (onStateUpdate) onStateUpdate(msg);
      }
    } catch (e) {
      console.error('[WS] Parse error:', e);
    }
  };

  ws.onclose = () => {
    console.log('[WS] Disconnected, reconnecting in', reconnectDelay, 'ms');
    document.getElementById('status').textContent = '⚠ 连接断开，重连中...';
    scheduleReconnect();
  };

  ws.onerror = (err) => {
    console.error('[WS] Error:', err);
  };
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connect();
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }, reconnectDelay);
}

/** 发送消息到服务器 */
function send(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('[WS] Cannot send — not connected');
    return false;
  }
  ws.send(JSON.stringify(msg));
  return true;
}

// 暴露到全局，方便控制面板调用
window.sendToServer = send;

/** 启动连接 */
connect();
