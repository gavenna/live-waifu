/**
 * LLM 话术引擎 — 战况分析 / 拱火 / 弹幕互动
 *
 * 调用 DeepSeek API（HTTP POST），生成自然解说词。
 * 频率上限 30s 一次，超时 10s 降级到模板。
 *
 * LLM 输出格式: [emotion][motion:TapBody] 口语文本
 * 解析后返回 { text, emotion, motion }
 *
 * Phase 3 完整实现，Phase 1-2 用静默 stub。
 */

const logger = require('../logger');

const SYSTEM_PROMPT = `你是战争弹幕游戏的虚拟主播，负责解说中世纪阵营对战游戏。
规则：
- 红方=炎龙帝国，蓝方=霜狼部落
- 观众发弹幕选阵营（1红2蓝），刷礼物出兵对战
- 双方互推城堡，先破城者胜

你的特点：
- 风格活泼有感染力，像体育比赛解说
- 时不时拱火调侃，"红方这么菜的吗" "蓝方大哥在哪"
- 每句话不超过30字，口语化
- 以标签开头: [happy/sad/angry/surprised/neutral] 控制表情
- 可选: [motion:TapBody] 触发动作

不要说"根据最新战况""作为AI主播"这类装AI的话。
你就是主播本人，自然说话。`;

class LlmEngine {
  constructor(config = {}) {
    this.apiUrl = config.LLM_API_URL || 'https://api.deepseek.com/v1/chat/completions';
    this.apiKey = config.LLM_API_KEY || '';
    this.model = config.LLM_MODEL || 'deepseek-chat';
    this.timeoutMs = config.LLM_TIMEOUT || 10000;
    this.lastCallTime = 0;
    this.minInterval = config.LLM_INTERVAL || 30000;
    this.enabled = config.LLM_ENABLED !== false;
  }

  setApiKey(key) { this.apiKey = key; }

  /**
   * 生成战况解说
   * @param {object} context - 游戏上下文
   * @param {string} context.phase - 当前阶段 (PLAYING/ROUND_END...)
   * @param {object} context.red - { players, hp, maxHp }
   * @param {object} context.blue - { players, hp, maxHp }
   * @param {number[]} context.frontLines - 三线战线
   * @param {string[]} context.recentEvents - 最近事件文本摘要
   * @param {string} [context.focus] - 特定焦点: 'trash_talk'|'danmaku_reply'|'analysis'
   * @returns {Promise<{ text: string, emotion: string, motion?: object } | null>}
   */
  async generate(context) {
    if (!this.enabled || !this.apiKey) return null;

    const now = Date.now();
    if (now - this.lastCallTime < this.minInterval) {
      logger.info('[ANNOUNCER] LLM 冷却中，跳过 (' + (now - this.lastCallTime) + 'ms since last)');
      return null;
    }

    this.lastCallTime = now;

    const prompt = this._buildPrompt(context);
    logger.info('[ANNOUNCER] LLM 请求: ' + prompt.slice(0, 80) + '...');

    try {
      const response = await this._callApi(prompt);
      const parsed = this._parseResponse(response);
      return parsed;
    } catch (e) {
      logger.error('[ANNOUNCER] LLM 调用失败: ' + e.message);
      return null;
    }
  }

  _buildPrompt(ctx) {
    const redPct = Math.round(ctx.red.hp / ctx.red.maxHp * 100);
    const bluePct = Math.round(ctx.blue.hp / ctx.blue.maxHp * 100);
    const lines = ctx.frontLines || [0, 0, 0];
    const lineStr = ['北境', '王道', '河谷'].map((n, i) => {
      const v = lines[i] || 0;
      return v > 50 ? n + '+' + Math.round(v) : v < -50 ? n + Math.round(v) : n + '(中)';
    }).join(' ');

    let eventsStr = '';
    if (ctx.recentEvents && ctx.recentEvents.length > 0) {
      eventsStr = ctx.recentEvents.slice(-5).map(e => '- ' + e).join('\n');
    }

    let focus = '';
    if (ctx.focus === 'trash_talk') {
      const losing = redPct < bluePct ? '红方' : '蓝方';
      focus = `请拱火调侃${losing}，刺激消费。`;
    } else if (ctx.focus === 'danmaku_reply' && ctx.danmaku) {
      focus = `有观众说"${ctx.danmaku.text}"，请接话。`;
    }

    return `当前: 红方${ctx.red.players}人 HP${redPct}% 蓝方${ctx.blue.players}人 HP${bluePct}%
战线: ${lineStr}
${eventsStr ? '最近:\n' + eventsStr : ''}
${focus}
请生成一句播报(≤30字):`;
  }

  async _callApi(prompt) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.apiKey },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          max_tokens: 100,
          temperature: 0.9,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error('HTTP ' + res.status + ': ' + body.slice(0, 200));
      }

      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 解析 LLM 输出: "[emotion][motion:group] text" → { text, emotion, motion }
   */
  _parseResponse(raw) {
    let text = (raw || '').trim();
    let emotion = 'neutral';
    let motion = null;

    // 解析 [emotion] 标签
    const emoMatch = text.match(/^\[(happy|sad|angry|surprised|neutral|shy|loving)\]/);
    if (emoMatch) {
      emotion = emoMatch[1];
      text = text.slice(emoMatch[0].length).trim();
    }

    // 解析 [motion:group] 标签
    const motMatch = text.match(/^\[motion:(\w+)\]/);
    if (motMatch) {
      motion = { group: motMatch[1], index: 2, priority: 3 };
      text = text.slice(motMatch[0].length).trim();
    }

    // 清理多余的标签
    text = text.replace(/\[.*?\]/g, '').trim();

    if (!text) return null;
    return { text, emotion, motion };
  }
}

module.exports = { LlmEngine };
