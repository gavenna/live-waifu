/**
 * mapPool.js — 地图池 + 阵型模板
 * 从 war-vote 迁移，支持多地图轮换 + 随机阵型
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

// ===== 地图配置 =====
const MAP_W = 32  // tiles
const MAP_H = 20
const TILE = 20

// ===== 阵型模板 =====
const FORMATIONS = {
  // 锋矢阵 — 前锋尖锐
  wedge: {
    name: '锋矢阵',
    genSlots (cx, cy, count, dir) {
      const slots = []
      let n = 1
      for (let row = 0; row < 8 && n <= count; row++) {
        const cols = row + 1
        for (let col = 0; col < cols && n <= count; col++) {
          const x = cx + (col - cols / 2) * dir * 2
          const y = cy + row * 2
          slots.push({ n: n++, x: Math.round(x), y: Math.round(y) })
        }
      }
      return slots
    }
  },
  // 方阵 — 密集方块
  square: {
    name: '方阵',
    genSlots (cx, cy, count) {
      const slots = []
      const cols = Math.ceil(Math.sqrt(count))
      let n = 1
      for (let r = 0; r < cols && n <= count; r++) {
        for (let c = 0; c < cols && n <= count; c++) {
          slots.push({ n: n++, x: cx + c * 2, y: cy + r * 2 })
        }
      }
      return slots
    }
  },
  // 长蛇阵 — 纵深排列
  line: {
    name: '长蛇阵',
    genSlots (cx, cy, count) {
      const slots = []
      for (let i = 0; i < count; i++) {
        slots.push({ n: i + 1, x: cx, y: cy + i * 2 })
      }
      return slots
    }
  }
}

// ===== 默认单位分配 =====
const DEFAULT_UNIT_MIX = [
  { unit: 'heavyTank', weight: 3 },
  { unit: 'tank', weight: 5 },
  { unit: 'laserTank', weight: 2 },
  { unit: 'artillery', weight: 2 },
  { unit: 'turret', weight: 1 },
  { unit: 'helicopter', weight: 1 },
]

function pickUnit () {
  const total = DEFAULT_UNIT_MIX.reduce((s, u) => s + u.weight, 0)
  let r = Math.random() * total
  for (const u of DEFAULT_UNIT_MIX) {
    r -= u.weight
    if (r <= 0) return u.unit
  }
  return 'tank'
}

// ===== 地图池 =====
const MAP_POOL = [
  {
    id: 'classic',
    name: '经典战场',
    formation: 'wedge',
    redSpawn: { cx: 8, cy: 10 },
    blueSpawn: { cx: 24, cy: 10 },
  },
  {
    id: 'forest',
    name: '森林遭遇',
    formation: 'square',
    redSpawn: { cx: 6, cy: 8 },
    blueSpawn: { cx: 26, cy: 12 },
  },
  {
    id: 'desert',
    name: '沙漠攻防',
    formation: 'line',
    redSpawn: { cx: 5, cy: 10 },
    blueSpawn: { cx: 27, cy: 10 },
  }
]

// ===== 生成阵型 =====
function generateFormation (mapConfig, slotCount) {
  const formation = FORMATIONS[mapConfig.formation] || FORMATIONS.wedge

  const redSlots = formation.genSlots(
    mapConfig.redSpawn.cx, mapConfig.redSpawn.cy,
    slotCount, 1
  ).map(s => ({ ...s, unit: pickUnit(), team: 0 }))

  const blueSlots = formation.genSlots(
    mapConfig.blueSpawn.cx, mapConfig.blueSpawn.cy,
    slotCount, -1
  ).map(s => ({ ...s, unit: pickUnit(), team: 1 }))

  return {
    formationName: formation.name,
    red: redSlots,
    blue: blueSlots
  }
}

// ===== 生成 TMX 地图 =====
function generateMap (mapConfig, formation, gameDir) {
  const ground = Buffer.alloc(MAP_W * MAP_H * 4, 0)
  const items = Buffer.alloc(MAP_W * MAP_H * 4, 0)
  const units = Buffer.alloc(MAP_W * MAP_H * 4, 0)

  // 草地 (gid 1)
  for (let i = 0; i < MAP_W * MAP_H; i++) ground.writeUInt32LE(1, i * 4)
  // 中间河 (y=9-10)
  for (let x = 0; x < MAP_W; x++) {
    for (let y = 9; y <= 10; y++) ground.writeUInt32LE(193, (y * MAP_W + x) * 4)
  }
  // 桥
  for (let x = 15; x <= 16; x++) {
    ground.writeUInt32LE(1, (9 * MAP_W + x) * 4)
    ground.writeUInt32LE(1, (10 * MAP_W + x) * 4)
  }

  const compress = (buf) => zlib.gzipSync(buf).toString('base64')

  const tmx = `<?xml version="1.0" encoding="UTF-8"?>
<map version="2017.05.25" orientation="orthogonal" renderorder="right-down" width="${MAP_W}" height="${MAP_H}" tilewidth="${TILE}" tileheight="${TILE}">
 <tileset firstgid="1" name="Mountain" tilewidth="20" tileheight="20" tilecount="35" columns="7">
  <image source="terrain/bitmaps/mountain.png" trans="008a76" width="140" height="100"/>
 </tileset>
 <tileset firstgid="36" name="Water" tilewidth="20" tileheight="20" tilecount="1" columns="1">
  <image source="terrain/bitmaps/water.png" trans="008a76" width="20" height="20"/>
 </tileset>
 <layer name="Ground" width="${MAP_W}" height="${MAP_H}">
  <data encoding="base64" compression="gzip">${compress(ground)}</data>
 </layer>
 <layer name="Items" width="${MAP_W}" height="${MAP_H}">
  <data encoding="base64" compression="gzip">${compress(items)}</data>
 </layer>
 <layer name="Units" width="${MAP_W}" height="${MAP_H}">
  <data encoding="base64" compression="gzip">${compress(units)}</data>
 </layer>
 <objectgroup name="Triggers">
  <object id="1" name="map_info" x="0" y="0" width="100" height="60">
   <properties>
    <property name="fog" value="map"/>
    <property name="introText" value="弹幕对战 — ${mapConfig.name} — ${formation.formationName}"/>
    <property name="type" value="mission"/>
    <property name="winCondition" value="mainBuildings"/>
   </properties>
  </object>
 </objectgroup>
</map>`

  const mapPath = path.join(gameDir, 'mods', 'maps', 'battle_arena.tmx')
  fs.writeFileSync(mapPath, tmx)

  // 复制到 assets 目录（Debug Socket 需要）
  const dstDir = path.join(gameDir, 'assets', 'assets', 'maps', 'skirmish')
  if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true })
  fs.copyFileSync(mapPath, path.join(dstDir, 'battle_arena.tmx'))

  return 'maps/skirmish/battle_arena.tmx'
}

// ===== 选择地图 =====
function pickMap () {
  return MAP_POOL[Math.floor(Math.random() * MAP_POOL.length)]
}

module.exports = { MAP_POOL, FORMATIONS, pickMap, generateFormation, generateMap, pickUnit, MAP_W, MAP_H }