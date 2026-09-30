'use strict'
/**
 * verify_endwatch.js — 离线回归：引擎判胜 watch 的"去重 + 边沿"判据
 *
 * 背景（2026-09-22 实机确诊）：
 *   同一游戏进程**跨轮复用**时，注入的 endinject.EndBridge.firstSeenMs 是 JVM 级静态、
 *   只在第一次见到判胜面板时置一次、此后再不复位。于是同一 JVM 里只有**第一轮**能写出
 *   "属于本轮"的 first_seen；后续轮次的 first_seen 是上一轮的陈旧值。
 *   ⇒ 中继 startEngineEndWatch 的旧判据 `first_seen > 本轮开始` 永远不成立，
 *      新弹出的 Victory/Defeat 面板看不到 ⇒ 轮次卡死、不自动开下一局（实测第 9 轮卡 10+ 分钟）。
 *
 * 修法：本轮内再加"面板 0→1 边沿"判据（A 段）——即使 first_seen 陈旧，只要本轮内
 *   面板从"没有"翻成"有"，就判定为引擎给出的本轮结果。B 段的"开局即残留面板"用例
 *   钉住边沿判据的**反面**（不得把上一轮残留的面板误判成本轮结果）。
 *
 * 跑法：  node tools/verify_endwatch.js
 * 零副作用：不连游戏、不碰真实 9999（RW_DEBUG_PORT 指向 19999、end_live 走临时文件）。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

process.env.RW_DEBUG_PORT = '19999'   // 别碰真实 9999
process.env.RW_END_POLL_MS = '40'     // 加速轮询（默认 2000ms）
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'endwatch-'))
const tmp = path.join(tmpDir, 'end_live.txt')
process.env.RW_END_FILE = tmp

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const lines = []
function check (name, ok, detail) {
  if (ok) { pass++; lines.push(`[PASS] ${name}${detail ? '  -- ' + detail : ''}`) }
  else { fail++; lines.push(`[FAIL] ${name}${detail ? '  -- ' + detail : ''}`) }
}

/** 原子写 end_live.txt（与注入侧同款：先写 .tmp 再 rename，避免读到半截）。 */
function writeEnd ({ victory = 0, defeat = 0, hidden = 0, firstSeen = 0, kind = 'none' }) {
  const body = `# end_live ${Date.now()} 1\n`
    + `victory ${victory}\ndefeat ${defeat}\nhidden ${hidden}\n`
    + `first_seen ${firstSeen} ${kind}\n`
  const t = tmp + '.tmp'
  fs.writeFileSync(t, body, 'utf8')
  fs.renameSync(t, tmp)
}

;(async () => {
  const gc = require('../battle/gameController.js')

  // ===== A. 陈旧 first_seen + 本轮新翻起的面板 → 必须结束（边沿兜底）=====
  {
    writeEnd({ victory: 0 })
    let fired = null
    const since = Date.now()
    gc.startEngineEndWatch(since, (e) => { fired = e })
    await sleep(150)                                                      // 首拍建基线（面板=false）
    writeEnd({ victory: 1, firstSeen: since - 600000, kind: 'victory' })  // first_seen 是上一轮的陈旧值
    await sleep(200)
    check('A1 陈旧 first_seen + 面板本轮新翻起 → 判结束（边沿兜底）', !!fired, fired ? JSON.stringify(fired) : 'null')
    check('A2 事件带 kind=victory / winner=red',
      !!fired && fired.kind === 'victory' && fired.winner === 'red', fired ? JSON.stringify(fired) : 'null')
    gc.stopEngineEndWatch()
  }

  // ===== B. 开局时面板就已翻起（上一轮残留）+ 陈旧 first_seen → 不得误判 =====
  {
    writeEnd({ victory: 1, firstSeen: 1000, kind: 'victory' })            // 一上来就是 true
    let fired = null
    gc.startEngineEndWatch(Date.now(), (e) => { fired = e })
    await sleep(250)
    check('B1 开局即残留面板 + 陈旧 first_seen → 不误判为本轮结果', !fired, fired ? JSON.stringify(fired) : 'null')
    gc.stopEngineEndWatch()
  }

  // ===== C. 本轮 fresh first_seen → 结束（原判据保留）=====
  {
    writeEnd({ victory: 0 })
    let fired = null
    const since = Date.now()
    gc.startEngineEndWatch(since, (e) => { fired = e })
    await sleep(150)
    writeEnd({ victory: 0, defeat: 1, firstSeen: Date.now(), kind: 'defeat' })   // 本轮新判胜（fresh）
    await sleep(200)
    check('C1 fresh first_seen → 判结束（kind=defeat / winner=blue）',
      !!fired && fired.kind === 'defeat' && fired.winner === 'blue', fired ? JSON.stringify(fired) : 'null')
    gc.stopEngineEndWatch()
  }

  // ===== D. 面板一直没出现 → 不结束 =====
  {
    writeEnd({ victory: 0 })
    let fired = null
    gc.startEngineEndWatch(Date.now(), (e) => { fired = e })
    await sleep(250)
    check('D1 始终无判胜面板 → 不结束', !fired, fired ? JSON.stringify(fired) : 'null')
    gc.stopEngineEndWatch()
  }

  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (e) {}

  for (const l of lines) console.log(l)
  console.log('')
  console.log(`${pass} PASS / ${fail} FAIL`)
  process.exit(fail ? 1 : 0)
})()
