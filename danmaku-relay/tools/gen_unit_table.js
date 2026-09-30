'use strict'
/**
 * gen_unit_table.js — 生成「兵种与收益一览」表（给直播间主页/挂图用）
 *
 * 数据**全部取自真值源**，不手写、可重复生成：
 *   兵种别名/类型   battle/liveSpawner.js 的 UNIT_MAP（中文词 → 引擎类型）
 *   单价/互动奖励   battle/unit-prices.json、battle/battleConfig.js
 *   单位数值        **游戏自带的 Help → Guides → Unit Stats 页面**
 *                   （<GAME>/assets/gui/help_unitstats.rml，游戏官方数据，含
 *                    Hp / Direct Damage / Area Damage / Shoot Delay / Attack Range / Speed / Desc）
 *                   **Help 页会跳过一批单位**（名字以 bug 开头的、以及引擎内建的
 *                    experimentalGunship / ladybug / tankDestroyer / megaTank / carrier 等 ——
 *                    反编译 ar.java:printForHelp() 证实）；这些改用**游戏单位定义 .ini**
 *                    （<GAME>/assets/units/**、assets/builtin_mods/**）补齐。
 *
 * 用法： node tools/gen_unit_table.js > ../../docs/兵种与收益一览.md
 *       游戏目录可用 RW_GAME_DIR 覆盖（默认下面的 GAME_DIR）。
 */
const fs = require('fs')
const path = require('path')
const sp = require('../battle/liveSpawner')
const battleConfig = require('../battle/battleConfig')
const giftTiers = require('../battle/giftTiers')

battleConfig.loadDefaults()
const cfg = battleConfig.effective()

const GAME_DIR = process.env.RW_GAME_DIR ||
  'D:/game/tiexiuzhanzheng_zhengshi_v1.15_anfensi.com/Rusted Warfare1.15'
const RML = path.join(GAME_DIR, 'assets', 'gui', 'help_unitstats.rml')

const prices = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'battle', 'unit-prices.json'), 'utf8'))

// mod 单位（游戏已启用 mod 新增，见 tools/gen_mod_units.js）；缺失则本节为空。
let MOD_UNITS = []
let MOD_META = { mods: [] }
try {
  const m = require('../battle/mod-units.json')
  MOD_UNITS = Array.isArray(m.units) ? m.units : []
  MOD_META = m
} catch (e) { /* 无 mod-units.json */ }

// ── 1. 解析游戏官方单位数值表 ─────────────────────────────
function parseOfficialStats () {
  let raw = ''
  try { raw = fs.readFileSync(RML, 'utf8') } catch (e) { return { map: new Map(), error: e.message } }
  const map = new Map()   // 归一化 id → stats
  const blocks = raw.split('<div class="unit">').slice(1)
  for (const b of blocks) {
    const body = b.split('</div>')[0]
    const img = (body.match(/unit:([A-Za-z0-9_]+)/) || [])[1]
    const name = (body.match(/<h4>([^<]*)<\/h4>/) || [])[1] || ''
    const pre = (body.match(/<pre>([\s\S]*?)<\/pre>/) || [])[1] || ''
    const desc = (body.match(/<p>([\s\S]*?)<\/p>/) || [])[1] || ''
    const num = (label) => {
      const m = pre.match(new RegExp(label + ':\\s*\\$?([0-9.]+)'))
      return m ? parseFloat(m[1]) : null
    }
    if (!img) continue
    map.set(norm(img), {
      id: img, name,
      price: num('Price'),
      hp: num('Hp'),
      speed: num('Speed'),
      turnSpeed: num('Turn speed'),
      mass: num('Mass'),
      shootDelay: num('Shoot Delay'),
      range: num('Attack Range'),
      directDamage: num('Direct Damage'),
      areaDamage: num('Area Damage'),
      desc: desc.replace(/<br\/?>/g, ' ').replace(/<[^>]+>/g, '').trim()
    })
  }
  return { map, error: null }
}

/** id 归一化：小写、去前导 c_、去尾部 c。 */
function norm (s) { return String(s).toLowerCase().replace(/^c_/, '').replace(/c$/, '') }

const { map: off, error: offErr } = parseOfficialStats()

// ── 1b. 解析游戏单位定义（.ini）——补 Help 页跳过的单位 ──────────
//   引擎生成 Help 页（反编译 ar.java:printForHelp()）时会跳过：名字以 `bug` 开头的、
//   被 custom 覆盖的、以及一张硬编码名单（carrier / experimentalGunship / ladybug /
//   spiderBot / tankDestroyer / megaTank / …）。这些单位的真实数值在游戏单位定义 .ini 里。
//   引擎类型名 = [core] 的 name / overrideAndReplace / displayLocaleKey 三者**归一化后**
//   （例：tanks/tank.ini 的 name=c_tank、overrideAndReplace=tank ⇒ 类型名 tank；
//    interceptor.ini 的 overrideAndReplace + displayLocaleKey = airShip ⇒ 类型名 airShip）。
function parseIniSections (text) {
  const sections = Object.create(null)
  let cur = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const sec = line.match(/^\[(.+?)\]$/)
    if (sec) { const k = sec[1].trim().toLowerCase(); cur = sections[k] || (sections[k] = {}); continue }
    if (!cur) continue
    const sep = line.search(/[:=]/)
    if (sep < 0) continue
    const key = line.slice(0, sep).trim().toLowerCase()
    if (key) cur[key] = line.slice(sep + 1).trim()
  }
  return sections
}

function numOf (v) {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : null
}

/** 取单位主武器的 {hp, range, directDamage, areaDamage}：主炮塔 → 其引用的弹种。 */
function statsFromSections (sections) {
  const core = sections.core || {}
  const attack = sections.attack || {}
  // 主武器弹种：炮塔名含 main 的优先 → turret_1 → 首个炮塔；该炮塔无 projectile 引用则退回 projectile_1
  const turretKeys = Object.keys(sections).filter((k) => /^turret(_|$)/.test(k))
  const pick = turretKeys.find((k) => /main/.test(k)) ||
               turretKeys.find((k) => k === 'turret_1') ||
               turretKeys[0]
  let proj = null
  if (pick) {
    const pid = sections[pick].projectile
    if (pid != null) proj = sections['projectile_' + pid] || null
  }
  if (!proj) {
    const projKeys = Object.keys(sections).filter((k) => /^projectile(_|$)/.test(k))
    proj = sections.projectile_1 || (projKeys[0] ? sections[projKeys[0]] : null) || {}
  }
  return {
    hp: numOf(core.maxhp),
    range: numOf(attack.maxattackrange),
    directDamage: numOf(proj.directdamage),
    areaDamage: numOf(proj.areadamage)
  }
}

/** 扫描游戏单位定义目录，建「归一化类型名 → 数值」表（同键先到先得）。 */
function parseUnitDefs () {
  const map = new Map()
  const roots = [
    path.join(GAME_DIR, 'assets', 'units'),
    path.join(GAME_DIR, 'assets', 'builtin_mods')
  ]
  const files = []
  const walk = (dir) => {
    let ents
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return }
    for (const e of ents) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.ini$/i.test(e.name)) files.push(p)
    }
  }
  roots.forEach(walk)
  for (const f of files) {
    let sections
    try { sections = parseIniSections(fs.readFileSync(f, 'utf8')) } catch (e) { continue }
    const core = sections.core || {}
    const def = statsFromSections(sections)
    for (const k of [core.name, core.overrideandreplace, core.displaylocalekey]) {
      if (!k) continue
      const n = norm(k)
      if (!n || n === 'none') continue
      if (!map.has(n)) map.set(n, def)
    }
  }
  return map
}

const unitDefs = parseUnitDefs()
function iniFor (type) {
  const n = norm(type)
  return unitDefs.get(n) || null
}

// ── 2. 引擎类型 → 别名（保持 UNIT_MAP 定义顺序）────────────
const byType = new Map()
for (const [alias, type] of Object.entries(sp.UNIT_MAP)) {
  if (!byType.has(type)) byType.set(type, [])
  byType.get(type).push(alias)
}

const isCJK = (s) => /[\u4e00-\u9fff]/.test(s)
function splitAliases (aliases) {
  const cn = aliases.filter(isCJK)
  const en = aliases.filter((a) => !isCJK(a))
  const main = cn[0] || en[0] || aliases[0] || ''
  return { main, rest: aliases.filter((a) => a !== main) }
}

// 引擎类型 → 官方页 id 的**显式**别名。官方页把核弹写成 nukeLauncherC（我们表里是
// nukeLaucher，少个 n），拼写对不上；但页内 Nuke/Anti-Nuke 各只有一个，手工指认是安全的。
const OFFICIAL_ALIAS = { nukelaucher: 'nukelauncher', antinukelaucher: 'antinukelauncher' }

/**
 * 找该引擎类型的官方数值。
 * 🔴 **只按归一化 id 精确匹配**（+ 上面两个显式别名），**绝不按价格兜底**：
 *   多个单位同价（800 就有 重坦/超级/杀手/运输机/炮艇/潜艇）时价格匹配必然张冠李戴，
 *   把错误的血量/伤害贴到公开页面上。（本生成器第一版就是这么错的，已修。）
 */
function officialFor (type) {
  const n = norm(type)
  if (off.has(n)) return off.get(n)
  const a = OFFICIAL_ALIAS[n]
  if (a && off.has(a)) return off.get(a)
  return null
}

// ── 3. 组装 ────────────────────────────────────────────
const rows = []
for (const [type, aliases] of byType) {
  const { main, rest } = splitAliases(aliases)
  const s = officialFor(type)
  rows.push({
    type,
    main,
    restTxt: rest.length ? rest.join('、') : '—',
    price: prices[type],
    official: s,
    ini: iniFor(type)
  })
}
rows.sort((a, b) => (a.price == null ? Infinity : a.price) - (b.price == null ? Infinity : b.price))

// 数值来源统计：Help 页优先；Help 页没有的（被跳过 / 未收录）用游戏单位定义 .ini 补。
const matchedOfficial = rows.filter((r) => r.official).length
const matchedIniOnly = rows.filter((r) => !r.official && r.ini).length
const matched = matchedOfficial + matchedIniOnly

const L = []
L.push('# 直播间 · 兵种与收益一览')
L.push('')
L.push('> 由 `danmaku-relay/tools/gen_unit_table.js` 自动生成，**请勿手改**（改完代码重跑即可）。')
L.push('> ⚠️ **本文是「全量单位库」参考，不是「当前可召唤范围」。** 真正生效的召唤白名单 = `danmaku-relay/battle/summon-whitelist.json`；')
L.push('> 观众可见的召唤清单见 `docs/直播指令手册.md` §2（下表 mod 的「档位」列已**被白名单取代**，见 §二·B 说明）。')
L.push('> 单位数值来自**游戏自带的 Help → Guides → Unit Stats 页面**（`assets/gui/help_unitstats.rml`）；')
L.push('> 该页会跳过一部分单位（bug 系、引擎内建若干），这些取**游戏单位定义 `.ini`**（`assets/units/**`、`assets/builtin_mods/**`）。皆为游戏自带数据。')
L.push('')
L.push('## 一、怎么召唤')
L.push('')
L.push('弹幕格式：**阵营 + 数量（可省）+ 兵种**，例如 `红3秃鹰`、`蓝方5凤凰`、`red2buzzard`。')
L.push('')
L.push('| 规则 | 说明 |')
L.push('|---|---|')
L.push('| 阵营 | 红 / 蓝（英文 red / blue），必填 |')
L.push('| 数量 | 默认 1；单条上限**按单价分档**（≤2万→10 / ≤8万→5 / >8万→2，见 `summon-whitelist.json` 的 `tierCaps`） |')
L.push('| 落点 | 统一**自家指挥中心旁** + 巡逻向敌方基地（2026-09-22 起取消"≥2 上前线"双区） |')
L.push('| 冷却 | 同一观众 **3s**（`summon.cooldownMs`） |')
L.push('| 花钱 | 从**观众独立钱包**（红 team3 / 蓝 team4）扣「单价 × 数量」；**钱不够整条被拒绝**，画面播报「余额不足」 |')
L.push('| 不识别 | 阵营写错 / 兵种词不在**白名单** → 整条忽略（不出兵、不扣钱） |')
L.push('')
L.push('## 二、兵种 · 价格 · 战力')
L.push('')
L.push('> 战力一栏**只列游戏官方数值**（血量 / 单发伤害 / 射程），不掺自造指标。')
L.push('')
L.push('| 弹幕词 | 也可写 | 单价 | 血量 | 单发伤害 | 射程 |')
L.push('|---|---|---|---|---|---|')
for (const r of rows) {
  const s = r.official || r.ini
  const price = r.price == null ? '**免费**¹' : `${r.price}`
  const hp = s && s.hp != null ? s.hp : '—'
  const dmg = s
    ? [(s.directDamage != null ? s.directDamage : null), (s.areaDamage != null ? `范围${s.areaDamage}` : null)]
        .filter(Boolean).join(' / ') || '—'
    : '—'
  const rng = s && s.range != null ? s.range : '—'
  L.push(`| \`${r.main}\` | ${r.restTxt} | ${price} | ${hp} | ${dmg} | ${rng} |`)
}
L.push('')
L.push('> **¹ 免费**：该单位在内置单价表里为 `null`/缺失 ⇒ 本项目等于**不扣钱**（是"免费召唤"，不是"不可召唤"）。')
L.push(`> **² —**：游戏 Help 页未收录、且 mod 单位定义 \`.ini\` 里也查不到该类型（或该单位**未定义该项**——如部件/「已部署」变体常不写 maxHp）—— 无数值可引，不臆造。`)
{
  const unresolved = rows.filter((r) => !r.official && !r.ini).map((r) => `\`${r.main}\``)
  if (unresolved.length) L.push(`> 当前查无定义的原版类型：${unresolved.join('、')} —— 引擎内建有该类型名，但本安装无任何可读单位定义，**观众发这些词很可能召唤落空**。`)
}
L.push('')
L.push('### 官方说明（游戏内原文）')
L.push('')
for (const r of rows) {
  if (!r.official || !r.official.desc) continue
  L.push(`- **${r.main}**（${r.official.name}）：${r.official.desc}`)
}
L.push('')
if (MOD_UNITS.length) {
  const modNames = (MOD_META.mods || []).map((m) => m.title || m.name).filter(Boolean).join('、') || '内容 mod'
  L.push('## 二·B、mod 单位（游戏已启用 mod 新增，观众可召唤）')
  L.push('')
  L.push(`> 直播用的游戏启用了内容 mod（**${modNames}**），共 **${MOD_UNITS.length}** 个 mod 兵种，下面**按领域分组**。`)
  L.push('> 弹幕词 = 单位自带中文名（mod 定义里的 `displayText_zh`）；数值取自 mod 的单位定义 `.ini`（与上表同口径）。')
  L.push('> ⚠️ **「档位」列已失效**：它指向的 `battle/mod-unit-pool.json` 已被 `battle/summon-whitelist.json` 取代 —— **当前真正可召唤的只有白名单里的项**（清单见 `docs/直播指令手册.md` §2）。下表仅作全量单位参考，`档位` 列请忽略。')
  L.push('> 组内排序：先按档位（常备 → 进阶 → 王牌 → 未入池），同档按单价升序。召唤格式同上（阵营 + 数量 + 弹幕词），按单价从队伍余额扣费。')
  const CAT_ORDER = ['陆战', '悬浮/两栖', '空中', '海面', '防御建筑', '建筑/设施', '实验级', '其它']
  const groups = new Map()
  for (const u of MOD_UNITS) { const c = u.category || '其它'; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(u) }
  const ordered = [...groups.keys()].sort((a, b) => {
    const ia = CAT_ORDER.indexOf(a); const ib = CAT_ORDER.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  const TIER_RANK = { '常备': 0, '进阶': 1, '王牌': 2, '未入池': 3 }
  for (const c of ordered) {
    const list = groups.get(c).slice().sort((a, b) =>
      ((TIER_RANK[a.tier] != null ? TIER_RANK[a.tier] : 9) - (TIER_RANK[b.tier] != null ? TIER_RANK[b.tier] : 9)) || a.price - b.price)
    L.push('')
    L.push(`### ${c}（${list.length}）`)
    L.push('')
    L.push('| 弹幕词 | 档位 | 英文名 | 单价 | 血量 | 单发伤害 | 射程 |')
    L.push('|---|---|---|---|---|---|---|')
    for (const u of list) {
      const tier = (u.tier && u.tier !== '未入池') ? u.tier : '—'
      const hp = u.hp != null ? u.hp : '—'
      const dmg = [(u.directDamage != null ? u.directDamage : null), (u.areaDamage != null ? `范围${u.areaDamage}` : null)]
        .filter(Boolean).join(' / ') || '—'
      const rng = u.range != null ? u.range : '—'
      L.push(`| \`${u.zh || u.en || u.type}\` | ${tier} | ${u.en || '—'} | ${u.price} | ${hp} | ${dmg} | ${rng} |`)
    }
  }
  L.push('')
}
L.push('## 三、互动奖励')
L.push('')
L.push('**点赞 / 关注 / 送礼** 都给**你所支持阵营**的队伍**加余额**（归属由你发过的红/蓝弹幕或进房随机决定）。')
L.push(`**送礼**按礼物价值折算：**1 抖币 = ${giftTiers.CREDITS_PER_COIN / 10000}W** 游戏币（B站按 1000 金瓜子 ≈ 10 抖币 折算）。`)
L.push(`唯一例外是**「闪耀星辰」**：它不换钱，**直接召唤 1 个执行者**（Ek星舰，全图最强清场兵）。`)
L.push('')
L.push('| 互动 | 奖励 |')
L.push('|---|---|')
L.push(`| 点赞 | **+${cfg.likeCredits}** 余额 / 次（0 = 关闭） |`)
L.push(`| 关注 | **+${cfg.followCredits}** 余额 / 次（0 = 关闭） |`)
L.push(`| 送礼物 | **+礼物价值 × ${giftTiers.CREDITS_PER_COIN / 10000}W** 余额（1 抖币 = ${giftTiers.CREDITS_PER_COIN / 10000}W；落你所支持阵营的观众钱包） |`)
L.push(`| 送「闪耀星辰」 | **直接召唤 1 个执行者**（Ek星舰）到你所支持阵营 |`)
L.push('')
L.push('## 四、一局怎么走')
L.push('')
L.push('- 自动开局 → 红蓝对战 → 一方基地被拆 或 超时判胜负 → 自动开下一局。')
L.push(`- 单局时长上限可在**控制面板**的「每局时长」里自己调（当前 ${cfg.roundMaxMs ? Math.round(cfg.roundMaxMs / 60000) + ' 分钟' : '默认 5 分钟'}）；到点还没分胜负按平局收场。`)
L.push('- 结束时播报：哪方获胜、第几轮、用时、双方兵力。')
L.push('')

process.stdout.write(L.join('\n'))
process.stderr.write(`数值来源: Help 页 ${matchedOfficial} + .ini 补 ${matchedIniOnly} = ${matched}/${rows.length}${offErr ? ' | RML 读取失败: ' + offErr : ''}\n`)
