/**
 * battle/index.js — 弹幕对战系统入口
 * 整合轮次管理 + 地图池 + 实时生兵 + 游戏控制
 */
const { RoundManager, STATES } = require('./roundManager')
const mapPool = require('./mapPool')
const spawner = require('./liveSpawner')
const mapConfig = require('./mapConfig')
const gameCtrl = require('./gameController')
const battleConfig = require('./battleConfig')
const economy = require('./economy')
const giftTiers = require('./giftTiers')
const difficulty = require('./difficulty')
const { RED_TEAM, BLUE_TEAM, RED_VIEWER_TEAM, BLUE_VIEWER_TEAM, viewerTeamOf } = require('./teams')
const avatar = require('./avatar')
const leaderboard = require('./leaderboard')
const audience = require('./audience')
const waifuBridge = require('./waifuBridge')
const waifuAnnouncer = require('./waifuAnnouncer')
const waifuChat = require('./waifuChat')
const waifuDirector = require('./waifuDirector')
const logger = require('../logger')
const fs = require('fs')
const path = require('path')

const round = new RoundManager()
const GAME_DIR = gameCtrl.GAME_DIR

// ===== 游戏失联看门狗（game-loss watchdog）=====
// 背景（实机确认 2026-09-19）：战斗进行中游戏进程被静默终止后，winWatch 的 askEngine()
//   恒返回 null ⇒ 轮次永不结束，新一轮又被 FIGHTING 挡住；只能等 maxDurationMs 超时兜底
//   或人工调 /api/battle/end。看门狗在 FIGHTING 期间周期性探测「游戏链路是否活着」，
//   连续失联即强制结束本轮。
//
// 周期：RW_GAME_WATCHDOG_MS（默认 5000）。
// 迟滞：必须**连续** WATCHDOG_MISS_THRESHOLD(=2) 次判失联才结束 —— 单次抖动（不足 2 个周期
//   的瞬时断开）不得结束轮次；游戏活着时 probe 恒真 ⇒ 永不触发。
const WATCHDOG_INTERVAL_MS = (() => {
  const v = parseInt(process.env.RW_GAME_WATCHDOG_MS, 10)
  return Number.isFinite(v) && v > 0 ? v : 5000
})()
const WATCHDOG_MISS_THRESHOLD = 2

let watchdogTimer = null
let watchdogMisses = 0

/** 启动失联看门狗（幂等：重复调用先清掉旧定时器） */
function startGameWatchdog () {
  stopGameWatchdog()
  watchdogMisses = 0
  watchdogTimer = setInterval(() => {
    let alive = false
    try { alive = gameCtrl.isGameAlive() } catch (e) { alive = false }
    if (alive) { watchdogMisses = 0; return }
    watchdogMisses++
    if (watchdogMisses >= WATCHDOG_MISS_THRESHOLD) {
      stopGameWatchdog()
      logger.warn('[BATTLE] 游戏链路失联（进程/调试口）→ 本轮强制结束')
      round.endRound('game-lost')
      return
    }
    logger.warn(`[BATTLE] 游戏链路探测失联 ${watchdogMisses}/${WATCHDOG_MISS_THRESHOLD}（未达阈值，继续观察）`)
  }, WATCHDOG_INTERVAL_MS)
  if (watchdogTimer.unref) watchdogTimer.unref()
  logger.info(`[BATTLE] 游戏失联看门狗已启动（每 ${WATCHDOG_INTERVAL_MS}ms，连续 ${WATCHDOG_MISS_THRESHOLD} 次失联则强制结束本轮）`)
  return true
}

/** 停止失联看门狗（幂等）。轮次结束**必须**调用，以免留下定时器。 */
function stopGameWatchdog () {
  if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null }
  watchdogMisses = 0
  return true
}

// ===== 结束播报 =====
// 🔴 2026-09-19 接的线。用户实测提问：「一方基地都被摧毁了，为什么没有结束播报」。
//   根因是三段，全部有原文可查（详见 skill live-waifu-ops「播报链路整条是断的」）：
//     ① 引擎自己的公告走 `sendSystemMessage`，**只存在于联机服务器**，单机沙盒直接丢弃
//        （游戏 lastrun.log 原文：`cannot send sendSystemMessage:... was defeated (Team: B),
//         we are not a server`）⇒ 引擎这辈子不会在画面上喊这一嗓子；
//     ② 引擎的 Victory/Defeat 面板是**我们有意关掉的**（地图 type=skirmish + winCondition=none，
//        防止"没人操控的 team 0 被打光就整局判负"）；
//     ③ 本文件 `round.on('ended')` 过去**只写 logger** ⇒ 没有任何一处对观众播报。
//   用 `debug.showMessage()`（Debug.java:343）补上：2026-09-19 实机验证**能渲染、中文正常**
//   （`script debug.showMessage('【播报】蓝方获胜-第7轮213秒')` → 回 done，
//     截图 + RapidOCR 读回 `(x=34 y=111) 【播报】蓝方获胜-第7轮213秒`）。
//   ⚠️ 唯一可用通道就是它：中继只能**收**抖音弹幕、发不出去，OBS 叠加是另一条路（未做）。
function announce (text, tag) {
  try {
    // 脚本参数由手写迷你解析器按 '...' 整体取（ScriptEngine.processArg），
    // 因此文本里**不能**再出现单引号或反斜杠，且换行会被压成空格。
    const safe = String(text == null ? '' : text).replace(/[\\']/g, '').replace(/\s+/g, ' ').trim()
    if (!safe) return false
    const sent = spawner.sendCommand(`script debug.showMessage('${safe}')`)
    logger.info(`[BATTLE][播报]${tag ? '[' + tag + ']' : ''} ${safe} (sent=${sent})`)
    return sent
  } catch (e) {
    // 播报失败绝不影响轮次收尾
    logger.warn('[BATTLE][播报] 发送失败: ' + (e && e.message))
    return false
  }
}

/**
 * 播报文案（纯函数，便于离线验证）。
 * 有胜负 → `【播报】蓝方获胜！第7轮 213秒 · 红20兵 vs 蓝20兵`
 * 无胜负 → `【播报】无胜负收场（时间到）· 第7轮 300秒 · 红3兵 vs 蓝5兵`
 */
function buildEndText (r, reason, durSec, spawns, outcome) {
  const sp = spawns || {}
  const who = outcome && outcome.winner ? (outcome.winner === 'red' ? '红方获胜' : '蓝方获胜') : null
  const why = { 'game-lost': '游戏失联', timeout: '时间到', manual: '主播叫停',
    'engine-end': '引擎判胜' }[reason] || ''
  const tail = `第${r}轮 ${durSec}秒 · 红${sp.red || 0}兵 vs 蓝${sp.blue || 0}兵`
  return who ? `【播报】${who}！${tail}` : `【播报】无胜负收场${why ? '（' + why + '）' : ''} · ${tail}`
}

/**
 * 贡献榜前三播报文本（纯函数）。top3: [{name}] → `【战报】功勋榜 1.张三 2.李四 3.王五`；空数组 → ''。
 * 名字先净化（去单引号/反斜杠、压空白、截断）—— announce 会再净化一次，这里双保险。
 */
function buildTopText (top3) {
  if (!Array.isArray(top3) || top3.length === 0) return ''
  const names = top3.map((v, i) => {
    const nm = String((v && v.name) || '观众').replace(/[\\']/g, '').replace(/\s+/g, ' ').trim().slice(0, 12)
    return `${i + 1}.${nm || '观众'}`
  })
  return `【战报】功勋榜 ${names.join(' ')}`
}

/**
 * 开局玩法提示（纯函数，便于离线验证）。
 * 只求**画面一行**（短）——与 waifuAnnouncer.RULES_TEXT 区分：后者是给桌宠念的语音长文，
 * 塞进 debug.showMessage 会糊一屏。每轮开战（round.on('fighting')）播一次。
 */
function ruleHintText () {
  return '发「红3狂暴者」= 召唤3个狂暴者替你支持的阵营打仗'
}

// ===== 自动续局（"完全自动化"的核心一环）=====
// 为什么需要：roundManager 一轮结束只把状态回 IDLE，本文件过去没有任何地方再开下一局
//   （全项目 `startNewRound` 唯一调用点是 HTTP `/api/battle/start`）⇒ 每局打完就停在那等人点。
// 做法：轮次回到 IDLE 后等 `RW_AUTO_NEXT_MS`（默认 10000ms）自动开下一局；开局失败（如游戏
//   崩溃/正在重启）按固定间隔退避重试，最多 `AUTO_NEXT_MAX_RETRY` 次即停手——**避免死循环刷屏**。
//   `RW_AUTO_NEXT_MS=0` 整体关闭，回到"手动点开始"。
const AUTO_NEXT_MS = (() => {
  const v = parseInt(process.env.RW_AUTO_NEXT_MS, 10)
  return Number.isFinite(v) && v >= 0 ? v : 10000
})()
const AUTO_NEXT_RETRY_MS = (() => {
  const v = parseInt(process.env.RW_AUTO_NEXT_RETRY_MS, 10)
  return Number.isFinite(v) && v >= 0 ? v : 10000
})()
const AUTO_NEXT_MAX_RETRY = 5
let autoNextTimer = null
let autoNextRetries = 0

/** 停掉待执行的自动续局定时器（幂等）。 */
function stopAutoNext () {
  if (autoNextTimer) { clearTimeout(autoNextTimer); autoNextTimer = null }
  return true
}

/** 真正尝试开一局；失败按退避重试（带上限）。`start` 可注入（离线回归用桩）。 */
async function attemptNextRound (start) {
  autoNextTimer = null
  const opener = (typeof start === 'function') ? start : startNewRound
  try {
    const ok = await opener()
    if (ok) { autoNextRetries = 0; return true }
    throw new Error('startNewRound 返回 false')
  } catch (e) {
    autoNextRetries++
    logger.warn(`[BATTLE][auto] 自动开局失败（第 ${autoNextRetries} 次，最多重试 ${AUTO_NEXT_MAX_RETRY} 次）：${e && e.message}`)
    if (autoNextRetries <= AUTO_NEXT_MAX_RETRY) {
      autoNextTimer = setTimeout(() => attemptNextRound(opener), AUTO_NEXT_RETRY_MS)
      if (autoNextTimer.unref) autoNextTimer.unref()
    } else {
      logger.error('[BATTLE][auto] 自动开局连续失败，停止自动续局（可手动 POST /api/battle/start 恢复）')
    }
    return false
  }
}

/** 排一次"自动开下一局"。幂等（先清旧定时器），并重置重试计数。`startFn` 可注入（测试用）。 */
function scheduleNextRound (startFn) {
  stopAutoNext()
  autoNextRetries = 0
  if (!AUTO_NEXT_MS) { logger.info('[BATTLE][auto] 自动续局已关闭（RW_AUTO_NEXT_MS=0）'); return false }
  const opener = (typeof startFn === 'function') ? startFn : startNewRound
  logger.info(`[BATTLE][auto] ${AUTO_NEXT_MS}ms 后自动开下一局（RW_AUTO_NEXT_MS=0 可关）`)
  autoNextTimer = setTimeout(() => attemptNextRound(opener), AUTO_NEXT_MS)
  if (autoNextTimer.unref) autoNextTimer.unref()
  return true
}

// ===== 轮次事件监听 =====
round.on('preparing', ({ round: r, map }) => {
  logger.info(`[BATTLE] 第 ${r} 轮准备中 — ${map.name} (${map.formation})`)
})

round.on('fighting', ({ round: r }) => {
  logger.info(`[BATTLE] 第 ${r} 轮开战！观众发弹幕 "红/蓝+兵种" 参战`)
  // ★ 桌宠播报开战（游戏内文字照旧，这里只补 waifu 语音）
  waifuAnnouncer.announceRoundStart(r)
  // ★ 主播大脑：进入 LIVE，并刷新"最近有话说"（避免把刚开战误判成冷场）
  waifuDirector.noteFighting({ round: r })
  // ★ 2026-09-22：每轮开局在游戏画面留一行玩法提示（新观众不知道指令怎么写，见 ruleHintText）
  announce(ruleHintText(), 'rule')
  // 进入 FIGHTING → 启动游戏失联看门狗（见文件上方说明）
  startGameWatchdog()
  // ★ 完全自动化：启动「收局推手」（每 RW_PUSH_INTERVAL_MS 把两队主军推向敌方基地，
  //   尽量在 5 分钟时限内逼出胜负——超时为平局）。见 liveSpawner.js 的 pushOnce。
  spawner.startRoundPusher()
  // ★ 阵营级配额：本轮观众兵计数清零
  spawner.resetTeamSpawnCount()
  // 用引擎自己的胜负标志结束轮次（不再干等 10 分钟超时）
  gameCtrl.startWinWatch((flags) => {
    const winner = round.setOutcome(flags)
    logger.info(`[BATTLE] 引擎判定：${winner === 'red' ? '红方胜' : winner === 'blue' ? '蓝方胜' : '无结论'}`
      + `（redDefeated=${flags.redDefeated} blueDefeated=${flags.blueDefeated}）`)
    round.endRound(flags.redDefeated ? 'defeat:red' : 'defeat:blue')
  })
  // ★ 引擎判胜读数（end_live.txt，2026-09-19 注入新增）：**唯一**能同步「指挥中心被拆」结局的通道。
  //   为什么两条并存：isTeamDefeated 判"整队单位清零"，规则判的是"基地没了" —— 不同源。
  //   实测（2026-09-19 16:42）：面板已 Defeat! 而 isTeamDefeated 两队恒 false，中继只能等超时。
  //   优先级：两条谁先给出结论谁结束本轮；end 通道是"规则级"的，isTeamDefeated 是"团灭级"的兜底。
  gameCtrl.startEngineEndWatch(round.roundStartTime, (e) => {
    logger.info(`[BATTLE] 引擎判胜（${e.kind}）→ ${e.winner === 'red' ? '红方胜' : '蓝方胜'}`
      + `  文件=${e.file} firstSeen=${e.firstSeenMs}`)
    round.setOutcome(e.winner === 'red'
      ? { redDefeated: false, blueDefeated: true }
      : { redDefeated: true, blueDefeated: false })
    round.endRound('engine-end')
  })
  // 开局镜头：焦点 + 缩放（每轮开战重设，把观众视角对齐战场中心）
  const cam = gameCtrl.cameraTarget()
  const camOk = gameCtrl.setCamera(cam.x, cam.y, cam.zoom)
  logger.info(`[BATTLE][cam] 开局镜头 → 焦点(${cam.x}, ${cam.y}) 缩放${cam.zoom}${camOk ? '' : '（参数非法，跳过）'}`)
  // 观众代表单位：新对局里旧单位已消失 ⇒ 先清掉上一轮残留的名字/头像标签，再为已知观众重建（T7）
  spawner.dispatch('script debug.clearLabels()')
  spawner.dispatch('script debug.clearWall()')
  WALL_ADDED.clear()
  resetRepUnits()
  respawnKnownRepUnits()
  leaderboard.reset()   // 外置排行榜：榜单按轮清零（与观众单位同期）
  resetLikeChat()   // 点赞播报去重按轮清零（每个观众新一局可再念一次）
})

round.on('spawn', ({ team, counts }) => {
  // 可用于前端实时显示生兵计数
})

round.on('ended', ({ round: r, reason, duration, spawns, outcome }) => {
  // 轮次结束（手动 / 引擎判负 / 超时 / game-lost）→ 停掉自动开战、胜负轮询与失联看门狗，避免泄漏
  gameCtrl.stopAutoBattle()
  gameCtrl.stopWinWatch()
  gameCtrl.stopEngineEndWatch()
  stopGameWatchdog()
  // ★ 完全自动化：轮次结束停掉收局推手（与看门狗同一处启停，避免泄漏定时器）
  spawner.stopRoundPusher()
  const dur = Math.round(duration / 1000)
  const who = outcome && outcome.winner ? (outcome.winner === 'red' ? '红方胜' : '蓝方胜') : '无胜负'
  logger.info(`[BATTLE] 第 ${r} 轮结束 (${reason}) — ${dur}秒 | ${who} | 红方${spawns.red}兵 蓝方${spawns.blue}兵`)
  // ★ 对观众播报（引擎不播，中继自己喊 —— 见上方 announce() 的三段根因说明）
  announce(buildEndText(r, reason, dur, spawns, outcome), 'end')
  // ★ 结算露出：贡献榜前三（2026-09-27）。榜单每轮在 fighting 内清零，此处仍返回本轮数据。
  let top3 = []
  try { top3 = leaderboard.snapshot().viewers.slice(0, 3) } catch (e) { top3 = [] }
  setChampions(top3)   // ★ 荣誉：把前三记下，供下一轮头顶称号（纯展示）
  // ★ 累计榜：本轮前三各记一次「夺冠」（跨轮累计、落盘，让长期刷分的观众留在榜上）
  for (const v of top3) { try { leaderboard.recordWin(v.pid, v.name, v.team) } catch (e) { /* 不影响收尾 */ } }
  // ★ 羁绊图谱：把本轮荣誉写进跨场档案（"上局冠军是谁"回访有据）
  top3.forEach((v, i) => { if (v && v.pid && RANK_TITLES[i]) audience.recordTitle(v.pid, RANK_TITLES[i]) })
  const topText = buildTopText(top3)
  if (topText) announce(topText, 'top')
  // ★ 桌宠播报结束语（waifu 语音；与游戏内文字同步，互不影响）
  waifuAnnouncer.announceRoundEnd({ winner: outcome && outcome.winner, round: r, durSec: dur, top3 })
  // ★ 主播大脑：回 IDLE 并记住本轮结果/榜单（供暖场话术），同时刷新"最近有话说"
  waifuDirector.noteEnded({ winner: outcome && outcome.winner, round: r, durSec: dur, top3 })
  // 单轮覆盖只活一轮：本轮已结束 ⇒ 清掉 next，下一轮回到全局默认
  battleConfig.clearNext()
})

round.on('idle', () => {
  logger.info('[BATTLE] 回到待命状态')
  // ★ 完全自动化：回到 IDLE 即排下一局（RW_AUTO_NEXT_MS=0 关闭）
  scheduleNextRound()
})

// ===== 启动新一轮 =====
// 地图文件名可参数化：RW 用**文件名前缀 `[pN]`** 判定地图有几支队
// （appFramework/c.java:46-72 getNumberOfPlayersInMap，正则 `^ *\[([^\]]*)\].*`）。
// 我们的地图没有前缀 ⇒ 日志 `getNumberOfPlayersInMap: fail to match` + `Max teams on map = -1`
// ⇒ 引擎可能只认前两支队，第 3 队的指挥中心瓦片会被静默忽略（待实测）。
// ⚠️ 换图/改基地前必读（细节见 skill live-waifu-ops/references/economy-and-hud.md §P）：
//   当前地图 = `new_dire.tmx`：用户在游戏编辑器里摆的阵（源图每次另存为 "New ... Dire Straight ..."，
//   具体是哪个见 tools/map_adapt_newdire.py 顶部的 SRC）经 `tools/map_adapt_newdire.py` 适配而来 ——
//   蓝方 team0→team2、补 team_0..4_info/fog/winCondition，单位与地形逐字节保留。
//   **只读 `new_dire.tmx`，不要手改；用户换了新阵型就改工具里的 SRC 再重跑 apply。**
//   已验证通过的配置是：地图里只给 team 0 一个席位（team_0_info）、**不放** team 0 基地瓦片，
//   中继也**不在运行时种任何基地**。
//   别再"优化"它 —— 2026-09-19 因切图/加基地折腾出过开局 10 秒被判失联的回归。
//   ⚠️ 换图必须同步改 liveSpawner.js 的 SPAWN_AREAS（指挥中心坐标）/ PATROL_TARGETS 两组坐标。
//   本图 Ground/Items/set 三层与 live_dire **逐字节相同**（Ground md5 96ef1d59…），故这三组坐标
//   沿用即可（已用 5×5 邻域水域判定逐点复验 LAND-CLEAN）。live_dire / thermopylae 仍在 mods/maps/ 可切回。
// ⚠️ 2026-09-26 临时切换：原 'new_dire.tmx' 依赖 Moo's Defence Agency（该 mod 现缺失
//    → 地图加载抛 "Could not find custom unit of:cruiserShip" → 游戏崩、开局循环）。
//   暂用 Moo-free 版本（由 21 九月源图 map_adapt_newdire.py 适配而来，布局保留、兵种为原版）。
//   找回 Moo 的 .rwmod 放回 mods/units/ 后，把这里改回 'new_dire.tmx' 即恢复原阵型。
// ★ 2026-09-27：地图文件名改从地图契约读（map-config.json 的 map 字段）；缺文件回退旧值。
const MAP_FILE_DEFAULT = (mapConfig && mapConfig.map) || 'new_dire_nomoo.tmx'


async function startNewRound (mapFile) {
  const mapFile2 = mapFile || MAP_FILE_DEFAULT
  if (round.state === STATES.FIGHTING) {
    logger.warn('[BATTLE] 战斗进行中，无法开始新轮次')
    return false
  }

  // 1. 选地图 + 生成阵型
  const mapConfig = mapPool.pickMap()
  const formation = mapPool.generateFormation(mapConfig, 20)
  logger.info(`[BATTLE] 地图: ${mapConfig.name} | 阵型: ${formation.formationName} | 每方 ${formation.red.length} 兵 | 文件: ${mapFile2}`)

  // 2. 复制已知可用的地图到 assets 目录（live_battle.tmx 已验证可用）
  const gameDir = GAME_DIR
  const srcMap = path.join(gameDir, 'mods', 'maps', mapFile2)
  // ★★ 2026-09-18 实测坐实：引擎**实际加载**的是 assets\maps\skirmish\ 这一份
  //    （`Starting sandbox from map: maps/skirmish/...` 解析到 <GAME>\assets\ 下；
  //     而 assets\assets\maps\skirmish\ 那份从 9/13 起就没被引擎读过 —— 这正是历史上
  //     "改了地图却不生效 / team≥2 拿不到基地" 的真根因）。两份都写，前者才是关键。
  const dstDirs = [
    path.join(gameDir, 'assets', 'maps', 'skirmish'),          // ← 引擎真正读的
    path.join(gameDir, 'assets', 'assets', 'maps', 'skirmish') // 历史目录，保持同步避免混淆
  ]
  const mapPath = `maps/skirmish/${mapFile2}`
  if (fs.existsSync(srcMap)) {
    for (const dstDir of dstDirs) {
      if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true })
      fs.copyFileSync(srcMap, path.join(dstDir, mapFile2))
    }
    logger.info(`[BATTLE] 地图已复制到 assets 目录 (${mapFile2}) → ${dstDirs.length} 处（含引擎实际加载的 assets/maps/skirmish）`)

    // ★★ 2026-09-21：每轮写**不同**的 per-team AI 难度（一强一弱，随机决定谁强）。
    //   引擎的 per-team 难度只认地图 team_N_info 的 lockAiDifficulty（运行时无 setter），
    //   所以必须**每轮改写加载用的副本** —— 源图 mods/maps 不动，改写只落在 assets 副本上。
    //   见 battle/difficulty.js；RW_AI_DIFF_PAIR=0 可关闭。
    if (difficulty.ENABLED) {
      const pair = difficulty.pickPair()
      for (const dstDir of dstDirs) difficulty.patchMapFile(path.join(dstDir, mapFile2), pair)
      logger.info(`[BATTLE] 本轮 AI 难度（一强一弱）: 红=${pair.red} 蓝=${pair.blue}`
        + `（写进 assets 副本的 team_1_info/team_2_info.lockAiDifficulty）`)
    }
  }

  // 3. 启动游戏（如果没在跑）
  if (!gameCtrl.isRunning()) {
    logger.info('[BATTLE] 启动游戏...')
    const result = await gameCtrl.startGame()
    if (!result.ok) {
      logger.error('[BATTLE] 游戏启动失败: ' + (result.error || 'unknown'))
      return false
    }
    logger.info(result.reused
      ? '[BATTLE] 游戏实例已就绪（复用中，未重启进程）'
      : `[BATTLE] 游戏已启动 (PID: ${result.pid})`)
  }

  // 4. 加载地图
  logger.info('[BATTLE] 加载地图...')
  await gameCtrl.loadMap(mapPath)

  // 5. 开始轮次
  round.startRound(mapConfig)
  return true
}

// ===== 结束当前轮次 =====
function endCurrentRound (reason) {
  return round.endRound(reason || 'manual')
}

// ===== 无效指令的画面提示（失败可见化）=====
// 背景（2026-09-22 真机日志）：观众发 `4蜘蛛`（无红/蓝前缀）时 parseDanmaku 返回 null，
//   失败分支**只写 logger**、观众毫无感知 ⇒ 感知就是「发了没反应」。这里复用**唯一**画面通道
//   announce()（`script debug.showMessage`），给「看起来像指令但没解析出来」的弹幕一条格式示范。
// 冷却：按**全局**计（不按观众），防止一屋子人同时发错格式把画面刷爆。
//   RW_HINT_COOLDOWN_MS 可调；=0 表示条条都提示（调试用）；非法值回落 15000。
let _lastHintAt = 0
const HINT_COOLDOWN_MS = (() => {
  const v = parseInt(process.env.RW_HINT_COOLDOWN_MS, 10)
  return Number.isFinite(v) && v >= 0 ? v : 15000
})()

// ★ 点赞播报去重（2026-09-27）：每个观众**一局只让桌宠念一次**「感谢点赞」，防连赞每 1s 刷屏。
//   只抑制**播报**（maybeChat → 桌宠 TTS）；加余额（handleCredits）仍每次照算。每轮开局清空。
//   RW_LIKE_CHAT_ONCE=0 关闭（退回每次点赞都念）。
const _likeChatPids = new Set()
function resetLikeChat () { _likeChatPids.clear(); return true }
function likeChatOnce () { return String(process.env.RW_LIKE_CHAT_ONCE || '1') !== '0' }
/** 一个观众一局只让桌宠念一次「感谢点赞」：首次 true（并记账），重复 false；pid 空则放行（不记账）。 */
function likeChatAllowed (pid) {
  if (!pid) return true
  if (_likeChatPids.has(pid)) return false
  _likeChatPids.add(pid)
  return true
}
// 注意：announce() 会剥掉单引号/反斜杠（迷你脚本解析器按 '...' 整体取参），文本请勿依赖它们。
const FORMAT_HINT_TEXT = '格式不对哦：发「红3狂暴者」= 召唤3个狂暴者（带红/蓝）'

// ===== 处理弹幕 =====
function handleDanmaku (msg) {
  // ★ 方案 C 的 ②：观众发红/蓝弹幕即表态 —— 更新归属。
  //   放在对局状态判断**之前**：归属是跨轮的观众属性，不该只在开战时才记。
  //   即使这笔兵因冷却/缺钱没生出来，只要解析出了队伍就算表态。
  const raw = (msg && (msg.content || msg.text)) || ''
  const parsed = spawner.parseDanmaku(raw)
  if (parsed) {
    const pid = playerIdOf(msg)
    // 这条弹幕自带的昵称：换阵营重建要用它补名字（见 rememberTeam），否则会丢名
    const nm = (msg && (msg.nickname || msg.playerName)) || null
    rememberTeam(pid, parsed.team, nm)
    // 任何观众活动都"确保有代表单位"——不只进房。否则中继重启后（内存名单清空）
    // 老观众不重新进房就永远没有代表单位（用户实测踩到的正是这个）。
    spawnRepUnit(pid, nm, parsed.team)
  }

  // 非指令弹幕（闲聊/问好）→ 观众对话；与战斗状态无关（冷读由 waifuChat 冷却控制）
  if (!parsed) {
    if (raw.trim()) {
      // 🔴 2026-09-19：解析失败以前**完全静默**。这里留一行可 grep 的痕迹，
      //    并交给对话引擎（waifuChat 未配 key 时静默，不报错）。
      logger.info(`[DANMAKU] 未识别（不生兵）: "${raw}"`)
      // ★ 失败可见化（2026-09-22）：只对「像指令」的弹幕提示格式，闲聊不打扰；全局冷却防刷屏。
      if (spawner.looksLikeCommand(raw)) {
        const now = Date.now()
        if (now - _lastHintAt >= HINT_COOLDOWN_MS) {
          _lastHintAt = now
          announce(FORMAT_HINT_TEXT, 'hint')
        }
      }
      // ★ 点赞播报去重：一个观众一局只让桌宠念一次「感谢点赞」（连赞会每 1s 触发一次）。
      if (msg && msg.source === 'like' && likeChatOnce() && !likeChatAllowed(playerIdOf(msg))) return null
      // ★ 重复关注「闭嘴」：窗口内再次关注 → 不播报感谢（防有人靠取关再关注刷桌宠语音）
      if (msg && msg.source === 'follow' && followOnceEnabled() && followOnCooldown(playerIdOf(msg))) return null
      maybeChat(msg, raw)
    }
    return null
  }

  // 只在战斗状态处理生兵
  if (round.state !== STATES.FIGHTING) return null

  const result = spawner.handleDanmaku(msg)
  if (result && result.success) {
    // 一条弹幕可以带多兵（"红3战车"），所以按**单位数**计数，不按消息数
    for (let i = 0; i < (result.count || 1); i++) round.recordSpawn(result.team)
    const e = result.economy
    // 外置排行榜：累计该观众的召唤数/花费（与游戏解耦，经 /api/leaderboard 暴露）
    leaderboard.recordSpawn(playerIdOf(msg), (msg && (msg.nickname || msg.playerName)) || null, result.team, result.count, e && e.spent)
    // ★ 观众羁绊图谱：同一笔召唤也写入跨场档案（落盘，供"认得老观众/战绩"）
    audience.recordSpawn(playerIdOf(msg), (msg && (msg.nickname || msg.playerName)) || null, result.team, result.count, e && e.spent)
    const money = (e && e.spent) ? ` 花费 ${e.spent} → 余额 ${e.balanceAfter}(+${e.income}/s)` : ''
    logger.info(`[SPAWN] ${result.teamName} ${result.unitType} x${result.count || 1} (${result.zone || 'base'}) @ (${result.position.x},${result.position.y})${money}`)
    // ★ 桌宠播报（合并窗口，见 waifuAnnouncer；unitDisplayName 把英文类型名转回中文）
    waifuAnnouncer.announceSpawn({
      teamName: result.teamName,
      unitName: spawner.unitDisplayName(result.unitType),
      count: result.count || 1
    })
    waifuDirector.noteSpeech()   // ★ 主播大脑：刚播过生兵，别判成冷场
  } else if (result && result.economy && (result.economy.insufficient || result.economy.ready === false)) {
    // ★ 2026-09-19：引擎真实经济 —— 钱不够就**不生成单位**，并在游戏画面上喊一嗓子
    const e = result.economy
    const who = result.teamName || ('team' + result.team)
    const text = e.insufficient
      ? `【经济】${who}余额不足 需要${e.need} 现有${e.balance}`
      : `【经济】${who}召唤失败 ${result.reason}`
    announce(text, 'econ')
    logger.info(`[ECON] 拒绝召唤 ${who} ${result.unitType} x${result.count || 1}: ${result.reason} (need=${e.need || '-'} balance=${e.balance != null ? e.balance : '-'})`)
  }
  return result
}

// ===== 观众对话（非指令弹幕 → 桌宠回复）=====
// 与 waifuChat 配合：配了 LLM key → 智能回复；没配 → 静默（见 waifuChat.reply）。
// 战场上下文一并交给 LLM，让回复贴合当前战况。
function battleContext () {
  if (round.state === STATES.FIGHTING) return `第${round.round}轮战斗中`
  return '当前不在战斗中'
}

function maybeChat (msg, raw) {
  if (!waifuChat.isEnabled()) return
  const text = String(raw || '').trim()
  if (!text) return
  const nickname = (msg && (msg.nickname || msg.playerName || msg.userId)) || ''
  waifuChat.reply({ text, nickname, context: battleContext() })
    .then((r) => {
      if (r && r.text) { waifuBridge.speak(r.text, { emotion: r.emotion || 'happy', tag: 'chat' }); waifuDirector.noteSpeech() }
    })
    .catch((e) => logger.warn('[WAIFU][chat] 异常: ' + (e && e.message)))
}

// ===== 观众阵营归属（谁支持哪一队）=====
// 为什么需要：点赞/关注**不带方向**。要让互动奖励有意义，必须先知道"这个观众站哪边"。
// 归属来源两条（方案 C）：
//   ① 进房（适配器 _enter 产出 {type:'join', team:'red'|'blue'}）→ 首次露面给一个初始队；
//   ② 观众发红/蓝弹幕表态（"红5战车"）→ 更新归属。
// ⚠️ 只驻内存：中继重启后丢失，老观众要重新表态（或在直播间重进一次）才恢复。
const playerTeams = new Map()   // playerId -> RED_TEAM | BLUE_TEAM
const playerNames = new Map()   // playerId -> 昵称（跨轮重建代表单位时补名字用）

/** 从消息里取观众标识（与 liveSpawner 的生兵冷却键取法保持一致）。 */
function playerIdOf (msg) {
  if (!msg) return null
  return msg.userId || msg.playerId || msg.nickname || msg.playerName || null
}

/** 记住/更新某观众的阵营；team 必须是 RED_TEAM / BLUE_TEAM，否则忽略。 */
function rememberTeam (playerId, team, name) {
  if (!playerId) return false
  if (team !== RED_TEAM && team !== BLUE_TEAM) return false
  const had = playerTeams.get(playerId)
  playerTeams.set(playerId, team)
  // ★ 记住最新昵称：换阵营重建（本函数内 spawnRepUnit）与跨轮重建（respawnKnownRepUnits）
  //   都要用它补名字。以前只在「进房」时记 ⇒ 发弹幕表态的观众（或中继重启后没重新进房的老观众）
  //   在换阵营时 playerNames 缺记录 → 名字传成 null → 名字丢失（用户实测现象）。
  if (name) playerNames.set(playerId, name)
  if (had !== team) {
    logger.info(`[TEAM] 观众 ${playerId} 归属 → ${team === RED_TEAM ? '红方' : '蓝方'}`
      + (had ? `（原${had === RED_TEAM ? '红' : '蓝'}）` : ''))
    // 换阵营（had 非空且不同）：删掉旧阵营的代表单位，再在新阵营重建（T5）
    if (had) {
      const key = String(playerId).replace(/[^0-9A-Za-z_]/g, '')
      spawner.dispatch(`script debug.removeRep('${key}')`)
      REP_UNITS.delete(playerId)
      spawnRepUnit(playerId, name || playerNames.get(playerId) || null, team)
    }
  }
  return true
}

/**
 * 进房 → 给一个初始队（方案 C 的 ①），并让桌宠**念名字欢迎**。
 * 归属规则：已有归属**不覆盖**（观众重进房不该被改队）。
 * 欢迎规则：**每次进房都欢迎**，不论此前是否已编过队。
 */
// ===== 观众代表单位（T7）：进房 → 基地旁造一个"代表单位" + 头顶名字 + 真实头像 =====
// · 单位落无 AI 宿主队（viewer team），不会被本队 AI 指挥、不乱跑 ⇒ 名字/头像与单位对齐。
// · 名字走注入的 debug.addLabel(名, 世界x, 世界y)；头像走 debug.addAvatar(png路径, x, y)。
// · 头像来源 battle/avatar.js（抖音 uid → 40x40 PNG）。跨轮：单位随旧对局消失，故每轮 fighting 重建。
// · 观众不换阵营 = pid→队 的记忆不变（playerTeams），本表只管"这一轮建了没"。
const REP_UNITS = new Map()   // pid -> { team, x, y, name }
const REP_MAX = (() => { const v = parseInt(process.env.RW_REP_MAX, 10); return Number.isFinite(v) && v > 0 ? v : 24 })()
// 多观众呈现：网格排布（3排×8列）+ 缩小头像，避免几十个头像糊成一团（见演示 multi16/multi24b）
const REP_GRID_COLS = 8
const REP_GRID_DX = 54
const REP_GRID_DY = 46
const REP_AVATAR_SIZE = (() => { const v = parseInt(process.env.RW_REP_AVATAR_SIZE, 10); return Number.isFinite(v) && v > 0 ? v : 26 })()
// 皇冠徽章像素尺寸（与 toolbox/badge_champion.png 一致：20×18）——贴头像正上方时用来居中/定位
const REP_BADGE_W = 20
const REP_BADGE_H = 18
const REP_UNIT_TYPE = process.env.RW_REP_UNIT || 'viewer_king'
const REP_ENABLED = String(process.env.RW_REP_ENABLED || '1') === '1'

/** 从 playerId（douyin_<uid>）取抖音数字 uid；取不到 null。 */
function douyinUidOf (pid) {
  const m = /^douyin_(\d+)$/.exec(String(pid || ''))
  return m ? m[1] : null
}

// 观众墙去重（T8）：墙上**每个观众只留一个头像**。
// 为什么需要：注入侧的 removeRep(key) 只清世界坐标的名字/头像（LABELS/PLACED）+ 杀单位，
//   **不碰 WALL**（WALL 只存图片路径、无 key，也没有按 key 删墙的接口）。换阵营时会 removeRep 删旧
//   + 重新 spawnRepUnit ⇒ 新 spawn 又 addWall 一次，同一头像在墙上出现两份。
//   这里按 pid 记账，同一轮内每个观众最多 addWall 一次；每轮开局随 clearWall 一起清空。
const WALL_ADDED = new Set()
function addWallOnce (pid, png) {
  if (!pid || !png) return
  if (WALL_ADDED.has(pid)) {
    // 换阵营重 spawn 会走到这里：同一观众，跳过重复入墙（这正是「墙上多一个」被修掉的点）
    logger.info(`[WALL] ${pid} 已在墙(${WALL_ADDED.size})，跳过重复 addWall`)
    return
  }
  WALL_ADDED.add(pid)
  spawner.dispatch(`script debug.addWall('${png.replace(/\\/g, '/')}')`)
  logger.info(`[WALL] ${pid} 入墙，墙共 ${WALL_ADDED.size} 个`)
}

/** 观众代表单位的网格锚点：优先用地图契约的 viewerAnchors（= 地图里的 viewer_king 坐标，主播摆的基准）；
 *  缺 map-config 时回退本队指挥中心（SPAWN_AREAS 中点，旧行为）。 */
function repAnchor (team) {
  const key = team === RED_TEAM ? 'red' : 'blue'
  if (mapConfig && mapConfig.viewerAnchors && mapConfig.viewerAnchors[key]) return mapConfig.viewerAnchors[key]
  const area = spawner.SPAWN_AREAS[team] || spawner.SPAWN_AREAS[RED_TEAM]
  return { x: Math.round((area.xMin + area.xMax) / 2), y: Math.round((area.yMin + area.yMax) / 2) }
}

// ===== 荣誉（2026-09-27）：贡献榜前三 → 下一轮头顶称号（**纯展示，不加战力**） =====
// 上一轮结算时记下前三（pid→称号），下一轮重建代表单位时把称号当前缀画到名字上。
// 榜单按轮清零，故称号只活一轮，下一轮结算自动覆盖。开关 RW_CHAMPION_AWARD=0 关闭。
const RANK_TITLES = ['冠军', '亚军', '季军']
let lastChampions = new Map()   // pid -> '冠军'|'亚军'|'季军'
function championAwardEnabled () { return String(process.env.RW_CHAMPION_AWARD || '1') !== '0' }
function championTitleOf (pid) { return championAwardEnabled() ? (lastChampions.get(pid) || '') : '' }
function setChampions (top3) {
  lastChampions = new Map()
  if (Array.isArray(top3)) top3.forEach((v, i) => { if (v && v.pid && RANK_TITLES[i]) lastChampions.set(v.pid, RANK_TITLES[i]) })
  return lastChampions.size
}
/** 代表单位头顶标签文本（纯函数）：冠军加【称号】前缀；无称号回退净化后的裸名。 */
function repLabelText (pid, name) {
  const safe = String(name || '').replace(/[\\']/g, '').replace(/\s+/g, ' ').trim().slice(0, 12)
  const title = championTitleOf(pid)
  return title ? `【${title}】${safe}` : safe
}
/** 冠军徽章贴图路径（纯展示）。RW_CHAMPION_BADGE=0 关闭。 */
function championBadgePath () { return path.join(__dirname, '..', 'toolbox', 'badge_champion.png') }
function championBadgeEnabled () { return String(process.env.RW_CHAMPION_BADGE || '1') !== '0' }

/** 给一个观众造代表单位 + 名字 + 头像。幂等（同一 pid 每轮只建一次）。失败静默。 */
function spawnRepUnit (pid, name, team) {
  try {
    if (!REP_ENABLED || !pid || round.state !== STATES.FIGHTING) return null
    if (REP_UNITS.has(pid)) return REP_UNITS.get(pid)
    // 超上限（战场单位已满）：**仍加入观众墙**（墙存在的意义就是承载所有人），但不建战场单位
    if (REP_UNITS.size >= REP_MAX) {
      const uidW = douyinUidOf(pid)
      if (uidW) avatar.fetchAvatarPng(uidW, null, REP_AVATAR_SIZE).then((png) => {
        addWallOnce(pid, png)
      }).catch(() => {})
      REP_UNITS.set(pid, { team, capped: true })
      return null
    }
    const anchor = repAnchor(team)
    const n = REP_UNITS.size
    // ★ 网格排布：以「观众基准」为锚（map-config.viewerAnchors = 地图里的 viewer_king），向上铺 3 排×8 列。
    //   ★ 2026-09-27：间距按**镜头缩放**放大 —— 头像/皇冠是屏幕固定像素（头像 26px），
    //   若世界间距固定，缩小视图（全景 zoom≈0.4）下相邻观众屏幕间距只有 ~21px ⇒ 头像互相重叠糊成一片。
    //   令「屏幕间距」恒定：世界间距 = 期望屏幕间距 ÷ zoom（zoom≥1 时不放大，与旧值一致）。
    const _cam = (() => { try { return gameCtrl.cameraTarget() } catch (e) { return { x: 0, zoom: 1 } } })()
    const _z = _cam.zoom
    const gscale = (_z > 0 && _z < 1) ? (1 / _z) : 1
    const gdx = Math.round(REP_GRID_DX * gscale)
    const gdy = Math.round(REP_GRID_DY * gscale)
    const ccx = anchor.x
    const ccy = anchor.y
    const col = n % REP_GRID_COLS
    const row = Math.floor(n / REP_GRID_COLS)
    // ★ 朝**开局视野中心**铺：锚点在画面右侧（红 3860 > 中心 2285）就向左铺，在左侧（蓝 740）就向右铺
    //   —— 否则整排往视野外延伸，开局视角下后半截跑出画面看不见。
    const dir = (ccx < _cam.x) ? 1 : -1
    const x = Math.round(ccx + dir * col * gdx)
    const y = Math.round(ccy + row * gdy)
    const vTeam = team === RED_TEAM ? RED_VIEWER_TEAM : BLUE_VIEWER_TEAM
    const repKey = String(pid).replace(/[^0-9A-Za-z_]/g, '')
    // spawnRep：注入侧 createUnit 并**用 key 记住单位 id**，供换阵营时 removeRep(key) 精确删除
    spawner.dispatch(`script debug.spawnRep('${REP_UNIT_TYPE}', ${x}.0, ${y}.0, ${vTeam}, '${repKey}')`)
    const safe = String(name || '').replace(/[\\']/g, '').replace(/\s+/g, ' ').trim().slice(0, 12)
    const labelName = repLabelText(pid, name)   // ★ 冠军加【称号】前缀（纯展示）
    // 名字画在单位**正上方**（world 单位=像素；-76 让文字浮在头像之上，-18 略居中）
      const avX = x - Math.round(REP_AVATAR_SIZE / 2)
      const avY = y - (REP_AVATAR_SIZE + 18)
      // 冠军有皇冠 → 名字再上移，给皇冠腾位（皇冠贴头像**正上方**）
      const hasBadge = championBadgeEnabled() && championTitleOf(pid) === '冠军'
      // ★ 皇冠与头像的屏幕间距（可配 battleConfig.crownOffset）：调大=皇冠更靠上。
      //   折算成世界间距要 ÷zoom ⇒ 任何缩放下屏幕观感一致。
      const crownGapScreen = (() => { const v = Number(battleConfig.effective().crownOffset); return Number.isFinite(v) ? v : 30 })()
      const crownWorldGap = Math.round((crownGapScreen + REP_BADGE_H) / Math.max(0.2, _z))
      const nmY = y - (REP_AVATAR_SIZE + 46 + (hasBadge ? crownWorldGap + 4 : 0))
      // ★ 2026-09-27：仅当镜头足够近时才贴名字 —— 缩小的全景视图下多标签会挤成一团（实机已复现）。
      //   闸门 = 本轮开局镜头缩放 cameraTarget().zoom ≥ RW_REP_LABEL_MIN_ZOOM（默认 1.0）。
      //   全景视图（默认 zoom≈0.58）⇒ 不贴名，荣誉改由 OBS 榜单承载；近景（zoom≥1）才贴名。
      const camZoom = _z   // 复用上面已取的镜头缩放（同一轮内恒定）
      const labelMinZoom = (() => { const v = parseFloat(process.env.RW_REP_LABEL_MIN_ZOOM); return Number.isFinite(v) ? v : 1.0 })()
      if (labelName && camZoom >= labelMinZoom) spawner.dispatch(`script debug.addLabel('${labelName}', ${x - 18}.0, ${nmY}.0, '${repKey}')`)
      // ★ 荣誉徽章（纯展示）：冠军皇冠贴**头像正上方（居中）**——
      //   2026-09-27 用户实测：贴右侧时缩小后会与相邻头像重叠，故改到正上方。RW_CHAMPION_BADGE=0 关闭。
      if (hasBadge) {
        const badgePng = championBadgePath().replace(/\\/g, '/')
        const badgeX = x - Math.round(REP_BADGE_W / 2)
        const badgeY = avY - crownWorldGap
        if (fs.existsSync(badgePng)) spawner.dispatch(`script debug.addAvatar('${badgePng}', ${badgeX}.0, ${badgeY}.0, '${repKey}_b')`)
      }
      const rec = { team, x, y, name: safe }
      REP_UNITS.set(pid, rec)
      const uid = douyinUidOf(pid)
      if (uid) {
        avatar.fetchAvatarPng(uid, null, REP_AVATAR_SIZE).then((png) => {
          if (png && REP_UNITS.has(pid)) {
            // 头像画在单位正上方（尺寸随 REP_AVATAR_SIZE 自适应，避免多人糊屏）
          spawner.dispatch(`script debug.addAvatar('${png.replace(/\\/g, '/')}', ${avX}.0, ${avY}.0, '${repKey}')`)
          // 观众墙 HUD：同一张头像也进屏幕角落的墙（承载几十人）
          // 去重：换阵营时 removeRep 不清墙，若这里直接 addWall 会让同一头像在墙上出现两份
          addWallOnce(pid, png)
          rec.png = png
          }
        }).catch(() => {})
      }
    logger.info(`[REP] ${name} → ${team === RED_TEAM ? '红方' : '蓝方'} 代表单位 @ (${x},${y})${uid ? ' (+头像)' : ''}`)
    return rec
  } catch (e) { logger.warn('[REP] 建代表单位失败: ' + (e && e.message)); return null }
}

/** 新一轮开始：清掉上一轮的单位记忆（旧对局的单位已随对局消失）。 */
function resetRepUnits () { REP_UNITS.clear() }

/** 新一轮开始后，为已知归属的观众重建代表单位（受 REP_MAX 限制）。 */
function respawnKnownRepUnits () {
  let n = 0
  for (const [pid, team] of playerTeams) {
    if (n >= REP_MAX) break
    spawnRepUnit(pid, playerNames.get(pid) || null, team)
    n++
  }
}

function handleJoin (msg) {
  if (!msg || msg.type !== 'join') return null
  const pid = playerIdOf(msg)
  if (!pid) return null
  const name = msg.playerName || msg.nickname || pid
  if (name) playerNames.set(pid, name)   // 记住昵称，供跨轮重建代表单位时补名字
  audience.touch(pid, name)              // ★ 羁绊图谱：进房即登记（跨场持久）

  // 🔴 2026-09-20 用户实测缺陷修复：旧写法把 announceWelcome 放在下面的"新归属"分支里，
  //   已有归属的 pid 会在这里提前 return ⇒ **老观众再进房完全静默**（日志只有适配器的
  //   「XX 进房」一行，没有任何欢迎）。现在两条分支都欢迎。
  if (playerTeams.has(pid)) {
    const kept = playerTeams.get(pid)
    waifuAnnouncer.announceWelcome(name, kept === RED_TEAM ? '红方' : '蓝方')
    waifuDirector.noteSpeech()
    spawnRepUnit(pid, name, kept)
    return { ok: true, kept: true, team: kept }
  }

  const team = msg.team === 'blue' ? BLUE_TEAM
    : msg.team === 'red' ? RED_TEAM
      : (Math.random() < 0.5 ? RED_TEAM : BLUE_TEAM)
  rememberTeam(pid, team, name)
  // 桌宠欢迎：念名字 + 阵营（waifuAnnouncer 里有合并窗口防刷屏 + 规则介绍节流）
  waifuAnnouncer.announceWelcome(name, team === RED_TEAM ? '红方' : '蓝方')
  waifuDirector.noteSpeech()
  spawnRepUnit(pid, name, team)
  return { ok: true, kept: false, team }
}

// ===== 观众互动奖励（点赞 / 关注 → 给某队加余额）=====
// 消息由适配器产出：{ type:'credits', source:'like'|'follow', playerId, playerName }
//   适配器只翻译事件，不做业务决策（见 danmaku/douyin.js 的 _like / _follow）。
// 金额来自 battleConfig（likeCredits / followCredits，控制面板可配）；
// 归哪队 = 该观众的**归属**（方案 C）；只有尚无归属才回退随机 —— 多数只发生在还没表过态的新观众身上。
// 只在对局中生效；金额为 0 视为关闭（静默，不打日志噪音）。
// ★ 关注去重（2026-09-27 改版）：由「整场只一次」改为**时间窗** ——
//   同一人 followWindowMin 分钟内重复关注只算一次；**超过窗口就算新的一次**（取关后再关注能再拿）。
//   0 = 只算第一次（严格去重）；RW_FOLLOW_WINDOW_MS 覆盖；RW_FOLLOW_ONCE=0 完全关闭去重（每个都给）。
function followOnceEnabled () { return String(process.env.RW_FOLLOW_ONCE || '1') !== '0' }
function followWindowMs () {
  const env = parseInt(process.env.RW_FOLLOW_WINDOW_MS, 10)
  if (Number.isFinite(env) && env >= 0) return env
  let min = 60
  try { const v = Number(battleConfig.effective().followWindowMin); if (Number.isFinite(v) && v >= 0) min = v } catch (e) { /* 配置读不到用默认 */ }
  return min * 60000
}
const _followRewarded = new Map()   // pid -> 上次发奖时间戳（毫秒）
/**
 * **只读探询**：该观众是否处在关注窗口内（重复关注）。不记账 —— 供「重复关注别播报」用：
 * 播报（danmaku）先到、发奖（credits）后到，若探询也记账，后到的发奖会被误判成重复。
 */
function followOnCooldown (pid, now) {
  if (!pid) return false
  const last = _followRewarded.get(pid) || 0
  if (!last) return false
  const t = Number.isFinite(now) ? now : Date.now()
  const win = followWindowMs()
  return win === 0 || (t - last) < win
}
/** 这次关注该不该发奖？窗口内重复 → false；否则 true 并记时。windowMs=0 ⇒ 只算第一次。 */
function followAllowed (pid, now) {
  if (!pid) return true
  if (followOnCooldown(pid, now)) return false
  _followRewarded.set(pid, Number.isFinite(now) ? now : Date.now())
  return true
}

function pickRewardTeam (playerId) {
  const known = playerId ? playerTeams.get(playerId) : null
  if (known === RED_TEAM || known === BLUE_TEAM) return { team: known, by: 'affiliation' }
  return { team: Math.random() < 0.5 ? RED_TEAM : BLUE_TEAM, by: 'random' }
}

/**
 * 结算一次观众互动（点赞 / 关注）。
 * @param {{type:'credits', source:'like'|'follow', playerId?:string, playerName?:string}} msg
 * @returns {{credited:boolean,sent:boolean,cmd?:string,amount?:number}|{ok:boolean,reason:string}|null}
 */
function handleCredits (msg) {
  if (!msg || msg.type !== 'credits') return null
  if (round.state !== STATES.FIGHTING) return null   // 只在对局中加余额
  const pid = playerIdOf(msg)
  // ★ 关注去重（时间窗）：窗口内重复关注只算一次，超过窗口算新的
  if (msg.source === 'follow' && followOnceEnabled() && !followAllowed(pid)) {
    return { ok: false, reason: 'follow-cooldown' }
  }
  const cfg = battleConfig.effective()
  let amount
  if (msg.source === 'follow') {
    amount = cfg.followCredits
  } else {
    // ★ 点赞量化：基础额 + (连赞数-1)×每赞加成，单次封顶（likeCap=0 不封顶）
    const n = Math.max(1, Number(msg.count) || 1)
    amount = cfg.likeCredits + (n - 1) * (cfg.likePerExtra || 0)
    if (cfg.likeCap) amount = Math.min(amount, cfg.likeCap)
  }
  if (!amount) return { ok: false, reason: 'amount-zero' }  // 0 = 关闭，静默
  const pick = pickRewardTeam(pid)
  const team = pick.team                    // 阵营（红1/蓝2）：日志与榜单归属用
  // ★ 分账：观众充的钱进**观众宿主队**（红3/蓝4），不落 AI 主队 —— AI 花不到观众的钱。
  //   walletMode='shared' 回退旧行为（加 AI 主队）。
  const walletTeam = (battleConfig.walletMode() === 'shared') ? team : viewerTeamOf(team)
  const r = economy.credit(walletTeam, amount, spawner.dispatch)
  // 外置排行榜：累计点赞/关注
  leaderboard.recordCredits(pid, msg.playerName, team, msg.source)
  audience.recordCredits(pid, msg.playerName, team, msg.source)   // ★ 羁绊图谱同步
  logger.info(`[CREDITS] ${msg.source === 'follow' ? '关注' : '点赞'} `
    + `${msg.playerName || msg.playerId || ''} → ${team === RED_TEAM ? '红方' : '蓝方'} `
    + `+${amount}${msg.source === 'like' ? '(连赞' + Math.max(1, Number(msg.count) || 1) + ')' : ''} (${pick.by}) (sent=${r.sent})`)
  return r
}

// ===== 送礼 → 加余额 / 专属召唤 =====
// 消息由适配器产出：{ type:'gift', coinValue, coinUnit:'diamond'|'gold', giftName, count, playerId, playerName }
//   ★ 2026-10 行为变更（主播规则）：礼物**不再按价位分档召唤兵**。
//     ① 默认：按礼物价值给该观众**归属阵营**的观众钱包**加余额**（1 抖币 = 50W，见 giftTiers.CREDITS_PER_COIN）。
//        「小心心」落在这条上：1 抖币 → +50W；连刷 10 颗（10 抖币）→ +500W。兵由观众自己发弹幕换。
//     ② 例外：**「闪耀星辰」** 直接召唤 1 个执行者（Ek星舰，清图王牌）——目前唯一"礼物召唤兵种"。
//   加余额落**观众钱包**（红3/蓝4，与点赞/关注同口径，AI 花不到）；召唤投该观众归属队、落自家基地旁
//   + 巡逻令向敌方基地（走 spawner.spawnBatch，与弹幕召唤同一套语义）。
//   无币值（coinValue<=0，如"关注奖励兵"）且非专属召唤时不结算（那些由 credits 事件单独处理）。
function handleGift (msg) {
  if (!msg || msg.type !== 'gift') return null
  if (round.state !== STATES.FIGHTING) return null     // 只在对局中结算
  const pid = playerIdOf(msg)
  const pick = pickRewardTeam(pid)
  const team = pick.team
  const teamName = team === RED_TEAM ? '红方' : '蓝方'

  // ★ 专属召唤（按礼物名匹配，先于币值判定）：目前只有「闪耀星辰」→ 1 个执行者。
  const named = giftTiers.unitOfGiftName(msg.giftName)
  if (named) {
    const r = spawner.spawnBatch({ team, unitType: named.unit, count: named.count, zone: 'base' })
    leaderboard.recordSpawn(pid, msg.playerName, team, named.count, 0)
    audience.recordSpawn(pid, msg.playerName, team, named.count, 0)
    logger.info(`[GIFT] ${msg.giftName || '专属礼物'} ${msg.playerName || pid || ''} `
      + `→ ${teamName} 召唤 ${named.unit} x${named.count} (${pick.by})`)
    waifuAnnouncer.announceGift({
      name: msg.playerName || msg.nickname || null,
      giftName: msg.giftName || null,
      teamName,
      unitName: spawner.unitDisplayName(named.unit),
      count: named.count
    })
    waifuDirector.noteSpeech()
    return { ok: true, kind: 'summon', team, unitType: named.unit, count: named.count, positions: r.positions }
  }

  // ① 默认：按礼物价值给该阵营的**观众钱包**加余额（1 抖币 = 50W）。
  const coins = giftTiers.coinsOf(msg)
  if (coins <= 0) return { ok: false, reason: 'no-coin' }
  const amount = giftTiers.creditsFor(coins)
  const walletTeam = (battleConfig.walletMode() === 'shared') ? team : viewerTeamOf(team)
  const r = economy.credit(walletTeam, amount, spawner.dispatch)
  logger.info(`[GIFT] ${msg.giftName || '礼物'} ${msg.playerName || pid || ''} `
    + `→ ${teamName} 余额 +${amount}（${coins}抖币当量）(${pick.by}) (sent=${r.sent})`)
  // ★ 礼物冠名播报（Wave 4.3）：让打赏者"被念到名字"——礼物原本对桌宠静默，观众花了钱看不到名字。
  waifuAnnouncer.announceGift({
    name: msg.playerName || msg.nickname || null,
    giftName: msg.giftName || null,
    teamName,
    credits: amount,
    count: giftTiers.giftCountOf(msg)
  })
  waifuDirector.noteSpeech()
  return { ok: true, kind: 'credits', team, amount, coins, sent: r.sent }
}

/** 外置排行榜快照：观众维（leaderboard 内存累计）+ 阵营维（轮次生兵计数 + 引擎余额）。 */
function leaderboardSnapshot () {
  const snap = (round.snapshot && round.snapshot()) || {}
  const sp = (snap && snap.spawns) || { red: 0, blue: 0 }
  // ★ 分账：阵营余额展示的是**观众池**（viewer 宿主队），不是 AI 主队的钱。
  const balTeam = (t) => (battleConfig.walletMode() === 'shared') ? t : viewerTeamOf(t)
  const bal = (team) => { try { const t = economy.getTeam(balTeam(team)); return t ? Math.floor(t.balance) : null } catch (e) { return null } }
  return leaderboard.snapshot({
    factions: {
      red: { name: '红方', team: RED_TEAM, spawns: sp.red || 0, balance: bal(RED_TEAM) },
      blue: { name: '蓝方', team: BLUE_TEAM, spawns: sp.blue || 0, balance: bal(BLUE_TEAM) }
    }
  })
}

/**
 * 弹幕消息派发（统一入口，供中继 relay.onDanmaku 调用）。
 * 按 type 路由到对应处理器 —— 接线集中在此，便于离线验证。
 */
function dispatchMessage (msg) {
  if (!msg || !msg.type) return null
  if (msg.type === 'danmaku') return handleDanmaku(msg)
  if (msg.type === 'credits') return handleCredits(msg)
  if (msg.type === 'join') return handleJoin(msg)
  if (msg.type === 'gift') return handleGift(msg)
  return null
}

// ===== 初始化 =====
function init () {
  spawner.connect()
  leaderboard.loadSeason()   // ★ 累计榜：启动时把上次落盘的赛季数据读回来（跨中继重启保留）
  waifuBridge.connect()   // ★ 连接 Live2D 桌宠（:9191）；waifu 没起时静默重连，不影响其它功能
  // ★ 主播大脑：注入"战况快照"（经济 + 兵力），让冷场解说报真数据，而不是泛泛模板
  waifuDirector.setContextProvider(() => {
    const sp = (round.snapshot && round.snapshot().spawns) || { red: 0, blue: 0 }
    // 分账：展示的是**观众池**余额（与 leaderboardSnapshot 同口径）
    const balTeam = (t) => (battleConfig.walletMode() === 'shared') ? t : viewerTeamOf(t)
    const bal = (team) => { try { const t = economy.getTeam(balTeam(team)); return t ? Math.floor(t.balance) : null } catch (e) { return null } }
    return {
      state: round.state,
      round: round.round,
      red: { balance: bal(RED_TEAM), spawns: sp.red || 0 },
      blue: { balance: bal(BLUE_TEAM), spawns: sp.blue || 0 }
    }
  })
  waifuDirector.init()    // ★ 主播大脑：启动冷场心跳（主动话术；RW_DIRECTOR_ENABLED=0 可关）
  logger.info('[BATTLE] 弹幕对战系统已初始化')
}

module.exports = {
  round,
  spawner,
  gameCtrl,
  mapPool,
  startNewRound,
  endCurrentRound,
  handleDanmaku,
  handleCredits,
  handleJoin,
  handleGift,
  dispatchMessage,
  init,
  // 观众阵营归属（导出便于离线验证 / 调试）
  pickRewardTeam,
  playerTeamOf: (playerId) => playerTeams.get(playerId) || null,
  _playerTeams: playerTeams,
  _followRewarded,
  followAllowed,
  followOnCooldown,
  followWindowMs,
  _likeChatPids,
  resetLikeChat,
  likeChatAllowed,
  // 外置排行榜（观众/阵营榜单数据源 + 快照）
  leaderboard,
  leaderboardSnapshot,
  // 观众羁绊图谱（跨场档案，落盘）
  audience,
  // 游戏失联看门狗（一般由轮次事件驱动，导出便于调试/测试）
  startGameWatchdog,
  stopGameWatchdog,
  // 自动续局（导出便于离线验证/调试）
  scheduleNextRound,
  attemptNextRound,
  stopAutoNext,
  AUTO_NEXT_MS,
  // 结束播报（导出便于离线验证）
  announce,
  buildEndText,
  buildTopText,
  // 荣誉（贡献榜前三 → 下一轮头顶称号，纯展示）
  setChampions,
  championTitleOf,
  championAwardEnabled,
  repLabelText,
  championBadgeEnabled,
  championBadgePath,
  // 无效指令的画面提示（导出便于离线验证）
  HINT_COOLDOWN_MS,
  FORMAT_HINT_TEXT,
  // 开局玩法提示（导出便于离线验证）
  ruleHintText,
  // waifu 桥接（桌宠播报/对话，导出便于离线验证/调试）
  waifuBridge,
  waifuAnnouncer,
  waifuChat,
  waifuDirector,
  maybeChat,
  battleContext,
  STATES
}