/**
 * UI 层渲染 — HUD、排行榜、兵力条、结算画面
 *
 * 绘制到独立的 ui-layer Canvas。
 *
 * ===== 位置微调指南 =====
 * 改下面的 POS 对象即可调整所有 UI 元素位置。
 * 开启调试模式（控制面板 "🔍 调试网格"）可在画面上看到坐标网格和鼠标位置。
 * 按 F12 → 鼠标悬停 → 读坐标 → 改 POS → 刷新 → 看效果。
 */

// ============================================================
//  📐 UI 位置配置 — 所有坐标/尺寸从这里读取
// ============================================================
const _W = 1920, _H = 1080;
const POS = {
  canvas: { w: _W, h: _H },

  // 城堡血条
  castleBar: {
    barW: 320, barH: 24,
    redX: 50,  blueRightMargin: 50,
    y: 65,
    labelY: 52,
    labelRedX: 43,
    labelBlueX: 1861,
  },

  // 双方人数
  players: {
    redX:  571,
    vsX:   960,
    blueX: 1353,
    y: 45,
  },

  // 兵力对比条
  powerBar: { w: 500, h: 8, y: 64 },

  // 状态标签
  stateBadge: { y: 140 },

  // 排行榜
  leaderboard: { x: 1720, y: 164, w: 185, fontSize: 14, lineH: 25 },

  // 弹幕轨道（自底向上）
  danmaku: {
    tracks: [_H - 60, _H - 110, _H - 160],
    maxVisible: 6,
    lifetime: 3000,
    fontSize: 20,
  },

  // 事件播报（顶部大字）
  banner: { startY: 266, lineH: 42, fontSize: 28 },

  // 城堡精灵位置（battle 层）
  castle: {
    redImg:  { x: 10,  y: 524, w: 160, h: 140 },
    blueImg: { x: 1750, y: 518, w: 160, h: 140 },
    hpBar: {
      redX: 45, blueRightX: 1881,
      y: 502, w: 100, h: 8,
    },
    nameY: { red: 679, blue: 676 },
  },

  // 三线战场
  lanes: {
    Y: [390, 575, 760],
    names: ['北境', '王道', '河谷'],
    gateRedX: 285,
    gateBlueX: 1635,
  },

  // 倒计时大数字
  countdown: { y: _H / 2 + 20 },

  // 结算画面
  victory: { y: _H / 2, h: 300 },
};

// ============================================================
//  全局状态
// ============================================================
let showLeaderboard = true;    // 排行榜显示开关
let debugMode = false;         // 调试网格开关
let mouseX = -1, mouseY = -1; // 鼠标坐标（调试用）

// 暴露到全局
window.UI_POS = POS;
window.toggleLeaderboard = () => { showLeaderboard = !showLeaderboard; return showLeaderboard; };
window.toggleDebugMode = () => { debugMode = !debugMode; return debugMode; };
window.isDebugMode = () => debugMode;
window.setMousePos = (x, y) => { mouseX = x; mouseY = y; };

const UI_CONFIG = {
  fontFamily: 'Microsoft YaHei, sans-serif',
  leaderboard: { x: POS.leaderboard.x, y: POS.leaderboard.y, width: POS.leaderboard.w, fontSize: POS.leaderboard.fontSize, lineHeight: POS.leaderboard.lineH, maxItems: 10 },
  castleBar: { width: POS.castleBar.barW, height: POS.castleBar.barH, y: POS.castleBar.y },
};

/**
 * 渲染 UI 层
 */
function renderUI(ctx, state) {
  const W = 1920, H = 1080;
  ctx.clearRect(0, 0, W, H);

  drawCastleBars(ctx, state);
  drawPlayerCount(ctx, state);

  // C7: 兵力对比条
  if (state.state === 'PLAYING') {
    drawPowerBar(ctx, state);
  }

  if (showLeaderboard) {
    drawLeaderboard(ctx, state);
  }
  drawStateBadge(ctx, state);

  // C3: COUNTDOWN 大字倒计时
  if (state.state === 'COUNTDOWN') {
    drawCountdownOverlay(ctx, state);
  }

  // C4: 结算画面
  if (state.state === 'ROUND_END') {
    drawVictoryScreen(ctx, state);
  }

  // 🔍 调试叠加层
  if (debugMode) {
    drawDebugOverlay(ctx, state);
  }
}

/** 城堡血量条 */
function drawCastleBars(ctx, state) {
  const cfg = UI_CONFIG.castleBar;
  const W = 1920;
  const maxHP = state.maxHP || 10000;

  // 红方城堡（左侧）
  const redHP = state.red ? state.red.castleHP : maxHP;
  const redPct = Math.max(0, redHP / maxHP);
  ctx.fillStyle = '#222';
  ctx.fillRect(50, cfg.y, cfg.width, cfg.height);
  // HP 条渐变
  const redGrad = ctx.createLinearGradient(50, 0, 50 + cfg.width, 0);
  redGrad.addColorStop(0, '#CC3333');
  redGrad.addColorStop(1, redPct > 0.3 ? '#FF4444' : '#FF0000');
  ctx.fillStyle = redGrad;
  ctx.fillRect(50, cfg.y, cfg.width * redPct, cfg.height);
  ctx.strokeStyle = '#FF8888';
  ctx.lineWidth = 2;
  ctx.strokeRect(50, cfg.y, cfg.width, cfg.height);

  ctx.fillStyle = '#FFF';
  ctx.font = 'bold 20px ' + UI_CONFIG.fontFamily;
  ctx.textAlign = 'left';
  ctx.fillText('🏰 炎龙帝国', POS.castleBar.labelRedX, POS.castleBar.labelY);
  // HP 数字
  ctx.textAlign = 'center';
  ctx.font = 'bold 14px ' + UI_CONFIG.fontFamily;
  ctx.fillText(Math.round(redHP) + ' / ' + maxHP, 50 + cfg.width / 2, cfg.y + cfg.height + 14);

  // 蓝方城堡（右侧）
  const blueHP = state.blue ? state.blue.castleHP : maxHP;
  const bluePct = Math.max(0, blueHP / maxHP);
  const bx = W - 50 - cfg.width;
  ctx.fillStyle = '#222';
  ctx.fillRect(bx, cfg.y, cfg.width, cfg.height);
  const blueGrad = ctx.createLinearGradient(bx, 0, bx + cfg.width, 0);
  blueGrad.addColorStop(0, bluePct > 0.3 ? '#4488FF' : '#0044FF');
  blueGrad.addColorStop(1, '#3355CC');
  ctx.fillStyle = blueGrad;
  ctx.fillRect(bx + cfg.width * (1 - bluePct), cfg.y, cfg.width * bluePct, cfg.height);
  ctx.strokeStyle = '#8888FF';
  ctx.lineWidth = 2;
  ctx.strokeRect(bx, cfg.y, cfg.width, cfg.height);

  ctx.fillStyle = '#FFF';
  ctx.textAlign = 'right';
  ctx.font = 'bold 20px ' + UI_CONFIG.fontFamily;
  ctx.fillText('🏰 霜狼联盟', POS.castleBar.labelBlueX, POS.castleBar.labelY);
  ctx.textAlign = 'center';
  ctx.font = 'bold 14px ' + UI_CONFIG.fontFamily;
  ctx.fillText(Math.round(blueHP) + ' / ' + maxHP, bx + cfg.width / 2, cfg.y + cfg.height + 14);
}

/** 双方人数 */
function drawPlayerCount(ctx, state) {
  const W = 1920;
  const redCount = state.red ? state.red.playerCount : 0;
  const blueCount = state.blue ? state.blue.playerCount : 0;

  ctx.font = 'bold 28px ' + UI_CONFIG.fontFamily;
  ctx.textAlign = 'center';

  const py = POS.players.y;
  ctx.fillStyle = '#FF6666';
  ctx.fillText(`🔴 炎龙帝国  ${redCount}人`, POS.players.redX, py);

  ctx.fillStyle = '#FFF';
  ctx.fillText('VS', POS.players.vsX, py + 5);

  ctx.fillStyle = '#6699FF';
  ctx.fillText(`${blueCount}人  霜狼联盟 🔵`, POS.players.blueX, py);
}

/** C7: 兵力对比条 */
function drawPowerBar(ctx, state) {
  const W = 1920;
  if (!state.troops || state.troops.length === 0) return;

  let redPower = 0, bluePower = 0;
  for (const t of state.troops) {
    if (t.team === 'red') redPower += (t.maxHp || 0) + (t.damage || 0) * 2;
    else bluePower += (t.maxHp || 0) + (t.damage || 0) * 2;
  }

  const total = redPower + bluePower;
  if (total === 0) return;

  const barW = POS.powerBar.w;
  const barH = POS.powerBar.h;
  const x = W / 2 - barW / 2;
  const y = POS.powerBar.y;

  // 背景
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x - 2, y - 2, barW + 4, barH + 4);

  const redW = barW * (redPower / total);
  const blueW = barW * (bluePower / total);

  ctx.fillStyle = '#FF4444';
  ctx.fillRect(x, y, redW, barH);
  ctx.fillStyle = '#4488FF';
  ctx.fillRect(x + redW, y, blueW, barH);

  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, barW, barH);

  // 标签
  ctx.font = '11px ' + UI_CONFIG.fontFamily;
  ctx.fillStyle = '#AAA';
  ctx.textAlign = 'center';
  ctx.fillText(`兵力对比  🔴${state.troops.filter(t => t.team === 'red').length}兵  🔵${state.troops.filter(t => t.team === 'blue').length}兵`, W / 2, y + barH + 12);
}

/** C5: 增强排行榜 */
function drawLeaderboard(ctx, state) {
  const cfg = UI_CONFIG.leaderboard;
  const lb = state.leaderboard;

  // 背景
  const boxH = cfg.lineHeight * 12 + 10;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(cfg.x, cfg.y - 25, cfg.width, boxH);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.strokeRect(cfg.x, cfg.y - 25, cfg.width, boxH);

  // 标题
  ctx.font = 'bold ' + cfg.fontSize + 'px ' + UI_CONFIG.fontFamily;
  ctx.fillStyle = '#FFD700';
  ctx.textAlign = 'center';
  ctx.fillText('🏆 排行榜', cfg.x + cfg.width / 2, cfg.y);

  if (!lb || !lb.length) {
    ctx.font = cfg.fontSize + 'px ' + UI_CONFIG.fontFamily;
    ctx.fillStyle = '#555';
    ctx.fillText('等待玩家...', cfg.x + cfg.width / 2, cfg.y + cfg.lineHeight * 2);
    return;
  }

  // 段位缩略
  const rankBadges = { '新兵': '⭐', '老兵': '⭐⭐', '十夫长': '🛡', '百夫长': '🛡⭐', '千夫长': '⚔', '将军': '👑', '元帅': '👑⭐' };

  ctx.font = cfg.fontSize + 'px ' + UI_CONFIG.fontFamily;
  for (let i = 0; i < Math.min(lb.length, 10); i++) {
    const p = lb[i];
    const y = cfg.y + cfg.lineHeight * (i + 1);

    // C5: 金银铜色
    if (p.rank === 1) {
      ctx.fillStyle = '#FFD700';
      ctx.font = 'bold ' + cfg.fontSize + 'px ' + UI_CONFIG.fontFamily;
    } else if (p.rank === 2) {
      ctx.fillStyle = '#C0C0C0';
      ctx.font = cfg.fontSize + 'px ' + UI_CONFIG.fontFamily;
    } else if (p.rank === 3) {
      ctx.fillStyle = '#CD7F32';
      ctx.font = cfg.fontSize + 'px ' + UI_CONFIG.fontFamily;
    } else {
      ctx.fillStyle = '#AAA';
      ctx.font = cfg.fontSize + 'px ' + UI_CONFIG.fontFamily;
    }

    ctx.textAlign = 'left';
    const rankIcon = p.rank <= 3 ? ['🥇', '🥈', '🥉'][p.rank - 1] : `#${p.rank}`;
    ctx.fillText(rankIcon, cfg.x + 3, y);

    // 玩家名（截断）
    const name = (p.name || p.id || '').slice(0, 8);
    ctx.fillText(name, cfg.x + 38, y);

    // 分数
    ctx.textAlign = 'right';
    ctx.fillStyle = '#FFD700';
    ctx.fillText((p.score || 0) + '', cfg.x + cfg.width - 5, y);
  }
}

/** 游戏状态标签 */
function drawStateBadge(ctx, state) {
  const W = 1920;
  const s = state.state || 'WAITING';
  let text, color;

  switch (s) {
    case 'WAITING':   text = '等待开播'; color = '#888'; break;
    case 'COUNTDOWN': text = '⚔ 准备开战'; color = '#FFD700'; break;
    case 'PLAYING':   text = '⚔ 战斗中'; color = '#FF4444'; break;
    case 'ROUND_END': text = ''; color = '#44FF44'; break; // 用独立的结算画面替代
    default: text = s; color = '#888';
  }

  if (!text) return;

  const x = W / 2, y = POS.stateBadge.y;
  ctx.font = 'bold 36px ' + UI_CONFIG.fontFamily;
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);

  // Round 信息
  if (state.round) {
    ctx.font = '16px ' + UI_CONFIG.fontFamily;
    ctx.fillStyle = '#777';
    ctx.fillText('Round ' + state.round, x, y + 28);
  }

  // 计时
  if (state.phaseTotal > 0) {
    const elapsed = state.phaseElapsed || 0;
    const remain = Math.max(0, state.phaseTotal - elapsed);
    const sec = Math.ceil(remain / 1000);
    const min = Math.floor(sec / 60);
    const rs = sec % 60;
    const timeStr = min > 0 ? `${min}:${String(rs).padStart(2, '0')}` : `${rs}s`;
    ctx.font = '15px ' + UI_CONFIG.fontFamily;
    ctx.fillStyle = '#999';
    ctx.fillText(timeStr, x, y + 48);
  }

  // DEV_MODE 标识
  if (state.devMode) {
    ctx.font = '11px ' + UI_CONFIG.fontFamily;
    ctx.fillStyle = '#F0F040';
    ctx.fillText('🔧 DEV MODE', W / 2, y + 68);
  }
}

/** C3: COUNTDOWN 倒计时大字 */
function drawCountdownOverlay(ctx, state) {
  const W = 1920, H = 1080;
  if (!state.phaseTotal) return;

  const elapsed = state.phaseElapsed || 0;
  const remain = Math.max(0, state.phaseTotal - elapsed);
  const sec = Math.ceil(remain / 1000);

  if (sec <= 5 && sec > 0) {
    const alpha = 1 - (remain % 1000) / 1000 * 0.3;
    ctx.font = 'bold 120px ' + UI_CONFIG.fontFamily;
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(255,215,0,${alpha})`;
    ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
    ctx.lineWidth = 5;
    const text = sec + '';
    ctx.strokeText(text, W / 2, POS.countdown.y);
    ctx.fillText(text, W / 2, POS.countdown.y);
  } else if (sec === 0) {
    ctx.font = 'bold 64px ' + UI_CONFIG.fontFamily;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFD700';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    ctx.strokeText('开战！', W / 2, POS.countdown.y - 40);
    ctx.fillText('开战！', W / 2, POS.countdown.y - 40);
  }
}

/** C4: 结算画面 */
function drawVictoryScreen(ctx, state) {
  const W = 1920, H = 1080;
  const redHP = state.red ? state.red.castleHP : 0;
  const blueHP = state.blue ? state.blue.castleHP : 0;

  let winnerText, winnerColor;
  if (redHP > blueHP) {
    winnerText = '🔥 炎龙帝国 胜利！';
    winnerColor = '#FF4444';
  } else if (blueHP > redHP) {
    winnerText = '❄ 霜狼联盟 胜利！';
    winnerColor = '#4488FF';
  } else {
    winnerText = '⚖ 平局';
    winnerColor = '#AAA';
  }

  // 半透明背景
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, POS.victory.y - POS.victory.h / 2, W, POS.victory.h);

  // 胜利文字
  ctx.font = 'bold 64px ' + UI_CONFIG.fontFamily;
  ctx.textAlign = 'center';
  ctx.fillStyle = winnerColor;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 4;
  ctx.strokeText(winnerText, W / 2, POS.victory.y - 40);
  ctx.fillText(winnerText, W / 2, POS.victory.y - 40);

  // 比分
  ctx.font = 'bold 32px ' + UI_CONFIG.fontFamily;
  ctx.fillStyle = '#FFF';
  ctx.fillText(`炎龙 ${Math.round(redHP)} HP  vs  ${Math.round(blueHP)} HP 霜狼`, W / 2, POS.victory.y + 25);

  // MVP
  const lb = state.leaderboard;
  if (lb && lb.length > 0) {
    ctx.font = '22px ' + UI_CONFIG.fontFamily;
    ctx.fillStyle = '#FFD700';
    ctx.fillText(`🏆 MVP: ${lb[0].name || lb[0].id}  (${lb[0].score}分)`, W / 2, POS.victory.y + 65);
  }

  // 倒计时到下一局
  if (state.phaseTotal) {
    const elapsed = state.phaseElapsed || 0;
    const remain = Math.max(0, state.phaseTotal - elapsed);
    const sec = Math.ceil(remain / 1000);
    ctx.font = '18px ' + UI_CONFIG.fontFamily;
    ctx.fillStyle = '#888';
    ctx.fillText(`下一局将在 ${sec} 秒后开始...`, W / 2, POS.victory.y + 100);
  }
}

// 导出
window.renderUI = renderUI;

// ============================================================
//  🔍 调试叠加层 — 网格 + 鼠标坐标 + 元素边界
// ============================================================
function drawDebugOverlay(ctx, state) {
  const W = _W, H = _H;
  // -- 网格线（每 100px） --
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= W; x += 100) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y <= H; y += 100) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // -- 主网格线（每 500px，更明显） --
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 500) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    // 标 X 坐标
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(x + '', x, 12);
  }
  for (let y = 100; y <= H; y += 500) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText(y + '', 24, y - 2);
  }

  // -- 中轴线 --
  ctx.strokeStyle = 'rgba(255,255,0,0.4)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 4]);
  ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,255,0,0.6)';
  ctx.font = 'bold 12px monospace';
  ctx.fillText('CENTER ' + W / 2, W / 2 + 10, H - 10);

  // -- 关键 UI 区域边界框 --
  const boxes = [
    // 城堡血条
    { label: '红方血条', x: POS.castleBar.redX, y: POS.castleBar.y,
      w: POS.castleBar.barW, h: POS.castleBar.barH, color: 'rgba(255,80,80,0.5)' },
    { label: '蓝方血条', x: W - POS.castleBar.blueRightMargin - POS.castleBar.barW,
      y: POS.castleBar.y, w: POS.castleBar.barW, h: POS.castleBar.barH, color: 'rgba(80,80,255,0.5)' },
    // 排行榜
    { label: '排行榜', x: POS.leaderboard.x, y: POS.leaderboard.y - 25,
      w: POS.leaderboard.w, h: POS.leaderboard.lineH * 12 + 10, color: 'rgba(255,215,0,0.4)' },
    // 兵力条
    { label: '兵力条', x: W / 2 - POS.powerBar.w / 2, y: POS.powerBar.y,
      w: POS.powerBar.w, h: POS.powerBar.h, color: 'rgba(255,255,255,0.4)' },
    // 人数
    { label: '红方人数', x: POS.players.redX - 100, y: POS.players.y - 28,
      w: 200, h: 34, color: 'rgba(255,80,80,0.3)' },
    { label: '蓝方人数', x: POS.players.blueX - 100, y: POS.players.y - 28,
      w: 200, h: 34, color: 'rgba(80,80,255,0.3)' },
    // 状态标识
    { label: '状态徽章', x: W / 2 - 120, y: POS.stateBadge.y - 8,
      w: 240, h: 80, color: 'rgba(255,255,255,0.3)' },
    // 事件播报
    { label: '事件播报区', x: W / 2 - 300, y: POS.banner.startY - 30,
      w: 600, h: 200, color: 'rgba(255,200,100,0.3)' },
    // 结算画面
    { label: '结算画面', x: 0, y: POS.victory.y - POS.victory.h / 2,
      w: W, h: POS.victory.h, color: 'rgba(100,255,100,0.3)' },
  ];

  for (const box of boxes) {
    ctx.strokeStyle = box.color;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 2]);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.setLineDash([]);

    // 标签
    ctx.fillStyle = box.color.replace('0.', '0.').replace(/[0-9.]+\)$/, '0.7)');
    // Handle both rgb and rgba
    const alphaMatch = box.color.match(/[\d.]+\)$/);
    if (alphaMatch) {
      ctx.fillStyle = box.color.replace(/[\d.]+\)$/, '0.8)');
    }
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(box.label, box.x + 3, box.y - 4);
  }

  // -- 鼠标坐标（右下角大字） --
  if (mouseX >= 0 && mouseY >= 0) {
    const coordText = `🖱 X:${Math.round(mouseX)}  Y:${Math.round(mouseY)}`;
    const tw = ctx.measureText(coordText).width;

    // 背景
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(W - tw - 30, H - 40, tw + 20, 30);

    // 坐标文字
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#0F0';
    ctx.fillText(coordText, W - 16, H - 18);

    // 十字准星
    ctx.strokeStyle = 'rgba(0,255,0,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(mouseX, 0); ctx.lineTo(mouseX, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, mouseY); ctx.lineTo(W, mouseY); ctx.stroke();
    ctx.setLineDash([]);
  }

  // -- 拖拽手柄 --
  for (const d of DRAGGABLES) {
    const anchor = d.anchor(POS);
    const isHovered = dragHover === d;
    const isDragging = dragTarget === d;
    const hs = isDragging ? 10 : 7;
    ctx.fillStyle = isDragging ? 'rgba(0,255,0,0.9)' : isHovered ? 'rgba(255,255,0,0.8)' : 'rgba(255,255,255,0.4)';
    ctx.fillRect(anchor.x - hs, anchor.y - hs, hs * 2, hs * 2);
    ctx.strokeStyle = isDragging ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(anchor.x - hs + 2, anchor.y); ctx.lineTo(anchor.x + hs - 2, anchor.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y - hs + 2); ctx.lineTo(anchor.x, anchor.y + hs - 2); ctx.stroke();
    ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#FFF';
    ctx.fillText(d.label, anchor.x, anchor.y - hs - 4);
    if (isDragging && dragNewVal !== null) {
      const axisLabel = dragAxis === 'x' ? '←→ X' : dragAxis === 'y' ? '↕ Y' : '…';
      const vt = d.label + ' ' + axisLabel + ' ' + Math.round(dragAxis === 'x' ? dragNewVal.x : dragNewVal.y);
      ctx.font = 'bold 12px monospace';
      const tw = ctx.measureText(vt).width;
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(anchor.x - tw / 2 - 6, anchor.y + hs + 4, tw + 12, 18);
      ctx.fillStyle = '#0F0';
      ctx.fillText(vt, anchor.x, anchor.y + hs + 17);
    }
  }
}

// ============================================================
//  🖱 拖拽调参 — 调试模式下拖手柄实时改 POS
// ============================================================

function posGet(path) { let o = POS; for (const k of path) o = o[k]; return o; }
function posSet(path, val) { if (!path) return; let o = POS; for (let i = 0; i < path.length - 1; i++) o = o[path[i]]; o[path[path.length - 1]] = val; }

// 每个手柄: label, xPath(可null=只跟Y), yPath, anchor
const DRAGGABLES = [
  // ── battle 层 · 城堡精灵图 ──
  { label: '红城堡图',  xPath: ['castle', 'redImg', 'x'],   yPath: ['castle', 'redImg', 'y'],
    anchor: (p) => ({ x: p.castle.redImg.x + p.castle.redImg.w / 2, y: p.castle.redImg.y + p.castle.redImg.h / 2 }) },
  { label: '蓝城堡图',  xPath: ['castle', 'blueImg', 'x'],  yPath: ['castle', 'blueImg', 'y'],
    anchor: (p) => ({ x: p.castle.blueImg.x + p.castle.blueImg.w / 2, y: p.castle.blueImg.y + p.castle.blueImg.h / 2 }) },
  // ── battle 层 · 小血条 ──
  { label: '红小血条',  xPath: ['castle', 'hpBar', 'redX'], yPath: ['castle', 'hpBar', 'y'],
    anchor: (p) => ({ x: p.castle.hpBar.redX + p.castle.hpBar.w / 2, y: p.castle.hpBar.y + p.castle.hpBar.h / 2 }) },
  { label: '蓝小血条',  xPath: ['castle', 'hpBar', 'blueRightX'], yPath: ['castle', 'hpBar', 'y'],
    anchor: (p) => ({ x: p.castle.hpBar.blueRightX - p.castle.hpBar.w / 2, y: p.castle.hpBar.y + p.castle.hpBar.h / 2 }) },
  // ── battle 层 · 城堡名 ──
  { label: '红城堡名',  xPath: null, yPath: ['castle', 'nameY', 'red'],
    anchor: (p) => ({ x: p.castle.hpBar.redX + p.castle.hpBar.w / 2, y: p.castle.nameY.red }) },
  { label: '蓝城堡名',  xPath: null, yPath: ['castle', 'nameY', 'blue'],
    anchor: (p) => ({ x: p.castle.hpBar.blueRightX - p.castle.hpBar.w / 2, y: p.castle.nameY.blue }) },
  // ── UI 层 · 大血条 ──
  { label: '红大血条',  xPath: ['castleBar', 'redX'], yPath: ['castleBar', 'y'],
    anchor: (p) => ({ x: p.castleBar.redX + p.castleBar.barW / 2, y: p.castleBar.y + p.castleBar.barH / 2 }) },
  { label: '蓝大血条',  xPath: ['castleBar', 'blueRightMargin'], yPath: ['castleBar', 'y'],
    anchor: (p) => ({ x: _W - p.castleBar.blueRightMargin - p.castleBar.barW / 2, y: p.castleBar.y + p.castleBar.barH / 2 }) },
  { label: '红血条标签',  xPath: ['castleBar', 'labelRedX'], yPath: ['castleBar', 'labelY'],
    anchor: (p) => ({ x: p.castleBar.labelRedX, y: p.castleBar.labelY }) },
  { label: '蓝血条标签',  xPath: ['castleBar', 'labelBlueX'], yPath: ['castleBar', 'labelY'],
    anchor: (p) => ({ x: p.castleBar.labelBlueX, y: p.castleBar.labelY }) },
  // ── UI 层 · 阵营人数 ──
  { label: '红方人数',  xPath: ['players', 'redX'],  yPath: ['players', 'y'],
    anchor: (p) => ({ x: p.players.redX, y: p.players.y }) },
  { label: '蓝方人数',  xPath: ['players', 'blueX'], yPath: ['players', 'y'],
    anchor: (p) => ({ x: p.players.blueX, y: p.players.y }) },
  // ── UI 层 · 兵力条 ──
  { label: '兵力条',    xPath: null, yPath: ['powerBar', 'y'],
    anchor: (p) => ({ x: _W / 2 + p.powerBar.w / 2 + 10, y: p.powerBar.y }) },
  // ── UI 层 · 排行榜 ──
  { label: '排行榜',    xPath: ['leaderboard', 'x'], yPath: ['leaderboard', 'y'],
    anchor: (p) => ({ x: p.leaderboard.x, y: p.leaderboard.y }) },
  // ── UI 层 · 状态/倒计时/结算 ──
  { label: '状态徽章',  xPath: null, yPath: ['stateBadge', 'y'],
    anchor: (p) => ({ x: _W / 2 + 130, y: p.stateBadge.y }) },
  { label: '事件播报',  xPath: null, yPath: ['banner', 'startY'],
    anchor: (p) => ({ x: _W / 2, y: p.banner.startY }) },
  { label: '倒计时',    xPath: null, yPath: ['countdown', 'y'],
    anchor: (p) => ({ x: _W / 2, y: p.countdown.y }) },
  { label: '结算画面',  xPath: null, yPath: ['victory', 'y'],
    anchor: (p) => ({ x: _W / 2, y: p.victory.y - p.victory.h / 2 + 20 }) },
  // ── 弹幕层 · 轨道 ──
  { label: '弹幕轨1',   xPath: null, yPath: ['danmaku', 'tracks', 0],
    anchor: (p) => ({ x: 20, y: p.danmaku.tracks[0] }) },
  { label: '弹幕轨2',   xPath: null, yPath: ['danmaku', 'tracks', 1],
    anchor: (p) => ({ x: 20, y: p.danmaku.tracks[1] }) },
  { label: '弹幕轨3',   xPath: null, yPath: ['danmaku', 'tracks', 2],
    anchor: (p) => ({ x: 20, y: p.danmaku.tracks[2] }) },
];

let dragTarget = null, dragHover = null, dragNewVal = null, dragStartVal = null;
let dragStartMouse = null, dragAxis = null; // 方向锁定

function canvasCoords(e) {
  const canvas = document.getElementById('ui-layer');
  if (!canvas) return { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (1920 / rect.width),
    y: (e.clientY - rect.top) * (1080 / rect.height),
  };
}

function findHandle(cx, cy) {
  let best = null, bestDist = 14;
  for (const d of DRAGGABLES) {
    const a = d.anchor(POS);
    const dist = Math.hypot(cx - a.x, cy - a.y);
    if (dist < bestDist) { bestDist = dist; best = d; }
  }
  return best;
}

function onDragStart(e) {
  if (!debugMode) return;
  const { x, y } = canvasCoords(e);
  dragTarget = findHandle(x, y);
  if (dragTarget) {
    e.preventDefault();
    dragStartMouse = { x, y };
    dragAxis = null; // 待判定方向
    dragStartVal = { x: dragTarget.xPath ? posGet(dragTarget.xPath) : null, y: posGet(dragTarget.yPath) };
    dragNewVal = { x: Math.round(x), y: Math.round(y) };
  }
}

function onDragMove(e) {
  if (!dragTarget) {
    if (debugMode) { const c = canvasCoords(e); dragHover = findHandle(c.x, c.y); }
    return;
  }
  e.preventDefault();
  const { x, y } = canvasCoords(e);
  dragNewVal = { x: Math.round(x), y: Math.round(y) };

  // 方向锁定：移动超过5px后判定主方向，之后只跟该轴
  if (dragAxis === null) {
    const dx = Math.abs(x - dragStartMouse.x);
    const dy = Math.abs(y - dragStartMouse.y);
    if (dx > 5 || dy > 5) {
      dragAxis = dx > dy ? 'x' : 'y';
    }
    return; // 还在判定中，不更新
  }

  if (dragAxis === 'x' && dragTarget.xPath) {
    posSet(dragTarget.xPath, Math.round(x));
  } else if (dragAxis === 'y') {
    posSet(dragTarget.yPath, Math.round(y));
  }
}

function onDragEnd(e) {
  if (!dragTarget) return;
  const info = [];
  if (dragTarget.xPath && dragAxis === 'x') info.push('X:' + dragStartVal.x + '→' + dragNewVal.x);
  if (dragAxis === 'y') info.push('Y:' + dragStartVal.y + '→' + dragNewVal.y);
  if (!dragAxis) info.push('(未移动)');
  console.log('📍 拖拽: ' + dragTarget.label + '  ' + info.join('  '));
  dragTarget = null; dragNewVal = null; dragAxis = null; dragStartMouse = null;
}

(function initDrag() {
  const canvas = document.getElementById('ui-layer');
  if (!canvas) { setTimeout(initDrag, 200); return; }
  canvas.addEventListener('mousedown', onDragStart);
  canvas.addEventListener('mousemove', onDragMove);
  canvas.addEventListener('mouseup', onDragEnd);
  canvas.addEventListener('mouseleave', onDragEnd);
  console.log('[UI] 拖拽系统就绪 — ' + DRAGGABLES.length + ' 个手柄');
})();