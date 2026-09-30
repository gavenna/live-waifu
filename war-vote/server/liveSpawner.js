/**
 * liveSpawner.js — 实时弹幕生兵系统
 * 通过 Debug Socket 直接在游戏里生成单位，不需要投票和地图重启
 */
const net = require('net')
const logger = require('./logger')

// ===== 配置 =====
const DEBUG_PORT = 9999
const SPAWN_INTERVAL_MS = 500 // 同一玩家生成间隔（防刷屏）

// ===== 单位类型映射（中文 → 游戏ID）=====
const UNIT_MAP = {
  // 地面单位
  '坦克': 'tank', 'tank': 'tank',
  '重坦': 'heavyTank', 'heavyTank': 'heavyTank', '重坦': 'heavyTank',
  '激光坦克': 'laserTank', 'laser': 'laserTank', 'laserTank': 'laserTank',
  '火炮': 'artillery', 'artillery': 'artillery', '大炮': 'artillery',
  '巨型坦克': 'mammothTank', 'mammoth': 'mammothTank', 'mammothTank': 'mammothTank',
  '超级坦克': 'megaTank', 'mega': 'megaTank', 'megaTank': 'megaTank',
  '实验坦克': 'experimentalTank', 'exptank': 'experimentalTank',
  '悬浮坦克': 'hoverTank', 'hover': 'hoverTank', 'hoverTank': 'hoverTank',
  '重型悬浮': 'heavyHoverTank', 'heavyHover': 'heavyHoverTank',
  '蜘蛛': 'spiderBot', 'spider': 'spiderBot', 'spiderBot': 'spiderBot',
  '甲虫': 'bug', 'bug': 'bug',
  '瓢虫': 'ladybug', 'ladybug': 'ladybug',
  '坦克杀手': 'tankDestroyer', 'tankDestroyer': 'tankDestroyer',
  '气垫船': 'hovercraft', 'hovercraft': 'hovercraft',
  // 空中单位
  '直升机': 'helicopter', 'heli': 'helicopter', 'helicopter': 'helicopter',
  '飞艇': 'airShip', 'airShip': 'airShip',
  '战斗机': 'amphibiousJet', 'jet': 'amphibiousJet',
  '实验直升机': 'experimentalGunship', 'expheli': 'experimentalGunship',
  '运输机': 'dropship', 'dropship': 'dropship',
  '炮艇': 'gunShip', 'gunShip': 'gunShip',
  // 海军
  '战列舰': 'battleShip', 'battleShip': 'battleShip',
  '潜艇': 'attackSubmarine', 'sub': 'attackSubmarine',
  '炮艇船': 'gunBoat', 'gunBoat': 'gunBoat',
  '航母': 'carrier', 'carrier': 'carrier',
  '导弹船': 'missileShip', 'missileShip': 'missileShip',
  // 防御建筑
  '炮塔': 'turret', 'turret': 'turret',
  '高级炮塔': 'turretT2', 'turretT2': 'turretT2',
  '顶级炮塔': 'turretT3', 'turretT3': 'turretT3',
  '防空塔': 'antiAirTurret', 'aa': 'antiAirTurret',
  '激光防御': 'laserDefence', 'laserDef': 'laserDefence',
  // 特殊
  '建造者': 'builder', 'builder': 'builder',
  '核弹': 'nukeLaucher', 'nuke': 'nukeLaucher',
  '反核': 'antiNukeLaucher', 'antinuke': 'antiNukeLaucher',
}

// 可选兵种列表（给弹幕提示用）
const AVAILABLE_UNITS = Object.keys(UNIT_MAP).filter(k => k.length <= 6 && !k.match(/^[a-z]/))

// ===== 状态 =====
let socket = null
let connected = false
let commandQueue = []
let processing = false
const lastSpawnTime = {} // userId -> timestamp

// ===== Debug Socket 连接 =====
function connect () {
  if (socket) {
    try { socket.destroy() } catch (e) {}
  }
  socket = new net.Socket()
  socket.setEncoding('utf-8')
  socket.setTimeout(30000)

  socket.connect(DEBUG_PORT, '127.0.0.1', () => {
    connected = true
    logger.info('[SPAWNER] Debug Socket 已连接')
    // 发送 ping 验证
    socket.write('ping\n')
    flushQueue()
  })

  socket.on('data', (data) => {
    const resp = data.toString().trim()
    if (resp === 'pong') {
      logger.info('[SPAWNER] Debug Socket 连通')
    }
  })

  socket.on('close', () => {
    connected = false
    logger.warn('[SPAWNER] Debug Socket 断开，3秒后重连...')
    setTimeout(connect, 3000)
  })

  socket.on('error', (err) => {
    connected = false
    logger.error('[SPAWNER] Socket 错误: ' + err.message)
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
    const cmd = commandQueue.shift()
    socket.write(cmd + '\n')
  }
}

// ===== 解析弹幕 =====
function parseDanmaku (content) {
  if (!content || typeof content !== 'string') return null
  const text = content.trim()

  // 匹配格式: "红 tank" / "蓝 heavyTank" / "红方3 坦克" / "蓝1 重坦"
  // 也支持: "红 坦克" / "蓝 重坦"
  const match = text.match(/^(红|蓝|red|blue)(?:方)?(\d*)\s+(.+)$/i)
  if (!match) return null

  const teamStr = match[1].toLowerCase()
  const team = (teamStr === '红' || teamStr === 'red') ? 0 : 1
  const unitInput = match[3].trim().toLowerCase()

  // 查找单位类型
  let unitType = UNIT_MAP[unitInput]
  if (!unitType) {
    // 尝试模糊匹配
    for (const [key, val] of Object.entries(UNIT_MAP)) {
      if (key.toLowerCase() === unitInput || val.toLowerCase() === unitInput) {
        unitType = val
        break
      }
    }
  }

  if (!unitType) return null
  return { team, unitType, teamName: team === 0 ? '红方' : '蓝方' }
}

// ===== 生成位置管理 =====
// 红方区域: x=80-200, y=150-250  蓝方区域: x=440-560, y=150-250
// 地图大小 640x400 像素（32x20 tiles * 20px）
const SPAWN_AREAS = {
  0: { xMin: 100, xMax: 220, yMin: 160, yMax: 240 }, // 红方
  1: { xMin: 420, xMax: 540, yMin: 160, yMax: 240 }  // 蓝方
}

function getRandomPosition (team) {
  const area = SPAWN_AREAS[team] || SPAWN_AREAS[0]
  const x = area.xMin + Math.random() * (area.xMax - area.xMin)
  const y = area.yMin + Math.random() * (area.yMax - area.yMin)
  return { x: Math.round(x), y: Math.round(y) }
}

// ===== 核心：生成单位 =====
function spawnUnit (parsed, userId) {
  const now = Date.now()
  const last = lastSpawnTime[userId || ''] || 0
  if (now - last < SPAWN_INTERVAL_MS) {
    return { success: false, reason: '冷却中，请稍后再试' }
  }
  lastSpawnTime[userId || ''] = now

  const pos = getRandomPosition(parsed.team)
  const cmd = `script debug.createUnit('${parsed.unitType}', ${pos.x}.0, ${pos.y}.0, ${parsed.team}, false)`

  const sent = sendCommand(cmd)
  logger.info(`[SPAWNER] ${parsed.teamName} ${parsed.unitType} @ (${pos.x},${pos.y}) ${sent ? '已发送' : '已排队'}`)

  return {
    success: true,
    team: parsed.team,
    teamName: parsed.teamName,
    unitType: parsed.unitType,
    position: pos
  }
}

// ===== 处理弹幕消息 =====
function handleDanmaku (msg) {
  // msg 格式: { content, userId, nickname, ... }
  const parsed = parseDanmaku(msg.content)
  if (!parsed) return null
  return spawnUnit(parsed, msg.userId || msg.nickname)
}

// ===== 导出 =====
module.exports = {
  connect,
  handleDanmaku,
  parseDanmaku,
  spawnUnit,
  sendCommand,
  UNIT_MAP,
  AVAILABLE_UNITS,
  get connected () { return connected }
}