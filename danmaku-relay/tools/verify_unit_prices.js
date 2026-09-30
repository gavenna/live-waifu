'use strict'
/**
 * verify_unit_prices.js — 单价表 × 权威源 对账（只读游戏文件，零副作用）
 *
 * 三个数据源：
 *   ① <GAME>/assets/gui/help_unitstats.rml   游戏官方 Help→Unit Stats 页（含 Price，覆盖最全）
 *   ② <GAME>/assets/units/**\*.ini           单位定义，**只取 [core] 段**的 name/price
 *                                            （⚠️ [turret_N] 段里也有 price 行，抓错会得到炮塔件的价）
 *   ③ battle/unit-prices.json                项目扣费表
 * 可召唤集合 = battle/liveSpawner.js 的 UNIT_MAP 值集合。
 *
 * 为什么要它：弹幕词 → 引擎类型名 → 单价，任何一环拼错都是**静默空操作/静默免费**
 * （引擎只打一行 `Could not find type:X`）。本脚本把「表里的价」与游戏自己的两份
 * 权威数据对起来，让不一致显式化。
 *
 * 用法：node tools/verify_unit_prices.js          （RW_GAME_DIR 可覆盖游戏目录）
 * 退出码 0 = 无「可召唤却无价」且 B/C 无冲突。
 */
const fs = require('fs')
const path = require('path')

const GAME_DIR = process.env.RW_GAME_DIR ||
  'D:\\game\\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\\Rusted Warfare1.15'
const RML = path.join(GAME_DIR, 'assets', 'gui', 'help_unitstats.rml')
const UNITS_DIR = path.join(GAME_DIR, 'assets', 'units')

let pass = 0
let fail = 0
const lines = []
function check (name, ok, detail) {
  if (ok) { pass++; lines.push(`[PASS] ${name}${detail ? '  -- ' + detail : ''}`) } else { fail++; lines.push(`[FAIL] ${name}${detail ? '  -- ' + detail : ''}`) }
}
function info (msg) { lines.push(`[info] ${msg}`) }

// ── 归一化：引擎类型名 ↔ ini name ↔ 官方页 id 之间存在 c_ 前缀 / 尾 C 差异 ──
function normId (s) {
  return String(s).toLowerCase().replace(/^c_/, '').replace(/c$/, '')
}
// 显式别名：项目表里的拼写与引擎拼写确实不同（引擎侧 nukeLauncherC，项目侧 nukeLaucher）
const ALIAS = { nukelaucher: 'nukelauncher', antinukelaucher: 'antinukelauncher' }
function canon (s) { const n = normId(s); return ALIAS[n] || n }

// ── 源①：官方 Help → Unit Stats 页 ──────────────────────────
function readOfficialStats () {
  const map = new Map()
  let raw
  try { raw = fs.readFileSync(RML, 'utf8') } catch (e) { return { map, error: e.message } }
  for (const b of raw.split('<div class="unit">').slice(1)) {
    const body = b.split('</div>')[0]
    const id = (body.match(/unit:([A-Za-z0-9_]+)/) || [])[1]
    if (!id) continue
    const pre = (body.match(/<pre>([\s\S]*?)<\/pre>/) || [])[1] || ''
    const num = (label) => {
      const m = pre.match(new RegExp('(?:^|\\n)\\s*' + label + ':\\s*\\$?([0-9.]+)'))
      return m ? Number(m[1]) : null
    }
    map.set(canon(id), { id, price: num('Price'), hp: num('Hp') })
  }
  return { map, error: null }
}

// ── 源②：assets\units\**\*.ini 的 [core] 段 ─────────────────
function readIniCore () {
  const map = new Map()
  const files = []
  const walk = (d) => {
    let ents
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch (e) { return }
    for (const e of ents) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.toLowerCase().endsWith('.ini')) files.push(p)
    }
  }
  walk(UNITS_DIR)
  for (const f of files) {
    let txt
    try { txt = fs.readFileSync(f, 'utf8') } catch (e) { continue }
    let sec = ''
    const core = {}
    for (const raw of txt.split(/\r?\n/)) {
      const line = raw.replace(/\/\/.*$/, '')
      const m = /^\s*\[([^\]]+)\]\s*$/.exec(line)
      if (m) { sec = m[1].trim().toLowerCase(); continue }
      if (sec !== 'core') continue
      const kv = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(.*?)\s*$/.exec(line)
      if (!kv) continue
      const k = kv[1].toLowerCase()
      if (!(k in core)) core[k] = kv[2]
    }
    if (core.name) {
      map.set(canon(core.name), {
        file: path.relative(UNITS_DIR, f).split(path.sep).join('/'),
        name: core.name,
        price: core.price
      })
    }
  }
  return map
}

// ── 载入 ───────────────────────────────────────────────────
// 本脚本依赖游戏数据文件；没有游戏目录的环境（CI / 别的机器）按「跳过」处理，
// 而不是把 `npm run verify` 弄红——缺数据 ≠ 代码有问题。
if (!fs.existsSync(RML) && !fs.existsSync(UNITS_DIR)) {
  console.log(`[SKIP] 找不到游戏数据目录（${GAME_DIR}）——单价对账需要游戏文件，跳过。`)
  process.exit(0)
}

const { map: official, error: rmlErr } = readOfficialStats()
const ini = readIniCore()
const prices = require('../battle/unit-prices.json')
const spawner = require('../battle/liveSpawner')
const types = [...new Set(Object.values(spawner.UNIT_MAP))].sort()

if (rmlErr) check('A0 读到官方 Help 页', false, rmlErr)
else check('A0 读到官方 Help 页', official.size > 0, `${official.size} 个单位`)
check('A0b 读到 ini [core] 段', ini.size > 0, `${ini.size} 个带 name 的 ini`)

// ── A. 可召唤单位必须都有价（null/缺失 = 静默免费） ─────────
const free = types.filter((t) => !Number.isFinite(prices[t]))
check('A1 可召唤单位全部有价（0 = 无静默免费）', free.length === 0,
  free.length ? '无价: ' + free.join(', ') : `${types.length} 个可召唤单位全部有价`)

// ── B. 项目价必须与至少一个权威源一致 ──────────────────────
// 判据刻意放宽到「命中任一源」：官方 Help 页与 assets\units ini 之间本身会不同步
// （实测 laserTank 页=1300/ini=1600；experiementalCarrier 页=38000/ini=30000），
// 项目只需与其中之一吻合；**两源都够不着才是真错**。
const conflicts = []
const srcMismatch = []
let covered = 0
for (const t of types) {
  const off = official.get(canon(t))
  const row = ini.get(canon(t))
  const offPrice = off && off.price != null ? off.price : null
  const iniPrice = row && Number.isFinite(Number(row.price)) ? Number(row.price) : null
  if (offPrice != null && iniPrice != null && offPrice !== iniPrice) {
    srcMismatch.push(`${t}: 官方页=${offPrice} ini=${iniPrice}(${row.file})`)
  }
  const cands = [offPrice, iniPrice].filter((x) => x != null)
  if (!cands.length) continue
  covered++
  if (!cands.includes(prices[t])) {
    conflicts.push(`${t}: 表=${prices[t]} 权威=${[...new Set(cands)].join('/')}`)
  }
}
check('B1 项目价与权威源一致（至少命中一个）', conflicts.length === 0,
  conflicts.length ? conflicts.join(' | ') : `比对 ${covered} 项全部一致`)
if (srcMismatch.length) {
  info(`官方页与 ini 本身不同步（${srcMismatch.length} 项，项目命中其中之一即通过）：${srcMismatch.join(' | ')}`)
}

// ── D. 覆盖面（信息性，不作门禁） ──────────────────────────
const notInOfficial = types.filter((t) => !official.has(canon(t)))
const notInIni = types.filter((t) => !ini.has(canon(t)))
info(`可召唤 ${types.length} 项：官方页命中 ${types.length - notInOfficial.length}，ini 命中 ${types.length - notInIni.length}`)
if (notInOfficial.length) info(`官方页未收录（mod 单位）：${notInOfficial.join(', ')}`)
if (notInIni.length) info(`ini 里没有（引擎内置/mod 追加）：${notInIni.join(', ')}`)

const unexplained = Object.keys(prices).filter((k) => !official.has(canon(k)) && !ini.has(canon(k)))
if (unexplained.length) info(`unit-prices.json 中两源都找不到的键（${unexplained.length}，多为建筑/装饰/非召唤项，无害）：${unexplained.join(', ')}`)

// ── 对账表 ─────────────────────────────────────────────────
lines.push('')
lines.push('可召唤单位对账（类型 | 项目价 | 官方页 | ini）:')
for (const t of types) {
  const off = official.get(canon(t))
  const row = ini.get(canon(t))
  lines.push(`  ${t.padEnd(22)} | ${String(prices[t]).padEnd(7)} | ${String(off && off.price != null ? off.price : '-').padEnd(7)} | ${row && row.price ? row.price : '-'}`)
}

console.log(lines.join('\n'))
console.log(`\nSUMMARY: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
