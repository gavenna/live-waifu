/**
 * 一键测试动画效果 — 启动服务端 + 模拟出兵
 * 用法: node server/quicktest-anim.js
 */
const { spawn } = require('child_process');
const WebSocket = require('ws');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

console.log('=== 动画效果快速测试 ===\n');

// 1. 启动服务端
console.log('[1/3] 启动服务端...');
const server = spawn('node', ['server/index.js'], { cwd: ROOT, stdio: 'inherit' });

// 2. 等 3 秒服务端就绪
setTimeout(() => {
  console.log('\n[2/3] 连接 + 出兵...');
  const ws = new WebSocket('ws://localhost:8765');
  let ticks = 0;

  ws.on('open', () => {
    console.log('[OK] 已连接\n');
    ws.send(JSON.stringify({ type: 'join', team: 'red',  playerId: 't1', playerName: 'Red' }));
    ws.send(JSON.stringify({ type: 'join', team: 'blue', playerId: 't2', playerName: 'Blue' }));
    setTimeout(() => ws.send(JSON.stringify({ type: 'admin', action: 'skip_countdown' })), 200);
    setTimeout(() => ws.send(JSON.stringify({ type: 'gift',  troopKey: 'militia', playerId: 't1', playerName: 'Red' })), 500);
    setTimeout(() => ws.send(JSON.stringify({ type: 'gift',  troopKey: 'knight',  playerId: 't1', playerName: 'Red' })), 800);
    setTimeout(() => ws.send(JSON.stringify({ type: 'gift',  troopKey: 'militia', playerId: 't2', playerName: 'Blue' })), 1100);
  });

  ws.on('message', data => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'game_state' && msg.state === 'PLAYING') {
      ticks++;
      const info = (msg.troops || []).map(t => `${t.key}:${t.animState}`).join('  ');
      console.log(`[tick ${ticks}] frontLine=${Math.round(msg.frontLine)}  troops: ${info || '(空)'}`);
      if (ticks >= 8) {
        console.log('\n=== 测试完成 ===');
        console.log('打开 http://localhost:3000 看动画：idle=呼吸缩放 walk=弹跳');
        process.exit(0);
      }
    }
  });

  setTimeout(() => { console.log('超时，请确认 server 已启动'); process.exit(1); }, 20000);
}, 3000);
