/**
 * 日志开关配置 — 控制所有前端 console.log 输出
 *
 * USER 模式全关，USERDEBUG 模式按需开。
 * 语法：`log(tag, msg)` 替代 `console.log(\`[tag] msg\`)`
 */

import { isUserBuild } from "./buildMode";

/** 日志类别及默认开关 (USERDEBUG 模式) */
const DEBUG_SWITCH: Record<string, boolean> = {
  ChatStream: false,
  Anim: false,
  Vowel: false,
  VowelVerify: false,
  Startup: false,
  Memory: false,
  App: true,
  Resize: true,
  Auth: true,
  STT: true,
  TTS: true,
  Lab: false,
  Ops: true,
};

/** 实际生效的日志开关 (USER 模式下强制全关) */
export const LOG_SWITCH: Record<string, boolean> = isUserBuild
  ? Object.fromEntries(Object.keys(DEBUG_SWITCH).map((k) => [k, false]))
  : DEBUG_SWITCH;
