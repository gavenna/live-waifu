// danmaku-relay 控制面板
var API = '/api';
var pollTimer = null, logPollTimer = null, logOffset = 0;

var logFilter = 'all';

function addLogEntry(level, msg) {
  var el = document.getElementById('event-log');
  if (el.querySelector('.log-empty')) el.innerHTML = '';
  var t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  var cls = level === 'ERROR' ? 'lerr' : level === 'WARN' ? 'lwarn' : '';
  // 根据消息中的 tag 标记来源
  var tag = '';
  if (msg.indexOf('[DOUYIN]') !== -1) tag = 'douyin';
  else if (msg.indexOf('[bilibili]') !== -1) tag = 'bilibili';
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
function setUI(state, activeCount) {
  var ring = document.getElementById('status-ring');
  var main = document.getElementById('status-main-text');
  var sub = document.getElementById('status-sub-text');
  var hdr = document.getElementById('header-status');

  if (state === 'running') {
    ring.className = 'ring-on';
    main.textContent = '弹幕中继运行中';
    sub.textContent = activeCount + ' 个适配器运行中 · 广播: ws://localhost:8766';
    hdr.className = 'hdr-on'; hdr.textContent = '● 运行中';
  } else {
    ring.className = 'ring-off';
    main.textContent = '中继未启动';
    sub.textContent = '点击下方按钮启动';
    hdr.className = 'hdr-off'; hdr.textContent = '● 未启动';
  }
}

async function pollStatus() {
  var s;
  try { var r = await fetch(API + '/status'); s = await r.json(); } catch (e) { s = { error: '中继未运行' }; }
  if (s.error) {
    log('状态查询失败: ' + s.error, 'lerr');
    setUI('offline');
    return;
  }

  document.getElementById('st-douyinlive').textContent = s.douyinLive ? '✅' : '⏸';
  document.getElementById('st-douyin').textContent = s.douyin ? '✅' : '⏸';
  document.getElementById('st-bilibili').textContent = s.bilibili ? '✅' : '⏸';
  document.getElementById('st-subs').textContent = s.subscribers || 0;

  var btnDy = document.getElementById('btn-douyin');
  btnDy.textContent = s.douyin ? '📡 停止抖音' : '📡 启动抖音';
  var btnBl = document.getElementById('btn-bilibili');
  btnBl.textContent = s.bilibili ? '📺 停止B站' : '📺 启动B站';

  var activeCount = (s.douyin ? 1 : 0) + (s.bilibili ? 1 : 0);
  setUI(activeCount > 0 ? 'running' : 'offline', activeCount);
}

// === actions ===
async function startAll() {
  log('▶ 启动全部适配器…');
  var r = await call('/start');
  if (r.error) { log('❌ 启动失败: ' + r.error, 'lerr'); return; }
  log('✅ 抖音: ' + (r.douyin ? 'OK' : '未启用/失败') + ' | B站: ' + (r.bilibili ? 'OK' : '未启用/失败'));
  pollStatus();
}

async function toggleDouyin() {
  var s;
  try { var r = await fetch(API + '/status'); s = await r.json(); } catch (e) { s = {}; }
  if (s.douyin) {
    log('■ 停止抖音…');
    try { await fetch(API + '/stop-douyin'); } catch (e) {}
    log('✅ 抖音已停止');
  } else {
    log('📡 启动抖音…');
    try {
      var res = await fetch(API + '/start-douyin');
      var j = await res.json();
      if (j.adapter) {
        log('✅ 抖音适配器已启动');
      } else {
        log('❌ 抖音启动失败: ' + (j.error || ''), 'lerr');
      }
    } catch (e) {
      log('❌ 抖音启动失败: ' + e.message, 'lerr');
    }
  }
  pollStatus();
}

async function toggleBilibili() {
  var s;
  try { var r = await fetch(API + '/status'); s = await r.json(); } catch (e) { s = {}; }
  if (s.bilibili) {
    log('■ 停止B站…');
    try { await fetch(API + '/stop-bilibili'); } catch (e) {}
    log('✅ B站已停止');
  } else {
    log('📺 启动B站…');
    try {
      var res = await fetch(API + '/start-bilibili');
      var j = await res.json();
      if (j.ok) {
        log('✅ B站适配器已启动');
      } else {
        log('❌ B站启动失败: ' + (j.error || ''), 'lerr');
      }
    } catch (e) {
      log('❌ B站启动失败: ' + e.message, 'lerr');
    }
  }
  pollStatus();
}

async function stopAll() {
  log('■ 停止所有服务…');
  var r = await call('/stop');
  if (r.error) { log('❌ 停止失败: ' + r.error, 'lerr'); return; }
  setUI('offline');
  log('✅ 已停止');
  pollStatus();
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
  if (r.ok) { el.textContent = '✅ 已保存 (重启适配器后生效)'; setTimeout(function() { el.textContent = ''; }, 3000); }
  else { el.textContent = '❌ ' + (r.error || '保存失败'); }
}

// === diagnose ===
async function runDiagnose() {
  var btn = document.getElementById('btn-diag');
  btn.disabled = true; btn.textContent = '🔍 体检中...';
  var r = await call('/diagnose');
  btn.disabled = false; btn.textContent = '🔍 一键体检';

  if (r.error) { log('❌ 体检失败: ' + r.error, 'lerr'); return; }

  document.getElementById('diag-card').style.display = '';
  var sum = document.getElementById('diag-summary');
  sum.textContent = r.summary;
  sum.className = 'diag-summary ' + (r.ok ? 'ok' : 'bad');

  var list = document.getElementById('diag-list');
  list.innerHTML = '';
  r.checks.forEach(function(c) {
    var d = document.createElement('div');
    d.className = 'diag-row ' + (c.ok ? 'pass' : 'fail');
    var html = '<span class="diag-icon">' + (c.ok ? '✅' : '❌') + '</span>' +
               '<span class="diag-name">' + c.name + '</span>' +
               '<span class="diag-detail">' + (c.detail || '') + '</span>';
    if (c.warn) html += '<span class="diag-warn">⚠ ' + c.warn + '</span>';
    d.innerHTML = html;
    list.appendChild(d);
  });

  var fails = r.checks.filter(function(c) { return !c.ok; });
  log(fails.length === 0
    ? '🔍 体检通过: ' + r.summary
    : '🔍 体检发现 ' + fails.length + ' 项异常: ' + fails.map(function(c) { return c.name; }).join(', '),
    fails.length === 0 ? '' : 'lwarn');
}

// === misc ===
function openLogsFolder() {
  call('/open-folder');
}
function closeWindow() {
  window.close();
}

// === init ===
pollLogs();
logPollTimer = setInterval(pollLogs, 1000);
pollStatus();
pollTimer = setInterval(pollStatus, 3000);
