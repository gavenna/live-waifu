'use strict'
/**
 * battle/difficulty.js — 每轮给红蓝两队写**不同**的 AI 难度（一强一弱）
 *
 * 为什么需要它：引擎的 AI 难度是**每队**的，来源是地图 Triggers 里 team_N_info 的
 *   `lockAiDifficulty`（gameFramework\n\f.java:341-346：设该 AI 的 .x=难度、.y=锁定，
 *   并打日志 `Locking lockAiDifficulty:N by map request to: V`）。
 *   运行时**没有** per-team setter（Debug.java 只有全局 setNetworkaiDifficulty）
 *   ⇒ 要做到"每把一强一弱"，只能**每轮改写加载用的地图副本**：中继每轮把 mods/maps 的源图
 *   复制进 assets/ 之后、加载之前写难度（源图不动，改写只落在副本上）。
 *
 * 难度刻度沿用 battleConfig 的 aiDifficulty 区间（-2..3，界面 6 档）。
 * 弱/强各从固定集合里随机取，并随机决定红蓝谁拿强 —— 保证 (a) 两边不同、(b) 每轮不同。
 */
const fs = require('fs')

/** 弱档候选 / 强档候选。
 *  ★ 2026-09-27：主播要「热闹但别一边倒」⇒ 收窄差距。原 [-2,-1,0] vs [1,2,3] 最多差 5 档，
 *    单看一轮会明显一边倒（实测出现过红=0/蓝=3）。现在两边都够强（≥1）且只差 1~2 档。 */
const WEAK_LEVELS = [1, 2]
const STRONG_LEVELS = [3]

/** 开关：`RW_AI_DIFF_PAIR=0` 关闭（退回"两边同难度"，由全局 aiDifficulty 决定）。 */
const ENABLED = String(process.env.RW_AI_DIFF_PAIR || '1') !== '0'

function isWeakLevel (v) { return WEAK_LEVELS.indexOf(Number(v)) >= 0 }
function isStrongLevel (v) { return STRONG_LEVELS.indexOf(Number(v)) >= 0 }

function pickFrom (arr, rng) {
  const r = (typeof rng === 'function') ? Number(rng()) : Math.random()
  const x = Number.isFinite(r) ? Math.min(0.999999, Math.max(0, r)) : 0
  return arr[Math.floor(x * arr.length)]
}

/**
 * 抽一对难度：弱/强各随机取档，再随机决定红蓝谁拿强。
 * 弱/强取自**不相交**集合 ⇒ 天然 `red !== blue`（不需要额外去重）。
 * @param {() => number} [rng] 注入随机源（离线回归用确定性 rng）
 * @returns {{red:number, blue:number}}
 */
function pickPair (rng) {
  const weak = pickFrom(WEAK_LEVELS, rng)
  const strong = pickFrom(STRONG_LEVELS, rng)
  const redStrong = ((typeof rng === 'function') ? Number(rng()) : Math.random()) < 0.5
  return redStrong ? { red: strong, blue: weak } : { red: weak, blue: strong }
}

// team_N_info 的 <properties>…</properties> 段（N 用边界避开 team_11_info 之类误匹配）
const _teamPropsRe = (n) => new RegExp(
  '(<object\\b[^>]*\\bname="team_' + n + '_info"[^>]*>\\s*<properties>)([\\s\\S]*?)(</properties>)')
const _lockPropRe = /<property name="lockAiDifficulty" value="[^"]*"\/>/

/** 在 team_N_info 的 <properties> 里 upsert lockAiDifficulty。找不到该队返回原文本。 */
function upsertTeamDifficulty (text, teamN, value) {
  const m = _teamPropsRe(teamN).exec(text)
  if (!m) return text
  const attr = '<property name="lockAiDifficulty" value="' + value + '"/>'
  const props = _lockPropRe.test(m[2]) ? m[2].replace(_lockPropRe, attr) : m[2] + attr
  return text.slice(0, m.index) + m[1] + props + m[3] + text.slice(m.index + m[0].length)
}

/**
 * 纯函数：给 team_1_info / team_2_info upsert lockAiDifficulty（红=pair.red、蓝=pair.blue）。
 * 幂等；图里没有这两个 team_info 时原样返回（不炸）。
 */
function patchMapText (text, pair) {
  let out = text
  out = upsertTeamDifficulty(out, 1, pair.red)
  out = upsertTeamDifficulty(out, 2, pair.blue)
  return out
}

/** 落盘版：读 → patchMapText → 写。返回 {changed, red, blue}。 */
function patchMapFile (filePath, pair) {
  const before = fs.readFileSync(filePath, 'utf8')
  const after = patchMapText(before, pair)
  const changed = after !== before
  if (changed) fs.writeFileSync(filePath, after, 'utf8')
  return { changed, red: pair.red, blue: pair.blue }
}

module.exports = { ENABLED, WEAK_LEVELS, STRONG_LEVELS, isWeakLevel, isStrongLevel,
  pickPair, patchMapText, patchMapFile }
