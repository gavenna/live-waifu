#!/usr/bin/env node
/*
 * hermes-verify-announce-wiring.js —— 「结束播报」接线的定向 ad-hoc 验证
 *
 * 被测改动：danmaku-relay/battle/index.js
 *   · 新增 announce(text, tag)      —— 走 Debug Socket 发 `script debug.showMessage('...')`
 *   · 新增 buildEndText(...)        —— 播报文案（纯函数）
 *   · round.on('ended') 里新增调用  —— 这是真正的接线点
 *
 * 手段：起一个**假 Debug Socket**（127.0.0.1:19999，避开真游戏占着的 9999），
 *       require 真模块，然后**真的 emit 一个 'ended' 事件**，看 socket 上收到了什么。
 *       不做源码正则匹配 —— 那是"字面上有这行代码"，不是"这条线通"。
 *
 * 负向对照（证明断言不是恒真的）：
 *   · emit 之前必须**一条** showMessage 都没有（= 修复前的行为）
 *   · 文案里出现单引号/反斜杠时必须被净化，否则会把迷你解析器的参数提前闭合
 *   · 空文案必须不发命令
 */
process.env.RW_DEBUG_PORT = '19999'
const net = require('net')

const RELAY = 'D:\\Projects\\live-waifu\\danmaku-relay'
const PORT = 19999

const PASS = []
const FAIL = []
function check (name, cond, detail) {
  (cond ? PASS : FAIL).push(name)
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (detail !== undefined ? '  -- ' + JSON.stringify(detail) : ''))
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const seen = []
const sockets = []
let server = null

function startServer () {
  return new Promise((res, rej) => {
    server = net.createServer((s) => {
      sockets.push(s)
      s.on('data', (d) => {
        // TCP 会把背靠背的写入合成一个段 —— 必须先按 \n 切开再判定
        for (const raw of d.toString().split(/\r?\n/)) {
          const cmd = raw.trim()
          if (!cmd) continue
          seen.push(cmd)
          if (cmd === 'ping') { s.write('pong\n'); continue }
          s.write('ok\n"ok"\n')
        }
      })
      s.on('error', () => {})
    })
    server.once('error', rej)
    server.listen(PORT, '127.0.0.1', () => res())
  })
}
function stopServer () {
  return new Promise((res) => {
    sockets.forEach((s) => { try { s.destroy() } catch (e) {} })
    server.close(() => res())
  })
}

const showMessages = () => seen.filter((c) => c.includes('debug.showMessage'))

async function main () {
  await startServer()
  const battle = require(RELAY + '\\battle\\index.js')
  const sp = battle.spawner

  console.log('== A: buildEndText 纯函数 ==')
  check('A1 蓝方胜 → 含「蓝方获胜」+ 轮次/秒数/兵力',
    battle.buildEndText(9, 'defeat:red', 213, { red: 20, blue: 20 },
      { redDefeated: true, blueDefeated: false, winner: 'blue' })
      === '【播报】蓝方获胜！第9轮 213秒 · 红20兵 vs 蓝20兵',
    battle.buildEndText(9, 'defeat:red', 213, { red: 20, blue: 20 },
      { redDefeated: true, blueDefeated: false, winner: 'blue' }))
  check('A2 红方胜 → 含「红方获胜」',
    battle.buildEndText(3, 'defeat:blue', 77, { red: 8, blue: 2 },
      { redDefeated: false, blueDefeated: true, winner: 'red' }).includes('红方获胜'))
  check('A3 超时无胜负 → 标「时间到」',
    battle.buildEndText(4, 'timeout', 300, { red: 1, blue: 2 }, null).includes('无胜负收场（时间到）'),
    battle.buildEndText(4, 'timeout', 300, { red: 1, blue: 2 }, null))
  check('A4 游戏失联 → 标「游戏失联」',
    battle.buildEndText(5, 'game-lost', 12, { red: 0, blue: 0 }, null).includes('游戏失联'))
  check('A5 缺字段不炸（spawns/outcome 为 undefined）',
    typeof battle.buildEndText(6, 'manual', 1, undefined, undefined) === 'string',
    battle.buildEndText(6, 'manual', 1, undefined, undefined))

  console.log('\n== B: announce() 走的确实是 Debug Socket ==')
  sp.connect()
  await sleep(500)
  check('B1 假 socket 已连上', sp.connected === true, sp.connected)
  seen.length = 0

  const ok = battle.announce('【播报】测试中：中文与数字 123', 'unit')
  await sleep(300)
  const one = showMessages()
  check('B2 announce 返回 true（命令已写出）', ok === true, ok)
  check('B3 socket 恰好收到 1 条 showMessage', one.length === 1, one)
  check('B4 命令形态正确（script debug.showMessage(\'…\') 且中文原样）',
    one[0] === "script debug.showMessage('【播报】测试中：中文与数字 123')", one[0])

  console.log('\n== C: 负向对照（证明断言不是恒真的）==')
  seen.length = 0
  const bad = battle.announce("注入'试试\\\\还有反斜杠", 'neg')
  await sleep(300)
  const negCmds = showMessages()
  check('C1 含单引号/反斜杠的文案被净化（参数不会提前闭合）',
    negCmds.length === 1 && !/showMessage\('.*'.*'\)/.test(negCmds[0]) && !negCmds[0].includes('\\'),
    negCmds[0])
  check('C2 净化后仍是一条**形态完整**的命令', /^script debug\.showMessage\('[^']*'\)$/.test(negCmds[0] || ''), negCmds[0])
  seen.length = 0
  const emptyOk = battle.announce('   ', 'neg')
  await sleep(250)
  check('C3 空文案 → 返回 false 且不发命令', emptyOk === false && showMessages().length === 0)

  console.log('\n== D: ★ 真接线点 —— emit round "ended" 后 socket 上必须有播报 ==')
  seen.length = 0
  await sleep(150)
  check('D1 emit 之前，socket 上一条 showMessage 都没有（= 修复前的行为）', showMessages().length === 0,
    showMessages())

  battle.round.emit('ended', {
    round: 9, reason: 'defeat:red', duration: 213400,
    spawns: { red: 20, blue: 20 },
    outcome: { redDefeated: true, blueDefeated: false, winner: 'blue' }
  })
  await sleep(400)
  const endCmds = showMessages()
  check('D2 emit 之后恰好 1 条 showMessage（接线通了）', endCmds.length === 1, endCmds)
  check('D3 内容就是引擎判定的结果',
    endCmds[0] === "script debug.showMessage('【播报】蓝方获胜！第9轮 213秒 · 红20兵 vs 蓝20兵')", endCmds[0])

  console.log('\n== E: 无胜负收场也要播 ==')
  seen.length = 0
  battle.round.emit('ended', {
    round: 10, reason: 'timeout', duration: 300000,
    spawns: { red: 3, blue: 5 }, outcome: null
  })
  await sleep(400)
  const tCmds = showMessages()
  check('E1 超时收场也播 1 条', tCmds.length === 1, tCmds)
  check('E2 内容标出「无胜负收场（时间到）」',
    /【播报】无胜负收场（时间到）/.test(tCmds[0] || ''), tCmds[0])

  await stopServer()
  console.log('\nRESULT: %d PASS / %d FAIL', PASS.length, FAIL.length)
  if (FAIL.length) console.log('failed: ' + FAIL.join(', '))
  process.exit(FAIL.length ? 1 : 0)
}

main().catch((e) => { console.error('CRASH: ' + e.stack); process.exit(2) })
