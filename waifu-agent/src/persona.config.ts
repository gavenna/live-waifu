/**
 * waifu-agent 角色人格配置文件
 *
 * ── 用法 ──
 * 1. 改第 5 行的 ACTIVE_PERSONA
 * 2. 保存
 * 3. 重启 `npx tauri dev`
 * 4. 人格生效
 *
 * 可选: default | jarvis | yuanqi | sage | healer | lipsyncTest | mao | shizuku
 */

const RELAY_PORT = 9191;

const ACTIVE_PERSONA = "mao";
//     ↑ 改这行切换人格

export type PersonaName = keyof typeof PERSONAS;

const PERSONAS = {

  default: {
    modelPath: "/live2d-models/haru_greeter/haru_greeter_t03.model3.json",
    paramIds: {
      mouthOpen: "ParamMouthOpenY",
      eyeLOpen: "ParamEyeLOpen",
      eyeROpen: "ParamEyeROpen",
      bodyAngleZ: "ParamBodyAngleZ",
      angleY: "ParamAngleY",
    },
    character: { scale:0.12, posX: 150, posY: 200, canvasWidth: 300, canvasHeight: 400 },
    appearance: { bgColor: { r: 20, g: 20, b: 30, a: 0.35 }, borderRadius: 8, chatBtnSize: 32, chatBtnMargin: 8 },
    breathing: { periodMs: 2000, amplitude: 0.02 },
    lipsync: { speed: 60, amplitude: 0.3, offset: 0.3, subFreq: 1.7, subAmplitude: 0.15, subOffset: 0.15 },
    statusIndicator: {
      labels: {
        idle: { text: "", color: "transparent" },
        thinking: { text: "\u{1F4AD} thinking...", color: "#8b5cf6" },
        speaking: { text: "\u{1F4AC} speaking...", color: "#06b6d4" },
        error: { text: "\u26A0\uFE0F error", color: "#ef4444" },
        disconnected: { text: "\u26A1 connecting...", color: "#f59e0b" },
      },
      padding: "6px 10px", fontSize: 11,
    },
    websocket: { url: `ws://127.0.0.1:${RELAY_PORT}/status`, reconnectDelayMs: 3000, fallbackTimeoutMs: 8000, hardTimeoutMs: 30000, defaultTtsDurationMs: 3000 },
    chat: { userBubbleColor: "#4a6cf7", aiBubbleBg: "rgba(255, 255, 255, 0.12)", bubbleRadius: 8, fontSize: 11 },
    motionGroups: { idle: "Idle", tapBody: "Use" },
    expressionNames: [],
    emotionExpression: {},
  },

  jarvis: {
    modelPath: "/live2d-models/haru_greeter/haru_greeter_t03.model3.json",
    paramIds: {
      mouthOpen: "ParamMouthOpenY",
      eyeLOpen: "ParamEyeLOpen",
      eyeROpen: "ParamEyeROpen",
      bodyAngleZ: "ParamBodyAngleZ",
      angleY: "ParamAngleY",
    },
    character: { scale:0.06, posX: 150, posY: 240, canvasWidth: 300, canvasHeight: 400 },
    appearance: { bgColor: { r: 10, g: 10, b: 20, a: 0.25 }, borderRadius: 12, chatBtnSize: 28, chatBtnMargin: 8 },
    breathing: { periodMs: 2000, amplitude: 0.01 },
    lipsync: { speed: 80, amplitude: 0.2, offset: 0.2, subFreq: 1.5, subAmplitude: 0.1, subOffset: 0.1 },
    statusIndicator: {
      labels: {
        idle: { text: "", color: "transparent" },
        thinking: { text: "\u23F3 处理中", color: "#6366f1" },
        speaking: { text: "\u{1F4AC} 回复", color: "#0ea5e9" },
        error: { text: "\u26A0\uFE0F 异常", color: "#ef4444" },
        disconnected: { text: "\u26A1 connecting...", color: "#f59e0b" },
      },
      padding: "6px 10px", fontSize: 11,
    },
    websocket: { url: `ws://127.0.0.1:${RELAY_PORT}/status`, reconnectDelayMs: 3000, fallbackTimeoutMs: 5000, hardTimeoutMs: 25000, defaultTtsDurationMs: 3000 },
    chat: { userBubbleColor: "#6366f1", aiBubbleBg: "rgba(255, 255, 255, 0.10)", bubbleRadius: 6, fontSize: 11 },
    motionGroups: { idle: "Idle", tapBody: "Tap" },
    expressionNames: ["f00", "f01", "f02", "f03", "f04", "f05", "f06", "f07"],
  },

  yuanqi: {
    modelPath: "/live2d-models/haru_greeter/haru_greeter_t03.model3.json",
    paramIds: {
      mouthOpen: "ParamMouthOpenY",
      eyeLOpen: "ParamEyeLOpen",
      eyeROpen: "ParamEyeROpen",
      bodyAngleZ: "ParamBodyAngleZ",
      angleY: "ParamAngleY",
    },
    character: { scale:0.23, posX: 400, posY: 500, canvasWidth: 1000, canvasHeight: 1000 },
    appearance: { bgColor: { r: 50, g: 20, b: 40, a: 0.40 }, borderRadius: 8, chatBtnSize: 36, chatBtnMargin: 20 },
    breathing: { periodMs: 1500, amplitude: 0.04 },
    lipsync: { speed: 40, amplitude: 0.4, offset: 0.4, subFreq: 2.0, subAmplitude: 0.2, subOffset: 0.2 },
    statusIndicator: {
      labels: {
        idle: { text: "", color: "transparent" },
        thinking: { text: "\u{1F914} 想想...", color: "#f472b6" },
        speaking: { text: "\u{1F4A1} 你听我说~", color: "#fbbf24" },
        error: { text: "\u{1F605} 出了点小问题", color: "#f59e0b" },
        disconnected: { text: "\u26A1 稍等一下...", color: "#f59e0b" },
      },
      padding: "6px 10px", fontSize: 11,
    },
    websocket: { url: `ws://127.0.0.1:${RELAY_PORT}/status`, reconnectDelayMs: 2000, fallbackTimeoutMs: 8000, hardTimeoutMs: 30000, defaultTtsDurationMs: 3000 },
    chat: { userBubbleColor: "#f472b6", aiBubbleBg: "rgba(255, 255, 255, 0.15)", bubbleRadius: 10, fontSize: 11 },
    motionGroups: { idle: "Idle", tapBody: "Tap" },
    expressionNames: ["f00", "f01", "f02", "f03", "f04", "f05", "f06", "f07"],
  },

  sage: {
    modelPath: "/live2d-models/haru_greeter/haru_greeter_t03.model3.json",
    paramIds: {
      mouthOpen: "ParamMouthOpenY",
      eyeLOpen: "ParamEyeLOpen",
      eyeROpen: "ParamEyeROpen",
      bodyAngleZ: "ParamBodyAngleZ",
      angleY: "ParamAngleY",
    },
    character: { scale:0.10, posX: 150, posY: 200, canvasWidth: 300, canvasHeight: 400 },
    appearance: { bgColor: { r: 5, g: 5, b: 15, a: 0.50 }, borderRadius: 4, chatBtnSize: 30, chatBtnMargin: 8 },
    breathing: { periodMs: 2000, amplitude: 0.005 },
    lipsync: { speed: 100, amplitude: 0.15, offset: 0.15, subFreq: 1.3, subAmplitude: 0.05, subOffset: 0.05 },
    statusIndicator: {
      labels: {
        idle: { text: "", color: "transparent" },
        thinking: { text: "\u{1F300} 沉思", color: "#7c3aed" },
        speaking: { text: "\u{1F5E3}\uFE0F 赐言", color: "#1e40af" },
        error: { text: "\u26A1 紊乱", color: "#dc2626" },
        disconnected: { text: "\u26A1 connecting...", color: "#f59e0b" },
      },
      padding: "6px 10px", fontSize: 10,
    },
    websocket: { url: `ws://127.0.0.1:${RELAY_PORT}/status`, reconnectDelayMs: 3000, fallbackTimeoutMs: 8000, hardTimeoutMs: 35000, defaultTtsDurationMs: 3000 },
    chat: { userBubbleColor: "#7c3aed", aiBubbleBg: "rgba(255, 255, 255, 0.08)", bubbleRadius: 4, fontSize: 10 },
    motionGroups: { idle: "Idle", tapBody: "Tap" },
    expressionNames: ["f00", "f01", "f02", "f03", "f04", "f05", "f06", "f07"],
  },

  healer: {
    modelPath: "/live2d-models/haru_greeter/haru_greeter_t03.model3.json",
    paramIds: {
      mouthOpen: "ParamMouthOpenY",
      eyeLOpen: "ParamEyeLOpen",
      eyeROpen: "ParamEyeROpen",
      bodyAngleZ: "ParamBodyAngleZ",
      angleY: "ParamAngleY",
    },
    character: { scale:0.08, posX: 150, posY: 200, canvasWidth: 300, canvasHeight: 400 },
    appearance: { bgColor: { r: 30, g: 20, b: 40, a: 0.30 }, borderRadius: 10, chatBtnSize: 32, chatBtnMargin: 8 },
    breathing: { periodMs: 2500, amplitude: 0.03 },
    lipsync: { speed: 70, amplitude: 0.25, offset: 0.25, subFreq: 1.6, subAmplitude: 0.12, subOffset: 0.12 },
    statusIndicator: {
      labels: {
        idle: { text: "", color: "transparent" },
        thinking: { text: "\u{1F4AD} 嗯...", color: "#a855f7" },
        speaking: { text: "\u{1F338} 我在~", color: "#22d3ee" },
        error: { text: "\u{1F622} 对不起...", color: "#f43f5e" },
        disconnected: { text: "\u26A1 稍等一下...", color: "#f59e0b" },
      },
      padding: "6px 10px", fontSize: 11,
    },
    websocket: { url: `ws://127.0.0.1:${RELAY_PORT}/status`, reconnectDelayMs: 3000, fallbackTimeoutMs: 12000, hardTimeoutMs: 35000, defaultTtsDurationMs: 3000 },
    chat: { userBubbleColor: "#a855f7", aiBubbleBg: "rgba(255, 255, 255, 0.12)", bubbleRadius: 10, fontSize: 11 },
    motionGroups: { idle: "Idle", tapBody: "Tap" },
    expressionNames: ["f00", "f01", "f02", "f03", "f04", "f05", "f06", "f07"],
  },

  lipsyncTest: {
    modelPath: "/live2d-models/haru_greeter/haru_greeter_t03.model3.json",
    paramIds: {
      mouthOpen: "ParamMouthOpenY",
      eyeLOpen: "ParamEyeLOpen",
      eyeROpen: "ParamEyeROpen",
      bodyAngleZ: "ParamBodyAngleZ",
      angleY: "ParamAngleY",
    },
    character: { scale:0.80, posX: 150, posY: 200, canvasWidth: 300, canvasHeight: 400 },
    appearance: { bgColor: { r: 20, g: 20, b: 30, a: 0.35 }, borderRadius: 8, chatBtnSize: 32, chatBtnMargin: 8 },
    breathing: { periodMs: 2000, amplitude: 0.02 },
    lipsync: { speed: 30, amplitude: 1.0, offset: 0.5, subFreq: 1.0, subAmplitude: 0.0, subOffset: 0.0 },
    statusIndicator: {
      labels: {
        idle: { text: "", color: "transparent" },
        thinking: { text: "\u{1F4AD} thinking...", color: "#8b5cf6" },
        speaking: { text: "\u{1F4AC} SPEAKING!", color: "#06b6d4" },
        error: { text: "\u26A0\uFE0F error", color: "#ef4444" },
        disconnected: { text: "\u26A1 connecting...", color: "#f59e0b" },
      },
      padding: "6px 10px", fontSize: 11,
    },
    websocket: { url: `ws://127.0.0.1:${RELAY_PORT}/status`, reconnectDelayMs: 3000, fallbackTimeoutMs: 8000, hardTimeoutMs: 30000, defaultTtsDurationMs: 3000 },
    chat: { userBubbleColor: "#4a6cf7", aiBubbleBg: "rgba(255, 255, 255, 0.12)", bubbleRadius: 8, fontSize: 11 },
    motionGroups: { idle: "Idle", tapBody: "Tap" },
    expressionNames: ["f00", "f01", "f02", "f03", "f04", "f05", "f06", "f07"],
  },

  mao: {
    modelPath: "/live2d-models/mao/Mao.model3.json",
    character: { scale: 0.06, posX: 200, posY: 440, canvasWidth: 400, canvasHeight: 550 },
    appearance: { bgColor: { r: 20, g: 20, b: 30, a: 0.35 }, borderRadius: 8, chatBtnSize: 32, chatBtnMargin: 8 },
    breathing: { periodMs: 2000, amplitude: 0.02 },
    lipsync: { speed: 60, amplitude: 1.0, offset: 0.0, subFreq: 1.7, subAmplitude: 0.3, subOffset: 0.0 },
    paramIds: {
      mouthOpen: "ParamA",
      mouthI: "ParamI",
      mouthU: "ParamU",
      mouthE: "ParamE",
      mouthO: "ParamO",
      mouthUp: "ParamMouthUp",
      mouthDown: "ParamMouthDown",
      eyeLOpen: "ParamEyeLOpen",
      eyeROpen: "ParamEyeROpen",
      eyeballX: "ParamEyeBallX",
      eyeballY: "ParamEyeBallY",
      browLY: "ParamBrowLY",
      browRY: "ParamBrowRY",
    },
    statusIndicator: {
      labels: {
        idle: { text: "", color: "transparent" },
        thinking: { text: "\u{1F4AD} thinking...", color: "#8b5cf6" },
        speaking: { text: "\u{1F4AC} speaking...", color: "#06b6d4" },
        error: { text: "\u26A0\uFE0F error", color: "#ef4444" },
        disconnected: { text: "\u26A1 connecting...", color: "#f59e0b" },
      },
      padding: "6px 10px", fontSize: 11,
    },
    websocket: { url: `ws://127.0.0.1:${RELAY_PORT}/status`, reconnectDelayMs: 3000, fallbackTimeoutMs: 8000, hardTimeoutMs: 30000, defaultTtsDurationMs: 3000 },
    chat: { userBubbleColor: "#4a6cf7", aiBubbleBg: "rgba(255, 255, 255, 0.12)", bubbleRadius: 8, fontSize: 11 },
  },

  shizuku: {
    modelPath: "/live2d-models/shizuku/shizuku.model.json",
    character: { scale: 0.11, posX: 150, posY: 200, canvasWidth: 300, canvasHeight: 400 },
    appearance: { bgColor: { r: 20, g: 20, b: 30, a: 0.35 }, borderRadius: 8, chatBtnSize: 32, chatBtnMargin: 8 },
    breathing: { periodMs: 2000, amplitude: 0.02 },
    lipsync: { speed: 60, amplitude: 0.3, offset: 0.3, subFreq: 1.7, subAmplitude: 0.15, subOffset: 0.15 },
    paramIds: {
      mouthOpen: "ParamMouthOpenY",
      eyeLOpen: "ParamEyeLOpen",
      eyeROpen: "ParamEyeROpen",
      bodyAngleZ: "ParamBodyAngleZ",
      angleY: "ParamAngleY",
    },
    motionGroups: { idle: "idle", tapBody: "tap_body" },
    expressionNames: ["f01", "f02", "f03", "f04"],
    emotionExpression: { happy: "f04", sad: "f02", angry: "f03", surprised: "f04", neutral: "f01", shy: "f01", loving: "f04" },
    statusIndicator: {
      labels: {
        idle: { text: "", color: "transparent" },
        thinking: { text: "\u{1F4AD} thinking...", color: "#8b5cf6" },
        speaking: { text: "\u{1F4AC} speaking...", color: "#06b6d4" },
        error: { text: "\u26A0\uFE0F error", color: "#ef4444" },
        disconnected: { text: "\u26A1 connecting...", color: "#f59e0b" },
      },
      padding: "6px 10px", fontSize: 11,
    },
    websocket: { url: `ws://127.0.0.1:${RELAY_PORT}/status`, reconnectDelayMs: 3000, fallbackTimeoutMs: 8000, hardTimeoutMs: 30000, defaultTtsDurationMs: 3000 },
    chat: { userBubbleColor: "#4a6cf7", aiBubbleBg: "rgba(255, 255, 255, 0.12)", bubbleRadius: 8, fontSize: 11 },
  },

};

type Persona = typeof PERSONAS[keyof typeof PERSONAS];

/** ── Per-model motion groups & expression names ── */
export interface MotionGroupNames {
  idle: string;
  tapBody: string;
}
export const DEFAULT_MOTION_GROUPS: MotionGroupNames = { idle: "Idle", tapBody: "TapBody" };
export const DEFAULT_EXPRESSION_NAMES = [
  "exp_01", "exp_02", "exp_03", "exp_04",
  "exp_05", "exp_06", "exp_07", "exp_08",
] as const;

export function resolveMotionGroups(persona: Record<string, any>): MotionGroupNames {
  const mg = persona.motionGroups as MotionGroupNames | undefined;
  return {
    idle: mg?.idle || DEFAULT_MOTION_GROUPS.idle,
    tapBody: mg?.tapBody || DEFAULT_MOTION_GROUPS.tapBody,
  };
}
export function resolveExpressionNames(persona: Record<string, any>): string[] {
  const names = persona.expressionNames as string[] | undefined;
  return (names?.length ? names : [...DEFAULT_EXPRESSION_NAMES]) as string[];
}

export const PRESETS = PERSONAS;
export const DEFAULT_PERSONA: PersonaName = "mao";
export const PERSONA: Persona = PERSONAS[ACTIVE_PERSONA as PersonaName];

export function getPersona(name: string): Persona {
  return (PERSONAS as Record<string, Persona>)[name] || PERSONAS[DEFAULT_PERSONA];
}

export function rgbaStr(c: { r: number; g: number; b: number; a: number }): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`;
}
