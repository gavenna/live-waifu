'use strict'
/**
 * verify_gift_summon.js — 离线回归：**送礼 → 给阵营加余额 / 专属召唤**
 *
 * 跑法： node tools/verify_gift_summon.js
 * 零副作用：内存 mock「Debug Socket 发送器」；不连游戏 / 不碰中继（RW_DEBUG_PORT=19999）、
 *           不改真实 data/ 与 <GAME>\econ_live.txt。
 * 退出码 0 = 全过。
 *
 * 覆盖（2026-10 行为变更：礼物**不再按价位分档召唤兵**）：
 *   A. spawner.spawnBatch —— 造 count 个指定兵、落自家基地、带巡逻令、投 viewer 宿主队
 *   B. battle/giftTiers —— 价值→余额换算（1 抖币 = 50W）、礼物名专属召唤表
 *   C. handleGift —— 普通礼物按价值给该阵营**观众钱包**加余额、**不**召唤兵
 *   D. handleGift —— 「闪耀星辰」是目前唯一"礼物召唤兵种"：直接召唤 1 个执行者（Ek星舰）
 */
process.env.RW_DEBUG_PORT = '19999'
process.env.RW_ECON_ENABLED = '1'   // 加余额要经济开着才发命令

let pass = 0
let fail = 0
const lines = []
function check (name, ok, detail) {
  if (ok) { pass++; lines.push(`[PASS] ${name}${detail ? '  -- ' + detail : ''}`) } else { fail++; lines.push(`[FAIL] ${name}${detail ? '  -- ' + detail : ''}`) }
}

const spawner = require('../battle/liveSpawner.js')
const giftTiers = require('../battle/giftTiers.js')
const battle = require('../battle/index.js')

const sent = []
spawner.setSendCommandForTest((c) => { sent.push(c); return true })

// ---------- A. spawnBatch ----------
sent.length = 0
const r = spawner.spawnBatch({ team: 1, unitType: 'heavyTank', count: 10, zone: 'base' })
check('A1 spawnBatch 发出 count 条命令', sent.length === 10, `n=${sent.length}`)
check('A2 全部 spawnPatrol(heavyTank) 且投 viewer 队(3)',
  sent.every((c) => c.startsWith("script debug.spawnPatrol('heavyTank'") && c.includes(', 3, ')), sent[0])
const A = spawner.SPAWN_AREAS[1]
check('A3 落点 ∈ SPAWN_AREAS[1]（自家基地，非交战区）',
  r.positions.length === 10 && r.positions.every((p) => p.x >= A.xMin && p.x <= A.xMax && p.y >= A.yMin && p.y <= A.yMax),
  JSON.stringify(r.positions[0]))

sent.length = 0
spawner.spawnBatch({ team: 2, unitType: 'megaTank', count: 3, zone: 'base' })
check('A4 蓝队投 viewer 队(4) 且巡逻目标=红基地',
  sent.length === 3 && sent.every((c) => c.includes(', 4, ') && c.includes(`${spawner.PATROL_TARGETS[2].x}.0`)), sent[0])

// ---------- A5-A7. 建筑类：就地建造（塔没有脚，不下巡逻令） ----------
sent.length = 0
const rB = spawner.spawnBatch({ team: 1, unitType: 'EkTowerRifleman', count: 2, zone: 'base' })
check('A5 建筑类 → createUnit（就地建造，无 spawnPatrol）',
  sent.length === 2 && sent.every((c) => c.startsWith("script debug.createUnit('EkTowerRifleman'"))
    && !sent.some((c) => c.includes('spawnPatrol')), sent.join(' | '))
check('A6 建筑落点仍在自家基地旁（指挥中心区）',
  rB.positions.length === 2 && rB.positions.every((p) => p.x >= A.xMin && p.x <= A.xMax && p.y >= A.yMin && p.y <= A.yMax),
  JSON.stringify(rB.positions[0]))
check('A7 静态集合 = 白名单 building 全部类型，且不含普通兵',
  spawner.WL_STATIC_TYPES.has('EkTowerRifleman') && spawner.WL_STATIC_TYPES.has('c_turret_t3_gun')
    && spawner.WL_STATIC_TYPES.has('EkBunkerInterceptor') && !spawner.WL_STATIC_TYPES.has('EkWardenMechX')
    && !spawner.WL_STATIC_TYPES.has('EkBuzzard'),
  JSON.stringify([...spawner.WL_STATIC_TYPES]))

// ---------- B. 价值 → 余额 / 专属召唤表（giftTiers） ----------
check('B1 1 抖币 = 50W 余额', giftTiers.creditsFor(1) === 500000, String(giftTiers.creditsFor(1)))
check('B2 10 抖币 = 500W（小心心连刷 10 颗）', giftTiers.creditsFor(10) === 5000000, String(giftTiers.creditsFor(10)))
check('B3 3000 抖币 = 15 亿', giftTiers.creditsFor(3000) === 1500000000, String(giftTiers.creditsFor(3000)))
check('B4 非正/非法一律 0', giftTiers.creditsFor(0) === 0 && giftTiers.creditsFor(-5) === 0 && giftTiers.creditsFor(NaN) === 0,
  `${giftTiers.creditsFor(0)} / ${giftTiers.creditsFor(-5)} / ${giftTiers.creditsFor(NaN)}`)
check('B5 B站金瓜子折算（1000 金瓜子 = 10 抖币）', giftTiers.coinsOf({ coinValue: 1000, coinUnit: 'gold' }) === 10,
  String(giftTiers.coinsOf({ coinValue: 1000, coinUnit: 'gold' })))
const uStar = giftTiers.unitOfGiftName('闪耀星辰')
check('B6 专属召唤：闪耀星辰 → Ek星舰 x1', !!uStar && uStar.unit === 'Ek星舰' && uStar.count === 1, JSON.stringify(uStar))
check('B7 非专属礼物名 → null（小心心走加余额）',
  giftTiers.unitOfGiftName('小心心') === null && giftTiers.unitOfGiftName('') === null && giftTiers.unitOfGiftName(null) === null)

// ---------- C. handleGift —— 普通礼物按价值加余额 ----------
battle._playerTeams.clear()
battle.round.state = 'FIGHTING'
battle.dispatchMessage({ type: 'join', team: 'red', playerId: 'gg' })   // 建立归属=红(1) → 钱包=红观众队(3)

sent.length = 0
const g = battle.handleGift({ type: 'gift', coinValue: 1, coinUnit: 'diamond', giftName: '小心心', count: 1, playerId: 'gg', playerName: '甲' })
check('C1 1 抖币礼物 → 红观众队(3) 余额 +50W', sent.includes('script debug.addTeamCredits(3, 500000)'), sent.join(' | '))
check('C2 不召唤兵（无 spawnPatrol）', !sent.some((c) => c.includes('spawnPatrol')), sent.join(' | '))
check('C3 返回 kind=credits / amount=500000', g && g.kind === 'credits' && g.amount === 500000, JSON.stringify(g))

sent.length = 0
battle.handleGift({ type: 'gift', coinValue: 10, coinUnit: 'diamond', giftName: '小心心', count: 10, playerId: 'gg' })
check('C4 连刷 10 颗（10 抖币）→ +500W', sent.includes('script debug.addTeamCredits(3, 5000000)'), sent.join(' | '))

sent.length = 0
battle.handleGift({ type: 'gift', coinValue: 1200, coinUnit: 'diamond', giftId: 'gx', playerId: 'gg' })
check('C5 1200 抖币普通礼物 → +6 亿', sent.includes('script debug.addTeamCredits(3, 600000000)'), sent.join(' | '))

sent.length = 0
battle.handleGift({ type: 'gift', coinValue: 1000, coinUnit: 'gold', giftName: 'B站礼物', playerId: 'gg' })
check('C6 B站 1000 金瓜子 = 10 抖币 → +500W', sent.includes('script debug.addTeamCredits(3, 5000000)'), sent.join(' | '))

sent.length = 0
const g3 = battle.handleGift({ type: 'gift', coinValue: 0, coinUnit: 'diamond', giftName: '关注奖励', playerId: 'gg' })
check('C7 无币值礼物不结算（无命令、ok=false）', sent.length === 0 && g3 && g3.ok === false, JSON.stringify(g3))

battle.round.state = 'IDLE'
sent.length = 0
const g4 = battle.handleGift({ type: 'gift', coinValue: 100, coinUnit: 'diamond', playerId: 'gg' })
check('C8 非 FIGHTING 不结算', sent.length === 0 && g4 === null, JSON.stringify(g4))

// ---------- D. 闪耀星辰 —— 唯一"礼物召唤兵种" ----------
battle.round.state = 'FIGHTING'
battle._playerTeams.clear()
battle.dispatchMessage({ type: 'join', team: 'red', playerId: 'gg' })

sent.length = 0
const gs = battle.handleGift({ type: 'gift', coinValue: 3000, coinUnit: 'diamond', giftName: '闪耀星辰', count: 1, playerId: 'gg', playerName: '乙' })
check('D1 闪耀星辰 → 召唤 Ek星舰 x1', sent.length === 1 && sent[0].startsWith("script debug.spawnPatrol('Ek星舰'"), sent.join(' | '))
check('D2 闪耀星辰不加余额（价值换算被专属召唤取代）', !sent.some((c) => c.includes('addTeamCredits')), sent.join(' | '))
check('D3 返回 kind=summon / unitType=Ek星舰 / count=1',
  gs && gs.kind === 'summon' && gs.unitType === 'Ek星舰' && gs.count === 1, JSON.stringify(gs))

sent.length = 0
const gs2 = battle.handleGift({ type: 'gift', coinValue: 0, coinUnit: 'diamond', giftName: '闪耀星辰', playerId: 'gg' })
check('D4 闪耀星辰无币值也召唤（按名匹配先于币值判定）', sent.length === 1 && sent[0].includes("'Ek星舰'"), sent.join(' | '))

console.log(lines.join('\n'))
console.log(`\n${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
