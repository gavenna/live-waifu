// war-danmaku 工具箱
var API = 'http://localhost:8760/api';
var DANMAKU_API = 'http://localhost:8767/api';
var ws = null, logPollTimer = null, pollTimer = null, logOffset = 0;

var logFilter = 'all';

function addLogEntry(level, msg) {
  var el = document.getElementById('event-log');
  if (el.querySelector('.log-empty')) el.innerHTML = '';
  var t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  var cls = level === 'ERROR' || level === 'GAME/ERR' ? 'lerr' : level === 'WARN' ? 'lwarn' : '';
  // 根据消息中的 tag 标记来源
  var tag = '';
  if (msg.indexOf('[DOUYIN]') !== -1) tag = 'douyin';
  else if (msg.indexOf('[bilibili]') !== -1) tag = 'bilibili';
  else if (msg.indexOf('[ANNOUNCER]') !== -1) tag = 'announcer';
  else if (msg.indexOf('[ENGINE]') !== -1 || msg.indexOf('[BATTLE]') !== -1 || msg.indexOf('[RANKING]') !== -1 || msg.indexOf('[WS]') !== -1) tag = 'engine';
  var d = document.createElement('div');
  d.className = 'log-entry' + (cls ? ' ' + cls : '') + (tag ? ' tag-' + tag : '');
  d.setAttribute('data-tag', tag);
  d.innerHTML = '<span class="lt">' + t + '</span><span class="lvl">[' + level + ']</span> ' + msg;
  if (logFilter !== 'all' && tag !== logFilter) d.classList.add('hidden');
  el.insertBefore(d, el.firstChild);
  while (el.children.length > 200) el.removeChild(el.lastChild);
}

async function pollLogs() {
  try {
    var res = await fetch(API + '/logs?since=' + logOffset);
    var data = await res.json();
    for (var i = 0; i < data.entries.length; i++) {
      var e = data.entries[i];
      addLogEntry(e.level, e.msg);
      logOffset = Math.max(logOffset, e.seq);
    }
  } catch (e) { /* retry next poll */ }
}

function log(msg, cls) { addLogEntry('INFO', msg); }

// === log filter ===
document.querySelectorAll('.flt-btn').forEach(function(b) {
  b.addEventListener('click', function() {
    document.querySelectorAll('.flt-btn').forEach(function(x) { x.classList.remove('active'); });
    b.classList.add('active');
    logFilter = b.dataset.flt;
    applyLogFilter();
  });
});

function applyLogFilter() {
  document.querySelectorAll('#event-log .log-entry').forEach(function(e) {
    var tag = e.getAttribute('data-tag');
    if (logFilter === 'all' || tag === logFilter) e.classList.remove('hidden');
    else e.classList.add('hidden');
  });
}

// === panel nav ===
document.querySelectorAll('.nav-item').forEach(function(b) {
  b.addEventListener('click', function() {
    document.querySelectorAll('.nav-item,.panel').forEach(function(e) { e.classList.remove('active'); });
    b.classList.add('active');
    document.getElementById('panel-' + b.dataset.panel).classList.add('active');
    if (b.dataset.panel === 'settings') loadConfig();
    if (b.dataset.panel === 'announcer') loadAnnouncer();
    if (b.dataset.panel === 'tools') checkComponents();
  });
});

// === api adapter ===
async function call(path, opts) {
  try {
    var res = await fetch(API + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    var data = await res.json();
    return data;
  } catch (e) {
    log('API 调用失败: ' + path + ' — ' + e.message, 'lerr');
    return { error: e.message };
  }
}

// === status ===
function setUI(state) {
  var ring = document.getElementById('status-ring');
  var main = document.getElementById('status-main-text');
  var sub = document.getElementById('status-sub-text');
  var hdr = document.getElementById('header-status');
  var btnStart = document.getElementById('btn-start');

  ring.className = ''; hdr.className = '';

  if (state === 'running') {
    ring.className = 'ring-on';
    main.textContent = '服务器运行中';
    sub.textContent = '游戏画面: http://localhost:3000';
    hdr.className = 'hdr-on'; hdr.textContent = '● 运行中';
    btnStart.disabled = true;
  } else if (state === 'starting') {
    ring.className = 'ring-starting';
    main.textContent = '正在启动…';
    sub.textContent = '请稍候';
    hdr.className = 'hdr-starting'; hdr.textContent = '◌ 启动中';
    btnStart.disabled = true;
  } else {
    ring.className = 'ring-off';
    main.textContent = '服务器未启动';
    sub.textContent = '点击下方按钮启动';
    hdr.className = 'hdr-off'; hdr.textContent = '● 未启动';
    btnStart.disabled = false;
  }
}

async function pollStatus() {
  var s = await call('/status');
  if (s.error) { log('状态查询失败: ' + s.error, 'lerr'); return; }
  document.getElementById('st-game').textContent = s.game ? '✅' : '⏸';
  document.getElementById('st-frontend').textContent = s.frontend ? '✅' : '⏸';

  // 游戏 event log 中的 relay 连接状态
  if (!s.relayConnected) {
    document.getElementById('st-douyin').textContent = '⏸';
    var blEl = document.getElementById('st-bilibili'); if (blEl) blEl.textContent = '⏸';
  }

  var btn = document.getElementById('btn-start');
  if (s.game) {
    setUI('running');
    btn.textContent = '● 运行中';
    btn.disabled = true;
  } else {
    setUI('offline');
    btn.textContent = '▶ 启动游戏';
    btn.disabled = false;
  }
}

async function pollDanmakuStatus() {
  try {
    var res = await fetch(DANMAKU_API + '/status');
    var s = await res.json();
    document.getElementById('st-douyin').textContent = s.douyin ? '✅' : '⏸';
    if (s.douyin) document.getElementById('btn-douyin').textContent = '📡 停止抖音';
    var blEl = document.getElementById('st-bilibili'); if (blEl) blEl.textContent = s.bilibili ? '✅' : '⏸';
    if (s.bilibili) document.getElementById('btn-bilibili').textContent = '📺 停止B站';
    // 如果 danmaku-relay 未运行，重置按钮状态
    if (s.error) {
      document.getElementById('st-douyin').textContent = '❓';
      document.getElementById('st-bilibili').textContent = '❓';
    }
  } catch (e) { /* danmaku-relay 未启动 */ }
}

// === actions ===
async function startGame() {
  log('▶ 启动游戏…');
  setUI('starting');

  var r = await call('/start-game');
  if (!r.ok) { log('❌ 启动失败: ' + (r.error || '未知'), 'lerr'); setUI('offline'); return; }

  log('✅ 游戏已启动！OBS → http://localhost:3000');
  var btn = document.getElementById('btn-start');
  btn.textContent = '● 运行中';
  btn.disabled = true;
  setUI('running');
  connectWS();
}

async function toggleDouyin() {
  var btn = document.getElementById('btn-douyin');
  // 从 danmaku-relay 获取当前状态
  var s;
  try { var r = await fetch(DANMAKU_API + '/status'); s = await r.json(); } catch (e) { s = {}; }
  if (s.douyin) {
    log('■ 停止抖音…');
    try { await fetch(DANMAKU_API + '/stop-douyin'); } catch (e) {}
    btn.textContent = '📡 启动抖音';
    document.getElementById('st-douyin').textContent = '⏸';
    log('✅ 抖音已停止');
  } else {
    log('📡 启动抖音…');
    try {
      var res = await fetch(DANMAKU_API + '/start-douyin');
      var j = await res.json();
      if (j.ok) {
        log('✅ 抖音代理已启动');
        btn.textContent = '📡 停止抖音';
        document.getElementById('st-douyin').textContent = '✅';
      } else {
        log('❌ 抖音启动失败: ' + (j.error || ''), 'lerr');
      }
    } catch (e) {
      log('❌ 抖音启动失败: danmaku-relay 未运行', 'lerr');
    }
  }
}

async function toggleBilibili() {
  var btn = document.getElementById('btn-bilibili');
  var s;
  try { var r = await fetch(DANMAKU_API + '/status'); s = await r.json(); } catch (e) { s = {}; }
  if (s.bilibili) {
    log('■ 停止B站…');
    try { await fetch(DANMAKU_API + '/stop-bilibili'); } catch (e) {}
    btn.textContent = '📺 启动B站';
    document.getElementById('st-bilibili').textContent = '⏸';
    log('✅ B站已停止');
  } else {
    log('📺 启动B站…');
    try {
      var res = await fetch(DANMAKU_API + '/start-bilibili');
      var j = await res.json();
      if (j.ok) {
        log('✅ B站适配器已启动');
        btn.textContent = '📺 停止B站';
        document.getElementById('st-bilibili').textContent = '✅';
      } else {
        log('❌ B站启动失败: ' + (j.error || ''), 'lerr');
      }
    } catch (e) {
      log('❌ B站启动失败: danmaku-relay 未运行', 'lerr');
    }
  }
}

async function stopAll() {
  log('■ 停止所有服务…');
  await call('/stop');
  try { await fetch(DANMAKU_API + '/stop'); } catch (e) {}
  setUI('offline');
  var btn = document.getElementById('btn-start');
  btn.textContent = '▶ 启动游戏';
  btn.disabled = false;
  document.getElementById('btn-douyin').textContent = '📡 启动抖音';
  document.getElementById('btn-bilibili').textContent = '📺 启动B站';
  if (ws) { ws.close(); ws = null; }
  document.getElementById('st-game').textContent = '⏸';
  document.getElementById('st-frontend').textContent = '⏸';
  document.getElementById('st-douyin').textContent = '⏸';
  document.getElementById('st-bilibili').textContent = '⏸';
  document.getElementById('st-players').textContent = '0';
  log('✅ 已停止');
}

// === WS ===
var wsReconnectTimer = null;

function connectWS() {
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
  if (ws) try { ws.close(); } catch (e) {}
  try {
    ws = new WebSocket('ws://localhost:8765');
    ws.onopen = function() { log('🔗 已连接游戏服务器 WebSocket'); };
    ws.onmessage = function(e) {
      try {
        var m = JSON.parse(e.data);
        if (m.type === 'state') { document.getElementById('st-players').textContent = m.players || 0; }
        if (m.type === 'event') log('📢 ' + (m.text || ''));
      } catch (err) {}
    };
    ws.onclose = function(e) { log('🔌 WS 断连 code=' + e.code + ', 5s 后重试…', 'lwarn'); wsReconnectTimer = setTimeout(connectWS, 5000); };
    ws.onerror = function(e) { log('⚠ WS 错误', 'lerr'); };
  } catch (e) { wsReconnectTimer = setTimeout(connectWS, 5000); }
}

// === settings ===
async function loadConfig() {
  var c = await call('/config');
  if (c.error) { log('⚠ 读取配置失败: ' + c.error, 'lwarn'); return; }
  document.getElementById('cfg-dy-en').checked = (c.douyin && c.douyin.enabled) || false;
  document.getElementById('cfg-dy-room').value = (c.douyin && c.douyin.roomId) || '';
  document.getElementById('cfg-dy-ck').value = (c.douyin && c.douyin.cookie) || '';
  document.getElementById('cfg-bl-room').value = (c.bilibili && c.bilibili.roomId) || '';
  document.getElementById('cfg-bl-ck').value = (c.bilibili && c.bilibili.cookie) || '';
}

async function saveConfig() {
  var c = await call('/config');
  if (c.error) { document.getElementById('cfg-save-msg').textContent = '❌ ' + c.error; return; }

  c.douyin = c.douyin || {};
  c.douyin.enabled = document.getElementById('cfg-dy-en').checked;
  c.douyin.roomId = document.getElementById('cfg-dy-room').value;
  c.douyin.cookie = document.getElementById('cfg-dy-ck').value;

  c.bilibili = c.bilibili || {};
  c.bilibili.roomId = parseInt(document.getElementById('cfg-bl-room').value) || 0;
  c.bilibili.cookie = document.getElementById('cfg-bl-ck').value;

  var r = await call('/config/save', { method: 'POST', body: JSON.stringify(c) });
  var el = document.getElementById('cfg-save-msg');
  if (r.ok) { el.textContent = '✅ 已保存'; setTimeout(function() { el.textContent = ''; }, 2000); }
  else { el.textContent = '❌ ' + (r.error || '保存失败'); }
}

// === tools ===
async function checkComponents() {
  var s = await call('/status');
  document.getElementById('comp-game').textContent = s.game ? '运行中' : '未运行';
  document.getElementById('comp-game').className = 'badge ' + (s.game ? 'badge-ok' : 'badge-idle');
  document.getElementById('comp-douyin').textContent = s.douyin ? '运行中' : '未运行';
  document.getElementById('comp-douyin').className = 'badge ' + (s.douyin ? 'badge-ok' : 'badge-idle');
}

// === misc ===
function openLogsFolder() {
  call('/open-folder?path=server/logs');
}
function closeWindow() {
  call('/stop').then(function() { window.close(); });
}

// === announcer ===
async function loadAnnouncer() {
  var s = await call('/announcer/status');
  document.getElementById('ac-enabled').textContent = s.enabled ? '✅' : '⏸';
  document.getElementById('ac-ws').textContent = s.connected ? '✅' : '❌';
  document.getElementById('ac-queue').textContent = s.queueLength || 0;
  document.getElementById('ac-spoken').textContent = (s.stats && s.stats.spoken) || 0;

  var c = await call('/announcer/config');
  if (c.error) return;
  document.getElementById('ac-enable').checked = c.enabled;
  document.getElementById('ac-dryrun').checked = c.dryRun;
  document.getElementById('ac-trace').value = c.traceLevel || 0;
  document.getElementById('ac-report-iv').value = c.reportInterval || 30000;
  document.getElementById('ac-gift-cd').value = c.giftCooldown || 2000;
  document.getElementById('ac-kill-cd').value = c.killCooldown || 4000;
  document.getElementById('ac-siege-cd').value = c.siegeCooldown || 5000;
  document.getElementById('ac-castle-th').value = c.castleDmgThreshold || 100;
}

async function saveAnnouncer() {
  var body = {
    enabled: document.getElementById('ac-enable').checked,
    dryRun: document.getElementById('ac-dryrun').checked,
    traceLevel: parseInt(document.getElementById('ac-trace').value),
    reportInterval: parseInt(document.getElementById('ac-report-iv').value),
    giftCooldown: parseInt(document.getElementById('ac-gift-cd').value),
    killCooldown: parseInt(document.getElementById('ac-kill-cd').value),
    siegeCooldown: parseInt(document.getElementById('ac-siege-cd').value),
    castleDmgThreshold: parseInt(document.getElementById('ac-castle-th').value),
  };
  await call('/announcer/config', { method: 'POST', body: JSON.stringify(body) });
  log('🎤 话术参数已更新');
}

// === init ===
pollLogs();
logPollTimer = setInterval(pollLogs, 1000);
pollStatus();
pollDanmakuStatus();
pollTimer = setInterval(pollStatus, 3000);
setInterval(pollDanmakuStatus, 3000);
// WS 等用户点击"启动"后才连
