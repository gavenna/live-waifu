/** 启动动画配置 — 按角色分组 */

export interface StartupConfig {
  bootLines: string[];
  greeting: string;
  particleColors: string[];
}

const _DEFAULT_BOOT = [
  "> waifu-agent v0.9 — booting",
  ">",
  "> Giving AI a face with feelings",
  "> Giving Agent a voice that speaks",
  "> Bringing her to life on your desktop",
  ">",
  "> She can hear you",
  "> She remembers everything about you",
  "> Not just chat — she gets things done",
  ">",
  "> initializing neural link...",
  ">  [OK] consciousness module: ONLINE",
];

export const STARTUP_CONFIGS: Record<string, StartupConfig> = {
  mao: {
    bootLines: _DEFAULT_BOOT,
    greeting: "I'm awake now~",
    particleColors: ["#8b5cf6", "#06b6d4", "#ec4899", "#22d3ee", "#a855f7", "#f59e0b"],
  },
  // 其他角色使用默认，后续可按需定制
  default: {
    bootLines: _DEFAULT_BOOT,
    greeting: "I'm awake now~",
    particleColors: ["#8b5cf6", "#06b6d4", "#ec4899", "#22d3ee", "#a855f7", "#f59e0b"],
  },
  jarvis: {
    bootLines: _DEFAULT_BOOT,
    greeting: "I'm awake now~",
    particleColors: ["#10b981", "#06b6d4", "#f59e0b", "#22d3ee"],
  },
  yuanqi: {
    bootLines: _DEFAULT_BOOT,
    greeting: "I'm awake now~",
    particleColors: ["#f59e0b", "#ec4899", "#f97316", "#eab308"],
  },
  sage: {
    bootLines: _DEFAULT_BOOT,
    greeting: "I'm awake now~",
    particleColors: ["#6366f1", "#8b5cf6", "#a855f7", "#c084fc"],
  },
  healer: {
    bootLines: _DEFAULT_BOOT,
    greeting: "I'm awake now~",
    particleColors: ["#10b981", "#34d399", "#6ee7b7", "#a7f3d0"],
  },
  lipsyncTest: {
    bootLines: _DEFAULT_BOOT,
    greeting: "I'm awake now~",
    particleColors: ["#8b5cf6", "#06b6d4"],
  },
};

/** 阶段时长 (ms) */
export const PHASE_TIMINGS = {
  /** Phase 0-1: 终端打字总时长 */
  TERMINAL_DURATION: 2800,
  /** Phase 2: 粒子溶解时长 */
  DISSOLVE_DURATION: 1000,
  /** Phase 3: 角色苏醒时长 */
  WAKEUP_DURATION: 2000,
  /** Phase 4: 问候收尾时长 */
  GREETING_DURATION: 1500,
  /** 每个终端字符打印间隔 */
  CHAR_INTERVAL: 18,
  /** 终端行间额外延迟 */
  LINE_DELAY: 150,
} as const;

export const PARTICLE_COUNT = 28;

/** 致谢画面阶段 */
export const CREDITS_DURATION = 3500;    // 致谢画面总停留时长 (ms)
export const CREDITS_TITLE_FADE = 400;   // 标题淡入时长 (ms)
export const CREDITS_ROW_DELAY = 200;    // 每行赞助者出现间隔 (ms)

/** 致谢背景漂浮粒子 */
export const FLOATING_PARTICLE_COUNT = 25;
export const FLOATING_PARTICLE_COLORS = ["#f1c40f", "#e6b800", "#f39c12", "#d4a574", "#c49b4a"];
export const FLOAT_SPEED_RANGE: [number, number] = [0.3, 0.8];   // 漂浮周期范围 (秒)
export const FLOAT_AMPLITUDE_RANGE: [number, number] = [15, 40];  // 漂浮振幅范围 (px)
export const FLOATING_PARTICLE_SIZE_MIN = 2;
export const FLOATING_PARTICLE_SIZE_MAX = 5;

/** 根据角色名获取配置，找不到则返回 mao */
export function getStartupConfig(personaName: string): StartupConfig {
  return STARTUP_CONFIGS[personaName] ?? STARTUP_CONFIGS["mao"] ?? STARTUP_CONFIGS["default"];
}
