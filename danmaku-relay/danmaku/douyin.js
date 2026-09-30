/**
 * 抖音弹幕适配器 — douyinLive 代理 → Relay 广播
 *
 * 架构:
 *   douyinLive.exe (WS Proxy :1088) ← 本适配器 (WS Client)
 *                                          ↓ EventTranslator
 *                                          ↓ relay.broadcast (进程内广播)
 *
 * 用法: index.js 集成调用
 * 配置: server/secrets.json → douyin { enabled, roomId, proxyUrl }
 * 依赖: tools/douyinLive.exe 需先启动
 */

const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const baseDir = __dirname.endsWith(`danmaku`) ? path.resolve(__dirname, '..') : __dirname;
const SECRETS_PATH = path.join(baseDir, 'server', 'secrets.json');

let secrets = null;
let ENABLED = false;
let ROOM_ID = '';
let PROXY_WS_URL = 'ws://localhost:1088';

const config = require('../config');
let DOUYIN_GIFT_MAP = {};
let ADAPTER_CFG = {};

const logger = require('../logger');
const relay = require('../relay');

function loadConfig() {
  try {
    secrets = JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf-8'));
  } catch (err) {
    throw new Error('无法读取 secrets.json: ' + err.message);
  }
  const douyinCfg = secrets.douyin || {};
  ENABLED = douyinCfg.enabled === true;
  ROOM_ID = douyinCfg.roomId || '';
  PROXY_WS_URL = douyinCfg.proxyUrl || 'ws://localhost:1088';
  DOUYIN_GIFT_MAP = config.DOUYIN_GIFT_MAP || {};
  ADAPTER_CFG = config.DOUYIN_ADAPTER || {};
}

// ====== EventTranslator ======
class EventTranslator {
  constructor() {
    this.giftMap = { ...DOUYIN_GIFT_MAP };
    this.userGiftMap = (secrets && secrets.douyin && secrets.douyin.giftMap) || {};

    this.priceTiers = [
      { min: 3000, troop: 'wrathOfGod' },
      { min: 1200, troop: 'dragonKnight' },
      { min: 520,  troop: 'giant' },
      { min: 299,  troop: 'batteringRam' },
      { min: 199,  troop: 'fireArrow' },
      { min: 99,   troop: 'royalGuard' },
      { min: 30,   troop: 'catapult' },
      { min: 10,   troop: 'archer' },
      { min: 5,    troop: 'knight' },
      { min: 1,    troop: 'swordsman' },
    ];

    this.likeCooldowns = new Map();
    this.followCooldowns = new Map();
    this.shareCooldowns = new Map();
    this.msgCount = 0;
  }

  translate(raw) {
    if (!raw || typeof raw !== 'object') return [];
    this.msgCount++;
    const msgType = raw.msgType || raw.type || '';

    if (msgType === 'welcome' || msgType === 'heartbeat' || msgType === 'status') return [];
    if (!raw.msgType && raw.type && !raw.uid) return [];

    if (this.msgCount === 1) {
      logger.info(`[DOUYIN] 已收到弹幕数据 (${raw.platform || '?'})`);
    }

    const uid = String(raw.uid || 0);
    const playerId = `douyin_${uid}`;
    const playerName = raw.name || playerId;

    switch (msgType) {
      case '弹幕': return this._danmaku(raw, playerId, playerName);
      case '礼物': return this._gift(raw, playerId, playerName);
      case '点赞': return this._like(raw, playerId, playerName);
      case '关注': case '粉丝团': return this._follow(raw, playerId, playerName);
      case '进房': return this._enter(raw, playerId, playerName);
      case '分享': return this._share(raw, playerId, playerName);
      default:
        if (!this._seen) this._seen = {};
        if (!this._seen[msgType]) {
          this._seen[msgType] = true;
          logger.info(`[DOUYIN] 新消息类型: "${msgType}" (platform=${raw.platform})`);
        }
        return [];
    }
  }

  _danmaku(raw, playerId, playerName) {
    const text = (raw.content || '').trim();
    logger.info(`[DOUYIN] ${playerName}: "${text}"`);
    if (!text || text.length > 50) {
      if (!text) logger.info('[DOUYIN]   → 跳过：内容为空');
      else logger.info(`[DOUYIN]   → 跳过：长度${text.length}>50`);
      return [];
    }
    return [{ type: 'danmaku', text, playerId, playerName }];
  }

  _gift(raw, playerId, playerName) {
    const giftId = String(raw.giftId || '');
    const giftName = raw.giftName || '';
    const unitPrice = Number(raw.diamondCount || 0);
    const count = Number(raw.giftCount || raw.repeatCount || 1);
    const totalPrice = unitPrice * count;

    logger.info(`[DOUYIN] ${playerName} 送 "${giftName}"(id=${giftId}) 单价${unitPrice}×${count}=${totalPrice}钻`);

    let troop = null;
    if (this.userGiftMap[giftId]) troop = this.userGiftMap[giftId];
    else if (this.giftMap[giftId]) troop = this.giftMap[giftId];
    else if (totalPrice > 0) {
      for (const tier of this.priceTiers) {
        if (totalPrice >= tier.min) { troop = tier.troop; break; }
      }
    }
    if (!troop && giftName) {
      const n = giftName;
      if (n.includes('小心心') || n.includes('heart')) troop = 'militia';
      else if (n.includes('棒棒糖') || n.includes('lollipop')) troop = 'knight';
      else if (n.includes('鲜花') || n.includes('flower') || n.includes('玫瑰')) troop = 'archer';
      else if (n.includes('城堡') || n.includes('castle')) troop = 'giant';
      else if (n.includes('龙') || n.includes('dragon')) troop = 'dragonKnight';
      else if (n.includes('嘉年华') || n.includes('火箭')) troop = 'wrathOfGod';
    }

    if (!troop) {
      logger.info(`[DOUYIN] 未知礼物: ${giftName}(${giftId}) 单价${unitPrice}×${count}=${totalPrice}`);
      return [];
    }

    logger.info(`[DOUYIN] ${playerName} 送 ${giftName}(id=${giftId}) 单价${unitPrice}×${count}=${totalPrice}钻 → ${troop}`);
    // coinValue/coinUnit：把礼物价值带给中继（battle.handleGift 按价值加余额）。
    // 抖音按「抖币」计 ⇒ coinUnit='diamond'。
    // count：**礼物个数**（连刷数），供中继「小心心 → 每颗 +50W」等按颗计价的规则使用。
    return [{ type: 'gift', troopKey: troop, giftId, giftName: giftName || '', playerId, playerName,
      coinValue: totalPrice, coinUnit: 'diamond', count }];
  }

  _like(raw, playerId, playerName) {
    const cdMs = ADAPTER_CFG.LIKE_COOLDOWN_MS || 1000;
    const last = this.likeCooldowns.get(playerId) || 0;
    if (Date.now() - last < cdMs) return [];
    this.likeCooldowns.set(playerId, Date.now());

    const likeCount = raw.count || 0;
    const name = playerName || playerId;
    const out = [];
    // 显示弹幕（保留原行为）：观众能看到「点赞已被收到」
    if (likeCount >= 100) {
      out.push({ type: 'danmaku', text: '杀', playerId, playerName, source: 'like',
        displayText: `感谢 ${name} 的 ${likeCount} 连赞！⚔ 民兵前来助阵` });
    } else {
      out.push({ type: 'danmaku', text: '赞', playerId, playerName, source: 'like',
        displayText: `感谢 ${name} 的点赞！⚔ 民兵前来助阵` });
    }
    // ★ 2026-09-19 新增：把点赞接到「给某队加余额」。
    //   本层只产出事件（{type:'credits', source:'like'}）；加多少、加给哪队由中继
    //   battle 侧决定（battle/index.js handleCredits → economy.credit），
    //   这样金额可在控制面板配置、队伍策略集中在一处。
    // ★ 2026-09-27：把**连赞数** count 一并透传，供中继按「基础额+每赞加成」量化（封顶）。
    out.push({ type: 'credits', source: 'like', playerId, playerName, count: likeCount });
    return out;
  }

  _follow(raw, playerId, playerName) {
    const cdMs = 5000;
    const last = this.followCooldowns.get(playerId) || 0;
    if (Date.now() - last < cdMs) return [];
    this.followCooldowns.set(playerId, Date.now());

    const msgs = [{ type: 'danmaku', text: `⭐ ${playerName} 关注了直播间！`, playerId, playerName, source: 'follow',
      displayText: `⭐ ${playerName || playerId} 关注了直播间！` }];
    const reward = ADAPTER_CFG.FOLLOW_REWARD_TROOP;
    if (reward) {
      for (let i = 0; i < (ADAPTER_CFG.FOLLOW_REWARD_COUNT || 1); i++) {
        // 关注奖励兵：coinValue=0 —— 它是「关注」的赠品，加余额已由 credits 事件结算，别再算一次
        msgs.push({ type: 'gift', troopKey: reward, giftName: '关注奖励', playerId, playerName,
          coinValue: 0, coinUnit: 'diamond' });
      }
    }
    // ★ 2026-09-19 新增：把关注接到「给某队加余额」（事件由 battle 侧结算）
    msgs.push({ type: 'credits', source: 'follow', playerId, playerName });
    return msgs;
  }

  _enter(raw, playerId, playerName) {
    if (!ADAPTER_CFG.AUTO_JOIN_ON_ENTER) return [];
    // ★ 2026-09-20：去掉「同一人只编一次」的 enterJoins 去重 —— 观众**每次进房**都要产出
    //   join 事件，好让中继念名字欢迎（用户需求：「观众入场要念名字+主动欢迎」）。
    //   归属不会被重置：中继 handleJoin 对已有归属的观众**保留原队**（kept=true），
    //   只有首次进房才随机编队。旧写法在这里 early-return，导致老观众再进房没有任何反应。

    const chance = ADAPTER_CFG.ENTER_JOIN_CHANCE || 0;
    if (chance > 0 && Math.random() > chance) return [];

    const team = Math.random() < 0.5 ? 'red' : 'blue';
    logger.info(`[DOUYIN] ${playerName} 进房 → ${team}方 (在线${raw.memberCount || '?'}人)`);
    return [{ type: 'join', team, playerId, playerName }];
  }

  _share(raw, playerId, playerName) {
    const cdMs = 3000;
    const last = this.shareCooldowns.get(playerId) || 0;
    if (Date.now() - last < cdMs) return [];
    this.shareCooldowns.set(playerId, Date.now());
    return [{ type: 'danmaku', text: `🔗 ${playerName} 分享了直播间！`, playerId, playerName,
      displayText: `🔗 ${playerName || playerId} 分享了直播间！` }];
  }
}

// ====== douyinLive 格式 → 可遇AI 格式映射 ======

function douyinLiveToLegacy(data) {
  if (data.type === 'system') {
    const ev = data.event;
    if (ev === 'live_status') {
      if (data.live) {
        logger.info(`[DOUYIN] 直播间已开播: ${data.live_name || '?'} - ${data.title || ''}`);
      } else {
        logger.info(`[DOUYIN] 直播间未开播: ${data.message} (${data.status})`);
      }
    }
    return null;
  }

  const methodMap = {
    'WebcastChatMessage': '弹幕',
    'WebcastGiftMessage': '礼物',
    'WebcastLikeMessage': '点赞',
    'WebcastMemberMessage': '进房',
    'WebcastSocialMessage': '关注',
    'WebcastFansclubMessage': '粉丝团',
  };

  const msgType = methodMap[data.method];
  if (!msgType) return null;

  const user = data.user || {};
  const gift = data.gift || {};

  return {
    msgType,
    uid: user.id || '',
    name: user.nickname || '',
    content: data.content || '',
    giftId: String(gift.id || ''),
    giftName: gift.name || '',
    diamondCount: gift.diamondCount || 0,
    giftCount: gift.count || data.count || 1,
    count: data.count || 0,
    memberCount: data.memberCount || 0,
    platform: 'douyin',
    timestamp: Date.now(),
  };
}

// ====== ProxyClient (douyinLive :1088) ======

let proxyWs = null;
let proxyReconnectTimer = null;
let proxyReconnectDelay = 2000;
let proxyPingTimer = null;
let shutdown = false;

function connectProxy() {
  if (shutdown) return;
  if (!ROOM_ID) {
    logger.error('[DOUYIN] roomId 未配置，请在 server/secrets.json → douyin.roomId 填入直播间号');
    return;
  }

  const wsUrl = `${PROXY_WS_URL}/ws/${ROOM_ID}`;
  logger.info(`[DOUYIN] 连接 douyinLive ${wsUrl}...`);
  const ws = new WebSocket(wsUrl);
  ws.on('open', () => {
    logger.info('[DOUYIN] 已连接 douyinLive');
    proxyReconnectDelay = 2000;
    proxyWs = ws;
  });
  ws.on('message', (raw) => {
    let text;
    try { text = raw.toString(); } catch (_) { return; }

    // 调试: 记录原始帧长度与内容 (环境变量 DOUYIN_RAW_DEBUG=1 开启)
    if (process.env.DOUYIN_RAW_DEBUG === '1') {
      const b = Buffer.from(raw);
      const isChat = text.includes('WebcastChatMessage');
      const shown = isChat ? text : text.substring(0, 300);
      logger.info(`[DOUYIN][RAW] bytes=${b.length} isChat=${isChat} text=${shown}`);
    }

    let data;
    try { data = JSON.parse(text); } catch (_) { return; }

    // 诊断: 弹幕消息显式打印 content 字段 (DOUYIN_RAW_DEBUG=1 时)
    if (process.env.DOUYIN_RAW_DEBUG === '1') {
      if (data.method === 'WebcastChatMessage' || (data.common && data.common.method === 'WebcastChatMessage')) {
        const c = data.content;
        logger.info(`[DOUYIN][CHAT-RAW] content=${JSON.stringify(c)} type=${typeof c} len=${c ? c.length : 0} codepoints=${c ? JSON.stringify([...c].map(ch => ch.codePointAt(0).toString(16))) : '[]'}`);
      }
    }

    const method = data.method || data.type || '?';
    const legacy = douyinLiveToLegacy(data);
    if (!legacy) {
      if (method !== 'system' && method !== 'ping' && method !== 'pong') {
        logger.debug(`[DOUYIN] 跳过消息: method=${method} type=${data.type || '?'}`);
      }
      return;
    }

    // 诊断: 检测多字节字符异常截断 (UTF-8 尾部残留)
    const rawContent = data.content;
    if (typeof rawContent === 'string' && rawContent.length > 0) {
      const lastCode = rawContent.charCodeAt(rawContent.length - 1);
      // 0xFFFD = 替换字符, 说明解码时遇到不完整字节序列
      if (lastCode === 0xFFFD) {
        logger.warn(`[DOUYIN] ⚠ 内容末尾出现替换字符(可能被截断): "${rawContent}"`);
      }
    }

    logger.info(`[DOUYIN] ${legacy.name}: "${legacy.content}" (len=${String(legacy.content || '').length})`);
    const msgs = translator.translate(legacy);
    for (const msg of msgs) relay.broadcast(msg);
  });
  ws.on('close', () => {
    logger.warn('[DOUYIN] douyinLive 断连');
    proxyWs = null;
    if (!shutdown) {
      clearTimeout(proxyReconnectTimer);
      logger.warn(`[DOUYIN] ${proxyReconnectDelay}ms 后重连...`);
      proxyReconnectTimer = setTimeout(() => {
        connectProxy();
        proxyReconnectDelay = Math.min(proxyReconnectDelay * 2, 30000);
      }, proxyReconnectDelay);
    }
  });
  ws.on('error', (err) => { logger.error(`[DOUYIN] ${err.message}`); });
}

function startPing() {
  proxyPingTimer = setInterval(() => {
    if (proxyWs && proxyWs.readyState === WebSocket.OPEN) proxyWs.send('ping');
  }, 30000);
}

// ====== 共享状态 ======
let translator = null;
let _running = false;

function start() {
  if (_running) { logger.info('[DOUYIN] 已在运行中'); return; }
  try { loadConfig(); } catch (e) { logger.error('[DOUYIN] ' + e.message); return; }
  if (!ENABLED) { logger.info('[DOUYIN] 适配器未启用'); return; }
  if (!ROOM_ID) {
    logger.error('[DOUYIN] roomId 未配置，请在 server/secrets.json → douyin.roomId 填入直播间号');
    return;
  }

  _running = true;
  shutdown = false;
  logger.info('[DOUYIN] === 抖音弹幕适配器 (douyinLive) ===');
  logger.info(`[DOUYIN] 直播间: ${ROOM_ID}`);
  logger.info(`[DOUYIN] 代理:   ${PROXY_WS_URL}`);

  translator = new EventTranslator();
  startPing();
  setTimeout(() => connectProxy(), 500);
}

function stop() {
  logger.info('[DOUYIN] 停止适配器...');
  shutdown = true;
  _running = false;
  clearTimeout(proxyReconnectTimer);
  if (proxyPingTimer) clearInterval(proxyPingTimer);
  if (proxyWs) { try { proxyWs.close(); } catch (e) {} proxyWs = null; }
  logger.info('[DOUYIN] 已停止');
}

function isRunning() { return _running; }

/** 离线回归用：注入适配器配置（生产由 loadConfig() 从 server/secrets.json 读）。 */
function setAdapterConfigForTest(cfg) { ADAPTER_CFG = Object.assign({}, cfg || {}); }

module.exports = { start, stop, isRunning, EventTranslator, setAdapterConfigForTest };

if (require.main === module) start();
