/**
 * 轻量日志模块 — 无依赖，纯同步 I/O
 *
 * 用法:
 *   const logger = require('./logger');
 *   logger.info('Client connected. Total: %d', count);
 *   logger.child({ module: 'wsServer' });
 *
 * 可选: 设置 onLog 回调将日志转发到面板环缓冲
 *   logger.onLog = (level, msg) => { ringBuffer.push({ level, msg }); };
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) { /* ok */ }

const LOG_FILE = path.join(LOG_DIR, 'combined.log');

function ts() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function writeln(text) {
  try { fs.appendFileSync(LOG_FILE, text + '\n'); } catch (e) { /* 静默：不因日志写盘失败崩进程 */ }
}

// onLog 回调 — 由 index.js 设置，用于转发日志到面板环缓冲
let onLogCallback = null;

function makeLogger(prefix) {
  return {
    info(...args) {
      const msg = `[${ts()}] INFO: ${prefix}${args.join(' ')}`;
      process.stdout.write(msg + '\n');
      writeln(msg);
      if (onLogCallback) onLogCallback('INFO', `${prefix}${args.join(' ')}`);
    },
    warn(...args) {
      const msg = `[${ts()}] WARN: ${prefix}${args.join(' ')}`;
      process.stderr.write(msg + '\n');
      writeln(msg);
      if (onLogCallback) onLogCallback('WARN', `${prefix}${args.join(' ')}`);
    },
    error(...args) {
      const msg = `[${ts()}] ERROR: ${prefix}${args.join(' ')}`;
      process.stderr.write(msg + '\n');
      writeln(msg);
      if (onLogCallback) onLogCallback('ERROR', `${prefix}${args.join(' ')}`);
    },
    debug(...args) {
      if (process.env.LOG_LEVEL === 'debug') {
        const msg = `[${ts()}] DEBUG: ${prefix}${args.join(' ')}`;
        process.stdout.write(msg + '\n');
        writeln(msg);
        if (onLogCallback) onLogCallback('DEBUG', `${prefix}${args.join(' ')}`);
      }
    },
    child(opts) {
      return makeLogger(opts.module ? `[${opts.module}] ` : prefix);
    },
  };
}

const defaultLogger = makeLogger('');

Object.defineProperty(defaultLogger, 'onLog', {
  set(fn) { onLogCallback = fn; },
  get() { return onLogCallback; },
  enumerable: true,
});

module.exports = defaultLogger;
