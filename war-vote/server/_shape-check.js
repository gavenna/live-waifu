// 临时：把阵型槽位占满，输出地图用于目视检查形状
const mg = require('./mapGen');

const maxN = mg.slotCount();
const occ = { red: new Map(), blue: new Map() };
for (let i = 1; i <= maxN; i++) {
  occ.red.set(i, { playerId: 'r' + i, name: '红' + i });
  occ.blue.set(i, { playerId: 'b' + i, name: '蓝' + i });
}

const { grid, slots } = mg.buildBattle(occ);
const buildings = mg.buildingCells(0).length * 2;

console.log('每方槽位数:', maxN);
console.log('网格单元:', grid.size, '(期望', maxN * 2 + buildings, ')');
console.log('红方前 6 个槽位:', slots.red.slice(0, 6).map((s) => `${s.n}(${s.x},${s.y},${s.unit})`).join(' '));
console.log('红方末 3 个槽位:', slots.red.slice(-3).map((s) => `${s.n}(${s.x},${s.y},${s.unit})`).join(' '));

const file = mg.writeMapFile(grid, { redCount: maxN, blueCount: maxN });
console.log('已写出:', file);
