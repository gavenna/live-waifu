// 地图生成内核 —— 排布规则 + Rusted Warfare tmx 编码
//
// 契约：一切都以「单位名 + 队伍」为准，不依赖 tile id。
// 前端渲染与 tmx 生成拿的是同一个 grid 对象，保证「前端看到的」与「游戏里出现的」逐格一致。

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const config = require('./config');

const RE_TSX_TILE = /<tile id="(\d+)">\s*<properties>\s*<property name="team" value="(\d+)"\/>\s*<property name="unit" value="([^"]+)"\/>/g;

function rwMapsDir() {
  return path.join(config.RW_DIR, config.RW_MAPS_SUBDIR);
}

// units.tsx -> Map<'unit|team', tileId>，渲染切图用
function loadUnitTiles(tsxPath) {
  const file = tsxPath || path.join(rwMapsDir(), 'units.tsx');
  const text = fs.readFileSync(file, 'utf8');
  const out = new Map();
  let m;
  RE_TSX_TILE.lastIndex = 0;
  while ((m = RE_TSX_TILE.exec(text)) !== null) {
    out.set(`${m[3]}|${m[2]}`, parseInt(m[1], 10));
  }
  return out;
}

let _tiles = null;

function unitTiles() {
  if (!_tiles) _tiles = loadUnitTiles();
  return _tiles;
}

// 单位名 + 队伍 -> tmx 里的 gid
function gidOf(unit, team) {
  const tileId = unitTiles().get(`${unit}|${team}`);
  if (tileId === undefined) throw new Error(`units.tsx 里没有 ${unit} 的 team${team} 版本`);
  return config.UNITS_FIRSTGID + tileId;
}

// ===== 阵型 =====

function mirrorX(x, team) {
  return team === 0 ? x : config.MAP_WIDTH - 1 - x;
}

function unitForDepth(depth) {
  const layers = config.FORMATION.layers;
  let unit = layers[0].unit;
  for (const L of layers) if (depth >= L.depth) unit = L.unit;
  return unit;
}

// 某一方的槽位表（带编号），蓝方由红方 x 镜像得到
function formationSlots(team) {
  const F = config.FORMATION;
  const slots = [];
  let n = 1;
  for (let d = 0; d < F.rows; d++) {
    const x = F.tipX - d;
    const halfW = Math.floor(d * F.widthStep);
    for (let dy = -halfW; dy <= halfW; dy++) {
      slots.push({ n: n++, x: mirrorX(x, team), y: F.tipY + dy, unit: unitForDepth(d) });
    }
  }
  return slots;
}

function buildingCells(team) {
  return config.FORMATION.buildings.map((b) => ({
    x: mirrorX(b.x, team),
    y: b.y,
    unit: b.unit,
  }));
}

function overflowPos(i, team) {
  const o = config.FORMATION.overflow;
  return {
    x: mirrorX(o.x0 + (i % o.width), team),
    y: o.y0 + Math.floor(i / o.width),
  };
}

// 排布（纯函数）：占位表 -> 网格 + 槽位状态
// occupants = { red: Map<槽位号, {playerId,name}>, blue: Map<...> }
// 槽位号超过阵型槽位数的，落到溢出区
function buildBattle(occupants) {
  const grid = new Map();
  const slots = { red: [], blue: [] };

  for (const side of ['red', 'blue']) {
    const team = config.TEAMS[side].team;
    const taken = (occupants && occupants[side]) || new Map();

    for (const b of buildingCells(team)) {
      grid.set(`${b.x},${b.y}`, gidOf(b.unit, team));
    }

    const list = formationSlots(team);
    for (const s of list) {
      const who = taken.get(s.n);
      if (who) grid.set(`${s.x},${s.y}`, gidOf(s.unit, team));
      slots[side].push({
        n: s.n, x: s.x, y: s.y, unit: s.unit,
        filled: !!who, by: who ? who.name : null,
      });
    }

    const maxN = list.length;
    const o = config.FORMATION.overflow;
    let used = 0;
    for (const [n, who] of taken) {
      if (n <= maxN) continue;
      const pos = overflowPos(used++, team);
      grid.set(`${pos.x},${pos.y}`, gidOf(o.unit, team));
      slots[side].push({
        n, x: pos.x, y: pos.y, unit: o.unit,
        filled: true, by: who.name, overflow: true,
      });
    }
  }

  return { grid, slots };
}

function slotCount() {
  return formationSlots(0).length;
}

function packLayer(buf) {
  // Tiled 的 tile layer：uint32 小端 gid 数组 -> gzip -> base64
  return zlib.gzipSync(buf).toString('base64');
}

function encodeLayer(cells) {
  const { MAP_WIDTH: W, MAP_HEIGHT: H } = config;
  const buf = Buffer.alloc(W * H * 4);
  for (const [key, gid] of cells) {
    const [x, y] = key.split(',').map(Number);
    buf.writeUInt32LE(gid, (y * W + x) * 4);
  }
  return packLayer(buf);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 网格 -> tmx 文本
// 图层顺序照官方可玩地图：Ground -> Items -> Units -> Triggers -> set
function buildTmx(grid, opts) {
  const { MAP_WIDTH: W, MAP_HEIGHT: H, TILE_SIZE: T } = config;
  const o = opts || {};
  const ground = new Map();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ground.set(`${x},${y}`, 1);

  const redN = o.redCount || 0;
  const blueN = o.blueCount || 0;
  const intro = `红方 ${redN} 兵 vs 蓝方 ${blueN} 兵 —— 由直播间观众投票生成`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" orientation="orthogonal" renderorder="right-down"
 width="${W}" height="${H}" tilewidth="${T}" tileheight="${T}" nextobjectid="4">

 <tileset firstgid="1" name="Short Grass" tilewidth="${T}" tileheight="${T}"
  tilecount="1" columns="1">
  <image source="terrain/bitmaps/shortgrass.png"/>
 </tileset>

 <tileset firstgid="${config.UNITS_FIRSTGID}" source="units.tsx"/>

 <layer name="Ground" width="${W}" height="${H}">
  <data encoding="base64" compression="gzip">
   ${encodeLayer(ground)}
  </data>
 </layer>

 <layer name="Items" width="${W}" height="${H}">
  <data encoding="base64" compression="gzip">
   ${encodeLayer(new Map())}
  </data>
 </layer>

 <layer name="Units" width="${W}" height="${H}" opacity="0.8">
  <data encoding="base64" compression="gzip">
   ${encodeLayer(grid)}
  </data>
 </layer>

 <objectgroup name="Triggers">
  <object id="1" name="map_info" x="40" y="40" width="200" height="120">
   <properties>
    <property name="fog" value="map"/>
    <property name="introText" value="${esc(intro)}"/>
    <property name="type" value="mission"/>
    <property name="winCondition" value="mainBuilings"/>
   </properties>
  </object>
  <object id="2" name="team_0_info" type="team_info" x="80" y="80" width="160" height="140">
   <properties>
    <property name="team" value="0"/>
    <property name="credits" value="99999"/>
   </properties>
  </object>
  <object id="3" name="team_1_info" type="team_info" x="1080" y="1080" width="160" height="140">
   <properties>
    <property name="team" value="1"/>
    <property name="credits" value="99999"/>
   </properties>
  </object>
 </objectgroup>

 <layer name="set" width="${W}" height="${H}" opacity="0.07">
  <data encoding="base64" compression="gzip">
   ${encodeLayer(new Map())}
  </data>
 </layer>
</map>
`;
}

// 写到 RW 的 mods/maps/ 下，返回完整路径
function writeMapFile(grid, opts) {
  const dir = rwMapsDir();
  if (!fs.existsSync(dir)) throw new Error(`RW 地图目录不存在：${dir}（检查 config.RW_DIR）`);
  const file = path.join(dir, `${config.MAP_FILE}.tmx`);
  fs.writeFileSync(file, buildTmx(grid, opts), 'utf8');
  return file;
}

function unitLabel(key) {
  const t = config.TROOPS.find((x) => x.key === key);
  return t ? t.label : key;
}

module.exports = {
  loadUnitTiles,
  gidOf,
  formationSlots,
  buildingCells,
  buildBattle,
  slotCount,
  buildTmx,
  writeMapFile,
  rwMapsDir,
  unitLabel,
};
