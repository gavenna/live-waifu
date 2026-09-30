'use strict'
/**
 * economy.js — 引擎真实经济接线（2026-09-19）
 *
 * 数据来源：游戏内注入的 `EconBridge`（javassist 注入进 game-lib.jar）每 6 帧写出的
 *           `<游戏目录>\econ_live.txt`，格式：
 *               # econ_live <millis> <frame>
 *               team <id> <balance> <incomePerSec>
 * 写入通道：注入新增的脚本 API `debug.addTeamCredits(team, delta)`（精确加减，已实测）。
 *
 * 🔑 默认**关闭**：`RW_ECON_ENABLED=1` 才启用扣款；关闭时本模块只读不写，
 *    生兵行为与"免费召唤"**完全一致**（可一秒回退）。
 *
 * 环境变量：
 *   RW_ECON_ENABLED=1|0        总开关（默认 0）
 *   RW_GAME_DIR=<path>         游戏目录（默认下方内置路径）
 *   RW_ECON_FILE=<path>        直接指定 econ_live.txt（优先于 RW_GAME_DIR）
 *   RW_ECON_MAX_AGE_MS=2000    数据过期阈值（超过则视为"未就绪"，不扣款）
 *   RW_ECON_READ_RETRY=6       读取重试次数（写入方是原子写，重试只为极端时序兜底）
 */
const fs = require('fs')
const path = require('path')

const GAME_DIR = process.env.RW_GAME_DIR ||
  'D:\\game\\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\\Rusted Warfare1.15'
const LIVE_FILE = process.env.RW_ECON_FILE || path.join(GAME_DIR, 'econ_live.txt')
const ENABLED = String(process.env.RW_ECON_ENABLED || '0') === '1'
const MAX_AGE_MS = Number(process.env.RW_ECON_MAX_AGE_MS || 2000)
const READ_RETRY = Math.max(1, Number(process.env.RW_ECON_READ_RETRY || 6))
const CACHE_TTL_MS = 200

let PRICES = {}
try {
  PRICES = require('./unit-prices.json')
} catch (e) {
  PRICES = {}
}
// mod 单位单价（游戏已启用 mod 新增，见 tools/gen_mod_units.js）；不覆盖已有键。
try {
  const mod = require('./mod-units.json')
  for (const u of (mod.units || [])) {
    if (u && u.type && Number.isFinite(u.price) && PRICES[u.type] == null) PRICES[u.type] = u.price
  }
} catch (e) { /* 无 mod-units.json：跳过 */ }

let cache = { at: 0, ts: 0, frame: 0, teams: new Map(), ok: false }

function parseLive (text) {
  const teams = new Map()
  let ts = 0
  let frame = 0
  const lines = String(text).split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const h = /^#\s*econ_live\s+(\d+)\s+(\d+)/.exec(line)
    if (h) {
      ts = Number(h[1])
      frame = Number(h[2])
      continue
    }
    const m = /^team\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/.exec(line)
    if (m) {
      const id = Number(m[1])
      teams.set(id, { id, balance: Number(m[2]), income: Number(m[3]) })
    }
  }
  return { ts, frame, teams }
}

/** 读一次实时经济；带缓存与重试。返回 {at,ts,frame,teams:Map,ok,ageMs} */
function readLive (force) {
  const now = Date.now()
  if (!force && cache.ok && now - cache.at < CACHE_TTL_MS) return cache
  let last = null
  for (let attempt = 0; attempt < READ_RETRY; attempt++) {
    try {
      const text = fs.readFileSync(LIVE_FILE, 'utf8')
      if (text && text.length > 10) {
        const p = parseLive(text)
        if (p.teams.size > 0) {
          p.at = now
          p.ok = true
          p.ageMs = p.ts ? now - p.ts : null
          cache = p
          return cache
        }
      }
      last = 'empty/unparsable'
    } catch (e) {
      last = e.code || e.message
    }
    const until = Date.now() + 20
    while (Date.now() < until) { /* 短忙等：同步 API，给原子 rename 一点时间窗 */ }
  }
  const stale = Object.assign({}, cache, { at: now, ok: false, error: last })
  cache = stale
  return cache
}

function getTeam (teamId) {
  const c = readLive()
  if (!c.ok) return null
  if (c.ageMs != null && c.ageMs > MAX_AGE_MS) return null
  return c.teams.get(Number(teamId)) || null
}

/** 引擎内真实单价；未知单位返回 null */
function priceOf (unitType) {
  const p = PRICES[unitType]
  return Number.isFinite(p) ? p : null
}

/**
 * 扣款：调用注入的 debug.addTeamCredits(team, -amount)。
 * 返回 {charged, sent, cmd}；未启用时 charged=false。
 * ⚠️ 引擎不会因生兵自动扣钱（已实测），扣款**只能**由这里显式做。
 */
function charge (teamId, amount, sendCommand) {
  const amt = Math.abs(Math.round(Number(amount) || 0))
  if (!ENABLED) return { charged: false, sent: false, reason: 'disabled' }
  if (!amt) return { charged: false, sent: false, reason: 'zero' }
  if (typeof sendCommand !== 'function') return { charged: false, sent: false, reason: 'no-sendCommand' }
  const cmd = `script debug.addTeamCredits(${Number(teamId)}, ${-amt})`
  const sent = sendCommand(cmd)
  const t = cache.teams.get(Number(teamId))
  if (t) t.balance = Math.max(0, t.balance - amt) // 乐观更新，避免同一秒内连着召唤时重复扣同一笔余额
  return { charged: true, sent, cmd, amount: amt }
}

/**
 * 加余额：调用注入的 `debug.addTeamCredits(team, +amount)`。
 * 与 charge() **对称** —— 观众互动奖励（点赞 / 关注）走这里。
 * ⚠️ 必须走本函数：它同步维护乐观缓存；绕过会让控制台显示的钱与游戏内对不上。
 * 未启用经济（RW_ECON_ENABLED=0）时返回 credited=false ——
 *   此时生兵免费、余额不参与结算，「加余额」没有意义，故与 charge 同样受开关约束。
 * 返回 {credited, sent, cmd, amount}。
 */
function credit (teamId, amount, sendCommand) {
  const amt = Math.abs(Math.round(Number(amount) || 0))
  if (!ENABLED) return { credited: false, sent: false, reason: 'disabled' }
  if (!amt) return { credited: false, sent: false, reason: 'zero' }
  if (typeof sendCommand !== 'function') return { credited: false, sent: false, reason: 'no-sendCommand' }
  const cmd = `script debug.addTeamCredits(${Number(teamId)}, ${amt})`
  const sent = sendCommand(cmd)
  const t = cache.teams.get(Number(teamId))
  if (t) t.balance = t.balance + amt // 乐观更新：控制台与后续扣款立即看到这笔收入
  return { credited: true, sent, cmd, amount: amt }
}

/** 人类可读：`$96481(+67)` */
function format (teamId) {
  const t = getTeam(teamId)
  if (!t) return null
  return `$${Math.floor(t.balance)}(+${t.income})`
}

function status () {
  const c = readLive(true)
  return {
    enabled: ENABLED,
    file: LIVE_FILE,
    ok: c.ok,
    error: c.error || null,
    ageMs: c.ageMs != null ? c.ageMs : null,
    frame: c.frame || null,
    teams: Array.from(c.teams.values()).map(t => ({ ...t, balance: Math.floor(t.balance) }))
  }
}

module.exports = {
  ENABLED,
  LIVE_FILE,
  GAME_DIR,
  readLive,
  getTeam,
  priceOf,
  charge,
  credit,
  format,
  status
}
