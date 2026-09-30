/**
 * waifuAnnouncer.js — 游戏事件 → waifu 话术（含节流）
 *
 * 职责：把中继的游戏事件翻译成**口语话术**，交给 waifuBridge 让桌宠开口。
 *   ① 话术模板：纯函数（spawnText / roundStartText / roundEndText），可离线断言
 *   ② 生兵合并窗口：高频召唤合并成一条播报，避免 TTS 积压刷屏
 *   ③ 统一出口：所有话术经 bridge.speak 发出
 *
 * 与 battle/index.js 的 announce() 分工：
 *   - announce()（旧）→ 游戏内 `debug.showMessage` 文字，**保留**为无声兜底
 *   - 本模块 → waifu 桌宠语音播报（有表情）
 *   两者并存：即使 waifu 没开，游戏内文字照样出现。
 *
 * 关闭：waifuBridge.ENABLED=0（RW_WAIFU_ENABLED=0）时本模块所有函数变 no-op。
 */
const bridge = require('./waifuBridge')
const logger = require('../logger')

// 生兵播报合并窗口（ms）。窗口内多条召唤合并成一条；=0 关闭合并（每条直发，可能积压）。
const SPAWN_WINDOW_MS = (() => {
  const v = parseInt(process.env.RW_WAIFU_SPAWN_WINDOW_MS, 10)
  return Number.isFinite(v) && v >= 0 ? v : 1200
})()

// ===== 话术模板（纯函数）=====

/**
 * 召唤话术。entries: [{teamName, unitName, count}] → 按队伍聚合。
 * 例: [{teamName:'红方',unitName:'战车',count:3}] → "红方3个战车，已投入战场！"
 */
function spawnText (entries) {
  if (!Array.isArray(entries) || entries.length === 0) return ''
  const byTeam = new Map()
  for (const e of entries) {
    const team = e && e.teamName ? e.teamName : '观众'
    if (!byTeam.has(team)) byTeam.set(team, new Map())
    const units = byTeam.get(team)
    const name = (e && e.unitName) ? e.unitName : '部队'
    const n = (e && e.count) ? Math.max(1, e.count) : 1
    units.set(name, (units.get(name) || 0) + n)
  }
  const parts = []
  for (const [team, units] of byTeam) {
    const names = []
    for (const [name, count] of units) names.push(count > 1 ? `${count}个${name}` : name)
    parts.push(`${team}${names.join('、')}`)
  }
  return `${parts.join('，')}，已投入战场！`
}

/** 开战话术。 */
function roundStartText (round) {
  return `第 ${round} 轮开战！红蓝双方全军出击，谁都别客气！`
}

/** 结束话术。winner: 'red'|'blue'|null；top3: 贡献榜前三（可缺省）。平局时用中性语气。 */
function roundEndText ({ winner, round, durSec, top3 }) {
  const r = round != null ? round : '?'
  const s = durSec != null ? durSec : 0
  let base
  if (winner === 'red' || winner === 'blue') {
    base = `第${r}轮结束，${winner === 'red' ? '红方' : '蓝方'}获胜！用时${s}秒。`
  } else {
    base = `第${r}轮时间到，双方打平，下一轮继续！`
  }
  if (Array.isArray(top3) && top3.length > 0) {
    const names = top3.map((v, i) => `${i + 1}.${(v && v.name) || '观众'}`)
    base += `本轮功勋前三：${names.join('、')}。`
  }
  return base
}

/**
 * 礼物冠名话术（纯函数）。Wave 4.3：让"花了钱"的观众**被看见**——念出名字 + 召唤的兵。
 * 例: {name:'张三', giftName:'小心心', teamName:'红方', unitName:'秃鹰', count:10}
 *   → "感谢「张三」送出的小心心，红方收到 10 个秃鹰，已空投战场！"
 */
/**
 * 游戏币数 → 口播用中文量词（500000 → "50万"，12000 → "1.2万"，800 → "800"）。
 * 礼物加余额的金额是大数，直读数字观众听不出来。
 */
function creditsText (n) {
  const v = Math.max(0, Math.round(Number(n) || 0))
  if (v < 10000) return String(v)
  const w = v / 10000
  return `${Number.isInteger(w) ? w : w.toFixed(1)}万`
}

function giftText (info) {
  const o = info || {}
  const who = (o.name && String(o.name).trim()) || '热心观众'
  const gift = (o.giftName && String(o.giftName).trim()) ? `送出的${o.giftName}` : '的礼物'
  const t = o.teamName ? `${o.teamName}` : ''
  // ★ 2026-10 加余额型礼物（小心心）：换的是**军费**不是兵，别念"空投部队"。
  const credits = Number(o.credits)
  if (Number.isFinite(credits) && credits > 0) {
    return `感谢「${who}」${gift}，${t}军费增加 ${creditsText(credits)}！`
  }
  const u = o.unitName || '部队'
  const n = Math.max(1, Number(o.count) || 1)
  return `感谢「${who}」${gift}，${t}收到 ${n} 个${u}，已空投战场！`
}

// ===== 入场欢迎（合并窗口 + 规则节流）=====
// 直播里观众进进出出很频繁；waifu 播放是"后一条停掉前一条"⇒ 逐条播报会互相打断、听不清。
// 用窗口把短时间内的入场合并成一句。规则介绍较长，按 RULES_COOLDOWN_MS 节流，避免刷屏。
const WELCOME_WINDOW_MS = (() => {
  const v = parseInt(process.env.RW_WELCOME_WINDOW_MS, 10)
  return Number.isFinite(v) && v >= 0 ? v : 2500
})()
const WELCOME_ENABLED = String(process.env.RW_WELCOME_ENABLED || '1') === '1'
const RULES_COOLDOWN_MS = (() => {
  const v = parseInt(process.env.RW_RULES_COOLDOWN_MS, 10)
  return Number.isFinite(v) && v >= 0 ? v : 90000
})()
const RULES_TEXT = '规则很简单：在弹幕里发「红3狂暴者」这样的指令，就能召唤部队替你支持的那一方打仗，单条最多十个，钱不够会召唤失败。一起来把对面推平吧！详细介绍可以看主页置顶视频哦～'

let _welcomeTimer = null
let _welcomeEntries = []
let _lastRulesAt = 0

/**
 * 欢迎话术（纯函数）。entries: [{name, teamName}]；withRules 决定是否附规则介绍。
 * 两条实测得出的规矩（2026-09-20）：
 *  ① **不报阵营** —— 进房只是先给个初始归属，观众之后发红/蓝阵营弹幕还不一定；
 *     而且平台会在 2 秒内重发进房消息（同一人两条），第二条走"保留原队"分支，
 *     报阵营会念出与实际不符的队。
 *  ② **按名字去重** —— 同一人落在同一个合并窗口里时只念一次，别念成
 *     「欢迎 张三、张三！」。
 */
function welcomeText (entries, withRules) {
  if (!Array.isArray(entries) || entries.length === 0) return ''
  const names = []
  for (const e of entries) {
    const n = e.name || '新朋友'
    if (!names.includes(n)) names.push(n)
  }
  return withRules ? `欢迎 ${names.join('、')}！${RULES_TEXT}` : `欢迎 ${names.join('、')}！`
}

/** 登记一次入场（合并窗口后播报）。 */
function announceWelcome (name, teamName) {
  if (!bridge.ENABLED || !WELCOME_ENABLED) return false
  _welcomeEntries.push({ name, teamName })
  if (!_welcomeTimer) {
    _welcomeTimer = setTimeout(flushWelcome, WELCOME_WINDOW_MS)
    if (_welcomeTimer.unref) _welcomeTimer.unref()
  }
  return true
}

/** 冲出待播的欢迎（窗口到点 / 轮次切换前）。规则介绍按冷却节流。 */
function flushWelcome () {
  if (_welcomeTimer) { clearTimeout(_welcomeTimer); _welcomeTimer = null }
  const entries = _welcomeEntries.slice()
  _welcomeEntries.length = 0
  if (entries.length === 0) return false
  const now = Date.now()
  const withRules = (now - _lastRulesAt) >= RULES_COOLDOWN_MS
  if (withRules) _lastRulesAt = now
  return bridge.speak(welcomeText(entries, withRules), { emotion: 'happy', tag: 'welcome' })
}

// ===== 生兵合并窗口 =====
let _spawnTimer = null
let _spawnEntries = []

/**
 * 登记一次召唤；窗口结束后合并播报。
 * @param {{teamName:string, unitName:string, count:number}} entry
 */
function announceSpawn (entry) {
  if (!bridge.ENABLED || !entry) return false
  if (SPAWN_WINDOW_MS <= 0) {
    return bridge.speak(spawnText([entry]), { emotion: 'happy', tag: 'spawn' })
  }
  _spawnEntries.push(entry)
  if (!_spawnTimer) {
    _spawnTimer = setTimeout(flushSpawn, SPAWN_WINDOW_MS)
    if (_spawnTimer.unref) _spawnTimer.unref()
  }
  return true
}

/** 立即冲出待播的召唤（窗口到点 / 轮次切换前调用）。返回是否发出一条播报。 */
function flushSpawn () {
  if (_spawnTimer) { clearTimeout(_spawnTimer); _spawnTimer = null }
  const entries = _spawnEntries.slice()
  _spawnEntries.length = 0
  if (entries.length === 0) return false
  const text = spawnText(entries)
  if (!text) return false
  return bridge.speak(text, { emotion: 'happy', tag: 'spawn' })
}

/** 开战播报（先冲出待播召唤，保证顺序）。 */
function announceRoundStart (round) {
  if (!bridge.ENABLED) return false
  flushSpawn()
  return bridge.speak(roundStartText(round), { emotion: 'happy', tag: 'round' })
}

/** 结束播报（先冲出待播召唤）。 */
function announceRoundEnd (info) {
  if (!bridge.ENABLED) return false
  flushSpawn()
  const text = roundEndText(info || {})
  const emotion = (info && (info.winner === 'red' || info.winner === 'blue')) ? 'happy' : 'neutral'
  return bridge.speak(text, { emotion, tag: 'end' })
}

/**
 * 礼物冠名播报（Wave 4.3）。让打赏者"被念到名字"——缺口：礼物召唤原本对桌宠**静默**
 * （index.js handleGift → spawnBatch → leaderboard，全程无 waifuAnnouncer）。
 * 不带 priority ⇒ 总能发出（waifu 播放"后一条停掉前一条"，故天然可压掉冷场闲聊）。
 */
function announceGift (info) {
  if (!bridge.ENABLED) return false
  const text = giftText(info)
  if (!text) return false
  return bridge.speak(text, { emotion: 'happy', tag: 'gift' })
}

/** 清理定时器（进程退出/测试收尾用）。 */
function stop () {
  if (_spawnTimer) { clearTimeout(_spawnTimer); _spawnTimer = null }
  _spawnEntries.length = 0
  if (_welcomeTimer) { clearTimeout(_welcomeTimer); _welcomeTimer = null }
  _welcomeEntries.length = 0
}

module.exports = {
  spawnText,
  roundStartText,
  roundEndText,
  giftText,
  welcomeText,
  announceSpawn,
  flushSpawn,
  announceWelcome,
  flushWelcome,
  announceRoundStart,
  announceRoundEnd,
  announceGift,
  stop,
  SPAWN_WINDOW_MS,
  WELCOME_WINDOW_MS,
  RULES_COOLDOWN_MS
}
