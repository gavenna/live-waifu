export const WINDOW_LABEL = {
  SETTINGS: "settings",
  CHAT: "chat",
  LAB: "lab",
  OPS: "ops",
} as const;

export const MOTION_GROUP = {
  IDLE: "Idle",
  TAP_BODY: "TapBody",
} as const;

export const EXPRESSION_NAMES = [
  "exp_01", "exp_02", "exp_03", "exp_04",
  "exp_05", "exp_06", "exp_07", "exp_08",
] as const;

export const MOUTH_LEVEL = {
  CLOSED: "mouth_lv0",
  SLIGHT: "mouth_lv1",
  HALF: "mouth_lv2",
  OPEN: "mouth_open",
} as const;
