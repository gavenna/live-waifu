'use strict'
/**
 * verify_difficulty.js — 离线回归：每轮给红蓝两队写**不同**的 AI 难度（一强一弱）
 *
 * 跑法： node tools/verify_difficulty.js
 * 零副作用：纯函数 + 内存字符串；不连游戏 / 不碰中继。退出码 0 = 全过。
 *
 * 为什么有这个东西：引擎的 AI 难度是**每队**的，只认地图 Triggers 里 team_N_info 的
 *   `lockAiDifficulty`（gameFramework\n\f.java:341-346），运行时没有 per-team setter
 *   ⇒ 只能每轮改写"加载用的地图副本"（battle/difficulty.js + battle/index.js 的接线）。
 */
let pass = 0
let fail = 0
const lines = []
function check (name, ok, detail) {
  if (ok) { pass++; lines.push(`[PASS] ${name}${detail ? '  -- ' + detail : ''}`) } else { fail++; lines.push(`[FAIL] ${name}${detail ? '  -- ' + detail : ''}`) }
}

const difficulty = require('../battle/difficulty.js')

// 与 map_adapt_newdire.py 产出的 Triggers 同格式的样本（含 team_0/1/2/3_info）
const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.0" width="110" height="110">
 <objectgroup name="Triggers" visible="0">
  <object id="1" name="map_info" x="64" y="45" width="203" height="122">
   <properties>
    <property name="type" value="skirmish"/>
   </properties>
  </object>
  <object id="10" name="team_0_info" type="team_info" x="64" y="45" width="160" height="140">
   <properties><property name="team" value="0"/><property name="allyGroup" value="1"/><property name="disabledAI" value="1"/></properties>
  </object>
  <object id="11" name="team_1_info" type="team_info" x="460" y="360" width="160" height="140">
   <properties><property name="team" value="1"/><property name="credits" value="99999"/><property name="allyGroup" value="1"/></properties>
  </object>
  <object id="12" name="team_2_info" type="team_info" x="1700" y="1700" width="160" height="140">
   <properties><property name="team" value="2"/><property name="credits" value="99999"/><property name="allyGroup" value="2"/></properties>
  </object>
  <object id="13" name="team_3_info" type="team_info" x="460" y="360" width="160" height="140">
   <properties><property name="team" value="3"/><property name="allyGroup" value="1"/><property name="disabledAI" value="1"/></properties>
  </object>
 </objectgroup>
</map>`

function teamBlock (text, teamN) {
  const m = new RegExp('<object\\b[^>]*\\bname="team_' + teamN + '_info"[^>]*>[\\s\\S]*?</object>').exec(text)
  return m ? m[0] : ''
}

// ---------- A. pickPair：两边必不相等、强弱分明、每轮随机 ----------
{
  const okPair = (p) => p && Number.isInteger(p.red) && Number.isInteger(p.blue) && p.red !== p.blue
  const isWeak = (v) => difficulty.WEAK_LEVELS.includes(v)
  const isStrong = (v) => difficulty.STRONG_LEVELS.includes(v)
  const okSpread = (p) => (isWeak(p.red) && isStrong(p.blue)) || (isStrong(p.red) && isWeak(p.blue))

  let allDistinct = true; let allSpread = true
  const reds = new Set(); const blues = new Set()
  let redStrongSeen = false; let blueStrongSeen = false
  for (let i = 0; i < 300; i++) {
    const p = difficulty.pickPair()
    if (!okPair(p)) allDistinct = false
    if (!okSpread(p)) allSpread = false
    reds.add(p.red); blues.add(p.blue)
    if (isStrong(p.red)) redStrongSeen = true
    if (isStrong(p.blue)) blueStrongSeen = true
  }
  check('A1 300 次抽样：红蓝难度从不相等', allDistinct)
  check('A2 300 次抽样：每对都恰好一强一弱（取 difficulty 定义的强弱档）', allSpread)
  check('A3 两边都出现过"强"（随机决定谁强，不是固定一边）', redStrongSeen && blueStrongSeen, `redStrong=${redStrongSeen} blueStrong=${blueStrongSeen}`)
  check('A4 弱档与强档都覆盖到多个值（不是写死一对）', reds.size + blues.size >= 3, `reds=${[...reds]} blues=${[...blues]}`)

  // A5：注入确定性 rng → 可复现（这也是离线回归要能重复的前提）
  const seq = [0.0, 0.0, 0.0]   // weak=WEAK[0], strong=STRONG[0], side<0.5 → 红拿强
  let i = 0
  const rng = () => seq[i++ % seq.length]
  const p1 = difficulty.pickPair(rng)
  i = 0
  const p2 = difficulty.pickPair(rng)
  check('A5 同 rng 两次抽到同一对（确定性）', JSON.stringify(p1) === JSON.stringify(p2), JSON.stringify(p1))
  check('A6 该确定性输入下 红强蓝弱', difficulty.isStrongLevel(p1.red) && difficulty.isWeakLevel(p1.blue), JSON.stringify(p1))
}

// ---------- B. patchMapText：给 team_1/2_info upsert lockAiDifficulty ----------
{
  const patched = difficulty.patchMapText(SAMPLE, { red: 3, blue: -1 })
  check('B1 team_1_info 写入 lockAiDifficulty=3', teamBlock(patched, 1).includes('<property name="lockAiDifficulty" value="3"/>'))
  check('B2 team_2_info 写入 lockAiDifficulty=-1', teamBlock(patched, 2).includes('<property name="lockAiDifficulty" value="-1"/>'))
  check('B3 不碰 team_0_info', !teamBlock(patched, 0).includes('lockAiDifficulty') && teamBlock(patched, 0).includes('disabledAI'))
  check('B4 不碰 team_3_info', !teamBlock(patched, 3).includes('lockAiDifficulty'))
  check('B5 其余属性保留（team/credits/allyGroup 都在）',
    teamBlock(patched, 1).includes('name="credits"') && teamBlock(patched, 2).includes('name="allyGroup"'))

  // B6：幂等 —— 再 patch 一次结果不变
  const twice = difficulty.patchMapText(patched, { red: 3, blue: -1 })
  check('B6 幂等（重复 patch 结果一致）', twice === patched)

  // B7：upsert —— 换值不会留下两条
  const changed = difficulty.patchMapText(patched, { red: 2, blue: 0 })
  const n1 = (teamBlock(changed, 1).match(/name="lockAiDifficulty"/g) || []).length
  const n2 = (teamBlock(changed, 2).match(/name="lockAiDifficulty"/g) || []).length
  check('B7 upsert 换值：每队只剩一条（不叠加）', n1 === 1 && n2 === 1 && teamBlock(changed, 1).includes('value="2"'), `n1=${n1} n2=${n2}`)

  // B8：没有 team_info 的图 → 原样返回（不炸）
  const noTeams = '<map><objectgroup name="Triggers"><object name="map_info"><properties><property name="type" value="skirmish"/></properties></object></objectgroup></map>'
  check('B8 无 team_info 时原样返回', difficulty.patchMapText(noTeams, { red: 1, blue: 0 }) === noTeams)
}

console.log(lines.join('\n'))
console.log(`\n${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
