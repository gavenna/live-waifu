/**
 * B站直播弹幕适配器 — 连接 B站直播间 → 读取弹幕/礼物 → Relay 广播
 *
 * 用法: index.js 集成调用
 *   const bilibili = require('./danmaku/bilibili');
 *   bilibili.start();
 */

const https = require('https');
const zlib = require('zlib');
const WebSocket = require('ws');
const logger = require('../logger').child({ module: 'bilibili' });

const path = require('path');
const fs = require('fs');
const baseDir = __dirname.endsWith(`danmaku`) ? path.resolve(__dirname, '..') : __dirname;

const config = require('../config');
const relay = require('../relay');

let secrets = {};
let cookieStr = '';
let roomId = 0;
let reconnectTimer = null;
let shouldReconnect = true;

// ====== HTTP 请求 ======
function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('JSON parse: ' + data.substring(0, 200))); }
      });
    }).on('error', reject);
  });
}

function cookieHeaders() {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://live.bilibili.com/',
  };
  if (cookieStr) headers['Cookie'] = cookieStr;
  return headers;
}

// ====== B站 协议编解码 ======

function packMsg(op, body) {
  const bodyBuf = typeof body === 'string' ? Buffer.from(body, 'utf-8') : body;
  const headerLen = 16;
  const totalLen = headerLen + bodyBuf.length;
  const buf = Buffer.alloc(totalLen);
  buf.writeUInt32BE(totalLen, 0);
  buf.writeUInt16BE(headerLen, 4);
  buf.writeUInt16BE(1, 6);
  buf.writeUInt32BE(op, 8);
  buf.writeUInt32BE(0, 12);
  bodyBuf.copy(buf, 16);
  return buf;
}

function decodePacket(buf) {
  if (buf.length < 16) return [];
  const results = [];
  let offset = 0;
  while (offset + 16 <= buf.length) {
    const totalLen = buf.readUInt32BE(offset);
    if (totalLen < 16 || offset + totalLen > buf.length) break;
    const headerLen = buf.readUInt16BE(offset + 4);
    const protoVer = buf.readUInt16BE(offset + 6);
    const op = buf.readUInt32BE(offset + 8);
    const body = buf.slice(offset + headerLen, offset + totalLen);

    if (op === 5) {
      if (protoVer === 2 && body.length > 0) {
        try {
          const decompressed = zlib.inflateSync(body);
          results.push(...decodePacket(decompressed));
        } catch (e) {
          logger.error(`zlib 解压失败: ${e.message}`);
          results.push({ op, body: body.toString('utf-8') });
        }
      } else {
        results.push({ op, body: body.toString('utf-8') });
      }
    } else if (op === 3) {
      const pop = body.length >= 4 ? body.readUInt32BE(0) : 0;
      results.push({ op, popularity: pop });
    } else if (op === 8) {
      results.push({ op, body: body.toString('utf-8') });
    }

    offset += totalLen;
  }
  return results;
}

// ====== 礼物 → 兵种映射 ======
function mapGiftToTroop(giftId, giftName, price, coinType) {
  const userMap = secrets.bilibili?.giftMap || {};
  if (userMap[String(giftId)]) return userMap[String(giftId)];

  const name = giftName || '';
  if (coinType === 'silver' || name.includes('小心心')) return 'militia';

  const tiers = config.BILIBILI_GIFT_TIERS || [];
  for (const tier of tiers) {
    if (price >= tier.min) return tier.troop;
  }
  return null;
}

// ====== B站 消息 → Relay 广播 ======
function handleDanmaku(data) {
  const uid = String(data.info[2][0] || 0);
  const uname = data.info[2][1] || '';
  const text = (data.info[1] || '').trim();
  if (!text || text.length > 50) return;

  relay.broadcast({
    type: 'danmaku',
    text,
    playerId: `bili_${uid}`,
    playerName: uname || `bili_${uid}`,
  });
}

function handleGift(data) {
  const uid = String(data.data.uid || 0);
  const uname = data.data.uname || '';
  const giftId = data.data.giftId;
  const giftName = data.data.giftName || '';
  const price = data.data.price || 0;
  const coinType = data.data.coin_type || '';
  const troop = mapGiftToTroop(giftId, giftName, price, coinType);
  if (!troop) return;

  relay.broadcast({
    type: 'gift',
    troopKey: troop,
    giftId: String(giftId),
    giftName: giftName,
    playerId: `bili_${uid}`,
    playerName: uname || `bili_${uid}`,
    // 币值：B站按「金瓜子」计 ⇒ coinUnit='gold'（中继按 1000 金瓜子≈10 抖币 折算）
    coinValue: price,
    coinUnit: 'gold',
    // 礼物个数（连刷数）：供中继「小心心 → 每颗 +50W」等按颗计价的规则使用
    count: Number(data.data.num) || 1,
  });
}

function handleSuperChat(data) {
  const uid = String(data.data.uid || 0);
  const uname = data.data.user_info?.uname || '';
  const price = data.data.price || 0;
  const troop = price >= 500 ? 'dragonKnight' : 'giant';

  relay.broadcast({
    type: 'gift',
    troopKey: troop,
    giftName: 'SuperChat',
    playerId: `bili_${uid}`,
    playerName: uname || `bili_${uid}`,
    coinValue: price,
    coinUnit: 'gold',
  });
}

function handleGuardBuy(data) {
  const uid = String(data.data.uid || 0);
  const uname = data.data.username || '';

  relay.broadcast({
    type: 'gift',
    troopKey: 'giant',
    giftName: '舰长',
    playerId: `bili_${uid}`,
    playerName: uname || `bili_${uid}`,
    // 舰长公开价 ¥138/月 = 138000 金瓜子（B站：1 元 = 1000 金瓜子）
    coinValue: 138000,
    coinUnit: 'gold',
  });
}

const CMD_HANDLERS = {
  'DANMU_MSG': handleDanmaku,
  'SEND_GIFT': handleGift,
  'SUPER_CHAT_MESSAGE': handleSuperChat,
  'GUARD_BUY': handleGuardBuy,
};

function processMessage(packet) {
  if (packet.op !== 5) return;
  try {
    const data = JSON.parse(packet.body);
    const cmd = data.cmd;
    const handler = CMD_HANDLERS[cmd];
    if (handler) handler(data);
  } catch (e) { /* 非 JSON 消息忽略 */ }
}

// ====== B站 WebSocket 连接 ======
let biliWs = null;
let heartbeatTimer = null;

async function getRoomInfo() {
  const res = await httpGet(`https://api.live.bilibili.com/room/v1/Room/room_init?id=${roomId}`, cookieHeaders());
  if (res.code !== 0) throw new Error(`room_init: code=${res.code} msg=${res.message}`);
  return res.data.room_id;
}

async function getDanmuInfo(realRoomId) {
  const res = await httpGet(`https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=${realRoomId}`, cookieHeaders());
  if (res.code !== 0) throw new Error(`getDanmuInfo: code=${res.code} msg=${res.message}`);
  return res.data;
}

function connectBili() {
  return new Promise(async (resolve, reject) => {
    try {
      const realRoomId = await getRoomInfo();
      logger.info(`直播间: ${roomId} → 真实房间号 ${realRoomId}`);

      const dmInfo = await getDanmuInfo(realRoomId);
      const host = dmInfo.host_list[0];
      const token = dmInfo.token;
      const wsHost = host.host;
      const wsPort = host.wss_port || 443;
      const wsUrl = `wss://${wsHost}:${wsPort}/sub`;
      logger.info(`弹幕服务器: ${wsHost}:${wsPort}`);

      const ws = new WebSocket(wsUrl);
      biliWs = ws;

      ws.on('open', () => {
        logger.info('B站弹幕服务器已连接');
        const authBody = JSON.stringify({
          uid: 0, roomid: realRoomId, protover: 2, platform: 'web', type: 2, key: token || '',
        });
        ws.send(packMsg(7, authBody));
      });

      ws.on('message', (data) => {
        const packets = decodePacket(Buffer.from(data));
        for (const packet of packets) {
          if (packet.op === 8) { logger.info('B站房间认证成功'); resolve(); }
          processMessage(packet);
        }
      });

      ws.on('error', (err) => { logger.error(`B站 WS 错误: ${err.message}`); });

      ws.on('close', (code) => {
        logger.info(`B站 WS 断连 code=${code}`);
        biliWs = null;
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        if (shouldReconnect) scheduleReconnect();
      });

    } catch (e) { reject(e); }
  });
}

function startHeartbeat() {
  heartbeatTimer = setInterval(() => {
    if (biliWs && biliWs.readyState === WebSocket.OPEN) {
      biliWs.send(packMsg(2, '[object Object]'));
    }
  }, 30000);
}

let reconnectCount = 0;
const MAX_RECONNECT = 5;

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectCount++;
  if (reconnectCount > MAX_RECONNECT) {
    logger.warn(`B站重连已达上限(${MAX_RECONNECT}次)，放弃重连`);
    _running = false;
    return;
  }
  const delay = Math.min(5000 * reconnectCount, 30000);
  logger.info(`${delay / 1000}秒后重连… (${reconnectCount}/${MAX_RECONNECT})`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await connectBili();
      startHeartbeat();
      reconnectCount = 0;
      logger.info('B站重连成功');
    } catch (e) {
      logger.error(`B站重连失败: ${e.message}`);
      scheduleReconnect();
    }
  }, 5000);
}

// ====== 入口 ======
let _running = false;

async function start() {
  if (_running) { logger.info('[bilibili] 已在运行中'); return; }
  const secretsPath = path.join(baseDir, 'server', 'secrets.json');
  if (!fs.existsSync(secretsPath)) {
    logger.warn('secrets.json 不存在，B站适配器未启动');
    return;
  }

  secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf-8'));
  const bili = secrets.bilibili || {};
  roomId = bili.roomId || 0;
  cookieStr = bili.cookie || '';

  if (!roomId || !cookieStr) return;

  _running = true;
  shouldReconnect = true;
  reconnectCount = 0;
  logger.info(`启动 B站适配器 → 直播间 ${roomId}`);

  try {
    await connectBili();
    startHeartbeat();
    logger.info('B站适配器就绪');
  } catch (e) {
    logger.error(`B站适配器启动失败: ${e.message}`);
    scheduleReconnect();
  }
}

function stop() {
  shouldReconnect = false;
  _running = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  if (biliWs) { try { biliWs.close(); } catch (e) {} biliWs = null; }
  logger.info('[bilibili] 已停止');
}

function isRunning() { return _running; }

module.exports = { start, stop, isRunning };
