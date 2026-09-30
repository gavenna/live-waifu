'use strict'
/**
 * verify_viewer_wall.js — 离线回归：观众墙「按观众去重」（T8）。
 *
 * 背景（换阵营重复头像）：
 *   注入侧 removeRep(key) 只清世界坐标的名字/头像（LABELS/PLACED）+ 杀单位，**不碰 WALL**
 *   （WALL 只存图片路径、无 key）。换阵营时会 removeRep 删旧 + 重新 spawnRepUnit ⇒ 新 spawn
 *   又 addWall 一次，同一头像在观众墙上出现两份。修法：battle/index.js 用 WALL_ADDED(Set) +
 *   addWallOnce(pid, png) 记账，同一轮内每个观众最多 addWall 一次；每轮开局随 clearWall 清空。
 *
 * 跑法：node tools/verify_viewer_wall.js
 * 零副作用：只读 battle/index.js 源码，并在沙箱里执行其 addWallOnce 真实片段。
 * 退出码 0 = 全过。
 */
const fs = require('fs')
const path = require('path')

let pass = 0
let fail = 0
const lines = []
function check (name, ok, detail) {
  if (ok) { pass++; lines.push(`[PASS] ${name}${detail ? '  -- ' + detail : ''}`) } else { fail++; lines.push(`[FAIL] ${name}${detail ? '  -- ' + detail : ''}`) }
}

const src = fs.readFileSync(path.join(__dirname, '..', 'battle', 'index.js'), 'utf8')

// ================= A. 源码结构：addWall 收口 + 去重集合 + 开轮清空 =================
{
  const raw = (src.match(/spawner\.dispatch\(`script debug\.addWall\(/g) || []).length
  check('A1 addWall 的 dispatch 仅 1 处（收口在 addWallOnce 内）', raw === 1, 'count=' + raw)
  check('A2 存在 WALL_ADDED 去重集合', /const WALL_ADDED = new Set\(\)/.test(src))
  check('A3 开局 clearWall 后清空去重集合', /clearWall\(\)'\)\s*\n\s*WALL_ADDED\.clear\(\)/.test(src))
}

// ================= B. 行为：抽取真实 addWallOnce 片段，沙箱里跑换阵营序列 =================
{
  const m = src.match(/const WALL_ADDED = new Set\(\)[\s\S]*?\n\}/)
  check('B0 能从 index.js 抽取 WALL_ADDED/addWallOnce 片段', !!m)
  if (m) {
    const sent = []
    const logs = []
    const spawner = { dispatch: (c) => sent.push(c) }
    const logger = { info: (m) => logs.push(m), warn: () => {} }
    const api = new Function('spawner', 'logger', m[0] + '\nreturn { addWallOnce: addWallOnce, WALL_ADDED: WALL_ADDED }')(spawner, logger)

    api.addWallOnce('douyin_1', 'C:/av/1.png')   // 首次入墙
    api.addWallOnce('douyin_1', 'C:/av/1.png')   // 换阵营后重 spawn：同一 pid，应被去重
    api.addWallOnce('douyin_2', 'C:/av/2.png')   // 另一个观众
    check('B1 同 pid 两次只 addWall 一次（换阵营不重复）', sent.length === 2, 'sent=' + sent.length)
    check('B1b 去重路径写日志（重启后可 grep 复核）', logs.some((m) => String(m).indexOf('跳过重复 addWall') >= 0))
    check('B2 两次分别对应两个观众', sent[0].indexOf('1.png') >= 0 && sent[1].indexOf('2.png') >= 0)
    check('B3 路径反斜杠规范为正斜杠', sent[0].indexOf('\\') === -1 && sent[0].indexOf('debug.addWall(') >= 0)

    api.addWallOnce(null, 'C:/av/x.png')
    check('B4 空 pid 不 addWall', sent.length === 2)

    api.WALL_ADDED.clear()                        // 模拟每轮开局 clearWall 后的清空
    api.addWallOnce('douyin_1', 'C:/av/1.png')
    check('B5 clear 后同 pid 可再次入墙（新一轮重建）', sent.length === 3, 'sent=' + sent.length)
  }
}

for (const l of lines) console.log(l)
console.log('')
console.log(`${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
