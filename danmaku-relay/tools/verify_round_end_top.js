'use strict'
/**
 * verify_round_end_top.js — 离线回归：结算露出（获胜阵营 + 贡献榜前三）
 *
 * 模拟 `round.on('ended')`，断言：
 *   ① 游戏内播报含**获胜阵营**（原有）；
 *   ② 追加**贡献榜前三**（昵称、按 spawns 排序）；
 *   ③ 播报文本经 announce 净化（showMessage 里不含裸单引号/反斜杠 —— 否则脚本断裂）。
 *
 * 跑法：  node tools/verify_round_end_top.js
 * 零副作用：waifu 关闭、Debug 发送器内存 mock，不连游戏不碰中继。退出码 0 = 全过。
 */
process.env.RW_WAIFU_ENABLED = '0'

let pass = 0
let fail = 0
const lines = []
function check (name, ok, detail) {
  if (ok) { pass++; lines.push(`[PASS] ${name}${detail ? '  -- ' + detail : ''}`) } else { fail++; lines.push(`[FAIL] ${name}${detail ? '  -- ' + detail : ''}`) }
}

for (const m of ['../battle/index.js', '../battle/leaderboard.js']) {
  try { delete require.cache[require.resolve(m)] } catch (e) { /* ignore */ }
}
const battle = require('../battle')
const spawner = battle.spawner
const lb = battle.leaderboard

const sent = []
// announce() 走的是 spawner.sendCommand（不是 dispatch 的 _send）——直接覆盖以捕获播报文本。
// dispatch() 在 _send 为空时也回落 sendCommand，故这一处覆盖同时覆盖两条出口。
spawner.sendCommand = (cmd) => { sent.push(cmd); return true }

// 造一份观众贡献：spawns 降序 张三>李四>王五>赵六
lb.reset()
lb.recordSpawn('p1', '张三', 1, 10, 3500)
lb.recordSpawn('p2', '李四', 2, 8, 2800)
lb.recordSpawn('p3', '王五', 1, 5, 1750)
lb.recordSpawn('p4', '赵六', 2, 3, 1050)

// 模拟一轮结束（红方胜）
battle.round.roundNumber = 7
battle.round.roundStartTime = Date.now() - 213000
battle.round.spawnCount = { red: 20, blue: 15 }
battle.round.outcome = { redDefeated: false, blueDefeated: true, winner: 'red' }

sent.length = 0
battle.round.emit('ended', {
  round: 7, reason: 'engine-end', duration: 213000,
  kills: { red: 0, blue: 0 }, spawns: { red: 20, blue: 15 },
  outcome: { redDefeated: false, blueDefeated: true, winner: 'red' }
})

const msgs = sent.filter((c) => c.includes('showMessage'))
const textOf = (c) => (c.match(/showMessage\('([\s\S]*)'\)/) || [])[1] || ''

check('A1 结算播报含获胜阵营（红方）', msgs.some((m) => textOf(m).includes('红方')), msgs.join(' | '))
check('A2 结算播报含贡献榜前三 张三/李四/王五',
  msgs.some((m) => textOf(m).includes('张三') && textOf(m).includes('李四') && textOf(m).includes('王五')), msgs.join(' | '))
check('A3 不含第四名 赵六（只报前三）', msgs.every((m) => !textOf(m).includes('赵六')), msgs.join(' | '))
check('A4 showMessage 文本净化（每条恰好一对包裹单引号，无裸引号）',
  msgs.length > 0 && msgs.every((m) => ((m.match(/'/g) || []).length === 2)), msgs.join(' | '))

// 纯函数 buildTopText（若已导出）
if (typeof battle.buildTopText === 'function') {
  check('B1 buildTopText([张三,李四,王五]) 含序号与名字',
    /1\.张三/.test(battle.buildTopText([{ name: '张三' }, { name: '李四' }, { name: '王五' }])),
    battle.buildTopText([{ name: '张三' }, { name: '李四' }]))
  check('B2 buildTopText([]) = 空串', battle.buildTopText([]) === '')
  check('B3 buildTopText(缺 name) 回退占位不炸', typeof battle.buildTopText([{}]) === 'string' && battle.buildTopText([{}]).length > 0)
} else {
  check('B1 buildTopText 已导出', false, 'buildTopText 未导出')
}

lines.forEach((l) => console.log(l))
console.log(`\n${pass} PASS / ${fail} FAIL   (offline)`)
process.exit(fail ? 1 : 0)
