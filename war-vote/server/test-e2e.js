// 端到端测试：假弹幕中继 → war-vote → 生成地图
// 用法: node server/test-e2e.js     （需要 8766 / 8768 / 3001 端口空闲）

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const config = require('./config');

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  PASS  ${name}`);
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portBusy(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(true));
    s.once('listening', () => s.close(() => resolve(false)));
    s.listen(port, '127.0.0.1');
  });
}

function api(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: config.WS_PORT, path: pathname }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

let child = null;
let relay = null;

async function cleanup() {
  if (child) child.kill();
  if (relay) await new Promise((r) => relay.close(r));
}

(async () => {
  console.log('=== war-vote 端到端测试 ===');

  const relayPortBusy = await portBusy(8766);
  if (relayPortBusy) {
    console.log('  8766 已被占用（danmaku-relay 正在跑？）—— 请先停掉再测');
    process.exit(2);
  }

  relay = new WebSocket.Server({ port: 8766 });
  let relayConnected = false;
  let relayWs = null;

  relay.on('connection', (ws) => {
    relayConnected = true;
    relayWs = ws;
  });

  // 灌 30 条弹幕 —— 必须在投票开始之后调用，IDLE 状态的弹幕会被引擎有意忽略
  function flood() {
    const teams = ['红', '蓝'];
    const names = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛'];
    for (let i = 0; i < 30; i++) {
      setTimeout(() => {
        if (!relayWs || relayWs.readyState !== WebSocket.OPEN) return;
        relayWs.send(JSON.stringify({
          type: 'danmaku',
          playerId: 'u' + (i + 1),
          playerName: names[i % names.length] + (i + 1),
          text: teams[i % 2] + String((i % 8) + 1),
        }));
      }, i * 40);
    }
  }

  child = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write('  [svc] ' + d));
  child.stderr.on('data', (d) => process.stdout.write('  [svc:err] ' + d));

  await sleep(1200);
  check('war-vote 已连上弹幕中继', relayConnected);

  const s0 = await api('/api/state');
  check('初始状态 IDLE', s0.snapshot.state === 'IDLE', s0.snapshot.state);

  await api('/api/start');
  const s1 = await api('/api/state');
  check('开始后进入 VOTING', s1.snapshot.state === 'VOTING', s1.snapshot.state);

  flood();
  await sleep(1800);   // 等 30 条弹幕灌完
  const s2 = await api('/api/state');
  const total = s2.snapshot.totals.red + s2.snapshot.totals.blue;
  check('收到 30 票', total === 30, `实际 ${total}`);
  check('双方都有票', s2.snapshot.totals.red > 0 && s2.snapshot.totals.blue > 0);
  check('快照带 grid', s2.snapshot.grid.length > 0, `${s2.snapshot.grid.length} 格`);
  check('快照带兵种表', Array.isArray(s2.snapshot.troops) && s2.snapshot.troops.length === 8);
  check('有投票人滚动', s2.snapshot.recentVoters.length > 0);

  await api('/api/lock');
  const s3 = await api('/api/state');
  check('锁定后进入 LOCKED', s3.snapshot.state === 'LOCKED', s3.snapshot.state);

  await sleep(config.READY_HOLD_MS + 800);
  const s4 = await api('/api/state');
  check('生成后进入 READY', s4.snapshot.state === 'READY', s4.snapshot.state);
  check('地图文件存在', !!s4.snapshot.lastFile && fs.existsSync(s4.snapshot.lastFile));
  console.log('  地图:', s4.snapshot.lastFile);

  await api('/api/reset');
  const s5 = await api('/api/state');
  check('重置回 IDLE', s5.snapshot.state === 'IDLE' && s5.snapshot.totals.red === 0);

  await cleanup();
  console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('测试异常：', e);
  await cleanup();
  process.exit(1);
});
