import { BUILD_MODE } from "./buildMode";

// dev=研发自用  userdebug=Beta测试(同user功能+全日志)  user=正式发布

const FEATURES = {
  /* ═══════════════════════════════════════════════════════════
     主窗口独立面板 (按钮入口在角色右下角)
     ═══════════════════════════════════════════════════════════ */
  lab:          { dev: true,  userdebug: false, user: false }, // 🧪 模型实验室窗口
  ops:          { dev: true,  userdebug: false, user: false }, // 📊 运维面板窗口

  /* ═══════════════════════════════════════════════════════════
     设置面板 — 底层调参 (角色渲染引擎参数)
     ═══════════════════════════════════════════════════════════ */
  appearance:   { dev: true,  userdebug: false, user: false }, // 🎨 外观：背景色RGBA / 圆角 / 按钮尺寸
  breathing:    { dev: true,  userdebug: false, user: false }, // 🌬️ 呼吸：周期 / 幅度
  lipsync:      { dev: true,  userdebug: false, user: false }, // 👄 口型：速度 / 幅度 / 子频率 / 偏移

  /* ═══════════════════════════════════════════════════════════
     设置面板 — 数据管理
     ═══════════════════════════════════════════════════════════ */
  memoryMgmt:   { dev: true,  userdebug: true,  user: true  }, // 🗑️ 清空角色记忆按钮

  /* ═══════════════════════════════════════════════════════════
     设置面板 — 用户功能
     ═══════════════════════════════════════════════════════════ */
  agentMode:    { dev: true,  userdebug: true,  user: true  }, // 🔀 AI 模式：内置 LLM / 外部中继
  stt:          { dev: true,  userdebug: true,  user: true  }, // 🎤 语音输入：开关 / 语言 / 指示器位置
  webSearch:    { dev: true,  userdebug: true,  user: true  }, // 🌐 联网搜索：开关 / Tavily Key
  soulPreset:   { dev: true,  userdebug: true,  user: true  }, // 💬 角色性格：5 种预设下拉
  layout:       { dev: true,  userdebug: true,  user: true  }, // 📐 布局：聊天宽度 / 状态位置 / 角色居中
  websocket:    { dev: true,  userdebug: true,  user: true  }, // 🔌 WebSocket：中继 URL / 重连延迟
} as const;

type Feature = keyof typeof FEATURES;

export function isFeatureVisible(feature: Feature): boolean {
  return FEATURES[feature][BUILD_MODE];
}
