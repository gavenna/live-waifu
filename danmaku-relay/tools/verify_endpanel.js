#!/usr/bin/env node
/*
 * tools/verify_endpanel.js —— 「游戏结算面板回来了」的两条前置条件回归
 *
 * 背景（2026-09-19 用户要求把游戏自带的结算面板找回来）：面板要能出现，必须同时满足
 *   ① 地图上引擎胜负是打开的：map_info.winCondition = commandCenter
 *      （原来是 none —— 2026-09-18 有意关掉，因为它绑在没人操控的本地玩家身上）
 *   ② team 0（本地玩家）必须并进 RED 的同盟组，否则它"没有基地 ⇒ 我输了"，
 *      开局第 1 秒就弹 Defeat
 * 这两条任一失效，面板就会消失或开局秒判负 —— 所以把它们钉成回归。
 * 本脚本**不开游戏、不占 9999**：起假 Debug Socket :19999 收命令 + 只读真地图文件。
 */
process.env.RW_DEBUG_PORT = '19999'
const net = require('net')
const fs = require('fs')
const path = require('path')

const RELAY = 'D:\\Projects\\live-waifu\\danmaku-relay'
const PORT = 19999

const PASS = []
const FAIL = []
function check (name, cond, detail) {
  (cond ? PASS : FAIL).push(name)
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (detail !== undefined ? '  -- ' + JSON.stringify(detail) : ''))
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const seen = []
const sockets = []
let server = null

function startServer () {
  return new Promise((res, rej) => {
    server = net.createServer((s) => {
      sockets.push(s)
      s.on('data', (d) => {
        for (const raw of d.toString().split(/\r?\n/)) {   // TCP coalesces writes
          const cmd = raw.trim()
          if (!cmd) continue
          seen.push(cmd)
          if (cmd === 'ping') { s.write('pong\n'); continue }
          s.write('ok\n"ok"\n')
        }
      })
      s.on('error', () => {})
    })
    server.once('error', rej)
    server.listen(PORT, '127.0.0.1', () => res())
  })
}
function stopServer () {
  return new Promise((res) => {
    sockets.forEach((s) => { try { s.destroy() } catch (e) {} })
    server.close(() => res())
  })
}

/**
 * Read map_info's winCondition.  Scoped to the `<object name="map_info">` block on
 * purpose: dire_stream.tmx carries 5 OTHER `type` properties (trigger values "1.0".."
 * 1.4") ahead of map_info, so an unscoped read picks up a trigger (that defect bit the
 * python tool on 2026-09-19 -- see patch_endcond.py RE_MAPINFO).
 */
function winConditionOf (file) {
  const text = fs.readFileSync(file, 'utf8')
  const m = text.match(/<object\b[^>]*\bname="map_info".*?<\/object>/s)
  if (!m) return null
  const w = m[0].match(/<property\s+name="winCondition"\s+value="([^"]*)"/)
  return w ? w[1] : null
}

/**
 * Read each team's declared allyGroup from the map's `type="team_info"` objects
 * (f.java:354-357).  Without team 0 -> 1 the engine fires "Defeat / Game Time 00:00" on
 * the first 1000 ms evaluation, because team 0 owns nothing and is judged as its own side.
 */
function teamInfoOf (file) {
  const text = fs.readFileSync(file, 'utf8')
  const out = {}
  const re = /<object[^>]*type="team_info"[^>]*>([\s\S]*?)<\/object>/g
  let m
  while ((m = re.exec(text))) {
    const t = m[1].match(/name="team"\s+value="(\d+)"/)
    const g = m[1].match(/name="allyGroup"\s+value="(-?\d+)"/)
    if (t && g) out[t[1]] = parseInt(g[1], 10)
  }
  return out
}

async function main () {
  console.log('== A: the relay wires team 0 onto RED (required for a meaningful panel) ==')
  await startServer()
  const gc = require(RELAY + '\\battle\\gameController.js')
  const sp = require(RELAY + '\\battle\\liveSpawner.js')
  // Connect BEFORE arming, exactly like the live path does (gameController.startGame polls
  // spawner.connected).  Without this, sendScript's first attempt fails and it only retries
  // every SEND_RETRY_MS=2000ms -- the ally commands then fall outside a short wait window.
  sp.connect()
  await sleep(600)
  check('A0 spawner connected to the fake Debug Socket', sp.connected === true, sp.connected)
  gc.startAutoBattle()                     // applyHostility() fires ~5s later
  await sleep(9000)
  const ally = seen.filter((c) => c.includes('setTeamAllyGroup'))
  // 2026-09-20 同步：ALLY_GROUP 现已含观众宿主队（红 team3→1 / 蓝 team4→2，
  // 见 gameController.js:311 与地图 live_dire.tmx 的 team_3/4_info）⇒ 共 5 条。
  // 本断言此前写"exactly three"，是 viewer-team 变更前的旧契约。
  check('A1 five ally-group commands (0,1)(1,1)(2,2)(3,1)(4,2)',
    ally.length === 5 && ['(0, 1)', '(1, 1)', '(2, 2)', '(3, 1)', '(4, 2)'].every((s) => ally.some((c) => c.includes(s))),
    ally)
  check('A2 team 0 -> RED ally group (not its own faction, not spectator -3)',
    seen.some((c) => /setTeamAllyGroup\(0,\s*1\)/.test(c)) &&
    !seen.some((c) => /setTeamAllyGroup\([^,]+,\s*-3\)/.test(c)), ally)
  gc.stopAutoBattle()

  console.log('\n== B: the real maps have the engine win condition switched ON ==')
  const GAME = gc.GAME_DIR
  for (const name of ['dire_stream.tmx', 'live_battle.tmx']) {
    const dirs = [path.join(GAME, 'mods', 'maps'),
      path.join(GAME, 'assets', 'maps', 'skirmish'),
      path.join(GAME, 'assets', 'assets', 'maps', 'skirmish')]
    const files = dirs.map((d) => path.join(d, name))
    const missing = files.filter((f) => !fs.existsSync(f))
    if (missing.length) { check('B ' + name + ': all three copies exist', false, missing); continue }
    const wins = files.map(winConditionOf)
    check('B ' + name + ': winCondition=commandCenter in all three copies',
      wins.every((w) => w === 'commandCenter'), wins)
    const ti = teamInfoOf(files[0])
    check('B ' + name + ': team 0 is declared RED\'s ally in the map (allyGroup=1)',
      ti['0'] === 1, ti)
    check('B ' + name + ': red and blue stay hostile (allyGroup 1 vs 2)',
      ti['1'] === 1 && ti['2'] === 2, ti)
    const bytes = files.map((f) => fs.readFileSync(f).toString('binary'))
    check('B ' + name + ': the three copies are byte-identical',
      bytes[0] === bytes[1] && bytes[1] === bytes[2])
  }

  await stopServer()
  console.log('\nRESULT: %d PASS / %d FAIL', PASS.length, FAIL.length)
  if (FAIL.length) console.log('failed: ' + FAIL.join(', '))
  process.exit(FAIL.length ? 1 : 0)
}

main().catch((e) => { console.error('CRASH: ' + e.stack); process.exit(2) })
