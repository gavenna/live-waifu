export interface RGBAColor {
  r: number; g: number; b: number; a: number;
}

export interface CharacterSettings {
  scale: number; posX: number; posY: number;
  canvasWidth: number; canvasHeight: number;
}

export interface AppearanceSettings {
  bgColor: RGBAColor; borderRadius: number;
  chatBtnSize: number; chatBtnMargin: number;
}

export interface BreathingSettings {
  periodMs: number; amplitude: number;
}

export interface LipsyncSettings {
  speed: number; amplitude: number; offset: number;
  subFreq: number; subAmplitude: number; subOffset: number;
}

/** 支持的 AI API provider */
export type ApiProvider = "deepseek" | "minimax-relay";

export interface LlmSettings {
  /** "deepseek" = 官方 API（url/model 可见可配）, "minimax-relay" = 中转站（url/model 隐藏，由 Rust 编译层锁定） */
  provider: ApiProvider;
  apiUrl: string; apiKey: string;
  model: string; timeoutSecs: number;
  /** Tavily API key (web search quality), 空则 fallback DDG */
  tavilyApiKey: string;
  /** LiteChipCloud Agnes image generation */
  imageApiKey: string;
  imageModel: string;
}

export interface WindowSettings {
  alwaysOnTop: boolean; skipTaskbar: boolean;
  ttsVolume: number; // 0-100
  width: number; height: number; // 主窗口尺寸
}

export interface WebSocketSettings {
  url: string; reconnectDelayMs: number;
  fallbackTimeoutMs: number; hardTimeoutMs: number;
  defaultTtsDurationMs: number;
}

export interface StatusIndicatorSettings {
  labels: Record<string, { text: string; color: string }>;
  padding: string;
  fontSize: number;
}

export interface ChatSettings {
  userBubbleColor: string;
  aiBubbleBg: string;
  bubbleRadius: number;
  fontSize: number;
}

export interface LayoutSettings {
  chatPanelWidth: number;  // % of window width, 40-100
  statusPosition: "left" | "center" | "right";
  centerModel: boolean;
}

/** 持久化到 ~/.waifu-agent/settings.json 的完整运行时设置 */
export interface RuntimeSettings {
  activePersona: string;
  character: CharacterSettings;
  appearance: AppearanceSettings;
  breathing: BreathingSettings;
  lipsync: LipsyncSettings;
  llm: LlmSettings;
  window: WindowSettings;
  websocket: WebSocketSettings;
  statusIndicator: StatusIndicatorSettings;
  chat: ChatSettings;
  layout: LayoutSettings;
  /** 空格语音输入开关 */
  sttEnabled: boolean;
  /** STT 语言: "zh" = 中文, "" = 自动检测 */
  sttLanguage: string;
  /** STT 录音指示器位置: "top" | "center" | "bottom" */
  sttIndicatorPosition: string;
  /** 开机自启，默认关闭 */
  autostart: boolean;
  /** AI 模式: "builtin" = 内置 LLM API, "relay" = 外部 Agent WebSocket */
  agentMode: "builtin" | "relay";
  /** 联网搜索开关：开启后每条消息自动搜索，关闭后仅匹配强制关键词时搜索 */
  webSearchEnabled: boolean;
  /** AI 回复旁显示 chibi 情绪贴图 */
  stickerEnabled: boolean;
  /** SOUL 预设: "mao-girlfriend" | "mao-teasing" | "mao-warm" | "mao-cool" | "mao-energetic" | "mao-rebel" */
  soulPreset: string;
}
