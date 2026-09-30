'use strict'
/**
 * verify_log_silent.js — 离线回归：**测试不污染真实直播日志**
 *
 * 背景：回归脚本 require 了 battle 就会打日志（[REP]/[CREDITS]/[BATTLE]…）。
 *   以前它们被追加进真实的 logs/combined.log ⇒ 排障时真假行混在一起。
 * 规则（logger.js）：入口脚本位于 tools/ 下 ⇒ 视为离线回归，默认**不落盘**；
 *   RW_LOG_SILENT=1 强制静默、=0 强制落盘（生产入口 index.js 不受影响）。
 *
 * 跑法：node tools/verify_log_silent.js ；exit 0 = 全过。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

let pass = 0
let fail = 0
const out = []
function chk (n, ok, d) { if (ok) pass++; else fail++; out.push((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? '  -- ' + d : '')) }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-verify-'))
const LOGGER = path.join(__dirname, '..', 'logger.js')

// 入口**放在 tools/ 之外** ⇒ 不算离线回归（模拟生产入口）
const outsideEntry = path.join(dir, 'entry.js')
fs.writeFileSync(outsideEntry, `require(${JSON.stringify(LOGGER)}).info('HELLO-FROM-CHILD')\n`, 'utf8')

// 一个真实的 tools/ 下的回归脚本（它会 require ../battle ⇒ 必然打日志）
const toolsEntry = path.join(__dirname, 'verify_champion_award.js')

function runChild (entry, extraEnv) {
  const env = Object.assign({}, process.env)
  delete env.RW_LOG_SILENT                       // 父进程的继承值清掉，避免干扰
  Object.assign(env, extraEnv || {})
  try { execFileSync(process.execPath, [entry], { env, stdio: 'ignore', timeout: 60000 }) } catch (e) { /* 子进程非 0 退出不算本次断言失败 */ }
}
const sizeOf = (f) => { try { return fs.statSync(f).size } catch (e) { return -1 } }

// A. 普通入口（非 tools/）+ 未静默 ⇒ 落盘
const tmpA = path.join(dir, 'a.log')
runChild(outsideEntry, { RW_LOG_FILE: tmpA })
chk('A1 非 tools/ 入口 → 正常落盘', sizeOf(tmpA) > 0, 'size=' + sizeOf(tmpA))

// B. RW_LOG_SILENT=1 ⇒ 不落盘
const tmpB = path.join(dir, 'b.log')
runChild(outsideEntry, { RW_LOG_FILE: tmpB, RW_LOG_SILENT: '1' })
chk('A2 RW_LOG_SILENT=1 → 不落盘', sizeOf(tmpB) === -1, 'size=' + sizeOf(tmpB))

// C. 入口在 tools/ 下 ⇒ 默认静默（真跑一个既有回归）
const tmpC = path.join(dir, 'c.log')
runChild(toolsEntry, { RW_LOG_FILE: tmpC })
chk('A3 tools/ 下的回归默认不落盘（不污染 live 日志）', sizeOf(tmpC) === -1, 'size=' + sizeOf(tmpC))

// D. 显式 RW_LOG_SILENT=0 ⇒ 覆盖，tools/ 也落盘
const tmpD = path.join(dir, 'd.log')
runChild(toolsEntry, { RW_LOG_FILE: tmpD, RW_LOG_SILENT: '0' })
chk('A4 RW_LOG_SILENT=0 可覆盖（tools/ 也落盘）', sizeOf(tmpD) > 0, 'size=' + sizeOf(tmpD))

try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) { /* ignore */ }
out.forEach((l) => console.log(l))
console.log(`\n${pass} PASS / ${fail} FAIL   (offline)`)
process.exit(fail ? 1 : 0)
