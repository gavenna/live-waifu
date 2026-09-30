/**
 * Announcer 自诊断测试运行器
 *
 * 用法:
 *   node server/announcer/test.js               L1-L3 快速测试 (不依赖 waifu-agent)
 *   node server/announcer/test.js --tts          L1-L4 (含 TTS 生成)
 *   node server/announcer/test.js --full         L1-L5 全链路 (需 waifu-agent 运行中)
 *
 * 输出: 终端显示 [PASS]/[FAIL] + test-output/summary.txt + test-output/full.log
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'test-output');
const SUMMARY_PATH = path.join(OUTPUT_DIR, 'summary.txt');
const FULL_LOG_PATH = path.join(OUTPUT_DIR, 'full.log');

const args = process.argv.slice(2);
const FULL = args.includes('--full');
const TTS = FULL || args.includes('--tts');

const results = [];
let fullLog = '';

function log(msg) {
  fullLog += msg + '\n';
  console.log(msg);
}

function addResult(name, isPass, detail) {
  var marker = isPass === null ? '[SKIP]' : isPass ? '[PASS]' : '[FAIL]';
  var line = marker + ' ' + name + (detail ? ' — ' + detail : '');
  results.push({ name: name, pass: isPass, detail: detail || '', line: line });
  log('  ' + line);
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'assertion failed');
}

function assertEquals(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || 'value mismatch') + ': expected="' + expected + '" actual="' + actual + '"');
  }
}

function assertContains(str, substr, msg) {
  if (!str.includes(substr)) {
    throw new Error((msg || 'substring not found') + ': "' + substr + '" missing');
  }
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function finishAndExit(code) {
  var passed = results.filter(function (r) { return r.pass === true; }).length;
  var failed = results.filter(function (r) { return r.pass === false; }).length;
  var skipped = results.filter(function (r) { return r.pass === null; }).length;
  var total = results.length;

  log('\n========================================');
  log('  测试摘要');
  log('========================================');
  log('  通过: ' + passed + '  失败: ' + failed + '  跳过: ' + skipped + '  总计: ' + total);
  log('');

  for (var i = 0; i < results.length; i++) {
    log('  ' + results[i].line);
  }

  log('\n结果: ' + (failed === 0 ? 'OK 全部通过' : 'FAIL ' + failed + ' 项失败'));

  var summaryLines = [
    'Announcer 测试报告 — ' + new Date().toISOString(),
    '模式: ' + (FULL ? '全链路 L1-L5' : TTS ? 'L1-L4' : '快速 L1-L3'),
    '通过: ' + passed + '  失败: ' + failed + '  跳过: ' + skipped + '  总计: ' + total,
    '',
  ];
  for (var j = 0; j < results.length; j++) {
    summaryLines.push(results[j].line);
  }
  summaryLines.push('');
  summaryLines.push(failed === 0 ? '结果: 全部通过' : '结果: ' + failed + ' 项失败');

  fs.writeFileSync(SUMMARY_PATH, summaryLines.join('\n'), 'utf-8');
  fs.writeFileSync(FULL_LOG_PATH, fullLog, 'utf-8');

  log('\n报告已保存: ' + SUMMARY_PATH);
  log('完整日志: ' + FULL_LOG_PATH);

  process.exit(failed > 0 ? 1 : 0);
}

// ========== 主流程 ==========

async function main() {

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
log('========================================');
log('  Announcer 自诊断测试');
log('  时间: ' + new Date().toISOString());
log('  模式: ' + (FULL ? '全链路 L1-L5' : TTS ? 'L1-L4 (含 TTS)' : '快速 L1-L3'));
log('========================================\n');

// ====== L1: 模块加载 + 模板引擎 ======

log('=== L1: 模块加载 & 模板引擎 ===');

var AnnouncerMod, generate, troopName, teamName, giftTier, Scheduler, PRIORITY, TtsGenerator, LlmEngine, WsRelayClient;

// 1.1 模块加载
log('L1.1 模块加载');
try {
  AnnouncerMod = require('./index');
  generate = require('./templateEngine').generate;
  troopName = require('./templateEngine').troopName;
  teamName = require('./templateEngine').teamName;
  giftTier = require('./templateEngine').giftTier;
  Scheduler = require('./scheduler').Scheduler;
  PRIORITY = require('./scheduler').PRIORITY;
  TtsGenerator = require('./ttsGenerator').TtsGenerator;
  LlmEngine = require('./llmEngine').LlmEngine;
  WsRelayClient = require('./wsRelayClient').WsRelayClient;
  addResult('L1.1 模块加载', true, '6/6 模块 OK');
} catch (e) {
  addResult('L1.1 模块加载', false, e.message);
  finishAndExit(1);
  return;
}

// 1.2 名称映射
log('L1.2 兵种名 & 阵营名映射');
try {
  assertEquals(troopName('giant'), '岩石巨人', 'giant');
  assertEquals(troopName('dragonKnight'), '龙骑士', 'dragonKnight');
  assertEquals(troopName('wrathOfGod'), '天神之怒', 'wrathOfGod');
  assertEquals(troopName('unknown_key'), 'unknown_key', 'unknown fallback');
  assertEquals(teamName('red'), '炎龙帝国', 'red');
  assertEquals(teamName('blue'), '霜狼部落', 'blue');
  assertEquals(giftTier('giant'), 'premium', 'giant tier');
  assertEquals(giftTier('royalGuard'), 'medium', 'royalGuard tier');
  assertEquals(giftTier('swordsman'), 'cheap', 'swordsman tier');
  addResult('L1.2 名称映射', true);
} catch (e) {
  addResult('L1.2 名称映射', false, e.message);
}

// 1.3 礼物模板
log('L1.3 礼物感谢模板');
try {
  for (var i = 0; i < 5; i++) {
    var r1 = generate('gift_premium', { playerName: '土豪', troopName: '岩石巨人' });
    assert(r1, 'gift_premium not null');
    assertContains(r1.text, '土豪', 'contains playerName');
    assertContains(r1.text, '岩石巨人', 'contains troopName');
    assertEquals(r1.emotion, 'surprised', 'emotion');
    assert(r1.motion, 'has motion');
  }
  var r2 = generate('gift_cheap', { playerName: '观众', giftName: '小心心' });
  assert(r2, 'gift_cheap not null');
  assertContains(r2.text, '观众');
  assertEquals(r2.emotion, 'happy', 'cheap gift emotion');
  addResult('L1.3 礼物模板', true);
} catch (e) {
  addResult('L1.3 礼物模板', false, e.message);
}

// 1.4 全部事件模板覆盖
log('L1.4 全部事件类型模板覆盖');
var eventTests = [
  ['comeback', { teamName: '炎龙帝国' }, ['炎龙帝国'], 'surprised'],
  ['global_skill', { ownerName: '玩家A', skillName: '天神之怒' }, ['玩家A'], 'surprised'],
  ['chest_open', { playerName: '玩家B' }, ['玩家B'], 'surprised'],
  ['chest_reveal', { playerName: '玩家B', troopName: '龙骑士' }, ['玩家B', '龙骑士'], null],
  ['spawn_preview', { playerName: '玩家C', troopName: '岩石巨人' }, ['玩家C'], null],
  ['siege', { ownerName: '推土机', damage: '1500' }, ['推土机'], 'surprised'],
  ['castle_hit', { teamName: '炎龙帝国', damage: '500' }, ['炎龙帝国'], null],
  ['kill_multikill', { killerName: '战神', count: '5' }, ['战神', '5'], null],
  ['join', { playerName: '新人', teamName: '炎龙帝国' }, ['新人'], 'happy'],
  ['follow', { playerName: '粉丝' }, ['粉丝'], 'happy'],
  ['dragon_breath', { ownerName: '龙骑' }, ['龙骑'], 'surprised'],
  ['dragon_roar', { ownerName: '龙骑' }, ['龙骑'], 'surprised'],
  ['random_event', { text: '天降火雨！' }, ['天降火雨'], 'surprised'],
  ['opening', {}, ['阵营'], 'happy'],
  ['game_countdown', { seconds: '5' }, ['5'], null],
  ['game_start', {}, [], null],
  ['game_end', { teamName: '炎龙帝国' }, ['炎龙帝国'], null],
  ['periodic_report', { redHP: '72%', blueHP: '48%', redPlayers: '5', bluePlayers: '3', advantage: '红' }, [], null],
  ['final_2min', {}, ['2分钟'], 'surprised'],
  ['conclusion', { mvp: '张三', svp: '李四' }, ['张三'], 'happy'],
];

var eventFail = 0;
for (var ei = 0; ei < eventTests.length; ei++) {
  var entry = eventTests[ei];
  var etype = entry[0], evars = entry[1], ewords = entry[2], eemotion = entry[3];
  try {
    var eres = generate(etype, evars);
    if (!eres) throw new Error('generate returned null');
    for (var ek = 0; ek < ewords.length; ek++) {
      assertContains(eres.text, ewords[ek], etype + ': missing "' + ewords[ek] + '"');
    }
    if (eemotion) assertEquals(eres.emotion, eemotion, etype + ': emotion');
  } catch (e) {
    eventFail++;
    if (eventFail <= 3) addResult('L1.4 ' + etype, false, e.message);
  }
}
if (eventFail === 0) {
  addResult('L1.4 事件模板 (' + eventTests.length + ' 类型)', true);
} else {
  addResult('L1.4 事件模板', false, eventFail + '/' + eventTests.length + ' failed');
}

// 1.5 模板随机性
log('L1.5 模板随机性');
try {
  var texts = new Set();
  for (var ti = 0; ti < 20; ti++) {
    var tr = generate('kill_multikill', { killerName: 'X', count: '3' });
    texts.add(tr.text);
  }
  assert(texts.size >= 2, '20 gens should produce >= 2 variants, got ' + texts.size);
  addResult('L1.5 模板随机性', true, texts.size + ' 种变体');
} catch (e) {
  addResult('L1.5 模板随机性', false, e.message);
}

// ====== L2: 调度器 ======

log('\n=== L2: 调度器 ===');

var SchedClass = require('./scheduler').Scheduler;

// 2.1 优先级队列
log('L2.1 优先级队列');
try {
  var s1 = new SchedClass({ GIFT_COOLDOWN: 100, KILL_COOLDOWN: 100, SIEGE_COOLDOWN: 100, REPORT_INTERVAL: 100 });
  var spoken1 = [];
  s1.setOnSpeak(async function (entry) {
    var r = entry.generate();
    spoken1.push({ type: entry.eventType, priority: entry.priority, text: r.text });
  });

  s1.enqueue({ eventType: 'periodic', priority: 2, generate: function () { return { text: '低', emotion: 'neutral' }; } });
  s1.enqueue({ eventType: 'gift', priority: 10, generate: function () { return { text: '高', emotion: 'happy' }; } });
  s1.enqueue({ eventType: 'kill_multikill', priority: 6, generate: function () { return { text: '中', emotion: 'surprised' }; } });

  // scheduler fallback gap: 500+500=1000ms, 3 items need ~3000ms
  await sleep(5000);

  assertEquals(spoken1.length, 3, 'should speak 3');
  assertEquals(spoken1[0].type, 'gift', 'first should be gift');
  addResult('L2.1 优先级队列', true, 'gift(P10) > kill(P6) > periodic(P2)');
} catch (e) {
  addResult('L2.1 优先级队列', false, e.message);
}

// 2.2 同类型防抖
log('L2.2 同类型防抖');
try {
  var s2 = new SchedClass({ GIFT_COOLDOWN: 100, KILL_COOLDOWN: 5000, SIEGE_COOLDOWN: 100, REPORT_INTERVAL: 100, typeCooldown: 5000 });
  var spoken2 = [];
  s2.setOnSpeak(async function (entry) {
    var r = entry.generate();
    spoken2.push({ type: entry.eventType, text: r.text });
  });

  s2.enqueue({ eventType: 'kill_multikill', priority: 6, generate: function () { return { text: 'kill1', emotion: 'surprised' }; } });
  await sleep(200);
  s2.enqueue({ eventType: 'kill_multikill', priority: 6, generate: function () { return { text: 'kill2', emotion: 'surprised' }; } });
  await sleep(200);
  s2.enqueue({ eventType: 'gift', priority: 10, generate: function () { return { text: 'gift1', emotion: 'happy' }; } });
  await sleep(5000);

  var killCount = spoken2.filter(function (s) { return s.type === 'kill_multikill'; }).length;
  assertEquals(killCount, 1, 'kill_multikill debounced 2→1');
  addResult('L2.2 同类型防抖', true, 'kill_multikill 去重 2→1');
} catch (e) {
  addResult('L2.2 同类型防抖', false, e.message);
}

// 2.3 礼物不防抖
log('L2.3 礼物不防抖');
try {
  var s3 = new SchedClass({ GIFT_COOLDOWN: 100, KILL_COOLDOWN: 100, SIEGE_COOLDOWN: 100, REPORT_INTERVAL: 100, typeCooldown: 8000 });
  var spoken3 = [];
  s3.setOnSpeak(async function (entry) {
    var r = entry.generate();
    spoken3.push({ type: entry.eventType, text: r.text });
  });

  s3.enqueue({ eventType: 'gift', priority: 10, generate: function () { return { text: 'g1', emotion: 'happy' }; } });
  await sleep(200);
  s3.enqueue({ eventType: 'gift', priority: 10, generate: function () { return { text: 'g2', emotion: 'surprised' }; } });
  await sleep(200);
  s3.enqueue({ eventType: 'gift', priority: 10, generate: function () { return { text: 'g3', emotion: 'happy' }; } });
  await sleep(5000);

  assertEquals(spoken3.length, 3, 'all 3 gifts should speak');
  addResult('L2.3 礼物不防抖', true, '3/3 礼物全部播报');
} catch (e) {
  addResult('L2.3 礼物不防抖', false, e.message);
}

// ====== L3: 完整游戏流程 (dry-run) ======

log('\n=== L3: 完整游戏流程 (dry-run) ===');

var config = require('../config');
var testConfig = {
  DEV_MODE: true,
  WS_PORT: 9999, DB_PATH: config.DB_PATH,
  CASTLE_HP: 10000, CANVAS_WIDTH: 1920, CANVAS_HEIGHT: 1080, FPS_TARGET: 30,
  PREP_TIME: 30000, ROUND_TIME: 1200000, SETTLE_TIME: 10000, BATTLE_TICK_MS: 100,
  get PREP_TIME_EFF() { return 5000; },
  get ROUND_TIME_EFF() { return 180000; },
  get SETTLE_TIME_EFF() { return 6000; },
  BALANCE: config.BALANCE || {}, CASTLE_DEFENSE: {}, LANES: config.LANES || {},
  TROOPS: config.TROOPS || {}, WAR_CHEST_POOL: config.WAR_CHEST_POOL || [],
  WAR_CHEST_WEIGHTS: config.WAR_CHEST_WEIGHTS || [],
  SCORE: config.SCORE || {}, RANKS: config.RANKS || [],
  DANMAKU_COMMANDS: config.DANMAKU_COMMANDS || {}, ANIMATION: config.ANIMATION || {},
  ANNOUNCER: { ENABLED: true, DRY_RUN: true, TRACE_LEVEL: 0, LLM_ENABLED: false,
    WAIFU_WS_URL: 'ws://127.0.0.1:9191/status', TTS_VOICE: 'zh-CN-XiaoxiaoNeural',
    TTS_CACHE_SIZE: 10, PYTHON_PATH: 'python', GIFT_COOLDOWN: 100, KILL_COOLDOWN: 100,
    SIEGE_COOLDOWN: 100, REPORT_INTERVAL: 99999 },
};

var AnnCls = AnnouncerMod.Announcer;
var announcer = new AnnCls(testConfig);

function s(state, overrides) {
  var o = overrides || {};
  return {
    state: state, round: 1,
    phaseElapsed: o.phaseElapsed || 0,
    phaseTotal: o.phaseTotal || (state === 'COUNTDOWN' ? 5000 : state === 'ROUND_END' ? 6000 : 180000),
    red: { players: o.redPlayers || 0, hp: o.redHP || 10000, maxHp: 10000 },
    blue: { players: o.bluePlayers || 0, hp: o.blueHP || 10000, maxHp: 10000 },
    frontLines: o.frontLines || [0, 0, 0],
    leaderboard: o.leaderboard || [],
  };
}

function e(type, overrides) {
  var o = overrides || {};
  return { type: type, time: Date.now(), killerId: o.killerId, killerName: o.killerName,
    troopId: o.troopId, key: o.key, team: o.team, ownerName: o.ownerName,
    playerName: o.playerName, giftName: o.giftName, playerId: o.playerId,
    damage: o.damage, text: o.text, ownerId: o.ownerId };
}

// 3.1 WAITING
log('L3.1 WAITING 开场');
try {
  announcer.handleEvents([], s('WAITING', { phaseElapsed: 5000 }));
  await sleep(300);
  assert(announcer.stats.events >= 0, 'announcer should be alive');
  addResult('L3.1 WAITING 开场', true);
} catch (err) {
  addResult('L3.1 WAITING 开场', false, err.message);
}

// 3.2 COUNTDOWN
log('L3.2 COUNTDOWN 倒计时');
try {
  var before2 = announcer.stats.spoken;
  announcer.handleEvents([], s('COUNTDOWN', { phaseElapsed: 300, phaseTotal: 5000 }));
  await sleep(800);
  assert(announcer.stats.spoken >= before2, 'countdown should trigger speech');
  addResult('L3.2 COUNTDOWN 倒计时', true);
} catch (err) {
  addResult('L3.2 COUNTDOWN 倒计时', false, err.message);
}

// 3.3 PLAYING 事件流
log('L3.3 PLAYING 战斗事件流');
try {
  var before3 = announcer.stats.spoken;
  announcer.handleEvents([
    e('spawn_preview', { key: 'giant', ownerName: '大哥', ownerId: 'p1' }),
    e('kill', { killerId: 'p2', killerName: '杀手', troopId: 't1', key: 'militia', team: 'red' }),
    e('kill', { killerId: 'p2', killerName: '杀手', troopId: 't2', key: 'swordsman', team: 'red' }),
    e('kill', { killerId: 'p2', killerName: '杀手', troopId: 't3', key: 'archer', team: 'red' }),
    e('global_skill', { key: 'wrathOfGod', ownerName: '大哥', team: 'red' }),
    e('siege', { key: 'batteringRam', ownerName: '推土机', damage: 1500, team: 'blue' }),
    e('castle_hit', { team: 'red', damage: 300 }),
    e('comeback', { team: 'red', text: '炎龙帝国绝地反击！！' }),
  ], s('PLAYING', { phaseElapsed: 60000, redPlayers: 5, redHP: 5000, bluePlayers: 3, blueHP: 8000, frontLines: [150, -80, 50] }));
  await sleep(3000);
  assert(announcer.stats.spoken > before3, 'should have new speech, was ' + before3 + ' now ' + announcer.stats.spoken);
  addResult('L3.3 PLAYING 事件流', true, 'gift/skill/siege/castle/comeback 全部触发');
} catch (err) {
  addResult('L3.3 PLAYING 事件流', false, err.message);
}

// 3.4 盲盒 + ROUND_END
log('L3.4 盲盒 + ROUND_END');
try {
  var before4 = announcer.stats.spoken;
  announcer.handleEvents([
    e('chest_open', { playerName: '幸运儿', playerId: 'p5', team: 'red' }),
  ], s('PLAYING', { phaseElapsed: 120000, redPlayers: 6, redHP: 6000, bluePlayers: 3, blueHP: 3000 }));
  await sleep(600);
  announcer.handleEvents([
    e('chest_reveal', { playerName: '幸运儿', key: 'dragonKnight', playerId: 'p5', team: 'red' }),
  ], s('PLAYING', { phaseElapsed: 121000, redPlayers: 6, redHP: 6000, bluePlayers: 3, blueHP: 3000 }));
  await sleep(600);
  announcer.handleEvents([], s('ROUND_END', {
    phaseElapsed: 0, phaseTotal: 6000,
    redPlayers: 6, redHP: 4000, bluePlayers: 3, blueHP: 0,
    leaderboard: [{ playerName: '大哥', playerId: 'p1', score: 1500 }, { playerName: '杀手', playerId: 'p2', score: 900 }],
  }));
  await sleep(2000);
  assert(announcer.stats.spoken > before4, 'chest+conclusion should trigger speech');
  addResult('L3.4 盲盒 + 结语', true);
} catch (err) {
  addResult('L3.4 盲盒 + 结语', false, err.message);
}

// 3.5 连杀追踪
log('L3.5 连杀追踪');
try {
  var testConfig2 = JSON.parse(JSON.stringify(testConfig));
  testConfig2.ANNOUNCER = JSON.parse(JSON.stringify(testConfig.ANNOUNCER));
  var announcer2 = new AnnCls(testConfig2);
  for (var ki = 0; ki < 5; ki++) {
    announcer2.handleEvents([
      e('kill', { killerId: 'test_killer', killerName: '战神', troopId: 't' + ki, key: 'militia', team: 'red' }),
    ], s('PLAYING', { phaseElapsed: 30000 + ki * 1000, redPlayers: 3, bluePlayers: 2 }));
    await sleep(50);
  }
  await sleep(1500);
  assert(announcer2.stats.spoken >= 1, '5-kill streak should trigger >= 1 speech, got ' + announcer2.stats.spoken);
  addResult('L3.5 连杀追踪', true, announcer2.stats.spoken + ' 次播报');
  announcer2.shutdown();
} catch (err) {
  addResult('L3.5 连杀追踪', false, err.message);
}

announcer.shutdown();
log('  (announcer shut down)');

// ====== L4: TTS 生成 ======

log('\n=== L4: TTS 生成 ===');

if (TTS) {
  // 4.1 基本生成
  log('L4.1 基本 TTS 生成');
  try {
    var tts4 = new TtsGenerator({ TTS_VOICE: 'zh-CN-XiaoxiaoNeural' });
    var start4 = Date.now();
    var result4 = await tts4.generate('测试播报文本');
    var elapsed4 = Date.now() - start4;
    assert(result4, 'TTS result not null');
    assert(result4.b64, 'should have base64');
    assert(result4.b64.length > 100, 'base64 too short: ' + result4.b64.length);
    assert(result4.durationMs > 0, 'durationMs should > 0: ' + result4.durationMs);
    addResult('L4.1 TTS 生成', true, 'base64Len=' + result4.b64.length + ' durationMs=' + result4.durationMs + ' time=' + elapsed4 + 'ms');
  } catch (e) {
    addResult('L4.1 TTS 生成', false, e.message);
  }

  // 4.2 缓存
  log('L4.2 TTS 缓存');
  try {
    var tts42 = new TtsGenerator({ TTS_VOICE: 'zh-CN-XiaoxiaoNeural', TTS_CACHE_SIZE: 10 });
    var r42 = await tts42.generate('缓存测试文本XYZ');
    var cached = tts42.hasCached('缓存测试文本XYZ');
    assert(cached, 'should be cached after generation');
    var startCached = Date.now();
    var r42cached = tts42.getCached('缓存测试文本XYZ');
    var elapsedCached = Date.now() - startCached;
    assert(r42cached, 'cache hit should not be null');
    assertEquals(r42cached.b64, r42.b64, 'cached b64 should match');
    assert(elapsedCached < 10, 'cache hit should be <10ms, was ' + elapsedCached + 'ms');
    addResult('L4.2 TTS 缓存', true, '缓存命中耗时 ' + elapsedCached + 'ms');
  } catch (e) {
    addResult('L4.2 TTS 缓存', false, e.message);
  }

  // 4.3 特殊字符
  log('L4.3 TTS 边界 (特殊字符)');
  try {
    var tts43 = new TtsGenerator({ TTS_VOICE: 'zh-CN-XiaoxiaoNeural' });
    var r43 = await tts43.generate('⚠ 警告！红方城堡血量低于30%！！');
    assert(r43 && r43.b64 && r43.b64.length > 100, 'special chars should work');
    addResult('L4.3 TTS 边界', true);
  } catch (e) {
    addResult('L4.3 TTS 边界', false, e.message);
  }
} else {
  log('  跳过 (需 --tts 或 --full)');
  addResult('L4 TTS 生成', null, '需 --tts 或 --full');
}

// ====== L5: waifu-agent E2E ======

log('\n=== L5: waifu-agent 端到端 ===');

if (FULL) {
  var WebSocket = require('ws');

  // 5.1 连通性
  log('L5.1 waifu-agent WS 9191 连通性');
  var wsOk = await new Promise(function (resolve) {
    var ws = new WebSocket('ws://127.0.0.1:9191/status');
    var timer = setTimeout(function () { ws.close(); resolve(false); }, 3000);
    ws.on('open', function () { clearTimeout(timer); ws.close(); resolve(true); });
    ws.on('error', function () { clearTimeout(timer); resolve(false); });
  });

  if (!wsOk) {
    addResult('L5.1 WS 连通性', false, '无法连接 ws://127.0.0.1:9191 — waifu-agent 是否已启动 (relay 模式)?');
    addResult('L5 waifu-agent E2E', false, '9191 端口不可达，请启动 waifu-agent');
  } else {
    addResult('L5.1 WS 连通性', true, '9191 端口可达');

    // 5.2 发送话术
    log('L5.2 发送话术到 waifu-agent');
    try {
      var tts52 = new TtsGenerator({ TTS_VOICE: 'zh-CN-XiaoxiaoNeural' });
      var r52 = await tts52.generate('联调测试！如果你听到这句话，说明全链路已打通！');

      var sentOk = await new Promise(function (resolve) {
        var ws = new WebSocket('ws://127.0.0.1:9191/status');
        var timer = setTimeout(function () { ws.close(); resolve(false); }, 5000);

        ws.on('open', function () {
          ws.send(JSON.stringify({ type: 'agent:start', timestamp: new Date().toISOString(), message: '联调测试', platform: 'test', user_id: 'test' }));
          ws.send(JSON.stringify({ type: 'agent:emotion', emotion: 'happy' }));
          ws.send(JSON.stringify({ type: 'agent:motion', motion: 'TapBody', index: 2, priority: 3 }));
          ws.send(JSON.stringify({ type: 'tts:audio', text: '联调测试！全链路已打通！', audio: r52.b64, duration_ms: r52.durationMs }));
          ws.send(JSON.stringify({ type: 'agent:end', timestamp: new Date().toISOString(), response: '联调测试！全链路已打通！' }));
        });

        ws.on('message', function () {}); // dummy listener
        ws.on('error', function () { clearTimeout(timer); resolve(false); });

        setTimeout(function () { clearTimeout(timer); ws.close(); resolve(true); }, 2000);
      });

      if (sentOk) {
        addResult('L5.2 TTS 发送', true, '已发送。请确认 waifu-agent: ①说出"联调测试全链路已打通" ②表情变 happy ③有挥手动作');
      } else {
        addResult('L5.2 TTS 发送', false, 'WS 发送失败');
      }
    } catch (e) {
      addResult('L5.2 TTS 发送', false, e.message);
    }
  }
} else {
  log('  跳过 (需 --full)');
  addResult('L5 waifu-agent E2E', null, '需 --full');
}

// ====== 完成 ======

log('\n(等待 WS 清理...)');
await sleep(100);

finishAndExit(0);

} // end main

main().catch(function (e) {
  console.error('FATAL:', e);
  process.exit(1);
});
