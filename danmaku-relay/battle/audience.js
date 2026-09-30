/**
 * battle/audience.js — 观众羁绊图谱（持久化）
 *
 * 背景（2026-09-28）：
 *   waifu 的"记忆"过去面向**主人**（waifu-agent/MEMORY_RULES.md：「只有当主人明确说'记住'……」）；
 *   而在直播链路里，观众的足迹（谁召唤过、花了多少、点赞/关注、拿过什么荣誉）此前**只驻内存**——
 *   battle/index.js 的 playerTeams/playerNames 与 leaderboard.js 都在中继重启后清空（两处注释均为证）。
 *   本模块把观众档案落盘到 data/audience.json，让"主播认得老观众 / 记得战绩"有据可依。
 *
 * 与 leaderboard 的分工：
 *   · leaderboard.js  — **本轮**榜单（每轮 reset），供 OBS overlay 实时显示。
 *   · audience.js     — **跨轮/跨场**档案（不清零，落盘），供"羁绊/战绩"回访。
 *
 * env：
 *   RW_AUDIENCE_ENABLED   默认 1；=0 关闭（所有写入 no-op）
 *   RW_AUDIENCE_FILE      数据文件路径（默认 <repo>/data/audience.json；该目录已 .gitignore）
 *   RW_REGULAR_MIN_SPAWNS 判定"老粉"的最小累计召唤数（默认 3）
 *   RW_AUDIENCE_SAVE_MS   落盘去抖间隔（默认 3000ms）
 */
'use strict'
const fs = require('fs')
const path = require('path')
const logger = require('../logger')

function intEnv (name, def) { const v = parseInt(process.env[name], 10); return Number.isFinite(v) && v >= 0 ? v : def }

const ENABLED = String(process.env.RW_AUDIENCE_ENABLED || '1') === '1'
const FILE = process.env.RW_AUDIENCE_FILE || path.join(__dirname, '..', 'data', 'audience.json')
const REGULAR_MIN_SPAWNS = intEnv('RW_REGULAR_MIN_SPAWNS', 3)
const SAVE_DEBOUNCE_MS = intEnv('RW_AUDIENCE_SAVE_MS', 3000)

const viewers = new Map()   // pid -> record
let loaded = false
let saveTimer = null

function blank (pid, name, team) {
  return {
    pid,
    name: name || pid,
    team: (team == null ? null : team),
    spawns: 0, spent: 0, likes: 0, follows: 0,
    titles: [],
    firstSeen: Date.now(),
    lastSeen: 0
  }
}

function ensure (pid, name, team) {
  let v = viewers.get(pid)
  if (!v) { v = blank(pid, name, team); viewers.set(pid, v) }
  else {
    if (name) v.name = name
    if (team != null) v.team = team
  }
  return v
}

/** 惰性从磁盘加载一次（幂等）。无文件 / 非法 JSON → 从空开始，不抛。 */
function load () {
  if (loaded) return true
  loaded = true
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    const list = (j && Array.isArray(j.viewers)) ? j.viewers : []
    for (const v of list) {
      if (!v || !v.pid) continue
      viewers.set(v.pid, {
        pid: v.pid,
        name: v.name || v.pid,
        team: (v.team == null ? null : v.team),
        spawns: Number(v.spawns) || 0,
        spent: Number(v.spent) || 0,
        likes: Number(v.likes) || 0,
        follows: Number(v.follows) || 0,
        titles: Array.isArray(v.titles) ? v.titles.slice() : [],
        firstSeen: Number(v.firstSeen) || Date.now(),
        lastSeen: Number(v.lastSeen) || 0
      })
    }
    logger.info(`[AUDIENCE] 已加载观众档案 ${viewers.size} 条 (${FILE})`)
  } catch (e) { /* 无文件 / 不可读 / 非法 JSON → 空起步 */ }
  return true
}

/** 清空内存并从磁盘重读（模拟重启恢复 / 测试用）。 */
function reload () { viewers.clear(); loaded = false; return load() }

function serialize () { return { version: 1, updatedAt: Date.now(), viewers: [...viewers.values()] } }

/** 原子落盘（tmp + rename）。失败返回 false，不抛。 */
function save () {
  if (!ENABLED) return false
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    const tmp = FILE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(serialize()), 'utf8')
    fs.renameSync(tmp, FILE)
    return true
  } catch (e) {
    logger.warn('[AUDIENCE] 落盘失败: ' + (e && e.message))
    return false
  }
}

/** 去抖落盘（写多读少；定时器 unref，不阻塞进程退出）。 */
function scheduleSave () {
  if (!ENABLED || saveTimer) return
  saveTimer = setTimeout(() => { saveTimer = null; save() }, SAVE_DEBOUNCE_MS)
  if (saveTimer.unref) saveTimer.unref()
}

// ===== 写入（埋点）=====
/** 进房 / 露面：更新昵称、阵营、最后出现。 */
function touch (pid, name, team) {
  if (!ENABLED || !pid) return null
  load()
  const v = ensure(pid, name, team)
  v.lastSeen = Date.now()
  scheduleSave()
  return v
}

/** 召唤（弹幕 / 礼物都算；spent 对礼物传 0）。 */
function recordSpawn (pid, name, team, count, spent) {
  if (!ENABLED || !pid) return null
  load()
  const v = ensure(pid, name, team)
  v.spawns += Math.max(0, Number(count) || 0)
  v.spent += Math.max(0, Math.round(Number(spent) || 0))
  v.lastSeen = Date.now()
  scheduleSave()
  return v
}

/** 互动（点赞 / 关注）。 */
function recordCredits (pid, name, team, source) {
  if (!ENABLED || !pid) return null
  load()
  const v = ensure(pid, name, team)
  if (source === 'follow') v.follows += 1
  else v.likes += 1
  v.lastSeen = Date.now()
  scheduleSave()
  return v
}

/** 荣誉（冠军/亚军/季军）——跨轮累计，供"上局冠军"回访。 */
function recordTitle (pid, title) {
  if (!ENABLED || !pid || !title) return null
  load()
  const v = ensure(pid)
  if (!v.titles.includes(title)) v.titles.push(title)
  v.lastSeen = Date.now()
  scheduleSave()
  return v
}

// ===== 查询 =====
function get (pid) { load(); return viewers.get(pid) || null }
function titlesOf (pid) { const v = get(pid); return v ? v.titles.slice() : [] }
/** 是否"老粉"：累计召唤数达到阈值（默认 RW_REGULAR_MIN_SPAWNS=3）。 */
function isRegular (pid, opts) {
  const v = get(pid)
  if (!v) return false
  const min = (opts && Number.isFinite(opts.minSpawns)) ? opts.minSpawns : REGULAR_MIN_SPAWNS
  return v.spawns >= min
}
function size () { load(); return viewers.size }
function snapshot () {
  load()
  const list = [...viewers.values()]
    .map((v) => ({ ...v, titles: v.titles.slice() }))
    .sort((a, b) => b.spawns - a.spawns || b.spent - a.spent || b.likes - a.likes)
  return { ts: Date.now(), viewers: list }
}
/** 清空**内存**（不动磁盘文件）；后续 get 不再回读，直到 reload()。 */
function reset () { viewers.clear(); loaded = true }

module.exports = {
  touch,
  recordSpawn,
  recordCredits,
  recordTitle,
  get,
  titlesOf,
  isRegular,
  size,
  snapshot,
  reset,
  reload,
  load,
  save,
  ENABLED,
  FILE,
  REGULAR_MIN_SPAWNS,
  _viewers: viewers
}
