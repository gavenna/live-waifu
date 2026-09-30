#!/usr/bin/env node
/**
 * gen_map_contract.js — 从「适配后的 RW 地图」提取**地图契约**，写 battle/map-config.json。
 *
 * 为什么有它（第 5 点「共用一套逻辑」的核心）：中继里所有与地图几何绑定的量原本散落硬编码——
 *   liveSpawner.js 的 COMMAND_CENTER/SPAWN_AREAS/PATROL_TARGETS、gameController.js 的 CAM_DEFAULTS、
 *   index.js 的观众网格锚点……换图就得逐处手改，且已经出过「出生点用新图、巡逻目标用旧图」的错位。
 *   现在把这些量**从地图本身解析出来**集中到 map-config.json，中继只读它 ⇒ 换图 = 换地图文件 + 跑本脚本。
 *
 * 输入：适配后的产物 TMX（team1=红 / team2=蓝，含 team_info 的 Triggers）。
 * 输出：battle/map-config.json（缺省路径）。
 *
 * 用法：
 *   node tools/gen_map_contract.js                      # 用默认产物路径
 *   node tools/gen_map_contract.js --src <tmx> --out <json> --map-name new_dire.tmx
 *   node tools/gen_map_contract.js --selftest           # 合成输入自检，不碰真图
 *
 * 环境变量：RW_GAME_DIR / RW_NEWDIRE_DST / RW_CAM_X / RW_CAM_Y / RW_CAM_ZOOM
 */
'use strict'
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const GAME = process.env.RW_GAME_DIR ||
  'D:\\game\\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\\Rusted Warfare1.15'
const DEFAULT_SRC = process.env.RW_NEWDIRE_DST || path.join(GAME, 'mods', 'maps', 'new_dire.tmx')
const DEFAULT_OUT = path.join(__dirname, '..', 'battle', 'map-config.json')

// 队号契约（与 battle/teams.js 一致；换队号要同时改这里与 teams.js）
const TEAMS = { red: 1, blue: 2, redViewer: 3, blueViewer: 4 }
const SPAWN_PAD = 45
// 引擎 zoom=1 时的视野半宽/半高（像素）。来源：gameController.js CAM_DEFAULTS 注释里实测换算
// （675.5 / 450 = zoom 1 时的视野半宽/半高；实测 cE = 1351/zoom 反比成立）。
const VIEW_HALF_W_AT_ZOOM1 = 675.5
const VIEW_HALF_H_AT_ZOOM1 = 450

function parseMapHeader (text) {
  const g = (re) => { const m = re.exec(text); return m ? parseInt(m[1], 10) : null }
  return {
    width: g(/<map\b[^>]*\bwidth="(\d+)"/),
    height: g(/<map\b[^>]*\bheight="(\d+)"/),
    tilewidth: g(/<map\b[^>]*\btilewidth="(\d+)"/),
    tileheight: g(/<map\b[^>]*\btileheight="(\d+)"/)
  }
}

/** 解一层瓦片数据（base64 + gzip）→ Int32Array(gid)，小端 4 字节。 */
function decodeLayer (text, name) {
  const re = new RegExp('(<layer\\b[^>]*\\bname="' + name + '"[^>]*>\\s*<data[^>]*>)([\\s\\S]*?)(</data>)')
  const m = re.exec(text)
  if (!m) return null
  const b64 = m[2].replace(/\s+/g, '')
  if (!b64) return new Int32Array(0)
  let raw
  try { raw = zlib.gunzipSync(Buffer.from(b64, 'base64')) } catch (e) { raw = Buffer.from(b64, 'base64') }
  const n = Math.floor(raw.length / 4)
  const gids = new Int32Array(n)
  for (let i = 0; i < n; i++) gids[i] = raw.readInt32LE(i * 4)
  return gids
}

/** 解析 tileset：firstgid + name + 标了 water=true 的局部 tile id 集合。 */
function parseTilesets (text) {
  const out = []
  const re = /<tileset\b([^>]*)>([\s\S]*?)<\/tileset>/g
  let m
  while ((m = re.exec(text))) {
    const attrs = m[1]
    const fg = /\bfirstgid="(\d+)"/.exec(attrs)
    const nm = /\bname="([^"]*)"/.exec(attrs)
    if (!fg || !nm) continue
    const ts = { firstgid: parseInt(fg[1], 10), name: nm[1], waterTiles: new Set() }
    const tre = /<tile\b([^>]*)>([\s\S]*?)<\/tile>/g
    let t
    while ((t = tre.exec(m[2]))) {
      const idm = /\bid="(\d+)"/.exec(t[1])
      if (idm && /name="water"/.test(t[2])) ts.waterTiles.add(parseInt(idm[1], 10))
    }
    out.push(ts)
  }
  out.sort((a, b) => a.firstgid - b.firstgid)
  return out
}

/** 解析 UnitObjects 段 → [{unit, team, x, y}]。 */
function parseUnitObjects (text) {
  const seg = /<objectgroup\b[^>]*\bname="UnitObjects"[^>]*>([\s\S]*?)<\/objectgroup>/.exec(text)
  if (!seg) return []
  const out = []
  const re = /<object\b([^>]*)>([\s\S]*?)<\/object>/g
  let o
  while ((o = re.exec(seg[1]))) {
    const attrs = o[1]; const props = o[2]
    const unit = /<property\s+name="unit"\s+value="([^"]*)"/.exec(props)
    const team = /<property\s+name="team"\s+value="([^"]*)"/.exec(props)
    const x = /\bx="(-?[\d.]+)"/.exec(attrs)
    const y = /\by="(-?[\d.]+)"/.exec(attrs)
    if (unit && x && y) out.push({ unit: unit[1], team: team ? team[1] : null, x: parseFloat(x[1]), y: parseFloat(y[1]) })
  }
  return out
}

function findUnit (units, unitName, team) {
  const u = units.find((x) => x.unit === unitName && String(x.team) === String(team))
  return u ? { x: Math.round(u.x), y: Math.round(u.y) } : null
}

function isWaterGid (gid, tilesets) {
  if (!gid) return false
  let owner = null
  for (const ts of tilesets) { if (gid >= ts.firstgid) owner = ts; else break }
  if (!owner) return false
  // 水域判据 = tile 上带 `water` 属性（RW 里 value 为空串也表示"是水"，见引擎 game\b\g.java:191）。
  // ⚠️ 不能用 tileset 名含 "water" 判——本图的水表全是**过渡表**（sand2shallowwater 等），
  //    名判据会把大半个地图误判成水（实测 29096/41400 = 70% 假阳性）。
  return owner.waterTiles.has(gid - owner.firstgid)
}

/**
 * 主逻辑：TMX 文本 → 契约对象。
 * @param {string} text  TMX 文本
 * @param {{mapName?:string, camX?:number, camY?:number, camZoom?:number}} [opts]
 */
function buildContract (text, opts) {
  opts = opts || {}
  const h = parseMapHeader(text)
  if (!h.width || !h.height) throw new Error('map-config: 无法解析 <map> 尺寸')
  const units = parseUnitObjects(text)
  const cc = { red: findUnit(units, 'commandCenter', TEAMS.red), blue: findUnit(units, 'commandCenter', TEAMS.blue) }
  if (!cc.red || !cc.blue) {
    throw new Error('map-config: 缺 commandCenter（red=team' + TEAMS.red + ' / blue=team' + TEAMS.blue + '）')
  }
  const vk = { red: findUnit(units, 'viewer_king', TEAMS.red), blue: findUnit(units, 'viewer_king', TEAMS.blue) }
  const patrolTargets = { red: { x: cc.blue.x, y: cc.blue.y }, blue: { x: cc.red.x, y: cc.red.y } }
  const viewerAnchors = {
    red: vk.red || { x: cc.red.x, y: cc.red.y },
    blue: vk.blue || { x: cc.blue.x, y: cc.blue.y }
  }
  const viewerAnchorSource = { red: vk.red ? 'viewer_king' : 'commandCenter(fallback)', blue: vk.blue ? 'viewer_king' : 'commandCenter(fallback)' }
  // 开局镜头：焦点 = 两基地中点；zoom 推到能框住两基地间距（带 margin），钳 [0.3,1.0]。
  const cx = (cc.red.x + cc.blue.x) / 2
  const cy = (cc.red.y + cc.blue.y) / 2
  const span = Math.hypot(cc.blue.x - cc.red.x, cc.blue.y - cc.red.y)
  const margin = 1.15
  let z = (2 * VIEW_HALF_W_AT_ZOOM1) / (span * margin || 1)
  z = Math.max(0.3, Math.min(1.0, z))
  const camera = {
    x: opts.camX != null ? opts.camX : Math.round(cx),
    y: opts.camY != null ? opts.camY : Math.round(cy),
    zoom: opts.camZoom != null ? opts.camZoom : Number(z.toFixed(3))
  }
  // 水域判定（供 sea 分类；Wave2 另用 terrain_at.py 交叉核对）
  const tilesets = parseTilesets(text)
  const ground = decodeLayer(text, 'Ground')
  let waterTiles = 0
  if (ground) for (let i = 0; i < ground.length; i++) if (isWaterGid(ground[i], tilesets)) waterTiles++
  const hasWater = waterTiles > 0
  return {
    map: opts.mapName || path.basename(opts.src || ''),
    width: h.width, height: h.height, tile: h.tilewidth,
    world: { w: (h.width || 0) * (h.tilewidth || 0), h: (h.height || 0) * (h.tileheight || 0) },
    teams: TEAMS, spawnPad: SPAWN_PAD,
    commandCenters: cc, patrolTargets, viewerAnchors, viewerAnchorSource,
    camera, hasWater, waterTiles
  }
}

// ==================== CLI ====================
function parseArgv (argv) {
  const o = { selftest: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--selftest') o.selftest = true
    else if (a === '--src') o.src = argv[++i]
    else if (a === '--out') o.out = argv[++i]
    else if (a === '--map-name') o.mapName = argv[++i]
  }
  return o
}

function cmdSelftest () {
  let fails = 0
  const chk = (name, ok, detail) => {
    console.log((ok ? 'OK   ' : 'FAIL ') + name + (detail ? '  -- ' + detail : ''))
    if (!ok) fails++
  }
  // 合成一张最小地图：Ground 含 1 个水瓦片 + UnitObjects 含 CC/vk
  const groundBuf = Buffer.alloc(4 * 4) // 4 tiles
  groundBuf.writeInt32LE(0, 0)
  groundBuf.writeInt32LE(100, 4)   // gid 100 → 落 "Deep Water" tileset
  groundBuf.writeInt32LE(0, 8)
  groundBuf.writeInt32LE(1, 12)    // gid 1 → "Ground" tileset
  const gz = zlib.gzipSync(groundBuf).toString('base64')
  const objs = [
    ['commandCenter', 1, 100, 100], ['commandCenter', 2, 300, 200],
    ['viewer_king', 1, 50, 50], ['viewer_king', 2, 350, 250]
  ].map(([u, t, x, y]) =>
    '<object name="' + u + ' (t:' + t + ')" x="' + x + '" y="' + y + '"><properties>' +
    '<property name="unit" value="' + u + '"/><property name="team" value="' + t + '"/>' +
    '</properties></object>').join('\n')
  const tmx = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<map width="10" height="10" tilewidth="20" tileheight="20" version="1.2">\n' +
    '<tileset firstgid="1" name="Ground"><image source="x.png"/></tileset>\n' +
    '<tileset firstgid="100" name="Water"><tile id="0"><properties><property name="water" value=""/></properties></tile></tileset>\n' +
    '<layer name="Ground" width="10" height="10"><data encoding="base64" compression="gzip">' + gz + '</data></layer>\n' +
    '<objectgroup name="Triggers"/>\n' +
    '<objectgroup name="UnitObjects">\n' + objs + '\n</objectgroup>\n</map>'
  let c = null
  try { c = buildContract(tmx, { mapName: 'selftest.tmx' }) } catch (e) {
    chk('C0 合成图可解析', false, String(e && e.message))
  }
  if (c) {
    chk('C0 合成图可解析', true)
    chk('C1 commandCenters red/blue', c.commandCenters.red.x === 100 && c.commandCenters.blue.x === 300,
      JSON.stringify(c.commandCenters))
    chk('C2 patrolTargets 自动指向敌方 CC', c.patrolTargets.red.x === 300 && c.patrolTargets.blue.x === 100,
      JSON.stringify(c.patrolTargets))
    chk('C3 viewerAnchors 取 viewer_king 坐标', c.viewerAnchors.red.x === 50 && c.viewerAnchors.blue.x === 350,
      JSON.stringify(c.viewerAnchors))
    chk('C4 camera 焦点=两基地中点', c.camera.x === 200 && c.camera.y === 150, JSON.stringify(c.camera))
    chk('C5 hasWater 识别 gid100(Deep Water)', c.hasWater === true && c.waterTiles === 1,
      'hasWater=' + c.hasWater + ' waterTiles=' + c.waterTiles)
    chk('C6 teams 契约', c.teams.red === 1 && c.teams.blue === 2 && c.teams.redViewer === 3 && c.teams.blueViewer === 4)
    chk('C7 尺寸/world', c.width === 10 && c.tile === 20 && c.world.w === 200)
  }
  // 负例：缺 CC 应抛
  try {
    buildContract('<map width="1" height="1" tilewidth="20" tileheight="20"><objectgroup name="UnitObjects"></objectgroup></map>')
    chk('C8 缺 commandCenter → 抛错', false, '居然没抛')
  } catch (e) { chk('C8 缺 commandCenter → 抛错', true) }
  console.log('RESULT: ' + (fails ? 'FAIL' : 'PASS'))
  return fails ? 1 : 0
}

function main (argv) {
  const o = parseArgv(argv)
  if (o.selftest) return cmdSelftest()
  const src = o.src || DEFAULT_SRC
  const out = o.out || DEFAULT_OUT
  if (!fs.existsSync(src)) throw new Error('源 TMX 不存在: ' + src)
  const text = fs.readFileSync(src, 'utf8')
  const contract = buildContract(text, {
    mapName: o.mapName || path.basename(src),
    src,
    camX: process.env.RW_CAM_X != null ? parseFloat(process.env.RW_CAM_X) : undefined,
    camY: process.env.RW_CAM_Y != null ? parseFloat(process.env.RW_CAM_Y) : undefined,
    camZoom: process.env.RW_CAM_ZOOM != null ? parseFloat(process.env.RW_CAM_ZOOM) : undefined
  })
  fs.writeFileSync(out, JSON.stringify(contract, null, 2) + '\n')
  console.log('已生成 ' + out)
  console.log('  尺寸 ' + contract.width + '×' + contract.height + ' tile=' + contract.tile)
  console.log('  指挥中心 ' + JSON.stringify(contract.commandCenters))
  console.log('  巡逻目标 ' + JSON.stringify(contract.patrolTargets))
  console.log('  观众基准 ' + JSON.stringify(contract.viewerAnchors) + ' (' + JSON.stringify(contract.viewerAnchorSource) + ')')
  console.log('  镜头 ' + JSON.stringify(contract.camera))
  console.log('  水域 hasWater=' + contract.hasWater + ' waterTiles=' + contract.waterTiles)
  return 0
}

if (require.main === module) {
  try { process.exit(main(process.argv.slice(2))) } catch (e) { console.error('ERROR: ' + (e && e.message)); process.exit(1) }
}
module.exports = { buildContract, parseUnitObjects, parseTilesets, decodeLayer, TEAMS }
