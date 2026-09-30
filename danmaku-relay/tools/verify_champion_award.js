'use strict'
/**
 * verify_champion_award.js — 离线回归：荣誉 / 装逼奖励（**纯展示，不加战力**）
 *
 * A. 称号映射：上一轮贡献榜前三 → 下一轮代表单位头顶带【冠军/亚军/季军】前缀。
 * B. 端到端：一轮结束 → 记冠军 → 下一轮可读；再一轮覆盖清除。
 * C. OBS 榜单前三行高亮（静态检查 leaderboard.html）。
 *
 * 跑法：  node tools/verify_champion_award.js
 * 零副作用：waifu 关闭、Debug 发送器内存 mock。退出码 0 = 全过。
 */
const fs = require('fs')
const path = require('path')
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
const lb = battle.leaderboard
battle.spawner.sendCommand = () => true   // swallow announce

// ---------- A. 称号纯函数 ----------
battle.setChampions([])
check('A1 未设置时 championTitleOf 为空', battle.championTitleOf('p1') === '', 'v=' + battle.championTitleOf('p1'))

battle.setChampions([{ pid: 'p1', name: '张三' }, { pid: 'p2', name: '李四' }, { pid: 'p3', name: '王五' }])
check('A2 p1 → 冠军', battle.championTitleOf('p1') === '冠军', battle.championTitleOf('p1'))
check('A3 p2 → 亚军', battle.championTitleOf('p2') === '亚军', battle.championTitleOf('p2'))
check('A4 p3 → 季军', battle.championTitleOf('p3') === '季军', battle.championTitleOf('p3'))
check('A5 p9（榜外）→ 空', battle.championTitleOf('p9') === '', battle.championTitleOf('p9'))

check('A6 repLabelText 带称号前缀', battle.repLabelText('p1', '张三') === '【冠军】张三', battle.repLabelText('p1', '张三'))
check('A7 repLabelText 榜外回退裸名', battle.repLabelText('p9', '路人') === '路人', battle.repLabelText('p9', '路人'))
check('A8 repLabelText 净化单引号', battle.repLabelText('p9', "a'b") === 'ab', battle.repLabelText('p9', "a'b"))

// ---------- B. 端到端：结束 → 记冠军 → 下一轮覆盖 ----------
lb.reset()
lb.recordSpawn('q1', '甲', 1, 10, 3500)
lb.recordSpawn('q2', '乙', 2, 8, 2800)
lb.recordSpawn('q3', '丙', 1, 5, 1750)

battle.round.roundNumber = 1
battle.round.roundStartTime = Date.now() - 1000
battle.round.spawnCount = { red: 1, blue: 1 }
battle.round.outcome = { redDefeated: false, blueDefeated: true, winner: 'red' }
battle.round.emit('ended', {
  round: 1, reason: 'engine-end', duration: 1000,
  kills: { red: 0, blue: 0 }, spawns: { red: 1, blue: 1 },
  outcome: { redDefeated: false, blueDefeated: true, winner: 'red' }
})
check('B1 结算后 q1 → 冠军', battle.championTitleOf('q1') === '冠军', battle.championTitleOf('q1'))
check('B2 榜单重排后 q3 → 季军', battle.championTitleOf('q3') === '季军', battle.championTitleOf('q3'))
check('B3 上一轮 p1 称号被本轮覆盖清除', battle.championTitleOf('p1') === '', battle.championTitleOf('p1'))

// ---------- C. OBS 榜单前三高亮（静态） ----------
const html = fs.readFileSync(path.join(__dirname, '..', 'toolbox', 'leaderboard.html'), 'utf8')
check('C1 前三名高亮类 r1/r2/r3 齐', /\.r1 \.bar/.test(html) && /\.r2 \.bar/.test(html) && /\.r3 \.bar/.test(html))
check('C2 渲染时按行号套用高亮类', /cls\(i\)/.test(html))
check('C3 冠军金色实心条（--gold:#ffd400）', /--gold:#ffd400/.test(html) && /\.r1 \.bar \{ background:var\(--gold\)/.test(html))
check('C4 名字单元格已带 nm 类', /class="nm"/.test(html))
check('C5 名字高对比白字加粗（不灰）', /\.nm \{[^}]*font-weight:700/.test(html) && /\.nm \{[^}]*color:#fff/.test(html))
check('C6 尺寸按 200×400 设计（--w/--h）', /--w:200px/.test(html) && /--h:400px/.test(html))
check('C7 两榜各有行数上限（ROUND_TOP/SEASON_TOP）', /ROUND_TOP\s*=\s*\d+/.test(html) && /SEASON_TOP\s*=\s*\d+/.test(html))
// ↓ 黑底清晰度纪律（用户实测「灰蒙蒙/糊」的回归护栏）
check('C8 纯黑底（background:#000）', /background:#000/.test(html))
check('C9 无渐变（低码率会发糊/条带）', !/linear-gradient\(/.test(html))
check('C10 无 text-shadow（黑底上糊）', !/text-shadow\s*:/.test(html))
check('C11 无半透明面板底（「灰蒙蒙」的来源）', !/rgba\(0,\s*0,\s*0\s*,/.test(html))

// ---------- D. 冠军代表单位：称号前缀 + 徽章贴图（近景 zoom≥1 才贴名） ----------
const sentRep = []
battle.spawner.dispatch = (c) => { sentRep.push(c); return true }   // 捕获 spawnRepUnit 的 dispatch
battle.round.state = 'FIGHTING'
process.env.RW_CAM_ZOOM = '2'   // 近景 → 名字标签开
battle.setChampions([{ pid: 'join1', name: '冠' }])
battle.dispatchMessage({ type: 'join', team: 'red', playerId: 'join1', playerName: '冠' })
check('D1 代表单位标签带【冠军】前缀', sentRep.some((c) => c.includes('addLabel') && c.includes('【冠军】')), sentRep.join(' | '))
check('D2 冠军贴了徽章 addAvatar(badge_champion)', sentRep.some((c) => c.includes('badge_champion')), sentRep.join(' | '))
check('D3 榜外观众（非冠军）只贴名字、无徽章', (function () {
  sentRep.length = 0
  battle.dispatchMessage({ type: 'join', team: 'blue', playerId: 'join2', playerName: '路人' })
  return sentRep.some((c) => c.includes('addLabel')) && !sentRep.some((c) => c.includes('badge_champion'))
})(), sentRep.join(' | '))

// 皇冠位置（D6/D7）：应在头像**正上方**（x 居中于单位、y 在单位上方），不是右侧
;(function () {
  sentRep.length = 0
  battle.spawner.dispatch = (c) => { sentRep.push(c); return true }
  battle.setChampions([{ pid: 'pos1', name: '冠2' }])
  battle.dispatchMessage({ type: 'join', team: 'red', playerId: 'pos1', playerName: '冠2' })
  const rep = sentRep.find((c) => c.includes('spawnRep('))
  const bad = sentRep.find((c) => c.includes('badge_champion'))
  const rm = rep && rep.match(/spawnRep\('[^']+',\s*([\d.]+),\s*([\d.]+)/)
  const bm = bad && bad.match(/addAvatar\('[^']+',\s*(-?[\d.]+),\s*(-?[\d.]+)/)
  const X = rm ? Number(rm[1]) : null
  const Y = rm ? Number(rm[2]) : null
  const BX = bm ? Number(bm[1]) : null
  const BY = bm ? Number(bm[2]) : null
  check('D6 皇冠 x 居中于单位（X-10，非右侧 X+15）', !!(rm && bm) && Math.abs(BX - (X - 10)) <= 2, `X=${X} BX=${BX}`)
  check('D7 皇冠 y 在单位上方', !!(rm && bm) && BY < Y - 10, `Y=${Y} BY=${BY}`)
})()

// 缩放闸门：缩小视图（默认全景）不贴名字，避免多标签挤成一团
process.env.RW_CAM_ZOOM = '0.5'
sentRep.length = 0
battle.dispatchMessage({ type: 'join', team: 'red', playerId: 'join3', playerName: '远景' })
check('D4 缩小视图(zoom0.5<1.0) → 不贴名字标签', !sentRep.some((c) => c.includes('addLabel')), sentRep.join(' | '))
check('D5 缩小视图仍造代表单位（只省掉贴名）', sentRep.some((c) => c.includes('spawnRep')), sentRep.join(' | '))
delete process.env.RW_CAM_ZOOM

// ---------- E. 网格间距随镜头缩放放大（全景下头像不重叠）----------
// 头像/皇冠是屏幕固定像素；世界间距固定时全景(zoom≈0.4)会叠。令屏幕间距恒定：世界间距=54÷zoom。
battle.round.state = 'FIGHTING'
function repGapAt (z, pidA, pidB) {
  process.env.RW_CAM_ZOOM = String(z)
  const s = []
  battle.spawner.dispatch = (c) => { s.push(c); return true }
  battle.dispatchMessage({ type: 'join', team: 'red', playerId: pidA, playerName: pidA })
  battle.dispatchMessage({ type: 'join', team: 'red', playerId: pidB, playerName: pidB })
  const xs = s.filter((c) => c.includes('spawnRep('))
    .map((c) => Number((c.match(/spawnRep\('[^']+',\s*([\d.]+)/) || [])[1]))
  return xs.length === 2 ? Math.abs(xs[1] - xs[0]) : null
}
check('E1 近景(zoom=1) 网格间距=54（原值不放大）', repGapAt(1, 'gp1', 'gp2') === 54, 'gap=' + repGapAt(1, 'gp3', 'gp4'))
check('E2 全景(zoom=0.5) 网格间距=108（×2，防头像重叠）', repGapAt(0.5, 'gp5', 'gp6') === 108, 'gap=' + repGapAt(0.5, 'gp7', 'gp8'))
function repXsAt (z, team, pidA, pidB) {
  process.env.RW_CAM_ZOOM = String(z)
  const s = []
  battle.spawner.dispatch = (c) => { s.push(c); return true }
  battle.dispatchMessage({ type: 'join', team, playerId: pidA, playerName: pidA })
  battle.dispatchMessage({ type: 'join', team, playerId: pidB, playerName: pidB })
  return s.filter((c) => c.includes('spawnRep('))
    .map((c) => Number((c.match(/spawnRep\('[^']+',\s*([\d.]+)/) || [])[1]))
}
const rx = repXsAt(0.5, 'red', 'gd1', 'gd2')
check('E3 红方(锚点在画面右侧)向左铺 → x 递减', rx.length === 2 && rx[1] < rx[0], 'xs=' + rx.join(','))
const bx = repXsAt(0.5, 'blue', 'gd3', 'gd4')
check('E4 蓝方(锚点在画面左侧)向右铺 → x 递增', bx.length === 2 && bx[1] > bx[0], 'xs=' + bx.join(','))
delete process.env.RW_CAM_ZOOM

battle.round.state = 'IDLE'

lines.forEach((l) => console.log(l))
console.log(`\n${pass} PASS / ${fail} FAIL   (offline)`)
process.exit(fail ? 1 : 0)
