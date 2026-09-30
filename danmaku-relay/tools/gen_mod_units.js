'use strict'
/**
 * gen_mod_units.js — 从「游戏已启用的 mod」提取可召唤单位 → battle/mod-units.json
 *
 * 为什么：直播用的游戏装了内容 mod（当前启用的是 EK_Definitive_Edition，约 600 单位），
 *   battle/liveSpawner.js 的 UNIT_MAP 只覆盖原版兵种，观众召唤不到 mod 兵。
 *   本工具把已启用 mod 的单位抽出来落盘，供 UNIT_MAP / 价格表 / 兵种表复用。
 *
 * 「已启用」判定：读 <GAME>/preferences.ini 的 `modSettings:` 行，格式
 *   `<名字片段>|<sha>|<enabled|disabled>,...`；名字片段是文件名的后缀（如 `8561.rwmod...`）。
 *   按后缀匹配 `mods/units/*.rwmod`；命中不唯一（如碎片化的 `rwmod...`）则保守跳过并告警。
 *   内置 mod 走 `<GAME>/assets/builtin_mods[_enabled]/<名字>/`。
 *
 * 单位字段来源（RW 单位定义 .ini，与 gen_unit_table.js 同口径）：
 *   [core] name / displayText / displayText_zh / price / maxHp；[attack] maxAttackRange；
 *   主炮塔弹种（turret 名含 main 优先）的 [projectile_N] directDamage / areaDamage。
 *
 * 用法：
 *   node tools/gen_mod_units.js            # 写 battle/mod-units.json
 *   node tools/gen_mod_units.js --print    # 只打印统计，不落盘
 *   游戏目录可用 RW_GAME_DIR 覆盖。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const GAME_DIR = process.env.RW_GAME_DIR ||
  'D:/game/tiexiuzhanzheng_zhengshi_v1.15_anfensi.com/Rusted Warfare1.15'
const OUT = path.join(__dirname, '..', 'battle', 'mod-units.json')

// ── 1. 解析 preferences.ini 的 modSettings，判定启用状态 ──
function readModSettings () {
  let prefs = ''
  try { prefs = fs.readFileSync(path.join(GAME_DIR, 'preferences.ini'), 'utf8') } catch (e) { return [] }
  const line = (prefs.match(/^modSettings:(.*)$/m) || [])[1] || ''
  return line.split(',').map((s) => s.trim()).filter(Boolean).map((item) => {
    const [name, sha, state] = item.split('|')
    return { name: name || '', sha: sha || '', enabled: state === 'enabled' }
  })
}

/** 把 modSettings 的「名字片段」解析成实际的 mod 包路径（.rwmod 文件或目录）。 */
function resolveModPackage (nameFrag, rwmods, rwmodDir) {
  const frag = nameFrag.replace(/\.+$/, '')            // 去尾部省略号：'8561.rwmod...' -> '8561.rwmod'
  if (!frag) return null
  const hits = rwmods.filter((f) => f.endsWith(frag))
  if (hits.length === 1) return path.join(rwmodDir, hits[0])
  // 内置 mod（目录形式）
  for (const base of ['builtin_mods_enabled', 'builtin_mods']) {
    const p = path.join(GAME_DIR, 'assets', base, nameFrag)
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p
  }
  return { ambiguous: hits.length }                     // 命中 0 或多：交由调用方告警
}

// ── 2. 单位 .ini 解析（与 gen_unit_table.js 同口径） ──
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
const numOf = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null }
/** price 可能是 `160000,experimental=10000` —— 取逗号前第一段。 */
const firstNum = (v) => { if (v == null) return null; const n = parseFloat(String(v).split(',')[0]); return Number.isFinite(n) ? n : null }

function unitFromSections (sections) {
  const core = sections.core || {}
  if (core.name == null) return null
  const attack = sections.attack || {}
  const move = sections.movement || {}
  const turretKeys = Object.keys(sections).filter((k) => /^turret(_|$)/.test(k))
  const pick = turretKeys.find((k) => /main/.test(k)) || turretKeys.find((k) => k === 'turret_1') || turretKeys[0]
  let proj = null
  if (pick) { const pid = sections[pick].projectile; if (pid != null) proj = sections['projectile_' + pid] || null }
  if (!proj) {
    const projKeys = Object.keys(sections).filter((k) => /^projectile(_|$)/.test(k))
    proj = sections.projectile_1 || (projKeys[0] ? sections[projKeys[0]] : null) || {}
  }
  return {
    type: core.name,
    zh: core.displaytext_zh || '',
    en: core.displaytext || '',
    price: firstNum(core.price),
    hp: numOf(core.maxhp),
    range: numOf(attack.maxattackrange),
    directDamage: numOf(proj.directdamage),
    areaDamage: numOf(proj.areadamage),
    // ── 分类字段 ──
    movement: (move.movementtype || '').trim().toUpperCase() || 'NONE',
    moveSpeed: numOf(move.movespeed),
    experimental: /^(true|1)$/i.test((core.experimental || '').trim()),
    techLevel: numOf(core.techlevel),
    atkLand: /true/i.test(attack.canattacklandunits || ''),
    atkAir: /true/i.test(attack.canattackflyingunits || ''),
    atkSea: /true/i.test(attack.canattackunderwaterunits || '')
  }
}

/** 归类：按「能不能动」+ 移动域 + 实验标记 + 攻击能力。 */
function categoryOf (u) {
  if (u.experimental) return '实验级'
  const canMove = u.moveSpeed != null && u.moveSpeed > 0
  if (!canMove) return (u.atkLand || u.atkAir || u.atkSea) ? '防御建筑' : '建筑/设施'
  const m = u.movement
  if (m === 'AIR') return '空中'
  if (m === 'WATER') return '海面'
  if (m === 'HOVER') return '悬浮/两栖'
  return '陆战'
}

function walkInis (dir, out) {
  let ents
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return }
  for (const e of ents) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkInis(p, out)
    else if (/\.ini$/i.test(e.name)) out.push(p)
  }
}

/** 从一个 mod 包抽出全部单位。 */
function unitsOfPackage (pkg) {
  const units = []
  const inis = []
  let tmp = null
  if (typeof pkg === 'string' && pkg.endsWith('.rwmod')) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rwmod-'))
    try { execFileSync('unzip', ['-oq', pkg, '-d', tmp], { stdio: 'ignore' }) } catch (e) { return { units, title: '', error: 'unzip 失败: ' + e.message } }
    walkInis(tmp, inis)
  } else if (typeof pkg === 'string') {
    walkInis(pkg, inis)
  } else {
    return { units, title: '', error: '未解析到 mod 包' }
  }
  let title = ''
  try { title = (fs.readFileSync(path.join(tmp || pkg, 'mod-info.txt'), 'utf8').match(/^title\s*:\s*(.+)$/mi) || [])[1] || '' } catch (e) {}
  for (const f of inis) {
    let sections
    try { sections = parseIniSections(fs.readFileSync(f, 'utf8')) } catch (e) { continue }
    const u = unitFromSections(sections)
    if (u) units.push(u)
  }
  if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) {} }
  return { units, title: title.trim(), error: null }
}

// ── 3. 主流程 ──
function main () {
  const print = process.argv.includes('--print')
  const rwmodDir = path.join(GAME_DIR, 'mods', 'units')
  let rwmods = []
  try { rwmods = fs.readdirSync(rwmodDir).filter((f) => f.endsWith('.rwmod')) } catch (e) {}

  const settings = readModSettings()
  const mods = []
  const allUnits = []
  for (const s of settings) {
    if (!s.enabled) continue
    const pkg = resolveModPackage(s.name, rwmods, rwmodDir)
    if (pkg == null) { mods.push({ name: s.name, pkg: null, note: '未找到包' }); continue }
    if (typeof pkg === 'object' && pkg.ambiguous != null) {
      mods.push({ name: s.name, pkg: null, note: `后缀命中 ${pkg.ambiguous} 个包，跳过（歧义）` }); continue
    }
    const { units, title, error } = unitsOfPackage(pkg)
    // 可召唤单位 = 有价 + 有显示名 + 非模板/机制占位。
    // 只剔**明确**的机制/占位（槽位、随机生成器、AI 触发载体），不按「血量大」一刀切
    // —— EK 的星舰系列 hp 高达 20 亿也是真实单位，误杀会把真内容删掉。
    const isJunk = (u) => {
      const s = (u.zh || '') + ' ' + (u.en || '') + ' ' + u.type
      return /[%$]|\{|\}/.test(s) ||
        /^(ATC_|test|TCAI|dummy|missing|NULL|placeholder|example)/i.test(u.type) ||
        /emptySlot|空巨槽|空Mega|槽位|随机单位/i.test(s) ||
        /^Ek_random_/i.test(u.type)
    }
    const real = units.filter((u) => u.price != null && u.price > 0 && (u.zh || u.en) && !isJunk(u))
    mods.push({ name: s.name, title, pkg: path.relative(GAME_DIR, pkg), unitCount: real.length, error })
    for (const u of real) allUnits.push(Object.assign({ mod: path.basename(pkg), category: categoryOf(u) }, u))
  }

  const byType = new Map()
  for (const u of allUnits) if (!byType.has(u.type)) byType.set(u.type, u)
  // 再按「弹幕词」去重：同名单位只留第一个 —— 否则文档出现同词重复行，
  // 而实际召唤只有第一个生效（MOD_UNIT_MAP 同键先到先得）。
  const byAlias = new Map()
  for (const u of byType.values()) {
    const k = String(u.zh || u.en || u.type).toLowerCase()
    if (!byAlias.has(k)) byAlias.set(k, u)
  }
  const units = [...byAlias.values()]

  // 三档（按领域自动挑代表，供「代表池」用）：
  //   常备 = 该领域最便宜的 ≤3 个（且 ≤8000，观众随手能召）
  //   进阶 = 中档（8000–30000）里取中位 2 个
  //   王牌 = 该领域最贵的 2 个（含实验级，靠打赏）
  const catGroups = new Map()
  for (const u of units) { if (!catGroups.has(u.category)) catGroups.set(u.category, []); catGroups.get(u.category).push(u) }
  for (const list of catGroups.values()) {
    list.sort((a, b) => a.price - b.price)
    for (const u of list) u.tier = '未入池'
    let n = 0
    for (const u of list) { if (u.price <= 8000 && n < 3) { u.tier = '常备'; n++ } }
    const mid = list.filter((u) => u.price > 8000 && u.price <= 30000)
    const s = Math.max(0, Math.floor((mid.length - 2) / 2))
    for (const u of mid.slice(s, s + 2)) u.tier = '进阶'
    for (const u of list.slice(Math.max(0, list.length - 2))) u.tier = '王牌'
  }

  console.log('已启用 mod：')
  for (const m of mods) console.log(`  - ${m.name}  ->  ${m.pkg || '—'}  单位 ${m.unitCount != null ? m.unitCount : '?'}${m.note ? '  (' + m.note + ')' : ''}${m.error ? '  ERR ' + m.error : ''}`)
  console.log(`合计可召唤 mod 单位：${units.length}（去重后，按 type）`)
  console.log(`其中带中文名：${units.filter((u) => u.zh).length}`)
  console.log(`名字冲突（同中文名多单位）：${(() => { const c = {}; for (const u of units) if (u.zh) c[u.zh] = (c[u.zh] || 0) + 1; return Object.values(c).filter((n) => n > 1).length })()}`)
  console.log(`price 范围：${Math.min(...units.map((u) => u.price))} .. ${Math.max(...units.map((u) => u.price))}`)
  console.log('按类别：')
  const byCat = {}
  for (const u of units) byCat[u.category] = (byCat[u.category] || 0) + 1
  for (const [c, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) console.log(`  ${c.padEnd(10)} ${n}`)
  const byTier = {}
  for (const u of units) byTier[u.tier] = (byTier[u.tier] || 0) + 1
  console.log('按档位：' + Object.entries(byTier).map(([t, n]) => `${t} ${n}`).join(' / '))

  if (print) return
  const doc = {
    generatedFrom: path.basename(GAME_DIR),
    mods: mods.filter((m) => m.unitCount),
    units
  }
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 2), 'utf8')
  console.log('已写入 ' + path.relative(process.cwd(), OUT))

  // 可召唤白名单（liveSpawner 只注册这里的 type）。tiers 由「按领域 + 价格档」自动挑，
  // 可手改：删掉某个 type 即不可召唤；**删掉整个文件即恢复「全部可召唤」**。
  const poolPath = path.join(__dirname, '..', 'battle', 'mod-unit-pool.json')
  const tiers = {}
  for (const u of units) if (u.tier && u.tier !== '未入池') (tiers[u.tier] = tiers[u.tier] || []).push(u.type)
  fs.writeFileSync(poolPath, JSON.stringify({
    note: '直播可召唤的 mod 兵种白名单（由 tools/gen_mod_units.js 生成，可手改）。tiers 里的 type 才可召唤；删除本文件 = 恢复全部可召唤。',
    generatedFrom: path.basename(GAME_DIR),
    tiers
  }, null, 2), 'utf8')
  console.log('已写入 ' + path.relative(process.cwd(), poolPath) + `（常备/进阶/王牌 = ${Object.values(tiers).reduce((a, b) => a + b.length, 0)} 个）`)
}

main()
