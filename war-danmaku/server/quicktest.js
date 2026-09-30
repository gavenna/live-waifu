/**
 * 快速测试脚本 — 自动模拟一局游戏，方便看浏览器效果
 *
 * 用法: node server/quicktest.js
 * 前提: server/index.js 已启动
 */

const WebSocket = require('ws');

const WS_URL = 'ws://localhost:8765';
const redPlayer = { id: 'test_red', name: '炎龙丨测试兵' };
const bluePlayer = { id: 'test_blue', name: '霜狼丨测试兵' };

function createWS() {
  return new WebSocket(WS_URL);
}

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('=== 自动化测试 ===\n');

  // 两个 WS 连接，模拟两个玩家
  const redWs = createWS();
  const blueWs = createWS();

  await new Promise((resolve, reject) => {
    let opened = 0;
    const onOpen = () => {
      opened++;
      if (opened === 2) resolve();
    };
    redWs.on('open', onOpen);
    blueWs.on('open', onOpen);
    redWs.on('error', reject);
    blueWs.on('error', reject);
  });

  console.log('已连接。等待 COUNTDOWN 阶段...\n');

  // 监听游戏状态
  redWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'game_state') {
        const s = msg.state;
        const r = msg.red, b = msg.blue;
        console.log(`[${s}] R${msg.round} | 🔴红:${r.playerCount}人 ${r.castleHP}HP | 🔵蓝:${b.playerCount}人 ${b.castleHP}HP | 战线:${msg.frontLine ?? 0} | 兵:${(msg.troops||[]).length}`);
      }
    } catch (_) {}
  });

  // 加入双方阵营
  send(redWs, { type: 'join', team: 'red', playerId: redPlayer.id, playerName: redPlayer.name });
  send(blueWs, { type: 'join', team: 'blue', playerId: bluePlayer.id, playerName: bluePlayer.name });

  // 等待进入 PLAYING 阶段（最多等 35 秒）
  console.log('等待 COUNTDOWN 结束...');
  let playing = false;
  redWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'game_state' && msg.state === 'PLAYING') playing = true;
    } catch (_) {}
  });
  for (let i = 0; i < 35; i++) {
    if (playing) break;
    await delay(1000);
  }
  if (!playing) console.log('(未等到 PLAYING，直接开始)');

  console.log('\n=== 开始出兵！===\n');

  // 双方轮流出兵
  const script = [
    // 免费层
    () => { send(redWs, { type: 'danmaku', text: '杀', playerId: 'fan_a', playerName: '路人甲' }); console.log('🔴 路人甲: 杀! → 3民兵'); },
    () => { send(blueWs, { type: 'danmaku', text: '杀', playerId: 'fan_b', playerName: '路人乙' }); console.log('🔵 路人乙: 杀! → 3民兵'); },
    // 初级兵
    () => { send(redWs, { type: 'gift', giftId: 'knight', troopKey: 'knight', playerId: redPlayer.id, playerName: redPlayer.name }); console.log('🔴 炎龙丨测试兵 → 骑士'); },
    () => { send(blueWs, { type: 'gift', giftId: 'swordsman', troopKey: 'swordsman', playerId: bluePlayer.id, playerName: bluePlayer.name }); console.log('🔵 霜狼丨测试兵 → 剑士'); },
    () => { send(redWs, { type: 'gift', giftId: 'archer', troopKey: 'archer', playerId: redPlayer.id, playerName: redPlayer.name }); console.log('🔴 炎龙丨测试兵 → 弓手'); },
    () => { send(blueWs, { type: 'gift', giftId: 'catapult', troopKey: 'catapult', playerId: bluePlayer.id, playerName: bluePlayer.name }); console.log('🔵 霜狼丨测试兵 → 投石车'); },
    // 大哥出手
    () => { send(redWs, { type: 'gift', giftId: 'giant', troopKey: 'giant', playerId: 'dage_red', playerName: '炎龙丨战歌' }); console.log('🔴 ★★★ 炎龙丨战歌 → 岩石巨人！'); },
    () => { send(blueWs, { type: 'gift', giftId: 'dragonKnight', troopKey: 'dragonKnight', playerId: 'dage_blue', playerName: '霜狼丨破军' }); console.log('🔵 ★★★ 霜狼丨破军 → 龙骑士！'); },
    // 盲盒
    () => { send(redWs, { type: 'gift', giftId: 'warChest', troopKey: 'warChest', playerId: 'curious', playerName: '赌狗丨欧皇' }); console.log('🔴 赌狗丨欧皇 → 战争宝箱 🎲'); },
    // 全局技能
    () => { send(blueWs, { type: 'gift', giftId: 'fireArrow', troopKey: 'fireArrow', playerId: 'dage_blue', playerName: '霜狼丨破军' }); console.log('🔵 ★★ 霜狼丨破军 → 火矢齐射！'); },
    // 继续刷兵
    () => { send(redWs, { type: 'gift', giftId: 'royalGuard', troopKey: 'royalGuard', playerId: 'dage_red', playerName: '炎龙丨战歌' }); console.log('🔴 ★★ 炎龙丨战歌 → 皇家卫队'); },
    () => { send(blueWs, { type: 'gift', giftId: 'batteringRam', troopKey: 'batteringRam', playerId: 'dage_blue', playerName: '霜狼丨破军' }); console.log('🔵 ★★ 霜狼丨破军 → 攻城锤！'); },
    // 多个民兵
    () => { send(redWs, { type: 'danmaku', text: '666', playerId: 'fan_c', playerName: '路人丙' }); console.log('🔴 路人丙: 666 → 3民兵'); },
    () => { send(blueWs, { type: 'danmaku', text: '666', playerId: 'fan_d', playerName: '路人丁' }); console.log('🔵 路人丁: 666 → 3民兵'); },
    // 加速
    () => { send(redWs, { type: 'danmaku', text: '冲', playerId: 'fan_a', playerName: '路人甲' }); console.log('🔴 路人甲: 冲! → 加速'); },
    // 天神之怒
    () => { send(redWs, { type: 'gift', giftId: 'wrathOfGod', troopKey: 'wrathOfGod', playerId: 'dage_red', playerName: '炎龙丨战歌' }); console.log('🔴 ★★★★★ 炎龙丨战歌 → 天神之怒！！！'); },
  ];

  for (let i = 0; i < script.length; i++) {
    await delay(2000);
    script[i]();
  }

  console.log('\n=== 出兵完毕，观察战场演变 ===\n');
  console.log('浏览器: http://localhost:3000\n');

  // 保持连接，继续观察
  await delay(60000);
  console.log('测试结束。');
  redWs.close();
  blueWs.close();
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
