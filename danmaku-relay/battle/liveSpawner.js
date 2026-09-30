/**
 * liveSpawner.js — Debug Socket 实时生兵
 * 解析弹幕 → 通过 Debug Socket 在游戏内生成单位
 */
const net = require('net')
// 红/蓝双方用哪个 team 槽位（单一真相来源，gameController 也用这一份）
const { RED_TEAM, BLUE_TEAM, RED_VIEWER_TEAM, BLUE_VIEWER_TEAM, viewerTeamOf } = require('./teams')
const battleConfig = require('./battleConfig')
const logger = require('../logger')

// ===== 配置 =====
// Debug Socket 端口：可由环境变量 RW_DEBUG_PORT 覆盖（默认仍 9999）。
// ⚠️ 这里就是**唯一真相来源** —— battle/gameController.js 通过 require 本模块取同一个
//    DEBUG_PORT（见那边顶部），两处必须永远一致；要改端口只改这一处。
//    离线回归脚本 tools/verify_game_loss_watchdog.js 在 require 本模块之前把
//    RW_DEBUG_PORT 指到空闲高位端口（19999），从而在不碰真实 9999 的前提下测试。
const DEBUG_PORT = (() => {
  const v = parseInt(process.env.RW_DEBUG_PORT, 10)
  return Number.isFinite(v) && v > 0 ? v : 9999
})()
const SPAWN_INTERVAL_MS = 500

// ===== 单位类型映射 =====
// 注意: 部分中文词会被抖音服务端静默拦截 (不进 WS 流), 必须提供过审替代词
// 已知被拦截: '坦克' -> 用 '战车'/'铁甲'/'tank' 替代
const UNIT_MAP = {
  // 坦克类 (中文词'坦克'被抖音拦截, 保留以防平台策略变化)
  '坦克': 'tank', 'tank': 'tank',
  '战车': 'tank', '铁甲': 'tank', '车': 'tank', '钢铁': 'tank',   // 过审替代词
  '重坦': 'heavyTank', 'heavytank': 'heavyTank', '重型坦克': 'heavyTank',
  '激光': 'laserTank', 'laser': 'laserTank', 'lasertank': 'laserTank',
  '火炮': 'artillery', 'artillery': 'artillery', '大炮': 'artillery',
  '巨型': 'mammothTank', 'mammoth': 'mammothTank', '猛犸': 'mammothTank',
  '超级': 'megaTank', 'mega': 'megaTank',
  '悬浮': 'hoverTank', 'hover': 'hoverTank',
  '重型悬浮': 'heavyHoverTank',
  // 🔴 2026-09-19 实机审计修正：这里原来写 '蜘蛛'->spiderBot、'甲虫'->bug、'航母'->carrier，
  //    三个类型**本安装里都不存在** ⇒ 观众发的蜘蛛/甲虫/航母全是**无声空操作**
  //    （引擎日志原文：`ui[warn]: Could not find type:spiderBot`）。
  //    正确类型取自引擎自己的中文表（Strings_zh_cn.properties）与 units/*.ini 的 name: 字段：
  //      实验型战斗蜘蛛 = experimentalSpider（单价 70000，见 experimental_spider.ini）
  //      模块化蜘蛛     = modularSpider     （单价 90000，modular_spider.ini）
  //      近战甲虫       = bugMelee          （单价 300，classic_bugs/bug_melee.ini）
  //      航空母舰       = experiementalCarrier（引擎自己的拼写就是 experiemental，单价 30000）
  //    审计脚本（可重跑）：_reports/unit_alias_audit.py → skill scripts/verify_unit_aliases.py
  '蜘蛛': 'experimentalSpider', 'spider': 'experimentalSpider',
  '甲虫': 'bugMelee', 'bug': 'bugMelee',
  '瓢虫': 'ladybug', 'ladybug': 'ladybug',
  '坦克杀手': 'tankDestroyer', '杀手': 'tankDestroyer',
  '气垫船': 'hovercraft',
  // 空中
  '直升机': 'helicopter', 'heli': 'helicopter', '飞机': 'helicopter', '飞': 'helicopter',
  '飞艇': 'airShip', 'airship': 'airShip', '拦截机': 'airShip',   // airShip 类型被 interceptor.ini 用 overrideAndReplace 接管，游戏里显示名是「拦截机」
  '战斗机': 'amphibiousJet', 'jet': 'amphibiousJet', '战机': 'amphibiousJet',
  '实验直升机': 'experimentalGunship',
  '运输机': 'dropship', 'dropship': 'dropship',
  '炮艇': 'gunShip', 'gunship': 'gunShip',
  // 海面
  '战列舰': 'battleShip', 'battleship': 'battleShip', '军舰': 'battleShip',
  '潜艇': 'attackSubmarine', 'sub': 'attackSubmarine',
  // ⚠️ 类型名 `experiementalCarrier` 里的 `experiemental` 是**引擎自己的拼写错误**，
  //    必须照抄（中文名 = 航空母舰，单价 30000，见 experimental_carrier/Experiemental_carrier.ini）。
  '航母': 'experiementalCarrier', 'carrier': 'experiementalCarrier',
  '导弹船': 'missileShip',
  // 防御
  '炮塔': 'turret', 'turret': 'turret',
  '高级炮塔': 'turretT2',
  '顶级炮塔': 'turretT3',
  '防空': 'antiAirTurret', 'aa': 'antiAirTurret',
  '激光防御': 'laserDefence',
  // 特殊
  '建造者': 'builder', 'builder': 'builder', '工人': 'builder',
  '核弹': 'nukeLaucher', 'nuke': 'nukeLaucher',
  '反核': 'antiNukeLaucher',
}

// ===== mod 单位（游戏「已启用 mod」新增，见 tools/gen_mod_units.js）=====
// 为什么单列：内容 mod（当前 EK_Definitive）带来数百个可召唤兵，其自带的 displayText_zh
//   可作弹幕词。只并入**召唤解析**（parseDanmaku 的精确匹配），**不进 looksLikeCommand**
//   —— 后者是防闲聊误报的收紧逻辑（见 HINT_UNIT_MIN_LEN），几百个兵名塞进去会把
//   「这机枪真猛」之类闲聊判成指令。同键先到先得，**不覆盖原版 UNIT_MAP**。
const MOD_UNIT_MAP = Object.create(null)    // 弹幕词(小写) -> 引擎类型名
const MOD_UNIT_NAME = Object.create(null)   // 引擎类型名 -> 展示名（播报用）
// 白名单：battle/mod-unit-pool.json 存在时，只放行其中列出的 mod 类型
// （由 tools/gen_mod_units.js 按「领域 + 价格档」自动挑三档；**删掉该文件即恢复全部可召唤**）。
let MOD_POOL = null
try {
  const p = require('./mod-unit-pool.json')
  MOD_POOL = new Set(Object.values(p.tiers || {}).flat())
} catch (e) { /* 无白名单文件：全部可召唤 */ }
try {
  const mod = require('./mod-units.json')
  for (const u of (mod.units || [])) {
    if (!u || !u.type) continue
    if (MOD_POOL && !MOD_POOL.has(u.type)) continue
    if (MOD_UNIT_NAME[u.type] == null) MOD_UNIT_NAME[u.type] = u.zh || u.en || u.type
    for (const alias of [u.zh, u.en, u.type]) {
      if (!alias) continue
      const k = String(alias).toLowerCase()
      if (MOD_UNIT_MAP[k] == null) MOD_UNIT_MAP[k] = u.type
    }
  }
} catch (e) { /* 无 mod-units.json：静默跳过，原版召唤不受影响 */ }

// ===== 召唤白名单（主播指定的四分类范围）=====
// battle/summon-whitelist.json 存在时，**只**放行其中列出的单位（原版 + mod 一视同仁），
// 其余一律不可召唤；`giftOnly` 的（如执行者/清图兵）只走礼物、不进弹幕。
// 删掉该文件即回到旧行为（UNIT_MAP 原版 + mod-unit-pool 白名单）。
const WL_MAP = Object.create(null)     // 弹幕词(小写) -> 引擎类型（不含 giftOnly）
const WL_SUMMON_TYPES = new Set()      // 可经弹幕召唤的引擎类型（不含 giftOnly）
const WL_NAME = Object.create(null)    // 引擎类型 -> 展示名
const WL_CATS = { land: [], sea: [], air: [], building: [] }  // 原始条目（供推手池/校验）
let WL_PUSHER = null
let WL_SUMMON = null   // summon 段：basicUnit / cooldownMs / tierCaps
let WL_ON = false
try {
  const wl = require('./summon-whitelist.json')
  for (const cat of ['land', 'sea', 'air', 'building']) {
    for (const e of ((wl.categories || {})[cat] || [])) {
      if (!e || !e.type) continue
      WL_CATS[cat].push(e)
      if (WL_NAME[e.type] == null) WL_NAME[e.type] = e.zh || e.word || e.en || e.type
      if (e.giftOnly) continue   // 只走礼物：不进弹幕词表/可召唤集
      WL_SUMMON_TYPES.add(e.type)
      for (const w of [e.word, e.zh, ...(e.aliases || []), e.type]) {
        if (!w) continue
        const k = String(w).toLowerCase()
        if (WL_MAP[k] == null) WL_MAP[k] = e.type
      }
    }
  }
  WL_PUSHER = wl.pusher || null
  WL_SUMMON = wl.summon || null
  WL_ON = WL_SUMMON_TYPES.size > 0 && String(process.env.RW_SUMMON_WHITELIST || '1') !== '0'
} catch (e) { WL_ON = false }

// ★ 2026-10：**建筑类就地建造** —— 白名单 `building` 类别的单位不下巡逻令。
//   为什么：塔没有脚。av.j 巡逻令是"往目标点行军"，对静态建筑无意义；
//   即便 mod 数据把某些碉堡标成 LAND / OVER_CLIFF（实测 EkInfBunker / EkLargeArtillary 就是这样），
//   也一律按"就地部署"处理 —— 与观众对"塔防"的预期一致，且不下令绝不会出错。
//   其余类别照旧：落地后向敌方基地推进（见 spawnBatch）。
const WL_STATIC_TYPES = new Set((WL_CATS.building || []).map((e) => e.type))

/** 白名单模式下的兵种解析：只认白名单里的词/类型（精确）。找不到 → undefined。 */
function resolveWhitelist (input) {
  const s = String(input == null ? '' : input).toLowerCase()
  if (!s) return undefined
  if (WL_MAP[s]) return WL_MAP[s]
  if (WL_SUMMON_TYPES.has(s)) return s
  for (const [k, v] of Object.entries(WL_MAP)) {
    if (k === s || v.toLowerCase() === s) return v
  }
  return undefined
}

// ===== 弹幕容错：中文数字 =====
// 观众把数量写成中文（`红三猛犸` / `红十五战车`）时，先归一成阿拉伯数字再走原来的正则。
// CN_DIGITS 只收**单字**数字；「十」不入表 —— 它在中文里是位权不是数字字，
// 由 normalizeChineseNumbers 按 十 / 十Y / X十 / X十Y 四种形态展开。
const CN_DIGITS = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const CN_TEN_RE = /([一二两三四五六七八九])?十([一二两三四五六七八九])?/g

// ===== 弹幕容错：易错兵种词 =====
// ★ 只放**有真实弹幕证据**的项。2026-09-22 真机日志：观众发「红山站车」，桌宠还补了一句
//   「应该是战车不是站车哦」；同一天「红三猛犸」也因量词写法被静默丢弃。
//   ⚠️ 新增项必须先有日志证据，**不要凭猜扩充** —— 这是全局替换，表越长越容易把正常词改坏。
const UNIT_TYPO = { 站车: '战车' }

/** 按 UNIT_TYPO 做全局替换（纯函数，无副作用）。 */
function normalizeTypo (text) {
  let s = String(text == null ? '' : text)
  for (const [bad, good] of Object.entries(UNIT_TYPO)) s = s.split(bad).join(good)
  return s
}

// ===== 状态 =====
let socket = null
let connected = false
const commandQueue = []
const lastSpawnTime = {}

// ===== Debug Socket 回包缓冲（只读，供开局探测用）=====
// 背景：本文件原先只认 'pong'、其余回包全部丢弃。gameController 需要读
// `debug.getPlayerName(t)` 的返回值来实机确认 slot 1/3 是不是 AI，
// 于是留一个**只增不改**的小环形缓冲。它不改变任何发送行为。
const MAX_REPLIES = 100
const replies = []

function captureReply (text) {
  for (const line of String(text).split(/\r?\n/)) {
    const s = line.trim()
    if (!s) continue
    replies.push(s)
    if (replies.length > MAX_REPLIES) replies.shift()
  }
}

/** 取走并清空回包缓冲（逐条发命令前调用，避免读到上一条命令的旧回包）*/
function drainReplies () {
  return replies.splice(0, replies.length)
}

// ===== 连接管理 =====
// 🔴 2026-09-18 实机查出并修掉的真缺陷：旧实现每次调用 connect() 都先 `socket.destroy()`
//    掉当前连接，而被 destroy 的旧 socket 的 'close' 回调又会 `setTimeout(connect, 3000)`
//    ⇒ 每调一次就多埋一个"3 秒后拆掉当时那条连接"的定时器。调用方
//    `gameController.startGame()` 的就绪等待是**每 5s 调一次 connect()**，于是形成
//    **自增式拆除风暴**：`connected` 几乎永远抓不到 true（实测 180s 就绪等待整段超时、
//    每条 exec 都 `sent=false`，命令只能靠队列在缝隙里送达）。这就是历史上
//    "点第一次『开始新一轮』失败、要点第二次"的第二个真根因（第一个是另开连接抢 socket）。
//    修法：connect() 语义改为**幂等 ensureConnected**（已有活连接/正在连接就直接返回），
//    并给每个 socket 的 close/error 回调加"本代次"守卫，旧代次不得改写状态、不得再排重连。
const CONNECT_GRACE_MS = 10000   // 卡在 connecting 超过这个时长才允许强制重建（保险阀）
let connecting = false
let connectingSince = 0

function connect () {
  if (socket) {
    const stuck = connecting && Date.now() - connectingSince > CONNECT_GRACE_MS
    if (!stuck && (connected || connecting || socket.connecting)) return
    try { socket.destroy() } catch (e) {}
  }
  const self = new net.Socket()
  socket = self
  connecting = true
  connectingSince = Date.now()
  self.setEncoding('utf-8')
  self.setTimeout(60000)

  self.connect(DEBUG_PORT, '127.0.0.1', () => {
    if (socket !== self) return          // 已被新连接取代
    connecting = false
    connected = true
    self.write('ping\n')
    flushQueue()
  })

  self.on('data', (data) => {
    const text = data.toString()
    if (text.trim() === 'pong') {
      // connection verified
      return
    }
    // 非 pong 回包。以前这里直接丢弃；现在留存最近若干行，
    // 供 gameController 的 [BATTLE][probe] 运行时探测读取（见 drainReplies）。
    // 纯只读：不改变任何发送行为。
    captureReply(text)
  })

  self.on('close', () => {
    if (socket !== self) return          // 旧代次：不改写状态、不再排重连
    connected = false
    connecting = false
    setTimeout(connect, 3000)
  })

  self.on('error', () => {
    if (socket !== self) return
    connected = false
    connecting = false
  })
}

function sendCommand (cmd) {
  if (connected && socket && !socket.destroyed) {
    socket.write(cmd + '\n')
    return true
  }
  commandQueue.push(cmd)
  return false
}

function flushQueue () {
  while (commandQueue.length > 0 && connected) {
    socket.write(commandQueue.shift() + '\n')
  }
}

// ===== 弹幕解析 =====
/**
 * 中文数字串 → 阿拉伯数字（纯函数）。四种形态：
 *   十 → 10   十Y → 1Y（十三 → 13）   X十 → X0（二十 → 20）   X十Y → XY（十五 → 15）
 * 其余单字数字（一/二/两/三/…/九）原样逐个替换。其它字符一律保留。
 * 例：`红三猛犸` → `红3猛犸`；`红十五战车` → `红15战车`。
 */
function normalizeChineseNumbers (text) {
  let s = String(text == null ? '' : text).replace(CN_TEN_RE, (_m, x, y) => {
    if (!x && !y) return '10'                 // 十
    if (!x) return String(10 + CN_DIGITS[y])  // 十Y
    if (!y) return String(CN_DIGITS[x] * 10)  // X十
    return String(CN_DIGITS[x] * 10 + CN_DIGITS[y]) // X十Y
  })
  s = s.replace(/[一二两三四五六七八九]/g, (c) => String(CN_DIGITS[c]))
  return s
}

/**
 * 弹幕容错归一化（纯函数）：把观众的各种写法折成 parseDanmaku 能认的形式。
 * parseDanmaku 的返回结构**不因它改变** —— 它只影响送进正则的那串文本。
 */
function normalizeDanmaku (text) {
  return normalizeTypo(normalizeChineseNumbers(text))
}

/**
 * 最长包含匹配：在 UNIT_MAP 的所有键里，取**被 input 包含且长度最长**的那个键的值。
 * 为什么必须「最长」：UNIT_MAP 里 '车' / '战车' / '坦克' / '坦克杀手' 同时存在，
 * 若取「第一个命中的键」，`坦克杀手连` 会被排在前面的 '坦克' 抢走 ⇒ 出错误兵种。
 * 精确命中仍由 parseDanmaku 的「精确 → 键/值精确」两步先吃掉，这里只是**兜底**。
 * @param {string} input 观众写的兵种片段（parseDanmaku 已 trim + 小写）
 * @returns {string|undefined} 引擎类型名；无命中返回 undefined
 */
function matchUnitByContains (input) {
  const s = String(input == null ? '' : input).toLowerCase()
  if (!s) return undefined
  let bestKey = ''
  let bestVal
  for (const [key, val] of Object.entries(UNIT_MAP)) {
    const k = key.toLowerCase()
    if (k && s.includes(k) && k.length > bestKey.length) { bestKey = k; bestVal = val }
  }
  return bestVal
}

const COMMAND_TEAM_RE = /(红|蓝|red|blue)/i
// 提示判定的兵种词最小长度：UNIT_MAP 里有单字键（`车`/`飞`），认它们会让「主播开车了」这类闲聊
// 被判成「像指令」而多出一行提示。提示宁可漏、不要误报 —— 故只认 ≥2 字。
// ⚠️ 只作用于 looksLikeCommand；parseDanmaku 的包含兜底仍保留单字键（解析容错需要它）。
const HINT_UNIT_MIN_LEN = 2

/**
 * 这条弹幕**看起来像指令**吗？（供「失败可见化」判定：只有像指令却没解析出来的才提示格式）
 * 判据（任一成立即 true）：
 *   ① 含阵营词 红 / 蓝 / red / blue；
 *   ② 含 UNIT_MAP 里长度 ≥ HINT_UNIT_MIN_LEN 的任一键（⇒ `4蜘蛛` 算；单字键 `车`/`飞` 不算）。
 * 先过一遍 normalizeDanmaku：错别字（`站车`）/中文数量（`四`）写法的指令同样该被提示。
 * `咋玩` / `没听懂` / `？？？` 这类闲聊必须为 false —— 否则会把正常聊天也当成"你发错了"。
 * 收紧（2026-09-22 负责人确认）：原先复用 matchUnitByContains（认单字键），「主播开车了」会被判 true；
 *   现改为只认 ≥ HINT_UNIT_MIN_LEN 字的键，闲聊误报消失。
 * @param {string} raw 弹幕原文
 * @returns {boolean}
 */
function looksLikeCommand (raw) {
  const s = normalizeDanmaku(String(raw == null ? '' : raw)).trim()
  if (!s) return false
  if (COMMAND_TEAM_RE.test(s)) return true
  for (const key of Object.keys(UNIT_MAP)) {
    const k = key.toLowerCase()
    if (k.length >= HINT_UNIT_MIN_LEN && s.includes(k)) return true
  }
  return false
}

/** 白名单模式下的**基础兵**：光发「红」「蓝」（不带兵种）时出这个 —— 零门槛入口。 */
function basicUnit () {
  return (WL_SUMMON && WL_SUMMON.basicUnit) || undefined
}

/** 按**单价分档**的单条召唤数量上限（summon.tierCaps）；未配置回退 MAX_UNITS_PER_DANMAKU。 */
function tierCapOf (unitType) {
  const tiers = (WL_SUMMON && WL_SUMMON.tierCaps) || null
  if (!tiers) return MAX_UNITS_PER_DANMAKU
  let price = null
  try { price = economy.priceOf(unitType) } catch (e) { price = null }
  for (const t of tiers) {
    if (t.maxPrice == null || (Number.isFinite(price) && price <= t.maxPrice)) return t.cap
  }
  return MAX_UNITS_PER_DANMAKU
}

/** 同一观众的召唤冷却（summon.cooldownMs，默认 3000）；未配置回退 SPAWN_INTERVAL_MS。 */
function spawnCooldownMs () {
  const v = WL_SUMMON && Number(WL_SUMMON.cooldownMs)
  return Number.isFinite(v) && v >= 0 ? v : SPAWN_INTERVAL_MS
}

// ===== 阵营级观众兵配额（防一边倒）=====
// 分账后观众兵不占 AI 经济，一方观众多可能兵海 ⇒ 每队每轮设总量上限。
// 优先级：RW_TEAM_CAP_PER_ROUND（env，动态读，便于测试/热调）> summon-whitelist.json 的 summon.teamCapPerRound > 0(无上限)。
// 计数按**轮**清零（见 resetTeamSpawnCount，由 round.on('fighting') 调用）。
let _teamSpawnCount = { [RED_TEAM]: 0, [BLUE_TEAM]: 0 }
function resetTeamSpawnCount () { _teamSpawnCount = { [RED_TEAM]: 0, [BLUE_TEAM]: 0 }; return true }
function teamCapPerRound () {
  const env = parseInt(process.env.RW_TEAM_CAP_PER_ROUND, 10)
  if (Number.isFinite(env) && env > 0) return env
  const v = WL_SUMMON && Number(WL_SUMMON.teamCapPerRound)
  return Number.isFinite(v) && v > 0 ? v : 0
}

function parseDanmaku (content) {
  if (!content || typeof content !== 'string') return null
  // 归一化后再匹配：`红三猛犸` → `红3猛犸`（观众写中文数量/错别字也能识别，见 normalizeDanmaku）
  const text = normalizeDanmaku(content.trim())

  // ★ 2026-09-27 零门槛入口：光发「红」/「蓝」（可带「方」，或 red/blue）→ 出 1 个**基础兵**。
  //   为什么：历史上观众指令长期为 0，门槛（得知道「狂暴者」这种词）是主因。发一个字就能参战。
  const bare = text.match(/^(红|蓝|red|blue)(?:方)?$/i)
  if (bare && WL_ON) {
    const bt = (bare[1].toLowerCase() === '红' || bare[1].toLowerCase() === 'red') ? RED_TEAM : BLUE_TEAM
    const bu = basicUnit()
    if (bu) {
      return { team: bt, viewerTeam: bt === RED_TEAM ? RED_VIEWER_TEAM : BLUE_VIEWER_TEAM,
        unitType: bu, teamName: bt === RED_TEAM ? '红方' : '蓝方', count: 1, basic: true }
    }
  }

  // 队伍前缀 (红/蓝/red/blue, 可带"方"), 后接可选空格, 再跟兵种名
  // 兼容: "红坦克" / "红 坦克" / "红方坦克" / "红 tank" / "红tank"
  // 🔴 2026-09-19 修复缺陷：原正则 `(?:方)?(\d*)` 要求数量**紧跟前缀**，观众写
  //    "红 10 战车"（数字前带空格）时：(\d*) 抓到空串、"10 战车" 整串被当兵种名
  //    ⇒ 返回 null ⇒ handleDanmaku 静默丢弃（result=null 时无任何日志）
  //    ⇒ 现象=「弹幕收到了但游戏没反应」。数量前不限空格后：
  //    "红 10 战车" / "红10战车" / "红 坦克" 都能解析。
  const match = text.match(/^(红|蓝|red|blue)(?:方)?\s*(\d*)\s*(.+)$/i)
  if (!match) return null

  // 红 → RED_TEAM(1)，蓝 → BLUE_TEAM(2)：两个都是引擎开局创建的 AI 玩家槽位。
  // ⚠️ 2026-09-18：这段注释以前写的是 BLUE_TEAM(3)，没跟上 teams.js 的改动。
  // 不再用 team 0：它是没人操控的本地人类槽位，**队 0 没有 AI，造出来的兵只会原地不动**。
  // （对比：AI 队 1/2 的空投单位会被该队 AI 指挥着推进 —— 2026-09-18 实测，见 skill live-waifu-ops）
  const team = (match[1].toLowerCase() === '红' || match[1].toLowerCase() === 'red') ? RED_TEAM : BLUE_TEAM
  const unitInput = match[3].trim().toLowerCase()
  if (!unitInput) return null

  // ★ 2026-09-27：白名单模式（battle/summon-whitelist.json 存在）下**只**认白名单里的单位——
  //   其余（含旧原版别名 / mod 池）一律不可召唤。未启用白名单时回到原逻辑。
  let unitType
  if (WL_ON) {
    unitType = resolveWhitelist(unitInput)
  } else {
    unitType = UNIT_MAP[unitInput] || MOD_UNIT_MAP[unitInput]
    if (!unitType) {
      for (const [key, val] of Object.entries(UNIT_MAP)) {
        if (key.toLowerCase() === unitInput || val.toLowerCase() === unitInput) {
          unitType = val
          break
        }
      }
    }
    // mod 单位：只做**精确**匹配（不做包含兜底）——上百个 mod 兵名参与「被输入包含」
    // 匹配会显著抬高误判概率，精确匹配已够观众按名召唤。
    if (!unitType) {
      for (const [key, val] of Object.entries(MOD_UNIT_MAP)) {
        if (key === unitInput || val.toLowerCase() === unitInput) { unitType = val; break }
      }
    }
    // ★ 2026-09-22 容错兜底：观众写的兵种名带残渣（`红坦克杀手连` / `红山战车呀`）时，
    //   用「被输入包含且最长」的键兜住。**顺序不能动** —— 精确项必须先命中，
    //   否则 `坦克杀手`（精确）会被包含匹配的 `坦克` 抢走。见 matchUnitByContains。
    if (!unitType) unitType = matchUnitByContains(unitInput)
  }
  if (!unitType) return null
  // 数量：观众可写 "红3战车" = 3 辆。
  // 🔴 2026-09-18 修真缺陷：正则一直抓了 match[2]（数量）却从没被用过 —— "红5战车" 只出 1 辆。
  //    实机对得上：每边发 8 条带数量的弹幕，spawns 计数正好是 8（= 消息条数），数量被静默吞掉。
  const rawCount = parseInt(match[2] || '1', 10)
  // ★ 2026-09-27 按**单价分档**夹数量：一刀切 10 对 160k 的狂暴者是灾难、对 18k 的秃鹰又太少。
  //   分档表见 summon-whitelist.json 的 summon.tierCaps（≤2万→10 / 2万-8万→5 / >8万→2）。
  const cap = tierCapOf(unitType)
  const count = Math.min(Math.max(Number.isFinite(rawCount) ? rawCount : 1, 1), MAX_UNITS_PER_DANMAKU, cap)
  // viewerTeam = 兵实际落到的**无 AI 宿主队**（红→3 / 蓝→4）；team 仍是阵营主队（经济/同盟用）。
  const viewerTeam = team === RED_TEAM ? RED_VIEWER_TEAM : BLUE_VIEWER_TEAM
  return { team, viewerTeam, unitType, teamName: team === RED_TEAM ? '红方' : '蓝方', count }
}

// ===== 生成位置 =====
// ★★★ 2026-09-27：坐标改为**从地图契约读取**（battle/map-config.json，由 tools/gen_map_contract.js 生成）。
//   换图 = 换地图文件 + 重跑 gen_map_contract，代码不动；缺 map-config.json 时回退写死值（旧图仍可切回）。
//   兵统一下在**本队指挥中心**旁（弹幕召唤 / 礼物召唤 / 收局推手补兵同源）。
//   旧写死值 (455,355)/(1775,1695) 属旧图 new_dire；新图 live_map_001 的 CC 在 map-config.json。
const mapConfig = require('./mapConfig')
const _CC_FALLBACK = {
  [RED_TEAM]: { x: 455, y: 355 },
  [BLUE_TEAM]: { x: 1775, y: 1695 }
}
const COMMAND_CENTER = {
  [RED_TEAM]: (mapConfig && mapConfig.commandCenters.red) || _CC_FALLBACK[RED_TEAM],
  [BLUE_TEAM]: (mapConfig && mapConfig.commandCenters.blue) || _CC_FALLBACK[BLUE_TEAM]
}
// 落点方框半径（像素）：兵在指挥中心周围 ±CC_SPAWN_PAD 内随机出现（0 = 精确落 CC 中心）。
const CC_SPAWN_PAD = (mapConfig && Number.isFinite(mapConfig.spawnPad)) ? mapConfig.spawnPad : 45
const SPAWN_AREAS = {
  [RED_TEAM]: { xMin: COMMAND_CENTER[RED_TEAM].x - CC_SPAWN_PAD, xMax: COMMAND_CENTER[RED_TEAM].x + CC_SPAWN_PAD,
                yMin: COMMAND_CENTER[RED_TEAM].y - CC_SPAWN_PAD, yMax: COMMAND_CENTER[RED_TEAM].y + CC_SPAWN_PAD },
  [BLUE_TEAM]: { xMin: COMMAND_CENTER[BLUE_TEAM].x - CC_SPAWN_PAD, xMax: COMMAND_CENTER[BLUE_TEAM].x + CC_SPAWN_PAD,
                 yMin: COMMAND_CENTER[BLUE_TEAM].y - CC_SPAWN_PAD, yMax: COMMAND_CENTER[BLUE_TEAM].y + CC_SPAWN_PAD }
}

// （原「前压空投区」FRONT_AREAS 与 FRONT_ZONE_MIN 已于 2026-09-22 移除：召唤兵统一下在指挥中心旁，
//   不再按数量分基地/前线两区。切换前的实现见 git 历史 / liveSpawner.js.bak-*。）
// 单条弹幕最多出多少兵（防"红999战车"刷屏拖垮游戏与推流）
const MAX_UNITS_PER_DANMAKU = 10

// ★★★ 2026-09-19：让**召唤出来的兵**立刻拿到"巡逻"指令（av.j），目标 = 敌方基地。
//
// 为什么需要（两条实测根因，见 skill live-waifu-ops/references/engine-unit-commands.md）：
//   ① `debug.createUnit` 只做三件事——写归属、加进世界、置标志；**不写命令队列**。
//      而 RW 的单位**只在自己射程内自动开火，不会主动搜寻敌人** ⇒ 落点上的兵只会站着。
//   ② 本队 AI 随后会接管这些空投单位（实测 2200×2200 图上约 95s 才离开家门口），
//      表现为"战斗 → 被叫回家"⇒ 观众看不到自己那一波的即时推进。
//
// 做法：用注入新增的 `Debug.spawnPatrol(type,x,y,team,px,py)`，**一次调用完成
//   「造兵 + 只对这一个兵下 av.j 巡逻令」**。选它而不是 patrolUnit(id,...) 的原因：
//   中继拿单位 id 要靠 `function debug.createUnit(...)` 的回包，而该回包会被中继自身轮询抢走
//   （实测连续 6 次全空）。spawnPatrol 在 Java 内部取 id，不依赖回包。
//
// 巡逻路线怎么定（av.j 的语义 = 命令类型 `av.j`，与 move(av.a) 共用 y.java:2253 的执行入口）：
//   目标取**敌方基地**（下表的坐标来自 HANDOVER §7#2 的实机实测值）⇒ 兵主动往对方基地推进。
// ★ 2026-09-27：目标改为从 map-config 的 patrolTargets 读（= 对面阵营的 CC，自动推导，消除旧图错位）；
//   缺 map-config 时回退旧写死值（live_dire 基地）。
// 回退：`RW_PATROL_ENABLED=0` ⇒ 退回纯 createUnit，行为与加这个功能之前**完全一致**。
const PATROL_ENABLED = String(process.env.RW_PATROL_ENABLED || '1') === '1'
const _PATROL_FALLBACK = {
  [RED_TEAM]: { x: 1716, y: 1652 },   // 红方 → 蓝方基地
  [BLUE_TEAM]: { x: 560, y: 380 }     // 蓝方 → 红方基地
}
const PATROL_TARGETS = {
  [RED_TEAM]: (mapConfig && mapConfig.patrolTargets && mapConfig.patrolTargets.red) || _PATROL_FALLBACK[RED_TEAM],
  [BLUE_TEAM]: (mapConfig && mapConfig.patrolTargets && mapConfig.patrolTargets.blue) || _PATROL_FALLBACK[BLUE_TEAM]
}
const economy = require('./economy')

/**
 * 分账模式：'viewer'（默认，观众钱包落 viewer 宿主队 team3/4）/ 'shared'（旧行为，落 AI 主队 1/2）。
 * 读 battleConfig（面板可配），异常一律回退 viewer —— 绝不因配置读取失败中断生兵。
 */
function walletModeOf () {
  try { return battleConfig.walletMode() } catch (e) { return 'viewer' }
}

// 可替换的发送器：生产恒为真实 `sendCommand`（把命令写进 Debug Socket 队列）；
// 离线回归（tools/verify_economy.js）把它换成内存 mock，便于断言"发了什么命令"。
let _send = null
function setSendCommandForTest (fn) { _send = (typeof fn === 'function') ? fn : null }
function dispatch (cmd) { return _send ? _send(cmd) : sendCommand(cmd) }

// 注：2026-09-19 曾在此实现 `patrolTeam` 周期重发（硬抢命令，对抗本队 AI 覆盖 av.j）。
// 已被"把观众兵落到无 AI 宿主队（team3/team4）"取代——后者从根上不让 AI 碰这些兵，无需再抢。
// 见 battle/teams.js 的 RED_VIEWER_TEAM/BLUE_VIEWER_TEAM 与地图 live_dire.tmx 的 team_3/4_info。

// ★★★ 2026-09-19：收局推手 v2 —— **对称补兵**（两边等量，保证"热闹但不平推"）。
//
// 为什么改掉 v1（`patrolTeam` 推 AI 主队）：实机验证 v1 **无效** —— 23:59 那局推手每 30s 都发了
//   （`[PATROL] TEAM OK team=1 units=38`），却打满 300 秒仍无胜负。根因同"召唤兵被叫回家"：
//   `patrolTeam` 推的是 team1/2（**有 AI 的主队**），该队 AI 会把巡逻令覆盖掉 ⇒ 推了等于白推。
//
// v2 走已验证有效的通道：按周期往两队的**无 AI 宿主队**（team3/4）各补同样多的兵（spawnPatrol），
//   兵不会被本队 AI 接管 ⇒ 只认脚本命令。
// ★ 2026-09-22 调整：落点统一为**本队指挥中心旁**（SPAWN_AREAS = CC 坐标；原前压区 FRONT_AREAS 已移除）。
//   前压出生点是"怕补的兵被 AI 抢回"时代的权宜；该问题已由 disabledAI 宿主队根治，
//   故让补兵从基地出发、靠巡逻令（目标=敌方基地）行军推进 —— 出生点不再决定在哪交火。
//
// 「不破坏平衡」的三道保证：
//   ① **永远两边等量**（每 tick 各补 PUSH_UNITS，不存在只补一边）；
//   ② **每边累计封顶** MAX_PER_SIDE（防一方靠滚雪球平推）；
//   ③ 兵种用中量级（默认 tank，不用猛犸/超级这种能一波推平的）。
// 全部可配：`RW_PUSH_INTERVAL_MS`(默认 20000) / `RW_PUSH_UNITS`(默认 2) / `RW_PUSH_TYPE`(默认 tank) /
//   `RW_PUSH_MAX_PER_SIDE`(默认 40)；`RW_PUSH_INTERVAL_MS=0` 整体关闭。
// 挡位预设：把 (interval / units / cap) 三个旋钮打成一档。`RW_PUSH_LEVEL` 选档（默认 2）：
//   4 = 最高档（往两边狂补，看"热闹"）/ 3 高 / 2 中（默认）/ 1 最轻。
//   单项 `RW_PUSH_INTERVAL_MS` / `RW_PUSH_UNITS` / `RW_PUSH_MAX_PER_SIDE` 仍可**覆盖**挡位里的对应项。
const PUSH_LEVELS = {
  1: { interval: 30000, units: 1, cap: 20 },
  2: { interval: 20000, units: 2, cap: 40 },
  3: { interval: 15000, units: 3, cap: 60 },
  4: { interval: 10000, units: 4, cap: 100 }
}
const PUSH_LEVEL = (() => {
  const v = parseInt(process.env.RW_PUSH_LEVEL, 10)
  return PUSH_LEVELS[v] ? v : 2
})()
const _PL = PUSH_LEVELS[PUSH_LEVEL]
const _num = (key, def, min) => {
  const v = parseInt(process.env[key], 10)
  return Number.isFinite(v) && v >= min ? v : def
}
// ★ 2026-09-27 推手 v3（按主播新规则）：30s 一次，两边**各自**从 land+air 里随机挑几个兵种；
//   每轮**两边合计** PUSH_TOTAL_PER_CYCLE 个兵（各一半），兵的类型从挑中的兵种里随机选。
//   `air` 的执行者（Ek星舰，清图兵）**排除** —— 只作礼物触发。
//   配置取自 summon-whitelist.json 的 pusher 段；env 仍可覆盖。
const PUSH_POOL = (() => {
  const cats = (WL_PUSHER && WL_PUSHER.pool) || ['land', 'air']
  const excl = new Set((WL_PUSHER && WL_PUSHER.exclude) || [])
  const out = []
  for (const c of cats) for (const e of (WL_CATS[c] || [])) if (!excl.has(e.type)) out.push(e.type)
  return out
})()
const PUSH_INTERVAL_MS = _num('RW_PUSH_INTERVAL_MS', (WL_PUSHER && WL_PUSHER.intervalMs) || _PL.interval, 0)
// ★ 2026-09-27：推手改「**低强度、持续**」——直接配**每边**兵数（默认 3/边/30s），不再用"两边合计 20"。
//   旧参数（20/边 30s、上限 80/边）结果是 **4 分钟就打满上限、中后期全线停手** ⇒ 局面易僵。
const PUSH_PER_SIDE = _num('RW_PUSH_PER_SIDE', (WL_PUSHER && WL_PUSHER.perSide) || 3, 1)
const PUSH_TOTAL_PER_CYCLE = PUSH_PER_SIDE * 2   // 派生值（仅用于日志/校验显示）
const PUSH_TYPES_PER_SIDE = _num('RW_PUSH_TYPES', (WL_PUSHER && WL_PUSHER.typesPerSide) || 3, 1)
const PUSH_MAX_PER_SIDE = _num('RW_PUSH_MAX_PER_SIDE', (WL_PUSHER && WL_PUSHER.maxPerSide) || 400, 1)
const PUSH_TYPE = process.env.RW_PUSH_TYPE || 'tank'                      // 无白名单/池为空时的回退兵种
let _pushTimer = null
let _pushCount = { [RED_TEAM]: 0, [BLUE_TEAM]: 0 }

/** 从数组随机取 k 个不重复元素（k>=len 取全部）。 */
function _pickRandom (arr, k) {
  if (k >= arr.length) return arr.slice()
  const cp = arr.slice()
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(Math.random() * (cp.length - i))
    const t = cp[i]; cp[i] = cp[j]; cp[j] = t
  }
  return cp.slice(0, k)
}

/**
 * 推手 v3：两边**各自**从 PUSH_POOL（land+air，排除执行者）随机挑 PUSH_TYPES_PER_SIDE 个兵种，
 * 每边补 PUSH_PER_SIDE 个兵（兵的类型从挑中的兵种里随机），落本队指挥中心、巡逻向敌方基地。
 * 两边**等量**（不破坏平衡）；每边累计到 PUSH_MAX_PER_SIDE 封顶。返回发出的命令条数。
 */
function pushOnce () {
  if (!PATROL_ENABLED) return 0
  const pool = PUSH_POOL.length ? PUSH_POOL : [PUSH_TYPE]
  // ★ 两边**共用同一批**挑中的兵种（公平对拼，避免一边抽到强兵种、一边抽到弱兵种）
  const picked = _pickRandom(pool, Math.min(PUSH_TYPES_PER_SIDE, pool.length))
  let n = 0
  const stat = { [RED_TEAM]: {}, [BLUE_TEAM]: {} }
  for (const team of [RED_TEAM, BLUE_TEAM]) {
    const target = PATROL_TARGETS[team]
    if (!target || _pushCount[team] >= PUSH_MAX_PER_SIDE) continue
    const vTeam = (team === RED_TEAM) ? RED_VIEWER_TEAM : BLUE_VIEWER_TEAM
    for (let i = 0; i < PUSH_PER_SIDE; i++) {
      // ★ 落点 = 本队指挥中心旁；巡逻令目标 = 敌方基地（走 spawnPatrol，与弹幕召唤同一语义）。
      const type = picked[Math.floor(Math.random() * picked.length)]
      const pos = getRandomPosition(team, 'base')
      dispatch(`script debug.spawnPatrol('${type}', ${pos.x}.0, ${pos.y}.0, ${vTeam}, ${target.x}.0, ${target.y}.0)`)
      stat[team][type] = (stat[team][type] || 0) + 1
      n++
    }
    _pushCount[team] += PUSH_PER_SIDE
  }
  // ★ 2026-09-27：推手此前**完全没有日志**，排障只能靠推。补一行可 grep 的痕迹。
  if (n) {
    const fmt = (s) => Object.entries(s).map(([k, c]) => k + ' ×' + c).join('  ') || '-'
    logger.info(`[PUSH] 各 +${PUSH_PER_SIDE} → 红 ${fmt(stat[RED_TEAM])} | 蓝 ${fmt(stat[BLUE_TEAM])}`
      + `（累计 红${_pushCount[RED_TEAM]}/蓝${_pushCount[BLUE_TEAM]}，上限 ${PUSH_MAX_PER_SIDE}）`)
  }
  return n
}

/** 启动收局推手（幂等，计数归零）。关闭开关或周期为 0 时返回 false。 */
function startRoundPusher () {
  stopRoundPusher()
  _pushCount = { [RED_TEAM]: 0, [BLUE_TEAM]: 0 }
  if (!PATROL_ENABLED || !PUSH_INTERVAL_MS) return false
  _pushTimer = setInterval(pushOnce, PUSH_INTERVAL_MS)
  if (_pushTimer.unref) _pushTimer.unref()
  return true
}

/** 停止收局推手（幂等）。轮次结束必须调用，避免泄漏定时器。 */
function stopRoundPusher () {
  if (_pushTimer) { clearInterval(_pushTimer); _pushTimer = null }
  return true
}

function getRandomPosition (team, zone) {
  // zone 参数保留以兼容调用方（handleGift / pushOnce 传 'base'）；双区已移除，落点恒为指挥中心区（SPAWN_AREAS）。
  const area = SPAWN_AREAS[team] || SPAWN_AREAS[RED_TEAM]
  return {
    x: Math.round(area.xMin + Math.random() * (area.xMax - area.xMin)),
    y: Math.round(area.yMin + Math.random() * (area.yMax - area.yMin))
  }
}

/**
 * 在指定队的出生区造 count 个 unitType（投 viewer 宿主队）。
 * - 普通单位：落地 + 巡逻令向敌方基地（`spawnPatrol`）。
 * - **建筑类**（白名单 `building`）：**就地建造**、不下巡逻令（`createUnit`）——塔没有脚。
 * 只负责"造 + 下令"这一层 —— 冷却/经济在 spawnUnit 里。
 * 2026-09-21 抽出，供**礼物召唤**（battle/index.js handleGift）复用同一套落点/巡逻语义。
 *
 * ★ 兵落到**同阵营的无 AI 宿主队**（team3/4），而不是有 AI 的主队（team1/2）：
 *   否则本队 AI 每 tick 会重新指派自己队的单位、覆盖巡逻令 av.j ⇒ 兵"走到一半被叫回家"。
 *   宿主队由地图 team_3_info/team_4_info 定义（allyGroup 红1/蓝2 + disabledAI）。
 *
 * @param {{team:number, unitType:string, count:number, zone?:'base', viewerTeam?:number}} o
 * @returns {{positions:Array<{x:number,y:number}>, viewerTeam:number, zone:string}}
 */
function spawnBatch (o) {
  const team = o.team
  const n = Math.max(1, o.count || 1)
  const zone = o.zone || 'base'
  const viewerTeam = o.viewerTeam != null
    ? o.viewerTeam
    : (team === RED_TEAM ? RED_VIEWER_TEAM : BLUE_VIEWER_TEAM)
  const patrol = PATROL_TARGETS[team]
  // ★ 2026-10：建筑类（白名单 building）**就地建造** —— 塔没有脚，不给它下 av.j 巡逻令。
  const staticUnit = WL_STATIC_TYPES.has(o.unitType)
  const positions = []
  for (let i = 0; i < n; i++) {
    const pos = getRandomPosition(team, zone)
    if (staticUnit) {
      // 就地部署：只造出来，不下任何移动令。落点仍是本队指挥中心旁（基地防御）。
      dispatch(`script debug.createUnit('${o.unitType}', ${pos.x}.0, ${pos.y}.0, ${viewerTeam}, false)`)
    } else if (PATROL_ENABLED && patrol) {
      // 造兵 + 立刻只对这一个兵下巡逻令（目标=敌方基地），落在 viewer 队。见上方 PATROL_TARGETS。
      dispatch(`script debug.spawnPatrol('${o.unitType}', ${pos.x}.0, ${pos.y}.0, ${viewerTeam}, ${patrol.x}.0, ${patrol.y}.0)`)
    } else {
      dispatch(`script debug.createUnit('${o.unitType}', ${pos.x}.0, ${pos.y}.0, ${viewerTeam}, false)`)
    }
    positions.push(pos)
  }
  return { positions, viewerTeam, zone, static: staticUnit }
}

// ===== 生成单位 =====
function spawnUnit (parsed, userId) {
  const now = Date.now()
  if (now - (lastSpawnTime[userId || ''] || 0) < spawnCooldownMs()) {
    return { success: false, reason: '冷却中' }
  }
  lastSpawnTime[userId || ''] = now

  // 双保险：parseDanmaku 已夹过一次，这里再夹一次，防止将来别的调用方绕过上限
  const n = Math.min(Math.max(1, parsed.count || 1), MAX_UNITS_PER_DANMAKU)

  // ★ 阵营级配额：每队每轮观众兵总量上限，防一边倒（在扣款前拦，避免"扣了不放"）
  const cap = teamCapPerRound()
  if (cap > 0) {
    const cur = _teamSpawnCount[parsed.team] || 0
    if (cur + n > cap) {
      return { success: false, reason: '本方观众兵已达上限', team: parsed.team, teamName: parsed.teamName,
        unitType: parsed.unitType, count: n, economy: { cap, current: cur, capped: true } }
    }
  }

  // ★ 引擎真实经济（2026-09-19 接线）：召唤前先扣该队的钱。
  //   引擎**不会**因生兵自动扣款（实测：钉死 500000 发 10 辆 tank，余额纹丝不动），
  //   所以扣款只能在这里显式做 —— 用注入新增的 debug.addTeamCredits。
  //   RW_ECON_ENABLED 未开时整段跳过 ⇒ 行为与"免费召唤"完全一致（可一秒回退）。
  let econ = null
  const price = economy.priceOf(parsed.unitType)
  if (economy.ENABLED) {
    if (price == null) {
      econ = { price: null, spent: 0, note: 'no-price-entry' }
    } else {
      const total = price * n
      // ★ 观众独立钱包（分账）：观众的钱落**观众宿主队**（红3/蓝4），与 AI 主队(team1/2)隔离，
      //   使 AI 花不到观众充的钱。walletMode='shared' 回退旧行为（扣 AI 主队）；
      //   缺 viewerTeam 字段（直接调 spawnUnit 的老调用方）时按阵营主队推导。
      const econTeam = (walletModeOf() === 'shared')
        ? parsed.team
        : (parsed.viewerTeam != null ? parsed.viewerTeam : viewerTeamOf(parsed.team))
      const t = economy.getTeam(econTeam)
      if (!t) {
        return { success: false, reason: '经济数据未就绪（econ_live.txt 读不到或已过期）',
          team: parsed.team, teamName: parsed.teamName, unitType: parsed.unitType, count: n,
          economy: { need: total, price, ready: false } }
      }
      if (t.balance < total) {
        return { success: false, reason: '余额不足',
          team: parsed.team, teamName: parsed.teamName, unitType: parsed.unitType, count: n,
          economy: { need: total, price, balance: Math.floor(t.balance), income: t.income, insufficient: true } }
      }
      // ★ 必须先快照：economy.charge 会就地修改缓存里的余额对象，
      //   直接引用 t.balance 会把"扣款前"读成"扣款后"（离线回归 D5 抓到过）。
      const before = Math.floor(t.balance)
      const c = economy.charge(econTeam, total, dispatch)
      econ = { price, spent: total, balanceBefore: before,
        balanceAfter: before - total, income: t.income, sent: c.sent }
    }
  }

  // ★ 2026-09-22：统一从指挥中心召唤（原「单兵落基地 / 成建制上前线」双区已移除）。
  const zone = 'base'
  // 造兵 + 巡逻令统一走 spawnBatch（见其 docstring）。经济仍记在主队 parsed.team 上。
  const batch = spawnBatch({ team: parsed.team, unitType: parsed.unitType, count: n, zone,
    viewerTeam: parsed.viewerTeam })
  _teamSpawnCount[parsed.team] = (_teamSpawnCount[parsed.team] || 0) + n   // 阵营配额计数

  return { success: true, team: parsed.team, teamName: parsed.teamName, unitType: parsed.unitType,
    viewerTeam: batch.viewerTeam, count: n, zone, position: batch.positions[0], positions: batch.positions, economy: econ }
}

// ===== 处理弹幕 =====
function handleDanmaku (msg) {
  const parsed = parseDanmaku(msg.content || msg.text)
  if (!parsed) return null
  const result = spawnUnit(parsed, msg.userId || msg.playerId || msg.nickname || msg.playerName)
  return result
}

// ===== 英文类型名 → 引擎中文名（播报用）=====
// UNIT_MAP 是多对一（'战车'/'铁甲'/'车'/'钢铁'/'坦克' → 'tank'），反向取名时取
// **第一个含汉字的键**作为展示名；找不到原样返回（不编名字）。
function unitDisplayName (unitType) {
  if (!unitType) return ''
  if (WL_NAME[unitType]) return WL_NAME[unitType]
  for (const [k, v] of Object.entries(UNIT_MAP)) {
    if (v === unitType && /[\u4e00-\u9fff]/.test(k)) return k
  }
  if (MOD_UNIT_NAME[unitType]) return MOD_UNIT_NAME[unitType]
  return unitType
}

module.exports = { connect, handleDanmaku, parseDanmaku, spawnUnit, spawnBatch, sendCommand, dispatch, drainReplies, UNIT_MAP, unitDisplayName, SPAWN_AREAS, DEBUG_PORT, setSendCommandForTest, PATROL_TARGETS, PATROL_ENABLED, PUSH_INTERVAL_MS, PUSH_PER_SIDE, PUSH_TOTAL_PER_CYCLE, PUSH_TYPES_PER_SIDE, PUSH_MAX_PER_SIDE, PUSH_POOL, PUSH_TYPE, PUSH_LEVEL, PUSH_LEVELS, pushOnce, startRoundPusher, stopRoundPusher, normalizeDanmaku, matchUnitByContains, looksLikeCommand, WL_MAP, WL_SUMMON_TYPES, WL_NAME, WL_ON, WL_CATS, WL_STATIC_TYPES, resolveWhitelist, tierCapOf, spawnCooldownMs, basicUnit, resetTeamSpawnCount, teamCapPerRound, get WL_PUSHER () { return WL_PUSHER }, get WL_SUMMON () { return WL_SUMMON }, get connected () { return connected } }