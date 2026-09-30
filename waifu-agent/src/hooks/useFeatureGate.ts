/**
 * useFeatureGate — tier-based feature access control.
 *
 * Tiers:
 *   "free"  — 未激活免费使用
 *   "trial" — 试用 (激活码 basic tier)
 *   "pro"   — 付费完整版
 *   "dev"   — 开发者 (全部功能)
 */

import { useCallback } from "react";

/** 可门控的功能 key */
export type FeatureKey =
  | "model_multi"      // 多模型/皮肤
  | "voice_multi"      // 多音色 TTS
  | "agent_tools"      // Agent 工具 (全部)
  | "agent_tools_basic"// Agent 工具 (基础 2 个)
  | "click_through"    // 点击穿透
  | "memory_advanced"  // 记忆增强
  | "commercial";      // 商用授权

/** 功能定义：key → 显示名 + 描述 */
export const FEATURES: Record<FeatureKey, { name: string; desc: string }> = {
  model_multi:       { name: "全部角色皮肤", desc: "解锁所有角色模型，自由切换" },
  voice_multi:       { name: "多音色 TTS",  desc: "Azure 全语音可选：男声/女声/方言" },
  agent_tools:       { name: "Agent 工具箱", desc: "内置桌面工具：剪贴板/文件搜索/系统信息/打开链接" },
  agent_tools_basic: { name: "基础工具",     desc: "剪贴板读取 + 系统信息" },
  click_through:     { name: "点击穿透",     desc: "角色不挡鼠标，只在悬停时交互" },
  memory_advanced:   { name: "记忆增强",     desc: "AI 自动提炼记忆 + 语义召回" },
  commercial:        { name: "商用授权",     desc: "允许商业用途使用" },
};

/** Tier → 解锁的功能 */
const TIER_FEATURES: Record<string, FeatureKey[]> = {
  free:  ["agent_tools_basic"],
  trial: ["agent_tools_basic"],
  pro:   ["model_multi", "voice_multi", "agent_tools", "click_through", "memory_advanced", "commercial"],
  dev:   ["model_multi", "voice_multi", "agent_tools", "click_through", "memory_advanced", "commercial"],
};

/** 免费版可用的工具 */
export const FREE_TOOLS = ["read_clipboard", "system_info"] as const;

export function useFeatureGate(tier: string) {
  const unlocked = TIER_FEATURES[tier] || TIER_FEATURES.free;

  const canAccess = useCallback(
    (feature: FeatureKey): boolean => unlocked.includes(feature),
    [tier],
  );

  const lockedFeatures = useCallback((): FeatureKey[] => {
    return (Object.keys(FEATURES) as FeatureKey[]).filter((f) => !unlocked.includes(f));
  }, [tier]);

  const isFree = tier === "free";
  const isPro = tier === "pro" || tier === "dev";

  return { canAccess, lockedFeatures: lockedFeatures(), isFree, isPro, tier };
}
