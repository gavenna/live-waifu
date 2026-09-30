/**
 * danmaku-relay 一键端到端测试
 *
 * 用法: node test.js   或   test.bat
 *
 * 覆盖:
 *   1. 服务生命周期 (未运行自动拉起, 结束零残留)
 *   2. 控制面板: 静态页托管 / /api/logs 环形缓冲 / /api/config 读写
 *   3. 弹幕链路: 模拟器(douyin-test.js) → 适配器 → relay → WS 订阅断言
 *   4. 清理还原: secrets.json 备份恢复, 原适配器状态归还
 */

const http = require('http');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

const BASE = __dirname;
const SECRETS = path.join(BASE, 'server', 'secrets.json');
const CTRL_URL = 'http://localhost:8767';
const RELAY_URL = 'ws://localhost:8766';
const SIM_PORT = 12011;

// ====== 基础工具 ======
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function api(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    // agent: false — 每次独立连接, 排除 keep-alive 复用半死连接导致的无响应
    const req = http.request(CTRL_URL + urlPath, { method, timeout: 8000, agent: false }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`响应非 JSON (HTTP ${res.statusCode}): ` + data.slice(0, 200))); }
      });
    });
    const tag = `${method} ${urlPath}`;
    req.on('error', err => reject(new Error(`${tag} 失败: ${err.code || err.message}`)));
    req.on('timeout', () => req.destroy(new Error(`${tag} 超时 (8s 无响应 — 服务端可能卡住或未收到请求)`)));
    if (payload) req.setHeader('Content-Type', 'application/json');
    req.end(payload);
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body }));
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('超时')); });
  });
}

async function waitCtrl(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { await api('GET', '/api/status'); return true; } catch (e) { await sleep(500); }
  }
  return false;
}

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
  });
}

// ====== 断言 ======
let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log(`  ${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? ' — ' + detail : ''}`);
  if (ok) pass++; else fail++;
}

// ====== 全局状态 ======
let serviceProc = null;       // 本脚本拉起的服务进程句柄
let serviceSpawned = false;
let simProc = null;
let simConnected = false;
let secretsBackup = null;
let secretsExisted = false;
let before = null;            // 测试前的服务状态 (清理时归还)

// ====== 测试主体 ======
async function main() {
  console.log('=== danmaku-relay 一键测试 ===');

  // [1] 服务检查
  console.log('[1/7] 服务检查 (:8767)...');
  if (await waitCtrl(1500)) {
    before = await api('GET', '/api/status');
    console.log(`  已在运行 (pid=${before.pid}) — 复用, 结束时还原状态`);
  } else {
    console.log('  未运行 → 自动启动 index.js');
    serviceSpawned = true;
    serviceProc = spawn('node', ['index.js'], { cwd: BASE, stdio: ['ignore', 'pipe', 'pipe'] });
    serviceProc.stdout.on('data', d => String(d).trim().split('\n').filter(Boolean)
      .forEach(l => console.log('  [svc] ' + l)));
    serviceProc.stderr.on('data', d => String(d).trim().split('\n').filter(Boolean)
      .forEach(l => console.log('  [svc] ' + l)));
    if (!await waitCtrl(10000)) throw new Error('服务 10s 内未就绪');
    before = await api('GET', '/api/status');
    console.log('  服务已就绪');
  }

  // [2] 控制面板
  console.log('[2/7] 控制面板验证...');
  const home = await httpGet(CTRL_URL + '/');
  check('静态页 GET /', home.status === 200 && home.type.includes('text/html'), `→ ${home.status}`);
  const css = await httpGet(CTRL_URL + '/style.css');
  check('静态页 /style.css', css.status === 200, `→ ${css.status}`);
  const logs = await api('GET', '/api/logs?since=0');
  check('/api/logs 环形缓冲', Array.isArray(logs.entries) && logs.entries.length > 0,
    `→ ${logs.entries.length} 条`);
  const cfg = await api('GET', '/api/config');
  check('/api/config 读取', cfg.douyin && cfg.bilibili, '→ douyin/bilibili 字段齐全');

  // [3] 配置写入 (顺带验证 /api/config/save)
  console.log('[3/7] 配置写入 → 模拟器地址...');
  secretsExisted = fs.existsSync(SECRETS);
  if (secretsExisted) secretsBackup = fs.readFileSync(SECRETS, 'utf-8');
  const testCfg = {
    bilibili: cfg.bilibili || { roomId: 0, uid: 0, cookie: '', giftMap: {} },
    douyin: { enabled: true, roomId: '888888', proxyUrl: `ws://localhost:${SIM_PORT}`, giftMap: {}, cookie: '' },
  };
  const saved = await api('POST', '/api/config/save', testCfg);
  check('POST /api/config/save', saved.ok === true);
  const cfg2 = await api('GET', '/api/config');
  check('配置读回 (proxyUrl=12011)', cfg2.douyin?.proxyUrl === `ws://localhost:${SIM_PORT}`, `→ ${cfg2.douyin?.proxyUrl}`);
  await api('POST', '/api/stop');   // 清场: 停旧适配器, 避免旧 proxyUrl 残留连接

  // [4] 模拟器
  console.log('[4/7] 启动模拟器 danmaku/douyin-test.js (:12011)...');
  simProc = spawn('node', ['danmaku/douyin-test.js'], { cwd: BASE, stdio: ['pipe', 'pipe', 'inherit'] });
  simProc.stdout.on('data', d => String(d).trim().split('\n').filter(Boolean)
    .forEach(l => {
      if (l.includes('已连接')) simConnected = true;
      console.log('  [sim] ' + l);
    }));
  await sleep(800);
  if (simProc.exitCode !== null) throw new Error('模拟器启动失败 (端口被占?)');
  console.log('  模拟器就绪');

  // [5] 启动抖音适配器 → 等模拟器确认连接
  console.log('[5/7] 启动抖音适配器...');
  const sr = await api('POST', '/api/start-douyin');
  check('适配器 start-douyin', sr.adapter === true, JSON.stringify(sr).slice(0, 80));
  const waitStart = Date.now();
  while (Date.now() - waitStart < 5000) {
    const st = await api('GET', '/api/status');
    if (st.douyin) break;
    await sleep(500);
  }
  const st1 = await api('GET', '/api/status');
  if (!st1.douyin) throw new Error('抖音适配器未就绪');
  while (!simConnected && Date.now() - waitStart < 10000) await sleep(200);
  if (!simConnected) throw new Error('适配器未连上模拟器 (10s 超时)');
  console.log('  适配器已连接模拟器');

  // [6] WS 订阅 + 发送测试事件
  console.log('[6/7] WS 订阅 :8766 并发送测试事件...');
  const msgs = [];
  const ws = new WebSocket(RELAY_URL);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.on('message', d => msgs.push(JSON.parse(d.toString())));

  const cases = [
    { name: 'dm 杀 → danmaku',        cmd: 'dm 杀\n' },
    { name: 'gift 城堡 520 → giant',  cmd: 'gift 城堡 520\n' },
    { name: 'like 100 → 百赞连击',    cmd: 'like 100\n' },
    { name: 'enter → join',           cmd: 'enter\n' },
    { name: 'follow → 关注+民兵',     cmd: 'follow\n' },
  ];
  for (const c of cases) simProc.stdin.write(c.cmd);
  await sleep(3000);   // 等待消息落齐
  ws.close();

  // [7] 断言
  console.log('[7/7] 链路断言:');
  const has = (pred) => msgs.some(pred);
  check("danmaku '杀' (弹幕)", has(m => m.type === 'danmaku' && m.text === '杀'));
  check('gift giant (城堡 520钻)', has(m => m.type === 'gift' && m.troopKey === 'giant'));
  check('danmaku 百赞 (like 100)', has(m => m.type === 'danmaku' && m.text === '杀' && (m.displayText || '').includes('100 连赞')));
  check('join red/blue (进房)', has(m => m.type === 'join' && (m.team === 'red' || m.team === 'blue')));
  check('danmaku 关注文案', has(m => m.type === 'danmaku' && (m.text || '').includes('关注了直播间')));
  check('gift militia (关注奖励)', has(m => m.type === 'gift' && m.troopKey === 'militia' && m.giftName === '关注奖励'));

  console.log(`\n结果: ${pass}/${pass + fail} PASS ${fail > 0 ? '✗ 有失败项!' : '✓ 链路全部通畅'}`);
  if (fail > 0) process.exitCode = 1;
}

// ====== 清理 (无论成败都执行) ======
async function cleanup() {
  console.log('\n清理中...');

  // 1. 停模拟器
  try { if (simProc) simProc.kill(); } catch (e) {}
  // 2. 优雅停适配器 (含 douyinLive.exe 清理)
  try { await api('POST', '/api/stop'); } catch (e) {}

  // 3. 恢复 secrets.json
  if (secretsExisted) fs.writeFileSync(SECRETS, secretsBackup);
  else try { fs.unlinkSync(SECRETS); } catch (e) {}

  // 4. 归还原适配器状态 (测试前在跑的, 重启)
  if (!serviceSpawned && (before?.douyin || before?.bilibili)) {
    try { await api('POST', '/api/start'); console.log('  已重启原适配器 (还原测试前状态)'); } catch (e) {}
  }

  // 5. 关闭本脚本拉起的服务 (句柄优雅杀 → 端口兜底强杀)
  if (serviceSpawned) {
    try { if (serviceProc) serviceProc.kill(); } catch (e) {}
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && (await portOpen(8766) || await portOpen(8767))) await sleep(300);
    if (await portOpen(8766) || await portOpen(8767)) {
      try {
        const st = await api('GET', '/api/status').catch(() => null);
        if (st?.pid) { spawnSync('taskkill', ['/F', '/PID', String(st.pid)], { stdio: 'ignore' }); }
      } catch (e) {}
      console.log('  [warn] 服务未优雅退出, 已强制结束');
    } else {
      console.log('  服务已关闭');
    }
  }
  console.log('清理完成');
}

main()
  .catch(err => { console.log('\n[ERROR] ' + err.message); process.exitCode = 1; })
  .finally(() => cleanup().then(() => process.exit(process.exitCode || 0)));
