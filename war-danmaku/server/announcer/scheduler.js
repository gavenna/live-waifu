/**
 * 话术调度器 — 优先级队列 + 去重 + 冷却
 *
 * 规则:
 *   P10: 礼物感谢 — 必须说, 几乎不防抖
 *   P9:  翻盘/技能/盲盒 — 急迫兴奋事件
 *   P8:  高级兵预告/最后2分钟
 *   P7:  攻城/城堡受损 — 防抖 5s
 *   P6:  连杀 — 防抖 4s
 *   P5:  加入/随机事件
 *   P4:  普通击杀 — 防抖 4s
 *   P3:  阶段切换
 *   P2:  定期战况/开场 — 可能被 LLM 替代
 *   免费民兵 spawn 永远静默
 *
 * 同一事件类型在 typeCooldownMs 内 → 丢弃
 * 队列 > 5 条时丢弃低优先级（< P7）
 */

const logger = require('../logger');

const PRIORITY = {
  gift: 10,
  comeback: 9, global_skill: 9, chest_open: 9, chest_reveal: 9,
  spawn_preview: 8, final_2min: 8,
  siege: 7, castle_hit: 7,
  kill_multikill: 6,
  join: 5, random_event: 5, follow: 5,
  kill: 4,
  phase: 3,
  periodic: 2, opening: 2,
};

const Q_MAX = 10;

class Scheduler {
  constructor(config = {}) {
    this.cfg = {
      giftCooldown: config.GIFT_COOLDOWN || 2000,
      killCooldown: config.KILL_COOLDOWN || 4000,
      siegeCooldown: config.SIEGE_COOLDOWN || 5000,
      reportInterval: config.REPORT_INTERVAL || 30000,
      typeCooldown: 8000,   // 同类事件最小间隔
    };

    this._queue = [];             // { priority, entry }
    this._lastTypeTime = {};     // 每个 eventType 的上次播报时间
    this._lastReportTime = 0;    // 上次定期战况播报时间
    this._lastPhaseMsg = {};     // 阶段消息去重 { phaseKey: lastTime }
    this._speaking = false;
    this._currentEntry = null;
    this._onSpeak = null;        // (entry) => Promise<void>  由 Announcer 设置
    this._batchTimer = null;     // 批次窗口计时器
    this._batchDelay = 100;      // 同 tick 内事件合并窗口 (ms)
  }

  /** 外部注入的 speak 回调 */
  setOnSpeak(fn) { this._onSpeak = fn; }

  get queueLength() { return this._queue.length; }
  get isSpeaking() { return this._speaking; }

  /**
   * 将一个话术条目入队
   * @param {object} entry - { eventType, priority, generate: () => { text, emotion, motion } }
   */
  enqueue(entry) {
    const now = Date.now();

    // 类型冷却检查
    const lastTime = this._lastTypeTime[entry.eventType] || 0;
    const cooldown = entry.eventType === 'gift' ? this.cfg.giftCooldown
      : entry.eventType === 'kill' || entry.eventType === 'kill_multikill' ? this.cfg.killCooldown
      : (entry.eventType === 'siege' || entry.eventType === 'castle_hit') ? this.cfg.siegeCooldown
      : this.cfg.typeCooldown;

    // 礼物永远不防抖（钱的事不能等）
    if (entry.eventType !== 'gift' && (now - lastTime) < cooldown) {
      logger.info('[ANNOUNCER] 防抖丢弃: ' + entry.eventType + ' (' + (now - lastTime) + 'ms since last)');
      return;
    }

    // 队列溢出保护
    if (this._queue.length >= Q_MAX) {
      // 找最低优先级的非礼物条目丢弃
      let minIdx = -1, minPri = Infinity;
      for (let i = 0; i < this._queue.length; i++) {
        if (this._queue[i].priority < minPri && !this._queue[i].entry.eventType.startsWith('gift')) {
          minPri = this._queue[i].priority;
          minIdx = i;
        }
      }
      if (minIdx >= 0 && minPri < (entry.priority || 5)) {
        logger.info('[ANNOUNCER] 队列溢出，丢弃低优先级: ' + this._queue[minIdx].entry.eventType);
        this._queue.splice(minIdx, 1);
      } else {
        logger.info('[ANNOUNCER] 队列满，丢弃: ' + entry.eventType);
        return;
      }
    }

    this._queue.push({ priority: entry.priority || 5, entry, time: now });
    this._queue.sort((a, b) => b.priority - a.priority); // 降序

    logger.info('[ANNOUNCER] 入队 #' + this._queue.length + ' p=' + (entry.priority || 5) + ' ' + entry.eventType);

    if (!this._speaking) this._scheduleBatch();
  }

  /** 批次窗口: 同 tick 内多个事件先排队，窗口关闭后取最高优先级播报 */
  _scheduleBatch() {
    if (this._batchTimer) return; // 窗口已开，等待
    this._batchTimer = setTimeout(() => {
      this._batchTimer = null;
      this._dispatchNext();
    }, this._batchDelay);
  }

  /** 阶段消息 —— 同一个阶段 key 在 phaseCooldownMs 内只播一次 */
  enqueuePhase(phaseKey, entry, phaseCooldownMs = 15000) {
    const now = Date.now();
    if (this._lastPhaseMsg[phaseKey] && (now - this._lastPhaseMsg[phaseKey]) < phaseCooldownMs) return;
    this._lastPhaseMsg[phaseKey] = now;
    this.enqueue(entry);
  }

  async _dispatchNext() {
    if (this._queue.length === 0) return;
    if (this._speaking) return;
    if (!this._onSpeak) return;

    const item = this._queue.shift();
    this._speaking = true;
    this._currentEntry = item.entry;

    const now = Date.now();
    this._lastTypeTime[item.entry.eventType] = now;

    let durationMs = 0;
    try {
      durationMs = await this._onSpeak(item.entry) || 0;
    } catch (e) {
      logger.error('[ANNOUNCER] speak 失败: ' + e.message);
    } finally {
      this._speaking = false;
      this._currentEntry = null;
      // 等当前音频播完 + 500ms 空隙，再发下一条
      if (this._queue.length > 0) {
        const gap = (durationMs > 500 ? durationMs : 500) + 500;
        setTimeout(() => this._dispatchNext(), gap);
      }
    }
  }

  /** 跳过当前正在说的话 */
  skip() {
    this._speaking = false;
    this._currentEntry = null;
    if (this._queue.length > 0) this._dispatchNext();
  }

  reset() {
    if (this._batchTimer) { clearTimeout(this._batchTimer); this._batchTimer = null; }
    this._queue = [];
    this._lastTypeTime = {};
    this._lastPhaseMsg = {};
    this._lastReportTime = 0;
    this._speaking = false;
    this._currentEntry = null;
  }
}

module.exports = { Scheduler, PRIORITY };
