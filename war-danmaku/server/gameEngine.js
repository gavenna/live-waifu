/**
 * 游戏引擎 — 状态机 + 主循环 + 指令路由
 *
 * 管理游戏生命周期: WAITING → COUNTDOWN → PLAYING → ROUND_END → WAITING
 * 集成 Battle（战斗）、Ranking（排行）、wsServer（消息路由）
 */

const { broadcast, onMessage } = require('./wsServer');
const { Battle } = require('./battle');
const { Ranking } = require('./ranking');
const config = require('./config');
const logger = require('./logger');
const assert = require('./assert');

const STATE = {
  WAITING: 'WAITING',
  COUNTDOWN: 'COUNTDOWN',
  PLAYING: 'PLAYING',
  ROUND_END: 'ROUND_END',
};

const VALID_STATES = Object.values(STATE);

class GameEngine {
  constructor(cfg, db) {
    this.config = cfg;
    this.state = STATE.WAITING;
    this.round = 0;
    this.roundTimer = null;
    this.tickTimer = null;
    this.startTime = 0;
    this.phaseStartedAt = 0;

    // 子系统
    this.battle = new Battle();
    this.db = db || null;
    this.ranking = new Ranking(this.db);
    if (this.db) this.ranking.load();

    // 游戏数据（每局重置）
    this.redTeam = { players: new Map(), castleHP: cfg.CASTLE_HP };
    this.blueTeam = { players: new Map(), castleHP: cfg.CASTLE_HP };

    // 本局统计
    this.roundStats = { kills: new Map(), damageDealt: new Map(), gifts: new Map() };

    // D2: 指令冷却 { playerId: { command: lastUsedTime } }
    this.commandCooldowns = new Map();

    // D2: 冷却配置 (ms)
    this.COOLDOWNS = { spawn_militia_3: 3000, spawn_spearman_2: 3000, spawn_bowman_2: 3000, spawn_raider_2: 3000 };

    // 事件队列（本 tick 产生的事件，推给前端后清空）
    this.pendingEvents = [];

    // 事件监听器（Announcer 等外部模块订阅）
    this.eventListeners = [];

    // 翻盘追踪（每局重置）
    this._comebackState = { red: false, blue: false, redMaxFL: 0, blueMaxFL: 0 };

    // 随机事件（每局重置）
    this._nextRandomEvent = 0;
    this._randomEventPool = [
      { type: 'reinforce', name: '援军到达', textFn: function(t) { return t + '方援军到达！'; } },
      { type: 'fire_rain', name: '天降火雨', textFn: function(t) { return '🔥 天降火雨袭击' + t + '方！'; } },
      { type: 'king_charge', name: '国王亲征', textFn: function(t) { return '👑 国王亲征' + t + '方！'; } },
    ];

    // 注册 WS 消息处理
    onMessage((msg) => this.handleMessage(msg));
  }

  // ============================================================
  //  生命周期
  // ============================================================

  start() {
    if (this.state !== STATE.WAITING && this.state !== 'STOPPED') {
      logger.info('[ENGINE] 无法启动: 当前状态 ' + this.state);
      return;
    }
    logger.info('[ENGINE] 开始新一轮');
    this.startRound();
  }

  stop() {
    clearTimeout(this.roundTimer);
    clearInterval(this.tickTimer);
    this.roundTimer = null;
    this.tickTimer = null;
    this.state = 'STOPPED';
    logger.info('[ENGINE] Stopped');
  }

  reset() {
    this.stop();
    this.round = 0;
    this.red = { players: new Map(), castleHP: this.config.CASTLE_HP, troops: [] };
    this.blue = { players: new Map(), castleHP: this.config.CASTLE_HP, troops: [] };
    this.pendingEvents = [];
    this.state = 'STOPPED';
    logger.info('[ENGINE] Reset to initial state');
  }

  /** 跳过 COUNTDOWN 直接开打 */
  startPlaying() {
    clearTimeout(this.roundTimer);
    this.state = STATE.PLAYING;
    this.phaseStartedAt = Date.now();
    logger.info(`[ENGINE] Round ${this.round} — PLAYING`);
    this.pushState();

    this.tickTimer = setInterval(() => this.tick(), this.config.BATTLE_TICK_MS);

    this.roundTimer = setTimeout(() => {
      this.endRound();
    }, this.config.ROUND_TIME_EFF);
  }

  startRound() {
    this.round++;
    this.state = STATE.COUNTDOWN;
    this.redTeam.castleHP = this.config.CASTLE_HP;
    this.blueTeam.castleHP = this.config.CASTLE_HP;
    this.redTeam.players.clear();
    this.blueTeam.players.clear();
    this.battle = new Battle();
    this.roundStats = { kills: new Map(), damageDealt: new Map(), gifts: new Map() };
    this._comebackState = { red: false, blue: false, redMaxFL: 0, blueMaxFL: 0 };
    this._nextRandomEvent = Date.now() + 40000 + Math.random() * 20000; // 40-60s 后首次事件
    this.startTime = Date.now();
    this.phaseStartedAt = Date.now();  // COUNTDOWN 阶段起点

    logger.info(`[ENGINE] Round ${this.round} — COUNTDOWN (${this.config.PREP_TIME_EFF / 1000}s)`);
    this.pushState();

    this.roundTimer = setTimeout(() => {
      this.startPlaying();
    }, this.config.PREP_TIME_EFF);
  }

  endRound() {
    clearInterval(this.tickTimer);
    clearTimeout(this.roundTimer);
    this.state = STATE.ROUND_END;
    this.phaseStartedAt = Date.now();  // 结算阶段起点

    const duration = Math.round((Date.now() - this.startTime) / 1000);
    const winner = this.redTeam.castleHP > this.blueTeam.castleHP ? 'red'
      : this.blueTeam.castleHP > this.redTeam.castleHP ? 'blue' : 'draw';

    logger.info(`[ENGINE] Round ${this.round} — END (${duration}s, winner=${winner})`);
    logger.info(`[ENGINE] 红方: ${this.redTeam.players.size}人 ${this.redTeam.castleHP}HP | 蓝方: ${this.blueTeam.players.size}人 ${this.blueTeam.castleHP}HP`);

    // 积分结算
    this.settleScores(winner);
    this.pushState();

    this.roundTimer = setTimeout(() => {
      this.startRound();
    }, this.config.SETTLE_TIME_EFF);
  }

  // ============================================================
  //  战斗 tick
  // ============================================================

  tick() {
    if (this.state !== STATE.PLAYING) return;

    const battleResult = this.battle.update(this.config.BATTLE_TICK_MS,
      this.redTeam.castleHP / this.config.CASTLE_HP,
      this.blueTeam.castleHP / this.config.CASTLE_HP);

    // 处理战斗事件
    for (const event of battleResult.events) {
      switch (event.type) {
        case 'global_skill': {
          const targetTeam = event.team === 'red' ? this.blueTeam : this.redTeam;
          targetTeam.castleHP -= event.damage;
          if (event.castleDmg > 0) {
            const castleDmg = Math.round(this.config.CASTLE_HP * event.castleDmg);
            targetTeam.castleHP -= castleDmg;
            logger.info(`[ENGINE] ${event.ownerName} 天神之怒! ${event.team}→${event.team === 'red' ? '蓝' : '红'}方 城堡-${castleDmg}HP`);
          }
          if (event.slow > 0) {
            targetTeam.castleHP -= Math.round(event.damage * event.slow);
          }
          this.pendingEvents.push(event);
          this.addStat('damageDealt', event.ownerId, event.damage);
          break;
        }
        case 'siege': {
          const targetTeam = event.team === 'red' ? this.blueTeam : this.redTeam;
          targetTeam.castleHP -= event.damage;
          logger.info(`[ENGINE] ${event.ownerName} 攻城! ${event.team}→${event.team === 'red' ? '蓝' : '红'}方城堡 -${event.damage}HP`);
          this.pendingEvents.push(event);
          this.addStat('damageDealt', event.ownerId, event.damage);
          break;
        }
        case 'kill': {
          this.addStat('kills', event.killerId, 1);
          this.pendingEvents.push(event);
          break;
        }
        case 'spawn': {
          this.pendingEvents.push(event);
          break;
        }
        case 'castle_arrow': {
          this.pendingEvents.push(event);
          break;
        }
        case 'castle_hit':
        case 'soldier_attack_castle': {
          const targetTeam = event.team === 'red' ? this.blueTeam : this.redTeam;
          targetTeam.castleHP -= event.damage;
          logger.debug(`[ENGINE] ${event.ownerName} 攻城! ${event.team}→${event.team === 'red' ? '蓝' : '红'}方城堡 -${event.damage}HP`);
          this.pendingEvents.push(event);
          this.addStat('damageDealt', event.ownerId, event.damage);
          break;
        }
        case 'comeback':
        case 'chest_open':
        case 'chest_reveal':
        case 'random_event': {
          this.pendingEvents.push(event);
          break;
        }
      }
    }

    // 检查城堡血量
    this.redTeam.castleHP = Math.max(0, this.redTeam.castleHP);
    this.blueTeam.castleHP = Math.max(0, this.blueTeam.castleHP);
    assert.castleHP(this.redTeam.castleHP, 'red');
    assert.castleHP(this.blueTeam.castleHP, 'blue');

    if (this.redTeam.castleHP <= 0 || this.blueTeam.castleHP <= 0) {
      logger.info(`[ENGINE] 城堡摧毁 — 红:${this.redTeam.castleHP}HP 蓝:${this.blueTeam.castleHP}HP → 回合结束`);
      this.endRound();
      return;
    }

    // 翻盘检测：劣势方反向推过中线
    var avgFL = this.battle.frontLines.reduce(function(a, b) { return a + b; }, 0) / 3;
    var cs = this._comebackState;
    if (avgFL > 0) { cs.redMaxFL = Math.max(cs.redMaxFL, avgFL); }
    else { cs.blueMaxFL = Math.max(cs.blueMaxFL, -avgFL); }
    var redHpPct = this.redTeam.castleHP / this.config.CASTLE_HP;
    var blueHpPct = this.blueTeam.castleHP / this.config.CASTLE_HP;
    // 红方翻盘：红方HP劣势但战线反推到蓝方>400
    if (!cs.red && redHpPct < 0.4 && blueHpPct > 0.6 && avgFL > 400 && cs.redMaxFL > 400) {
      cs.red = true;
      this.pendingEvents.push({ type: 'comeback', team: 'red', text: '炎龙帝国绝地反击！！', time: Date.now() });
      logger.info('[ENGINE] 🔥 翻盘时刻！红方绝地反击！');
    }
    // 蓝方翻盘
    if (!cs.blue && blueHpPct < 0.4 && redHpPct > 0.6 && avgFL < -400 && cs.blueMaxFL > 400) {
      cs.blue = true;
      this.pendingEvents.push({ type: 'comeback', team: 'blue', text: '霜狼联盟绝地反击！！', time: Date.now() });
      logger.info('[ENGINE] 🔥 翻盘时刻！蓝方绝地反击！');
    }

    // 随机事件
    var nowEvt = Date.now();
    if (nowEvt >= this._nextRandomEvent) {
      this._nextRandomEvent = nowEvt + 40000 + Math.random() * 20000;
      var evt = this._randomEventPool[Math.floor(Math.random() * this._randomEventPool.length)];
      var evtTeam = Math.random() < 0.5 ? 'red' : 'blue';
      var evtName = evt.textFn(evtTeam === 'red' ? '炎龙帝国' : '霜狼联盟');
      var enemyTeam = evtTeam === 'red' ? 'blue' : 'red';
      logger.info('[ENGINE] ⚡ 随机事件: ' + evt.name + ' → ' + evtTeam + '方');
      // 执行事件效果
      if (evt.type === 'reinforce') {
        for (var ri = 0; ri < 8; ri++) {
          this.battle.spawnTroop(evtTeam, 'militia', 'event', evtName);
        }
      } else if (evt.type === 'fire_rain') {
        for (var fi = 0; fi < this.battle.troops.length; fi++) {
          var ft = this.battle.troops[fi];
          if (ft.animState === 'death' || ft.hp <= 0) continue;
          if (ft.team === enemyTeam) { ft.hp -= 20; ft._lastHitAt = nowEvt; }
        }
      } else if (evt.type === 'king_charge') {
        this.battle.spawnTroop(evtTeam, 'giant', 'event', evtName);
      }
      this.pendingEvents.push({ type: 'random_event', team: evtTeam, text: evtName, evtType: evt.type, time: nowEvt });
    }

    // 动态平衡
    this.applyBalance();

    // 指挥官伤害加成 (×1.3)
    var cmdrs = this._getCommanders();
    for (var ci = 0; ci < this.battle.troops.length; ci++) {
      var ct = this.battle.troops[ci];
      if (ct.animState === 'death') continue;
      if ((ct.team === 'red' && ct.ownerId === cmdrs.red) || (ct.team === 'blue' && ct.ownerId === cmdrs.blue)) {
        if (!ct._origDmg) ct._origDmg = ct.damage;
        ct.damage = Math.round(ct._origDmg * 1.3);
      }
    }

    this.pushState();
  }

  // ============================================================
  //  动态平衡
  // ============================================================

  applyBalance() {
    const bal = this.config.BALANCE;
    if (this.state !== STATE.PLAYING) return;

    const redCount = this.redTeam.players.size;
    const blueCount = this.blueTeam.players.size;

    // 计算人数平衡倍率
    let minority = null;
    let outnumberMult = 0;
    if (redCount > 0 && blueCount > 0) {
      const ratio = Math.max(redCount, blueCount) / Math.min(redCount, blueCount);
      if (ratio > bal.OUTNUMBER_RATIO) {
        minority = redCount < blueCount ? 'red' : 'blue';
        outnumberMult = bal.OUTNUMBER_BUFF;
      }
    }

    // 劣势城堡倍率
    const redHpRatio = this.redTeam.castleHP / this.config.CASTLE_HP;
    const blueHpRatio = this.blueTeam.castleHP / this.config.CASTLE_HP;

    for (const t of this.battle.troops) {
      if (t.animState === 'death') continue;
      // 存储原始伤害（首次）
      if (!t._origDmg) t._origDmg = t.damage;

      let mult = 1;
      if (t.team === minority) mult += outnumberMult;

      if (t.team === 'red' && redHpRatio < bal.COMEBACK_THRESHOLD) mult += bal.COMEBACK_BUFF;
      if (t.team === 'blue' && blueHpRatio < bal.COMEBACK_THRESHOLD) mult += bal.COMEBACK_BUFF;

      // 可逆：每 tick 重算，buff 消失时自动恢复
      t.damage = Math.round(t._origDmg * mult);
    }
  }

  // ============================================================
  //  消息处理
  // ============================================================

  handleMessage(msg) {
    switch (msg.type) {
      case 'join':
        assert.playerId(msg.playerId, 'handleMessage:join');
        assert.validTeam(msg.team);
        this.handleJoin(msg.team, msg.playerId, msg.playerName);
        break;
      case 'danmaku':
        assert.playerId(msg.playerId, 'handleMessage:danmaku');
        this.handleDanmaku(msg.text, msg.playerId, msg.playerName, msg.displayText);
        break;
      case 'gift':
        assert.playerId(msg.playerId, 'handleMessage:gift');
        this.handleGift(msg.troopKey || msg.giftId, msg.playerId, msg.playerName, msg.giftName);
        break;
      case 'admin':
        this.handleAdmin(msg.action);
        break;
      default:
        logger.debug(`[ENGINE] Unknown message type: ${msg.type}`);
    }
  }

  handleJoin(team, playerId, playerName) {
    assert.playerId(playerId, 'handleJoin');
    assert.validTeam(team);

    const otherTeam = team === 'red' ? this.blueTeam : this.redTeam;
    otherTeam.players.delete(playerId);

    const targetTeam = team === 'red' ? this.redTeam : this.blueTeam;
    if (!targetTeam.players.has(playerId)) {
      targetTeam.players.set(playerId, {
        id: playerId,
        name: playerName || playerId,
        joinedAt: Date.now(),
      });
      logger.info(`[ENGINE] ${playerName || playerId} → ${team === 'red' ? '红方' : '蓝方'} (${targetTeam.players.size}人)`);
    }

    this.ranking.getOrCreate(playerId);
  }

  handleDanmaku(text, playerId, playerName, displayText) {
    if (!text) return;
    text = text.trim();

    const cmd = this.config.DANMAKU_COMMANDS[text];
    if (!cmd) {
      logger.info(`[DANMAKU] 弹幕: "${text}" (${playerName || playerId})`);
      if (displayText) {
        this.pendingEvents.push({ type: 'danmaku_text', text: displayText, playerId, playerName, time: Date.now() });
      }
      return;
    }

    logger.debug(`[DANMAKU] "${text}" → ${cmd} (${playerName || playerId})`);

    const team = this.getPlayerTeam(playerId);
    const actualTeam = team || (Math.random() < 0.5 ? 'red' : 'blue');
    if (!team) {
      this.handleJoin(actualTeam, playerId, playerName);
    }

    switch (cmd) {
      case 'join_red':
        this.handleJoin('red', playerId, playerName);
        this.pendingEvents.push({ type: 'danmaku_text', text: `${playerName || playerId} 加入了炎龙帝国！`, playerId, playerName, time: Date.now() });
        break;
      case 'join_blue':
        this.handleJoin('blue', playerId, playerName);
        this.pendingEvents.push({ type: 'danmaku_text', text: `${playerName || playerId} 加入了霜狼联盟！`, playerId, playerName, time: Date.now() });
        break;
      case 'spawn_militia_3': {
        if (!this._checkSpawnCooldown(playerId, cmd, playerName)) return;
        if (this.state === STATE.PLAYING) {
          this._spawnTroops(actualTeam, 'militia', 3, playerId, playerName);
          const name = playerName || playerId;
          let spawnMsg = displayText || `${name} 号召民兵出击！`;
          if (!displayText && text === '666') spawnMsg = `${name} 为主播助威！⚔ 民兵出击`;
          this.pendingEvents.push({ type: 'danmaku_text', text: spawnMsg, playerId, playerName, time: Date.now() });
        }
        break;
      }
      case 'spawn_spearman_2': {
        if (!this._checkSpawnCooldown(playerId, cmd, playerName)) return;
        if (this.state === STATE.PLAYING) {
          this._spawnTroops(actualTeam, 'spearman', 2, playerId, playerName);
          const name = playerName || playerId;
          const spawnMsg = displayText || `${name} 派出矛兵列阵！`;
          this.pendingEvents.push({ type: 'danmaku_text', text: spawnMsg, playerId, playerName, time: Date.now() });
        }
        break;
      }
      case 'spawn_bowman_2': {
        if (!this._checkSpawnCooldown(playerId, cmd, playerName)) return;
        if (this.state === STATE.PLAYING) {
          this._spawnTroops(actualTeam, 'bowman', 2, playerId, playerName);
          const name = playerName || playerId;
          const spawnMsg = displayText || `${name} 派出弓兵放箭！`;
          this.pendingEvents.push({ type: 'danmaku_text', text: spawnMsg, playerId, playerName, time: Date.now() });
        }
        break;
      }
      case 'spawn_raider_2': {
        if (!this._checkSpawnCooldown(playerId, cmd, playerName)) return;
        if (this.state === STATE.PLAYING) {
          this._spawnTroops(actualTeam, 'raider', 2, playerId, playerName);
          const name = playerName || playerId;
          const spawnMsg = displayText || `${name} 派出突袭兵冲锋！`;
          this.pendingEvents.push({ type: 'danmaku_text', text: spawnMsg, playerId, playerName, time: Date.now() });
        }
        break;
      }
    }
  }

  handleGift(troopKey, playerId, playerName, giftName) {
    assert.playerId(playerId, 'handleGift');
    if (!troopKey) { logger.warn(`[GIFT] troopKey 缺失 (player=${playerId})`); return; }
    if (this.state !== STATE.PLAYING) {
      logger.debug(`[GIFT] ${playerName || playerId} 送礼 ${troopKey} 被忽略 — 非战斗阶段 (state=${this.state})`);
      return;
    }

    let team = this.getPlayerTeam(playerId);
    if (!team) {
      team = Math.random() < 0.5 ? 'red' : 'blue';
      this.handleJoin(team, playerId, playerName);
    }

    let actualKey = this.config.TROOPS[troopKey] ? troopKey : null;
    if (!actualKey) { logger.warn(`[GIFT] 未知兵种 key: ${troopKey}`); return; }
    const troopDef = this.config.TROOPS[actualKey];
    const troopName = troopDef ? troopDef.name : actualKey;
    const isChest = troopDef && troopDef.random;  // 盲盒
    const isPremium = troopDef && troopDef.cost >= 99 && !troopDef.globalSkill && !troopDef.siege && !isChest;
    const name = playerName || playerId;
    const thanks = giftName ? `感谢 ${name} 的「${giftName}」！` : '';

    if (isChest) {
      // 盲盒：2s 悬念 → 揭示
      const chestText = thanks
        ? `${thanks} 开启战争宝箱…`
        : `${name} 开启战争宝箱…`;
      this.pendingEvents.push({ type: 'chest_open', team, playerId, playerName, text: chestText, time: Date.now() });
      logger.info(`[GIFT] ${name} 开启战争宝箱`);
      setTimeout(() => {
        const chestTroop = this.battle.spawnTroop(team, 'warChest', playerId, playerName);
        if (chestTroop) {
          const revealedName = this.config.TROOPS[chestTroop.key]
            ? this.config.TROOPS[chestTroop.key].name : chestTroop.key;
          this.pendingEvents.push({
            type: 'chest_reveal', team, key: chestTroop.key, playerId, playerName,
            text: `${name} 的战争宝箱开出 ${revealedName}！！`, time: Date.now(),
          });
          const giftScore = chestTroop.damage * this.config.SCORE.GIFT_MULTIPLIER;
          this.addStat('gifts', playerId, giftScore);
          logger.info(`[GIFT] ${name} 盲盒开出 ${chestTroop.key} → ${team}方`);
        }
      }, 2000);
    } else if (isPremium) {
      const previewText = thanks
        ? `${thanks} 正在召唤 ${troopName}…`
        : `${name} 正在召唤 ${troopName}…`;
      this.pendingEvents.push({
        type: 'spawn_preview',
        team, key: actualKey, ownerId: playerId, ownerName: playerName,
        giftName: giftName || '',
        text: previewText,
        time: Date.now(),
      });
      logger.info(`[GIFT] ${name} 预告召唤 ${actualKey}`);

      setTimeout(() => {
        const delayed = this.battle.spawnTroop(team, actualKey, playerId, playerName);
        if (delayed) {
          const giftScore = delayed.damage * this.config.SCORE.GIFT_MULTIPLIER;
          this.addStat('gifts', playerId, giftScore);
          logger.info(`[GIFT] ${name} 送出 ${actualKey} → ${team}方 (伤害:${delayed.damage} 积分:+${giftScore})`);
        }
      }, 1000);
    } else {
      const troop = this.battle.spawnTroop(team, actualKey, playerId, playerName);
      if (troop) {
        // 非全局技能 & 非攻城 → 触发 spawn_preview 让前端和 Announcer 显示
        if (!troopDef.globalSkill && !troopDef.siege) {
          const previewText = thanks
            ? `${thanks} 召唤了 ${troopName}！`
            : `${name} 召唤了 ${troopName}！`;
          this.pendingEvents.push({
            type: 'spawn_preview',
            team, key: actualKey, ownerId: playerId, ownerName: playerName,
            giftName: giftName || '',
            text: previewText,
            time: Date.now(),
          });
        }
        const giftScore = troop.damage * this.config.SCORE.GIFT_MULTIPLIER;
        this.addStat('gifts', playerId, giftScore);
        logger.info(`[GIFT] ${name} 送出 ${actualKey} → ${team}方 (伤害:${troop.damage} 积分:+${giftScore})`);
      }
    }
  }

  handleAdmin(action) {
    logger.info(`[ENGINE] Admin action: ${action} (state=${this.state})`);

    switch (action) {
      case 'skip_countdown':
        if (this.state === STATE.COUNTDOWN) {
          this.startPlaying();
        }
        break;
      case 'end_round':
        if (this.state === STATE.PLAYING) {
          this.endRound();
        }
        break;
      case 'reset':
        clearInterval(this.tickTimer);
        clearTimeout(this.roundTimer);
        this.startRound();
        break;
      case 'reset_rankings':
        this.ranking.reset();
        logger.info('[ENGINE] 排行榜已重置');
        this.pushState();
        break;
      default:
        logger.warn(`[ENGINE] Unknown admin action: ${action}`);
    }
  }

  // ============================================================
  //  积分结算
  // ============================================================

  settleScores(winner) {
    // 辅助：获取玩家名字
    const getName = (playerId) => {
      const rp = this.redTeam.players.get(playerId);
      const bp = this.blueTeam.players.get(playerId);
      return (rp || bp || {}).name || playerId;
    };

    for (const [playerId, kills] of this.roundStats.kills) {
      let score = kills * this.config.SCORE.KILL;
      if (kills >= 10) score = Math.round(score * this.config.SCORE.MULTI_KILL_10);
      else if (kills >= 5) score = Math.round(score * this.config.SCORE.MULTI_KILL_5);
      this.ranking.addScore(playerId, score, getName(playerId));
    }

    if (winner !== 'draw') {
      const winTeam = winner === 'red' ? this.redTeam : this.blueTeam;
      for (const [playerId] of winTeam.players) {
        this.ranking.addScore(playerId, this.config.SCORE.WIN_BONUS, getName(playerId));
      }
    }

    const mvp = this.getTopPlayer('damageDealt', winner);
    const svp = this.getTopPlayer('damageDealt', winner === 'red' ? 'blue' : 'red');
    if (mvp) this.ranking.addScore(mvp, this.config.SCORE.MVP_BONUS, getName(mvp));
    if (svp) this.ranking.addScore(svp, this.config.SCORE.SVP_BONUS, getName(svp));

    for (const [playerId, giftValue] of this.roundStats.gifts) {
      this.ranking.addScore(playerId, giftValue, getName(playerId));
    }

    // 持久化对局记录
    if (this.db) {
      const duration = Math.round((Date.now() - this.startTime) / 1000);
      const result = this.db.insertRound(winner, duration);
      const roundId = result.lastInsertRowid;

      const allPlayerIds = new Set([
        ...this.redTeam.players.keys(), ...this.blueTeam.players.keys(),
      ]);
      for (const pid of allPlayerIds) {
        const team = this.redTeam.players.has(pid) ? 'red' : 'blue';
        this.db.insertRoundPlayer(
          roundId, pid, team,
          this.roundStats.kills.get(pid) || 0,
          this.roundStats.damageDealt.get(pid) || 0,
          this.roundStats.gifts.get(pid) || 0,
        );
      }
      logger.info(`[ENGINE] Round ${this.round} 已写入 DB (id=${roundId})`);
    }

    logger.info(`[ENGINE] MVP: ${mvp || 'none'} (+${this.config.SCORE.MVP_BONUS}), SVP: ${svp || 'none'} (+${this.config.SCORE.SVP_BONUS})`);
  }

  // ============================================================
  //  辅助方法
  // ============================================================

  getPlayerTeam(playerId) {
    if (this.redTeam.players.has(playerId)) return 'red';
    if (this.blueTeam.players.has(playerId)) return 'blue';
    return null;
  }

  addStat(stat, playerId, amount) {
    const map = this.roundStats[stat];
    map.set(playerId, (map.get(playerId) || 0) + amount);
  }

  getTopPlayer(stat, team) {
    const teamPlayers = team === 'red' ? this.redTeam.players : this.blueTeam.players;
    let best = null, bestVal = 0;
    for (const [playerId] of teamPlayers) {
      const val = this.roundStats[stat]?.get(playerId) || 0;
      if (val > bestVal) { bestVal = val; best = playerId; }
    }
    return best;
  }

  _getCommanders() {
    var redCmdr = null, blueCmdr = null;
    var redMax = 0, blueMax = 0;
    this.roundStats.damageDealt.forEach(function(dmg, pid) {
      if (this.redTeam.players.has(pid) && dmg > redMax) { redCmdr = pid; redMax = dmg; }
      if (this.blueTeam.players.has(pid) && dmg > blueMax) { blueCmdr = pid; blueMax = dmg; }
    }.bind(this));
    return { red: redCmdr, blue: blueCmdr };
  }

  /** 推送当前状态到前端 */
  pushState() {
    const now = Date.now();
    let phaseTotal = 0;
    if (this.state === STATE.COUNTDOWN) phaseTotal = this.config.PREP_TIME_EFF;
    else if (this.state === STATE.PLAYING) phaseTotal = this.config.ROUND_TIME_EFF;
    else if (this.state === STATE.ROUND_END) phaseTotal = this.config.SETTLE_TIME_EFF;

    const state = {
      type: 'game_state',
      state: this.state,
      round: this.round,
      red: {
        playerCount: this.redTeam.players.size,
        castleHP: this.redTeam.castleHP,
      },
      blue: {
        playerCount: this.blueTeam.players.size,
        castleHP: this.blueTeam.castleHP,
      },
      frontLines: this.battle.frontLines,        // 三线战线 [n,n,n]
      frontLine: this.battle.frontLine,          // 向后兼容：三线均值
      lanes: [0, 1, 2].map(i => ({              // 三线数据
        frontLine: this.battle.frontLines[i],
        pressure: this.battle.getLanePressure(i),
      })),
      time: now - this.startTime,
      phaseElapsed: now - this.phaseStartedAt,
      phaseTotal,
      maxHP: this.config.CASTLE_HP,
      devMode: this.config.DEV_MODE,
      commanders: { red: redCmdr, blue: blueCmdr },
      canvas: {
        width: this.config.CANVAS_WIDTH,
        height: this.config.CANVAS_HEIGHT,
      },
    };

    // 指挥官 = 每方伤害最高的玩家
    var redCmdr = null, blueCmdr = null;
    var redMaxDmg = 0, blueMaxDmg = 0;
    this.roundStats.damageDealt.forEach(function(dmg, pid) {
      if (this.redTeam.players.has(pid) && dmg > redMaxDmg) { redCmdr = pid; redMaxDmg = dmg; }
      if (this.blueTeam.players.has(pid) && dmg > blueMaxDmg) { blueCmdr = pid; blueMaxDmg = dmg; }
    }.bind(this));

    // 通知外部监听器（Announcer 等），所有状态都通知（状态切换也需要）
    if (this.eventListeners.length > 0) {
      const summary = {
        state: this.state, round: this.round,
        phaseElapsed: Date.now() - this.phaseStartedAt,
        phaseTotal,
        red: { players: this.redTeam.players.size, hp: this.redTeam.castleHP, maxHp: this.config.CASTLE_HP },
        blue: { players: this.blueTeam.players.size, hp: this.blueTeam.castleHP, maxHp: this.config.CASTLE_HP },
        frontLines: this.battle.frontLines,
        leaderboard: null,
      };
      const snapshot = this.pendingEvents.slice();
      for (const cb of this.eventListeners) {
        try { cb(snapshot, summary); } catch (e) { /* 不影响游戏主循环 */ }
      }
    }

    if (this.state === STATE.PLAYING || this.state === STATE.ROUND_END) {
      state.troops = this.battle.troops.map(t => ({
        id: t.id,
        team: t.team,
        lane: t.lane,          // 所属兵线 0/1/2
        key: t.key,
        x: t.x,
        y: t.y,
        hp: t.hp,
        maxHp: t.maxHp,
        speed: t.speed,
        ownerName: t.ownerName,
        showAvatar: t.showAvatar,
        avatarSize: t.avatarSize,
        elite: t.key === 'royalGuard',
        boss: t.key === 'giant' || t.key === 'dragonKnight',
        ranged: t.ranged,
        animState: t.animState || 'idle',
        lastHitAt: t._lastHitAt || 0,
        isCommander: (t.team === 'red' && t.ownerId === redCmdr) || (t.team === 'blue' && t.ownerId === blueCmdr),
      }));

      state.leaderboard = this.ranking.getLeaderboard(10);

      state.events = this.pendingEvents.slice(0, 20);
      this.pendingEvents = [];
    }

    broadcast(state);
  }

  /** 注册事件监听器 — 每个 tick 在 pushState 前调用 */
  onEvent(callback) {
    this.eventListeners.push(callback);
  }

  /** 移除事件监听器 */
  offEvent(callback) {
    const idx = this.eventListeners.indexOf(callback);
    if (idx >= 0) this.eventListeners.splice(idx, 1);
  }

  // === D2: 指令冷却 ===

  isOnCooldown(playerId, command) {
    const playerCD = this.commandCooldowns.get(playerId);
    if (!playerCD) return false;
    const cdMs = this.COOLDOWNS[command];
    if (!cdMs) return false;
    const lastUsed = playerCD[command] || 0;
    return (Date.now() - lastUsed) < cdMs;
  }

  setCooldown(playerId, command) {
    if (!this.commandCooldowns.has(playerId)) {
      this.commandCooldowns.set(playerId, {});
    }
    this.commandCooldowns.get(playerId)[command] = Date.now();
  }

  /** 检查出兵冷却，返回 false=冷却中/已阻断 */
  _checkSpawnCooldown(playerId, cmd, playerName) {
    if (this.isOnCooldown(playerId, cmd)) {
      logger.debug(`[DANMAKU] "${cmd}" 冷却中 — ${playerName || playerId}`);
      return false;
    }
    this.setCooldown(playerId, cmd);
    return true;
  }

  /** 批量出兵 */
  _spawnTroops(team, troopKey, count, playerId, playerName) {
    for (let i = 0; i < count; i++) {
      this.battle.spawnTroop(team, troopKey, playerId, playerName);
    }
  }
}

module.exports = { GameEngine, STATE };
