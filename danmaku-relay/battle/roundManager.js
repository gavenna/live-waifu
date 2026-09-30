/**
 * roundManager.js — 轮次状态机
 * IDLE → PREPARING → FIGHTING → ENDED → IDLE
 */
const EventEmitter = require('events')
// Which team slot counts as "red" -- single source of truth shared with
// liveSpawner / gameController. Red is now RED_TEAM (an AI player slot), not the
// human's team 0, so a hard-coded `team === 0` silently counts every spawn as blue.
const { RED_TEAM } = require('./teams')
const battleConfig = require('./battleConfig')

/**
 * 解析"单局时长上限"（毫秒）。优先级：
 *   ① 控制面板/存档（battleConfig.roundMaxMs，> 0 时）—— 面板存的规范单位就是毫秒
 *   ② RW_ROUND_MAX_MS 环境变量（无面板值时的 headless 默认）
 *   ③ 5 分钟内置兜底
 * ★ 每轮开局时**重新解析**（不是构造时定死）⇒ 面板改了下一轮即生效。
 */
function resolveMaxDurationMs () {
  let v = 0
  try { v = Number(battleConfig.effective().roundMaxMs) || 0 } catch (e) { v = 0 }
  if (v > 0) return v
  const env = parseInt(process.env.RW_ROUND_MAX_MS, 10)
  return (Number.isFinite(env) && env > 0) ? env : 5 * 60 * 1000
}

const STATES = {
  IDLE: 'IDLE',           // 等待开始
  PREPARING: 'PREPARING', // 选图+加载中
  FIGHTING: 'FIGHTING',   // 战斗进行中
  ENDED: 'ENDED'          // 战斗结束
}

class RoundManager extends EventEmitter {
  constructor () {
    super()
    this.state = STATES.IDLE
    this.roundNumber = 0
    this.roundStartTime = null
    // ⚠️ killCount 是**坏的**：全文件没有任何地方 +1。
    // 引擎侧也没有"查某队单位数/击杀数"的 Debug API（Debug.java 67 个 public 方法里没有）。
    // 真实战果只能从两处拿：① `debug.isTeamDefeated/isTeamWipedOut`（胜负，见 winWatch）
    // ② 游戏自己的结算面板（Game Time / Units Killed / Units Lost …，可用 RapidOCR 读窗口）。
    // 保留此字段只为兼容前端，**不要拿它当判据**。
    this.killCount = { red: 0, blue: 0 }
    this.spawnCount = { red: 0, blue: 0 }
    // 胜负（由 gameController.winWatch 轮询引擎标志写入）
    this.outcome = null
    this.currentMap = null
    this.roundTimer = null
    // 单局最大时长（兜底；正常应由引擎判胜 / 整队清零结束）。超时 = **平局**（播报"无胜负收场"），
    //   所以这个值直接决定直播节奏。来源见 resolveMaxDurationMs（面板 > env > 5 分钟）。
    //   ★ 2026-09-21：不再只靠 RW_ROUND_MAX_MS —— 控制面板可调，且 startRound 里会**再解析一次**。
    this.maxDurationMs = resolveMaxDurationMs()
  }

  /** 开始新一轮 */
  startRound (mapInfo) {
    if (this.state === STATES.FIGHTING) return false

    this.roundNumber++
    this.state = STATES.PREPARING
    this.currentMap = mapInfo
    this.killCount = { red: 0, blue: 0 }
    this.spawnCount = { red: 0, blue: 0 }
    this.outcome = null
    this.roundStartTime = Date.now()

    this.emit('preparing', { round: this.roundNumber, map: mapInfo })

    // 进入战斗状态
    this.state = STATES.FIGHTING
    this.emit('fighting', { round: this.roundNumber })

    // 超时自动结束（★ 每轮在此重新解析一次：控制面板改了下一轮即生效）
    this.maxDurationMs = resolveMaxDurationMs()
    if (this.roundTimer) clearTimeout(this.roundTimer)
    this.roundTimer = setTimeout(() => this.endRound('timeout'), this.maxDurationMs)

    return true
  }

  /** 记录一次生兵 */
  recordSpawn (team) {
    if (this.state !== STATES.FIGHTING) return
    if (team === RED_TEAM) this.spawnCount.red++
    else this.spawnCount.blue++
    this.emit('spawn', { team, counts: { ...this.spawnCount } })
  }

  /**
   * 记录胜负（由 gameController 的 winWatch 轮询 `debug.isTeamDefeated(t)` 得到）。
   * @param {{redDefeated:boolean, blueDefeated:boolean}} flags
   * @returns {string|null} 'red' | 'blue' | null（还没分出胜负）
   */
  setOutcome (flags) {
    if (!flags) return null
    let winner = null
    if (flags.blueDefeated && !flags.redDefeated) winner = 'red'
    else if (flags.redDefeated && !flags.blueDefeated) winner = 'blue'
    this.outcome = { ...flags, winner }
    return winner
  }

  /** 结束当前轮次 */
  endRound (reason) {
    if (this.state !== STATES.FIGHTING) return false

    if (this.roundTimer) { clearTimeout(this.roundTimer); this.roundTimer = null }
    this.state = STATES.ENDED
    const duration = Date.now() - this.roundStartTime

    this.emit('ended', {
      round: this.roundNumber,
      reason,
      duration,
      kills: { ...this.killCount },
      spawns: { ...this.spawnCount },
      outcome: this.outcome
    })

    // 3秒后回到 IDLE
    setTimeout(() => {
      this.state = STATES.IDLE
      this.emit('idle')
    }, 3000)

    return true
  }

  /** 获取当前快照 */
  snapshot () {
    return {
      state: this.state,
      round: this.roundNumber,
      map: this.currentMap,
      spawns: { ...this.spawnCount },
      // ⚠️ 恒为 0（引擎无击杀 API）；胜负看 outcome.winner
      kills: { ...this.killCount },
      outcome: this.outcome,
      winner: this.outcome ? this.outcome.winner : null,
      elapsed: this.roundStartTime ? Date.now() - this.roundStartTime : 0
    }
  }
}

module.exports = { RoundManager, STATES }