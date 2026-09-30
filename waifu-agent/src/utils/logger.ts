/**
 * 日志工具 — 按类别控制输出
 *
 * 用法：
 *   import { log } from "../utils/logger";
 *   log("ChatStream", "sentence #1:", text);
 *
 * console 输出受 logConfig.ts 开关控制。
 * 文件落盘始终进行（通过 invoke frontend_log → Rust log_debug 始终写文件）。
 */

export function log(tag: string, ...args: any[]): void {
  const msg = `[${tag}] ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`;
  // console.log → main.tsx patch → invoke("frontend_log") → Rust log file
  console.log(msg);
}

/** 错误日志始终输出 */
export function logError(tag: string, ...args: any[]): void {
  const msg = `[ERROR][${tag}] ${args.join(" ")}`;
  console.error(msg);
}
