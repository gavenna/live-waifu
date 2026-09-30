/**
 * gameController.js — 游戏生命周期管理
 * 启动游戏 → 加载地图 → 管理 Debug Socket
 */
const { execFile } = require('child_process')
const path = require('path')
const fs = require('fs')
const net = require('net')
const logger = require('../logger')
// 红/蓝双方用哪个 team 槽位（单一真相来源在 ./teams，这里只是转发导出）
const { RED_TEAM, BLUE_TEAM, RED_VIEWER_TEAM, BLUE_VIEWER_TEAM } = require('./teams')

// 调试口端口：从 liveSpawner 取（**单一真相来源**见 battle/liveSpawner.js，那边支持
// RW_DEBUG_PORT 覆盖）。两处端口必须同源，不要在本文件再写一份 9999。
const { DEBUG_PORT } = require('./liveSpawner')
// 地图契约（指挥中心 / 巡逻目标 / 观众基准 / 镜头），由 tools/gen_map_contract.js 生成；缺则回退写死值。
const mapConfig = require('./mapConfig')

// ===== 游戏路径（从 war-vote config 继承或直接配置）=====
const GAME_DIR = process.env.RW_DIR ||
  'D:\\game\\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\\Rusted Warfare1.15'

const JAVA_EXE = path.join(GAME_DIR, 'jvm', 'bin', 'java.exe')

let gameProcess = null

/** 游戏是否在运行 */
function isRunning () {
  return gameProcess && gameProcess.exitCode === null
}

// ============================================================
// 游戏链路存活判据（失联看门狗用；看门狗本体在 battle/index.js）
// ============================================================
// 「活着」= 游戏进程仍在（isRunning）**且** 调试口仍连着（liveSpawner.connected）。
// 为什么是「且」：实机 2026-09-19 确认的缺陷是游戏进程被静默终止后 socket 断开、
//   askEngine() 恒返回 null ⇒ 轮次永不结束、新一轮又被 FIGHTING 挡住。
//   两个信号任一为假都说明链路不可用，取「且」让看门狗对
//   「进程还在但调试口掉了」同样敏感。
//
// 🔌 测试注入点：__setLivenessProbe(fn)。离线回归脚本
//   tools/verify_game_loss_watchdog.js 用它把判据换成可控函数，从而在**不启动游戏**
//   的前提下复现「游戏中途消失」。传非函数（或 null）即复位为默认判据。
let livenessProbe = null

/**
 * 默认存活判据：**自启进程活着 或 调试口连着**。
 * 为什么不是「且」：中继一重启，自启游戏的进程句柄（gameProcess）就丢了，而游戏往往还在跑
 * ⇒ 只认句柄会把好链路判成「失联」（实测 probe 全部有回包也照判死，2026-09-19）。
 * 调试口是游戏自己的 socket，它连着就说明游戏在。
 */
function defaultLivenessProbe () {
  let s
  try { s = require('./liveSpawner') } catch (e) { return false }
  return isRunning() || s.connected === true
}

/** 测试注入点：覆盖存活判据。传函数则启用，传 null / 非函数则复位为默认判据。 */
function __setLivenessProbe (fn) {
  livenessProbe = (typeof fn === 'function') ? fn : null
  return true
}

/**
 * 判定「游戏链路是否活着」。任何异常一律视为「不活」（fail-safe，交给看门狗）。
 * @returns {boolean}
 */
function isGameAlive () {
  const probe = livenessProbe || defaultLivenessProbe
  try { return probe() === true } catch (e) { return false }
}

/** 通过 Debug Socket 发送命令（用 liveSpawner 的持久连接）*/
function sendSocketCmd (cmd) {
  const spawner = require('./liveSpawner')
  return new Promise((resolve) => {
    if (spawner.connected) {
      spawner.sendCommand(cmd)
      setTimeout(() => resolve(true), 500)
    } else {
      // 回退：新建连接
      const s = new net.Socket()
      s.setTimeout(5000)
      s.connect(DEBUG_PORT, '127.0.0.1', () => {
        s.write(cmd + '\n')
        setTimeout(() => { s.destroy(); resolve(true) }, 500)
      })
      s.on('error', () => { s.destroy(); resolve(false) })
      s.on('timeout', () => { s.destroy(); resolve(false) })
    }
  })
}

/** 等待 Debug Socket 可用 */
function waitForSocket (timeoutMs = 20000) {
  return new Promise((resolve) => {
    const start = Date.now()
    const tryConnect = () => {
      const s = new net.Socket()
      s.setTimeout(2000)
      s.connect(DEBUG_PORT, '127.0.0.1', () => {
        s.write('ping\n')
        s.once('data', (d) => {
          s.destroy()
          if (d.toString().trim() === 'pong') resolve(true)
          else setTimeout(tryConnect, 1000)
        })
      })
      s.on('error', () => { s.destroy(); if (Date.now() - start < timeoutMs) setTimeout(tryConnect, 1000); else resolve(false) })
      s.on('timeout', () => { s.destroy(); if (Date.now() - start < timeoutMs) setTimeout(tryConnect, 1000); else resolve(false) })
    }
    tryConnect()
  })
}

/** 启动游戏（带 Debug Socket）*/
function startGame () {
  return new Promise((resolve) => {
    if (isRunning()) { resolve({ ok: true, msg: '已在运行' }); return }
    if (!fs.existsSync(JAVA_EXE)) { resolve({ error: 'java not found: ' + JAVA_EXE }); return }

    // 🔴 2026-09-19 实机查出的假成功：调试口**已经连着**时再去 spawn 一个 JVM，新实例
    //    抢不到 9999（老实例还占着）也拿不到 lastrun.log 锁，会**当场死掉**；
    //    而下面的就绪轮询第一拍就看见 `spawner.connected === true`（那是**老实例**的连接）
    //    ⇒ 立刻 resolve ok，日志打出一串**不存在进程**的 PID。实测证据（2026-09-19 15:50 那轮）：
    //    日志里 4 个「游戏已启动 (PID: 12672/16316/12184/15920)」，而真实 java 只有 1 个
    //    （PID 17660，创建于 15:20:31，一直占着 9999；HUD/生兵全部由它执行）。
    //    所以先判「调试口已连着」= 已有实例在跑 ⇒ 直接复用，不 spawn、不谎报。
    const liveMod = require('./liveSpawner')
    if (liveMod.connected) {
      logger.info('[BATTLE] 调试口已连接 → 复用正在运行的游戏实例（不重启、不新开进程）')
      resolve({ ok: true, pid: null, reused: true })
      return
    }

    const env = { ...process.env, PATH: GAME_DIR + ';' + (process.env.PATH || '') }
    const args = [
      '-Djava.net.preferIPv4Stack=true', '-Xmx1000M', '-Dfile.encoding=UTF-8',
      '-Djava.library.path=.', '-cp', 'game-lib.jar;libs/*',
      'com.corrodinggames.rts.java.Main',
      '-debug', `${DEBUG_PORT}:autostart`,
      '-log', 'lastrun.log'
    ]

    const { spawn } = require('child_process')
    gameProcess = spawn(JAVA_EXE, args, { cwd: GAME_DIR, env, stdio: 'ignore', detached: true })
    gameProcess.on('exit', () => { gameProcess = null })
    gameProcess.unref()

    // 等待 socket 就绪
    // ⚠️⚠️ 必须**复用 liveSpawner 的连接**：引擎只允许**一个** Debug Socket 连接，
    //    自己另开一个会被拒、永远收不到 pong ⇒ 恒定超时。这就是历史"偶发 20 秒超时
    //    → 让用户再点一次"的真根因（不是游戏启动慢）。负载高时冷启动实测可达 2 分钟，故上限 180s。
    const spawner = require('./liveSpawner')
    const deadline = Date.now() + 180000
    let lastTry = 0
    const poll = () => {
      if (spawner.connected) {
        logger.info('[BATTLE] Debug Socket 已就绪（复用 liveSpawner 连接）')
        resolve({ ok: true, pid: gameProcess?.pid })
        return
      }
      if (Date.now() - lastTry > 5000) {
        lastTry = Date.now()
        try { spawner.connect() } catch (e) { /* 重连失败下次再试 */ }
      }
      if (Date.now() > deadline) {
        logger.warn('[BATTLE] 等待 Debug Socket 超时（180s）')
        resolve({ ok: false, pid: gameProcess?.pid })
        return
      }
      setTimeout(poll, 1000)
    }
    poll()
  })
}

/** 加载地图并开始游戏 */
async function loadMap (mapPath) {
  // 确保 spawner 连接
  const spawner = require('./liveSpawner')
  if (!spawner.connected) {
    spawner.connect()
    await sleep(3000)
  }

  // 打开 sandboxOptions 加载 UI
  // ★★ 2026-09-18 实测确立的「多阵营」起局配方（8 方：1 真人 + 7 支各自独立的 AI 阵营）
  //   · aiTeams=5  = Free for all ⇒ 每支 AI 保持自己的队号当同盟组(互相敌对)
  //   · numberOfAIs=7           ⇒ 创建 team 1..7（偶数队 2/4/6 只在第二趟循环里被创建）
  //   · **必须起两遍**：第 1 遍解析地图时偶数队 2/4/6 尚未创建，它们的基地瓦片会被
  //     `skipping unit without player` 丢掉；第 2 遍队伍齐全，全部瓦片才变成单位。
  //     （实测第 2 遍后 team2~7 全部拿到基地，45 秒内已互相打出胜负）
  // ★ 2026-09-19（HUD/经济条不显示的修复）：起局入口做成可切换。
  //   `loadConfigAndStartNewSandbox`（沙盒＝编辑器入口）在 `_loadConfigAndStartNewSandboxCommon`
  //   里会置 `l2.bv = true`（= editorMode），于是对局跑在编辑器模式下，正常对战 HUD（经济/资源
  //   条就画在 HUD 上）不绘制 —— 屏幕上只剩 "Editor Active"（本地化里 `menus.singlePlayer.sandbox
  //   = Sandbox Editor` 即"沙盒＝编辑器"）。
  //   `loadConfigAndStartNew`（Root.java:616-625）做**同样的事**：同样走 `loadConfigCommon`
  //   （所以 aiTeams=5 / numberOfAIs=7 / 起两遍 的配方完全不受影响），唯一差别是 `bv = false`
  //   —— 另外少了 `bL.E=false` 与 `bS.y()` 两句（沙盒专有），如出现问题按下面回滚即可。
  //   回滚：`$env:RW_START_ENTRY="loadConfigAndStartNewSandbox"` 后重启中继。
  const START_ENTRY = process.env.RW_START_ENTRY || 'loadConfigAndStartNew'
  // 开局参数（AI 数量 / 难度 / 队伍模式）：由控制台配置，见 battle/battleConfig.js
  // 每遍都要设一次 —— 第 1 遍解析地图时偶数队 2/4/6 还没创建，第 2 遍才齐全。
  const bc = require('./battleConfig').effective()
  for (let pass = 1; pass <= 2; pass++) {
    spawner.sendCommand(`script root.open('sandboxOptions.rml', '${mapPath}')`)
    await sleep(1500)
    spawner.sendCommand(`script root.setValueById('aiTeams', '${bc.aiTeams}')`)
    await sleep(600)
    spawner.sendCommand(`script root.setValueById('numberOfAIs', '${bc.numberOfAIs}')`)
    await sleep(600)
    spawner.sendCommand(`script root.setValueById('aiDifficulty', '${bc.aiDifficulty}')`)
    await sleep(600)
    spawner.sendCommand(`script root.${START_ENTRY}('${mapPath}')`)
    await sleep(3000)
    logger.info(`[BATTLE] 起局第 ${pass}/2 遍（${START_ENTRY} / aiTeams=${bc.aiTeams} / numberOfAIs=${bc.numberOfAIs} / aiDifficulty=${bc.aiDifficulty}）`)
  }

  // 关闭弹窗
  spawner.sendCommand("script root.clickElement(root.getElementById('ok'))")
  await sleep(300)
  spawner.sendCommand("script root.closePopup()")
  await sleep(300)
  spawner.sendCommand("script root.closeAlertOnly()")
  await sleep(300)
  spawner.sendCommand("function root.resumeNonMenu()")
  await sleep(500)

  // 初始资金（控制台可调）：用**现成**的 debug.setTeamCredits 给参战队设钱。
  //   · 0 = 不改，沿用地图自带的 credits 属性（避免把地图合理默认冲成 0）
  //   · 必须在队伍创建之后（即 loadMap 之后）才有队可设
  //   · 实测有效：起局后发 setTeamCredits(1,50000) → econ_live.txt 的 team 1 由 100918 变 50182
  // 注意：这不是"规则级"初始资金（那在 ah.c，单机下改不动，见 battleConfig 注释），
  //       但对观众看到的效果等价 —— 开局时两队都是这个数。
  const startCredits = require('./battleConfig').effective().startingCredits
  if (startCredits > 0) {
    spawner.sendCommand(`script debug.setTeamCredits(${RED_TEAM}, ${startCredits})`)
    await sleep(250)
    spawner.sendCommand(`script debug.setTeamCredits(${BLUE_TEAM}, ${startCredits})`)
    await sleep(250)
    logger.info(`[BATTLE] 初始资金已设为 ${startCredits}（红 team${RED_TEAM} / 蓝 team${BLUE_TEAM}）`)
  }
  // ★ 观众钱包开局余额（2026-09-27）：红=team3 / 蓝=team4。0 = 不改（沿用引擎默认 4000）。
  //   分账后观众召唤/互动都落这两个队 —— 余额太小则白名单兵（最便宜 2000、常备 18000）买不起。
  const viewerCredits = require('./battleConfig').effective().viewerStartingCredits
  if (viewerCredits > 0) {
    spawner.sendCommand(`script debug.setTeamCredits(${RED_VIEWER_TEAM}, ${viewerCredits})`)
    await sleep(250)
    spawner.sendCommand(`script debug.setTeamCredits(${BLUE_VIEWER_TEAM}, ${viewerCredits})`)
    await sleep(250)
    logger.info(`[BATTLE] 观众钱包初始余额已设为 ${viewerCredits}（红 team${RED_VIEWER_TEAM} / 蓝 team${BLUE_VIEWER_TEAM}）`)
  }

  // 地图加载完成 → 启动"双方自动开战"（见文件末尾 autoBattle 段）
  startAutoBattle()

  return true
}

// ============================================================
// 双方自动开战 — 用 Debug Socket 的 script API 驱动
// ============================================================
// 背景：team 0（红）是本地人类玩家，engine 里 n.w（是否 AI）在构造时由
//   `this instanceof game.a.a` 定死，无 setter ⇒ 人类槽位无法改造成 AI（此路已封死）。
//
// ⭐ 现行方案：**不用人类队** —— 用两个 AI 玩家当双方。
//   引擎开局时会**创建真正的 AI 玩家**（appFramework/i.java:104-131）：
//     盟友 AI: n10 = new a(n6); n10.r = 0;
//     敌人 AI: n12 = new a(i2); n12.v = "AI"; n12.r = 1;
//   敌人 AI 的槽位**优先奇数**（i.java:122 `bl5 = i2 % 2 == 1 || n5 == 1`），
//   默认 numberOfAIs=4（aiTeams=1 ⇒ allyCount = 0）⇒ 敌人 AI 落在 slot 1, 3, 5, 7。
//   所以：弹幕红兵生给 RED_TEAM(1)、蓝兵生给 BLUE_TEAM(3)（见 battle/teams.js），
//   再把两队写进**不同**同盟组 ⇒ 两个 AI 玩家互相敌对 ⇒ 自动开战、主播零操作。
//   team 0 一个兵都不生 ⇒ 之前"人类兵站着不动"的问题从根上消失。
//
// 敌对判定（rts/game/n.java:1096-1111）：
//   n.c(o) → `this.r != o.r`（敌对）；n.d(o) → `this.r == o.r`（同盟）
//   setTeamAllyGroup(t, g) 直接写 n.r，无任何校验（librocket/scripts/Debug.java:287）
//
// 完整依据（行号 + 反编译片段）见：
//   .hermes-cc/t-20260916-224225/RESULT.md
//   .hermes-cc/t-20260916-225223/RESULT.md

/**
 * 总开关。
 * ⚠️ 本任务把原值 `false` **改成了 `true`** —— 理由：BRIEF A3 要求的运行时探测
 *    挂在同一条启动路径上，开关为 false 时探测根本不会发出，BRIEF 要求的
 *    「实机验证埋点」就永远拿不到数据。且新方案不再需要人类队参与，
 *    上一版把开关关掉的原因（moveAllUnitsOnTeam 300 秒零击杀）已随该实现一起删除。
 *    若想关掉：把这里改回 false（一行，零副作用）。
 */
const AUTO_BATTLE_ENABLED = true

/** 地图加载完成后再等多久才开始（等游戏真正进入战斗态）*/
const AUTO_BATTLE_START_DELAY_MS = 5000

/**
 * 同盟组编号 —— **必须**每队不同才会互相敌对。
 *
 * 🔴 2026-09-17 修复：这里原来是 `{ [RED_TEAM]: 0, [BLUE_TEAM]: 1 }`，即给 RED_TEAM(1)
 * 写同盟组 0 —— 而 team 0 的默认同盟组就是 0 ⇒ **team 1 变成了 team 0 的同盟**，
 * 于是红方 AI 永远不会攻击蓝方。这正是"跑满 300 秒零击杀"的真正原因
 * （当年的解释是"moveAllUnitsOnTeam 只会纯移动"，那是**误判**；实测只要同盟组不同，
 *  红方 AI 的 4 个 tank 30 秒就全歼了蓝方 4 个 tank，日志出现
 *  `Player has been wiped out`）。
 *
 * 现在直接写成"同盟组 == 队号"（n.java:1069 构造时 `this.r = n2`，这就是引擎默认值），
 * 既保证两队不同 ⇒ 敌对，又把可能被上一轮改坏的 r 复位。
 * ⚠️ 别用 -3（n.java:381 `n.b() { return this.r == -3; }` 是"观察者"魔数）。
 */
// ★ 2026-09-19（结算面板回归）：除了红蓝两队，还要把 team 0（没人操控的本地"人类"槽位）
// 一起并入 **RED 的同盟组**。这不是装饰，是必需项：
//   * 地图侧已把引擎胜负打开（`none -> commandCenter`，见 patch_endcond.py --win），
//     而引擎判胜负用的是**本地玩家视角**（`gameFramework/n/f.java:929-945`，`l2.bs.c()/d()`）。
//   * team 0 在两张图上**一个单位/建筑都没有** ⇒ 若让它当独立阵营，它"我输了"的标志
//     在第一次判定（每 1000ms）就为真 ⇒ **开局第 1 秒直接弹 Defeat**（就是 2026-09-18
//     那个事故的镜像版本，只是这次反过来由"没有基地"触发）。
//   * 并入红方后语义正好是我们要的：**红方指挥中心被拆 = Defeat，蓝方指挥中心被拆 = Victory**。
// ⚠️ 绝不能用 -3：`r == -3` 是**观察者**魔数，观察者会把整块胜负判定短路掉
//    （`f.java:915-919`）⇒ 结算面板永远不会出现。观众观战要靠别的手段（见 skill）。
const ALLY_GROUP = { 0: RED_TEAM, [RED_TEAM]: RED_TEAM, [BLUE_TEAM]: BLUE_TEAM,
  // ★ 2026-09-19：观众召唤兵的无 AI 宿主席位（team3 红 / team4 蓝）也一并写进同盟组。
  //   地图 live_dire.tmx 的 team_3/4_info 已设 allyGroup，这里是运行时的第二道保险
  //   （applyHostility 会在开局把它再发一遍；两边一致，谁覆盖谁都对）。
  [RED_VIEWER_TEAM]: RED_TEAM, [BLUE_VIEWER_TEAM]: BLUE_TEAM }

/**
 * 运行时探测（BRIEF A3）：开局后挨个问 `debug.getPlayerName(t)`，结果写进中继日志。
 * 人类槽位（team 0）引擎写死返回 "Player"；AI 玩家返回 "AI"（i.java:103,119）
 * ⇒ 可用来实机确认 slot 1 / 3 真的是 AI 玩家。
 */
const PROBE_TEAM_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

/**
 * 探测命令前缀。
 * `function` 前缀支持返回值（BRIEF A3 指明），且现有可用代码里
 *   `function root.resumeNonMenu()`（loadMap 末尾）已经在用这个前缀；
 * 生兵走的是 `script` 前缀（见 sendScript）。
 * ⚠️ 若实机一条回包都收不到 —— 把这里改成 'script' 再试一次，**只此一行**。
 */
const PROBE_CMD_PREFIX = 'function'

/** 每条探测命令之间等回包的时间 */
const PROBE_STEP_MS = 200

let autoBattleStartTimer = null
/** 是否已武装。现方案没有常驻定时器，只能靠这个状态位回答 isAutoBattleRunning() */
let autoBattleArmed = false
let exitHookInstalled = false

/**
 * 复用 liveSpawner 的持久连接发一条 script 命令。
 * 绝不新建 TCP 连接（Debug Socket 可能只支持单连接）。
 * 任何失败都被吞掉 —— 不能影响现有弹幕生兵。
 */
async function sendScript (scriptBody) {
  // The game RESETS its Debug Socket when it goes menu -> in-game, so "not
  // connected" right after loadMap is EXPECTED, not terminal. The first version of
  // this function returned false in that case, so setTeamAllyGroup was never sent
  // even once (measured 2026-09-16: relay logged "socket not connected", the ally
  // groups were never changed, and the round behaved exactly like before).
  // So: reconnect and retry instead of giving up.
  const spawner = require('./liveSpawner')
  for (let i = 0; i < SEND_TRIES; i++) {
    try {
      if (!spawner.connected) {
        spawner.connect()                      // lazy reconnect, safe to call again
      } else if (spawner.sendCommand(`script ${scriptBody}`) === true) {
        return true
      }
    } catch (e) {
      // swallowed on purpose: this must never break danmaku spawning
    }
    await sleep(SEND_RETRY_MS)
  }
  return false
}

/** 发送重试策略：Debug Socket 在开局瞬间会重置，给它足够时间重新连上 */
const SEND_TRIES = 15
const SEND_RETRY_MS = 2000

/**
 * 让 RED_TEAM 与 BLUE_TEAM 互为敌对 —— 写进**不同**同盟组即可。
 * 只做这一件事，没有定时器：双方都是 AI 玩家，会自己移动和攻击。
 */
async function applyHostility () {
  let ok = true
  for (const team of Object.keys(ALLY_GROUP)) {
    const group = ALLY_GROUP[team]
    if (await sendScript(`debug.setTeamAllyGroup(${team}, ${group})`)) {
      logger.info(`[BATTLE] setTeamAllyGroup(${team}, ${group}) 已发出 — team ${team} → 同盟组 ${group}`)
    } else {
      logger.warn(`[BATTLE] setTeamAllyGroup(${team}, ${group}) 重试 ${SEND_TRIES} 次仍未发出 — 双方可能不会敌对`)
      ok = false
    }
  }
  return ok
}

// ------------------------------------------------------------
// 运行时探测（BRIEF A3）—— 用来实机验证 slot 1 / 3 是不是 AI
// ------------------------------------------------------------
// 返回值怎么取回来：`liveSpawner.sendCommand` 本身**只发不收**（回包不解析），
// 所以本任务在 liveSpawner 里加了一个只读回包缓冲 `drainReplies()`。
// 这里**逐条发、逐条 drain**，于是第一条回包天然对上第一条命令，不靠猜顺序。
// 绝不新建 TCP 连接（Debug Socket 可能只支持单连接）。

/** 发一条探测命令（前缀可切，见 PROBE_CMD_PREFIX）。失败不抛异常 */
function sendProbeCommand (teamId) {
  try {
    const spawner = require('./liveSpawner')
    if (!spawner.connected) return false
    return spawner.sendCommand(`${PROBE_CMD_PREFIX} debug.getPlayerName(${teamId})`) === true
  } catch (e) {
    return false
  }
}

/**
 * 探测 t = 0..9 各槽位的玩家名，写进中继日志（前缀 `[BATTLE][probe]`）。
 *
 * ⚠️ 完全可能**一条回包都收不到**（取决于 Debug Socket 是否真的回写结果）。
 *    那种情况下本函数**不做任何判断**，只如实记录「无回包」，
 *    并在最后打一行排查提示 —— 绝不编造 team 名字。
 * @returns {Promise<boolean>} 是否收到了至少一条回包
 */
async function probePlayerNames () {
  let spawner
  try { spawner = require('./liveSpawner') } catch (e) { return false }

  // 等连接就绪（开局瞬间 socket 会重置）——最多等 30 秒，超时才放弃
  for (let i = 0; i < 15 && !spawner.connected; i++) {
    try { spawner.connect() } catch (e) { /* ignore */ }
    await sleep(2000)
  }
  if (!spawner.connected) {
    logger.info('[BATTLE][probe] 等待 30 秒后 Debug Socket 仍未连接 — 跳过探测')
    return false
  }
  if (typeof spawner.drainReplies !== 'function') {
    logger.info('[BATTLE][probe] liveSpawner 未提供 drainReplies()（版本不匹配？）— 跳过探测')
    return false
  }

  logger.info(`[BATTLE][probe] 开始：前缀 '${PROBE_CMD_PREFIX}'，team ${PROBE_TEAM_IDS.join(',')}`)
  spawner.drainReplies() // 丢掉握手/上一轮残留，保证第一条回包对得上第一条命令

  let gotAny = false
  for (const t of PROBE_TEAM_IDS) {
    if (!sendProbeCommand(t)) {
      logger.info(`[BATTLE][probe] team ${t} = <命令未发出：socket 未连接>`)
      break
    }
    await sleep(PROBE_STEP_MS)
    const got = spawner.drainReplies()
    if (got.length > 0) {
      gotAny = true
      logger.info(`[BATTLE][probe] team ${t} = ${JSON.stringify(got.join(' | '))}`)
    } else {
      logger.info(`[BATTLE][probe] team ${t} = <无回包>`)
    }
  }

  if (!gotAny) {
    logger.info('[BATTLE][probe] ⚠️ 一条回包都没收到 —— **无法判断**各槽位是 AI 还是人类。'
      + ` 排查顺序：① 把 PROBE_CMD_PREFIX 从 '${PROBE_CMD_PREFIX}' 改成 'script' 重试；`
      + ' ② 看游戏自己的日志里有没有 `ScriptEngine:HandleEvent:...getPlayerName` 之类行；'
      + ' ③ 两边都不行 ⇒ 该探测通道不可用，改为看开局时游戏是否自带 AI（人数/名字）。')
  }
  return gotAny
}

/** 退出时兜底清理（只监听 exit，不接管信号，避免破坏 Ctrl+C）*/
function installExitHook () {
  if (exitHookInstalled) return
  exitHookInstalled = true
  process.once('exit', stopAutoBattle)
}

// ------------------------------------------------------------
// 胜负轮询（winWatch）—— 用引擎自己的标志判定这局谁赢了
// ------------------------------------------------------------
// 为什么要它：中继原来只能靠 10 分钟超时收场，`/api/battle/state` 的 `kills` 又是坏的
//   （roundManager.killCount 永远不 +1，引擎也没有"查击杀数/单位数"的 API）。
// 但引擎有**胜负标志**：
//   Debug.java:235 isTeamDefeated(t) → n.G；:226 isTeamWipedOut(t) → 同一字段
//   :244 isTeamInVictory(t) → n.H
// 实测（2026-09-17，红=team1 打爆蓝=team0 主基地的那一轮）：
//   team 0 → wiped=true defeated=true victory=false
//   team 1 → wiped=false defeated=false victory=false
// ⇒ 用 isTeamDefeated 就能拿到"谁被打没了"，比开 OCR 读结算面板省事（面板数字可作为补充证据）。
// ⚠️ 死槽位（team 3/5/7）开局就是 defeated=true，所以**只查红蓝两队**。
const WINWATCH_INTERVAL_MS = 4000
/** 每条查询之间等回包的时间（同 probePlayerNames：逐条发、逐条 drain）*/
const WINWATCH_STEP_MS = 300
let winWatchTimer = null
let winWatchCb = null

/** 发一条带返回值的查询并取回包；失败返回 null */
async function askEngine (expr) {
  let spawner
  try { spawner = require('./liveSpawner') } catch (e) { return null }
  if (!spawner.connected) { try { spawner.connect() } catch (e) {} }
  try {
    spawner.drainReplies()
    if (spawner.sendCommand(`function ${expr}`) !== true) return null
    await sleep(WINWATCH_STEP_MS)
    return spawner.drainReplies()
  } catch (e) { return null }
}

/** 回包 ["ok","true\u0000"] → true ／ ["ok","false\u0000"] → false ／ 其它 → null */
function parseBoolReply (replies) {
  if (!replies || !replies.length) return null
  const s = replies.join(' ').toLowerCase()
  if (s.includes('true')) return true
  if (s.includes('false')) return false
  return null
}

/** 轮询一次；返回 {redDefeated, blueDefeated}（拿不到的字段为 null）*/
async function pollDefeat () {
  const flags = { redDefeated: null, blueDefeated: null }
  flags.redDefeated = parseBoolReply(await askEngine(`debug.isTeamDefeated(${RED_TEAM})`))
  flags.blueDefeated = parseBoolReply(await askEngine(`debug.isTeamDefeated(${BLUE_TEAM})`))
  return flags
}

/**
 * 开始轮询胜负。`cb(flags)` 在**分出胜负的那一刻**被调用一次（之后自动停）。
 * 失败/拿不到值时静默返回，绝不抛异常（不能影响弹幕生兵）。
 */
function startWinWatch (cb) {
  stopWinWatch()
  if (!AUTO_BATTLE_ENABLED) return false
  winWatchCb = cb || null
  let misses = 0
  winWatchTimer = setInterval(async () => {
    try {
      const flags = await pollDefeat()
      if (flags.redDefeated === null && flags.blueDefeated === null) {
        if (++misses === 5) logger.info('[BATTLE][win] 连续 5 次拿不到胜负标志 — 仍在轮询')
        return
      }
      misses = 0
      // 只有一队被判负才算分出胜负（两队同时 true 视为无结论）
      const decided = (flags.redDefeated === true) !== (flags.blueDefeated === true)
      if (decided) {
        logger.info(`[BATTLE][win] 分出胜负：redDefeated=${flags.redDefeated} blueDefeated=${flags.blueDefeated}`)
        // 🔴 2026-09-18 实机查出并修掉：原来这里是 `stopWinWatch(); if (winWatchCb) {...}`，
        //    而 stopWinWatch() 内部会把 winWatchCb 置 null ⇒ **紧接着的 if 恒为假**，
        //    回调永远不会执行 ⇒ 分出胜负也**永远不会结束这一轮**（只能等 5 分钟超时兜底）。
        //    实机证据：23:32:46 打了 `[win] 分出胜负`，之后既无"引擎判定"也无"第 N 轮结束"。
        //    修法：先把回调取出来，再停表。
        const cb = winWatchCb
        stopWinWatch()
        if (cb) { try { cb(flags) } catch (e) { /* 不影响主流程 */ } }
      }
    } catch (e) { /* 永不影响主流程 */ }
  }, WINWATCH_INTERVAL_MS)
  if (winWatchTimer.unref) winWatchTimer.unref()
  logger.info('[BATTLE][win] 开始轮询胜负（isTeamDefeated）')
  return true
}

/** 停止胜负轮询。幂等。 */
function stopWinWatch () {
  if (winWatchTimer) { clearInterval(winWatchTimer); winWatchTimer = null }
  winWatchCb = null
  return true
}

// ------------------------------------------------------------
// 引擎判胜读数：end_live.txt（2026-09-19 注入新增的读通道）
// ------------------------------------------------------------
// 🔴 为什么必须有它（实机证据）：用户拍板的规则是「指挥中心没了就算输」，引擎据此判胜时
//    只把结果**画进结算面板**（Victory! / Defeat），而中继过去唯一的读数
//    `debug.isTeamDefeated(t)` 读的是"整队单位清零"（n.G）—— 与"基地被拆"**不同源**。
//    结果：2026-09-19 16:42 那局引擎已判 `Defeat!`（红方基地被拆、蓝方赢），而中继在
//    **24 分钟前**就以 300 秒超时播报了「无胜负收场」。两侧读数永远对不上。
// 注入体 `endinject.EndBridge`（同一次 jar 注入，见 skill jvm-bytecode-patching）每 6 帧把
// 引擎自己的两个面板标志落盘到 `<GAME>\end_live.txt`：
//    victory = l.dq（取字处 f/f.java:67-70,183-185；置位者 f/g.java:3415 G()）
//    defeat  = l.dt（同上；置位者 f/g.java:3427 H()）
//    hidden  = l.dr（短局抑制 ⇒ 面板不显示）
//    first_seen <millis> <victory|defeat> —— 首次看到判胜的时刻
// 极性：Victory 是**本地玩家视角**判胜（本地队 0 已被并入红方同盟组）⇒ 蓝方基地被拆 = 红方胜；
//      Defeat ⇒ 红方基地被拆 = 蓝方胜。
const END_FILE_DEFAULT = path.join(GAME_DIR, 'end_live.txt')

function endFilePath () {
  return process.env.RW_END_FILE || END_FILE_DEFAULT
}

/**
 * 读一次 end_live.txt。三态返回，**不抛异常**：
 *   {ok:true, victory, defeat, hidden, firstSeenMs, firstKind, ts} 读到了
 *   {ok:false, error} 读不到/为空/坏文件 —— 调用方按"无法判定"处理，别当成 false
 */
function readEngineEnd (file) {
  const p = file || endFilePath()
  try {
    const text = fs.readFileSync(p, 'utf8')
    if (!text || text.length < 10) return { ok: false, error: 'empty' }
    const out = { ok: true, victory: false, defeat: false, hidden: false,
      firstSeenMs: 0, firstKind: 'none', ts: 0, file: p }
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      let m = /^#\s*end_live\s+(\d+)/.exec(line)
      if (m) { out.ts = Number(m[1]); continue }
      m = /^(victory|defeat|hidden)\s+([01])/.exec(line)
      if (m) { out[m[1]] = (m[2] === '1'); continue }
      m = /^first_seen\s+(\d+)\s+(\S+)/.exec(line)
      if (m) { out.firstSeenMs = Number(m[1]); out.firstKind = m[2]; continue }
    }
    return out
  } catch (e) {
    return { ok: false, error: e.code || e.message }
  }
}

const ENDWATCH_INTERVAL_MS = (() => {
  const v = parseInt(process.env.RW_END_POLL_MS, 10)
  return Number.isFinite(v) && v > 0 ? v : 2000
})()
let endWatchTimer = null

/**
 * 轮询引擎判胜文件；本轮出现判胜时 cb 被调用**一次**，随后自动停表。
 * @param {number} sinceMs 本轮开始时刻（只接受 first_seen > sinceMs 的翻转）
 * @param {(e:{winner:'red'|'blue',kind:string,firstSeenMs:number,file:string})=>void} cb
 *
 * 🔴 为什么用 `first_seen > sinceMs` 而不是"读到 victory 就是赢"：end_live.txt 是**跨轮次复用**的
 *    同一个文件，只认"读到 true"会把上一轮的胜利算到这一轮（stale flip）。另外轮内 base 被拆后
 *    标志会一直为 true（直到下次 loadConfig），所以必须靠时刻而不是状态去重。
 * ⚠️ 2026-09-22 补边沿判据：注入侧 `EndBridge.firstSeenMs` 是 JVM 级静态、不复位，同一游戏进程
 *    跨轮复用时只有第一轮能写出"属于本轮"的 first_seen ⇒ 后续轮次 fresh 永不成立、engine-end 失效
 *    （实测第 9 轮：面板已 Victory、中继仍 FIGHTING 十多分钟）。故本轮内再加"面板 0→1 边沿"。
 */
function startEngineEndWatch (sinceMs, cb) {
  stopEngineEndWatch()
  const since = Number(sinceMs) || 0
  // 首拍只建立"面板是否已翻起"的基线、不判定 —— 避免把上一轮残留的面板误判成本轮结果。
  let prevFlag = null
  endWatchTimer = setInterval(() => {
    try {
      const s = readEngineEnd()
      if (!s.ok) return
      const flag = s.victory || s.defeat
      if (prevFlag === null) { prevFlag = flag; return }   // 建基线
      const edge = flag && !prevFlag                        // 本轮内新翻起的面板（0→1）
      prevFlag = flag
      if (!flag) return
      // 结束条件：本轮内新翻起（edge）**或** first_seen 确属本轮（fresh）。
      // edge 专治已知缺陷：同一游戏进程跨轮复用时，注入的 firstSeenMs 只记第一次判胜、
      // 不复位 ⇒ 后续轮次的 first_seen 是上一轮的陈旧值，单靠 fresh 永远不成立（第 9 轮卡死即此）。
      const fresh = s.firstSeenMs > since
      if (!edge && !fresh) return
      const kind = s.defeat ? 'defeat' : 'victory'
      const winner = s.defeat ? 'blue' : 'red'
      const c = cb
      stopEngineEndWatch()
      if (c) { try { c({ winner, kind, firstSeenMs: s.firstSeenMs, file: s.file }) } catch (e) { /* 不影响主流程 */ } }
    } catch (e) { /* 永不影响主流程 */ }
  }, ENDWATCH_INTERVAL_MS)
  if (endWatchTimer.unref) endWatchTimer.unref()
  logger.info(`[BATTLE][win] 开始轮询引擎判胜文件（每 ${ENDWATCH_INTERVAL_MS}ms，文件 ${endFilePath()}）`)
  return true
}

/** 停止引擎判胜轮询。幂等。 */
function stopEngineEndWatch () {
  if (endWatchTimer) { clearInterval(endWatchTimer); endWatchTimer = null }
  return true
}

// ============================================================
// 开局镜头（焦点 + 缩放）
// ============================================================
// 走 RML 脚本 `debug` 对象（与已在用的 setTeamAllyGroup / isTeamDefeated 同一通道）：
//   debug.lookAt(x, y)  → l.b(x,y) → l.a(x - cE/2, y - cB/2) 把镜头中心移到世界坐标 (x,y)
//   debug.setZoom(z)    → l.cV = z                           缩放（引擎默认 1.0f）
// 引擎侧锚点：librocket\scripts\Debug.java:86 / :356；gameFramework\l.java:581 / :238。
// 2026-09-19 由用户手动调好后**读回**（注入的 debug.getCamX/getCamY/getZoom）：
//   实测镜头 camX=-67.263916  camY=300.80353  zoom=0.57870376
//   换算成 lookAt 的中心坐标 = (camX + 675.5/zoom, camY + 450/zoom) = (1100, 1078.4)
//   （675.5 / 450 = zoom 1 时的视野半宽/半高；实测 cE=1351/zoom 反比成立）
//   闭环验证：用这组中心值重设后读回的 camX/camY/zoom 与用户调好的完全一致。
// 旧默认 (1120,1050)/1.0 是红蓝基地中点（HANDOVER §7#2），保留备查。
const CAM_FALLBACK = { x: 1100, y: 1078.4, zoom: 0.57870376 }
// ★ 2026-09-27：镜头默认值改为从地图契约读（map-config.json 的 camera）；缺则回退旧图 CAM_FALLBACK。
//   env（RW_CAM_X/Y/ZOOM）优先级仍最高（见 cameraTarget）。
const CAM_DEFAULTS = (mapConfig && mapConfig.camera) ? mapConfig.camera : CAM_FALLBACK

/** 解析开局镜头目标：env 优先，非法值/缺省回退 CAM_DEFAULTS（绝不产出 NaN）。 */
function cameraTarget () {
  const num = (v, d) => {
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : d
  }
  return {
    x: num(process.env.RW_CAM_X, CAM_DEFAULTS.x),
    y: num(process.env.RW_CAM_Y, CAM_DEFAULTS.y),
    zoom: num(process.env.RW_CAM_ZOOM, CAM_DEFAULTS.zoom)
  }
}

/**
 * 设置镜头：焦点 + 缩放。**永不抛异常**。
 * 走 sendScript ⇒ 实际命令是 `script debug.lookAt(x, y)` / `script debug.setZoom(z)`，
 * 与已在用的 `script debug.setTeamAllyGroup(...)`（applyHostility，本文件 :357）
 * 和生兵 `script debug.createUnit(...)`（liveSpawner.js:317）**同前缀**。
 *   ⇒ debug.* 方法一律走 `script`，`function` 只用于 root.resumeNonMenu() 与 PROBE。
 * 发送是 fire-and-forget：sendScript 自带惰性重连 + 15 次重试 + 吞掉所有异常。
 * @returns {boolean} 是否已发起发送（参数全非法时 false）
 */
function setCamera (x, y, zoom) {
  const hasPos = Number.isFinite(x) && Number.isFinite(y)
  const hasZoom = Number.isFinite(zoom)
  if (!hasPos && !hasZoom) return false
  if (hasPos) { sendScript(`debug.lookAt(${x}, ${y})`).catch(() => {}) }
  if (hasZoom) { sendScript(`debug.setZoom(${zoom})`).catch(() => {}) }
  return true
}

/**
 * 启动自动开战。幂等：重复调用会先清掉旧的启动定时器。
 *
 * ⚠️ 内部**不再有 setInterval / driveUnits**（BRIEF A2）：
 *   双方都是 AI 玩家，自己会移动和攻击，**不需要我们驱赶**。
 *   旧实现用 `debug.moveAllUnitsOnTeam` 每 4 秒推一次，实测 300 秒零击杀 ——
 *   已确认它下的是**纯移动命令**（`e.a(x,y)`，从不设攻击移动标志 `e.h`），
 *   还会把 AI 单位硬拖到固定坐标、干扰 AI 决策。故整段删除。
 *   删除的还有只为它服务的 `ATTACK_TARGET` / `MAP_WORLD_SIZE` / `toWorldCoord`
 *   / `AUTO_BATTLE_INTERVAL_MS`（已无引用，避免留下误导性的死代码）。
 *
 * 函数名与返回类型保持不变（battle/index.js 有引用）。
 */
function startAutoBattle () {
  if (!AUTO_BATTLE_ENABLED) return false
  stopAutoBattle()
  installExitHook()
  autoBattleArmed = true

  autoBattleStartTimer = setTimeout(() => {
    autoBattleStartTimer = null
    // 先等同盟组真的发出去，再做探测 —— 顺序有意义：
    // ① 探测会 drain 回包缓冲，跑在 applyHostility 之前会把它的回包读走；
    // ② 两者都要 socket，串行比并发更容易看出是哪一步没连上。
    // 不 await ⇒ startAutoBattle 保持**同步返回 boolean**，调用方接口不变。
    applyHostility()
      .then(() => probePlayerNames())
      .catch(() => {})
  }, AUTO_BATTLE_START_DELAY_MS)
  if (autoBattleStartTimer.unref) autoBattleStartTimer.unref()

  return true
}

/** 停止自动开战。幂等，可在任意时刻重复调用 */
function stopAutoBattle () {
  autoBattleArmed = false
  if (autoBattleStartTimer) { clearTimeout(autoBattleStartTimer); autoBattleStartTimer = null }
  return true
}

/**
 * 是否正在自动开战。
 * 现方案没有常驻定时器，所以判断依据是"是否已武装"（延迟启动期间也算在跑）。
 * 注意语义与旧版一致：`stopAutoBattle()` 之后一定返回 false。
 */
function isAutoBattleRunning () {
  return autoBattleArmed || autoBattleStartTimer !== null
}

/** 杀掉游戏 */
function killGame () {
  stopAutoBattle()
  if (isRunning()) {
    try { gameProcess.kill() } catch (e) {}
    gameProcess = null
  }
  // NOTE: `taskkill /IM java.exe` would kill EVERY JVM on this machine. That is
  // the same class of bug that terminated explorer.exe on 2026-09-16 -- a force
  // kill that never checks process identity. Match the game JVM by its own command
  // line instead, and use execFileSync with an argv array (no shell quoting).
  try {
    const { execFileSync } = require('child_process')
    const psCmd = "Get-CimInstance Win32_Process -Filter \"Name='java.exe'\" | "
      + "Where-Object { $_.CommandLine -and $_.CommandLine.Contains('corrodinggames') } | "
      + "ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
    execFileSync('powershell', ['-NoProfile', '-Command', psCmd], { stdio: 'ignore' })
  } catch (e) {}
}

function sleep (ms) { return new Promise(r => setTimeout(r, ms)) }

module.exports = {
  startGame,
  loadMap,
  killGame,
  isRunning,
  sendSocketCmd,
  waitForSocket,
  GAME_DIR,
  // 双方自动开战
  startAutoBattle,
  stopAutoBattle,
  isAutoBattleRunning,
  AUTO_BATTLE_ENABLED,
  // 胜负轮询（引擎 isTeamDefeated）
  startWinWatch,
  stopWinWatch,
  // 引擎判胜读数（end_live.txt，注入新增通道）
  readEngineEnd,
  startEngineEndWatch,
  stopEngineEndWatch,
  endFilePath,
  // 开局镜头（焦点 + 缩放）
  cameraTarget,
  setCamera,
  // 游戏链路存活判据（失联看门狗用）+ 测试注入点
  isGameAlive,
  __setLivenessProbe,
  // 调试口端口（单一真相来源是 ./liveSpawner，这里只是转发）
  DEBUG_PORT,
  // 红/蓝双方使用的 team 槽位（真相在 ./teams，这里只是转发）
  RED_TEAM,
  BLUE_TEAM
}