'use strict'
/**
 * verify_interaction_credits.js — 离线回归：观众互动（点赞 / 关注）→ 给某队加余额
 *
 * 跑法：  node tools/verify_interaction_credits.js
 * 零副作用：临时 econ_live / 临时 battle-config + 内存 mock「Debug Socket 发送器」。
 *           不连游戏、不碰中继、不改真实 data/ 与 <GAME>\econ_live.txt。
 * 退出码 0 = 全过。
 *
 * 为什么只 mock 最外层（Debug Socket 发送）：
 *   本任务横跨「适配器 → relay → battle 派发 → economy → 引擎命令」多层。
 *   mock 掉中间层会把「接线断了」这类缺陷掩盖 —— 这里除最后一步发送外全是真实模块。
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

// ---------- 造环境：假 econ_live + 假 battle-config ----------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'credits-verify-'))
const liveFile = path.join(tmpDir, 'econ_live.txt')

function writeLive (teams, frame) {
  const rows = ['# econ_live ' + Date.now() + ' ' + (frame || 100)]
  for (const t of teams) rows.push(`team ${t.id} ${t.balance} ${t.income}`)
  const tmp = liveFile + '.tmp'
  fs.writeFileSync(tmp, rows.join('\n') + '\n', 'utf8')
  if (fs.existsSync(liveFile)) fs.unlinkSync(liveFile)
  fs.renameSync(tmp, liveFile)
}

// 环境必须在 require 之前设好（模块加载时读 env）
process.env.RW_ECON_FILE = liveFile
process.env.RW_ECON_ENABLED = '1'
process.env.RW_ECON_MAX_AGE_MS = '5000'
process.env.RW_BATTLE_CONFIG_FILE = path.join(tmpDir, 'battle-config.json')

for (const m of ['../battle/economy.js', '../battle/battleConfig.js', '../battle/liveSpawner.js', '../battle/index.js']) {
  try { delete require.cache[require.resolve(m)] } catch (e) { /* ignore */ }
}

const economy = require('../battle/economy')
const cfg = require('../battle/battleConfig')
const spawner = require('../battle/liveSpawner')
const battle = require('../battle')
const { EventTranslator } = require('../danmaku/douyin')

// mock 最外层：Debug Socket 发送器（内存数组）
const sent = []
spawner.setSendCommandForTest((cmd) => { sent.push(cmd); return true })
const fakeSend = (cmd) => { sent.push(cmd); return true }

writeLive([{ id: 1, balance: 1000, income: 0 }, { id: 2, balance: 1000, income: 0 }], 100)
economy.readLive(true)

// ---------- A. economy.credit 命令形状（与 charge 对称，正数） ----------
sent.length = 0
const c1 = economy.credit(1, 500, fakeSend)
check('A1 credit 返回 credited=true', c1.credited === true, JSON.stringify(c1))
check('A2 命令为 addTeamCredits(1, 500)（正号）', sent[0] === 'script debug.addTeamCredits(1, 500)', sent[0])
sent.length = 0
economy.credit(1, -300, fakeSend)
check('A3 credit 取绝对值，负数也当加钱', sent[0] === 'script debug.addTeamCredits(1, 300)', sent[0])
check('A4 乐观更新：缓存余额已增加 (+500,+300)', economy.getTeam(1).balance === 1800, 'now=' + economy.getTeam(1).balance)
sent.length = 0
const c0 = economy.credit(1, 0, fakeSend)
check('A5 amount=0 不发命令、credited=false', c0.credited === false && sent.length === 0)

// ---------- B. 适配器：点赞 / 关注产出 credits 事件 ----------
const tr = new EventTranslator()
const likMsgs = tr._like({ count: 1 }, 'u-like-1', '观众甲')
check('B1 点赞产出 credits(source=like)', likMsgs.some(m => m.type === 'credits' && m.source === 'like'), JSON.stringify(likMsgs))
check('B2 点赞仍保留显示弹幕', likMsgs.some(m => m.type === 'danmaku'), JSON.stringify(likMsgs))
const folMsgs = tr._follow({}, 'u-fol-1', '观众乙')
check('B3 关注产出 credits(source=follow)', folMsgs.some(m => m.type === 'credits' && m.source === 'follow'), JSON.stringify(folMsgs))
check('B4 点赞冷却生效（同用户 1s 内第二次为空）', tr._like({ count: 1 }, 'u-like-1', '观众甲').length === 0)

// ---------- C. battle.handleCredits：按配置金额结算、只在对局中 ----------
cfg.loadDefaults()
cfg.setConfig({ likeCredits: 700, followCredits: 9000 }, 'default')
battle.round.state = 'FIGHTING'

sent.length = 0
const r1 = battle.handleCredits({ type: 'credits', source: 'like', playerId: 'u1', playerName: 'A' })
check('C1 点赞加 viewer 队余额 +700', sent.length === 1 && /addTeamCredits\([34], 700\)/.test(sent[0]), sent.join(' | '))
check('C2 返回 credited=true', r1 && r1.credited === true, JSON.stringify(r1))

sent.length = 0
battle.handleCredits({ type: 'credits', source: 'follow', playerId: 'u2', playerName: 'B' })
check('C3 关注加 viewer 队余额 +9000', sent.length === 1 && /addTeamCredits\([34], 9000\)/.test(sent[0]), sent.join(' | '))

cfg.setConfig({ likeCredits: 0 }, 'default')
sent.length = 0
const r3 = battle.handleCredits({ type: 'credits', source: 'like', playerId: 'u3' })
check('C4 金额=0 视为关闭（不发命令、静默）', sent.length === 0 && r3 && r3.ok === false, JSON.stringify(r3))

cfg.setConfig({ likeCredits: 700 }, 'default')
battle.round.state = 'IDLE'
sent.length = 0
const r4 = battle.handleCredits({ type: 'credits', source: 'like', playerId: 'u4' })
check('C5 非 FIGHTING 不结算（r=null 且无命令）', r4 === null && sent.length === 0)

// ---------- D. 派发入口（中继 relay.onDanmaku 真正调用的那个） ----------
battle.round.state = 'FIGHTING'
sent.length = 0
battle.dispatchMessage({ type: 'credits', source: 'like', playerId: 'u5', playerName: '派发' })
check('D1 dispatchMessage 把 credits 路由到结算', sent.some(c => /addTeamCredits\([34], 700\)/.test(c)), sent.join(' | '))
check('D2 未知 type 不误伤（返回 null）', battle.dispatchMessage({ type: 'whatever' }) === null)
check('D3 空消息不炸', battle.dispatchMessage(null) === null)

// ---------- E. 端到端：适配器产出的事件 → 派发 → 命令 ----------
sent.length = 0
const tr2 = new EventTranslator()
for (const ev of tr2._follow({}, 'u-e2e', '端到端')) battle.dispatchMessage(ev)
check('E1 关注事件走完整链路后发出 +9000 命令', sent.some(c => /addTeamCredits\([34], 9000\)/.test(c)), sent.join(' | '))

// ---------- F. 观众阵营归属（方案 C）：进房给初始队 / 弹幕表态更新 / credits 照归属 ----------
cfg.setConfig({ likeCredits: 500, followCredits: 5000 }, 'default')
battle.round.state = 'FIGHTING'
battle._playerTeams.clear()

const j1 = battle.dispatchMessage({ type: 'join', team: 'red', playerId: 'v1', playerName: '甲' })
check('F1 进房给初始归属（红=1）', battle.playerTeamOf('v1') === 1, JSON.stringify(j1))

battle.dispatchMessage({ type: 'join', team: 'blue', playerId: 'v1' })
check('F2 重进房不覆盖已有归属', battle.playerTeamOf('v1') === 1, String(battle.playerTeamOf('v1')))

battle.dispatchMessage({ type: 'danmaku', text: '蓝 5 狂暴者', playerId: 'v1', playerName: '甲' })
check('F3 发蓝弹幕把归属改成蓝（2）', battle.playerTeamOf('v1') === 2, String(battle.playerTeamOf('v1')))

sent.length = 0
battle.dispatchMessage({ type: 'credits', source: 'like', playerId: 'v1', playerName: '甲' })
check('F4 有归属 → 加到他所属阵营的观众钱包（蓝→team4）', sent.length === 1 && /addTeamCredits\(4, 500\)/.test(sent[0]), sent.join(' | '))

battle._playerTeams.clear()
sent.length = 0
battle.dispatchMessage({ type: 'credits', source: 'like', playerId: 'nobody', playerName: '路人' })
check('F5 无归属 → 回退随机（钱包仍是红3或蓝4）', sent.length === 1 && /addTeamCredits\([34], 500\)/.test(sent[0]), sent.join(' | '))

battle._playerTeams.clear()
battle.dispatchMessage({ type: 'join', team: 'blue', playerId: 'v2' })
check('F6 join team=blue 映射到蓝队（2）', battle.playerTeamOf('v2') === 2, String(battle.playerTeamOf('v2')))

battle.round.state = 'IDLE'
battle._playerTeams.clear()
battle.dispatchMessage({ type: 'danmaku', text: '红3狂暴者', playerId: 'v3' })
check('F7 IDLE 时发红弹幕也记归属（跨轮属性）', battle.playerTeamOf('v3') === 1, String(battle.playerTeamOf('v3')))

sent.length = 0
battle.dispatchMessage({ type: 'credits', source: 'follow', playerId: 'v2' })
check('F8 非 FIGHTING 不结算（连归属也不发钱）', sent.length === 0)

// ---------- G. 送礼 → **加余额**（2026-10 行为变更：礼物按价值给阵营加余额） ----------
//   细节（换算比例 / 专属召唤 / 落点 / 投队）在 tools/verify_gift_summon.js；本段只锁接线。
battle._playerTeams.clear()
battle.round.state = 'FIGHTING'
battle.dispatchMessage({ type: 'join', team: 'red', playerId: 'g1' })   // 先给个归属（红队）
check('G0 归属已建立', battle.playerTeamOf('g1') === 1, String(battle.playerTeamOf('g1')))

sent.length = 0
const g1 = battle.dispatchMessage({ type: 'gift', coinValue: 5, coinUnit: 'diamond', giftName: '棒棒糖', playerId: 'g1', playerName: '甲' })
check('G1 送礼 → 观众钱包加余额（5 抖币 = 250W）', sent.includes('script debug.addTeamCredits(3, 2500000)'), sent.join(' | '))
check('G2 送礼返回 kind=credits', g1 && g1.kind === 'credits', JSON.stringify(g1))
check('G3 普通礼物不召唤兵', !sent.some((c) => c.includes('spawnPatrol')), sent.join(' | '))

sent.length = 0
const gStar = battle.dispatchMessage({ type: 'gift', coinValue: 3000, coinUnit: 'diamond', giftName: '闪耀星辰', playerId: 'g1' })
check('G4 闪耀星辰 → 召唤（唯一"礼物召唤兵种"例外）',
  sent.some((c) => c.includes("spawnPatrol('Ek星舰'")) && gStar && gStar.kind === 'summon', JSON.stringify(gStar))

sent.length = 0
const g4 = battle.dispatchMessage({ type: 'gift', coinValue: 0, coinUnit: 'diamond', playerId: 'g1' })
check('G5 无币值（关注奖励兵）不加钱、不召唤', sent.length === 0 && g4 && g4.reason === 'no-coin', JSON.stringify(g4))

battle.round.state = 'IDLE'
sent.length = 0
battle.dispatchMessage({ type: 'gift', coinValue: 100, coinUnit: 'diamond', playerId: 'g1' })
check('G6 非 FIGHTING 不结算', sent.length === 0)

// ---------- 清理 ----------
try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (e) { /* ignore */ }
console.log(lines.join('\n'))
console.log(`\n${pass} PASS / ${fail} FAIL   (offline, tmp cleaned)`)
process.exit(fail ? 1 : 0)
