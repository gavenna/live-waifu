// mapGen 冒烟测试：阵型槽位 + 镜像 + 溢出 + tmx 生成
// 用法: node server/test-mapgen.js

const fs = require('fs');
const mg = require('./mapGen');
const config = require('./config');

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  PASS  ${name}`);
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

console.log('=== mapGen 冒烟测试 ===');

const N = mg.slotCount();
check('槽位数为正', N > 0, String(N));
console.log(`  每方槽位数: ${N}`);

const occ = { red: new Map(), blue: new Map() };
occ.red.set(1, { playerId: 'a', name: '甲' });
occ.red.set(3, { playerId: 'b', name: '乙' });
occ.blue.set(2, { playerId: 'c', name: '丙' });

const { grid, slots } = mg.buildBattle(occ);
const buildings = config.FORMATION.buildings.length * 2;

check('网格 = 建筑 + 已占槽位', grid.size === buildings + 3,
  `实际 ${grid.size}, 期望 ${buildings + 3}`);
check('红方槽位表完整', slots.red.length === N, `${slots.red.length} vs ${N}`);
check('1 号位已占', slots.red.find((s) => s.n === 1).filled === true);
check('2 号位空着', slots.red.find((s) => s.n === 2).filled === false);
check('记录占位人', slots.red.find((s) => s.n === 1).by === '甲');
check('蓝方独立计数', slots.blue.find((s) => s.n === 2).filled === true
  && slots.blue.find((s) => s.n === 1).filled === false);

let outside = 0;
let dup = 0;
const seen = new Set();
for (const side of ['red', 'blue']) {
  for (const s of slots[side]) {
    if (s.x < 0 || s.x >= config.MAP_WIDTH || s.y < 0 || s.y >= config.MAP_HEIGHT) outside++;
    const k = `${side}:${s.x},${s.y}`;
    if (seen.has(k)) dup++;
    seen.add(k);
  }
}
check('所有槽位在地图内', outside === 0, `${outside} 个越界`);
check('槽位无重叠', dup === 0, `${dup} 个重复`);

const occ2 = { red: new Map([[999, { playerId: 'z', name: '溢出' }]]), blue: new Map() };
const r2 = mg.buildBattle(occ2);
const of = r2.slots.red.find((s) => s.n === 999);
check('超大号落到溢出区', !!of && of.overflow === true, JSON.stringify(of));
check('溢出位仍在红方半场', !!of && of.x < config.MAP_WIDTH / 2);

const symRed = mg.formationSlots(0)[0];
const symBlue = mg.formationSlots(1)[0];
check('蓝方 x 镜像', symBlue.x === config.MAP_WIDTH - 1 - symRed.x,
  `${symBlue.x} vs ${config.MAP_WIDTH - 1 - symRed.x}`);
check('红蓝 y 相同', symBlue.y === symRed.y);

try {
  const file = mg.writeMapFile(grid, { redCount: 2, blueCount: 1 });
  check('tmx 已写入', fs.existsSync(file), file);
  console.log('  文件:', file);
} catch (e) {
  check('tmx 已写入', false, e.message);
}

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
