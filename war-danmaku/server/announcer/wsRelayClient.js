/**
 * WS 中继客户端 — 连接 waifu-agent :9191
 *
 * 将话术事件（agent:start/emotion/motion/tts:audio/agent:end）发送到 waifu-agent，
 * waifu-agent 负责播放 TTS 音频 + 口型同步 + 表情动作。
 *
 * waifu-agent 侧零改动 — relay 模式已原生支持所有这些消息类型。
 */

const WebSocket = require('ws');
const logger = require('../logger');

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const WS_URL = 'ws://127.0.0.1:9191/status';

class WsRelayClient {
  constructor(url) {
    this.url = url || WS_URL;
    this.ws = null;
    this.connected = false;
    this._reconnectDelay = RECONNECT_BASE_MS;
    this._reconnectTimer = null;
    this._sendQueue = [];
  }

  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    logger.info('[ANNOUNCER] 连接 waifu-agent WS: ' + this.url);
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on('open', () => {
      this.connected = true;
      this._reconnectDelay = RECONNECT_BASE_MS;
      logger.info('[ANNOUNCER] waifu-agent WS 已连接');
      this._flushQueue();
    });

    ws.on('message', (data) => {
      // 我们只发不收，但 waifu-agent 的 WS 中继会广播，忽略即可
    });

    ws.on('error', (err) => {
      logger.error('[ANNOUNCER] WS 错误: ' + err.message);
    });

    ws.on('close', () => {
      this.connected = false;
      logger.warn('[ANNOUNCER] WS 断开，' + this._reconnectDelay + 'ms 后重连');
      this._scheduleReconnect();
    });
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, RECONNECT_MAX_MS);
      this.connect();
    }, this._reconnectDelay);
  }

  _flushQueue() {
    while (this._sendQueue.length > 0) {
      const msg = this._sendQueue.shift();
      this._sendRaw(msg);
    }
  }

  _sendRaw(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  send(msg) {
    if (!this.connected) {
      // 只缓存 TTS 相关的消息，状态消息即时可丢
      if (msg.type === 'tts:audio' || msg.type === 'agent:start' || msg.type === 'agent:end') {
        if (this._sendQueue.length < 20) this._sendQueue.push(msg);
      }
      return;
    }
    this._sendRaw(msg);
  }

  /**
   * 发送一条完整话术序列:
   *   agent:start → agent:emotion → agent:motion → tts:audio → agent:end
   * emotion/motion 在 tts:audio 之前，确保说话前表情动作已就位。
   * 调度器保证每条话术之间有足够间隔，不会出现覆盖问题。
   */
  speak({ text, audioBase64, durationMs, emotion, motion, verbose }) {
    if (verbose) {
      logger.info(`[ANNOUNCER:WS] → agent:start "${text.slice(0, 50)}"`);
      if (emotion) logger.info(`[ANNOUNCER:WS] → agent:emotion ${emotion}`);
      if (motion) logger.info(`[ANNOUNCER:WS] → agent:motion ${motion.group} idx=${motion.index} pri=${motion.priority}`);
      logger.info(`[ANNOUNCER:WS] → tts:audio base64Len=${audioBase64 ? audioBase64.length : 0} durationMs=${durationMs}`);
      logger.info(`[ANNOUNCER:WS] → agent:end`);
    }
    this.send({ type: 'agent:start', timestamp: new Date().toISOString(), message: text, platform: 'war-danmaku', user_id: 'announcer' });
    if (emotion) this.send({ type: 'agent:emotion', emotion });
    if (motion) this.send({ type: 'agent:motion', motion: motion.group || 'TapBody', index: motion.index, priority: motion.priority || 3 });
    this.send({ type: 'tts:audio', text, audio: audioBase64, duration_ms: durationMs });
    this.send({ type: 'agent:end', timestamp: new Date().toISOString(), response: text });
  }

  disconnect() {
    this._stopReconnect();
    if (this.ws) {
      this.ws.onclose = null; // 阻止自动重连
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this._sendQueue = [];
  }

  _stopReconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }
}

module.exports = { WsRelayClient };
