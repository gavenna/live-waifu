'use strict'
/**
 * verify_viewer_team.js — 离线回归：观众召唤兵落在**无 AI 宿主队**（红 team3 / 蓝 team4），
 *                          而不是有 AI 的主队（team1 / team2）。
 *
 * 背景（2026-09-19，用户实测 + 引擎代码）：
 *   观众兵若落在有 AI 的主队上，本队 AI 每 tick 会重新指派自己队的单位、覆盖脚本下的巡逻令 av.j
 *   ⇒ 兵"走到一半被叫回家"。修法：兵落到"同阵营里不受 AI 指挥的玩家槽位"——地图 live_dire.tmx
 *   的 team_3_info/team_4_info 定义了这两个席位（allyGroup 红1/蓝2 + disabledAI），
 *   disabledAI 让该队 AI 的更新入口早退、不下任何命令（game\a\a.java:746/919 `if(aZ||aX)return`）。
 *
 * 跑法：  node tools/verify_viewer_team.js
 * 零副作用：不连游戏、不碰中继，全部在内存 mock 上跑。退出码 0 = 全过。
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

// ---------- 临时 econ_live.txt（E 段用） ----------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-verify-'))
const liveFile = path.join(tmpDir, 'econ_live.txt')
function writeLive (rows) {
  const body = ['# econ_live ' + Date.now() + ' 100']
    .concat(rows.map((r) => `team ${r.id} ${r.balance} ${r.income}`)).join('\n') + '\n'
  const tmp = liveFile + '.tmp'
  fs.writeFileSync(tmp, body, 'utf8')
  if (fs.existsSync(liveFile)) fs.unlinkSync(liveFile)
  fs.renameSync(tmp, liveFile)
  try { require('../battle/economy').readLive(true) } catch (e) { /* 未加载时忽略 */ }
}

const LIVE = require.resolve('../battle/liveSpawner.js')
const TEAMS = require.resolve('../battle/teams.js')
const ECON = require.resolve('../battle/economy.js')

/** 用给定环境重载 liveSpawner，返回 { sp, sent }（sent = 收集到的命令） */
function freshSpawner (env) {
  for (const k of ['RW_PATROL_ENABLED', 'RW_ECON_ENABLED', 'RW_ECON_FILE', 'RW_ECON_MAX_AGE_MS']) delete process.env[k]
  for (const k of Object.keys(env || {})) process.env[k] = env[k]
  delete require.cache[TEAMS]
  delete require.cache[ECON]
  delete require.cache[LIVE]
  const sp = require(LIVE)
  const sent = []
  sp.setSendCommandForTest((cmd) => { sent.push(cmd); return true })
  return { sp, sent }
}

// ================= A. 宿主队常量 =================
{
  const teams = require('../battle/teams')
  check('A1 RED_VIEWER_TEAM=3', teams.RED_VIEWER_TEAM === 3, 'v=' + teams.RED_VIEWER_TEAM)
  check('A2 BLUE_VIEWER_TEAM=4', teams.BLUE_VIEWER_TEAM === 4, 'v=' + teams.BLUE_VIEWER_TEAM)
  check('A3 阵营主队仍是 1/2', teams.RED_TEAM === 1 && teams.BLUE_TEAM === 2)
}

// ================= B. parseDanmaku 带 viewerTeam =================
{
  const { sp } = freshSpawner({})
  const r = sp.parseDanmaku('红3狂暴者')
  check('B1 红「红3狂暴者」→ team1 / viewerTeam3 / count2（王牌档 >8万 封顶 2）',
    r && r.team === 1 && r.viewerTeam === 3 && r.count === 2, JSON.stringify(r))
  const b = sp.parseDanmaku('蓝10秃鹰')
  check('B2 蓝「蓝10秃鹰」→ team2 / viewerTeam4 / count10（常备档 ≤2万）',
    b && b.team === 2 && b.viewerTeam === 4 && b.count === 10, JSON.stringify(b))
}

// ================= C. 落兵命令用 viewer 队（经济关） =================
{
  const { sp, sent } = freshSpawner({ RW_PATROL_ENABLED: '1', RW_ECON_ENABLED: '0' })
  const r = sp.spawnUnit({ team: 1, teamName: '红方', unitType: 'tank', count: 2 }, 'viewer-R')
  const sp1 = sent.filter((c) => c.includes('spawnPatrol'))
  check('C1 红方 spawnPatrol 落在 team3（2 条）',
    sp1.length === 2 && sp1.every((c) => c.includes(', 3, ')), sp1.join(' | '))
  // 巡逻目标与地图绑定，从 PATROL_TARGETS 推导，避免换图后测试假红
  const _PTC2 = require('../battle/liveSpawner.js').PATROL_TARGETS[1]
  check('C2 红方巡逻目标=敌方指挥中心（按 PATROL_TARGETS 推导）', sp1.some((c) => c.includes(`${_PTC2.x}.0, ${_PTC2.y}.0`)), sp1[0])
  check('C3 返回值带 viewerTeam=3', r.viewerTeam === 3, 'v=' + r.viewerTeam)

  sent.length = 0
  sp.spawnUnit({ team: 2, teamName: '蓝方', unitType: 'mammothTank', count: 1 }, 'viewer-B')
  const sp2 = sent.filter((c) => c.includes('spawnPatrol'))
  check('C4 蓝方 spawnPatrol 落在 team4', sp2.length === 1 && sp2[0].includes(', 4, '), sp2[0])
  const _PTC5 = require('../battle/liveSpawner.js').PATROL_TARGETS[2]
  check('C5 蓝方巡逻目标=敌方指挥中心（按 PATROL_TARGETS 推导）', sp2[0].includes(`${_PTC5.x}.0, ${_PTC5.y}.0`), sp2[0])
}

// ================= D. 巡逻关闭时 createUnit 也落 viewer 队 =================
{
  const { sp, sent } = freshSpawner({ RW_PATROL_ENABLED: '0', RW_ECON_ENABLED: '0' })
  sp.spawnUnit({ team: 1, teamName: '红方', unitType: 'tank', count: 1 }, 'viewer-R2')
  const cu = sent.filter((c) => c.includes('createUnit'))
  check('D1 RW_PATROL_ENABLED=0 → createUnit 仍落 team3',
    cu.length === 1 && cu[0].includes(', 3, false)'), cu[0])
}

// ================= E. 经济扣款记**观众宿主队**（2026-09-27 分账后） =================
{
  writeLive([{ id: 1, balance: 5000, income: 67 }, { id: 3, balance: 5000, income: 67 }])
  const { sp, sent } = freshSpawner({ RW_PATROL_ENABLED: '1', RW_ECON_ENABLED: '1', RW_ECON_FILE: liveFile, RW_ECON_MAX_AGE_MS: '5000' })
  sent.length = 0
  const r = sp.spawnUnit({ team: 1, teamName: '红方', unitType: 'tank', count: 2 }, 'viewer-R3')
  check('E1 扣款记在观众宿主队 team3（分账：tank 350×2=700）',
    sent.some((c) => c === 'script debug.addTeamCredits(3, -700)'), sent.join(' | '))
  check('E2 兵仍落 team3', sent.filter((c) => c.includes('spawnPatrol')).every((c) => c.includes(', 3, ')),
    sent.filter((c) => c.includes('spawnPatrol')).join(' | '))
  check('E3 回执带 viewerTeam=3 与扣款额', r.viewerTeam === 3 && r.economy && r.economy.spent === 700, JSON.stringify(r.economy))
}

for (const l of lines) console.log(l)
console.log('')
console.log(`${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
