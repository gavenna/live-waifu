#!/usr/bin/env node
/**
 * verify_unit_categories.js — 校验四分类模板不重不漏（覆盖 mod-units.json 全部单位）。
 * 跑法：node tools/verify_unit_categories.js ；exit 0 = 全过。
 */
'use strict'
let modUnits, cats
let fails = 0
function chk (n, ok, d) {
  console.log((ok ? 'OK   ' : 'FAIL ') + n + (d ? '  -- ' + d : ''))
  if (!ok) fails++
}
try { modUnits = require('../battle/mod-units.json') } catch (e) { console.log('FAIL 读 mod-units.json: ' + e.message); process.exit(1) }
try { cats = require('../battle/unit-categories.json') } catch (e) { console.log('FAIL unit-categories.json 不存在/不可解析: ' + e.message); process.exit(1) }

const FOUR = ['land', 'sea', 'air', 'building']
chk('1) unit-categories.json 含四桶(land/sea/air/building)',
  !!(cats && cats.buckets) && FOUR.every((k) => Array.isArray(cats.buckets[k])))

const all = []
for (const k of FOUR) for (const u of (cats.buckets[k] || [])) all.push(u.type)
const types = new Set((modUnits.units || []).filter((u) => u && u.type).map((u) => u.type))
const total = types.size
chk('2) 四桶并集条数 == mod-units 单位数', all.length === total, all.length + ' vs ' + total)
const set = new Set(all)
chk('3) 四桶无重复', set.size === all.length, 'unique ' + set.size)
const missing = [...types].filter((t) => !set.has(t))
chk('4) 无遗漏（每个 mod 单位都入四桶之一）', missing.length === 0,
  'missing=' + missing.length + (missing.length ? ' e.g. ' + missing.slice(0, 5).join(',') : ''))
const extra = all.filter((t) => !types.has(t))
chk('5) 无多出（桶里没有 mod-units 之外的）', extra.length === 0, 'extra=' + extra.length)
const exp = cats.experimental || []
chk('6) experimental 横跨清单 ⊂ 四桶', exp.every((t) => set.has(t)), 'n=' + exp.length)

console.log('RESULT: ' + (fails ? 'FAIL' : 'PASS'))
process.exit(fails ? 1 : 0)
