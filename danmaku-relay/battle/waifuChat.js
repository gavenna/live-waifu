/**
 * waifuChat.js — 观众弹幕 → waifu 对话回复
 *
 * 直播里有两类弹幕：
 *   ① 指令弹幕（"红3战车"）—— 走 battle/liveSpawner，召唤部队，播报用 waifuBridge.speak
 *   ② 闲聊/问好/提问 —— 没有游戏动作，但观众期待被"看见"。本模块处理这一类：
 *      调 LLM 生成一句口语回复 → 交给 waifuBridge.speak 让桌宠开口。
 *
 * LLM 配置（**运行时**读取，改配置无需重启中继）——优先级：环境变量 > 配置文件 > 内置默认：
 *   RW_LLM_API_KEY    / RW_LLM_API_URL / RW_LLM_MODEL   （env，最高优先）
 *   data/llm.json     { apiKey, apiUrl, model }          （默认配置文件，已入 .gitignore ⇒ key 不入库）
 *   RW_LLM_CONFIG_FILE                                    （覆盖配置文件路径；离线回归用它隔离）
 *   RW_WAIFU_CHAT     默认 '1'；=0 关闭对话（仅播报）
 *   RW_CHAT_COOLDOWN_MS  两条回复最小间隔（默认 8000，防刷屏）
 *
 * 为什么对话放中继而不是 waifu 内置：
 *   waifu 的 relay 模式约定"LLM 由外部 Agent 提供"；这里中继就是那个 Agent。
 *   中继已掌握全部战场/观众上下文，最容易生成贴合战况的回复。
 *
 * 降级：无 key 时不回复（诚实静默），只在首次被调用时记一条 warn 提示如何开启。
 */
const https = require('https')
const fs = require('fs')
const path = require('path')
const logger = require('../logger')

const DEFAULT_API_URL = 'https://api.deepseek.com/v1/chat/completions'
const DEFAULT_MODEL = 'deepseek-chat'
const ENABLED = String(process.env.RW_WAIFU_CHAT || '1') === '1'
const COOLDOWN_MS = (() => {
  const v = parseInt(process.env.RW_CHAT_COOLDOWN_MS, 10)
  return Number.isFinite(v) && v >= 0 ? v : 8000
})()
const TIMEOUT_MS = 15000
const MAX_REPLY_CHARS = 60

// 人格：直播间**主播**（2026-09-28 主播化重设计 Wave 4：由"女友/女主人"改为"主持人"定位——
//   面向直播间全体观众，而非主播本人的私人伴侣。见 docs/主播化-Wave0-探针与结论.md 与计划文档）
const PERSONA = [
  '你是抖音直播间《红蓝对战》的 AI 虚拟主播，名字「默川」，是这个直播间的**主持人**，面向全体观众。',
  '语气：热情、有梗、有节奏感的主播台风；对观众亲和不油腻，会主动接话、cue 观众、带气氛。**不毒舌、不怼人、不嘲讽、不阴阳怪气**。',
  '回复要求：**一句话**，不超过 40 字，口语化，适合语音朗读；禁止 emoji、markdown、换行、括号说明。',
  '观众发「红/蓝+兵种」（如"红3狂暴者"）是在召唤部队，不用回应；',
  '其余弹幕（打招呼 / 问战况 / 聊天 / 提问）要自然接话、能带节奏；不知道就大方带过，绝不编造。'
].join('\n')

/** 玩法知识文件路径（RW_WAIFU_KNOWLEDGE_FILE 可覆盖）。默认 battle/waifu-knowledge.md。 */
function knowledgePath () {
  return process.env.RW_WAIFU_KNOWLEDGE_FILE || path.join(__dirname, 'waifu-knowledge.md')
}

/** 读玩法知识（运行时读，失败返回空串、不影响对话）。 */
function loadKnowledge () {
  try { return fs.readFileSync(knowledgePath(), 'utf8').trim() } catch (e) { return '' }
}

/** 组装 system prompt = 主播人格 + 玩法知识（让 AI 有据可依，不无的放矢）。 */
function buildSystemPrompt () {
  const kn = loadKnowledge()
  return kn ? `${PERSONA}\n\n${kn}` : PERSONA
}

let lastReplyAt = 0
let inflight = false
let warnedNoKey = false

/** 配置文件路径（RW_LLM_CONFIG_FILE 可覆盖）。默认 data/llm.json —— 该目录已入 .gitignore，key 不入库。 */
function configPath () {
  return process.env.RW_LLM_CONFIG_FILE || path.join(__dirname, '..', 'data', 'llm.json')
}

/** 读 LLM 配置（运行时读，非加载时缓存）⇒ 改配置无需重启中继。 */
function loadConfig () {
  let file = {}
  try {
    const s = JSON.parse(fs.readFileSync(configPath(), 'utf8'))
    if (s && typeof s === 'object') file = s
  } catch (e) { /* 无文件 / 不可读 / 非法 JSON → 忽略，退回 env/默认 */ }
  return {
    apiKey: process.env.RW_LLM_API_KEY || file.apiKey || '',
    apiUrl: process.env.RW_LLM_API_URL || file.apiUrl || DEFAULT_API_URL,
    model: process.env.RW_LLM_MODEL || file.model || DEFAULT_MODEL
  }
}

function isConfigured () { return !!loadConfig().apiKey }
function isEnabled () { return ENABLED && isConfigured() }

/** 冷却判断（纯函数，便于离线验证）。 */
function withinCooldown (now, last) { return now - last < COOLDOWN_MS }

function postJson (url, payload, apiKey) {
  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(url) } catch (e) { reject(new Error('非法 API URL: ' + url)); return }
    const body = JSON.stringify(payload)
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: TIMEOUT_MS
    }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error('HTTP ' + res.statusCode + ' ' + data.slice(0, 160)))
          return
        }
        try { resolve(JSON.parse(data)) } catch (e) { reject(new Error('响应非 JSON: ' + data.slice(0, 160))) }
      })
    })
    req.on('timeout', () => { req.destroy(new Error('LLM 请求超时')) })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

/** 清洗模型输出：去引号/换行/前后缀，截断到一句话。 */
function sanitize (raw) {
  if (!raw) return ''
  let t = String(raw).replace(/[\r\n]+/g, ' ').replace(/^[\s"'“”『』]+|[\s"'“”『』]+$/g, '').trim()
  if (t.length > MAX_REPLY_CHARS) t = t.slice(0, MAX_REPLY_CHARS)
  return t
}

/**
 * 生成一条对话回复。
 * @param {{text:string, nickname?:string, context?:string}} opts
 * @returns {Promise<{text:string, emotion?:string}|null>} null = 未启用/被冷却/失败（调用方应静默跳过）
 */
async function reply (opts) {
  const o = opts || {}
  const text = String(o.text || '').trim()
  if (!text) return null
  if (!ENABLED) return null
  const cfg = loadConfig()
  if (!cfg.apiKey) {
    if (!warnedNoKey) { warnedNoKey = true; logger.warn('[WAIFU][chat] 未配置 LLM key（RW_LLM_API_KEY 或 data/llm.json），观众对话功能关闭（仅播报）') }
    return null
  }
  const now = Date.now()
  if (withinCooldown(now, lastReplyAt)) return null
  if (inflight) return null                 // 上一句还没回来，跳过，避免堆积

  inflight = true
  lastReplyAt = now
  try {
    const userMsg = (o.nickname ? `${o.nickname}：` : '') + text + (o.context ? `\n（当前战况：${o.context}）` : '')
    const res = await postJson(cfg.apiUrl, {
      model: cfg.model,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: userMsg }
      ],
      temperature: 0.9,
      max_tokens: 80
    }, cfg.apiKey)
    const content = res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content
    const clean = sanitize(content)
    if (!clean) return null
    return { text: clean, emotion: 'happy' }
  } catch (e) {
    logger.warn('[WAIFU][chat] 生成失败: ' + (e && e.message))
    return null
  } finally {
    inflight = false
  }
}

/** 重置冷却（测试/轮次切换用）。 */
function resetCooldown () { lastReplyAt = 0 }

module.exports = { reply, isEnabled, isConfigured, loadConfig, configPath, loadKnowledge, knowledgePath, buildSystemPrompt, PERSONA, withinCooldown, sanitize, resetCooldown, COOLDOWN_MS, ENABLED }
