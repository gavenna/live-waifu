#!/usr/bin/env node
/**
 * gen_unit_categories.js — 把 battle/mod-units.json 的 7 个领域类归入主播要的
 * **land / sea / air / building** 四桶（+ 实验级横跨清单），写 battle/unit-categories.json。
 *
 * 为什么要它：主播要把「召唤兵种」按四类指定范围（第 2 点）。本脚本给出**完整、不重不漏**
 * 的初版分类，主播在 docs/兵种分类模板.md 里按桶挑代表即可。
 *
 * 映射（7 → 4）：
 *   陆战 / 悬浮·两栖               → land
 *   空中                          → air
 *   海面                          → sea
 *   防御建筑 / 建筑·设施           → building
 *   实验级(横跨)                  → 按 movement 落域（AIR→air / SEA·UNDERWATER→sea / LAND·HOVER→land / 其余→building）
 *   ⚠️ 实验级同时出现在它落的**域桶**和 `experimental` 横跨清单里（横跨 ≠ 第五个桶）。
 *
 * 用法：node tools/gen_unit_categories.js [--out <json>]
 */
'use strict'
const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, '..', 'battle', 'mod-units.json')
const OUT = path.join(__dirname, '..', 'battle', 'unit-categories.json')
let MAP = null
try { MAP = require(path.join(__dirname, '..', 'battle', 'map-config.json')) } catch (e) { MAP = null }

/** 7 类 → 四桶。导出供 verify 复用。 */
function bucketOf (u) {
  const c = u.category
  if (c === '陆战' || c === '悬浮/两栖') return 'land'
  if (c === '空中') return 'air'
  if (c === '海面') return 'sea'
  if (c === '防御建筑' || c === '建筑/设施') return 'building'
  if (c === '实验级') {
    const m = String(u.movement || '').toUpperCase()
    if (m === 'AIR') return 'air'
    if (m === 'SEA' || m === 'UNDERWATER' || m === 'WATER' || m === 'AMPHIBIOUS') return 'sea'
    if (m === 'LAND' || m === 'HOVER') return 'land'
    return 'building' // moveSpeed=0 的站桩实验单位归建筑
  }
  return 'land' // 兜底（未知类归陆）
}

function buildCategories (modUnits, mapCfg) {
  const buckets = { land: [], sea: [], air: [], building: [] }
  const experimental = []
  for (const u of (modUnits.units || [])) {
    if (!u || !u.type) continue
    const b = bucketOf(u)
    buckets[b].push({ type: u.type, zh: u.zh || u.en || u.type, price: u.price, hp: u.hp, movement: u.movement, tier: u.tier || '未入池' })
    if (u.category === '实验级' || u.experimental === true) experimental.push(u.type)
  }
  for (const k of Object.keys(buckets)) buckets[k].sort((a, b) => (a.price || 0) - (b.price || 0))
  return {
    note: '主播四分类（land/sea/air/building，+ experimental 横跨清单）；由 tools/gen_unit_categories.js 生成，可手改。',
    source: 'battle/mod-units.json',
    map: mapCfg ? mapCfg.map : null,
    mapHasWater: mapCfg ? !!mapCfg.hasWater : null,
    mapping: { '陆战': 'land', '悬浮/两栖': 'land', '空中': 'air', '海面': 'sea', '防御建筑': 'building', '建筑/设施': 'building', '实验级': '按 movement 落域，另入 experimental' },
    counts: { land: buckets.land.length, sea: buckets.sea.length, air: buckets.air.length, building: buckets.building.length, experimental: experimental.length, total: (modUnits.units || []).length },
    buckets,
    experimental
  }
}

function main (argv) {
  const i = argv.indexOf('--out')
  const out = i >= 0 ? argv[i + 1] : OUT
  const modUnits = JSON.parse(fs.readFileSync(SRC, 'utf8'))
  const cats = buildCategories(modUnits, MAP)
  fs.writeFileSync(out, JSON.stringify(cats, null, 2) + '\n')
  console.log('已生成 ' + out)
  console.log('  四桶: ' + JSON.stringify(cats.counts))
  console.log('  实验级横跨: ' + cats.counts.experimental)
  return 0
}

if (require.main === module) {
  try { process.exit(main(process.argv.slice(2))) } catch (e) { console.error('ERROR: ' + (e && e.message)); process.exit(1) }
}
module.exports = { buildCategories, bucketOf }
