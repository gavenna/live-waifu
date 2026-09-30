'use strict'
/**
 * verify_viewer_wallet.js — 离线回归：**观众独立钱包（分账）**
 *
 * 语义（2026-09-27 用户拍板）：观众的钱与 AI 主队隔离。
 *   · 观众召唤 → 从**观众宿主队**扣款（红=team3 / 蓝=team4）
 *   · 观众点赞/关注 → 加**观众宿主队**
 *   · AI 主队（team1/2）不被观众账目扰动（AI 自己也在花它的钱）
 *
 * 跑法：  node tools/verify_viewer_wallet.js
 * 零副作用：临时 econ_live / 临时 battle-config + 内存 mock「Debug Socket 发送器」。
 *           不连游戏、不碰中继、不改真实 data/ 与 <GAME>\econ_live.txt。
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallet-verify-'))
const liveFile = path.join(tmpDir, 'econ_live.txt')
function writeLive (rows, frame) {
  const body = ['# econ_live ' + Date.now() + ' ' + (frame || 100)]
    .concat(rows.map((r) => `team ${r.id} ${r.balance} ${r.income}`)).join('\n') + '\n'
  const tmp = liveFile + '.tmp'
  fs.writeFileSync(tmp, body, 'utf8')
  if (fs.existsSync(liveFile)) fs.unlinkSync(liveFile)
  fs.renameSync(tmp, liveFile)
}

// 环境必须在 require 之前设好（economy / battleConfig / liveSpawner 在模块加载时读 env）
process.env.RW_ECON_FILE = liveFile
process.env.RW_ECON_ENABLED = '1'
process.env.RW_ECON_MAX_AGE_MS = '5000'
process.env.RW_PATROL_ENABLED = '1'
process.env.RW_BATTLE_CONFIG_FILE = path.join(tmpDir, 'battle-config.json')

for (const m of ['../battle/economy.js', '../battle/battleConfig.js', '../battle/teams.js', '../battle/liveSpawner.js', '../battle/index.js']) {
  try { delete require.cache[require.resolve(m)] } catch (e) { /* ignore */ }
}

const economy = require('../battle/economy')
const cfg = require('../battle/battleConfig')
const teams = require('../battle/teams')
const spawner = require('../battle/liveSpawner')
const battle = require('../battle')

const sent = []
spawner.setSendCommandForTest((cmd) => { sent.push(cmd); return true })

// 默认分账模式（除非另行设置）——确保钱包目标是 viewer 队
cfg.loadDefaults()
check('Z0 walletMode 默认 viewer', cfg.effective().walletMode === 'viewer', 'v=' + cfg.effective().walletMode)

// ---------- A. viewerTeamOf 映射 ----------
check('A1 viewerTeamOf(红1)=3', teams.viewerTeamOf(1) === 3, 'v=' + teams.viewerTeamOf(1))
check('A2 viewerTeamOf(蓝2)=4', teams.viewerTeamOf(2) === 4, 'v=' + teams.viewerTeamOf(2))
check('A3 viewerTeamOf(其它原样)', teams.viewerTeamOf(9) === 9, 'v=' + teams.viewerTeamOf(9))

// ---------- B. 召唤扣 viewer 队（红→3 / 蓝→4） ----------
writeLive([
  { id: 1, balance: 1000000, income: 664 }, { id: 2, balance: 1000000, income: 3286 },
  { id: 3, balance: 1000000, income: 0 }, { id: 4, balance: 1000000, income: 0 }], 100)
economy.readLive(true)

sent.length = 0
const rR = spawner.spawnUnit({ team: 1, teamName: '红方', unitType: 'tank', count: 3, viewerTeam: 3 }, 'w-R')
check('B1 红方召唤扣 viewer 队 team3（tank 350×3=1050）',
  sent.some((c) => c === 'script debug.addTeamCredits(3, -1050)'), sent.join(' | '))
check('B2 不扣 AI 主队 team1', !sent.some((c) => /addTeamCredits\(1,/.test(c)), sent.join(' | '))
check('B3 回执 spent=1050、余额前=1000000', rR.economy && rR.economy.spent === 1050 && rR.economy.balanceBefore === 1000000, JSON.stringify(rR.economy))

sent.length = 0
spawner.spawnUnit({ team: 2, teamName: '蓝方', unitType: 'heavyTank', count: 1, viewerTeam: 4 }, 'w-B')
check('B4 蓝方召唤扣 viewer 队 team4（heavyTank 800）',
  sent.some((c) => c === 'script debug.addTeamCredits(4, -800)'), sent.join(' | '))
check('B5 不扣 AI 主队 team2', !sent.some((c) => /addTeamCredits\(2,/.test(c)), sent.join(' | '))

// B6: 缺 viewerTeam 字段时回退 viewerTeamOf(team)
sent.length = 0
spawner.spawnUnit({ team: 1, teamName: '红方', unitType: 'tank', count: 1 }, 'w-R-fallback')
check('B6 缺 viewerTeam 时回退到 team3', sent.some((c) => c === 'script debug.addTeamCredits(3, -350)'), sent.join(' | '))

// ---------- C. 余额不足按 **viewer 队** 余额判定 ----------
writeLive([
  { id: 1, balance: 1000000, income: 664 }, { id: 2, balance: 1000000, income: 3286 },
  { id: 3, balance: 100, income: 0 }, { id: 4, balance: 100, income: 0 }], 200)
economy.readLive(true)
sent.length = 0
const rIns = spawner.spawnUnit({ team: 1, teamName: '红方', unitType: 'tank', count: 3, viewerTeam: 3 }, 'w-R-ins')
check('C1 viewer 队余额不足(team3=100<1050) → 拒绝',
  rIns.success === false && rIns.economy && rIns.economy.insufficient === true, JSON.stringify(rIns.economy))
check('C2 拒绝时无扣款、无生兵命令', sent.length === 0, sent.join(' | '))
check('C3 拒绝回执带 viewer 队余额', rIns.economy && rIns.economy.balance === 100, JSON.stringify(rIns.economy))

// ---------- D. handleCredits 加 viewer 队 ----------
writeLive([
  { id: 1, balance: 1000, income: 0 }, { id: 2, balance: 1000, income: 0 },
  { id: 3, balance: 1000, income: 0 }, { id: 4, balance: 1000, income: 0 }], 300)
economy.readLive(true)
cfg.setConfig({ likeCredits: 700, followCredits: 9000 }, 'default')
battle.round.state = 'FIGHTING'
battle._playerTeams.clear()
battle.dispatchMessage({ type: 'join', team: 'red', playerId: 'w1', playerName: '甲' })

sent.length = 0
battle.handleCredits({ type: 'credits', source: 'like', playerId: 'w1', playerName: '甲' })
check('D1 红归属点赞 → 加 viewer 队 team3（+700）',
  sent.some((c) => /addTeamCredits\(3, 700\)/.test(c)), sent.join(' | '))
check('D2 不加 AI 主队 team1/2', !sent.some((c) => /addTeamCredits\([12], /.test(c)), sent.join(' | '))

battle._playerTeams.clear()
battle.dispatchMessage({ type: 'join', team: 'blue', playerId: 'w2', playerName: '乙' })
sent.length = 0
battle.handleCredits({ type: 'credits', source: 'follow', playerId: 'w2', playerName: '乙' })
check('D3 蓝归属关注 → 加 viewer 队 team4（+9000）',
  sent.some((c) => /addTeamCredits\(4, 9000\)/.test(c)), sent.join(' | '))
battle.round.state = 'IDLE'

// ---------- E. 榜单阵营余额读 **viewer 池** ----------
writeLive([
  { id: 1, balance: 999999, income: 0 }, { id: 2, balance: 888888, income: 0 },
  { id: 3, balance: 12345, income: 0 }, { id: 4, balance: 54321, income: 0 }], 400)
economy.readLive(true)
const lbSnap = battle.leaderboardSnapshot()
check('E1 红阵营余额 = 观众池 team3（12345）', lbSnap.factions && lbSnap.factions.red && lbSnap.factions.red.balance === 12345,
  JSON.stringify(lbSnap.factions && lbSnap.factions.red))
check('E2 蓝阵营余额 = 观众池 team4（54321）', lbSnap.factions && lbSnap.factions.blue && lbSnap.factions.blue.balance === 54321,
  JSON.stringify(lbSnap.factions && lbSnap.factions.blue))

// ---------- F. shared 模式回退到旧行为（AI 主队） ----------
cfg.setConfig({ walletMode: 'shared' }, 'default')
check('F0 walletMode 已切 shared', cfg.effective().walletMode === 'shared', 'v=' + cfg.effective().walletMode)
writeLive([
  { id: 1, balance: 1000000, income: 0 }, { id: 2, balance: 1000000, income: 0 },
  { id: 3, balance: 1000000, income: 0 }, { id: 4, balance: 1000000, income: 0 }], 500)
economy.readLive(true)
sent.length = 0
spawner.spawnUnit({ team: 1, teamName: '红方', unitType: 'tank', count: 1, viewerTeam: 3 }, 'w-shared')
check('F1 shared 模式扣回 AI 主队 team1', sent.some((c) => c === 'script debug.addTeamCredits(1, -350)'), sent.join(' | '))
cfg.setConfig({ walletMode: 'viewer' }, 'default')

// ---------- G. 阵营级配额（每队每轮观众兵上限，防一边倒） ----------
process.env.RW_TEAM_CAP_PER_ROUND = '5'
writeLive([
  { id: 1, balance: 1000000, income: 0 }, { id: 2, balance: 1000000, income: 0 },
  { id: 3, balance: 1000000, income: 0 }, { id: 4, balance: 1000000, income: 0 }], 600)
economy.readLive(true)

spawner.resetTeamSpawnCount()
sent.length = 0
const rCap1 = spawner.spawnUnit({ team: 1, teamName: '红方', unitType: 'tank', count: 10, viewerTeam: 3 }, 'cap-1')
check('G1 单条超过上限(10>5) → 拒绝', rCap1.success === false && rCap1.economy && rCap1.economy.capped === true, JSON.stringify(rCap1.economy))
check('G2 配额拒绝时无扣款命令', !sent.some((c) => /addTeamCredits/.test(c)), sent.join(' | '))

spawner.resetTeamSpawnCount()
spawner.spawnUnit({ team: 1, teamName: '红方', unitType: 'tank', count: 3, viewerTeam: 3 }, 'cap-2')
const rCap2 = spawner.spawnUnit({ team: 1, teamName: '红方', unitType: 'tank', count: 3, viewerTeam: 3 }, 'cap-3')
check('G3 累计超上限(3+3>5) → 拒绝', rCap2.success === false && rCap2.economy && rCap2.economy.capped === true, JSON.stringify(rCap2 && rCap2.economy))

const rCap3 = spawner.spawnUnit({ team: 2, teamName: '蓝方', unitType: 'tank', count: 5, viewerTeam: 4 }, 'cap-4')
check('G4 蓝方配额独立（不受红方计数影响）', rCap3.success === true, JSON.stringify(rCap3.economy))
delete process.env.RW_TEAM_CAP_PER_ROUND

// ---------- 清理 ----------
try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (e) { /* ignore */ }
lines.forEach((l) => console.log(l))
console.log(`\n${pass} PASS / ${fail} FAIL   (offline, tmp cleaned)`)
process.exit(fail ? 1 : 0)
