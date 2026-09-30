// war-vote 直播画面 —— 用游戏原生素材实时渲染观众抢位结果
//
// 素材来自 /rw/*（由服务端映射到游戏的 mods/maps/），与游戏内画面同源。

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

const VIEW_W = 1920;
const VIEW_H = 1080;
canvas.width = VIEW_W;
canvas.height = VIEW_H;

// 切图参数，与 units.tsx 的 tilewidth/spacing/margin/columns 一致
const TILE = 20;
const SHEET_COLS = 9;
const SHEET_SP = 1;
const SHEET_MG = 1;

// UI 位置集中在这里，渲染函数不硬编码坐标
const UI_POS = {
  map: { x: 530, y: 92, size: 860 },
  red: { x: 40, y: 92, w: 420, h: 960 },
  blue: { x: 1460, y: 92, w: 420, h: 960 },
  timer: { x: 960, y: 48 },
  ticker: { x: 40, y: 980, w: 1840, h: 76 },
};

const COLOR = {
  bg: '#0b0f0b',
  panel: 'rgba(12, 18, 12, 0.72)',
  border: 'rgba(255, 255, 255, 0.10)',
  text: '#e8f0e8',
  dim: '#8fa08f',
  red: '#ff5a5a',
  blue: '#5a9bff',
  gold: '#ffd166',
};

const POP_MS = 220;

let state = null;
let mapW = 60;
let mapH = 60;
let cell = 16;
let grassTile = null;
let grassPat = null;
const appearAt = new Map();

const sheet = new Image();
sheet.src = '/rw/bitmaps/units.png';
const grass = new Image();
grass.src = '/rw/terrain/bitmaps/shortgrass.png';

function syncDims() {
  if (!state) return;
  mapW = state.mapW || 60;
  mapH = state.mapH || 60;
  cell = Math.floor(UI_POS.map.size / mapW);
}

function connect() {
  let retry = 1000;
  const open = () => {
    const ws = new WebSocket(`ws://${location.hostname}:8768`);
    ws.onopen = () => { retry = 1000; };
    ws.onmessage = (e) => {
      try {
        state = JSON.parse(e.data);
        syncDims();
      } catch (err) {
        console.error('快照解析失败', err);
      }
    };
    ws.onerror = () => console.warn('WS 异常，将自动重连');
    ws.onclose = () => {
      setTimeout(open, retry);
      retry = Math.min(retry * 2, 30000);
    };
  };
  open();
}

// ===== 绘制 =====

function panel(x, y, w, h, accent) {
  ctx.fillStyle = COLOR.panel;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = COLOR.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, 6, h);
}

function drawMap(now) {
  const { x, y, size } = UI_POS.map;

  if (grass.complete && grass.naturalWidth) {
    if (!grassTile || grassTile.width !== cell) {
      grassTile = document.createElement('canvas');
      grassTile.width = cell;
      grassTile.height = cell;
      const g = grassTile.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(grass, 0, 0, cell, cell);
      grassPat = null;
    }
    if (!grassPat) grassPat = ctx.createPattern(grassTile, 'repeat');
    ctx.fillStyle = grassPat;
    ctx.fillRect(x, y, size, size);
  } else {
    ctx.fillStyle = '#2f4a2a';
    ctx.fillRect(x, y, size, size);
  }

  ctx.strokeStyle = COLOR.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);

  if (!state) return;

  // 1) 空格位画编号 —— 这是观众报数的依据
  if (state.slots) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.max(11, Math.floor(cell * 0.7))}px Consolas, monospace`;
    for (const side of ['red', 'blue']) {
      const accent = side === 'red' ? '#ffc0c0' : '#c0d8ff';
      const bg = side === 'red' ? 'rgba(110,20,20,0.26)' : 'rgba(20,45,95,0.26)';
      for (const s of state.slots[side]) {
        if (s.filled) continue;
        const px = x + s.x * cell;
        const py = y + s.y * cell;
        ctx.fillStyle = s.overflow ? 'rgba(95,75,10,0.5)' : bg;
        ctx.fillRect(px, py, cell, cell);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.82)';
        ctx.strokeText(String(s.n), px + cell / 2, py + cell / 2);
        ctx.fillStyle = s.overflow ? '#ffd166' : accent;
        ctx.fillText(String(s.n), px + cell / 2, py + cell / 2);
      }
    }
    ctx.textBaseline = 'alphabetic';
  }

  // 2) 兵
  if (sheet.complete && state.grid) {
    ctx.imageSmoothingEnabled = false;
    for (const [gx, gy, tileId] of state.grid) {
      const sx = SHEET_MG + (tileId % SHEET_COLS) * (TILE + SHEET_SP);
      const sy = SHEET_MG + Math.floor(tileId / SHEET_COLS) * (TILE + SHEET_SP);
      const dx = x + gx * cell;
      const dy = y + gy * cell;

      const key = gx + ',' + gy;
      if (!appearAt.has(key)) appearAt.set(key, now);
      const k = Math.min(1, (now - appearAt.get(key)) / POP_MS);

      if (k < 1) {
        const w = cell * (0.35 + 0.65 * k);
        const off = (cell - w) / 2;
        ctx.globalAlpha = 0.4 + 0.6 * k;
        ctx.drawImage(sheet, sx, sy, TILE, TILE, dx + off, dy + off, w, w);
        ctx.globalAlpha = 1;
      } else {
        ctx.drawImage(sheet, sx, sy, TILE, TILE, dx, dy, cell, cell);
      }
    }
    ctx.imageSmoothingEnabled = true;
  }
}

function drawSide(p, side) {
  const color = side === 'red' ? COLOR.red : COLOR.blue;
  panel(p.x, p.y, p.w, p.h, color);

  const label = side === 'red' ? '红方' : '蓝方';
  const filled = state ? state.totals[side] : 0;
  const total = state ? state.slotTotal : 0;

  ctx.textAlign = 'left';
  ctx.fillStyle = color;
  ctx.font = 'bold 46px "Microsoft YaHei", sans-serif';
  ctx.fillText(label, p.x + 28, p.y + 68);

  ctx.fillStyle = COLOR.text;
  ctx.font = 'bold 84px "Microsoft YaHei", sans-serif';
  ctx.fillText(String(filled), p.x + 28, p.y + 172);

  ctx.fillStyle = COLOR.dim;
  ctx.font = '30px "Microsoft YaHei", sans-serif';
  ctx.fillText(`/ ${total} 位`, p.x + 40 + ctx.measureText(String(filled)).width * 2.4, p.y + 172);

  // 占位进度条
  const barW = p.w - 56;
  const ratio = total ? Math.min(1, filled / total) : 0;
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(p.x + 28, p.y + 206, barW, 14);
  if (ratio > 0) {
    ctx.fillStyle = color;
    ctx.fillRect(p.x + 28, p.y + 206, barW * ratio, 14);
  }

  ctx.fillStyle = COLOR.dim;
  ctx.font = '24px "Microsoft YaHei", sans-serif';
  ctx.fillText(`剩余 ${Math.max(0, total - filled)} 个位置`, p.x + 28, p.y + 266);

  // 兵种构成（按已占位统计）
  if (!state || !state.slots) return;
  const counts = new Map();
  for (const s of state.slots[side]) {
    if (!s.filled) continue;
    counts.set(s.unit, (counts.get(s.unit) || 0) + 1);
  }
  let ty = p.y + 330;
  ctx.font = '26px "Microsoft YaHei", sans-serif';
  for (const [unit, n] of counts) {
    ctx.fillStyle = COLOR.dim;
    ctx.fillText(unit, p.x + 28, ty);
    ctx.textAlign = 'right';
    ctx.fillStyle = COLOR.text;
    ctx.fillText(String(n), p.x + p.w - 28, ty);
    ctx.textAlign = 'left';
    ty += 42;
    if (ty > p.y + p.h - 40) break;
  }
}

function drawTimer() {
  if (!state) return;
  const t = UI_POS.timer;
  ctx.textAlign = 'center';

  let headline = '';
  let sub = '';
  let color = COLOR.text;

  if (state.state === 'IDLE') {
    headline = '等待开始投票';
    sub = '主播在控制面板点击「开始投票」或「一键演示」';
    color = COLOR.dim;
  } else if (state.state === 'VOTING') {
    const sec = Math.ceil(state.remainingMs / 1000);
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    headline = `${mm}:${ss}`;
    sub = '发「红5」或「蓝12」抢占位置 —— 先到先得，抢完为止';
    color = sec <= 30 ? COLOR.gold : COLOR.text;
  } else if (state.state === 'LOCKED') {
    headline = '投票已锁定';
    sub = '正在生成地图…';
    color = COLOR.gold;
  } else if (state.state === 'READY') {
    headline = '地图已生成';
    sub = '主播请在游戏中：单人游戏 → 自定义地图 → live_battle';
    color = COLOR.gold;
  }

  ctx.fillStyle = color;
  ctx.font = 'bold 56px "Microsoft YaHei", sans-serif';
  ctx.fillText(headline, t.x, t.y);

  ctx.fillStyle = COLOR.dim;
  ctx.font = '23px "Microsoft YaHei", sans-serif';
  ctx.fillText(sub, t.x, t.y + 36);
}

function drawTicker() {
  const t = UI_POS.ticker;
  panel(t.x, t.y, t.w, t.h, 'rgba(255,255,255,0.15)');
  if (!state || !state.recentVoters.length) {
    ctx.textAlign = 'left';
    ctx.fillStyle = COLOR.dim;
    ctx.font = '24px "Microsoft YaHei", sans-serif';
    ctx.fillText('等待观众抢位…', t.x + 24, t.y + 46);
    return;
  }

  ctx.textAlign = 'left';
  ctx.font = '24px "Microsoft YaHei", sans-serif';
  let x = t.x + 24;
  const y = t.y + 46;
  for (const v of state.recentVoters) {
    const text = `${v.name} → ${v.slot} 号位（${v.label}）`;
    const w = ctx.measureText(text).width + 18;
    if (x + w > t.x + t.w - 24) break;
    ctx.fillStyle = v.team === 'red' ? COLOR.red : COLOR.blue;
    ctx.globalAlpha = 0.22;
    ctx.fillRect(x, y - 28, w, 38);
    ctx.globalAlpha = 1;
    ctx.fillText(text, x + 9, y);
    x += w + 12;
  }
}

function frame(now) {
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.textBaseline = 'alphabetic';

  if (state) {
    drawTimer();
    drawMap(now);
    drawSide(UI_POS.red, 'red');
    drawSide(UI_POS.blue, 'blue');
    drawTicker();
  } else {
    ctx.textAlign = 'center';
    ctx.fillStyle = COLOR.dim;
    ctx.font = '40px "Microsoft YaHei", sans-serif';
    ctx.fillText('连接服务中…', VIEW_W / 2, VIEW_H / 2);
  }

  requestAnimationFrame(frame);
}

connect();
requestAnimationFrame(frame);
