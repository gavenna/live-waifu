/**
 * waifuBridge.js — 把游戏事件 / 观众弹幕转发给 waifu-agent（relay 协议 :9191）
 *
 * 背景（2026-09-20）：
 *   真实游戏链路（danmaku-relay/battle）对观众的"播报"过去只有一条通道 —— 游戏内
 *   `debug.showMessage()`（纯画面文字，无声无表情，见 battle/index.js 的 announce()）。
 *   Live2D 桌宠 waifu-agent 有现成的 relay 接口
 *   （ws://127.0.0.1:9191/status，契约见 waifu-agent/docs/技术参考/Agent Relay 协议.md），
 *   但当前直播链路**没有任何一方连它** ⇒ 桌宠是孤立组件，观众看不到它开口。
 *   本模块补上这条接线：游戏事件 → 话术 → waifu（语音 + 表情 + 动作）。
 *
 * 与 waifu 的协议（复用现有 agent:* 事件，新增一个可选字段 synthesize）：
 *   agent:start   { message }                   回显触发文本
 *   agent:emotion { emotion }                   表情（happy|sad|angry|surprised|neutral|shy|loving）
 *   agent:motion  { motion, index?, priority? } 动作组
 *   agent:end     { response, synthesize: true } 完整文本 + 要求 waifu 用**自身 TTS**开口
 *
 * 为什么用 synthesize 而不是自己发 tts:audio：
 *   waifu 自带 edge-tts（src-tauri/python-embed，已验证 import edge_tts 7.2.8 可用），
 *   TTS 本就是它的职责；中继侧零 TTS 依赖，音频也不必走 WebSocket（base64 体积大）。
 *   这是"职责单一 / 整体互恰"的选择。war-danmaku 的旧 announcer 仍走 tts:audio
 *   （**不带** synthesize），waifu 两种都兼容 —— 见 Agent Relay 协议.md §3.4 的扩展说明。
 *
 * 广播语义（waifu-agent/src-tauri/src/ws_relay.rs）：:9191 把每个客户端发的消息
 *   **广播给房间内其他客户端**（排除发送者）。所以中继发出的 agent:* 会被 waifu 前端收到；
 *   中继也会收到 waifu 发出的 user:chat / user:skip（对话用，见 setOnMessage）。
 *
 * 开关：RW_WAIFU_ENABLED=0 整体关闭（回到"只有游戏内文字播报"）；
 *       RW_WAIFU_WS_URL 覆盖地址（离线回归指向假 server）。
 */
const WebSocket = require('ws')
const logger = require('../logger')

const ENABLED = String(process.env.RW_WAIFU_ENABLED || '1') === '1'
const WS_URL = process.env.RW_WAIFU_WS_URL || 'ws://127.0.0.1:9191/status'
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000
const QUEUE_MAX = 20

let ws = null
let connected = false
let reconnectDelay = RECONNECT_BASE_MS
let reconnectTimer = null
let stopRequested = false
let armed = false                    // connect() 被调用过 = 已武装；未武装时 speak 静默 no-op（见 speak 注释）
let onMessage = null                 // (msg) => void，收 waifu 发来的消息
const queue = []                     // 断线期间缓存的关键事件

// ★ 播报优先级（2026-09-28）：带 priority 的播报参与"抢占"。中继拿不到 waifu 的播放完成回执，
//   用字数**近似**估算一次播放窗口；窗口内若来了同/更低优先级则丢弃（防主播话术叠着念）。
//   不带 priority 的调用**不受影响**（保持旧行为：waifuAnnouncer / maybeChat 走这条路）。
let _currentPriority = null
let _speakingUntil = 0
/** 近似估算一次 TTS 播放时长（ms）：中文 ~180ms/字 + 起播缓冲，封顶 20s。 */
function estimateSpeakMs (text) { return Math.min(20000, 800 + String(text || '').length * 180) }

/** 建立连接（幂等：已连/正在连直接返回）。ENABLED=0 时不做事。 */
function connect () {
  if (!ENABLED) return false
  armed = true                       // 一旦 connect（= 中继 init 时）就武装，之后 speak 才生效
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return true
  stopRequested = false
  const self = new WebSocket(WS_URL)
  ws = self
  self.on('open', () => {
    connected = true
    reconnectDelay = RECONNECT_BASE_MS
    logger.info(`[WAIFU] 已连接 ${WS_URL}`)
    flushQueue()
  })
  self.on('message', (data) => {
    let msg = null
    try { msg = JSON.parse(data.toString()) } catch (e) { return }
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'connected') return          // ws_relay 的握手帧，忽略
    if (onMessage) {
      try { onMessage(msg) } catch (e) { logger.warn(`[WAIFU] onMessage 异常: ${e && e.message}`) }
    }
  })
  self.on('error', (err) => {
    // waifu 没起时这里会持续 ECONNREFUSED —— 降到 debug，不刷屏真实日志
    logger.debug(`[WAIFU] WS 错误: ${err && err.message}`)
  })
  self.on('close', () => {
    connected = false
    if (stopRequested) return
    scheduleReconnect()
  })
  return true
}

function scheduleReconnect () {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS)
    connect()
  }, reconnectDelay)
  if (reconnectTimer.unref) reconnectTimer.unref()
}

function flushQueue () {
  while (queue.length > 0 && connected && ws && ws.readyState === WebSocket.OPEN) {
    const msg = queue.shift()
    try { ws.send(JSON.stringify(msg)) } catch (e) { break }
  }
}

/** 发一条消息。未连接时只缓存 agent:start/agent:end（播报不可丢）。返回是否即时送达。 */
function send (msg) {
  if (!ENABLED) return false
  if (connected && ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(msg)); return true } catch (e) { return false }
  }
  if (msg.type === 'agent:start' || msg.type === 'agent:end') {
    if (queue.length < QUEUE_MAX) queue.push(msg)
  }
  return false
}

/**
 * 让 waifu 开口说一句话（表情/动作可选）。
 * @param {string} text                 话术文本（会被 waifu 的 TTS 朗读）
 * @param {object} [opts]
 * @param {string} [opts.emotion]       表情名
 * @param {string|{group:string,index?:number,priority?:number}} [opts.motion] 动作
 * @param {string} [opts.tag]           日志标签（如 'end' / 'spawn' / 'chat'）
 * @returns {boolean} 是否即时送达（false = 已入队或未启用）
 */
function speak (text, opts) {
  const o = opts || {}
  const msg = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
  if (!msg) return false
  // 未武装（connect 从未被调用）⇒ 静默 no-op：离线回归脚本只 require battle/index.js 而不 init()，
  // 不应把 [WAIFU] 播报噪音写进真实日志，也不该尝试连接真实 :9191。
  if (!ENABLED || !armed) return false
  // ★ 优先级抢占：只有**带了 priority** 的播报参与——上一条带 priority 的若仍在播放窗口内，
  //   本条优先级不高于它则丢弃。不带 priority 的调用不受影响（保护旧行为）。
  const priority = Number.isFinite(o.priority) ? o.priority : null
  const nowMs = Date.now()
  if (nowMs >= _speakingUntil) _currentPriority = null
  if (priority !== null && _currentPriority !== null && priority <= _currentPriority) {
    logger.info(`[WAIFU]${o.tag ? `[${o.tag}]` : ''} 抢占丢弃(prio ${priority} ≤ ${_currentPriority}): ${msg}`)
    return false
  }
  const tag = o.tag ? `[${o.tag}]` : ''
  logger.info(`[WAIFU]${tag} 🎤 ${msg}`)
  send({ type: 'agent:start', message: msg })
  if (o.emotion) send({ type: 'agent:emotion', emotion: o.emotion })
  if (o.motion) {
    const m = (typeof o.motion === 'string') ? { group: o.motion } : o.motion
    send({ type: 'agent:motion', motion: m.group || 'TapBody', index: m.index, priority: m.priority || 3 })
  }
  // synthesize:true ⇒ 让 waifu 用自身 edge-tts 合成语音（见文件头）
  const ok = send({ type: 'agent:end', response: msg, synthesize: true })
  if (priority !== null) { _currentPriority = priority; _speakingUntil = nowMs + estimateSpeakMs(msg) }
  return ok
}

/** 断开连接并停止重连（幂等）。 */
function disconnect () {
  stopRequested = true
  armed = false
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  if (ws) { try { ws.close() } catch (e) {} ws = null }
  connected = false
  queue.length = 0
  return true
}

/** 注册/清除"收到 waifu 消息"的回调（对话用）。 */
function setOnMessage (fn) { onMessage = (typeof fn === 'function') ? fn : null }

module.exports = {
  speak,
  connect,
  disconnect,
  setOnMessage,
  estimateSpeakMs,
  ENABLED,
  WS_URL,
  get connected () { return connected },
  get _queueLength () { return queue.length }
}
