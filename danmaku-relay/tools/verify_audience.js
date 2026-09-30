'use strict'
/**
 * verify_audience.js — 离线回归：观众羁绊图谱（audience 持久化）
 *
 * 被测改动：danmaku-relay/battle/audience.js（新）、battle/index.js（埋点接线）。
 *
 * 手段：RW_AUDIENCE_FILE 指向临时文件 —— 断言「记录 → 落盘 → 重启读回」这条链真的通，
 *       不是源码正则匹配。零副作用：临时文件用后即删，不碰真实 data/audience.json。
 *
 * 跑法：node tools/verify_audience.js   退出码 0 = 全过。
 */
const os = require('os')
const path = require('path')
const fs = require('fs')

const TMP = path.join(os.tmpdir(), 'audience-verify-' + process.pid + '.json')
try { fs.unlinkSync(TMP) } catch (e) { /* ignore */ }
process.env.RW_LOG_FILE = path.join(os.tmpdir(), 'audience-verify-' + process.pid + '.log')
process.env.RW_AUDIENCE_FILE = TMP
process.env.RW_AUDIENCE_ENABLED = '1'
process.env.RW_REGULAR_MIN_SPAWNS = '3'

let pass = 0
let fail = 0
const lines = []
function check (name, ok, detail) {
  if (ok) { pass++; lines.push('[PASS] ' + name + (detail ? '  -- ' + detail : '')) } else { fail++; lines.push('[FAIL] ' + name + (detail ? '  -- ' + detail : '')) }
}
function done () {
  try { fs.unlinkSync(TMP) } catch (e) { /* ignore */ }
  for (const l of lines) console.log(l)
  console.log('')
  console.log(`${pass} PASS / ${fail} FAIL`)
  process.exit(fail ? 1 : 0)
}

let aud
try { aud = require('../battle/audience') } catch (e) {
  check('M0 audience 模块存在（可 require）', false, (e && e.message) || String(e))
  done()
}

// ================= A. 模块行为 =================
aud.reset()
aud.recordSpawn('douyin_1', '阿甲', 1, 3, 300)
aud.recordSpawn('douyin_1', '阿甲', 1, 2, 200)
aud.recordSpawn('douyin_2', '阿乙', 2, 1, 150)
aud.recordCredits('douyin_2', '阿乙', 2, 'like')
aud.recordCredits('douyin_2', '阿乙', 2, 'follow')
aud.recordTitle('douyin_1', '冠军')

const v1 = aud.get('douyin_1')
check('A1 recordSpawn 累计 spawns/spent', !!v1 && v1.spawns === 5 && v1.spent === 500, JSON.stringify(v1))
check('A2 recordCredits 计数', (() => { const v = aud.get('douyin_2'); return v && v.likes === 1 && v.follows === 1 })(), JSON.stringify(aud.get('douyin_2')))
check('A3 isRegular：spawns>=3 判老粉', aud.isRegular('douyin_1') === true && aud.isRegular('douyin_2') === false, `甲=${aud.isRegular('douyin_1')} 乙=${aud.isRegular('douyin_2')}`)
check('A4 recordTitle → titlesOf 含称号', JSON.stringify(aud.titlesOf('douyin_1')) === JSON.stringify(['冠军']), JSON.stringify(aud.titlesOf('douyin_1')))
check('A5 名字随记录更新', aud.get('douyin_1').name === '阿甲', aud.get('douyin_1').name)
const snap = aud.snapshot()
check('A6 snapshot 含 viewers 且按 spawns 降序', Array.isArray(snap.viewers) && snap.viewers[0].pid === 'douyin_1', JSON.stringify(snap.viewers.map((v) => `${v.pid}:${v.spawns}`)))
check('A7 未知 pid → get 返回 null', aud.get('douyin_none') === null, String(aud.get('douyin_none')))

// ================= B. 持久化（落盘 + 重启读回）=================
check('B1 save() 落盘成功', aud.save() === true && fs.existsSync(TMP), 'exists=' + fs.existsSync(TMP))
let parsed = null
try { parsed = JSON.parse(fs.readFileSync(TMP, 'utf8')) } catch (e) { parsed = null }
check('B2 文件可解析且含 viewers', !!parsed && Array.isArray(parsed.viewers) && parsed.viewers.length === 2, JSON.stringify(parsed && parsed.viewers && parsed.viewers.length))
aud.reset()
check('B3 reset 清空内存', aud.get('douyin_1') === null && aud.size() === 0, 'size=' + aud.size())
aud.reload()
check('B4 reload 读回（模拟重启恢复）', !!aud.get('douyin_1') && aud.get('douyin_1').spawns === 5 && JSON.stringify(aud.titlesOf('douyin_1')) === JSON.stringify(['冠军']), JSON.stringify(aud.get('douyin_1')))

// ================= C. 接线（源码级）=================
const bi = fs.readFileSync(path.join(__dirname, '..', 'battle', 'index.js'), 'utf8')
check('C1 index.js 埋 audience.recordSpawn', /audience\.recordSpawn\(/.test(bi), '')
check('C2 index.js 埋 audience.recordCredits', /audience\.recordCredits\(/.test(bi), '')
check('C3 index.js 埋 audience.touch（进房）', /audience\.touch\(/.test(bi), '')
check('C4 index.js 导出 audience', /\baudience\b/.test(bi) && /audience,/.test(bi), '')

done()
