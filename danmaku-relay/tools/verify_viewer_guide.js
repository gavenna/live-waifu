'use strict'
/**
 * verify_viewer_guide.js — 离线回归：**观众向玩法说明** = 白名单真值 + 无内部机密
 *
 * 被测：tools/gen_viewer_guide.js（生成器）→ ../../docs/玩法说明.md（产物，主页置顶用）。
 * 三组断言：
 *   A) 产物 == 生成器现算（防手改/漂移 —— 主页文档写错就是对外事故）
 *   B) 覆盖当前**全部**可召唤兵种词 + 关键机制数字（防"说法滞后于白名单"）
 *   C) 不含技术机密关键词（端口/脚本/注入/路径/进程…）—— 这是给观众看的文档
 *
 * 跑法：node tools/verify_viewer_guide.js   退出码 0 = 全过。
 */
const fs = require('fs')
const path = require('path')

let pass = 0
let fail = 0
function chk (name, ok, detail) {
  if (ok) { pass++; console.log(`[PASS] ${name}${detail ? '  -- ' + detail : ''}`) } else { fail++; console.log(`[FAIL] ${name}${detail ? '  -- ' + detail : ''}`) }
}

let gen = null
try { gen = require('./gen_viewer_guide') } catch (e) {
  chk('M0 生成器存在（gen_viewer_guide.js）', false, (e && e.message) || String(e))
  console.log(''); console.log(`${pass} PASS / ${fail} FAIL`)
  process.exit(1)
}

const FILE = path.join(__dirname, '..', '..', 'docs', '玩法说明.md')
let onDisk = ''
try { onDisk = fs.readFileSync(FILE, 'utf8') } catch (e) { chk('M1 产物存在（docs/玩法说明.md）', false, e.message) }
const built = gen.buildGuide()

// ===== A. 同步 =====
if (onDisk) chk('A1 产物与生成器现算一致（未漂移）', built === onDisk, `disk=${onDisk.length} built=${built.length}`)

// ===== B. 覆盖白名单兵种 + 机制 =====
const wl = require('../battle/summon-whitelist.json')
const units = []
for (const cat of Object.keys(wl.categories || {})) for (const u of (wl.categories[cat] || [])) units.push(u)
for (const u of units) chk(`B 兵种词在说明里: ${u.word}`, built.includes(u.word))

const summonable = units.filter((u) => !u.giftOnly).length
const giftOnly = units.filter((u) => u.giftOnly).length
chk('B2 弹幕可召唤种数写对', built.includes(`当前开放 ${summonable} 种`), `expect ${summonable}`)
chk('B3 礼物专属种数写对', built.includes(`另有 **${giftOnly} 种只能靠礼物召唤**`), `expect ${giftOnly}`)
const cdSec = Math.round(((wl.summon && wl.summon.cooldownMs) || 3000) / 1000)
chk('B4 冷却秒数写对', built.includes(`${cdSec} 秒`), `expect ${cdSec}`)
chk('B5 每队每轮上限写对', built.includes(String((wl.summon && wl.summon.teamCapPerRound) || 300)), '')
chk('B6 零门槛基础兵有说明', /零门槛/.test(built) && built.includes('秃鹰'), '')

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
  [/Process\.|require\(|\.js\b/, '代码/脚本'],
  [/danmaku-relay|battle\//, '仓库路径']
]
for (const [re, label] of FORBIDDEN) chk(`C 不含机密（${label}）`, !re.test(built))

console.log('')
console.log(`${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
