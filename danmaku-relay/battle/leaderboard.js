'use strict'
/**
 * battle/leaderboard.js — 观众/阵营榜单数据源（排行榜**与游戏解耦**）。
 *
 * 这里只在**中继内存**里累计每个观众的贡献，经 `GET /api/leaderboard` 暴露 JSON，
 * 直播端（OBS 浏览器源 toolbox/leaderboard.html）自行轮询渲染 —— 与游戏完全解耦。
 *
 * 统计口径：spawns=召唤单位数（弹幕/礼物都算）、spent=花费、likes/follows=点赞/关注次数。
 *
 * ★ 2026-09-27 双榜：
 *   · **本轮榜**（viewers）= 原行为：每轮 `reset()` 清零，用于本轮战报 / 冠军判定；
 *   · **累计榜**（season）= 新增：跨轮累计、**落盘**（RW_SEASON_FILE，默认 data/leaderboard-season.json），
 *     多一项 **wins=夺冠次数**（本轮贡献第一的次数）—— 让长期刷分的观众一直留在榜上。
 *     排序：wins ↓ → spawns ↓ → spent ↓。
 */
const fs = require('fs')
const path = require('path')

const viewers = new Map() // 本轮：pid -> { pid, name, team, spawns, spent, likes, follows, lastTs }
const season = new Map()  // 累计：pid -> { pid, name, team, spawns, spent, likes, follows, wins, lastTs }
let roundSeq = 0

const SEASON_FILE = process.env.RW_SEASON_FILE ||
  path.join(__dirname, '..', 'data', 'leaderboard-season.json')

function ensureIn (map, pid, name, team) {
  let v = map.get(pid)
  if (!v) {
    v = { pid, name: name || pid, team: (team === undefined ? null : team), spawns: 0, spent: 0, likes: 0, follows: 0, lastTs: 0 }
    if (map === season) v.wins = 0
    map.set(pid, v)
  }
  if (name) v.name = name
  if (team !== undefined && team !== null) v.team = team
  return v
}
function ensure (pid, name, team) { return ensureIn(viewers, pid, name, team) }

/** 记录一次召唤（弹幕 / 礼物都走这里；spent 对礼物传 0）。本轮榜与累计榜同记。 */
function recordSpawn (pid, name, team, count, spent) {
  if (!pid) return
  const n = Math.max(0, count || 0)
  const sp = Math.max(0, Math.round(spent || 0))
  const now = Date.now()
  const a = ensureIn(viewers, pid, name, team); a.spawns += n; a.spent += sp; a.lastTs = now
  const b = ensureIn(season, pid, name, team); b.spawns += n; b.spent += sp; b.lastTs = now
  saveSeasonSoon()
}

/** 记录一次互动（点赞 / 关注）。本轮榜与累计榜同记。 */
function recordCredits (pid, name, team, source) {
  if (!pid) return
  const now = Date.now()
  for (const map of [viewers, season]) {
    const v = ensureIn(map, pid, name, team)
    if (source === 'follow') v.follows += 1
    else v.likes += 1
    v.lastTs = now
  }
  saveSeasonSoon()
}

/** 记录一次**夺冠**（本轮贡献第一 / 前三）。只进累计榜。 */
function recordWin (pid, name, team) {
  if (!pid) return
  const v = ensureIn(season, pid, name, team)
  v.wins += 1
  v.lastTs = Date.now()
  saveSeasonSoon()
}

/** 新轮开局清零（**本轮榜**按轮统计；累计榜不受影响）。 */
function reset () { viewers.clear(); roundSeq += 1 }

function teamName (t) { return t === 1 ? '红方' : t === 2 ? '蓝方' : null }

function row (v) {
  return { pid: v.pid, name: v.name, team: v.team, teamName: teamName(v.team), spawns: v.spawns,
    spent: v.spent, likes: v.likes, follows: v.follows, wins: v.wins || 0, lastTs: v.lastTs }
}

/**
 * 本轮快照。viewers 按「召唤数 → 花费 → 点赞」降序；factions 由调用方注入（阵营维）。
 * @param {{factions?:object}} [opts]
 */
function snapshot (opts) {
  opts = opts || {}
  const list = [...viewers.values()].map(row)
    .sort((a, b) => b.spawns - a.spawns || b.spent - a.spent || b.likes - a.likes)
  return { ts: Date.now(), roundSeq, viewers: list, season: seasonSnapshot().viewers, factions: opts.factions || null }
}

/** 累计榜快照（跨轮）。排序：夺冠次数 → 累计召唤 → 累计花费。 */
function seasonSnapshot () {
  const list = [...season.values()].map(row)
    .sort((a, b) => b.wins - a.wins || b.spawns - a.spawns || b.spent - a.spent)
  return { ts: Date.now(), viewers: list }
}

// ===== 累计榜落盘（防抖：2s 内多次变更只写一次）=====
let _saveTimer = null
function saveSeasonNow () {
  try {
    fs.mkdirSync(path.dirname(SEASON_FILE), { recursive: true })
    const body = JSON.stringify({ ts: Date.now(), viewers: [...season.values()] }, null, 1)
    const tmp = SEASON_FILE + '.tmp'
    fs.writeFileSync(tmp, body, 'utf8')
    fs.renameSync(tmp, SEASON_FILE)
    return true
  } catch (e) { return false }
}
function saveSeasonSoon () {
  if (_saveTimer) return false
  _saveTimer = setTimeout(() => { _saveTimer = null; saveSeasonNow() }, 2000)
  if (_saveTimer.unref) _saveTimer.unref()
  return true
}
/** 从磁盘载入累计榜（启动时调；文件缺失/损坏一律留空，永不抛）。 */
function loadSeason () {
  season.clear()
  try {
    const raw = JSON.parse(fs.readFileSync(SEASON_FILE, 'utf8'))
    for (const v of (raw.viewers || [])) {
      if (!v || !v.pid) continue
      season.set(String(v.pid), { pid: String(v.pid), name: v.name || String(v.pid),
        team: (v.team === undefined ? null : v.team), spawns: Math.max(0, v.spawns | 0),
        spent: Math.max(0, v.spent | 0), likes: Math.max(0, v.likes | 0),
        follows: Math.max(0, v.follows | 0), wins: Math.max(0, v.wins | 0), lastTs: v.lastTs || 0 })
    }
  } catch (e) { /* 首次运行无文件 / 损坏 —— 留空，不阻断起局 */ }
  return season.size
}
/** 清空累计榜（开新赛季）+ 立即落盘。 */
function resetSeason () { season.clear(); saveSeasonNow(); return true }

module.exports = {
  recordSpawn, recordCredits, recordWin, ensure, reset, resetSeason,
  snapshot, seasonSnapshot, loadSeason, saveSeasonNow, teamName,
  SEASON_FILE,
  _viewers: viewers, _season: season
}
