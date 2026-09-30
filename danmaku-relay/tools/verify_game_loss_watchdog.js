'use strict'
/**
 * tools/verify_game_loss_watchdog.js — 「游戏失联看门狗」离线回归脚本
 *
 * 目标：在**不启动游戏、不碰真实 9999 端口、不开窗口**的前提下，复现并验证
 *   「战斗进行中游戏链路被静默终止 → 看门狗连续 2 次判失联 → 强制 endRound('game-lost')」
 *   这条链路，以及它的反向约束（活着不误杀、单次抖动不误杀、结束后不留定时器）。
 *
 * 做法：
 *   - require 业务模块**之前**把 process.env.RW_DEBUG_PORT 指向空闲高位端口 19999，
 *     并把看门狗周期 RW_GAME_WATCHDOG_MS 压到 200ms（加速离线测试）。
 *   - 用 net 起一个假 Debug Socket 服务器（收到 `ping` 回 `pong`）代表「游戏活着」；
 *     其它命令一律不回（避免 winWatch 的胜负解析读到 true/false 而干扰本测试）。
 *   - 用 gameController.__setLivenessProbe(fn) 注入「活着/失联」判据，完全替代真实探测。
 *
 * 零第三方依赖（只用 node 内置 net）。末行打印 `N PASS / M FAIL`；全通过 exit 0，否则 exit 1。
 */

process.env.RW_DEBUG_PORT = '19999'
process.env.RW_GAME_WATCHDOG_MS = '200'

const net = require('net')

const battle = require('../battle/index.js')
const gameCtrl = require('../battle/gameController.js')
const spawner = require('../battle/liveSpawner.js')
const { STATES } = require('../battle/roundManager.js')

const PORT = 19999
const TICK = parseInt(process.env.RW_GAME_WATCHDOG_MS, 10) // 200ms 一个看门狗周期
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
function check (id, ok, desc) {
  if (ok) { pass++; console.log(`PASS  ${id}: ${desc}`) } else { fail++; console.log(`FAIL  ${id}: ${desc}`) }
}

async function waitFor (pred, timeoutMs, stepMs = 25) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true
    await sleep(stepMs)
  }
  return pred()
}

// -------- 假 Debug Socket 服务器（代表「游戏活着」）--------
const clientSockets = new Set()
const server = net.createServer((sock) => {
  clientSockets.add(sock)
  sock.on('close', () => clientSockets.delete(sock))
  sock.on('error', () => {})
  sock.setEncoding('utf-8')
  sock.on('data', (d) => {
    for (const line of String(d).split(/\r?\n/)) {
      if (line.trim() === 'ping') sock.write('pong\n')
    }
  })
})

/** 摧毁服务器端持有的所有客户端连接 ⇒ liveSpawner 侧 connected 变 false（代表「调试口断了」）。 */
function killLinks () {
  for (const s of clientSockets) { try { s.destroy() } catch (e) {} }
}

async function main () {
  await new Promise((res, rej) => {
    server.once('error', rej)
    server.listen(PORT, '127.0.0.1', res)
  })

  // ===== A1：RW_DEBUG_PORT 覆盖生效，且 gameController / liveSpawner 两处同源 =====
  check('A1',
    gameCtrl.DEBUG_PORT === PORT && spawner.DEBUG_PORT === PORT && gameCtrl.DEBUG_PORT === spawner.DEBUG_PORT,
    `RW_DEBUG_PORT 覆盖生效且两处同源（gameController=${gameCtrl.DEBUG_PORT}, liveSpawner=${spawner.DEBUG_PORT}）`)

  // ===== A2：建立调试连接（代表「游戏活着」）=====
  spawner.connect()
  const okConn = await waitFor(() => spawner.connected === true, 3000)
  check('A2', okConn, `liveSpawner 已连上假 Debug Socket（127.0.0.1:${PORT}）`)

  // ===== A3：存活判据 seam —— 注入/复位均生效 =====
  gameCtrl.__setLivenessProbe(() => true)
  const seamTrue = gameCtrl.isGameAlive() === true
  gameCtrl.__setLivenessProbe(() => false)
  const seamFalse = gameCtrl.isGameAlive() === false
  // 复位为**默认判据**：默认判据 = 「中继自启的进程还活着」**或**「调试口连着」。
  // 2026-09-19 修：中继重启后自启进程的句柄就丢了，而游戏（上一次启动的那只）往往仍在跑
  // ⇒ 只认句柄会把好好的链路判成"失联"（实测 probe 全部有回包也照判）。此处 gameProcess
  // 为 null、而 A2 已连上假 socket ⇒ 复位后默认判据应为 **true**。
  gameCtrl.__setLivenessProbe(null)
  const seamReset = gameCtrl.isGameAlive() === true
  check('A3', seamTrue && seamFalse && seamReset,
    '__setLivenessProbe 注入(true/false)与复位均生效（复位后走默认判据：无自启进程但调试口在 → alive）')

  const ended = []
  battle.round.on('ended', (info) => ended.push(info))

  // ================= 轮次 1（注入探针）=================
  const round1Before = ended.length

  // ⑤-补 前置：脉冲探针 —— 第 1 次探测失联、之后立即恢复（单次抖动）
  let pulseCalls = 0
  gameCtrl.__setLivenessProbe(() => { pulseCalls++; return pulseCalls !== 1 })

  battle.round.startRound({ name: 'offline-r1', formation: 'test' })
  await sleep(TICK * 4)

  // ===== A4：⑤-补 单次抖动不结束（迟滞生效）=====
  check('A4', battle.round.state === STATES.FIGHTING && ended.length === round1Before && pulseCalls >= 2,
    `⑤-补 单次抖动（瞬时失联 1 次后恢复）不结束轮次 —— 迟滞生效（probe 被调用 ${pulseCalls} 次，仍 FIGHTING）`)

  // ===== A5：① 持续存活，跨多个周期不结束（防误杀）=====
  gameCtrl.__setLivenessProbe(() => true)
  await sleep(TICK * 3)
  check('A5', battle.round.state === STATES.FIGHTING && ended.length === round1Before,
    '① 注入「活着」判据 + FIGHTING：跨多个看门狗周期不结束轮次（防误杀）')

  // ===== A6 / A7 / A8：②③ 注入持续失联 → ≤3 周期内以 game-lost 结束，且只结束一次 =====
  gameCtrl.__setLivenessProbe(() => false)
  let cycles = 0
  while (cycles < 3 && battle.round.state === STATES.FIGHTING) { await sleep(TICK); cycles++ }
  check('A6', battle.round.state !== STATES.FIGHTING && cycles <= 3,
    `② 注入「失联」判据后 ${cycles} 个看门狗周期内离开 FIGHTING`)
  const last1 = ended[ended.length - 1]
  check('A7', !!last1 && last1.reason === 'game-lost',
    `② 结束 reason === 'game-lost'（实际：${last1 && last1.reason}）`)
  check('A8', ended.length - round1Before === 1,
    `③ 'ended' 只触发一次（本轮触发 ${ended.length - round1Before} 次）`)

  // ===== A9：④ 结束后看门狗已停（再等 3 周期无新事件、状态不变）=====
  const endedAfterStop = ended.length
  const stateAfterStop = battle.round.state
  await sleep(TICK * 3)
  check('A9', ended.length === endedAfterStop && battle.round.state === stateAfterStop,
    `④ 轮次结束后再看门狗已停（再等 3 周期：ended 计数仍 ${endedAfterStop}、状态仍 ${stateAfterStop}）`)

  // 等本轮回到 IDLE（endRound 后 3 秒）
  await waitFor(() => battle.round.state === STATES.IDLE, 6000)

  // ===== A10：⑥ 结束回 IDLE 后不再被 FIGHTING 挡住 =====
  check('A10', battle.round.state === STATES.IDLE,
    '⑥ 轮次结束回 IDLE 后 state !== FIGHTING —— startNewRound 不再被「战斗进行中」挡住')

  // ================= 轮次 2（真实链路断开，进程视为存活）=================
  const round2Before = ended.length
  // 真实存活判据：进程视为存活 ⇒ 只看调试连接（默认判据里「连接」那一半）
  gameCtrl.__setLivenessProbe(() => spawner.connected)
  if (!spawner.connected) spawner.connect()
  await waitFor(() => spawner.connected === true, 3000)

  battle.round.startRound({ name: 'offline-r2', formation: 'test' })
  await sleep(TICK * 2)
  const aliveWithLink = battle.round.state === STATES.FIGHTING && ended.length === round2Before

  // 断开链路（进程仍视为存活）
  const t0 = Date.now()
  killLinks()
  await sleep(30)
  const notImmediate = battle.round.state === STATES.FIGHTING // 断连瞬间不立即误杀（迟滞）
  await waitFor(() => battle.round.state !== STATES.FIGHTING, TICK * 6)
  const elapsed = Date.now() - t0
  const last2 = ended[ended.length - 1]

  // ===== A11：⑤ 假 socket 关闭（链路断、进程存活）→ 按迟滞结束，与②（一进即持续失联）形成对照 =====
  check('A11',
    aliveWithLink && notImmediate && battle.round.state !== STATES.FIGHTING &&
    !!last2 && last2.reason === 'game-lost' && elapsed >= TICK * 0.8,
    `⑤ 假 socket 关闭（链路断、进程视为存活）→ 迟滞结束后 reason='game-lost'`
    + `（先存活 ${aliveWithLink ? '是' : '否'}，断连后未立即误杀 ${notImmediate ? '是' : '否'}，`
    + `断连→结束约 ${elapsed}ms ≥ 2 周期量级 ${TICK * 2}ms）`)

  // 收尾：停掉可能残留的看门狗，关闭假服务器
  battle.stopGameWatchdog()
  server.close(() => {})

  console.log('')
  console.log(`${pass} PASS / ${fail} FAIL`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('verify 脚本异常：', e)
  console.log('')
  console.log(`${pass} PASS / ${fail + 1} FAIL`)
  process.exit(1)
})
