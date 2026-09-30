/**
 * Announcer — 虚拟主播话术引擎
 *
 * 监听 GameEngine 的游戏事件，生成话术文本 → TTS → waifu-agent WS 中继。
 *
 * 两条路径:
 *   模板路径 (templateEngine) — 礼物/击杀/攻城等高频事件，缓存秒出
 *   LLM 路径  (llmEngine)      — 战况分析/拱火/弹幕互动，30s 一次上限
 *
 * 挂载方式: gameEngine.onEvent((events, summary) => announcer.handleEvents(events, summary))
 */

const { WsRelayClient } = require('./wsRelayClient');
const { Scheduler, PRIORITY } = require('./scheduler');
const { generate, generatePhase, troopName, teamName, giftTier, cleanForTts } = require('./templateEngine');
const { TtsGenerator } = require('./ttsGenerator');
const { LlmEngine } = require('./llmEngine');
const logger = require('../logger');

const REPORT_INTERVAL = 30000;
const PHASE_COOLDOWN = 15000;

class Announcer {
  constructor(config) {
    const ac = config.ANNOUNCER || {};

    this.enabled = ac.ENABLED !== false;
    if (!this.enabled) {
      logger.info('[ANNOUNCER] 已禁用');
      return;
    }

    // 子模块
    this.ws = new WsRelayClient(ac.WAIFU_WS_URL);
    this.scheduler = new Scheduler(ac);
    this.tts = new TtsGenerator(ac);
    this.llm = new LlmEngine({ ...ac, LLM_API_KEY: config._llmApiKey || '' });

    // 诊断开关
    this.dryRun = ac.DRY_RUN === true;      // true=跳过 TTS, 只打印话术文本
    this.traceLevel = ac.TRACE_LEVEL || 0;  // 0=正常 1=管线追踪 2=全量调试

    // 统计
    this.stats = { events: 0, spoken: 0, skipped: 0, ttsMs: 0, ttsCount: 0 };

    // 事件缓冲（供 LLM 用）
    this._recentEvents = [];      // 最近事件文本摘要
    this._lastReportTime = 0;
    this._lastPhaseMsg = {};
    this._gameStarted = false;
    this._gameStartTime = 0;
    this._phaseElapsed = 0;
    this._stateSummary = null;
    this._lastState = null;
    this._lastSnapshot = null;

    // 连杀追踪 { killerId: { count, lastTime } }
    this._killStreaks = new Map();
    this._killStreakTimeout = 10000; // 10s 内无击杀重置

    // 城堡伤害累积 { red: { dmg, hp, lastReport }, blue: { dmg, hp, lastReport } }
    this._castleDmg = { red: { dmg: 0, hp: 0, lastReport: 0 }, blue: { dmg: 0, hp: 0, lastReport: 0 } };
    this._castleDmgThreshold = 100;    // 累积伤害 > 此值才播
    this._castleDmgMaxGap = 15000;     // 超过此间隔强制播（即使伤害不够）

    // 绑定调度器回调
    this.scheduler.setOnSpeak((entry) => this._speak(entry));

    // TTS 就绪后连接 waifu-agent
    this._init();
  }

  async _init() {
    // 先连 waifu-agent（非阻塞，毫秒级），确保后续事件能立即发送
    this.ws.connect();

    if (this.dryRun) {
      logger.info('[ANNOUNCER] 就绪 [DRY-RUN]');
      return;
    }

    logger.info('[ANNOUNCER] 初始化...');

    // 预生成常用短语 — fire-and-forget，不阻塞事件处理
    this.tts.preGenerate([
      '欢迎来到战场！还没选阵营的抓紧了，发1加红方，发2加蓝方！',
      '战斗开始！红蓝双方，全军出击！',
      '感谢支持！',
    ]).then(() => {
      logger.info('[ANNOUNCER] 预生成完成');
    }).catch(e => {
      logger.warn('[ANNOUNCER] 预生成失败: ' + e.message);
    });

    logger.info('[ANNOUNCER] 就绪');
  }

  /** GameEngine 事件回调 — 在 pushState() 中调用 */
  handleEvents(events, summary) {
    if (!this.enabled) return;

    this._stateSummary = summary;
    this._phaseElapsed = summary.phaseElapsed;
    this.stats.events += events.length;

    // 新回合开始 → 清空上一轮积压
    if (summary.state === 'COUNTDOWN' && this._lastState === 'ROUND_END') {
      logger.info('[ANNOUNCER] 新回合 → 清空队列');
      this.scheduler.reset();
      this._recentEvents = [];
      this._killStreaks.clear();
      this._lastSnapshot = null;
      this._castleDmg = { red: { dmg: 0, hp: 0, lastReport: 0 }, blue: { dmg: 0, hp: 0, lastReport: 0 } };
    }
    this._lastState = summary.state;

    if (this.traceLevel >= 2) {
      const types = events.map(e => e.type).join(',');
      logger.info(`[ANNOUNCER:TRACE] tick events(${events.length}): [${types}] state=${summary.state} red=${summary.red.hp}/${summary.red.maxHp}(${summary.red.players}p) blue=${summary.blue.hp}/${summary.blue.maxHp}(${summary.blue.players}p)`);
    }

    if (summary.state === 'WAITING') {
      this._gameStarted = false;
    }

    // 阶段触发 — 必须在 _gameStarted 标记之前，否则 game_start 判定会失效
    this._maybePhaseTrigger(summary);

    if (summary.state === 'PLAYING' && !this._gameStarted) {
      this._gameStarted = true;
      this._gameStartTime = Date.now();
    }

    // 处理每个事件
    for (const evt of events) {
      this._handleEvent(evt, summary);
    }

    // 定期战况播报（有变化才报）
    this._maybeReport(summary);

    // 城堡伤害累积检查
    this._flushCastleDmg(summary);

    // 记录上次快照用于变化检测
    this._lastSnapshot = {
      redHP: summary.red.hp, blueHP: summary.blue.hp,
      redPlayers: summary.red.players, bluePlayers: summary.blue.players,
      frontLines: summary.frontLines ? summary.frontLines.join(',') : '',
    };
  }

  /** 城堡伤害累积播报 — 只在伤害够大或 HP 跌破关键比例时播 */
  _flushCastleDmg(summary) {
    const now = Date.now();
    for (const team of ['red', 'blue']) {
      const acc = this._castleDmg[team];
      const hp = summary[team] ? summary[team].hp : acc.hp;
      if (hp > 0) acc.hp = hp;
      const hpPct = summary[team] ? summary[team].hp / summary[team].maxHp : 1;

      if (acc.dmg <= 0) continue;

      const timeSinceLast = now - acc.lastReport;
      const shouldReport = acc.dmg >= this._castleDmgThreshold
        || timeSinceLast >= this._castleDmgMaxGap
        || hpPct <= 0.5
        || hpPct <= 0.25;

      if (shouldReport) {
        const vars = { teamName: teamName(team), damage: String(acc.dmg) };
        this.scheduler.enqueue({
          eventType: 'castle_hit', priority: PRIORITY.castle_hit,
          generate: () => generate('castle_hit', vars),
        });
        acc.dmg = 0;
        acc.lastReport = now;
      }
    }
  }

  /** 分发单个事件到模板引擎 */
  _handleEvent(evt, summary) {
    switch (evt.type) {

      // === 礼物 ===
      case 'spawn_preview': {
        const tier = giftTier(evt.key);
        const tname = troopName(evt.key);
        const gname = evt.giftName || tname;
        const pname = evt.ownerName || evt.playerName || '';
        const vars = { playerName: pname, giftName: gname, troopName: tname };
        const entry = {
          eventType: 'gift',
          priority: tier === 'premium' ? 10 : tier === 'medium' ? 10 : 10,
          generate: () => generate('gift_' + tier, vars),
        };
        this.scheduler.enqueue(entry);
        break;
      }

      case 'chest_open': {
        const vars = { playerName: evt.playerName };
        this.scheduler.enqueue({
          eventType: 'chest_open', priority: PRIORITY.chest_open,
          generate: () => generate('chest_open', vars),
        });
        break;
      }

      case 'chest_reveal': {
        const vars = { playerName: evt.playerName, troopName: troopName(evt.key) };
        this.scheduler.enqueue({
          eventType: 'chest_reveal', priority: PRIORITY.chest_reveal,
          generate: () => generate('chest_reveal', vars),
        });
        break;
      }

      // === 击杀 ===
      case 'kill': {
        const now = Date.now();
        let streak = this._killStreaks.get(evt.killerId);
        if (!streak || (now - streak.lastTime) > this._killStreakTimeout) {
          streak = { count: 0, lastTime: now };
        }
        streak.count++;
        streak.lastTime = now;
        this._killStreaks.set(evt.killerId, streak);

        if (streak.count >= 3) {
          const vars = { killerName: evt.killerName, count: String(streak.count) };
          this.scheduler.enqueue({
            eventType: 'kill_multikill', priority: PRIORITY.kill_multikill,
            generate: () => generate('kill_multikill', vars),
          });
        }
        break;
      }

      // === 技能 ===
      case 'global_skill': {
        const skillName = evt.key === 'wrathOfGod' ? '天神之怒' : '火矢齐射';
        const vars = { ownerName: evt.ownerName, skillName };
        this.scheduler.enqueue({
          eventType: 'global_skill', priority: PRIORITY.global_skill,
          generate: () => generate('global_skill', vars),
        });
        break;
      }

      // === 攻城 ===
      case 'siege': {
        const vars = { ownerName: evt.ownerName, damage: String(evt.damage || 0) };
        this.scheduler.enqueue({
          eventType: 'siege', priority: PRIORITY.siege,
          generate: () => generate('siege', vars),
        });
        break;
      }

      case 'castle_hit':
      case 'soldier_attack_castle': {
        const team = evt.team || 'red';
        const acc = this._castleDmg[team];
        acc.dmg += (evt.damage || 0);
        if (evt.hp !== undefined) acc.hp = evt.hp;
        break; // 不立即播 — 等 _flushCastleDmg 在 handleEvents 末尾检查
      }

      // === 翻盘 ===
      case 'comeback': {
        const team = evt.team || 'red';
        const vars = { teamName: teamName(team), text: evt.text || '' };
        this.scheduler.enqueue({
          eventType: 'comeback', priority: PRIORITY.comeback,
          generate: () => {
            const tpl = generate('comeback', vars);
            // 优先用事件自带文本
            if (evt.text && evt.text.length > 2) tpl.text = evt.text;
            return tpl;
          },
        });
        break;
      }

      // === 随机事件 ===
      case 'random_event': {
        const vars = { text: evt.text || '' };
        this.scheduler.enqueue({
          eventType: 'random_event', priority: PRIORITY.random_event,
          generate: () => generate('random_event', vars),
        });
        break;
      }

      // === 关注 ===
      case 'follow': {
        const vars = { playerName: evt.playerName || '' };
        this.scheduler.enqueue({
          eventType: 'follow', priority: PRIORITY.follow,
          generate: () => generate('follow', vars),
        });
        break;
      }

      // === 弹幕 — 加到缓冲区，LLM 择机处理 ===
      case 'danmaku_text': {
        if (evt.text && evt.playerName) {
          this._recentEvents.push(evt.playerName + '说:' + evt.text);
          if (this._recentEvents.length > 20) this._recentEvents.shift();
        }
        break;
      }

      // === 龙骑士技能 ===
      case 'dragon_breath': {
        const vars = { ownerName: evt.ownerName || '' };
        this.scheduler.enqueue({
          eventType: 'global_skill', priority: PRIORITY.global_skill,
          generate: () => generate('dragon_breath', vars),
        });
        break;
      }

      case 'dragon_roar': {
        const vars = { ownerName: evt.ownerName || '' };
        this.scheduler.enqueue({
          eventType: 'global_skill', priority: PRIORITY.global_skill,
          generate: () => generate('dragon_roar', vars),
        });
        break;
      }
    }
  }

  /** 定期战况播报 — 只在数据有变化时播 */
  _maybeReport(summary) {
    if (summary.state !== 'PLAYING') return;
    const now = Date.now();
    const interval = this.scheduler.cfg.reportInterval || 30000;
    if (now - this._lastReportTime < interval) return;

    // 变化检测：HP 变化 < 10% 且人数/战线无变化 → 跳过
    if (this._lastSnapshot) {
      const prev = this._lastSnapshot;
      const hpChangeRed = Math.abs(summary.red.hp - prev.redHP) / summary.red.maxHp;
      const hpChangeBlue = Math.abs(summary.blue.hp - prev.blueHP) / summary.blue.maxHp;
      const playersChanged = summary.red.players !== prev.redPlayers || summary.blue.players !== prev.bluePlayers;
      const linesChanged = (summary.frontLines ? summary.frontLines.join(',') : '') !== prev.frontLines;

      if (hpChangeRed < 0.1 && hpChangeBlue < 0.1 && !playersChanged && !linesChanged) {
        logger.info('[ANNOUNCER] 定期战况跳过 (无变化)');
        this._lastReportTime = now;
        return;
      }
    }

    this._lastReportTime = now;

    const redPct = Math.round(summary.red.hp / summary.red.maxHp * 100);
    const bluePct = Math.round(summary.blue.hp / summary.blue.maxHp * 100);
    const advantage = redPct > bluePct ? '红' : '蓝';

    const vars = {
      redHP: redPct + '%', blueHP: bluePct + '%',
      redPlayers: String(summary.red.players), bluePlayers: String(summary.blue.players),
      advantage,
    };

    // 尝试 LLM
    if (this.llm.enabled && this.llm.apiKey) {
      const focus = Math.abs(redPct - bluePct) > 30 ? 'trash_talk' : 'analysis';
      this.llm.generate({
        phase: 'PLAYING',
        red: summary.red, blue: summary.blue,
        frontLines: summary.frontLines,
        recentEvents: this._recentEvents,
        focus,
      }).then(parsed => {
        if (parsed) {
          this.scheduler.enqueue({
            eventType: 'periodic_llm', priority: 2,
            generate: () => parsed,
          });
        } else {
          // 降级到模板
          this.scheduler.enqueue({
            eventType: 'periodic', priority: 2,
            generate: () => generatePhase('periodic', vars),
          });
        }
      }).catch(() => {
        this.scheduler.enqueue({
          eventType: 'periodic', priority: 2,
          generate: () => generatePhase('periodic', vars),
        });
      });
    } else {
      this.scheduler.enqueue({
        eventType: 'periodic', priority: 2,
        generate: () => generatePhase('periodic', vars),
      });
    }
  }

  /** 阶段触发消息 */
  _maybePhaseTrigger(summary) {
    const state = summary.state;
    const elapsed = summary.phaseElapsed;

    // WAITING 阶段 — 仅首局候场（服务器刚启动，round=0）
    if (state === 'WAITING') {
      this.scheduler.enqueuePhase('opening', {
        eventType: 'phase_opening', priority: 2,
        generate: () => generatePhase('opening'),
      }, 60000);
    }

    // COUNTDOWN 阶段 — 拉人 + 倒计时
    if (state === 'COUNTDOWN') {
      const secondsTotal = Math.ceil(summary.phaseTotal / 1000);
      const secondsLeft = Math.ceil((summary.phaseTotal - elapsed) / 1000);

      // 进入 COUNTDOWN 时招募一波
      this.scheduler.enqueuePhase('countdown_recruit', {
        eventType: 'phase_countdown_recruit', priority: 2,
        generate: () => generatePhase('countdown_recruit'),
      }, secondsTotal > 15 ? 15000 : 10000);

      // 最后 5 秒倒计时
      if (secondsLeft > 0 && secondsLeft <= 5) {
        this.scheduler.enqueuePhase('countdown_' + secondsLeft, {
          eventType: 'phase_countdown', priority: 3,
          generate: () => generatePhase('countdown', { seconds: String(secondsLeft) }),
        }, PHASE_COOLDOWN);
      }
    }

    // PLAYING 开始 — 开战播报
    if (state === 'PLAYING' && !this._gameStarted) {
      this.scheduler.enqueuePhase('game_start', {
        eventType: 'phase_start', priority: 3,
        generate: () => generatePhase('start'),
      }, 60000);
    }

    // PLAYING 最后 2 分钟
    if (state === 'PLAYING' && summary.phaseTotal > 0) {
      const remaining = summary.phaseTotal - elapsed;
      if (remaining > 0 && remaining <= 120000 && remaining + 100 > 120000) {
        this.scheduler.enqueuePhase('final2min', {
          eventType: 'phase_final', priority: 8,
          generate: () => generatePhase('final2min'),
        }, 60000);
      }
    }

    // ROUND_END — 结语
    if (state === 'ROUND_END') {
      const lb = summary.leaderboard || [];
      const mvp = lb.length > 0 ? (lb[0].playerName || lb[0].playerId || '未知') : '未知';
      const svp = lb.length > 1 ? (lb[1].playerName || lb[1].playerId || '未知') : '未知';
      const winner = summary.red.hp > summary.blue.hp ? '红' : '蓝';

      this.scheduler.enqueuePhase('conclusion', {
        eventType: 'phase_end', priority: 3,
        generate: () => {
          this.scheduler.enqueue({
            eventType: 'phase_end_detail', priority: 3,
            generate: () => generatePhase('conclusion', { mvp, svp }),
          });
          return generate('game_end', { teamName: teamName(winner) });
        },
      }, 30000);
    }
  }

  /** 执行话术: 生成话术文本 → TTS → WS 发送。返回实际音频时长(ms)供调度器同步。 */
  async _speak(entry) {
    const result = entry.generate();
    if (!result || !result.text) {
      this.stats.skipped++;
      return 0;
    }

    this.stats.spoken++;
    const t0 = Date.now();

    // Dry-run 模式: 只打印，不生成 TTS，不发送 WS。模拟 3 秒时长。
    if (this.dryRun) {
      logger.info(`[ANNOUNCER] 💬 "${result.text}"  [${result.emotion}]${result.motion ? ' [' + result.motion.group + ']' : ''}`);
      return 3000;
    }

    // 生成 TTS（用清洗后的文本，去掉 emoji/符号避免被朗读）
    const ttsText = cleanForTts(result.text);
    let b64, durationMs;
    try {
      const ttsResult = await this.tts.generate(ttsText);
      b64 = ttsResult.b64;
      durationMs = ttsResult.durationMs;
      this.stats.ttsMs += (Date.now() - t0);
      this.stats.ttsCount++;
    } catch (e) {
      logger.error(`[ANNOUNCER] TTS 生成失败: ${e.message} — "${result.text}"`);
      return 0;
    }

    // 生产模式也打 info 日志
    logger.info(`[ANNOUNCER] 🎤 "${result.text}" (${durationMs}ms) [${result.emotion}]`);

    if (this.traceLevel >= 1) {
      logger.info(`[ANNOUNCER:TRACE] → WS tts:audio base64Len=${b64.length}`);
    }

    this.ws.speak({
      text: result.text,
      audioBase64: b64,
      durationMs,
      emotion: result.emotion,
      motion: result.motion,
      verbose: this.traceLevel >= 1,
    });

    return durationMs;
  }

  /** 重置状态 */
  reset() {
    this.scheduler.reset();
    this._recentEvents = [];
    this._killStreaks.clear();
    this._castleDmg = { red: { dmg: 0, hp: 0, lastReport: 0 }, blue: { dmg: 0, hp: 0, lastReport: 0 } };
    this._gameStarted = false;
    this._gameStartTime = 0;
  }

  /** 断开连接 */
  shutdown() {
    this.ws.disconnect();
    this.scheduler.reset();
    if (this.traceLevel >= 1) this._dumpStats();
  }

  /** 输出统计 */
  _dumpStats() {
    const avgTts = this.stats.ttsCount > 0 ? Math.round(this.stats.ttsMs / this.stats.ttsCount) : 0;
    logger.info(`[ANNOUNCER:STATS] events=${this.stats.events} spoken=${this.stats.spoken} skipped=${this.stats.skipped} ttsAvg=${avgTts}ms ttsCount=${this.stats.ttsCount} dryRun=${this.dryRun}`);
  }
}

module.exports = { Announcer };
