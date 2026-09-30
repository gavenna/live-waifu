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

// RW_LOG_FILE 可覆盖日志文件路径（默认 logs/combined.log）。
// 离线回归（tools/verify_*.js）用它把输出隔离到临时文件，避免污染真实直播日志
// （见 HANDOVER 待办 #2「测试日志隔离」。默认值不变 ⇒ 生产行为完全一致）。
const LOG_FILE = process.env.RW_LOG_FILE || path.join(LOG_DIR, 'combined.log');
try { fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true }); } catch (e) { /* ok */ }
// RW_LOG_SILENT=1 ⇒ **完全不落盘**；=0 强制开。
// 另：入口脚本位于 `tools/` 下 ⇒ 视为**离线回归**，默认静默 —— 测试 require 了 battle 就会打日志，
// 不静默会把 [REP]/[CREDITS] 之类的假行写进真实直播日志、污染排障（生产入口是 index.js，不受影响）。
const _entryIsTool = /[\\/]tools[\\/][^\\/]*\.js$/.test(process.argv[1] || '');
const LOG_SILENT = process.env.RW_LOG_SILENT === '1' || (_entryIsTool && process.env.RW_LOG_SILENT !== '0');

function ts() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function writeln(text) {
  if (LOG_SILENT) return;
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
