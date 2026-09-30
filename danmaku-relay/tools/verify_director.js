'use strict'
/**
 * verify_director.js — 离线回归：主播大脑（waifuDirector）+ 播报优先级（waifuBridge.speak priority）
 *
 * 被测改动：danmaku-relay/battle/waifuDirector.js（新）、battle/waifuBridge.js（priority）、
 *          battle/index.js（接线）。
 *
 * 手段：director 用**注入 sink + 显式时间戳**驱动 tick —— 断言「该主动时主动、不该打扰时不打扰」，
 *       毫秒级确定性，不靠真实等待；bridge 起**假 :9191**，断言 priority 抢占/放行。
 *
 * 零副作用：假 server 在 19992（不碰真 :9191），RW_DEBUG_PORT=19997（不碰真游戏），
 *          日志隔离到临时文件（RW_LOG_FILE）。
 *
 * 跑法：node tools/verify_director.js   退出码 0 = 全过。
 */
const os = require('os')
const path = require('path')
const fs = require('fs')
const WebSocket = require('ws')

// —— 环境必须在 require 被测模块之前设好（模块在加载时读 env）——
process.env.RW_LOG_FILE = path.join(os.tmpdir(), 'director-verify-' + process.pid + '.log')
process.env.RW_WAIFU_WS_URL = 'ws://127.0.0.1:19992/status'
process.env.RW_WAIFU_ENABLED = '1'
process.env.RW_DIRECTOR_ENABLED = '1'
process.env.RW_DIRECTOR_TICK_MS = '50'
process.env.RW_DIRECTOR_IDLE_MS = '1000'
process.env.RW_DIRECTOR_COLD_MS = '500'
process.env.RW_DEBUG_PORT = '19997'

let pass = 0
let fail = 0
const lines = []
function check (name, ok, detail) {
  if (ok) { pass++; lines.push('[PASS] ' + name + (detail ? '  -- ' + detail : '')) } else { fail++; lines.push('[FAIL] ' + name + (detail ? '  -- ' + detail : '')) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function done () {
  for (const l of lines) console.log(l)
  console.log('')
  console.log(`${pass} PASS / ${fail} FAIL`)
  process.exit(fail ? 1 : 0)
}

async function main () {
  // ================= M. 模块存在 =================
  let director
  try { director = require('../battle/waifuDirector') } catch (e) {
    check('M0 waifuDirector 模块存在（可 require）', false, (e && e.message) || String(e))
    done()
  }

  // ================= A. 话术纯函数（coldText）=================
  const live0 = director.coldText({ phase: 'LIVE', seq: 0 })
  const live1 = director.coldText({ phase: 'LIVE', seq: 1 })
  check('A1 LIVE 冷场话术非空', typeof live0 === 'string' && live0.length > 4, live0)
  check('A2 LIVE 话术随 seq 轮换', live0 !== live1, `${live0} | ${live1}`)
  const idleRes = director.coldText({ phase: 'IDLE', lastResult: { winner: 'red', round: 7, durSec: 90 }, seq: 0 })
  check('A3 IDLE 带结果 → 含胜方 + 轮次', /红方/.test(idleRes) && /7/.test(idleRes), idleRes)
  const idleTop = director.coldText({ phase: 'IDLE', top3: [{ name: '张三' }], seq: 0 })
  check('A4 IDLE 带榜单 → 含冠军名', /张三/.test(idleTop), idleTop)
  const idleDef = director.coldText({ phase: 'IDLE', seq: 0 })
  check('A5 IDLE 默认 → 含红/蓝引导', /红/.test(idleDef) && /蓝/.test(idleDef), idleDef)

  // A6–A9：战况感知解说（Director v2）—— 有 battle 快照时该报真数据，而不是泛泛模板
  const bl1 = director.coldText({ phase: 'LIVE', battle: { red: { balance: 200, spawns: 10 }, blue: { balance: 50, spawns: 3 } }, seq: 0 })
  check('A6 战况-经济领先 → 点名领先方', /红方/.test(bl1), bl1)
  const bl2 = director.coldText({ phase: 'LIVE', battle: { red: { balance: 100, spawns: 2 }, blue: { balance: 100, spawns: 8 } }, seq: 1 })
  check('A7 战况-兵力领先 → 点名领先方', /蓝方/.test(bl2), bl2)
  const bl3 = director.coldText({ phase: 'LIVE', battle: { red: { balance: 100, spawns: 5 }, blue: { balance: 100, spawns: 5 } }, seq: 0 })
  check('A8 战况-均势 → 中性「咬紧」文案', /咬|紧/.test(bl3), bl3)
  const bl4 = director.coldText({ phase: 'LIVE', seq: 0 })
  check('A9 无战况 → 回退通用解说', /压兵|翻盘/.test(bl4), bl4)

  // ================= B. 状态迁移 =================
  check('B1 初始 phase=IDLE', director.phase() === 'IDLE', director.phase())
  director.noteFighting({ round: 3, at: 0 })
  check('B2 noteFighting → LIVE', director.phase() === 'LIVE', director.phase())
  director.noteEnded({ winner: 'blue', round: 3, durSec: 120, top3: [{ name: '李四' }], at: 0 })
  check('B3 noteEnded → IDLE', director.phase() === 'IDLE', director.phase())
  check('B4 noteEnded 记住结果', !!director.lastResult() && director.lastResult().winner === 'blue', JSON.stringify(director.lastResult()))

  // ================= C. 冷场驱动（注入 sink + 显式时间戳）=================
  const spoken = []
  director.init({ sink: (text, opts) => { spoken.push({ text, opts }); return true }, startAt: 10000 })
  director.noteSpeech(10000)
  const c1 = director.tick(10999)
  check('C1 未到阈值：不打扰', c1 === null, JSON.stringify(c1))
  const c2 = director.tick(11001)
  check('C2 超过阈值：主动一句', !!c2 && typeof c2.text === 'string' && c2.text.length > 0, JSON.stringify(c2))
  check('C3 sink 收到且带 priority', spoken.length === 1 && Number.isFinite(spoken[0].opts.priority), JSON.stringify(spoken))
  const c4 = director.tick(11101)
  check('C4 触发后短时间内不再主动（防刷屏）', c4 === null, JSON.stringify(c4))
  const c5 = director.tick(12002)
  check('C5 再次静默超阈值 → 再主动', !!c5 && typeof c5.text === 'string', JSON.stringify(c5))

  // ================= D. noteSpeech 抑制冷场 =================
  director.noteSpeech(20000)
  check('D1 刚播过 → 不冷场', director.isCold(20500) === false, String(director.isCold(20500)))
  const d2 = director.tick(20500)
  check('D2 冷场 tick 返回 null', d2 === null, JSON.stringify(d2))

  director.stop()

  // ================= E. 总开关 =================
  delete require.cache[require.resolve('../battle/waifuDirector')]
  process.env.RW_DIRECTOR_ENABLED = '0'
  const off = require('../battle/waifuDirector')
  check('E1 ENABLED=false', off.ENABLED === false, String(off.ENABLED))
  check('E2 init 返回 false', off.init({ sink: () => true }) === false, '')
  check('E3 tick 返回 null', off.tick(Date.now() + 1e9) === null, '')
  off.stop()
  process.env.RW_DIRECTOR_ENABLED = '1'
  delete require.cache[require.resolve('../battle/waifuDirector')]

  // ================= F. waifuBridge.speak priority 抢占（假 :9191）=================
  const received = []
  const wss = new WebSocket.Server({ port: 19992 })
  await new Promise((res, rej) => { wss.once('listening', res); wss.once('error', rej) })
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'connected', port: 9191 }))
    ws.on('message', (d) => { try { received.push(JSON.parse(d.toString())) } catch (e) { /* ignore */ } })
    ws.on('error', () => {})
  })
  const bridge = require('../battle/waifuBridge')
  bridge.connect()
  await sleep(300)
  check('F0 已连接假中继', bridge.connected === true, String(bridge.connected))

  received.length = 0
  const a = bridge.speak('高优先级台词A', { priority: 3, tag: 't' })
  const b = bridge.speak('同优先级B应被丢弃', { priority: 3, tag: 't' })
  check('F1 同/低优先级在播放窗口内被丢弃', a === true && b === false, `a=${a} b=${b}`)
  const c = bridge.speak('更高优先级C应抢占', { priority: 5, tag: 't' })
  check('F2 更高优先级可抢占', c === true, `c=${c}`)
  const d = bridge.speak('无优先级D不受影响', { tag: 't' })
  check('F3 无 priority 调用不受抢占影响', d === true, `d=${d}`)
  await sleep(200)   // 等 WS 帧异步送达假中继再断言
  const txts = received.filter((m) => m.type === 'agent:end').map((m) => m.response)
  check('F4 实际发出的台词集 = {A, C, D}', JSON.stringify(txts) === JSON.stringify(['高优先级台词A', '更高优先级C应抢占', '无优先级D不受影响']), JSON.stringify(txts))

  bridge.disconnect()
  await new Promise((res) => wss.close(res))

  // ================= G. index.js 接线（源码级）=================
  const bi = fs.readFileSync(path.join(__dirname, '..', 'battle', 'index.js'), 'utf8')
  check('G1 index.js 引用 waifuDirector', /waifuDirector/.test(bi), '')
  check('G2 index.js 启动 Director', /waifuDirector\.init\(/.test(bi), '')
  check('G3 fighting 通知 Director', /waifuDirector\.noteFighting\(/.test(bi), '')
  check('G4 ended 通知 Director', /waifuDirector\.noteEnded\(/.test(bi), '')
  check('G5 index.js 注入战况 context（setContextProvider）', /waifuDirector\.setContextProvider\(/.test(bi), '')

  done()
}

main().catch((e) => { console.error('CRASH: ' + ((e && e.stack) || e)); process.exit(2) })
