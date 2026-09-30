'use strict'
/**
 * verify_automation.js — 离线回归：「完全自动化」两件套
 *   A. 收局推手（liveSpawner.pushOnce/startRoundPusher）——周期把两队主军推向敌方基地
 *   B. 自动续局（battle/index.js.scheduleNextRound）——轮次回 IDLE 后自动开下一局，失败退避重试
 *
 * 跑法：  node tools/verify_automation.js
 * 零副作用：不启动游戏、不碰真实 9999（RW_DEBUG_PORT 指向 19999）、不开窗口。
 * ⚠️ logger 会往 logs/combined.log 追加几行（与其它 verify 脚本一致，见 HANDOFF 坑 16）。
 */
process.env.RW_DEBUG_PORT = '19999'          // 别碰真实 9999
process.env.RW_AUTO_NEXT_MS = '60'           // 自动续局: 加速到 60ms
process.env.RW_AUTO_NEXT_RETRY_MS = '40'     // 退避重试间隔
process.env.RW_PUSH_INTERVAL_MS = '120'      // 推手周期

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
function check (id, ok, desc) {
  if (ok) { pass++; console.log(`PASS  ${id}: ${desc}`) } else { fail++; console.log(`FAIL  ${id}: ${desc}`) }
}

;(async function main () {
  const battle = require('../battle/index.js')
  const spawner = require('../battle/liveSpawner.js')

  // ================= A. 收局推手（对称补兵） =================
  const sent = []
  spawner.setSendCommandForTest((c) => { sent.push(c); return true })

  const n = spawner.pushOnce()
  const red = sent.filter((c) => c.includes(', 3, '))
  const blue = sent.filter((c) => c.includes(', 4, '))
  const perSide = spawner.PUSH_PER_SIDE
  const typeOf = (c) => { const m = /spawnPatrol\('([^']+)'/.exec(c); return m ? m[1] : null }
  check('A1', n === perSide * 2, `pushOnce 两边各 ${perSide} 兵（合计 ${perSide * 2}）  -- n=${n}`)
  check('A2', red.length === perSide && blue.length === perSide, `两边指令数相等（不偏袒任一方）  -- red=${red.length} blue=${blue.length}`)
  check('A3', red.every((c) => spawner.PUSH_POOL.includes(typeOf(c))) && red.some((c) => c.includes(`${spawner.PATROL_TARGETS[1].x}.0, ${spawner.PATROL_TARGETS[1].y}.0`)),
    `红兵类型∈推手池 且目标=蓝基地  -- ${red[0]}`)
  check('A4', blue.every((c) => c.includes(', 4, ')) && blue.some((c) => c.includes(`${spawner.PATROL_TARGETS[2].x}.0, ${spawner.PATROL_TARGETS[2].y}.0`)),
    `蓝兵落 viewer 队(4) 且目标=红基地  -- ${blue[0]}`)

  // A10/A11：推手落点必须落在**自家指挥中心旁**（SPAWN_AREAS）。
  //   背景：早期担心「召唤兵被本队 AI 抢回」，曾把补兵直接放中线交战区；该问题已由 disabledAI
  //   宿主队（team3/4）根治，补兵改为从基地/指挥中心出发、靠 spawnPatrol 的巡逻令行军到敌方基地。
  //   2026-09-22：前压双区（FRONT_AREAS）已移除，所有召唤兵（含推手补兵）统一下在本队指挥中心旁，
  //   断言「落点 ∈ SPAWN_AREAS」即可。
  {
    const parseXY = (list) => list.map((c) => {
      const m = /spawnPatrol\('[^']+', ([-\d.]+), ([-\d.]+), (\d+)/.exec(c)
      return m ? { x: Number(m[1]), y: Number(m[2]) } : null
    }).filter(Boolean)
    const inArea = (p, a) => p.x >= a.xMin && p.x <= a.xMax && p.y >= a.yMin && p.y <= a.yMax
    const redPts = parseXY(red)
    const bluePts = parseXY(blue)
    check('A10', redPts.length === perSide && redPts.every((p) => inArea(p, spawner.SPAWN_AREAS[1])),
      `推手红兵落自家基地(SPAWN_AREAS)而非中线交战区  -- ${redPts.map((p) => `${p.x},${p.y}`).join(' | ')}`)
    check('A11', bluePts.length === perSide && bluePts.every((p) => inArea(p, spawner.SPAWN_AREAS[2])),
      `推手蓝兵落自家基地(SPAWN_AREAS)而非中线交战区  -- ${bluePts.map((p) => `${p.x},${p.y}`).join(' | ')}`)
  }

  sent.length = 0
  check('A5', spawner.startRoundPusher() === true, 'startRoundPusher 返回 true（计数归零）')
  await sleep(400)
  check('A6', sent.length >= 6, `周期触发（120ms × 400ms ≥1 次 × 每轮 6）  -- n=${sent.length}`)
  spawner.stopRoundPusher()
  const afterStop = sent.length
  await sleep(300)
  check('A7', sent.length === afterStop, `stop 之后不再有新命令  -- ${afterStop} -> ${sent.length}`)

  // A8/A9：每边封顶（同步连推，不靠定时器）——防止一方靠滚雪球平推
  {
    process.env.RW_PUSH_INTERVAL_MS = '120'
    process.env.RW_PUSH_PER_SIDE = '3'
    process.env.RW_PUSH_MAX_PER_SIDE = '6'
    delete require.cache[require.resolve('../battle/liveSpawner.js')]
    const sp2 = require('../battle/liveSpawner.js')
    const s2 = []
    sp2.setSendCommandForTest((c) => { s2.push(c); return true })
    let total = 0
    for (let i = 0; i < 10; i++) total += sp2.pushOnce()
    const r2 = s2.filter((c) => c.includes(', 3, ')).length
    const b2 = s2.filter((c) => c.includes(', 4, ')).length
    check('A8', r2 === 6 && b2 === 6, `每边累计封顶 PUSH_MAX_PER_SIDE=6 后停手  -- red=${r2} blue=${b2}`)
    check('A9', total === 12, `封顶后 pushOnce 不再发（总数=6×2）  -- total=${total}`)
    delete process.env.RW_PUSH_MAX_PER_SIDE
    delete process.env.RW_PUSH_PER_SIDE
    delete require.cache[require.resolve('../battle/liveSpawner.js')]
  }

  // ================= B. 自动续局 =================
  // B1/B2：成功桩 —— 到点被调用一次
  let okCalls = 0
  const okStub = async () => { okCalls++; return true }
  check('B1', battle.scheduleNextRound(okStub) === true, 'scheduleNextRound 返回 true')
  await sleep(200)
  check('B2', okCalls === 1, `到点自动开局被调用一次  -- calls=${okCalls}`)

  // B3/B4：一直失败的桩 —— 会退避重试，但有上限（1 次首试 + 最多 5 次重试 = 6）
  let failCalls = 0
  const failStub = async () => { failCalls++; throw new Error('模拟开局失败') }
  battle.scheduleNextRound(failStub)
  await sleep(700)
  check('B3', failCalls >= 2, `失败会重试  -- calls=${failCalls}`)
  check('B4', failCalls <= 6, `重试有上限（≤6）  -- calls=${failCalls}`)
  battle.stopAutoNext()

  // ================= C. 开关回退（重载模块读 env） =================
  battle.stopAutoNext()
  {
    process.env.RW_AUTO_NEXT_MS = '0'
    delete require.cache[require.resolve('../battle/index.js')]
    const b2 = require('../battle/index.js')
    check('C1', b2.AUTO_NEXT_MS === 0, `RW_AUTO_NEXT_MS=0 → AUTO_NEXT_MS=0  -- v=${b2.AUTO_NEXT_MS}`)
    check('C2', b2.scheduleNextRound(async () => true) === false, '关闭时 scheduleNextRound 返回 false')
    b2.stopAutoNext()
  }
  {
    process.env.RW_PUSH_INTERVAL_MS = '0'
    delete require.cache[require.resolve('../battle/liveSpawner.js')]
    const s2 = require('../battle/liveSpawner.js')
    check('C3', s2.PUSH_INTERVAL_MS === 0, `RW_PUSH_INTERVAL_MS=0 → PUSH_INTERVAL_MS=0  -- v=${s2.PUSH_INTERVAL_MS}`)
    check('C4', s2.startRoundPusher() === false, '关闭时 startRoundPusher 返回 false')
  }

  // ================= D. 每局时长可配（RW_ROUND_MAX_MS） =================
  {
    const { RoundManager } = require('../battle/roundManager.js')
    process.env.RW_ROUND_MAX_MS = '180000'
    const rm1 = new RoundManager()
    check('D1', rm1.maxDurationMs === 180000, `RW_ROUND_MAX_MS=180000 生效  -- v=${rm1.maxDurationMs}`)
    delete process.env.RW_ROUND_MAX_MS
    const rm2 = new RoundManager()
    check('D2', rm2.maxDurationMs === 5 * 60 * 1000, `不设时默认 5 分钟  -- v=${rm2.maxDurationMs}`)
    process.env.RW_ROUND_MAX_MS = '0'
    const rm3 = new RoundManager()
    check('D3', rm3.maxDurationMs === 5 * 60 * 1000, `非法值(0)回退默认  -- v=${rm3.maxDurationMs}`)
    delete process.env.RW_ROUND_MAX_MS
  }

  // ================= E. 推手 v3 + 召唤白名单（2026-09-27 新规则） =================
  {
    for (const k of ['RW_PUSH_INTERVAL_MS', 'RW_PUSH_TOTAL', 'RW_PUSH_TYPES', 'RW_PUSH_MAX_PER_SIDE', 'RW_PUSH_LEVEL', 'RW_PUSH_UNITS']) delete process.env[k]
    delete require.cache[require.resolve('../battle/liveSpawner.js')]
    const s = require('../battle/liveSpawner.js')
    // 默认（取自 summon-whitelist.json 的 pusher 段）
    check('E1', s.PUSH_INTERVAL_MS === 30000, `推手周期 30s  -- v=${s.PUSH_INTERVAL_MS}`)
    check('E2', s.PUSH_PER_SIDE === 3 && s.PUSH_TOTAL_PER_CYCLE === 6, `每边 3 / 合计 6  -- perSide=${s.PUSH_PER_SIDE} total=${s.PUSH_TOTAL_PER_CYCLE}`)
    check('E3', s.PUSH_TYPES_PER_SIDE === 3 && s.PUSH_MAX_PER_SIDE === 400, `每边挑 3 种 / 上限 400  -- types=${s.PUSH_TYPES_PER_SIDE} cap=${s.PUSH_MAX_PER_SIDE}`)
    // E4：池 = pusher.pool 各类别的全部类型 减 pusher.exclude（执行者）；**不含 building**
    //     （不硬编码数量 —— 白名单加兵后仍应自动成立）
    const wlx = require('../battle/summon-whitelist.json')
    const expectPool = []
    for (const c of ((wlx.pusher && wlx.pusher.pool) || ['land', 'air'])) {
      for (const e of ((wlx.categories || {})[c] || [])) {
        if ((wlx.pusher && (wlx.pusher.exclude || []).includes(e.type))) continue
        expectPool.push(e.type)
      }
    }
    const poolOk = s.PUSH_POOL.length === expectPool.length && expectPool.every((t) => s.PUSH_POOL.includes(t)) &&
      !s.PUSH_POOL.includes('Ek星舰') && s.PUSH_POOL.includes('EkWardenMechX') && s.PUSH_POOL.includes('EkBuzzard') &&
      !s.PUSH_POOL.includes('c_turret_t3_gun') && !s.PUSH_POOL.includes('EkTowerRifleman')
    check('E4', poolOk, `推手池=land+air 排除执行者→${expectPool.length}；不含 building  -- pool=${JSON.stringify(s.PUSH_POOL)}`)
    // E5：白名单模式生效
    check('E5a', s.WL_ON === true && s.resolveWhitelist('狂暴者') === 'EkWardenMechX', '白名单：狂暴者 → EkWardenMechX')
    check('E5b', s.resolveWhitelist('战车') === undefined && s.resolveWhitelist('坦克') === undefined, '白名单：旧原版词（战车/坦克）不可召唤')
    check('E5c', s.resolveWhitelist('executor') === undefined && s.resolveWhitelist('执行者') === undefined, '白名单：执行者只走礼物、不进弹幕')
    check('E5d', s.resolveWhitelist('百夫长') === 'Ek_beamGunshipA_5' && s.resolveWhitelist('顶级炮塔') === 'c_turret_t3_gun', '白名单：百夫长 / 原版炮塔 可召唤')
    // E6：env 覆盖（RW_PUSH_PER_SIDE=20）
    process.env.RW_PUSH_PER_SIDE = '20'
    delete require.cache[require.resolve('../battle/liveSpawner.js')]
    const s2 = require('../battle/liveSpawner.js')
    check('E6', s2.PUSH_PER_SIDE === 20 && s2.PUSH_TOTAL_PER_CYCLE === 40, `RW_PUSH_PER_SIDE=20 → 每边 20  -- perSide=${s2.PUSH_PER_SIDE}`)
    delete process.env.RW_PUSH_PER_SIDE
    delete require.cache[require.resolve('../battle/liveSpawner.js')]

    // E7：零门槛入口 —— 光发阵营字 → 1 个基础兵
    const b1 = s.parseDanmaku('红'); const b2 = s.parseDanmaku('蓝方')
    check('E7', !!(b1 && b1.unitType === 'EkBuzzard' && b1.count === 1 && b1.basic === true && b1.team === 1),
      `「红」→ 基础兵 x1  -- ${JSON.stringify(b1)}`)
    check('E7b', !!(b2 && b2.unitType === 'EkBuzzard' && b2.team === 2), `「蓝方」→ 基础兵  -- ${JSON.stringify(b2)}`)
    // E8：按单价分档的数量上限（≤2万→10 / 2万-8万→5 / >8万→2）
    check('E8a', s.parseDanmaku('红99狂暴者').count === 2, `狂暴者(160k)→2  got ${s.parseDanmaku('红99狂暴者').count}`)
    check('E8b', s.parseDanmaku('红99浪人').count === 5, `浪人(72k)→5  got ${s.parseDanmaku('红99浪人').count}`)
    check('E8c', s.parseDanmaku('红99秃鹰').count === 10, `秃鹰(18k)→10  got ${s.parseDanmaku('红99秃鹰').count}`)
    // E9：冷却 3s
    check('E9', s.spawnCooldownMs() === 3000, `冷却 3000ms  -- v=${s.spawnCooldownMs()}`)
  }

  console.log('')
  console.log(`${pass} PASS / ${fail} FAIL`)
  process.exit(fail ? 1 : 0)
})().catch((e) => {
  console.error('verify_automation 异常:', e && e.stack)
  process.exit(1)
})
