'use strict'
/**
 * verify_viewer_name.js — 离线回归：换阵营后代表单位仍带名字（T9）。
 *
 * 背景（用户实测「切换阵营后名字不见了」）：
 *   handleDanmaku 首次建代表单位用的是**弹幕自带的昵称**（msg.nickname || msg.playerName），
 *   所以第一次有名字；但换阵营重建走的是 rememberTeam 内部：
 *       spawnRepUnit(playerId, playerNames.get(playerId) || null, team)
 *   而 playerNames **只在 handleJoin（进房）时写入** ⇒ 靠「发弹幕表态」出现的观众
 *   （或中继重启后没重新进房的老观众）换阵营时 playerNames 缺记录，名字传成 null → 丢名。
 *   修法：rememberTeam 增加 name 形参并记住昵称；调用方（handleDanmaku / handleJoin）传 name。
 *
 * 跑法：node tools/verify_viewer_name.js
 * 零副作用：只读 battle/index.js 源码，并在沙箱里执行它**真实**的 rememberTeam 片段。
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

// ================= A. 源码结构：签名带 name + 两个调用点都传 name =================
{
  check('A1 rememberTeam 签名含 name 形参', /function rememberTeam \(playerId, team, name\)/.test(src))
  const calls = (src.match(/rememberTeam\s*\(/g) || []).length
  check('A2 rememberTeam 共 3 处（1 定义 + 2 调用）', calls === 3, 'count=' + calls)
  check('A3 handleDanmaku 调用带弹幕昵称 nm', /rememberTeam\(pid, parsed\.team, nm\)/.test(src))
  check('A4 handleJoin 调用带 name', /rememberTeam\(pid, team, name\)/.test(src))
  check('A5 换阵营重建优先用 name 再回退 playerNames',
    /spawnRepUnit\(playerId, name \|\| playerNames\.get\(playerId\) \|\| null, team\)/.test(src))
}

// ================= B. 行为：抽取真实 rememberTeam，跑「未进房观众换阵营」 =================
{
  const m = src.match(/function rememberTeam \(playerId, team, name\) \{[\s\S]*?\n\}/)
  check('B0 能从 index.js 抽取 rememberTeam 片段', !!m)
  if (m) {
    const harness = [
      'const RED_TEAM = 1, BLUE_TEAM = 2',
      'const playerTeams = new Map()',
      'const playerNames = new Map()',
      'const REP_UNITS = new Map()',
      'const rebuilds = []',
      'function spawnRepUnit (pid, name, team) { rebuilds.push({ pid: pid, name: name, team: team }) }',
      m[0],
      'return { rememberTeam: rememberTeam, playerNames: playerNames, rebuilds: rebuilds }'
    ].join('\n')
    const api = new Function('spawner', 'logger', harness)({ dispatch () {} }, { info () {} })

    // 场景：观众从未进房（playerNames 空），只发弹幕表态，随后换阵营
    api.rememberTeam('douyin_1', 1, '张三')            // 首次表态（had 为空 ⇒ 不重建）
    check('B1 首次表态不触发重建', api.rebuilds.length === 0, 'n=' + api.rebuilds.length)
    check('B2 首次表态即记住昵称（跨轮重建要用）', api.playerNames.get('douyin_1') === '张三')

    api.rememberTeam('douyin_1', 2, '张三')            // 换阵营 ⇒ 重建，name 必须非空
    check('B3 换阵营重建时 name 非空（本次修复的核心）',
      api.rebuilds.length === 1 && api.rebuilds[0].name === '张三', JSON.stringify(api.rebuilds))
    check('B4 重建落在新阵营', api.rebuilds[0] && api.rebuilds[0].team === 2)

    // 换回来、且这条消息没带名字 ⇒ 回退到已记住的昵称，仍不丢
    api.rememberTeam('douyin_1', 1, null)
    check('B5 消息无名字时回退到已记住的昵称',
      api.rebuilds.length === 2 && api.rebuilds[1].name === '张三', JSON.stringify(api.rebuilds[1]))

    // 反例：同一个 pid 没换阵营时不该重建（避免多余删/建）
    api.rememberTeam('douyin_1', 1, '张三')
    check('B6 同阵营重复表态不重建', api.rebuilds.length === 2, 'n=' + api.rebuilds.length)
  }
}

for (const l of lines) console.log(l)
console.log('')
console.log(`${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
