/**
 * TTS 生成器 — edge-tts Python 子进程 + LRU 缓存
 *
 * 调用 Microsoft edge-tts (zh-CN-XiaoxiaoNeural) 生成 MP3，
 * 返回 base64 + duration_ms，供 waifu-agent WS 中继消费。
 *
 * 延迟: 单句 10 字约 800-2000ms
 * 缓存: LRU 50 条，常用模板短语启动时预生成
 *
 * Phase 2 完整实现，Phase 1 用静默 stub 跑通骨架。
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const logger = require('../logger');

const VOICE = 'zh-CN-XiaoxiaoNeural';
const MAX_CACHE = 50;

class TtsGenerator {
  constructor(config = {}) {
    this.voice = config.TTS_VOICE || VOICE;
    this.maxCache = config.TTS_CACHE_SIZE || MAX_CACHE;
    this.cache = new Map();    // text → { b64, durationMs }
    this.cacheOrder = [];      // LRU 顺序
    this.busy = false;
    this._pythonPath = config.PYTHON_PATH || 'python';
  }

  /** 是否已缓存 */
  hasCached(text) {
    return this.cache.has(text);
  }

  /** 获取缓存的 TTS 数据 */
  getCached(text) {
    if (!this.cache.has(text)) return null;
    // 移到 LRU 末尾
    const idx = this.cacheOrder.indexOf(text);
    if (idx >= 0) { this.cacheOrder.splice(idx, 1); this.cacheOrder.push(text); }
    return this.cache.get(text);
  }

  /** 预生成一组常用短语 */
  async preGenerate(phrases) {
    logger.info('[ANNOUNCER] 预生成 ' + phrases.length + ' 条常用 TTS 短语...');
    for (const phrase of phrases) {
      try {
        await this.generate(phrase);
        logger.info('[ANNOUNCER]   ✓ 预缓存: ' + phrase.slice(0, 30));
      } catch (e) {
        logger.warn('[ANNOUNCER]   ✗ 预缓存失败: ' + phrase.slice(0, 30) + ' — ' + e.message);
      }
    }
  }

  /**
   * 生成 TTS 音频
   * @param {string} text - 纯口语文本
   * @returns {Promise<{ b64: string, durationMs: number }>}
   */
  async generate(text) {
    // 先查缓存
    const cached = this.getCached(text);
    if (cached) return cached;

    // 单线程保护
    while (this.busy) await new Promise(r => setTimeout(r, 100));
    this.busy = true;

    try {
      const result = await this._callEdgeTts(text);
      this._addToCache(text, result);
      return result;
    } finally {
      this.busy = false;
    }
  }

  async _callEdgeTts(text) {
    const tmpPath = path.join(os.tmpdir(), 'wdm-tts-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.mp3');
    const escapedText = text.replace(/"/g, '\\"').replace(/\\/g, '\\\\');

    const script = `
import asyncio, sys
from edge_tts import Communicate
async def main():
    try:
        c = Communicate("${escapedText}", "${this.voice}")
        await c.save("${tmpPath.replace(/\\/g, '\\\\')}")
    except Exception as e:
        print(f"EDGE_TTS_ERR: {e}", file=sys.stderr)
        sys.exit(1)
asyncio.run(main())
`;

    return new Promise((resolve, reject) => {
      const proc = spawn(this._pythonPath, ['-c', script], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('error', (err) => {
        reject(new Error('TTS Python 启动失败: ' + err.message));
      });

      proc.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error('TTS 失败 (exit ' + code + '): ' + stderr.slice(0, 200)));
          return;
        }
        try {
          if (!fs.existsSync(tmpPath)) {
            reject(new Error('TTS 输出文件未生成'));
            return;
          }
          const audio = fs.readFileSync(tmpPath);
          const b64 = audio.toString('base64');
          const durationMs = this._estimateDuration(text, audio.length);
          fs.unlinkSync(tmpPath);
          resolve({ b64, durationMs });
        } catch (e) {
          reject(new Error('TTS 后处理失败: ' + e.message));
        }
      });
    });
  }

  /** 根据文本长度和音频大小估算时长 */
  _estimateDuration(text, audioSize) {
    // edge-tts MP3 约 48-64kbps, 按 48kbps=6000B/s 估算
    const bySize = Math.round(audioSize / 6);
    // 中文约 250-350ms/字, 取 300ms 作为保底
    const chineseChars = (text.match(/[一-鿿]/g) || []).length;
    const byText = chineseChars * 300;
    return Math.max(bySize, byText, 500);
  }

  _addToCache(text, result) {
    if (this.cache.has(text)) return;
    this.cache.set(text, result);
    this.cacheOrder.push(text);
    // LRU 淘汰
    while (this.cacheOrder.length > this.maxCache) {
      const old = this.cacheOrder.shift();
      this.cache.delete(old);
    }
  }
}

module.exports = { TtsGenerator };
