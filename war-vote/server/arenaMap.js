// 基础竞技场地图生成器 — 生成空战场，红蓝两方出生区域
const fs = require('fs')
const path = require('path')
const config = require('./config')

const MAP_W = 32 // tiles
const MAP_H = 20
const TILE = 20

function generateArenaMap () {
  const ground = Buffer.alloc(MAP_W * MAP_H * 4, 0)
  const items = Buffer.alloc(MAP_W * MAP_H * 4, 0)
  const units = Buffer.alloc(MAP_W * MAP_H * 4, 0)

  // 填充草地地面 (gid 1 = grass)
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    ground.writeUInt32LE(1, i * 4)
  }

  // 中间画一条河 (y=9-10, 水 tile gid=193)
  for (let x = 0; x < MAP_W; x++) {
    for (let y = 9; y <= 10; y++) {
      const idx = y * MAP_W + x
      ground.writeUInt32LE(193, idx * 4) // water
    }
  }
  // 桥梁 (x=15,16 过河)
  for (let x = 15; x <= 16; x++) {
    ground.writeUInt32LE(1, 9 * MAP_W * 4 + x * 4)
    ground.writeUInt32LE(1, 10 * MAP_W * 4 + x * 4)
  }

  function compress (buf) {
    const zlib = require('zlib')
    return zlib.gzipSync(buf).toString('base64')
  }

  const tmx = `<?xml version="1.0" encoding="UTF-8"?>
<map version="2017.05.25" orientation="orthogonal" renderorder="right-down" width="${MAP_W}" height="${MAP_H}" tilewidth="${TILE}" tileheight="${TILE}">
 <tileset firstgid="1" name="Grass" tilewidth="${TILE}" tileheight="${TILE}" tilecount="1" columns="1">
  <image source="terrain/bitmaps/grass.png" width="20" height="20"/>
 </tileset>
 <tileset firstgid="2" name="Water" tilewidth="${TILE}" tileheight="${TILE}" tilecount="1" columns="1">
  <image source="terrain/bitmaps/water.png" trans="008a76" width="20" height="20"/>
 </tileset>
 <layer name="Ground" width="${MAP_W}" height="${MAP_H}">
  <data encoding="base64" compression="gzip">
   ${compress(ground)}
  </data>
 </layer>
 <layer name="Items" width="${MAP_W}" height="${MAP_H}">
  <data encoding="base64" compression="gzip">
   ${compress(items)}
  </data>
 </layer>
 <layer name="Units" width="${MAP_W}" height="${MAP_H}">
  <data encoding="base64" compression="gzip">
   ${compress(units)}
  </data>
 </layer>
 <objectgroup name="Triggers">
  <object id="1" name="map_info" x="0" y="0" width="100" height="60">
   <properties>
    <property name="fog" value="map"/>
    <property name="introText" value="直播间弹幕对战 — 发送 红/蓝+兵种 实时生成单位"/>
    <property name="type" value="mission"/>
    <property name="winCondition" value="mainBuildings"/>
   </properties>
  </object>
 </objectgroup>
</map>`

  const mapPath = path.join(config.RW_DIR, 'mods', 'maps', 'arena.tmx')
  fs.writeFileSync(mapPath, tmx)
  console.log('Arena map generated:', mapPath)

  // 同时复制到 assets 目录（Debug Socket 需要）
  const dstDir = path.join(config.RW_DIR, 'assets', 'assets', 'maps', 'skirmish')
  if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true })
  fs.copyFileSync(mapPath, path.join(dstDir, 'arena.tmx'))
  console.log('Copied to assets:', dstDir)

  return mapPath
}

module.exports = { generateArenaMap }

if (require.main === module) generateArenaMap()