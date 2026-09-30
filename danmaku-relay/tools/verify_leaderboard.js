#!/usr/bin/env node
/**
 * verify_leaderboard.js — 外置排行榜（第 3 点）回归。
 *  A) 模块行为：leaderboard.js 的累计 / 排序 / 映射 / 清零。
 *  B) 接线（源码级）：battle/index.js 埋点与导出、中继 /api/leaderboard 端点、overlay 文件存在。
 * 跑法：node tools/verify_leaderboard.js ；exit 0 = 全过。
 */
'use strict'
const fs = require('fs')
const path = require('path')
const os = require('os')
// 隔离：累计榜落盘到临时文件，绝不碰真实 data/leaderboard-season.json
process.env.RW_SEASON_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lb-verify-')), 'season.json')
const SEASON_TMP = process.env.RW_SEASON_FILE
let fails = 0
function chk (n, ok, d) {
  console.log((ok ? 'OK   ' : 'FAIL ') + n + (d ? '  -- ' + d : ''))
  if (!ok) fails++
}

// ===== A. 模块行为 =====
const lb = require('../battle/leaderboard')
lb.reset()
lb.recordSpawn('douyin_1', '阿甲', 1, 3, 300)
lb.recordSpawn('douyin_2', '阿乙', 2, 1, 150)
lb.recordSpawn('douyin_1', '阿甲', 1, 2, 200)
lb.recordCredits('douyin_2', '阿乙', 2, 'like')
lb.recordCredits('douyin_2', '阿乙', 2, 'follow')
const s = lb.snapshot({ factions: { red: { spawns: 5 }, blue: { spawns: 1 } } })
chk('A1 snapshot 结构（viewers[] + ts）', s && Array.isArray(s.viewers) && typeof s.ts === 'number')
const v1 = s.viewers.find((v) => v.pid === 'douyin_1')
const v2 = s.viewers.find((v) => v.pid === 'douyin_2')
chk('A2 同一观众 spawns 累计', v1 && v1.spawns === 5, v1 && ('spawns=' + v1.spawns))
chk('A3 spent 累计', v1 && v1.spent === 500, v1 && ('spent=' + v1.spent))
chk('A4 likes/follows 计数', v2 && v2.likes === 1 && v2.follows === 1)
chk('A5 排序：召唤多者在前', s.viewers[0].pid === 'douyin_1', s.viewers.map((v) => v.pid).join(','))
chk('A6 teamName 映射', v1.teamName === '红方' && v2.teamName === '蓝方')
chk('A7 factions 透传', !!(s.factions && s.factions.blue.spawns === 1))
lb.reset()
chk('A8 reset 清空', lb.snapshot().viewers.length === 0)

// ===== C. 累计榜（跨轮 / 夺冠 / 落盘）=====
lb.resetSeason()
lb.reset()
lb.recordSpawn('p_w1', '冠军甲', 1, 4, 400)
lb.recordSpawn('p_w2', '冠军乙', 2, 2, 200)
lb.recordWin('p_w1', '冠军甲', 1)
lb.recordWin('p_w1', '冠军甲', 1)
lb.recordWin('p_w2', '冠军乙', 2)
lb.reset()   // 新一轮：本轮榜清零，累计榜应保留
chk('C1 reset 后本轮榜空', lb.snapshot().viewers.length === 0)
const se = lb.seasonSnapshot().viewers
chk('C2 累计榜跨轮保留', se.length === 2, 'n=' + se.length)
chk('C3 累计召唤跨轮累计', (se.find((v) => v.pid === 'p_w1') || {}).spawns === 4)
chk('C4 夺冠次数记录', (se.find((v) => v.pid === 'p_w1') || {}).wins === 2 && (se.find((v) => v.pid === 'p_w2') || {}).wins === 1)
chk('C5 排序：夺冠多者在前', se[0].pid === 'p_w1', se.map((v) => v.pid).join(','))
chk('C6 snapshot 带 season 字段', Array.isArray(lb.snapshot().season))
chk('C7 落盘文件生成', lb.saveSeasonNow() && fs.existsSync(SEASON_TMP), SEASON_TMP)
chk('C8 loadSeason 能读回', (function () { lb._season.clear(); return lb.loadSeason() === 2 })())
lb.resetSeason()
chk('C9 resetSeason 清空累计榜', lb.seasonSnapshot().viewers.length === 0)

// ===== B. 接线（源码级）=====
const bi = fs.readFileSync(path.join(__dirname, '..', 'battle', 'index.js'), 'utf8')
chk('B1 battle/index.js 导出 leaderboardSnapshot', /leaderboardSnapshot/.test(bi))
chk('B2 handleDanmaku 埋 recordSpawn', /leaderboard\.recordSpawn\(/.test(bi))
chk('B3 handleCredits 埋 recordCredits', /leaderboard\.recordCredits\(/.test(bi))
chk('B4 开局 reset 榜单', /leaderboard\.reset\(\)/.test(bi))
const ri = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
chk('B5 中继有 /api/leaderboard 端点', /'\/api\/leaderboard'/.test(ri))
chk('B6 overlay 文件存在', fs.existsSync(path.join(__dirname, '..', 'toolbox', 'leaderboard.html')))
chk('B7 结算记录夺冠 leaderboard.recordWin', /leaderboard\.recordWin\(/.test(bi))
chk('B8 启动载入累计榜 leaderboard.loadSeason', /leaderboard\.loadSeason\(\)/.test(bi))
const ov = fs.readFileSync(path.join(__dirname, '..', 'toolbox', 'leaderboard.html'), 'utf8')
chk('B9 overlay 渲染累计榜（rows-se）', /rows-se/.test(ov) && /d\.season/.test(ov))

console.log('RESULT: ' + (fails ? 'FAIL' : 'PASS'))
process.exit(fails ? 1 : 0)
