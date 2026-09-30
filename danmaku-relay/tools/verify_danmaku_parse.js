'use strict'
/**
 * verify_danmaku_parse.js — 离线回归：观众弹幕的**容错解析**（中文数字 / 易错兵种词）。
 *
 * 背景（2026-09-22 真机日志 danmaku-relay/logs/combined.log）：
 *   观众想参战却因为「写法不对」静默失败——`红三猛犸`（中文数量）、`红山站车`（错别字）
 *   全部被 parseDanmaku 判 null，handleDanmaku 直接丢弃 ⇒ 观众感知 = 「发了没反应」。
 *   本脚本锁死两条容错路径 + 三条**不得误判**的负向护栏。
 *
 * 跑法：  node tools/verify_danmaku_parse.js
 * 零副作用：只 require 纯函数模块，不连游戏、不碰真实 9999、不写文件。退出码 0 = 全过。
 */
process.env.RW_SUMMON_WHITELIST = '0'   // 解析机制测试走旧映射；白名单行为由 verify_summon_whitelist.js 覆盖
const sp = require('../battle/liveSpawner.js')

let pass = 0
let fail = 0
const lines = []
function check (name, ok, detail) {
  if (ok) { pass++; lines.push(`[PASS] ${name}${detail ? '  -- ' + detail : ''}`) }
  else { fail++; lines.push(`[FAIL] ${name}${detail ? '  -- ' + detail : ''}`) }
}
const J = (v) => (v === null ? 'null' : (typeof v === 'string' ? v : JSON.stringify(v)))
function parse (t) {
  try { return sp.parseDanmaku(t) } catch (e) { return 'THROW:' + (e && e.message) }
}

// ================= A. 回归护栏（改动前后都必须绿） =================
{
  const r = parse('红3战车')
  check('A1 「红3战车」→ team1 / viewerTeam3 / tank ×3',
    r && r.team === 1 && r.viewerTeam === 3 && r.unitType === 'tank' && r.count === 3, J(r))

  const s = parse('红 10 战车')
  check('A2 「红 10 战车」（数量前带空格，2026-09-19 修过的场景）→ tank ×10',
    s && s.unitType === 'tank' && s.count === 10, J(s))

  const b = parse('蓝10猛犸')
  check('A3 「蓝10猛犸」→ team2 / viewerTeam4 / mammothTank ×10',
    b && b.team === 2 && b.viewerTeam === 4 && b.unitType === 'mammothTank' && b.count === 10, J(b))
}

// ================= B. 中文数字归一化（Wave 1 目标 1） =================
{
  const r = parse('红三猛犸')
  check('B1 「红三猛犸」→ mammothTank ×3（中文数量）',
    r && r.unitType === 'mammothTank' && r.count === 3, J(r))

  const b = parse('蓝四蜘蛛')
  check('B2 「蓝四蜘蛛」→ team2 / viewerTeam4 / experimentalSpider ×4',
    b && b.team === 2 && b.viewerTeam === 4 && b.unitType === 'experimentalSpider' && b.count === 4, J(b))

  const t = parse('红十战车')
  check('B3 「红十战车」→ tank ×10（十 → 10）',
    t && t.unitType === 'tank' && t.count === 10, J(t))

  const t2 = parse('红十五战车')
  check('B4 「红十五战车」→ tank ×10（十五 → 15，再被 MAX_UNITS_PER_DANMAKU 夹到 10）',
    t2 && t2.unitType === 'tank' && t2.count === 10, J(t2))

  const t3 = parse('蓝二十战车')
  check('B5 「蓝二十战车」→ team2 / tank ×10（二十 → 20，夹到 10）',
    t3 && t3.team === 2 && t3.unitType === 'tank' && t3.count === 10, J(t3))
}

// ================= C. 易错兵种词归一 + 最长包含匹配 =================
{
  const r = parse('红山站车')
  check('C1 「红山站车」→ tank ×1（站车 → 战车 归一）',
    r && r.unitType === 'tank' && r.count === 1, J(r))

  const r2 = parse('红3山站车')
  check('C2 「红3山站车」→ tank ×3（归一 + 数量）',
    r2 && r2.unitType === 'tank' && r2.count === 3, J(r2))

  // C3/C4 是**最长包含匹配**的真护栏：这两个输入只有「取被包含的最长键」才会给出正确结果。
  //   若实现退化成「第一个命中的键」，C3 会被 '坦克'→tank 抢走（'坦克' 在 UNIT_MAP 里排在 '坦克杀手' 之前）、
  //   C4 会被 '悬浮'→hoverTank 抢走（'悬浮' 排在 '重型悬浮' 之前）。
  const k = parse('红坦克杀手连')
  check('C3 「红坦克杀手连」→ tankDestroyer（最长包含匹配，不被 坦克/车 抢走）',
    k && k.unitType === 'tankDestroyer', J(k))

  const k2 = parse('蓝重型悬浮车')
  check('C4 「蓝重型悬浮车」→ heavyHoverTank（不是 hoverTank）',
    k2 && k2.unitType === 'heavyHoverTank', J(k2))

  const k3 = parse('红坦克杀手')
  check('C5 「红坦克杀手」→ tankDestroyer（精确匹配优先级高于包含兜底）',
    k3 && k3.unitType === 'tankDestroyer', J(k3))
}

// ================= D. 负向护栏：不得把闲聊/无阵营当指令 =================
{
  const a = parse('坦克杀手')
  check('D1 「坦克杀手」→ null（无红/蓝前缀，不得误判）', a === null, J(a))

  const b = parse('咋玩')
  check('D2 「咋玩」→ null（闲聊）', b === null, J(b))

  const c = parse('4蜘蛛')
  check('D3 「4蜘蛛」→ null（无阵营前缀；提示可见化见 verify_danmaku_hint）', c === null, J(c))

  const d = parse('')
  check('D4 空串 → null', d === null, J(d))

  const e = parse('没听懂')
  check('D5 「没听懂」→ null（闲聊）', e === null, J(e))
}

for (const l of lines) console.log(l)
console.log('')
console.log(`${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
