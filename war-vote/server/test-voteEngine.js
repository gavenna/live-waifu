// voteEngine 冒烟测试：指令解析 + 抢位规则 + 状态机
// 用法: node server/test-voteEngine.js

const fs = require('fs');
const { VoteEngine, STATE } = require('./voteEngine');
const config = require('./config');
const mg = require('./mapGen');

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  PASS  ${name}`);
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

const e = new VoteEngine();

console.log('=== 指令解析 ===');
check('「红」→ 入红方', e.parse('红') && e.parse('红').kind === 'join');
check('「红5」→ 入红方占 5 号位',
  e.parse('红5') && e.parse('红5').kind === 'join_take' && e.parse('红5').slot === 5);
check('「蓝12」→ 蓝方 12 号位',
  e.parse('蓝12') && e.parse('蓝12').team === 'blue' && e.parse('蓝12').slot === 12);
check('「红方3」→ 长别名也能拆',
  e.parse('红方3') && e.parse('红方3').team === 'red' && e.parse('红方3').slot === 3);
check('「7」→ 纯占位', e.parse('7') && e.parse('7').kind === 'take' && e.parse('7').slot === 7);
check('「0」→ 无效', e.parse('0') === null);
check('「红0」→ 无效', e.parse('红0') === null);
check('无关弹幕 → null', e.parse('主播好帅') === null);

console.log('\n=== 抢位规则 ===');
e.start();
e.handleMessage({ type: 'danmaku', playerId: 'u1', playerName: '甲', text: '红5' });
check('占位成功', e.occupants.red.get(5) && e.occupants.red.get(5).name === '甲');
check('totals 反映占位数', e.snapshot().totals.red === 1);

e.handleMessage({ type: 'danmaku', playerId: 'u2', playerName: '乙', text: '红5' });
check('同一号被抢 → 原占位人保留', e.occupants.red.get(5).name === '甲');
check('抢失败者未占位', e.snapshot().totals.red === 1);

e.handleMessage({ type: 'danmaku', playerId: 'u1', playerName: '甲', text: '红8' });
check('一人只能占一位', e.occupants.red.get(8) === undefined);

e.handleMessage({ type: 'danmaku', playerId: 'u3', playerName: '丙', text: '9' });
check('未入阵营报号被拒',
  e.occupants.red.get(9) === undefined && e.occupants.blue.get(9) === undefined);

e.handleMessage({ type: 'danmaku', playerId: 'u2', playerName: '乙', text: '蓝3' });
check('换阵营释放原槽位并占新位',
  e.occupants.blue.get(3) && e.occupants.blue.get(3).name === '乙');

e.handleMessage({ type: 'danmaku', playerId: 'u4', playerName: '丁', text: '红999' });
check('超大号走溢出区', e.occupants.red.get(999) && e.occupants.red.get(999).name === '丁');

console.log('\n=== 快照 ===');
const snap = e.snapshot();
check('阵型槽位表完整（不含溢出）',
  snap.slots.red.filter((s) => !s.overflow).length === mg.slotCount(),
  `${snap.slots.red.filter((s) => !s.overflow).length} vs ${mg.slotCount()}`);
check('溢出位单独列出', snap.slots.red.some((s) => s.overflow));
check('含 slotTotal', snap.slotTotal === mg.slotCount());
check('含 grid', snap.grid.length > 0, `${snap.grid.length} 格`);
check('滚动条记录槽位号', snap.recentVoters.length > 0 && snap.recentVoters[0].slot === 999);
check('滚动条标记溢出', snap.recentVoters[0].overflow === true);
check('阵型名带出', typeof snap.formationLabel === 'string');

console.log('\n=== 状态机 ===');
e.lock();
check('LOCKED', e.state === STATE.LOCKED);
e.handleMessage({ type: 'danmaku', playerId: 'u9', playerName: '己', text: '红1' });
check('锁票后不再收', e.occupants.red.get(1) === undefined);

(async () => {
  await new Promise((r) => setTimeout(r, config.READY_HOLD_MS + 400));
  check('READY', e.state === STATE.READY);
  check('地图落盘', !!e.lastFile && fs.existsSync(e.lastFile), String(e.lastFile));
  e.reset();
  check('reset 回 IDLE', e.state === STATE.IDLE && e.snapshot().totals.red === 0);

  console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})();
