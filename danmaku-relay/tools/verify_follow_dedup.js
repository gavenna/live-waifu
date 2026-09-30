'use strict'
/**
 * verify_follow_dedup.js — 离线回归：观众互动的两项质量修复
 *
 * A. **关注去重**：关注是账号级一次性行为，每人每场只发一次奖，
 *    防「取关再关注」/重复事件反复 +followCredits 刷钱。`RW_FOLLOW_ONCE=0` 关闭。
 * B. **点赞量化**：按连赞数计 —— 基础额 + (连赞数-1)×每赞加成，单次封顶。
 *
 * 跑法：  node tools/verify_follow_dedup.js
 * 零副作用：临时 econ_live / 临时 battle-config + 内存 mock 发送器。
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'follow-verify-'))
const liveFile = path.join(tmpDir, 'econ_live.txt')
function writeLive (rows, frame) {
  const body = ['# econ_live ' + Date.now() + ' ' + (frame || 100)]
    .concat(rows.map((r) => `team ${r.id} ${r.balance} ${r.income}`)).join('\n') + '\n'
  const tmp = liveFile + '.tmp'
  fs.writeFileSync(tmp, body, 'utf8')
  if (fs.existsSync(liveFile)) fs.unlinkSync(liveFile)
  fs.renameSync(tmp, liveFile)
}

process.env.RW_ECON_FILE = liveFile
process.env.RW_ECON_ENABLED = '1'
process.env.RW_ECON_MAX_AGE_MS = '5000'
process.env.RW_BATTLE_CONFIG_FILE = path.join(tmpDir, 'battle-config.json')
delete process.env.RW_FOLLOW_ONCE

for (const m of ['../battle/economy.js', '../battle/battleConfig.js', '../battle/liveSpawner.js', '../battle/index.js']) {
  try { delete require.cache[require.resolve(m)] } catch (e) { /* ignore */ }
}

const economy = require('../battle/economy')
const cfg = require('../battle/battleConfig')
const spawner = require('../battle/liveSpawner')
const battle = require('../battle')

const sent = []
spawner.setSendCommandForTest((cmd) => { sent.push(cmd); return true })

writeLive([
  { id: 1, balance: 1000, income: 0 }, { id: 2, balance: 1000, income: 0 },
  { id: 3, balance: 1000, income: 0 }, { id: 4, balance: 1000, income: 0 }], 100)
economy.readLive(true)
cfg.loadDefaults()
cfg.setConfig({ followCredits: 9000, likeCredits: 1000, likePerExtra: 10, likeCap: 5000 }, 'default')
battle.round.state = 'FIGHTING'
battle._playerTeams.clear()
if (battle._followRewarded) battle._followRewarded.clear()

// ---------- A. 关注去重：**时间窗**（同一人 N 分钟内只算一次，超过算新的） ----------
sent.length = 0
battle.handleCredits({ type: 'credits', source: 'follow', playerId: 'f1', playerName: '甲' })
check('A1 首次关注发钱（+9000）', sent.some((c) => /addTeamCredits\([34], 9000\)/.test(c)), sent.join(' | '))

sent.length = 0
const r2 = battle.handleCredits({ type: 'credits', source: 'follow', playerId: 'f1', playerName: '甲' })
check('A2 窗口内再关注不发钱', sent.length === 0, sent.join(' | '))
check('A3 返回 reason=follow-cooldown', r2 && r2.reason === 'follow-cooldown', JSON.stringify(r2))

// ★ 关键：把上次发奖时间倒拨到窗口之外 ⇒ 再关注算新的一次（「取关后再关注」的场景）
battle._followRewarded.set('f1', Date.now() - (battle.followWindowMs() + 1000))
sent.length = 0
battle.handleCredits({ type: 'credits', source: 'follow', playerId: 'f1', playerName: '甲' })
check('A4 超过窗口后再关注 → 再发钱（取关再关注能再拿）', sent.some((c) => /addTeamCredits\([34], 9000\)/.test(c)), sent.join(' | '))

sent.length = 0
battle.handleCredits({ type: 'credits', source: 'follow', playerId: 'f2', playerName: '乙' })
check('A5 不同观众各算一次', sent.some((c) => /addTeamCredits\([34], 9000\)/.test(c)), sent.join(' | '))

// 窗口=0 ⇒ 只算第一次（严格去重，时间倒拨也不放行）
process.env.RW_FOLLOW_WINDOW_MS = '0'
battle._followRewarded.set('f3', Date.now() - 99999999)
sent.length = 0
battle.handleCredits({ type: 'credits', source: 'follow', playerId: 'f3', playerName: '丙' })
check('A6 窗口=0（只算第一次）→ 久以前关注过也不再发', sent.length === 0, sent.join(' | '))
delete process.env.RW_FOLLOW_WINDOW_MS

// ---------- B. 点赞量化：按连赞数，单次封顶 ----------
sent.length = 0
battle.handleCredits({ type: 'credits', source: 'like', playerId: 'l1', count: 1 })
check('B1 单赞 = 基础额 1000', sent.some((c) => /addTeamCredits\([34], 1000\)/.test(c)), sent.join(' | '))

sent.length = 0
battle.handleCredits({ type: 'credits', source: 'like', playerId: 'l2', count: 50 })
check('B2 连赞 50 = 1000+(50-1)×10 = 1490', sent.some((c) => /addTeamCredits\([34], 1490\)/.test(c)), sent.join(' | '))

sent.length = 0
battle.handleCredits({ type: 'credits', source: 'like', playerId: 'l3', count: 9999 })
check('B3 超大连赞封顶 5000', sent.some((c) => /addTeamCredits\([34], 5000\)/.test(c)), sent.join(' | '))

sent.length = 0
battle.handleCredits({ type: 'credits', source: 'like', playerId: 'l4' })
check('B4 缺 count 视作 1（=基础额 1000，向后兼容）', sent.some((c) => /addTeamCredits\([34], 1000\)/.test(c)), sent.join(' | '))

// ---------- C. RW_FOLLOW_ONCE=0 → 完全关掉关注去重 ----------
process.env.RW_FOLLOW_ONCE = '0'
sent.length = 0
battle.handleCredits({ type: 'credits', source: 'follow', playerId: 'f1', playerName: '甲' })
check('C1 RW_FOLLOW_ONCE=0 → 关掉去重，重复关注也发钱', sent.some((c) => /addTeamCredits\([34], 9000\)/.test(c)), sent.join(' | '))
delete process.env.RW_FOLLOW_ONCE

battle.round.state = 'IDLE'

// ---------- D. 重复关注「闭嘴」：窗口内不再播报（只读探询，不记账） ----------
battle._followRewarded.clear()
check('D1 从没关注过 → 不在窗口内', battle.followOnCooldown('m1') === false)
check('D2 探询不发奖、也不记账（放行一次）', battle.followAllowed('m1') === true)
check('D3 刚关注过 → 在窗口内（应闭嘴）', battle.followOnCooldown('m1') === true)
// 关键：探询是只读的 —— 探询过之后再走发奖，仍应被正常拦（不会因探询而误放）
sent.length = 0
battle.handleCredits({ type: 'credits', source: 'follow', playerId: 'm1', playerName: 'M' })
check('D4 探询不影响发奖判定（窗口内依旧不发钱）', sent.length === 0, sent.join(' | '))
battle._followRewarded.set('m1', Date.now() - (battle.followWindowMs() + 1000))
check('D5 超出窗口 → 不再闭嘴', battle.followOnCooldown('m1') === false)
// 窗口=0（只算第一次）：长久以后仍在窗口内 → 一直闭嘴
process.env.RW_FOLLOW_WINDOW_MS = '0'
battle._followRewarded.set('m2', Date.now() - 99999999)
check('D6 窗口=0 → 永远在窗口内（一直闭嘴）', battle.followOnCooldown('m2') === true)
delete process.env.RW_FOLLOW_WINDOW_MS

// ---------- 清理 ----------
try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (e) { /* ignore */ }
lines.forEach((l) => console.log(l))
console.log(`\n${pass} PASS / ${fail} FAIL   (offline, tmp cleaned)`)
process.exit(fail ? 1 : 0)
