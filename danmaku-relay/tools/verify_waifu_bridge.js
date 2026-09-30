'use strict'
/**
 * verify_waifu_bridge.js — 离线回归：waifu-agent 桥接（桌宠播报 / 对话）
 *
 * 被测改动：danmaku-relay/battle/{waifuBridge,waifuAnnouncer,waifuChat}.js
 *          + battle/index.js 的事件接线
 *
 * 手段：起一个**假 :9191**（ws_relay 的最小替身，只记录收到的帧），
 *       require 真模块，真的 emit round 事件，看假中继上收到了什么帧。
 *       不做源码正则匹配 —— 断言的是"这条线真的通了"。
 *
 * 零副作用：假 server 在 19991（不碰真 waifu :9191），
 *          RW_DEBUG_PORT=19998（不碰真游戏 :9999），日志隔离到临时文件（RW_LOG_FILE）。
 *
 * 跑法：node tools/verify_waifu_bridge.js   退出码 0 = 全过。
 */
const os = require('os')
const path = require('path')
const fs = require('fs')
const WebSocket = require('ws')

// —— 环境必须在 require 被测模块之前设好（模块在加载时读 env）——
process.env.RW_LOG_FILE = path.join(os.tmpdir(), 'waifu-verify-' + process.pid + '.log')
process.env.RW_WAIFU_WS_URL = 'ws://127.0.0.1:19991/status'
process.env.RW_WAIFU_ENABLED = '1'
process.env.RW_WAIFU_SPAWN_WINDOW_MS = '200'
process.env.RW_DEBUG_PORT = '19998'
// 隔离 LLM 配置：指向不存在的临时文件，避免读到真实 data/llm.json（F 段要测"无 key 降级"）
process.env.RW_LLM_CONFIG_FILE = path.join(os.tmpdir(), 'waifu-verify-cfg-none-' + process.pid + '.json')
delete process.env.RW_LLM_API_KEY
delete process.env.RW_LLM_API_URL
delete process.env.RW_LLM_MODEL
process.env.RW_WELCOME_WINDOW_MS = '200'    // 入场欢迎合并窗口，测试里缩短
process.env.RW_RULES_COOLDOWN_MS = '60000'  // 规则介绍节流拉长，便于测"冷却内不重复"
delete process.env.RW_WAIFU_KNOWLEDGE_FILE  // 用默认 battle/waifu-knowledge.md

let pass = 0
let fail = 0
const lines = []
function check (name, ok, detail) {
  if (ok) { pass++; lines.push('[PASS] ' + name + (detail ? '  -- ' + detail : '')) } else { fail++; lines.push('[FAIL] ' + name + (detail ? '  -- ' + detail : '')) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- 假 :9191（只记录帧）----------
const received = []
let wss = null
function startFakeRelay () {
  return new Promise((res, rej) => {
    wss = new WebSocket.Server({ port: 19991 })
    wss.on('connection', (ws) => {
      ws.send(JSON.stringify({ type: 'connected', port: 9191 }))   // ws_relay 的握手帧
      ws.on('message', (d) => {
        try { received.push(JSON.parse(d.toString())) } catch (e) { received.push({ parseError: String(e) }) }
      })
      ws.on('error', () => {})
    })
    wss.once('error', rej)
    wss.once('listening', res)
  })
}
function stopFakeRelay () { return new Promise((res) => { try { wss.close(() => res()) } catch (e) { res() } }) }
const ends = () => received.filter((m) => m.type === 'agent:end')

async function main () {
  await startFakeRelay()

  const bridge = require('../battle/waifuBridge')
  const ann = require('../battle/waifuAnnouncer')
  const chat = require('../battle/waifuChat')
  const sp = require('../battle/liveSpawner')

  // 未武装（从未 connect）⇒ speak 静默 no-op；这保证只 require battle/index 的离线回归脚本
  // 不会把 [WAIFU] 噪音写进真实日志、也不会误连真 waifu。属不变量，锁住它。
  check('A0 未 connect 前 speak = false（未武装 no-op）', bridge.speak('不应发出') === false)

  // ================= A. 话术模板（纯函数）=================
  {
    const s1 = ann.spawnText([{ teamName: '红方', unitName: '战车', count: 3 }])
    check('A1 spawnText 单条', s1 === '红方3个战车，已投入战场！', s1)
    const s2 = ann.spawnText([
      { teamName: '红方', unitName: '战车', count: 2 },
      { teamName: '红方', unitName: '猛犸', count: 1 },
      { teamName: '蓝方', unitName: '战车', count: 4 }
    ])
    check('A2 spawnText 两队聚合', s2 === '红方2个战车、猛犸，蓝方4个战车，已投入战场！', s2)
    check('A3 spawnText 空 → 空串', ann.spawnText([]) === '')
    check('A4 roundStartText 含轮次', ann.roundStartText(3).includes('第 3 轮开战'), ann.roundStartText(3))
    check('A5 roundEndText 红胜', ann.roundEndText({ winner: 'red', round: 7, durSec: 213 }) === '第7轮结束，红方获胜！用时213秒。', ann.roundEndText({ winner: 'red', round: 7, durSec: 213 }))
    check('A6 roundEndText 平局', ann.roundEndText({ winner: null, round: 8, durSec: 300 }).includes('打平'))
  }

  // ================= B. 兵种中文反查 =================
  check('B1 tank → 坦克', sp.unitDisplayName('tank') === '坦克', sp.unitDisplayName('tank'))
  check('B2 experimentalSpider → 蜘蛛', sp.unitDisplayName('experimentalSpider') === '蜘蛛', sp.unitDisplayName('experimentalSpider'))
  check('B3 未知类型原样返回', sp.unitDisplayName('zzz_unknown') === 'zzz_unknown')

  // ================= C. speak 走真 WS 的帧序列 =================
  bridge.connect()
  await sleep(300)
  check('C0 已连接假中继', bridge.connected === true, String(bridge.connected))
  received.length = 0
  bridge.speak('红方三辆战车已投入战场', { emotion: 'happy', motion: { group: 'Use', index: 1 }, tag: 'test' })
  await sleep(200)
  const seq = received.map((m) => m.type)
  check('C1 帧序列 = start/emotion/motion/end', JSON.stringify(seq) === JSON.stringify(['agent:start', 'agent:emotion', 'agent:motion', 'agent:end']), JSON.stringify(seq))
  const end = ends()[0]
  check('C2 agent:end.response = 文本', !!end && end.response === '红方三辆战车已投入战场', JSON.stringify(end))
  check('C3 agent:end.synthesize = true（要求 waifu 本地 TTS）', !!end && end.synthesize === true, JSON.stringify(end))
  const emo = received.find((m) => m.type === 'agent:emotion')
  check('C4 emotion 透传', !!emo && emo.emotion === 'happy', JSON.stringify(emo))
  const mo = received.find((m) => m.type === 'agent:motion')
  check('C5 motion 透传', !!mo && mo.motion === 'Use' && mo.index === 1, JSON.stringify(mo))
  received.length = 0
  check('C6 空文本 → false 且不发帧', bridge.speak('   ') === false && received.length === 0, JSON.stringify(received))

  // ================= D. 生兵合并窗口 =================
  received.length = 0
  ann.announceSpawn({ teamName: '红方', unitName: '战车', count: 1 })
  ann.announceSpawn({ teamName: '红方', unitName: '战车', count: 1 })
  ann.announceSpawn({ teamName: '蓝方', unitName: '铁甲', count: 1 })
  await sleep(400)   // > 200ms 窗口
  check('D1 三条召唤合并成 1 条 agent:end', ends().length === 1, String(ends().length))
  const dtxt = ends()[0] && ends()[0].response
  check('D2 合并文案含两队', !!dtxt && dtxt.includes('红方2个战车') && dtxt.includes('蓝方铁甲'), dtxt)

  // ================= E. 轮次事件接线（真 round 事件）=================
  const battle = require('../battle/index.js')
  received.length = 0
  battle.round.emit('fighting', { round: 5 })
  await sleep(200)
  check('E1 fighting → 1 条开战播报', ends().length === 1 && /第 5 轮开战/.test(ends()[0].response), JSON.stringify(ends().map((e) => e.response)))
  received.length = 0
  battle.round.emit('ended', {
    round: 5, reason: 'defeat:blue', duration: 77000,
    spawns: { red: 8, blue: 2 },
    outcome: { redDefeated: false, blueDefeated: true, winner: 'red' }
  })
  await sleep(200)
  check('E2 ended(红胜) → 1 条结束播报', ends().length === 1 && /红方获胜/.test(ends()[0].response), JSON.stringify(ends().map((e) => e.response)))

  // ================= F. 对话引擎（无 key 降级 + 纯函数）=================
  check('F1 无 key → isEnabled=false（静默降级）', chat.isConfigured() === false && chat.isEnabled() === false, 'configured=' + chat.isConfigured())
  check('F2 withinCooldown 纯函数', chat.withinCooldown(1000, 0) === true && chat.withinCooldown(100000, 0) === false)
  check('F3 sanitize 去换行+引号', chat.sanitize('"你好\n世界"') === '你好 世界', JSON.stringify(chat.sanitize('"你好\n世界"')))
  const r = await chat.reply({ text: '主播好', nickname: '路人' })
  check('F4 无 key → reply 返回 null（不抛错）', r === null, JSON.stringify(r))

  // F5–F8：配置文件提供 key（隔离到临时文件，绝不碰真实 data/llm.json）
  const cfgFile = path.join(os.tmpdir(), 'waifu-verify-cfg-' + process.pid + '.json')
  fs.writeFileSync(cfgFile, JSON.stringify({ apiKey: 'test-key', apiUrl: 'https://file.example/v1/chat/completions', model: 'file-model' }), 'utf8')
  process.env.RW_LLM_CONFIG_FILE = cfgFile
  check('F5 配置文件提供 key → isConfigured=true', chat.isConfigured() === true, 'configured=' + chat.isConfigured())
  const lc = chat.loadConfig()
  check('F6 配置文件 url/model 生效', lc.apiUrl === 'https://file.example/v1/chat/completions' && lc.model === 'file-model', JSON.stringify(lc))
  process.env.RW_LLM_API_URL = 'https://env.example/v1'
  check('F7 env 优先级 > 配置文件', chat.loadConfig().apiUrl === 'https://env.example/v1', chat.loadConfig().apiUrl)
  delete process.env.RW_LLM_API_URL
  fs.unlinkSync(cfgFile)
  process.env.RW_LLM_CONFIG_FILE = path.join(os.tmpdir(), 'waifu-verify-cfg-none-' + process.pid + '.json')
  check('F8 清掉配置后回到未配置', chat.isConfigured() === false)

  // ================= G. 总开关 =================
  delete require.cache[require.resolve('../battle/waifuBridge')]
  process.env.RW_WAIFU_ENABLED = '0'
  const bridgeOff = require('../battle/waifuBridge')
  check('G1 ENABLED=false', bridgeOff.ENABLED === false)
  received.length = 0
  check('G2 speak 返回 false', bridgeOff.speak('不该出现') === false)
  await sleep(120)
  check('G3 一帧都没发', received.length === 0, JSON.stringify(received))
  process.env.RW_WAIFU_ENABLED = '1'

  // ================= H. 入场欢迎 + 玩法知识 =================
  // 用户实测的旧行为（RED 证据，原文）：
  //   「欢迎 路口拐弯加入蓝方、路口拐弯加入蓝方！规则很简单：…」—— 同一句里名字+阵营重复，
  //   且第二条走了"保留原队"分支（平台 2s 内重发了两条进房消息），阵营报得也不对。
  received.length = 0
  ann.announceWelcome('小明', '红方')
  ann.announceWelcome('阿强', '蓝方')
  ann.announceWelcome('小明', '红方')   // 同一人重复上报 ⇒ 只念一次
  await sleep(400)   // > RW_WELCOME_WINDOW_MS(200)
  const wtext = ends().map((e) => e.response).join(' | ')
  check('H1 欢迎含两个名字', /小明/.test(wtext) && /阿强/.test(wtext), wtext)
  check('H1b 同名只念一次（平台重发不重复）', (wtext.match(/小明/g) || []).length === 1, wtext)
  check('H1c 不报阵营（进房归属未定，观众还没发表态弹幕）', !/加入红方|加入蓝方|加入战场/.test(wtext), wtext)
  check('H2 首次欢迎附规则介绍（含主页置顶视频提示）', /规则/.test(wtext) && /置顶视频/.test(wtext), wtext)

  received.length = 0
  ann.announceWelcome('小红', '红方')
  await sleep(400)
  const w2 = ends().map((e) => e.response).join(' | ')
  check('H3 规则冷却内不重复', /小红/.test(w2) && !/规则/.test(w2), w2)

  const kn = chat.loadKnowledge()
  check('H4 玩法知识已加载（含当前兵种/规则关键词）', typeof kn === 'string' && kn.length > 50 && /狂暴者/.test(kn) && /弹幕/.test(kn), 'len=' + (kn || '').length)
  const promptText = chat.buildSystemPrompt()
  check('H5 system prompt = 主播人格 + 玩法知识', /主播/.test(promptText) && /狂暴者/.test(promptText), 'len=' + (promptText || '').length)

  // ================= I. 入场欢迎：已归属的观众「再进房」也要欢迎 =================
  // 真实缺陷（2026-09-20 用户实测）：老观众再进房静默——因为 handleJoin 把欢迎播报
  // 放在"新归属"分支里，已有归属的 pid 会提前 return。
  received.length = 0
  battle.handleJoin({ type: 'join', team: 'red', playerId: 'jp1', playerName: '回头客' })
  await sleep(400)
  check('I1 首次进房有欢迎', /回头客/.test(ends().map((e) => e.response).join(' ')), ends().map((e) => e.response).join(' '))
  received.length = 0
  battle.handleJoin({ type: 'join', team: 'blue', playerId: 'jp1', playerName: '回头客' })
  await sleep(400)
  const wBack = ends().map((e) => e.response).join(' ')
  check('I2 已有归属者再进房同样欢迎（旧版此处静默）', /回头客/.test(wBack), wBack)

  // I3：适配器 _enter 每次进房都产出 join 事件（旧版 enterJoins 去重 ⇒ 同会话第二次进房无事件）
  const douyin = require('../danmaku/douyin')
  douyin.setAdapterConfigForTest({ AUTO_JOIN_ON_ENTER: true, ENTER_JOIN_CHANCE: 0, LIKE_COOLDOWN_MS: 1000 })
  const tr = new douyin.EventTranslator()
  const ev1 = tr.translate({ msgType: '进房', uid: 'u9', name: '甲', memberCount: 1 })
  const ev2 = tr.translate({ msgType: '进房', uid: 'u9', name: '甲', memberCount: 1 })
  check('I3 同一人两次进房都产出 join 事件',
    ev1.length === 1 && ev2.length === 1 && ev1[0].type === 'join' && ev2[0].type === 'join',
    JSON.stringify([ev1, ev2]))

  // ================= J. 礼物冠名播报（Wave 4.3）=================
  // 缺口证据（docs/游戏机制与运作流程.md §5）：「礼物召唤**无冠名/无播报**」——观众花了钱看不到名字。
  // 实测：handleGift（index.js:776）→ spawnBatch(:785) → leaderboard.recordSpawn(:787)，全程无 waifuAnnouncer。
  {
    const g1 = ann.giftText({ name: '张三', giftName: '小心心', teamName: '红方', unitName: '秃鹰', count: 10 })
    check('J1 giftText 含观众名 + 数量 + 兵种', /张三/.test(g1) && /10/.test(g1) && /秃鹰/.test(g1), g1)
    const g2 = ann.giftText({ teamName: '红方', unitName: '秃鹰', count: 1 })
    check('J2 giftText 缺名回退「观众」', /观众/.test(g2), g2)
    received.length = 0
    ann.announceGift({ name: '李四', giftName: '火箭', teamName: '蓝方', unitName: '泰坦', count: 10 })
    await sleep(200)
    check('J3 announceGift → 1 条 agent:end 且冠名', ends().length === 1 && /李四/.test(ends()[0].response), JSON.stringify(ends().map((e) => e.response)))
  }
  {
    const bi = fs.readFileSync(path.join(__dirname, '..', 'battle', 'index.js'), 'utf8')
    check('J4 handleGift 调 waifuAnnouncer.announceGift', /waifuAnnouncer\.announceGift\(/.test(bi), '')
  }

  // ---------- 收尾 ----------
  bridge.disconnect()
  ann.stop()
  await stopFakeRelay()

  for (const l of lines) console.log(l)
  console.log('')
  console.log(`${pass} PASS / ${fail} FAIL`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('CRASH: ' + ((e && e.stack) || e)); process.exit(2) })
