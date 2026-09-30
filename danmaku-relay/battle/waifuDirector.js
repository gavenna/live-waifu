/**
 * battle/waifuDirector.js — 主播大脑 v1（"直播导演"）
 *
 * 背景（2026-09-28）：
 *   waifu 过去只是"事件反射器"——生兵/开战/结束/进房时被念一句
 *   （见 waifuAnnouncer 的四个 announce* 与 index.js 的 maybeChat），**没有主动性**
 *   （全项目 grep `.speak(` 的调用点全部事件触发，无一处定时/主动）。
 *   本模块给 waifu 装上"主播大脑"：维护直播阶段（IDLE/LIVE）+ 冷场检测，
 *   在长时间没有话说时**主动**生成一句话术（暖场 / 解说），经 waifuBridge 播出。
 *
 * 它**不替代** waifuAnnouncer —— 事件播报照旧走 announce*；Director 只负责"事件之间"的填空，
 *   并在每次播报时被通知（noteSpeech / noteFighting / noteEnded），以免把"刚播过"误判成冷场。
 *
 * 设计要点：
 *   · 定时 tick 必须 unref（对齐 battle/index.js 看门狗/自动续局的纪律），否则进程不退出。
 *   · 话术模板是纯函数（coldText），可离线断言；LLM hook 预留（v1 纯模板，无 key 也工作）。
 *   · 开关 RW_DIRECTOR_ENABLED=0 整体关闭（回到"只有事件播报"）。
 *
 * env：
 *   RW_DIRECTOR_ENABLED   默认 1；=0 关闭
 *   RW_DIRECTOR_TICK_MS   默认 2000；心跳周期
 *   RW_DIRECTOR_IDLE_MS   默认 45000；超过这么久没播报 → 判定冷场
 *   RW_DIRECTOR_COLD_MS   默认 30000；两条主动话术的最小间隔（防刷屏）
 */
'use strict'
const logger = require('../logger')

function intEnv (name, def) {
  const v = parseInt(process.env[name], 10)
  return Number.isFinite(v) && v >= 0 ? v : def
}

const ENABLED = String(process.env.RW_DIRECTOR_ENABLED || '1') === '1'
const TICK_MS = intEnv('RW_DIRECTOR_TICK_MS', 2000)
const IDLE_MS = intEnv('RW_DIRECTOR_IDLE_MS', 45000)
const COLD_MS = intEnv('RW_DIRECTOR_COLD_MS', 30000)

const PHASE = { IDLE: 'IDLE', LIVE: 'LIVE' }
// 播报优先级：越大越"不可被打断"。冷场闲聊最低（可被事件播报压掉）。
const PRIORITY = { COLD: 0, CHAT: 1, SPAWN: 2, ROUND: 3, END: 3 }

// ===== 状态 =====
let phase = PHASE.IDLE
let lastResult = null         // { winner|round|durSec }
let top3 = []                 // 上轮功勋榜前三
let lastSpeechAt = Date.now() // 上次"有话说"的时刻（任何播报都刷新）
let lastIntentAt = 0          // 上次主动话术的时刻
let seq = 0                   // 主动话术序号（用于模板轮换）
let timer = null
let sink = null               // (text, opts) => boolean；默认走 waifuBridge.speak
let contextProvider = null    // () => battle 快照（{red:{balance,spawns}, blue:{...}}）；由 index.js 注入

/** 默认出口：waifuBridge.speak（惰性 require，避免模块加载期副作用 + 循环依赖）。 */
function defaultSink (text, opts) {
  try { return require('./waifuBridge').speak(text, opts) } catch (e) { return false }
}

// ===== 话术模板（纯函数，便于离线断言）=====
const LIVE_QUIPS = [
  '战况胶着，双方都在往一线压兵！看好哪边就发「红」或「蓝」~',
  '打得好凶！这时候一个兵就可能翻盘，快发弹幕上车！'
]

/**
 * 战况解说候选（纯函数）。b: { red:{balance,spawns}, blue:{balance,spawns} }；无数据 → []。
 * 有数据时给出**真数字**的解说（经济领先 / 兵力领先 / 均势咬紧）；无数据由调用方回退通用模板。
 */
function battleLines (b) {
  if (!b) return []
  const out = []
  const rb = Number(b.red && b.red.balance)
  const bb = Number(b.blue && b.blue.balance)
  const rs = Number(b.red && b.red.spawns) || 0
  const bs = Number(b.blue && b.blue.spawns) || 0
  if (Number.isFinite(rb) && Number.isFinite(bb) && Math.min(rb, bb) > 0) {
    const hi = Math.max(rb, bb); const lo = Math.min(rb, bb)
    if (hi / lo >= 1.5) out.push(`注意看经济！${rb > bb ? '红方' : '蓝方'}已经压着对面打了，优势在拉开~`)
    else out.push('两边经济咬得很紧，谁也占不到便宜，就看谁先沉不住气~')
  }
  if (rs !== bs) out.push(`火力榜：红${rs} vs 蓝${bs}，${rs > bs ? '红方' : '蓝方'}的观众更敢投兵！`)
  return out
}

/**
 * 冷场话术（纯函数）。ctx: { phase, lastResult, top3, seq, battle }。
 * LIVE → 战况解说（有 battle 快照就报真数据，否则回退通用模板）；IDLE → 暖场。
 */
function coldText (ctx) {
  ctx = ctx || {}
  const s = Number(ctx.seq) || 0
  if (ctx.phase === PHASE.LIVE) {
    const lines = battleLines(ctx.battle)
    const pool = lines.length ? lines : LIVE_QUIPS
    return pool[s % pool.length]
  }
  const top = (Array.isArray(ctx.top3) && ctx.top3[0] && ctx.top3[0].name) ? ctx.top3[0].name : null
  const w = ctx.lastResult && ctx.lastResult.winner
  if (top) return `上轮功勋榜第一是「${top}」，这局谁来挑战他？发「红」或「蓝」参战~`
  if (w) {
    const who = w === 'red' ? '红方' : '蓝方'
    const r = ctx.lastResult.round != null ? ctx.lastResult.round : '?'
    return `上一轮${who}赢了（第${r}轮），下一局马上开，想上场发「红」或「蓝」~`
  }
  return '新的一局马上开始，在弹幕发「红」或「蓝」就能召唤部队参战，一起来玩~'
}

// ===== 事件通知 =====
/** 报告"刚播了一条"（announce* / 观众对话 / 主动话术都算）。 */
function noteSpeech (at) {
  lastSpeechAt = (typeof at === 'number') ? at : Date.now()
  return lastSpeechAt
}

/** 开战：进入 LIVE（开战播报已由 announceRoundStart 发出，此处刷新 lastSpeechAt）。 */
function noteFighting (info) {
  phase = PHASE.LIVE
  noteSpeech(info && info.at)
  return phase
}

/** 结算：回到 IDLE，并记住上轮结果/榜单（供暖场话术）。 */
function noteEnded (info) {
  phase = PHASE.IDLE
  if (info) {
    lastResult = { winner: info.winner != null ? info.winner : null, round: info.round != null ? info.round : null, durSec: info.durSec != null ? info.durSec : null }
    top3 = Array.isArray(info.top3) ? info.top3 : []
  }
  noteSpeech(info && info.at)
  return phase
}

/** 注入"战况快照"提供者（index.js 用它读经济/兵力）。传 null 关闭。 */
function setContextProvider (fn) {
  contextProvider = (typeof fn === 'function') ? fn : null
  return !!contextProvider
}

// ===== 冷场判定 + 意图 =====
function isCold (at) {
  at = (typeof at === 'number') ? at : Date.now()
  return (at - lastSpeechAt) >= IDLE_MS
}

/**
 * 单步推进（可离线用显式时间戳驱动）。满足"冷场 + 距上次主动 >= COLD_MS"就主动说一句。
 * @returns {{text:string, sent:boolean}|null}
 */
function tick (at) {
  if (!ENABLED) return null
  at = (typeof at === 'number') ? at : Date.now()
  if (!isCold(at)) return null
  if ((at - lastIntentAt) < COLD_MS) return null
  let battle = null
  if (contextProvider) { try { battle = contextProvider() } catch (e) { battle = null } }
  const text = coldText({ phase, lastResult, top3, seq, battle })
  if (!text) return null
  seq++
  lastIntentAt = at
  lastSpeechAt = at
  const send = sink || defaultSink
  let sent = false
  try { sent = !!send(text, { emotion: 'neutral', tag: 'director', priority: PRIORITY.COLD }) } catch (e) { sent = false }
  logger.info(`[DIRECTOR] 主动话术（${phase}）: ${text} (sent=${sent})`)
  return { text, sent }
}

// ===== 生命周期 =====
/** 启动心跳（幂等）。sink 可注入（离线测试）；startAt 可注入起始时刻。 */
function init (opts) {
  opts = opts || {}
  if (typeof opts.sink === 'function') sink = opts.sink
  if (opts.startAt != null) lastSpeechAt = opts.startAt
  if (!ENABLED) return false
  if (timer) return true
  timer = setInterval(() => { try { tick(Date.now()) } catch (e) { logger.warn('[DIRECTOR] tick 异常: ' + (e && e.message)) } }, TICK_MS)
  if (timer.unref) timer.unref()
  logger.info(`[DIRECTOR] 主播大脑已启动（tick ${TICK_MS}ms，静默 ${IDLE_MS}ms 触发主动话术，两条间隔 ${COLD_MS}ms）`)
  return true
}

/** 停止心跳（幂等）。 */
function stop () {
  if (timer) { clearInterval(timer); timer = null }
  return true
}

module.exports = {
  init,
  stop,
  tick,
  noteSpeech,
  noteFighting,
  noteEnded,
  setContextProvider,
  coldText,
  battleLines,
  isCold,
  phase: () => phase,
  lastResult: () => lastResult,
  top3: () => top3,
  ENABLED,
  TICK_MS,
  IDLE_MS,
  COLD_MS,
  PHASE,
  PRIORITY
}
