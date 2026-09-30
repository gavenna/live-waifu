/**
 * 兵种精灵绘制
 *
 * Phase 3: 优先使用 AI 生成的 PNG 精灵图，缺失时回退几何图形。
 * Phase 6: 程序化动画 — idle 呼吸 / walk 弹跳倾斜 / attack 前冲 / death 缩小渐隐旋转。
 */

/** 显示尺寸（游戏世界中的像素大小） */
const SPRITE_DEFS = {
  militia:     { w: 24, h: 32, label: '民兵' },
  spearman:    { w: 22, h: 38, label: '矛兵' },      // 长枪，瘦高
  bowman:      { w: 22, h: 30, ranged: true, label: '弓兵' },
  raider:      { w: 26, h: 28, fast: true, label: '突袭兵' },  // 快速突击
  swordsman:   { w: 28, h: 36, label: '剑士' },
  knight:      { w: 48, h: 40, mounted: true, label: '骑士' },
  archer:      { w: 24, h: 36, ranged: true, label: '弓手' },
  catapult:    { w: 56, h: 40, siege: true, label: '投石车' },
  royalGuard:  { w: 32, h: 40, elite: true, label: '皇家卫队' },
  giant:       { w: 72, h: 96, boss: true, label: '巨人' },
  dragonKnight:{ w: 90, h: 72, boss: true, flying: true, label: '龙骑士' },
  fireArrow:   { w: 32, h: 32, label: '' },
  wrathOfGod:  { w: 32, h: 32, label: '' },
  batteringRam:{ w: 64, h: 36, siege: true, label: '攻城锤' },
  warChest:    { w: 24, h: 24, label: '' },
};

const FALLBACK_COLORS = {
  militia:     '#8B7355', spearman:  '#CD853F', bowman:    '#6B8E23',
  raider:      '#B22222', swordsman: '#C0C0C0', knight:    '#4169E1',
  archer:      '#228B22', catapult:  '#8B4513', royalGuard:'#FFD700',
  giant:       '#A0522D', dragonKnight:'#FF4500', fireArrow: '#FF6347',
  wrathOfGod:  '#FFD700', batteringRam:'#8B4513', warChest:  '#DAA520',
};

const imageCache = {};
const animTrackers = {};

function preloadSprites() {
  for (const key of Object.keys(SPRITE_DEFS)) {
    const img = new Image();
    img.src = `/assets/sprites/${key}.png?v=4`;
    img.onload = () => { imageCache[key] = img; };
    img.onerror = () => {};
  }
}

function drawSprite(ctx, troop, scale, now) {
  const key = troop.key || 'militia';
  const def = SPRITE_DEFS[key] || SPRITE_DEFS.militia;
  const teamColor = troop.team === 'red' ? '#FF4444' : '#4488FF';
  const x = troop.x || 0, y = troop.y || 540;
  const s = scale !== undefined ? scale : 1;
  const tNow = now || Date.now();

  let yOffset = 0;
  if (def.flying) yOffset = Math.sin(tNow * 0.003 + (troop.id || 0) * 0.01) * 10;

  const facingRight = troop.team === 'red';
  const drawW = def.w * s, drawH = def.h * s;
  const drawX = x - drawW / 2, drawY = y - drawH + yOffset;

  ctx.save();
  if (def.elite || def.boss) { ctx.shadowColor = teamColor; ctx.shadowBlur = 10; }

  const img = imageCache[key];
  if (img && img.complete && img.naturalWidth > 0) {
    drawWithAnim();
  } else {
    drawFallback();
  }

  ctx.shadowBlur = 0;
  ctx.restore();

  // 指挥官金色光环脉动（画在精灵外层）
  if (troop.isCommander && troop.animState !== 'death') {
    var pulse = 1 + Math.sin(tNow * 0.005) * 0.2;
    var glowRadius = Math.round(12 * pulse);
    var grad = ctx.createRadialGradient(x, y, drawW * 0.3, x, y, drawW * 0.7 + glowRadius);
    grad.addColorStop(0, 'rgba(255,215,0,0)');
    grad.addColorStop(0.5, 'rgba(255,215,0,' + (0.25 * pulse).toFixed(2) + ')');
    grad.addColorStop(1, 'rgba(255,180,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - drawW - glowRadius, y - drawH - glowRadius, (drawW + glowRadius) * 2, (drawH + glowRadius) * 2);
  }

  // 受击闪白（150ms 内）
  if (troop.lastHitAt && tNow - troop.lastHitAt < 150) {
    var flashAlpha = (1 - (tNow - troop.lastHitAt) / 150) * 0.5;
    ctx.fillStyle = 'rgba(255,255,255,' + flashAlpha.toFixed(2) + ')';
    ctx.fillRect(drawX, drawY, drawW, drawH);
  }

  if (troop.animState !== 'death' && troop.hp !== undefined && troop.maxHp && troop.hp < troop.maxHp) {
    const barW = drawW + 6, barH = 4, barY = drawY - 8;
    const hpPct = Math.max(0, troop.hp / troop.maxHp);
    ctx.fillStyle = '#333'; ctx.fillRect(x - barW / 2, barY, barW, barH);
    ctx.fillStyle = hpPct > 0.5 ? '#4F4' : hpPct > 0.25 ? '#FF0' : '#F44';
    ctx.fillRect(x - barW / 2, barY, barW * hpPct, barH);
  }

  if (troop.animState !== 'death' && troop.showAvatar && troop.ownerName) {
    ctx.font = '10px Microsoft YaHei, sans-serif'; ctx.fillStyle = '#FFF';
    ctx.textAlign = 'center'; ctx.fillText(troop.ownerName.slice(0, 6), x, drawY - 12);
  }

  // -- 内部函数 --

  function drawWithAnim() {
    const animState = troop.animState || 'idle';

    let tracker = animTrackers[troop.id];
    if (!tracker || tracker.lastState !== animState) {
      tracker = { lastState: animState, stateStartedAt: tNow };
      animTrackers[troop.id] = tracker;
    }
    const elapsed = tNow - tracker.stateStartedAt;

    let fX = drawX, fY = drawY, fW = drawW, fH = drawH;
    let breathe = 1, tilt = 0;

    if (animState === 'idle') {
      // 呼吸缩放 ±3%
      breathe = 1 + Math.sin(tNow * 0.004) * 0.03;

    } else if (animState === 'walk') {
      // 弹跳 2px + 倾斜 0.04rad
      fY += Math.sin(tNow * 0.008) * 2;
      tilt = Math.sin(tNow * 0.008) * 0.04;

    } else if (animState === 'attack') {
      // 前冲→回退 (480ms 循环)
      const phase = (elapsed % 480) / 480;
      const lunge = phase < 0.3 ? phase / 0.3 * 5 : (1 - (phase - 0.3) / 0.7) * 3;
      const lx = facingRight ? lunge : -lunge;
      fX += lx; fY += phase < 0.3 ? -1 : 2;
      fW += lunge * 0.3; fH += lunge * 0.2;

    } else if (animState === 'death') {
      // 缩小+下沉+渐隐+旋转 (720ms)
      const p = Math.min(1, elapsed / 720);
      ctx.globalAlpha = 1 - p;
      fY += p * 15;
      fW *= 1 - p * 0.4; fH *= 1 - p * 0.4;
      fX += (drawW - fW) / 2; fY += (drawH - fH) / 2;
      ctx.translate(x, fY + fH); ctx.rotate(facingRight ? p * 0.5 : -p * 0.5); ctx.translate(-x, -(fY + fH));
    }

    // 应用 transform
    ctx.translate(x, fY + fH / 2);
    ctx.scale(breathe, breathe);
    if (tilt) ctx.rotate(tilt);
    ctx.translate(-x, -(fY + fH / 2));

    if (facingRight) {
      ctx.drawImage(img, fX, fY, fW, fH);
    } else {
      ctx.translate(x, 0); ctx.scale(-1, 1);
      ctx.drawImage(img, -(fW / 2), fY, fW, fH);
    }
  }

  function drawFallback() {
    if (facingRight) {
      ctx.fillStyle = FALLBACK_COLORS[key] || '#888';
      ctx.strokeStyle = teamColor; ctx.lineWidth = 2;
      ctx.fillRect(drawX, drawY, drawW, drawH);
      ctx.strokeRect(drawX, drawY, drawW, drawH);
    }
    if (def.mounted) { ctx.fillStyle = '#8B6914'; ctx.fillRect(drawX - 2, drawY + drawH * 0.55, drawW + 4, drawH * 0.45); }
    if (def.ranged) { ctx.strokeStyle = '#DEB887'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, drawY + drawH * 0.4, drawW * 0.6, 0, Math.PI); ctx.stroke(); }
  }
}

function cleanupTrackers(activeTroopIds) {
  const idSet = new Set(activeTroopIds);
  for (const id of Object.keys(animTrackers)) {
    if (!idSet.has(Number(id))) delete animTrackers[id];
  }
}

preloadSprites();
window.SPRITE_DEFS = SPRITE_DEFS;
window.drawSprite = drawSprite;
window.cleanupTrackers = cleanupTrackers;
