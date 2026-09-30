'use strict'
/**
 * verify_danmaku_hint.js — 离线回归：**失败可见化**（无效指令给画面提示 + 冷却）
 *                          与**每轮开局的玩法提示**。
 *
 * 背景（2026-09-22 真机日志）：观众发 `4蜘蛛`（无红/蓝前缀）时 parseDanmaku 返回 null，
 *   handleDanmaku 只写 logger 就丢弃 ⇒ 观众感知 =「发了没反应」。修法是把「未识别」也变成
 *   画面可见提示（唯一画面通道 = `script debug.showMessage`，见 battle/index.js 的 announce()），
 *   但只对**看起来像指令**的弹幕提示（闲聊不打扰），且加**全局冷却**防刷屏。
 *
 * 打桩说明（为什么两路都要打）：
 *   · 生兵命令走 `spawner.dispatch`  → `spawner.setSendCommandForTest(fn)`
 *   · 画面播报走 `spawner.sendCommand`（announce 里是**直接调它**，不经过 dispatch）
 *     ⇒ 必须额外把 `spawner.sendCommand` 打桩，否则断言不到 showMessage。
 *
 * 跑法：  node tools/verify_danmaku_hint.js
 * 零副作用：不连游戏、不碰真实 9999（RW_DEBUG_PORT 指 19999）、不真开一局。
 * ⚠️ logger 会往 logs/combined.log 追加几行（与其它 verify 脚本一致）。
 */
process.env.RW_DEBUG_PORT = '19999'      // 别碰真实 9999
process.env.RW_HINT_COOLDOWN_MS = '250'  // 冷却加速到 250ms，便于断言「冷却内不重发 / 到期恢复」
process.env.RW_ECON_ENABLED = '0'        // 生兵路径不依赖 econ_live.txt
process.env.RW_AUTO_NEXT_MS = '0'        // 关掉自动续局定时器
process.env.RW_PUSH_INTERVAL_MS = '0'    // 关掉收局推手定时器
process.env.RW_SUMMON_WHITELIST = '0'    // 提示逻辑测试走旧映射（含「4蜘蛛」等无前缀场景）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
function check (name, ok, detail) {
  if (ok) { pass++; console.log(`[PASS] ${name}${detail !== undefined ? '  -- ' + detail : ''}`) }
  else { fail++; console.log(`[FAIL] ${name}${detail !== undefined ? '  -- ' + detail : ''}`) }
}
function safe (fn, fallback) { try { return fn() } catch (e) { return fallback } }
const J = (v) => (v === undefined ? 'undefined' : JSON.stringify(v))

;(async function main () {
  const battle = require('../battle/index.js')
  const spawner = require('../battle/liveSpawner.js')
  const { STATES } = require('../battle/roundManager.js')

  const sent = []
  function collect (cmd) { sent.push(cmd); return true }
  spawner.setSendCommandForTest(collect)  // 生兵命令（spawnPatrol / createUnit / addTeamCredits）
  spawner.sendCommand = collect           // 画面播报（announce 直接调 sendCommand）

  const showMsgs = () => sent.filter((c) => c.includes('debug.showMessage'))
  const hintMsgs = () => showMsgs().filter((c) => c.includes('格式不对哦'))
  const ruleMsgs = () => showMsgs().filter((c) => c.includes('替你支持的阵营打仗'))

  // ================= A. 判定与话术（纯函数） =================
  check('A1 looksLikeCommand(\'4蜘蛛\') → true（像指令：含兵种词，只是缺阵营）',
    safe(() => spawner.looksLikeCommand('4蜘蛛'), false) === true, J(safe(() => spawner.looksLikeCommand('4蜘蛛'), 'THROW')))
  check('A2 looksLikeCommand(\'红\') / (\'blue\') → true（含阵营词）',
    safe(() => spawner.looksLikeCommand('红'), false) === true && safe(() => spawner.looksLikeCommand('blue'), false) === true)
  check('A3 looksLikeCommand(\'咋玩\') → false（闲聊不打扰）',
    safe(() => spawner.looksLikeCommand('咋玩'), true) === false)
  check('A4 looksLikeCommand(\'没听懂\') → false',
    safe(() => spawner.looksLikeCommand('没听懂'), true) === false)
  check('A5 looksLikeCommand(\'？？？\') → false',
    safe(() => spawner.looksLikeCommand('？？？'), true) === false)
  check('A6 looksLikeCommand 空串 / null / undefined 不炸且为 false',
    safe(() => spawner.looksLikeCommand('') === false && spawner.looksLikeCommand(null) === false
      && spawner.looksLikeCommand(undefined) === false, false) === true)

  // 收紧（2026-09-22 负责人确认）：提示判定只看长度 ≥ 2 的兵种词，
  // 单字键（UNIT_MAP 的 `车`/`飞`）不再让含这些字的闲聊被判成「像指令」。
  // ⚠️ 只收紧 looksLikeCommand；parseDanmaku 的包含兜底仍保留单字键（解析容错需要它）。
  check('A8 looksLikeCommand(\'主播开车了\') → false（单字键「车」不再触发提示）',
    safe(() => spawner.looksLikeCommand('主播开车了'), true) === false,
    J(safe(() => spawner.looksLikeCommand('主播开车了'), 'THROW')))
  check('A9 looksLikeCommand(\'今天车很多\') → false',
    safe(() => spawner.looksLikeCommand('今天车很多'), true) === false)
  check('A10 looksLikeCommand(\'4蜘蛛\') 仍 true（≥2 字键不受影响）',
    safe(() => spawner.looksLikeCommand('4蜘蛛'), false) === true)

  const ruleText = safe(() => battle.ruleHintText(), null)
  check('A7 ruleHintText() 是含「红3狂暴者」的单行串（画面一行，不带换行）',
    typeof ruleText === 'string' && ruleText.includes('红3狂暴者') && !/[\r\n]/.test(ruleText), J(ruleText))
  check('A8 HINT_COOLDOWN_MS 读 RW_HINT_COOLDOWN_MS=250',
    battle.HINT_COOLDOWN_MS === 250, J(battle.HINT_COOLDOWN_MS))

  // ================= B. 无效指令 → 画面提示 + 冷却 =================
  sent.length = 0
  battle.handleDanmaku({ content: '4蜘蛛' })
  check('B1 「4蜘蛛」→ 画面出现 1 条格式提示（含「红3狂暴者」示范）',
    hintMsgs().length === 1 && hintMsgs()[0].includes('红3狂暴者'), J(hintMsgs()))
  check('B1b 提示走的是唯一画面通道 script debug.showMessage',
    /^script debug\.showMessage\('.*'\)$/.test(hintMsgs()[0] || ''), J(hintMsgs()[0]))

  const afterFirst = hintMsgs().length
  battle.handleDanmaku({ content: '4蜘蛛' })
  check('B2 冷却内再发「4蜘蛛」→ 不重发（防刷屏）', hintMsgs().length === afterFirst,
    `before=${afterFirst} after=${hintMsgs().length}`)

  battle.handleDanmaku({ content: '咋玩' })
  battle.handleDanmaku({ content: '没听懂' })
  check('B3 闲聊「咋玩」/「没听懂」→ 不提示', hintMsgs().length === afterFirst,
    `after=${hintMsgs().length}`)

  await sleep(350)
  battle.handleDanmaku({ content: '4蜘蛛' })
  check('B4 冷却到期（>250ms）后再发 → 恢复提示', hintMsgs().length === afterFirst + 1,
    `after=${hintMsgs().length}`)

  // ================= C. 有效指令走生兵，不误触发提示 =================
  battle.round.state = STATES.FIGHTING
  battle.round.roundStartTime = Date.now()
  sent.length = 0
  const r = safe(() => battle.handleDanmaku({ content: '红3战车', userId: 'viewer-R' }), null)
  check('C1 「红3战车」→ 走生兵路径（spawnPatrol），无格式提示',
    !!(r && r.success === true) && sent.some((c) => c.includes('spawnPatrol')) && hintMsgs().length === 0,
    J({ ok: !!(r && r.success), spawn: sent.filter((c) => c.includes('spawnPatrol'))[0], hint: hintMsgs().length }))

  sent.length = 0
  // 换个 userId：spawnUnit 有 per-user 500ms 冷却（SPAWN_INTERVAL_MS），同一个人连发会被挡
  const rc = safe(() => battle.handleDanmaku({ content: '红三猛犸', userId: 'viewer-R2' }), null)
  check('C2 「红三猛犸」（中文数量容错）→ 也走生兵，无提示',
    !!(rc && rc.success === true) && rc.unitType === 'mammothTank' && hintMsgs().length === 0,
    J({ unitType: rc && rc.unitType, hint: hintMsgs().length }))

  // ================= D. 每轮开局 → 一行玩法提示 =================
  sent.length = 0
  battle.round.emit('fighting', { round: 7 })
  check('D1 emit round「fighting」→ 画面出现一行玩法提示（接线通）', ruleMsgs().length === 1,
    J(ruleMsgs()))
  check('D2 提示文本就是 ruleHintText()',
    ruleMsgs()[0] === `script debug.showMessage('${ruleText}')`, J(ruleMsgs()[0]))
  check('D3 开局提示与「格式不对」提示是两条不同文案（不互相顶掉）',
    !!ruleMsgs()[0] && !ruleMsgs()[0].includes('格式不对'), J(ruleMsgs()[0]))
  // 清理 fighting 挂上的定时器/轮询（离线环境不许留背景任务）
  battle.stopGameWatchdog()
  spawner.stopRoundPusher()
  safe(() => battle.gameCtrl.stopWinWatch(), null)
  safe(() => battle.gameCtrl.stopEngineEndWatch(), null)
  battle.stopAutoNext()

  // ================= E. 冷却开关（RW_HINT_COOLDOWN_MS） =================
  {
    const IDX = require.resolve('../battle/index.js')
    for (const [raw, want] of [['0', 0], ['abc', 15000], ['-5', 15000], ['60000', 60000]]) {
      process.env.RW_HINT_COOLDOWN_MS = raw
      delete require.cache[IDX]
      const b = safe(() => require(IDX), null)
      check(`E RW_HINT_COOLDOWN_MS='${raw}' → ${want}`,
        !!b && b.HINT_COOLDOWN_MS === want, J(b && b.HINT_COOLDOWN_MS))
      safe(() => b.stopGameWatchdog(), null)
      safe(() => b.stopAutoNext(), null)
    }
    process.env.RW_HINT_COOLDOWN_MS = '250'
    delete require.cache[IDX]
  }

  console.log('')
  console.log(`${pass} PASS / ${fail} FAIL`)
  process.exit(fail ? 1 : 0)
})().catch((e) => {
  console.error('verify_danmaku_hint 异常:', e && e.stack)
  process.exit(1)
})
