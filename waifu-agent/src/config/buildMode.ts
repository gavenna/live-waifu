/**
 * 构建模式 — Vite define 注入，由环境变量 VITE_WAIFU_MODE 控制。
 *
 *   调试 (dev):    npm run tauri:dev           → 全部面板可见 + 全日志
 *   调试 (user):   npm run tauri:dev:user      → 同正式版 UI + 日志
 *   调试 (userdebug): npm run tauri:dev:userdebug → 同正式版 UI + 全日志
 *   打包 (user):   npm run tauri:build         → 正式发布版
 *   打包 (userdebug): npm run tauri:build:userdebug → Beta 测试版
 */
declare const __WAIFU_MODE__: string;
export const BUILD_MODE = __WAIFU_MODE__ as "dev" | "userdebug" | "user";

export const isUserBuild = BUILD_MODE === "user";
