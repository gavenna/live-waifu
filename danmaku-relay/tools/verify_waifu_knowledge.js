'use strict'
/**
 * verify_waifu_knowledge.js — 离线回归：AI 主播的「玩法知识」= 真值源 + 无技术机密泄漏
 *
 * 被测：danmaku-relay/tools/gen_waifu_knowledge.js（生成器）→ battle/waifu-knowledge.md（产物）。
 * 三组断言：
 *   A) 产物 == 生成器现算（防手改/漂移 —— 旧文件就是手写没同步、教观众已失效的兵种）
 *   B) 覆盖当前**全部**可召唤兵种词 + 关键机制（防"说法滞后于白名单"）
 *   C) 不含技术机密关键词（端口/脚本/注入/路径/进程…）—— 防泄漏给观众
 *
 * 跑法：node tools/verify_waifu_knowledge.js   退出码 0 = 全过。
 */
const fs = require('fs')
const path = require('path')

let pass = 0
let fail = 0
function chk (n, ok, d) {
  console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  -- ' + d : ''))
  if (ok) pass++; else fail++
}

let gen
try { gen = require('./gen_waifu_knowledge') } catch (e) {
  chk('M0 生成器存在（gen_waifu_knowledge.js）', false, (e && e.message) || String(e))
  console.log(''); console.log(`${pass} PASS / ${fail} FAIL`)
  process.exit(1)
}

const FILE = path.join(__dirname, '..', 'battle', 'waifu-knowledge.md')
const built = gen.buildKnowledge()
const onDisk = fs.readFileSync(FILE, 'utf8')

// ===== A. 同步 =====
chk('A1 产物与生成器现算一致（未漂移）', built === onDisk, `disk=${onDisk.length} built=${built.length}`)

// ===== B. 覆盖白名单兵种 + 机制 =====
const wl = require('../battle/summon-whitelist.json')
const units = []
for (const cat of Object.keys(wl.categories || {})) for (const u of (wl.categories[cat] || [])) units.push(u)
for (const u of units) chk(`B 兵种词在知识里: ${u.word}`, built.includes(u.word))
chk('B2 机制-冷却秒数', /\d+\s*秒/.test(built))
chk('B3 零门槛基础兵有说明', /零门槛/.test(built))
chk('B4 礼物机制：按价值加余额 + 闪耀星辰召唤', /礼物/.test(built) && /闪耀星辰/.test(built) && /余额/.test(built))
chk('B5 互动奖励（点赞+关注）', /点赞/.test(built) && /关注/.test(built))

// ===== C. 无技术机密 =====
const FORBIDDEN = [
  [/端口/, '端口'],
  [/8766|8767|9999|1088|9191/, '端口号'],
  [/debug|Debug/i, 'debug'],
  [/\bjar\b/i, 'jar'],
  [/注入/, '注入'],
  [/econ_live|end_live/, '落盘文件'],
  [/lastrun/i, '引擎日志'],
  [/secrets?\.json/i, '密钥文件'],
  [/taskkill|Stop-Process|\bPID\b/, '进程操作'],
  [/\/api\/battle/, '内部 API'],
  [/Process\.|require\(|\.js\b/, '代码/脚本']
]
for (const [re, label] of FORBIDDEN) chk(`C 不含机密（${label}）`, !re.test(built))

console.log('')
console.log(`${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
