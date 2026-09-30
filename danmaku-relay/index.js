/**
 * danmaku-relay — 弹幕中继工具
 *
 * 一个 exe 搞定一切：
 *   :8766  WS  (弹幕广播中继，订阅方 = 游戏服务器)
 *   :8767  HTTP (控制面板 API，供游戏工具箱跨进程调用)
 *
 * 用法: node index.js  或  danmaku-relay.exe (双击)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const config = require('./config');
const relay = require('./relay');
const logger = require('./logger');
const battle = require('./battle');
const battleConfig = require('./battle/battleConfig');
// 开局参数（AI 数量/难度/队伍模式/迷雾/初始资金）：从 data/battle-config.json 读全局默认；
// 文件缺失或损坏都回落内置默认，绝不阻断启动。
battleConfig.loadDefaults();

// ====== 路径 ======
const baseDir = __dirname.endsWith('server') ? path.resolve(__dirname, '..') : __dirname;
const dataDir = path.resolve(baseDir, 'data');
const secretsPath = path.join(baseDir, 'server', 'secrets.json');

// ====== 进程管理 ======
let douyinProc = null;

function isRunning(p) { return p && p.exitCode === null; }

function killProc(p) {
  if (!p || p.exitCode !== null) return;
  try { execSync(`taskkill /F /PID ${p.pid} 2>nul`, { stdio: 'ignore' }); } catch (e) {}
}

function getExePath(name) {
  for (const c of [path.join(baseDir, name), path.join(baseDir, 'tools', name)])
    if (fs.existsSync(c)) return c;
  return null;
}

function genDouyinYaml() {
  if (!fs.existsSync(secretsPath)) { logger.warn('no secrets.json, skip douyin yaml gen'); return false; }
  const s = JSON.parse(fs.readFileSync(secretsPath, 'utf-8'));
  const ck = s.douyin?.cookie || '';
  if (!ck) { logger.warn('no douyin cookie, skip yaml gen'); return false; }
  const yp = path.join(baseDir, 'tools', 'douyinLive.yaml');
  const dir = path.dirname(yp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(yp, `port: "1088"\nlog:\n  level: "info"\ncookie:\n  douyin: "${ck}"\n`);
  logger.info(`Generated douyinLive.yaml (cookie ${ck.length} chars)`);
  return true;
}

function spawnDouyin() {
  return new Promise((resolve) => {
    if (isRunning(douyinProc)) { resolve({ ok: true, msg: '已在运行中', pid: douyinProc.pid }); return; }
    const exe = getExePath('douyinLive.exe');
    if (!exe) { resolve({ error: 'douyinLive.exe 未找到' }); return; }
    genDouyinYaml();
    const cfg = path.join(baseDir, 'tools', 'douyinLive.yaml');
    logger.info(`spawn douyin: ${exe} --config ${cfg}`);

    // 捕获 douyinLive 的 stdout/stderr 到日志文件 (原来 stdio:'ignore' 导致内部报错完全不可见)
    const toolsDir = path.join(baseDir, 'tools');
    if (!fs.existsSync(toolsDir)) fs.mkdirSync(toolsDir, { recursive: true });
    const outLog = path.join(toolsDir, 'douyin-stdout.log');
    const errLog = path.join(toolsDir, 'douyin-stderr.log');
    // 每次启动截断旧日志并写入分隔头, 避免无限增长与陈年残留混淆
    let outFd, errFd;
    try {
      outFd = fs.openSync(outLog, 'w');
      errFd = fs.openSync(errLog, 'w');
      const header = `===== douyinLive started ${new Date().toISOString()} =====\n`;
      fs.writeSync(outFd, header);
      fs.writeSync(errFd, header);
    } catch (e) {
      logger.warn(`douyin 日志文件创建失败: ${e.message} (回退 stdio:'ignore')`);
      outFd = errFd = 'ignore';
    }

    const proc = spawn(exe, ['--config', cfg], {
      cwd: baseDir,
      stdio: ['ignore', outFd, errFd],
      detached: true,
    });
    // 父进程不再需要这两个 fd
    try { if (typeof outFd === 'number') fs.closeSync(outFd); } catch (e) {}
    try { if (typeof errFd === 'number') fs.closeSync(errFd); } catch (e) {}

    // 只在"当前引用的进程"退出时清空, 防止旧进程被 taskkill 后的 exit 回调误伤新进程引用
    proc.on('exit', (code) => {
      if (douyinProc === proc) { logger.info(`Douyin exited code=${code}`); douyinProc = null; }
    });
    douyinProc = proc;
    logger.info(`douyinLive 日志: tools/douyin-stdout.log | tools/douyin-stderr.log`);
    resolve({ ok: true, pid: proc.pid });
  });
}

// ====== MIME ======
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json',
};

// ====== 日志环形缓冲 (控制面板 /api/logs 轮询用) ======
const LOG_RING = [];
const LOG_RING_MAX = 500;
let logSeq = 0;

logger.onLog = (level, msg) => {
  const d = new Date();
  const ts = d.toISOString().replace('T', ' ').substring(0, 19);
  LOG_RING.push({ seq: ++logSeq, ts, level, msg });
  if (LOG_RING.length > LOG_RING_MAX) LOG_RING.shift();
};

// ====== 控制面板静态目录 ======
const TOOLBOX_DIR = path.join(baseDir, 'toolbox');

// ====== 控制 HTTP 服务器 (:8767) ======
function startCtrlServer(port) {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
        handleAPI(req, res, body, url);
      });
    } else {
      // 控制面板静态托管 (toolbox/)
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
      const filePath = path.join(TOOLBOX_DIR, rel);
      if (filePath.startsWith(TOOLBOX_DIR) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(fs.readFileSync(filePath));
      } else {
        res.writeHead(404); res.end('Not Found');
      }
    }
  });

  server.listen(port, () => {
    logger.info(`Control API: http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') logger.error(`Ctrl port ${port} 已被占用`);
    else throw err;
  });
}

function sendJSON(res, data, code) {
  res.writeHead(code || 200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// 启动全部适配器 (douyinLive.exe + B站 + 抖音)
async function startAll() {
  const result = { douyin: false, bilibili: false };
  try {
    if (!isRunning(douyinProc)) { const r = await spawnDouyin(); if (r.ok) await sleep(800); }
    require('./danmaku/douyin').start();
    result.douyin = require('./danmaku/douyin').isRunning();
  } catch (e) { logger.error(`抖音启动失败: ${e.message}`); }

  try {
    require('./danmaku/bilibili').start();
    result.bilibili = require('./danmaku/bilibili').isRunning();
  } catch (e) { logger.error(`B站启动失败: ${e.message}`); }

  return result;
}

async function handleAPI(req, res, body, url) {
  try {
    switch (url.pathname) {

      case '/api/status': {
        const douyinMod = require('./danmaku/douyin');
        const bilibiliMod = require('./danmaku/bilibili');
        sendJSON(res, {
          douyin: douyinMod.isRunning(),
          douyinLive: isRunning(douyinProc),
          bilibili: bilibiliMod.isRunning(),
          subscribers: relay.subscriberCount(),
          pid: process.pid,
          douyinPid: douyinProc?.pid || null,
        });
        break;
      }

      case '/api/start': {
        logger.info('START all adapters');
        const r = await startAll();
        sendJSON(res, { ok: true, douyin: r.douyin, bilibili: r.bilibili });
        break;
      }

      case '/api/start-douyin': {
        // exe 缺失不阻塞适配器 — 适配器只依赖 proxyUrl (可指向远程代理或测试模拟器)
        const r = await spawnDouyin();
        if (r.ok) await sleep(800);
        let adapterOk = false;
        try { require('./danmaku/douyin').start(); adapterOk = true; } catch (e) { logger.error(`douyin.start: ${e.message}`); }
        sendJSON(res, { ...r, adapter: adapterOk });
        break;
      }

      case '/api/stop-douyin':
        logger.info('STOP-DOUYIN');
        try { require('./danmaku/douyin').stop(); } catch (e) {}
        killProc(douyinProc); douyinProc = null;
        try { execSync('taskkill /F /IM douyinLive.exe 2>nul', { stdio: 'ignore' }); } catch (e) {}
        sendJSON(res, { ok: true });
        break;

      case '/api/start-bilibili':
        logger.info('START-BILIBILI');
        try { require('./danmaku/bilibili').start(); sendJSON(res, { ok: true }); }
        catch (e) { sendJSON(res, { error: e.message }, 500); }
        break;

      case '/api/stop-bilibili':
        logger.info('STOP-BILIBILI');
        try { require('./danmaku/bilibili').stop(); sendJSON(res, { ok: true }); }
        catch (e) { sendJSON(res, { error: e.message }, 500); }
        break;

      case '/api/stop':
        logger.info('STOP all');
        try { require('./danmaku/douyin').stop(); } catch (e) {}
        try { require('./danmaku/bilibili').stop(); } catch (e) {}
        killProc(douyinProc); douyinProc = null;
        try { execSync('taskkill /F /IM douyinLive.exe 2>nul', { stdio: 'ignore' }); } catch (e) {}
        sendJSON(res, { ok: true });
        break;

      case '/api/logs': {
        const since = parseInt(url.searchParams.get('since')) || 0;
        const entries = LOG_RING.filter(e => e.seq > since);
        sendJSON(res, { entries, latestSeq: logSeq });
        break;
      }

      // 全链路体检 — 一次返回所有关键状态, 免去逐项排查
      case '/api/diagnose': {
        const douyinMod = require('./danmaku/douyin');
        const bilibiliMod = require('./danmaku/bilibili');
        const checks = [];

        // 1) 服务端口
        checks.push({
          name: '中继 WS :8766', ok: true,
          detail: `订阅方 ${relay.subscriberCount()}`
        });
        checks.push({ name: '控制 API :8767', ok: true, detail: `PID ${process.pid}` });

        // 2) 配置文件
        let secrets = {};
        try { secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf-8')); } catch (e) {}
        const dy = secrets.douyin || {};
        checks.push({
          name: 'secrets.json',
          ok: fs.existsSync(secretsPath),
          detail: fs.existsSync(secretsPath) ? '已加载' : '文件不存在'
        });
        checks.push({
          name: '抖音 roomId',
          ok: !!dy.roomId,
          detail: dy.roomId || '未配置'
        });
        checks.push({
          name: '抖音 cookie',
          ok: !!(dy.cookie && dy.cookie.length > 50),
          detail: dy.cookie ? `${dy.cookie.length} 字符` : '未配置',
          warn: dy.cookie && /^\s|\s$|\n/.test(dy.cookie) ? 'cookie 含首尾空白/换行' : null
        });
        checks.push({
          name: '抖音 enabled',
          ok: dy.enabled === true,
          detail: dy.enabled === true ? 'true' : 'false (不会启动)'
        });

        // 3) 进程与握手
        checks.push({
          name: 'douyinLive.exe 进程',
          ok: isRunning(douyinProc),
          detail: isRunning(douyinProc) ? `PID ${douyinProc.pid}` : '未运行'
        });
        checks.push({
          name: '抖音适配器',
          ok: douyinMod.isRunning(),
          detail: douyinMod.isRunning() ? '运行中' : '未运行'
        });
        checks.push({
          name: 'B站适配器',
          ok: bilibiliMod.isRunning(),
          detail: bilibiliMod.isRunning() ? '运行中' : '未配置/未启动'
        });

        // 4) 日志分析 — 从环缓冲提取关键事件
        const msgs = LOG_RING.map(e => e.msg);
        const lastConnect = [...msgs].reverse().find(m => m.includes('[DOUYIN] 已连接 douyinLive'));
        const lastLive = [...msgs].reverse().find(m => m.includes('直播间已开播') || m.includes('直播间未开播'));
        const firstDanmaku = msgs.some(m => m.includes('已收到弹幕数据'));
        const errCount = LOG_RING.filter(e => e.level === 'ERROR').length;

        const isLive = !!(lastLive && lastLive.includes('已开播'));
        checks.push({
          name: 'WS 握手',
          ok: !!lastConnect,
          detail: lastConnect ? '已连接 douyinLive' : '尚未连接'
        });
        checks.push({
          name: '直播间状态',
          ok: isLive,
          detail: lastLive ? lastLive.replace(/^\[DOUYIN\]\s*/, '') : '未知 (未收到状态推送)',
          warn: !isLive && lastConnect ? '链路正常但直播间未开播, 开播后会自动推流' : null
        });
        checks.push({
          name: '弹幕收到过',
          ok: firstDanmaku,
          detail: firstDanmaku ? '是' : '否 (尚无弹幕消息)',
          warn: !firstDanmaku && isLive ? '已开播但未收到弹幕, 检查是否为主播账号自发言' : null
        });

        // 5) 日志文件
        const logFile = path.join(baseDir, 'logs', 'combined.log');
        let logSize = 0;
        try { logSize = fs.statSync(logFile).size; } catch (e) {}
        const dyOut = path.join(baseDir, 'tools', 'douyin-stdout.log');
        const dyErr = path.join(baseDir, 'tools', 'douyin-stderr.log');
        checks.push({
          name: 'combined.log',
          ok: true,
          detail: logSize ? `${(logSize / 1024).toFixed(1)} KB` : '空',
          warn: logSize > 5 * 1024 * 1024 ? '日志偏大, 建议清理' : null
        });
        const stderrTail = (() => {
          try {
            const c = fs.readFileSync(dyErr, 'utf-8').trim().split('\n');
            return c.slice(-3).join(' | ').substring(0, 200);
          } catch (e) { return null; }
        })();
        checks.push({
          name: 'douyinLive stderr',
          ok: !dyErr || true,
          detail: stderrTail || '(无输出)'
        });

        checks.push({
          name: '累计错误',
          ok: errCount === 0,
          detail: `${errCount} 条`,
          warn: errCount > 0 ? '查看面板日志过滤 ERROR' : null
        });

        const passed = checks.filter(c => c.ok).length;
        sendJSON(res, {
          ok: passed === checks.length,
          summary: `${passed}/${checks.length} 项通过`,
          checks,
          logFile,
          douyinStderr: dyErr,
          douyinStdout: dyOut,
        });
        break;
      }

      case '/api/config': {
        let s = {};
        try { s = JSON.parse(fs.readFileSync(secretsPath, 'utf-8')); } catch (e) {}
        sendJSON(res, s);
        break;
      }

      case '/api/config/save': {
        try {
          fs.writeFileSync(secretsPath, JSON.stringify(body, null, 2), 'utf-8');
          // 保存后自动重启在跑的链路, 让新配置立即生效。
          // 旧实现只提示"重启后生效", 但 spawnDouyin 遇运行中进程直接返回, 配置永远不会被应用。
          const douyinMod = require('./danmaku/douyin');
          const bilibiliMod = require('./danmaku/bilibili');
          const restarted = [];
          if (douyinMod.isRunning() || isRunning(douyinProc)) {
            douyinMod.stop();
            killProc(douyinProc); douyinProc = null;
            const r = await spawnDouyin();   // 重新生成 yaml (用新 cookie)
            if (r.ok) await sleep(800);
            douyinMod.start();
            restarted.push('douyin');
          }
          if (bilibiliMod.isRunning()) {
            bilibiliMod.stop();
            bilibiliMod.start();
            restarted.push('bilibili');
          }
          logger.info(`Config saved → 自动重启: ${restarted.join(', ') || '无 (链路未在运行)'}`);
          sendJSON(res, { ok: true, restarted });
        } catch (e) { sendJSON(res, { error: e.message }, 500); }
        break;
      }

      case '/api/open-folder':
        execSync(`explorer "${path.join(baseDir, 'logs')}"`, { stdio: 'ignore' });
        sendJSON(res, { ok: true });
        break;

      // ===== 战斗系统 API =====
      case '/api/battle/start': {
        const ok = await battle.startNewRound(body && body.mapFile);
        sendJSON(res, { ok });
        break;
      }
      case '/api/battle/end': {
        const ok = battle.endCurrentRound('manual');
        sendJSON(res, { ok });
        break;
      }
      case '/api/battle/state': {
        sendJSON(res, battle.round.snapshot());
        break;
      }
      // 外置排行榜（第 3 点）：观众贡献 + 阵营维，直播端 overlay 轮询渲染，与游戏解耦
      case '/api/leaderboard': {
        sendJSON(res, battle.leaderboardSnapshot());
        break;
      }
      case '/api/leaderboard/reset-season': {
        // 开新赛季：清空累计榜并落盘（本轮榜不受影响）
        battle.leaderboard.resetSeason();
        sendJSON(res, { ok: true });
        break;
      }
      // 开局参数（AI 数量/难度/队伍模式/迷雾/初始资金）
      //   GET  → { limits, defaults, next, effective }
      //   POST → body { 字段..., scope: 'default' | 'next' }
      //          default = 存为全局默认（落盘）；next = 只影响下一轮（内存）
      //          越界值一律夹紧后返回，调用方从返回体读实际生效值
      case '/api/battle/config': {
        if (req.method === 'GET') {
          sendJSON(res, {
            limits: battleConfig.LIMITS,
            defaults: battleConfig.defaults,
            next: battleConfig.next,
            effective: battleConfig.effective()
          });
        } else {
          const scope = (body && body.scope) === 'next' ? 'next' : 'default';
          sendJSON(res, Object.assign({ ok: true, scope: scope },
            battleConfig.setConfig(body || {}, scope)));
        }
        break;
      }
      case '/api/battle/kill-game': {
        battle.gameCtrl.killGame();
        sendJSON(res, { ok: true });
        break;
      }
      // 调试通道：游戏侧 Debug Socket 只接受**一个**连接，外部脚本（如
      // 外部脚本（如 _archive/ccresearch-game/live-lab.js）再连 9999 会连上但收不到任何回包（ping 也不回）。
      // 所以把命令借中继已有的那条连接发出去，并回读回包。
      // body: { cmd: 'script ...' | 'function ...', waitMs?: number }
      case '/api/battle/exec': {
        const spawner = battle.spawner;
        const cmd = String(body.cmd || '').trim();
        const waitMs = Math.max(50, Math.min(15000, Number(body.waitMs) || 500));
        if (!cmd) { sendJSON(res, { ok: false, error: 'cmd 为空' }, 400); break; }
        if (!spawner.connected) spawner.connect();
        spawner.drainReplies();                       // 丢掉陈年回包，保证回包对得上本条命令
        const sent = spawner.sendCommand(cmd) === true;
        await sleep(waitMs);
        const replies = spawner.drainReplies();
        logger.info(`[BATTLE][exec] ${cmd} -> sent=${sent} replies=${JSON.stringify(replies)}`);
        sendJSON(res, { ok: sent, cmd, replies });
        break;
      }
      case '/api/battle/simulate-danmaku': {
        // 模拟弹幕消息（测试用）
        const msg = { type: 'danmaku', content: body.content || '红 秃鹰', userId: body.userId || 'test', nickname: body.nickname || '测试' };
        relay.broadcast(msg);
        sendJSON(res, { ok: true, msg });
        break;
      }
      case '/api/battle/simulate-interaction': {
        // 模拟观众事件 —— 走真链路 relay.broadcast → battle.dispatchMessage，便于无真实直播时验收。
        //   body: { type?: 'credits'|'join', source?: 'like'|'follow', team?: 'red'|'blue',
        //           playerId?, nickname? }
        //   credits → handleCredits（按归属加余额）；join → handleJoin（给初始队，不覆盖已有）
        const pid = body.playerId || 'test';
        const name = body.nickname || '测试';
        const msg = body.type === 'join'
          ? { type: 'join', team: body.team === 'blue' ? 'blue' : 'red', playerId: pid, playerName: name }
          : { type: 'credits', source: body.source === 'follow' ? 'follow' : 'like', playerId: pid, playerName: name };
        relay.broadcast(msg);
        sendJSON(res, { ok: true, msg });
        break;
      }
      case '/api/battle/simulate-gift': {
        // 模拟一次送礼 —— 走真链路 relay.broadcast → battle.dispatchMessage → handleGift，
        // 便于无真实礼物时验收「礼物 → 直接召唤一批兵」（2026-09-21 行为变更，不再给该队加余额）。
        //   body: { coinValue?, coinUnit?('diamond'|'gold'), giftName?, playerId?, nickname? }
        const msg = {
          type: 'gift',
          coinValue: Number(body.coinValue) || 0,
          coinUnit: body.coinUnit === 'gold' ? 'gold' : 'diamond',
          giftName: body.giftName || '测试礼物',
          playerId: body.playerId || 'test',
          playerName: body.nickname || '测试',
        };
        relay.broadcast(msg);
        sendJSON(res, { ok: true, msg });
        break;
      }

      default:
        sendJSON(res, { error: 'Unknown API' }, 404);
    }
  } catch (err) {
    logger.error(`API crash: ${err.message}`);
    sendJSON(res, { error: err.message }, 500);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ====== 主入口 ======
async function main() {
  logger.info('===== danmaku-relay START =====');

  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // 弹幕广播中继 (:8766)
  relay.startRelay(config.RELAY_PORT);
  logger.info(`Port :8766 OK (relay WS)`);

  // 战斗系统初始化
  battle.init();
  relay.onDanmaku((msg) => battle.dispatchMessage(msg));
  logger.info('[BATTLE] 弹幕对战系统已接入');

  // 控制 API (:8767)
  startCtrlServer(config.CTRL_PORT);
  logger.info(`Port :8767 OK (ctrl API)`);

  // 适配器不自动启动 — 由工具箱/API 手动控制
  try {
    if (fs.existsSync(secretsPath)) {
      const s = JSON.parse(fs.readFileSync(secretsPath, 'utf-8'));
      const dyReady = !!(s.douyin?.enabled && s.douyin?.roomId);
      const blReady = !!(s.bilibili?.roomId && s.bilibili?.cookie);
      logger.info(`抖音适配器: ${dyReady ? '已配置 (待手动启动)' : '未配置'}`);
      logger.info(`B站适配器: ${blReady ? '已配置 (待手动启动)' : '未配置'}`);
    }
  } catch (e) { logger.error(`配置读取失败: ${e.message}`); }

  logger.info('READY. 弹幕广播 → ws://localhost:8766  |  控制 → http://localhost:8767');

  // 一键启动: node index.js --auto-start → 就绪后自动拉起全部适配器 + 开第一局
  if (process.argv.includes('--auto-start')) {
    const r = await startAll();
    logger.info(`自动启动完成 → douyin: ${r.douyin ? 'OK' : 'FAIL'} | bilibili: ${r.bilibili ? 'OK' : 'FAIL'}`);
    // ★ 完全自动化：就绪后自动开第一局（RW_AUTO_START_ROUND=0 关闭）。
    //   等几秒让适配器/游戏链路稳定；开局成功后由 battle/index.js 的「自动续局」接管后续各局。
    if (String(process.env.RW_AUTO_START_ROUND || '1') !== '0') {
      const delay = (() => {
        const v = parseInt(process.env.RW_AUTO_START_DELAY_MS, 10);
        return Number.isFinite(v) && v >= 0 ? v : 5000;
      })();
      logger.info(`[BATTLE][auto] ${delay}ms 后自动开第一局（RW_AUTO_START_ROUND=0 可关）`);
      setTimeout(() => {
        battle.startNewRound()
          .then((ok) => logger.info(`[BATTLE][auto] 开机自动开第一局 → ${ok ? 'OK' : 'FAIL'}`))
          .catch((e) => logger.error(`[BATTLE][auto] 开机自动开局异常: ${e && e.message}`));
      }, delay);
    }
  }

  process.on('SIGINT', () => {
    logger.info('Shutting down...');
    killProc(douyinProc);
    try { require('./danmaku/douyin').stop(); } catch (e) {}
    try { require('./danmaku/bilibili').stop(); } catch (e) {}
    logger.info('===== STOP =====');
    process.exit(0);
  });
}

main().catch(err => {
  logger.error(`FATAL: ${err.message}`);
  logger.error(err.stack || '');
  process.exit(1);
});
