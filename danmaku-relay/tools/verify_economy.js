'use strict'
/**
 * verify_economy.js — 离线回归：经济接线（扣款 / 余额不足拒绝 / 关闭开关回退）
 *
 * 跑法：  node tools/verify_economy.js
 * 零副作用：全部在临时文件 + 内存 mock 上跑，不连游戏、不碰中继、不改真实 econ_live.txt。
 * 退出码 0 = 全过。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

let pass = 0
let fail = 0
const lines = []
function check (name, ok, detail) {
  if (ok) { pass++; lines.push(`[PASS] ${name}${detail ? '  -- ' + detail : ''}`) } else { fail++; lines.push(`[FAIL] ${name}${detail ? '  -- ' + detail : ''}`) }
}

// ---------- 造一个假的 econ_live.txt ----------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'econ-verify-'))
const liveFile = path.join(tmpDir, 'econ_live.txt')

function writeLive (teams, frame) {
  const rows = ['# econ_live ' + Date.now() + ' ' + (frame || 100)]
  for (const t of teams) rows.push(`team ${t.id} ${t.balance} ${t.income}`)
  const tmp = liveFile + '.tmp'
  fs.writeFileSync(tmp, rows.join('\n') + '\n', 'utf8')
  if (fs.existsSync(liveFile)) fs.unlinkSync(liveFile)
  fs.renameSync(tmp, liveFile)
  try { require('../battle/economy').readLive(true) } catch (e) { /* 模块尚未加载时忽略 */ }
}

// 环境必须在 require 之前设好（economy.js 在模块加载时读 env）
process.env.RW_ECON_FILE = liveFile
process.env.RW_ECON_ENABLED = '1'
process.env.RW_ECON_MAX_AGE_MS = '5000'
delete require.cache[require.resolve('../battle/economy.js')]
const economy = require('../battle/economy')

// ---------- A. 解析 ----------
writeLive([{ id: 0, balance: 100000, income: 18 }, { id: 1, balance: 5000, income: 67 }, { id: 2, balance: 200, income: 67 }])
const st = economy.status()
check('A1 开关已启用', economy.ENABLED === true)
check('A2 解析出 3 支队伍', st.teams.length === 3, JSON.stringify(st.teams))
check('A3 红方(1) 余额/收入正确', st.teams.find(t => t.id === 1).balance === 5000 && st.teams.find(t => t.id === 1).income === 67)
check('A4 数据新鲜(ageMs<2000)', st.ageMs != null && st.ageMs < 2000, 'ageMs=' + st.ageMs)

// ---------- B. 单价表 ----------
check('B1 tank=350', economy.priceOf('tank') === 350)
check('B2 heavyTank=800', economy.priceOf('heavyTank') === 800)
check('B3 未知单位返回 null', economy.priceOf('definitelyNotAUnit') === null)

// ---------- C. 扣款命令形状 ----------
const sent = []
const fakeSend = (cmd) => { sent.push(cmd); return true }
const c1 = economy.charge(1, 1050, fakeSend)
check('C1 charge 返回 charged=true', c1.charged === true)
check('C2 命令是 addTeamCredits(1, -1050)', sent[0] === 'script debug.addTeamCredits(1, -1050)', sent[0])
check('C3 传负数也能被规范成扣款', (function () { sent.length = 0; economy.charge(1, -700, fakeSend); return sent[0] === 'script debug.addTeamCredits(1, -700)' })())
check('C4 乐观更新：缓存余额已减少', economy.getTeam(1).balance === 5000 - 1050 - 700, 'now=' + Math.floor(economy.getTeam(1).balance))

// ---------- D. 召唤链路（含拒绝） ----------
delete require.cache[require.resolve('../battle/liveSpawner.js')]
const spawner = require('../battle/liveSpawner')
spawner.setSendCommandForTest(fakeSend)

// D1: 钱够 -> 生成 + 扣款
// ★ 2026-09-27 分账：观众召唤扣**观众宿主队**（红3/蓝4），故假 econ_live 必须含 team3/4。
writeLive([{ id: 1, balance: 5000, income: 67 }, { id: 2, balance: 200, income: 67 },
  { id: 3, balance: 5000, income: 67 }, { id: 4, balance: 200, income: 67 }], 200)
sent.length = 0
const r1 = spawner.spawnUnit({ team: 1, teamName: '红方', unitType: 'tank', count: 3 }, 'viewer-A')
check('D1 钱够 -> success', r1.success === true, JSON.stringify(r1.economy))
check('D2 扣款金额 = 350*3 = 1050', r1.economy && r1.economy.spent === 1050)
check('D3 扣 viewer 队 team3（分账：观众召唤扣红观众宿主队）', sent.some(c => c === 'script debug.addTeamCredits(3, -1050)'), sent.join(' | '))
check('D3b 不扣 AI 主队 team1', !sent.some(c => /addTeamCredits\(1,/.test(c)), sent.join(' | '))
check('D4 同时发出 3 条生兵命令', sent.filter(c => c.includes('createUnit') || c.includes('spawnPatrol')).length === 3)
// ★ 2026-09-19：默认开启「召唤的兵立刻拿巡逻令」⇒ 生兵命令走注入的 spawnPatrol
//   （造兵 + 只对这一个兵下 av.j 巡逻令，目标=敌方基地）。RW_PATROL_ENABLED=0 时回退为 createUnit。
const spawnCmds = sent.filter(c => c.includes('spawnPatrol'))
check('D4b 生兵走 spawnPatrol（默认开启巡逻）', spawnCmds.length === 3, spawnCmds[0] || '(none)')
// 巡逻目标从 PATROL_TARGETS 推导 —— 这些坐标**与地图绑定**，写死会让换图时测试假红
const _PT1 = spawner.PATROL_TARGETS[1]
check('D4c 巡逻目标=敌方指挥中心（红 team1 → 蓝方指挥中心，按 PATROL_TARGETS 推导）',
  spawnCmds.some(c => c.includes(`${_PT1.x}.0, ${_PT1.y}.0`)), spawnCmds.join(' | '))
check('D5 回执带余额前后与收入', r1.economy.balanceBefore === 5000 && r1.economy.balanceAfter === 3950 && r1.economy.income === 67)

// D2: 钱不够 -> 拒绝，且**不生成任何单位**（按 viewer 队 team4 余额判定）
writeLive([{ id: 2, balance: 200, income: 67 }, { id: 4, balance: 200, income: 67 }], 300)
sent.length = 0
const r2 = spawner.spawnUnit({ team: 2, teamName: '蓝方', unitType: 'heavyTank', count: 2 }, 'viewer-B')
check('D6 钱不够 -> success=false', r2.success === false, r2.reason)
check('D7 拒绝原因是余额不足', r2.economy && r2.economy.insufficient === true)
check('D8 需要金额 = 800*2 = 1600', r2.economy.need === 1600)
check('D9 拒绝时**没有** createUnit、**没有**扣款命令', sent.length === 0, sent.join(' | '))
check('D10 回执带上现有余额与收入', r2.economy.balance === 200 && r2.economy.income === 67)

// D3: 经济数据不可用（文件不存在）-> 拒绝，不生成
process.env.RW_ECON_FILE = path.join(tmpDir, 'does-not-exist.txt')
delete require.cache[require.resolve('../battle/economy.js')]
delete require.cache[require.resolve('../battle/liveSpawner.js')]
const spawner2 = require('../battle/liveSpawner')
spawner2.setSendCommandForTest(fakeSend)
sent.length = 0
const r3 = spawner2.spawnUnit({ team: 1, teamName: '红方', unitType: 'tank', count: 1 }, 'viewer-C')
check('D11 读不到经济数据 -> 拒绝', r3.success === false && r3.economy.ready === false, r3.reason)
check('D12 此时也没有生成单位', sent.filter(c => c.includes('createUnit')).length === 0)

// ---------- E. 开关关闭 -> 完全回退（与"免费召唤"一致） ----------
process.env.RW_ECON_ENABLED = '0'
process.env.RW_ECON_FILE = liveFile
writeLive([{ id: 1, balance: 10, income: 0 }], 400)
delete require.cache[require.resolve('../battle/economy.js')]
delete require.cache[require.resolve('../battle/liveSpawner.js')]
const spawnerOff = require('../battle/liveSpawner')
spawnerOff.setSendCommandForTest(fakeSend)
sent.length = 0
const r4 = spawnerOff.spawnUnit({ team: 1, teamName: '红方', unitType: 'tank', count: 2 }, 'viewer-D')
check('E1 关闭开关 -> 仍能生成（余额只有 $10 也不拦）', r4.success === true)
check('E2 关闭开关 -> 不发任何扣款命令', !sent.some(c => c.includes('addTeamCredits')), sent.join(' | '))
check('E3 关闭开关 -> economy 回执为 null（不进经济路径）', r4.economy === null)

// ---------- 清理 ----------
try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (e) {}

lines.forEach(l => console.log(l))
console.log(`\n${pass} PASS / ${fail} FAIL   (offline, ${tmpDir} cleaned)`)
process.exit(fail ? 1 : 0)
