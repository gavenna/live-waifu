import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen, emit } from "@tauri-apps/api/event";
import * as PIXI from "pixi.js";
import { Live2DModel, MotionPreloadStrategy } from "pixi-live2d-display/cubism4";
import { useWsStatus } from "./hooks/useWsStatus";
import type { AgentStatus } from "./hooks/useWsStatus";
import { useTts } from "./hooks/useTts";
import { useChatStream } from "./hooks/useChatStream";
import { useAgentLoop } from "./hooks/useAgentLoop";
import type { AgentLoopCallbacks } from "./hooks/useAgentLoop";
import { log, logError } from "./utils/logger";
// import { StatusIndicator } from "./components/StatusIndicator"; // hidden for transparent look
import { AuthPanel } from "./components/AuthPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { LabPanel } from "./components/LabPanel";
import { OpsPanel } from "./components/OpsPanel";
import { PortraitOnboarding } from "./components/PortraitOnboarding";
import { BUILD_MODE, isUserBuild } from "./config/buildMode";
import { isFeatureVisible } from "./config/featureFlags";
import { selectSticker, buildActionPrompt, extractImagePrompt } from "./config/stickerConfig";
import { SttButton } from "./components/SttButton";
import { WINDOW_LABEL } from "./constants/animation";
import { EMOTION_MOTION_BIAS, getEmotionExpression, type Emotion } from "./constants/emotion";

import type { AuthToken } from "./types/auth";
import { useStt } from "./hooks/useStt";
import { PRESETS, DEFAULT_PERSONA, resolveMotionGroups, resolveExpressionNames } from "./persona.config";
import type { PersonaName } from "./persona.config";
import type { RuntimeSettings } from "./types/settings";
import { StartupSequence } from "./components/StartupSequence";

(window as any).PIXI = PIXI;

// 模块级: 热重载时保持, 完整重载时重置
let __startupPlayedInSession = false;

// ── Defaults & utils ────────────────────────────────

function getDefaultSettings(): RuntimeSettings {
  const d = PRESETS[DEFAULT_PERSONA];
  return {
    activePersona: DEFAULT_PERSONA,
    character: { ...d.character },
    appearance: { ...d.appearance },
    breathing: { ...d.breathing },
    lipsync: { ...d.lipsync },
    statusIndicator: { ...d.statusIndicator },
    chat: { ...d.chat },
    websocket: { ...d.websocket },
    layout: { chatPanelWidth: 100, statusPosition: "left", centerModel: true },
    llm: { provider: "deepseek", apiUrl: "https://api.deepseek.com/v1/chat/completions", apiKey: "", model: "deepseek-v4-flash", timeoutSecs: 30, tavilyApiKey: "", imageApiKey: "", imageModel: "agnes-image-2.1-flash" },
    window: { alwaysOnTop: true, skipTaskbar: true, ttsVolume: 80, width: 400, height: 550 },
    sttEnabled: true,
    sttLanguage: "zh",
    sttIndicatorPosition: "top",
    autostart: false,
    agentMode: "builtin" as const,
    webSearchEnabled: false,
    stickerEnabled: true,
    soulPreset: "mao-teasing",
  };
}

function mergeWithDefaults(saved: Partial<RuntimeSettings>): RuntimeSettings {
  const defs = getDefaultSettings();
  return {
    ...defs, ...saved,
    character: { ...defs.character, ...(saved.character || {}) },
    appearance: { ...defs.appearance, ...(saved.appearance || {}) },
    breathing: { ...defs.breathing, ...(saved.breathing || {}) },
    lipsync: { ...defs.lipsync, ...(saved.lipsync || {}) },
    statusIndicator: { ...defs.statusIndicator, ...(saved.statusIndicator || {}) },
    chat: { ...defs.chat, ...(saved.chat || {}) },
    websocket: { ...defs.websocket, ...(saved.websocket || {}) },
    layout: { ...defs.layout, ...(saved.layout || {}) },
    llm: { ...defs.llm, ...(saved.llm || {}) },
    window: { ...defs.window, ...(saved.window || {}), ttsVolume: (saved.window?.ttsVolume ?? defs.window.ttsVolume) },
    agentMode: saved.agentMode ?? defs.agentMode,
    webSearchEnabled: saved.webSearchEnabled ?? defs.webSearchEnabled,
    stickerEnabled: saved.stickerEnabled ?? defs.stickerEnabled,
    soulPreset: saved.soulPreset ?? defs.soulPreset,
  };
}

function useWindowSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    let lastW = window.innerWidth;
    let lastH = window.innerHeight;
    let lastDpr = window.devicePixelRatio;
    log("Resize", `[INIT] inner=${lastW}x${lastH} dpr=${lastDpr}`);
    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dpr = window.devicePixelRatio;
      const delta = `${w - lastW > 0 ? "+" : ""}${w - lastW}x${h - lastH > 0 ? "+" : ""}${h - lastH}`;
      const dprDelta = dpr !== lastDpr ? ` DPR ${lastDpr}→${dpr}` : "";
      log("Resize", `${delta} inner=${w}x${h} dpr=${dpr}${dprDelta}`);
      lastW = w; lastH = h; lastDpr = dpr;
      setSize({ w, h });
    };
    window.addEventListener("resize", onResize);
    // 睡眠唤醒检测：页面从隐藏变为可见时记录状态
    const onVis = () => {
      if (!document.hidden) {
        log("Resize", `[VISIBLE] inner=${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio} hidden→visible (可能是唤醒)`);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  return size;
}

// ── Open secondary windows ──────────────────────────

let chatWindowSession = 0;

async function openSettingsWindow() {
  try { const w = await WebviewWindow.getByLabel(WINDOW_LABEL.SETTINGS); if (w) { await w.setFocus(); return; } } catch(_e) {}
  new WebviewWindow(WINDOW_LABEL.SETTINGS, {
    url: window.location.pathname + "?view=settings",
    title: "⚙ 设置", width: 420, height: 560,
    resizable: true, decorations: true,
    alwaysOnTop: false, skipTaskbar: false,
  });
}

async function openLabWindow() {
  try { const w = await WebviewWindow.getByLabel(WINDOW_LABEL.LAB); if (w) { await w.setFocus(); return; } } catch(_e) {}
  new WebviewWindow(WINDOW_LABEL.LAB, {
    url: window.location.pathname + "?view=lab",
    title: "🧪 模型实验室", width: 900, height: 600,
    resizable: true, decorations: true,
    alwaysOnTop: false, skipTaskbar: false,
  });
}

async function openChatWindow() {
  try { const w = await WebviewWindow.getByLabel(WINDOW_LABEL.CHAT); if (w) { await w.setFocus(); return; } } catch(_e) {}
  chatWindowSession++;
  new WebviewWindow(WINDOW_LABEL.CHAT, {
    url: window.location.pathname + "?view=chat",
    title: "💬 对话", width: 360, height: 480,
    resizable: true, decorations: true,
    alwaysOnTop: false, skipTaskbar: false,
  });
}

async function openOpsWindow() {
  try { const w = await WebviewWindow.getByLabel(WINDOW_LABEL.OPS); if (w) { await w.setFocus(); return; } } catch(_e) {}
  new WebviewWindow(WINDOW_LABEL.OPS, {
    url: window.location.pathname + "?view=ops",
    title: "📊 运维面板", width: 720, height: 600,
    resizable: true, decorations: true,
    alwaysOnTop: false, skipTaskbar: false,
  });
}

// ══════════════════════════════════════════════════════
// Entry routing
// ══════════════════════════════════════════════════════

const viewParam = new URLSearchParams(window.location.search).get('view');

function App() {
  if (viewParam === "settings") return <SettingsWindow />;
  if (viewParam === "chat") return <ChatWindow />;
  if (viewParam === "lab" && isFeatureVisible("lab")) return <LabWindow />;
  if (viewParam === "ops" && isFeatureVisible("ops")) return <OpsWindow />;
  return <MainWindow />;
}

async function loadSettingsWithLlm(): Promise<RuntimeSettings> {
  let settings = getDefaultSettings();
  try {
    const saved = await invoke<RuntimeSettings | null>("load_settings");
    if (saved && Object.keys(saved).length > 0) settings = mergeWithDefaults(saved);
  } catch(e) { console.error("loadSettingsWithLlm failed:", e); }
  return settings;
}

// ══════════════════════════════════════════════════════
// Settings window
// ══════════════════════════════════════════════════════

function SettingsWindow() {
  const [settings, setSettings] = useState<RuntimeSettings>(getDefaultSettings());
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    loadSettingsWithLlm().then(setSettings);
  }, []);

  const handleChange = useCallback((s: RuntimeSettings) => { setSettings(s); setDirty(true); }, []);
  const handleSave = useCallback(async () => {
    try {
      await invoke("save_settings", { settings });
      await emit("settings-updated", settings);
      setDirty(false);
      console.log("Settings saved successfully");
    } catch (e) {
      console.error("Save settings failed:", e);
    }
  }, [settings]);
  const handleReset = useCallback(() => { setSettings(getDefaultSettings()); setDirty(true); }, []);

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#1a1a2e", color: "#ccc", fontFamily: "'WenQuanYi Micro Hei', sans-serif" }}>
      <SettingsPanel visible={true} settings={settings} onSettingsChange={handleChange} standalone onSave={handleSave} onReset={handleReset} dirty={dirty} />
    </div>
  );
}

// ══════════════════════════════════════════════════════
// Chat window (separate Tauri window)
// ══════════════════════════════════════════════════════

interface ChatMessage { text: string; role: "user" | "assistant"; timestamp: number; emotion?: string; stickerPath?: string; stickerKey?: string; stickerText?: string; }

function ChatWindow() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<"fast" | "deep">("fast");
  const [chatConfig, setChatConfig] = useState(getDefaultSettings().chat);
  const [trendingLoading, setTrendingLoading] = useState(false);
  const [trendingReady, setTrendingReady] = useState(false);
  const [webSearchOn, setWebSearchOn] = useState(true);
  const stickerOnRef = useRef(true);
  const settingsRef = useRef<RuntimeSettings>(getDefaultSettings());

  // 启动时检查热点是否可用
  useEffect(() => {
    invoke<string>("get_trending").then((t) => { if (t) setTrendingReady(true); }).catch(() => {});
  }, []);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load chat config from settings
  useEffect(() => {
    invoke<RuntimeSettings | null>("load_settings")
      .then((saved) => {
        if (saved) {
          const s = mergeWithDefaults(saved);
          settingsRef.current = s;
          setChatConfig(s.chat);
          setWebSearchOn(s.webSearchEnabled);
          stickerOnRef.current = s.stickerEnabled ?? true;
        }
      })
      .catch((e) => console.error("load_settings (ChatWindow) failed:", e));
  }, []);
  useEffect(() => { listRef.current?.scrollTo(0, listRef.current.scrollHeight); }, [messages]);

  // Listen for responses from main window
  useEffect(() => {
    const ul1 = listen<{ text: string; role: string; mode?: string; emotion?: string }>("chat-response", (ev) => {
      setMessages((prev) => [...prev, { text: ev.payload.text, role: ev.payload.role as any, timestamp: Date.now(), emotion: ev.payload.emotion }]);
      setSending(false);
    });
    const ul2 = listen<{ emotion: string; stickerPath: string; stickerKey?: string; stickerText?: string }>("chat-sticker", (ev) => {
      if (!stickerOnRef.current) return;
      setMessages((prev) => [...prev, {
        text: "", role: "assistant", timestamp: Date.now(),
        emotion: ev.payload.emotion, stickerPath: ev.payload.stickerPath,
        stickerKey: ev.payload.stickerKey, stickerText: ev.payload.stickerText,
      }]);
    });
    const ul3 = listen<string>("chat-error", (ev) => {
      setMessages((prev) => [...prev, { text: `⚠️ ${ev.payload}`, role: "assistant", timestamp: Date.now() }]);
      setSending(false);
    });
    return () => { ul1.then((f) => f()); ul2.then((f) => f()); ul3.then((f) => f()); };
  }, []);

  // Send message → main window
  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText || inputText).trim();
    if (!text || sending) return;
    setInputText("");
    setSending(true);
    const userMsg: ChatMessage = { text, role: "user", timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    await emit("chat-send", { text, mode }).catch(() => setSending(false));
  }, [inputText, sending, mode]);

  // 🔥 聊热点：按需获取 + 发送
  const sendTrending = useCallback(async () => {
    if (trendingLoading || sending) return;
    setTrendingLoading(true);
    try {
      const trending: string = await invoke("get_trending");
      if (trending) {
        const prompt = `（这里是今天的热门话题。选一个你感兴趣的，用你的口吻跟我聊聊——不要像播新闻，像聊天那样提起。）\n\n${trending}`;
        setInputText("");
        setSending(true);
        const userMsg: ChatMessage = { text: "🔥", role: "user", timestamp: Date.now() };
        setMessages((prev) => [...prev, userMsg]);
        await emit("chat-send", { text: prompt, mode }).catch(() => setSending(false));
      }
    } catch (e) {
      console.error("get_trending failed:", e);
    }
    setTrendingLoading(false);
  }, [trendingLoading, sending, mode]);

  // 关键词自动触发（好无聊/不知道干嘛/有啥新鲜事）
  const containsTrendingKeyword = useCallback((text: string): boolean => {
    const kw = /好无聊|不知道干.?什么|有什么(新鲜|好玩|意思)|聊点|说点|有没有瓜|有.?什么新.?事|热点|热搜/i;
    return kw.test(text);
  }, []);

  if (viewParam !== "chat") return null;

  const C = chatConfig;
  const inputFontSize = Math.max(11, C.fontSize);

  return (
    <div onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}
      style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column", background: "#12121f", color: "#ccc", fontFamily: "'WenQuanYi Micro Hei', sans-serif", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
        <button onClick={() => setMode((m) => m === "fast" ? "deep" : "fast")} style={{
          height: 20, padding: "0 6px", borderRadius: 4, border: "1px solid",
          background: mode === "fast" ? "rgba(34,211,238,0.15)" : "rgba(139,92,246,0.15)",
          color: mode === "fast" ? "#22d3ee" : "#8b5cf6",
          borderColor: mode === "fast" ? "rgba(34,211,238,0.3)" : "rgba(139,92,246,0.3)",
          fontSize: 10, cursor: "pointer",
        }}>{mode === "fast" ? "⚡ 快速" : "🧠 深度"}</button>
        <span style={{ color: "#888", fontSize: 10 }}>对话</span>
      </div>

      {/* Messages */}
      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "4px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
        {messages.map((msg, i) => {
          // Sticker-only message → standalone image
          if (msg.stickerPath && !msg.text) {
            const src = convertFileSrc(msg.stickerPath.replace(/\\/g, "/"));
            return (
              <div key={i} style={{ display: "flex", justifyContent: "flex-start", padding: "2px 8px" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <img src={src} width={100} height={100} style={{ width: "100px", height: "100px", borderRadius: 12, flexShrink: 0, objectFit: "contain", display: "block", maxWidth: "none", maxHeight: "none" }}
                    alt={msg.emotion || ""}
                    onError={(e) => { console.error("[Sticker] img load failed:", msg.stickerPath, "→", src); (e.target as HTMLImageElement).style.display = "none"; }} />
                  {msg.stickerText && (
                    <span style={{ background: "rgba(0,0,0,0.4)", color: "#fff", fontSize: 12, borderRadius: 8, padding: "2px 10px", textAlign: "center", marginTop: 4 }}>{msg.stickerText}</span>
                  )}
                </div>
              </div>
            );
          }
          const emojiMap: Record<string, string> = {
            happy: "😊", sad: "😢", angry: "😤", surprised: "😮",
            shy: "😳", loving: "🥰", teasing: "😏", curious: "🤔",
          };
          const emoji = msg.emotion ? emojiMap[msg.emotion] : undefined;
          const isTiny = msg.role === "assistant" && msg.text.length <= 3 && !msg.text.startsWith("⚠️");
          return (
            <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start", alignItems: "flex-end", gap: 4 }}>
              {msg.role === "assistant" && emoji && !isTiny && (
                <span style={{ fontSize: 14, lineHeight: 1, flexShrink: 0 }}>{emoji}</span>
              )}
              <span style={{
                background: msg.role === "user" ? C.userBubbleColor : C.aiBubbleBg,
                padding: isTiny ? "6px 8px" : "4px 10px",
                borderRadius: isTiny ? 16 : C.bubbleRadius,
                fontSize: isTiny ? C.fontSize * 2.5 : C.fontSize,
                lineHeight: isTiny ? 1.1 : 1.4,
                maxWidth: isTiny ? "none" : "85%",
                whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>{msg.text}</span>
            </div>
          );
        })}
        {sending && <div style={{ color: "#888", fontSize: C.fontSize, paddingLeft: 8 }}>...</div>}
      </div>

      {/* Input */}
      <div style={{ display: "flex", padding: "4px 6px", gap: 4, borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, alignItems: "center" }}>
        <SttButton onResult={(text) => setInputText((prev) => prev + text)} />
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); sendTrending(); }}
          disabled={trendingLoading || sending || !trendingReady}
          title={!trendingReady ? "热点暂不可用" : trendingLoading ? "加载中…" : "🔥 聊热点"}
          style={{
            width: 28, height: 28, borderRadius: 6,
            border: `1px solid ${trendingReady ? 'rgba(251,146,60,0.4)' : 'rgba(255,255,255,0.08)'}`,
            background: trendingReady ? 'rgba(251,146,60,0.12)' : 'rgba(255,255,255,0.03)',
            color: trendingReady ? '#fb923c' : '#555',
            fontSize: 13, cursor: trendingReady ? 'pointer' : 'default',
            flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: trendingReady ? 1 : 0.4,
          }}
        >{trendingLoading ? "⏳" : "🔥"}</button>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            const next = !webSearchOn;
            setWebSearchOn(next);
            invoke("save_settings", { settings: { ...settingsRef.current, webSearchEnabled: next } }).catch((e) => console.error("save_settings (webSearch) failed:", e));
            emit("settings-updated", { webSearchEnabled: next }).catch((e) => console.error("emit settings-updated (webSearch) failed:", e));
          }}
          title={webSearchOn ? "联网搜索：开" : "联网搜索：关"}
          style={{
            width: 28, height: 28, borderRadius: 6,
            border: `1px solid ${webSearchOn ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.08)'}`,
            background: webSearchOn ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.03)',
            color: webSearchOn ? '#22c55e' : '#555',
            fontSize: 13, cursor: 'pointer', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >🌐</button>
        <input ref={inputRef} value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (containsTrendingKeyword(inputText)) { sendTrending(); }
              else { sendMessage(); }
            }
          }}
          placeholder={mode === "fast" ? "输入消息…" : "深度提问…"} disabled={sending}
          style={{ flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "6px 8px", color: "#fff", fontSize: inputFontSize, outline: "none" }}
        />
        <button onClick={() => {
          if (containsTrendingKeyword(inputText)) { sendTrending(); }
          else { sendMessage(); }
        }} disabled={sending || !inputText.trim()}
          style={{ width: 32, height: 32, borderRadius: 6, border: "none", background: mode === "fast" ? "#22d3ee" : "#8b5cf6", color: "#fff", fontSize: 14, cursor: "pointer", flexShrink: 0 }}
        >➤</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
// Main window (character PIXI + buttons + relay)
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
// Lab window (model testing playground)
// ══════════════════════════════════════════════════════

function LabWindow() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#0d0d1a", color: "#ccc", fontFamily: "'WenQuanYi Micro Hei', sans-serif" }}>
      <LabPanel />
    </div>
  );
}

function OpsWindow() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#0d0d1a", color: "#ccc", fontFamily: "'WenQuanYi Micro Hei', sans-serif" }}>
      <OpsPanel />
    </div>
  );
}

// ══════════════════════════════════════════════════════
// Admin window (许可管理)
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
// Main window (character PIXI + buttons + relay)
// ══════════════════════════════════════════════════════

function MainWindow() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<Live2DModel | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [localThinking, setLocalThinking] = useState(false);
  const [localTool, setLocalTool] = useState<{name: string, arg: string} | null>(null);
  const [localThinkingDetail, setLocalThinkingDetail] = useState("");
  const [chatError, setChatError] = useState("");
  const winSize = useWindowSize();

  // ── Mount timing ──
  const mountTimeRef = useRef(performance.now());
  useEffect(() => {
    invoke("frontend_log", { msg: `[STARTUP TIMELINE] MainWindow mount +${(performance.now() - mountTimeRef.current).toFixed(0)}ms` }).catch(()=>{});
  }, []);

  // ── Startup sequence ──
  // 初始状态直接 running: React 第一帧就渲染启动动画, 不闪现默认 UI
  const suppressTickerRef = useRef(true); // 启动期间抑制 ticker, handleStartupComplete 恢复
  const [startupPhase, setStartupPhase] = useState<"none" | "running" | "done">("running");
  const startupPhaseRef = useRef<"none" | "running" | "done">("running");

  // ── Settings ──────────────────────────────────────
  const [settings, setSettings] = useState<RuntimeSettings>(getDefaultSettings());
  const settingsRef = useRef(settings);
  const [sponsors, setSponsors] = useState<{name: string; tier: string}[]>([]);
  const sponsorsLoadedRef = useRef(false);
  settingsRef.current = settings; // always fresh for closures
  const settingsLoadedRef = useRef(false);

  useEffect(() => {
    // USER 模式关闭 Rust 侧日志
    if (isUserBuild) { invoke("set_log_enabled", { enabled: false }).catch(()=>{}); }
    invoke("frontend_log", { msg: `[MODE] BUILD_MODE=${BUILD_MODE} isUser=${isUserBuild}` }).catch(()=>{});
    if (settingsLoadedRef.current) return; // StrictMode 防重入
    loadSettingsWithLlm().then(async (s) => {
      invoke("frontend_log", { msg: `[LOADED] charScale=${s.character.scale} cW=${s.character.canvasWidth} cH=${s.character.canvasHeight} centerModel=${s.layout.centerModel}` }).catch(()=>{});
      setSettings(s);
      settingsLoadedRef.current = true; // 标记加载完成——放在 setSettings 之后，确保 set_window_size 拿到的是磁盘值而非默认值

      // ── Restore conversation history ──
      try {
        const hist = await invoke<Array<[string, string]>>("load_history");
        if (hist.length > 0) {
          historyRef.current = hist;
          log("App", ` history restored: ${hist.length / 2} turns`);
        }
      } catch {} // first launch, no history file

      // ── Auto distill: every startup (cost: one LLM call, ~3500 chars) ──
      if (s.llm.apiKey) {
        log("App", "auto distill...");
        invoke<string[]>("distill_memory", {
          apiUrl: s.llm.apiUrl, apiKey: s.llm.apiKey,
          model: s.llm.model, timeoutSecs: s.llm.timeoutSecs,
        }).then((thoughts: string[]) => {
          log("App", ` distill done: ${thoughts.length} thoughts`);
        }).catch((e: any) => { logError("App", "distill failed:", e); });

        // ── Initialize memory system (N.E.K.O. integration, every startup) ──
        invoke("memory_configure", {
          apiUrl: s.llm.apiUrl,
          apiKey: s.llm.apiKey,
          model: s.llm.model,
          provider: s.llm.provider || "deepseek",
        }).then(() => invoke("frontend_log", { msg: "[Memory] configured OK" }).catch(()=>{}))
          .catch((e: any) => invoke("frontend_log", { msg: `[Memory] configure failed: ${e}` }).catch(()=>{}));
      }
    }).catch((e) => {
      console.error("loadSettingsWithLlm failed:", e);
      settingsLoadedRef.current = true; // 即使加载失败也放行，不卡启动
    });
  }, []);

  // 加载赞助者名单：缓存优先 → bundled 兜底 → Gitee 后台刷新
  useEffect(() => {
    if (sponsorsLoadedRef.current) return;
    sponsorsLoadedRef.current = true;
    // 1. 先读本地缓存（上次 fetch_sponsors 成功保存的，毫秒级，始终最新）
    invoke<{sponsors: {name: string; tier: string}[]}>("read_sponsors_cache")
      .then(r => { if (r?.sponsors?.length) setSponsors(r.sponsors); })
      .catch(() => {
        // 2. 缓存不存在 → 兜底 bundled public/sponsors.json
        fetch("/sponsors.json")
          .then(r => r.json())
          .then((data: {sponsors: {name: string; tier: string}[]}) => { setSponsors(data.sponsors || []); })
          .catch(() => {});
      });
    // 3. 后台从 Gitee 拉最新，覆盖缓存
    invoke<{sponsors: {name: string; tier: string}[]}>("fetch_sponsors")
      .then(r => { if (r?.sponsors?.length) setSponsors(r.sponsors); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const unlisten = listen<Partial<RuntimeSettings>>("settings-updated", (ev) => {
      setSettings((prev) => mergeWithDefaults({ ...prev, ...ev.payload }));
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Apply window settings whenever they change
  useEffect(() => {
    invoke("set_always_on_top", { enabled: settings.window.alwaysOnTop }).catch((e) => console.error("set_always_on_top:", e));
    invoke("set_skip_taskbar", { enabled: settings.window.skipTaskbar }).catch((e) => console.error("set_skip_taskbar:", e));
  }, [settings.window.alwaysOnTop, settings.window.skipTaskbar]);

  useEffect(() => {
    // 守卫：settings 未从磁盘加载前不执行，避免用硬编码默认值覆盖 Rust 已恢复的窗口尺寸
    // 否则启动时窗口会 400→600→400 弹跳（默认值 600×800 vs 用户保存的 400×400）
    if (!settingsLoadedRef.current) return;
    invoke("set_window_size", { width: settings.window.width, height: settings.window.height }).catch((e) => console.error("set_window_size failed:", e));
  }, [settings.window.width, settings.window.height]);

  // Apply autostart setting
  useEffect(() => {
    invoke("set_autostart", { enabled: settings.autostart }).catch((e) => console.error("set_autostart:", e));
  }, [settings.autostart]);

  // ── Merged config ─────────────────────────────────
  const currentConfig = useMemo(() => {
    const preset = PRESETS[settings.activePersona as PersonaName] || PRESETS[DEFAULT_PERSONA];
    return {
      modelPath: preset.modelPath,
      paramIds: preset.paramIds || {},
      character: settings.character, appearance: settings.appearance,
      breathing: settings.breathing, lipsync: settings.lipsync,
      statusIndicator: settings.statusIndicator, chat: settings.chat,
      websocket: settings.websocket, layout: settings.layout,
      llm: settings.llm,
    };
  }, [settings]);

  // ── Per-model motion & expression names ──────────
  const motionGroups = useMemo(() => {
    const preset = PRESETS[settings.activePersona as PersonaName] || PRESETS[DEFAULT_PERSONA];
    return resolveMotionGroups(preset);
  }, [settings.activePersona]);
  const expressionNames = useMemo(() => {
    const preset = PRESETS[settings.activePersona as PersonaName] || PRESETS[DEFAULT_PERSONA];
    return resolveExpressionNames(preset);
  }, [settings.activePersona]);
  const personaEmotionExpr = useMemo(() => {
    const preset = PRESETS[settings.activePersona as PersonaName] || PRESETS[DEFAULT_PERSONA];
    return (preset as any).emotionExpression as Record<string, string> | undefined;
  }, [settings.activePersona]);

  const L = currentConfig.layout;

  // ── Adaptive canvas (with optional centering) ─────
  const canvas = useMemo(() => {
    const cfg = currentConfig.character;
    const scaleX = winSize.w / cfg.canvasWidth;
    const scaleY = winSize.h / cfg.canvasHeight;
    const s = Math.min(scaleX, scaleY);
    const w = Math.round(cfg.canvasWidth * s);
    const h = Math.round(cfg.canvasHeight * s);
    const offsetX = Math.round((winSize.w - w) / 2);
    const offsetY = Math.round((winSize.h - h) / 2);
    const modelScale = cfg.scale * s;
    // Center model in canvas if enabled, otherwise use config position
    const modelX = L.centerModel ? w / 2 : cfg.posX * s;
    const modelY = L.centerModel ? h / 2 : cfg.posY * s;
    return { w, h, scale: s, modelScale, modelX, modelY, offsetX, offsetY };
  }, [winSize, currentConfig.character, L.centerModel]);

  // 诊断：canvas 变化时记录缩放计算
  useEffect(() => {
    log("Resize",
      `canvas calc: winSize=${winSize.w}x${winSize.h} ` +
      `cfgCanvas=${currentConfig.character.canvasWidth}x${currentConfig.character.canvasHeight} ` +
      `cfgScale=${currentConfig.character.scale} ` +
      `→ canvas=${canvas.w}x${canvas.h} modelScale=${canvas.modelScale} ` +
      `offset=(${canvas.offsetX},${canvas.offsetY})`
    );
  }, [canvas]);

  const breathingRef = useRef(currentConfig.breathing);
  breathingRef.current = currentConfig.breathing;

  // ── Animation state machine ────────────────────────
  const { energyRef: energyDataRef, energyIdxRef, energyTimerRef, generateEnergy, applyAudioEnergy, generate: ttsGenerate, playBuffer: ttsPlayBuffer, playBase64: ttsPlayBase64 } = useTts();
  const animSmoothRef = useRef({ mouth: 0 });
  const lastFrameRef = useRef(Date.now());
  // Motion & expression auto-play
  const prevAnimPhaseRef = useRef<"idle"|"thinking"|"speaking">("idle");
  const idleTimerRef = useRef(0);         // countdown to next idle action
  const nextExpressTimerRef = useRef(4000 + Math.random() * 6000);
  const emotionRef = useRef<Emotion>("neutral");
  const emotionTimerRef = useRef(0); // countdown: how long to maintain emotion after speaking
  const responseActiveRef = useRef(false); // true during multi-sentence response
  const responseMotionPlayedRef = useRef(false); // true after first sentence's opening motion
  const vowelVerifyFrameRef = useRef(0); // frame counter for periodic vowel verification
  const beforeModelUpdateUnlistenRef = useRef<(() => void) | null>(null); // Cubism4 event unlisten

  const { status, lastResponse, ttsAudioBase64, ttsDurationMs, ttsText, emotion: wsEmotion, motion: wsMotion, thinkingDetail, currentTool, synthRequest, sendToAgent, resetStatusToIdle } = useWsStatus(currentConfig.websocket, true); // 始终监听 — 游戏主播 Announcer 也走 9191
  // In builtin mode, WS companion events drive TTS but shouldn't control status indicator
  const displayStatus: AgentStatus = localSpeaking ? "speaking"
    : localThinking ? "thinking"
    : settings.agentMode === "builtin" && (status === "disconnected" || status === "thinking" || status === "speaking") ? "idle"
    : status;

  const statusRef = useRef(status);
  statusRef.current = status;
  const animCfgRef = useRef(currentConfig);
  animCfgRef.current = currentConfig;

  // ── Model loader ──────────────────────────────────
  const modelGenRef = useRef(0);
  const pixiReadyRef = useRef(false);
  const canvasStateRef = useRef(canvas);
  canvasStateRef.current = canvas;
  const animCfgRef2 = useRef(currentConfig);
  animCfgRef2.current = currentConfig;
  const motionGroupsRef = useRef(motionGroups);
  motionGroupsRef.current = motionGroups;
  const expressionNamesRef = useRef(expressionNames);
  expressionNamesRef.current = expressionNames;
  const personaEmotionExprRef = useRef(personaEmotionExpr);
  personaEmotionExprRef.current = personaEmotionExpr;
  const [resizeGen, setResizeGen] = useState(0);

  // ── WS relay: emotion from agent ──────────────────
  useEffect(() => {
    if (!wsEmotion) return;
    emotionRef.current = wsEmotion as Emotion;
    emotionTimerRef.current = 15000;
    const model = modelRef.current;
    if (!model) return;
    const expr = getEmotionExpression(wsEmotion as Emotion, expressionNames, personaEmotionExpr);
    model.expression(expr).catch(() => {});
    console.log(`[Relay] emotion: ${wsEmotion} → ${expr}`);
  }, [wsEmotion, settings.agentMode]);

  // ── WS relay: motion from agent ────────────────────
  const wsMotionSentRef = useRef("");
  useEffect(() => {
    if (!wsMotion) return;
    const key = `${wsMotion.motion || ""}-${wsMotion.index ?? ""}`;
    if (key === wsMotionSentRef.current) return;
    wsMotionSentRef.current = key;
    const model = modelRef.current;
    if (!model) return;
    const priority = wsMotion.priority ?? 3;
    model.motion(wsMotion.motion || motionGroups.tapBody, wsMotion.index, priority).catch(() => {});
    console.log(`[Relay] motion: ${wsMotion.motion}#${wsMotion.index} pri=${priority}`);
  }, [wsMotion, settings.agentMode]);

  // ── Emit ops panel status ──────────────────────────
  useEffect(() => {
    emit("ops-status-update", {
      status: displayStatus,
      emotion: wsEmotion || "",
      motion: wsMotion?.motion || "",
      thinkingDetail: thinkingDetail || "",
      currentTool: currentTool?.tool || "",
      lastResponse: lastResponse || "",
    }).catch(() => {});
  }, [displayStatus, wsEmotion, wsMotion, thinkingDetail, currentTool, lastResponse]);

  // ── WS relay: TTS playback + lipsync ──────────────
  const wsTtsGenRef = useRef(0);
  useEffect(() => {
    if (!ttsAudioBase64) return;
    const gen = ++wsTtsGenRef.current;
    // Generate lipsync energy from TTS text
    if (ttsText) {
      generateEnergy(ttsText, energyDataRef.current);
      energyIdxRef.current = 0;
      energyTimerRef.current = 0;
    } else {
      // Fallback: energy based on duration
      energyDataRef.current.length = 0;
      const n = Math.ceil(ttsDurationMs / 100);
      for (let i = 0; i < n; i++) {
        const p = (i / Math.max(n - 1, 1)) * Math.PI * 4;
        const amp = Math.max(0, Math.min(1, Math.sin(p) * 0.35 + 0.3));
        energyDataRef.current.push({ openness: amp, a: amp, i: 0, u: 0, e: 0, o: 0 });
      }
      energyIdxRef.current = 0;
      energyTimerRef.current = 0;
    }
    setLocalSpeaking(true);
    ttsPlayBase64(ttsAudioBase64, ttsDurationMs, settings.window.ttsVolume).finally(() => {
      if (gen === wsTtsGenRef.current) {
        setLocalSpeaking(false);
        resetStatusToIdle();
        energyDataRef.current = [];
      }
    });
  }, [ttsAudioBase64]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── WS relay: agent 要求本地合成（synthesize:true）──
  // 游戏中继只发文本（agent:end.response + synthesize），由 waifu 自己的 edge-tts 开口；
  // 音频不走 WS（base64 体积大），TTS 归 waifu 职责（见 Agent Relay 协议.md §3.4）。
  const wsSynthGenRef = useRef(0);
  useEffect(() => {
    if (!synthRequest || !synthRequest.text) return;
    const gen = ++wsSynthGenRef.current;
    const text = synthRequest.text;
    // 口型能量先行（与 tts:audio 路径一致），再合成播放
    generateEnergy(text, energyDataRef.current);
    energyIdxRef.current = 0;
    energyTimerRef.current = 0;
    setLocalSpeaking(true);
    (async () => {
      try {
        const buf = await ttsGenerate(text);
        if (gen !== wsSynthGenRef.current) return;
        await ttsPlayBuffer(buf, settings.window.ttsVolume);
      } catch (e) {
        console.warn("[TTS] relay synth failed:", e);
      } finally {
        if (gen === wsSynthGenRef.current) {
          setLocalSpeaking(false);
          resetStatusToIdle();
          energyDataRef.current = [];
        }
      }
    })();
  }, [synthRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── WS relay: auto memory extraction on agent response ──
  const lastResponseRef = useRef("");
  useEffect(() => {
    if (settings.agentMode !== "relay" || !lastResponse || lastResponse === lastResponseRef.current) return;
    if (!hasKnowledgeBaseRef.current) return; // 冷读防护
    lastResponseRef.current = lastResponse;
    const msgs = JSON.stringify([
      { role: "user", content: "(relay mode)" },
      { role: "assistant", content: lastResponse },
    ]);
    invoke("memory_extract", { messagesJson: msgs }).then((facts: any) => {
      if (Array.isArray(facts) && facts.length > 0) {
        console.log(`[Memory] relay extracted ${facts.length} facts`);
      }
    }).catch((e) => console.error("memory_extract (relay) failed:", e));
  }, [lastResponse, settings.agentMode]);

  const loadModel = useCallback(async (modelPath: string, gen?: number) => {
    invoke("frontend_log", { msg: `[STARTUP] loadModel path=${modelPath}` }).catch(()=>{});
    if (gen !== undefined && gen !== modelGenRef.current) return;
    const app = appRef.current;
    if (!app) return;
    const c = canvasStateRef.current;
    app.renderer.resize(c.w, c.h);
    try {
      const model = await Live2DModel.from(modelPath, { autoInteract: false, motionPreload: MotionPreloadStrategy.ALL });
      if (gen !== undefined && gen !== modelGenRef.current) return;
      if (!appRef.current || appRef.current !== app) return;
      // 旧模型先保留着 — 等新模型就绪后再替换
      const prevModel = modelRef.current;
      (model as any).anchor.set(0.5, 0.5);
      (model as any).position.set(c.modelX, c.modelY);
      (model as any).scale.set(c.modelScale);
      invoke("frontend_log", { msg: `[STARTUP] scale=${c.modelScale} charScale=${animCfgRef2.current.character.scale} canvasW=${c.w} canvasH=${c.h} cW=${animCfgRef2.current.character.canvasWidth} cH=${animCfgRef2.current.character.canvasHeight} centerModel=${animCfgRef2.current.layout.centerModel}` }).catch(()=>{});
      // 替换：清旧模型，渐显新模型
      if (prevModel) { try { prevModel.destroy(); } catch(_e) {} }
      app.stage.removeChildren();
      model.alpha = 0;
      app.stage.addChild(model as any);
      modelRef.current = model;
      // 渐显新模型（启动动画期间跳过——StartupSequence Phase 3 自己控制渐显）
      if (startupPhaseRef.current !== "running") {
        const start = Date.now();
        const tick = () => {
          const elapsed = Date.now() - start;
          if (elapsed >= 300) { try { model.alpha = 1; } catch(_e) {} return; }
          try { model.alpha = Math.min(1, elapsed / 300); } catch(_e) {}
          requestAnimationFrame(tick);
        };
        tick();
      }

      // 启动动画期间先隐藏模型，等 StartupSequence Phase 3 渐显
      if (startupPhaseRef.current === "running") {
        model.alpha = 0;
      }

      // ── Subscribe to beforeModelUpdate (step 10 of Cubism4 pipeline) ──
      // Writes mouth params AFTER motion/expression/physics/pose have all run,
      // so our values survive as the final state before vertex update.
      beforeModelUpdateUnlistenRef.current?.();
      const handleBeforeModelUpdate = () => {
        const eData = energyDataRef.current;
        const eIdx = energyIdxRef.current;
        const smooth = animSmoothRef.current;
        const P2: Record<string, string> = (animCfgRef.current.paramIds || {}) as Record<string, string>;
        const core2 = (model.internalModel?.coreModel as any);
        if (!core2) return;

        const isSpeaking2 = eData.length > 0 && eIdx < eData.length;
        if (isSpeaking2 && smooth.mouth > 0.01) {
          const frame = eData[Math.min(eIdx, eData.length - 1)];
          if (!frame) return;
          const amp = animCfgRef.current.lipsync.amplitude;
          const off = animCfgRef.current.lipsync.offset;
          // 5 vowel parameters — scale up I/U/E/O to compensate for pipeline attenuation
          const B = 3.0; // boost factor for non-LipSync params
          if (P2.mouthOpen) core2.setParameterValueById(P2.mouthOpen, frame.a * amp + off);
          if (P2.mouthI) core2.setParameterValueById(P2.mouthI, frame.i * amp * B);
          if (P2.mouthU) core2.setParameterValueById(P2.mouthU, frame.u * amp * B);
          if (P2.mouthE) core2.setParameterValueById(P2.mouthE, frame.e * amp * B);
          if (P2.mouthO) core2.setParameterValueById(P2.mouthO, frame.o * amp * B);
          // Mouth open via jaw drop only (MouthUp has min=0 clamp, negatives ignored)
          const mouthScale = smooth.mouth;
          if (P2.mouthUp) core2.setParameterValueById(P2.mouthUp, 0);
          if (P2.mouthDown) core2.setParameterValueById(P2.mouthDown, mouthScale);
        } else {
          // Reset all mouth params to 0
          if (P2.mouthOpen) core2.setParameterValueById(P2.mouthOpen, 0);
          if (P2.mouthI) core2.setParameterValueById(P2.mouthI, 0);
          if (P2.mouthU) core2.setParameterValueById(P2.mouthU, 0);
          if (P2.mouthE) core2.setParameterValueById(P2.mouthE, 0);
          if (P2.mouthO) core2.setParameterValueById(P2.mouthO, 0);
          if (P2.mouthUp) core2.setParameterValueById(P2.mouthUp, 0);
          if (P2.mouthDown) core2.setParameterValueById(P2.mouthDown, 0);
        }

        // Periodic verification log
        vowelVerifyFrameRef.current++;
        if (isSpeaking2 && vowelVerifyFrameRef.current >= 30) {
          vowelVerifyFrameRef.current = 0;
          const read = (id: string) => {
            const v = core2.getParameterValueById?.(id);
            return v !== undefined && v !== null ? v.toFixed(3) : "n/a";
          };
          const vf = eData[Math.min(eIdx, eData.length - 1)];
          log("VowelVerify",
            `A=${vf?.a.toFixed(3) || "0"}→${read(P2.mouthOpen || "ParamA")} ` +
            `I=${vf?.i.toFixed(3) || "0"}→${read(P2.mouthI || "ParamI")} ` +
            `U=${vf?.u.toFixed(3) || "0"}→${read(P2.mouthU || "ParamU")} ` +
            `E=${vf?.e.toFixed(3) || "0"}→${read(P2.mouthE || "ParamE")} ` +
            `O=${vf?.o.toFixed(3) || "0"}→${read(P2.mouthO || "ParamO")} ` +
            `MUp=0→${read(P2.mouthUp || "ParamMouthUp")} ` +
            `MDown=${smooth.mouth.toFixed(3)}→${read(P2.mouthDown || "ParamMouthDown")}`
          );
        }
      };
      model.internalModel?.on("beforeModelUpdate", handleBeforeModelUpdate);
      beforeModelUpdateUnlistenRef.current = () => {
        model.internalModel?.off("beforeModelUpdate", handleBeforeModelUpdate);
      };

      setResizeGen((n) => n + 1); // trigger RESIZE with correct canvas
      (window as any).__waifu_model__ = model;
    } catch (e) { console.error("Live2D load error:", e); }
  }, []);

  // ── Init PIXI ─────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return;
    const gen = ++modelGenRef.current;
    invoke("frontend_log", { msg: `[STARTUP] PIXI init gen=${gen} modelPath=${currentConfig.modelPath}` }).catch(()=>{});
    let destroyed = false;
    let app: PIXI.Application | null = null;
    const init = async () => {
      app = new PIXI.Application({
        width: canvas.w, height: canvas.h,
        backgroundAlpha: 0, antialias: true,
        resolution: window.devicePixelRatio || 1, autoDensity: true,
      });
      if (destroyed || gen !== modelGenRef.current) return;
      canvasRef.current!.appendChild(app.view as unknown as HTMLElement);
      appRef.current = app; pixiReadyRef.current = true;
      // 帧级 canvas 尺寸监控：睡眠唤醒后 WebGL 上下文恢复可能绕过 resize 事件
      let lastCanvasW = canvas.w;
      let lastCanvasH = canvas.h;
      let lastRendererW = app.renderer.width;
      let lastRendererH = app.renderer.height;
      let canvasMonitorFrame = 0;
      app.ticker.add(() => {
        canvasMonitorFrame++;
        // 每 60 帧 (~1s) 检查一次 canvas 实际尺寸 vs 期望值
        if (canvasMonitorFrame % 60 === 0) {
          const view = app!.view as HTMLCanvasElement;
          const actualCssW = view.clientWidth;
          const actualCssH = view.clientHeight;
          const actualBufW = view.width;
          const actualBufH = view.height;
          const rendererW = app!.renderer.width;
          const rendererH = app!.renderer.height;
          const dpr = window.devicePixelRatio;
          if (actualCssW !== lastCanvasW || actualCssH !== lastCanvasH ||
              rendererW !== lastRendererW || rendererH !== lastRendererH) {
            log("Resize",
              `[MONITOR] canvas CSS ${lastCanvasW}x${lastCanvasH}→${actualCssW}x${actualCssH} ` +
              `buf ${lastRendererW}x${lastRendererH}→${rendererW}x${rendererH} ` +
              `canvasEl=${actualBufW}x${actualBufH} dpr=${dpr} rendererRes=${app!.renderer.resolution}`
            );
            invoke("frontend_log", { msg:
              `[RESIZE-MONITOR] canvasCSS ${lastCanvasW}x${lastCanvasH}→${actualCssW}x${actualCssH} ` +
              `buf ${lastRendererW}x${lastRendererH}→${rendererW}x${rendererH} ` +
              `canvasEl=${actualBufW}x${actualBufH} dpr=${dpr} rendererRes=${app!.renderer.resolution}`
            }).catch(()=>{});
            lastCanvasW = actualCssW;
            lastCanvasH = actualCssH;
            lastRendererW = rendererW;
            lastRendererH = rendererH;
          }
        }
        // 启动动画期间抑制正常循环 (保持 lastFrameRef 更新防止 dt 尖峰)
        if (suppressTickerRef.current) {
          lastFrameRef.current = Date.now();
          return;
        }
        const model = modelRef.current;
        if (!model) return;

        const now = Date.now();
        const dt = Math.min(now - lastFrameRef.current, 100) / 1000;
        lastFrameRef.current = now;
        const energy = energyDataRef.current;

        // ── Phase detection ────────────────────────────
        const isSpeaking = energy.length > 0 && energyIdxRef.current < energy.length;
        const isThinking = statusRef.current === "thinking";
        const phase: "idle"|"thinking"|"speaking" = isSpeaking ? "speaking" : isThinking ? "thinking" : "idle";
        const phaseChanged = phase !== prevAnimPhaseRef.current;
        prevAnimPhaseRef.current = phase;
        if (phaseChanged && phase === "thinking") {
          log("Anim", "thinking...");
        }

        // ── Energy playback (100ms per cell) ───────────
        if (isSpeaking) {
          energyTimerRef.current += dt * 1000;
          while (energyTimerRef.current >= 100 && energyIdxRef.current < energy.length) {
            energyTimerRef.current -= 100;
            energyIdxRef.current++;
          }
          if (energyIdxRef.current >= energy.length) {
            energyDataRef.current = [];
            energyIdxRef.current = 0;
            energyTimerRef.current = 0;
          }
        }
        const rawEnergy = isSpeaking
          ? (energy[Math.min(energyIdxRef.current, energy.length - 1)]?.openness || 0)
          : 0;
        const smooth = animSmoothRef.current;
        smooth.mouth += (rawEnergy - smooth.mouth) * Math.min(dt * 35, 1);

        // ── Breathing ──────────────────────────────────
        const b = breathingRef.current;
        model.rotation = Math.sin(now / b.periodMs) * b.amplitude;

        // ══════════════════════════════════════════════════
        // Motion manager (emotion-biased)
        // ══════════════════════════════════════════════════
        idleTimerRef.current -= dt * 1000;
        emotionTimerRef.current -= dt * 1000;

        const bias = EMOTION_MOTION_BIAS[emotionRef.current];

        if (phaseChanged && phase === "speaking") {
          // First sentence of response → play opening motion
          // Subsequent sentences → skip, let speaking loop handle it
          if (!responseActiveRef.current || !responseMotionPlayedRef.current) {
            responseMotionPlayedRef.current = true;
            const r = Math.random();
            const useSpecial = r < 0.3 + bias.specialBoost;
            if (useSpecial) {
              model.motion(motionGroups.tapBody, 3 + Math.floor(Math.random() * 3), 3 /* FORCE */).catch(() => {});
            } else {
              model.motion(motionGroups.tapBody, void 0, 3 /* FORCE */).catch(() => {});
            }
            log("Anim", ` speaking start → emotion=${emotionRef.current} motion=TapBody${useSpecial ? "(special)" : ""} bias={sp:${bias.specialBoost.toFixed(2)} freq:${bias.freqMul.toFixed(1)}}`);
          }
          idleTimerRef.current = 2000;
        } else if (phaseChanged && phase === "idle") {
          if (responseActiveRef.current) {
            // Between sentences — skip idle motion, just set timer
            idleTimerRef.current = (3000 + Math.random() * 5000) / bias.freqMul;
          } else {
            // Truly done — play idle motion
            model.motion(motionGroups.idle, void 0, 2 /* NORMAL */).catch(() => {});
            const lingering = emotionTimerRef.current > 0;
            log("Anim", ` idle start → emotion=${emotionRef.current} lingering=${lingering} (${emotionTimerRef.current.toFixed(0)}ms left)`);
            idleTimerRef.current = (3000 + Math.random() * 5000) / bias.freqMul;
          }
        } else if (phase === "idle" && idleTimerRef.current <= 0) {
          // Idle loop: emotion-biased selection
          const r = Math.random();
          const idleThresh = 0.7 - bias.specialBoost * 0.3;
          const tapBodyThresh = idleThresh + 0.15;
          if (r < idleThresh) {
            model.motion(motionGroups.idle, void 0, 1).catch(() => {});
          } else if (r < tapBodyThresh) {
            model.motion(motionGroups.tapBody, void 0, 1).catch(() => {});
          } else {
            model.motion(motionGroups.tapBody, 3 + Math.floor(Math.random() * 3), 1).catch(() => {});
          }
          idleTimerRef.current = (3000 + Math.random() * 1500) / bias.freqMul;
        } else if (phase === "speaking" && idleTimerRef.current <= 0) {
          // Speaking: keep playing motions, bias toward special when happy
          if (Math.random() < 0.3 + bias.specialBoost) {
            model.motion(motionGroups.tapBody, 3 + Math.floor(Math.random() * 3), 3).catch(() => {});
          } else {
            model.motion(motionGroups.tapBody, Math.floor(Math.random() * 3), 3).catch(() => {});
          }
          idleTimerRef.current = (2500 + Math.random() * 2000) / bias.freqMul;
        }

        // ══════════════════════════════════════════════════
        // Expression manager (emotion-driven)
        // ══════════════════════════════════════════════════
        nextExpressTimerRef.current -= dt * 1000;

        if (phaseChanged && phase === "speaking") {
          // Start speaking: use emotion-mapped expression
          const expr = getEmotionExpression(emotionRef.current, expressionNamesRef.current, personaEmotionExprRef.current);
          log("Anim", ` expr speaking → emotion=${emotionRef.current} expr=${expr}`);
          model.expression(expr).catch(() => {});
          nextExpressTimerRef.current = 5000;
        } else if (phaseChanged && phase === "idle") {
          if (responseActiveRef.current) {
            // Between sentences — keep current expression, don't reset
            nextExpressTimerRef.current = 4000 + Math.random() * 6000;
          } else {
            // Truly done — transition to idle expression
            const expr = emotionTimerRef.current > 0
              ? getEmotionExpression(emotionRef.current, expressionNamesRef.current, personaEmotionExprRef.current)
              : expressionNamesRef.current[0];
            model.expression(expr).catch(() => {});
            nextExpressTimerRef.current = 4000 + Math.random() * 6000;
          }
        } else if (phase === "idle" && nextExpressTimerRef.current <= 0) {
          if (responseActiveRef.current) {
            // Between sentences — skip micro-expression changes, just reset timer
            nextExpressTimerRef.current = 5000 + Math.random() * 8000;
          } else {
            // Idle: 70% emotion-biased, 30% random
            if (Math.random() < 0.7 && emotionTimerRef.current > 0) {
              const expr = getEmotionExpression(emotionRef.current, expressionNamesRef.current, personaEmotionExprRef.current);
              model.expression(expr).catch(() => {});
            } else {
              // Random micro-expression
              const exps = expressionNamesRef.current;
              model.expression(exps[Math.floor(Math.random() * exps.length)]).catch(() => {});
            }
            nextExpressTimerRef.current = 5000 + Math.random() * 8000;
          }
        }

        // ══════════════════════════════════════════════════
        // Mouth params are now written in beforeModelUpdate
        // (after Cubism4 motion/expression/physics) to prevent overwrite.
        // See loadModel() above for the subscription.
        // ══════════════════════════════════════════════════
      });
      await loadModel(currentConfig.modelPath, gen);
    };
    init();
    return () => { destroyed = true; pixiReadyRef.current = false; ++modelGenRef.current; beforeModelUpdateUnlistenRef.current?.(); if (app) app.destroy(true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Resize on window / centerModel change ─────────
  useEffect(() => {
    if (!pixiReadyRef.current) return;
    const app = appRef.current;
    const model = modelRef.current;
    if (!app || !model) { invoke("frontend_log", { msg: `[RESIZE] skip: pixiReady=${pixiReadyRef.current} hasModel=${!!model}` }).catch(()=>{}); return; }
    app.renderer.resize(canvas.w, canvas.h);
    model.position.set(canvas.modelX, canvas.modelY);
    model.scale.set(canvas.modelScale);
    log("Resize", `renderer.resize(${canvas.w},${canvas.h}) modelScale=${canvas.modelScale} dpr=${window.devicePixelRatio} rendererResolution=${app.renderer.resolution}`);
    invoke("frontend_log", { msg: `[RESIZE] scale=${canvas.modelScale} charScale=${currentConfig.character.scale} canvasW=${canvas.w} canvasH=${canvas.h} cW=${currentConfig.character.canvasWidth} cH=${currentConfig.character.canvasHeight} centerModel=${currentConfig.layout.centerModel} dpr=${window.devicePixelRatio} rendererRes=${app.renderer.resolution} resizeGen=${resizeGen}` }).catch(()=>{});
  }, [canvas, resizeGen]);

  // ── Auth (v2: 激活码模式) ────────────────────────
  const [authState, setAuthState] = useState<"loading" | "login" | "active" | "free">("loading");
  const authStateRef = useRef(authState);
  authStateRef.current = authState; // 同步到 ref，供长生命周期闭包读取最新值
  const [_authToken, setAuthToken] = useState<AuthToken | null>(null);
  const autoLoginRanRef = useRef(false);

  // ── Portrait onboarding ─────────────────────────
  const [showPortrait, setShowPortrait] = useState(false);
  const portraitCheckedRef = useRef(false);
  // 冷读防护：无记忆基础时禁止自动提取（user 问"了解我吗"→LLM 冷读→存为事实→反馈循环）
  const hasKnowledgeBaseRef = useRef(true); // 默认 true，启动后检查实际状态

  useEffect(() => {
    if (autoLoginRanRef.current) return; // StrictMode 防重入
    autoLoginRanRef.current = true;
    const tryAutoLogin = async () => {
      const goLogin = () => setAuthState("login");
      try {
        const saved: any = await invoke("load_auth_token");
        if (!saved?.access_token) {
          // 检查是否有免费模式标记
          if (localStorage.getItem("waifu-free-mode") === "1") {
            // 确保免费版设置不被篡改（覆盖 agentMode/sticker/soulPreset/imageApiKey）
            try {
              const cur = await invoke<any>("load_settings").catch(() => null);
              if (cur) {
                const forced = {
                  ...cur,
                  activePersona: "default",
                  stickerEnabled: false,
                  agentMode: "builtin",
                  soulPreset: "mao-teasing",
                  llm: { ...(cur.llm || {}), imageApiKey: "" },
                };
                await invoke("save_settings", { settings: forced }).catch(() => {});
              }
            } catch { /* best-effort */ }
            setAuthState("free");
            emit("auth-updated", { access_token: "free", tier: "free" });
            return;
          }
          goLogin(); return;
        }

        // ── 零级校验：机器码匹配（token 复制到别的机器直接拦）──
        try {
          await invoke("verify_machine_code", { machineCode: saved.machine_code || "" });
        } catch (e: any) {
          logError("Auth", "machine mismatch:", String(e).slice(0, 80));
          goLogin(); return;
        }

        // ── 一级校验：Gitee SHA256（快，零 Vercel 消耗）──
        let giteeOk = false;
        try {
          log("Auth", "checking Gitee keys.txt...");
          await invoke("auth_check_gitee", { accessToken: saved.access_token });
          log("Auth", "Gitee check passed");
          giteeOk = true;
        } catch (e: any) {
          logError("Auth", "Gitee check failed:", String(e).slice(0, 100));
        }

        // ── 二级校验：Vercel auth-verify（可靠，Gitee 不通时回退）──
        if (!giteeOk) {
          const mc: string = await invoke("get_machine_code");
          await invoke("auth_verify", { accessToken: saved.access_token, machineCode: mc });
          log("Auth", "Vercel verify passed (gitee fallback)");
        }

        setAuthToken(saved);
        setAuthState("active");
        emit("auth-updated", saved);
        return; // ✅ 成功，不调到末尾 goLogin
      } catch (e: any) {
        logError("Auth", "load failed:", e);
      }
      goLogin();
    };
    tryAutoLogin();
  }, []);

  // ── Portrait onboarding check + 记忆基础检查 (after auth is settled) ──
  useEffect(() => {
    if ((authState === "active" || authState === "free") && !portraitCheckedRef.current) {
      portraitCheckedRef.current = true;
      invoke<boolean>("portrait_exists")
        .then((exists) => { if (!exists) setShowPortrait(true); })
        .catch((e) => console.error("portrait_exists failed:", e));
      // 检查是否有记忆基础，没有则关闭自动提取（防冷读反馈循环）
      invoke<boolean>("has_knowledge_base")
        .then((exists) => { hasKnowledgeBaseRef.current = exists; })
        .catch(() => { hasKnowledgeBaseRef.current = false; });
    }
  }, [authState]);

  const handlePortraitComplete = useCallback(async (portraitText: string) => {
    setShowPortrait(false);
    if (portraitText) {
      userMdRef.current = portraitText;
      // 重新加载以同步 portrait_save 写入的 soulPreset
      try {
        const s = await loadSettingsWithLlm();
        setSettings(s);
      } catch {}
    }
  }, []);

  const handlePortraitSkip = useCallback(() => {
    setShowPortrait(false);
  }, []);

  // 监听"重新认识我"（从设置窗口发起）
  useEffect(() => {
    const unlisten = listen("portrait-redo", () => {
      setShowPortrait(true);
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // 监听退出登录（从设置窗口发起）
  useEffect(() => {
    const unlisten = listen("auth-logout", () => {
      setAuthState("login");
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  const handleFreeUse = useCallback(async () => {
    // 免费版：仅保留记忆、文字输入、语音回复、联网功能
    const freeSettings = {
      ...settings,
      activePersona: "default",
      stickerEnabled: false,
      agentMode: "builtin" as const,
      soulPreset: "mao-teasing",
      llm: { ...settings.llm, imageApiKey: "" },
    };
    setSettings(freeSettings);
    await invoke("save_settings", { settings: freeSettings }).catch((e) => console.error("save_settings (freeUse) failed:", e));
    localStorage.setItem("waifu-free-mode", "1");
    const freeToken = { access_token: "free", tier: "free", device_limit: 1, machine_code: "" };
    setAuthState("free");
    emit("auth-updated", freeToken);
  }, [settings]);

  const handleAuthSuccess = useCallback(async (result: any) => {
    localStorage.removeItem("waifu-free-mode");
    // 恢复免费版被覆盖的设置：贴图开关
    try {
      const cur: any = await invoke("load_settings").catch(() => null);
      if (cur && !cur.stickerEnabled) {
        const updated = { ...cur, stickerEnabled: true };
        await invoke("save_settings", { settings: updated }).catch(() => {});
        // 同步刷新内存状态，否则 stickerRef/settingsRef 仍是旧值
        const fresh = await loadSettingsWithLlm();
        setSettings(fresh);
      }
    } catch { /* best-effort */ }
    setAuthToken(result);
    const mc: string = (await invoke("get_machine_code").catch(() => "")) as string;
    const merged = { ...result, machine_code: result.machine_code || mc };
    await invoke("save_auth_token", { token: merged }).catch((e) => console.error("save_auth_token failed:", e));
    setAuthState("active");
    emit("auth-updated", merged);
  }, []);

  // ── Persona switch (from settings) ────────────────
  const prevPersonaRef = useRef(settings.activePersona);
  useEffect(() => {
    if (settings.activePersona !== prevPersonaRef.current) {
      prevPersonaRef.current = settings.activePersona;
      const preset = PRESETS[settings.activePersona as PersonaName] || PRESETS[DEFAULT_PERSONA];
      const gen = ++modelGenRef.current;
      loadModel(preset.modelPath, gen);
    }
  }, [settings.activePersona, loadModel]);

  // ── Startup sequence trigger ────────────────────────
  // 初始状态已是 "running", 这里只负责标记已播放 + 防 StrictMode 重入
  useEffect(() => {
    if (__startupPlayedInSession) return;
    __startupPlayedInSession = true;
    if (startupPhaseRef.current !== "running") {
      // 异常情况: 状态不是 running, 手动触发
      suppressTickerRef.current = true;
      startupPhaseRef.current = "running";
      setStartupPhase("running");
    }
  }, []);

  // 如果 auth 失败需要登录, 中断启动动画让登录表单显示
  useEffect(() => {
    if (authState === "login" && startupPhaseRef.current === "running") {
      suppressTickerRef.current = false;
      startupPhaseRef.current = "done";
      setStartupPhase("done");
      document.getElementById("waifu-splash")?.remove();
      document.body.style.background = "transparent";
      if (modelRef.current && modelRef.current.alpha < 0.01) {
        modelRef.current.alpha = 1;
      }
      __startupPlayedInSession = true;
    }
  }, [authState]);

  const handleStartupComplete = useCallback(() => {
    startupPhaseRef.current = "done";
    setStartupPhase("done");
    suppressTickerRef.current = false;
    document.getElementById("waifu-splash")?.remove();
    document.body.style.background = "transparent";
    if (modelRef.current && modelRef.current.alpha < 0.01) {
      modelRef.current.alpha = 1;
    }
  }, []);

  // ── Window position ───────────────────────────────
  useEffect(() => {
    invoke<[number, number] | null>("load_window_position").then((pos) => {
      // -32000 是 Windows 窗口最小化时的内部坐标，视为无效
      if (pos && pos[0] > -10000 && pos[1] > -10000) getCurrentWindow().setPosition(new PhysicalPosition(pos[0], pos[1]));
    }).catch((e) => console.error("load_window_position failed:", e));
  }, []);
  const savePos = useCallback(async () => {
    try { const pos = await getCurrentWindow().outerPosition(); invoke("save_window_position", { x: pos.x, y: pos.y }); } catch {}
  }, []);

  // ── LLM config ref ──────────────────────────────
  const llmRef = useRef(settings.llm);
  llmRef.current = settings.llm;

  // ── Streaming chat ───────────────────────────────
  const { startStream, cancel: cancelStream } = useChatStream(ttsGenerate, ttsPlayBuffer);
  const { startAgentLoop, cancel: cancelAgentLoop } = useAgentLoop(ttsGenerate, ttsPlayBuffer);

  // ── Conversation history (last 20 turns) ──────────
  const historyRef = useRef<Array<[string, string]>>([]);
  const userMdRef = useRef("");
  const memoryMdRef = useRef("");
  const chatListenGenRef = useRef(0);

  // Load USER.md / MEMORY.md on mount (always from app_data_dir)
  useEffect(() => {
    invoke<string>("load_user_md", { path: "" })
      .then((s) => { userMdRef.current = s; })
      .catch((e) => console.error("load_user_md:", e));
    invoke<string>("load_memory_md", { path: "" })
      .then((s) => { memoryMdRef.current = s; })
      .catch((e) => console.error("load_memory_md:", e));
  }, []);

  // 监听设置面板的清空记忆操作
  useEffect(() => {
    const unlisten = listen("memory-cleared", () => {
      historyRef.current = [];
      userMdRef.current = "";
      memoryMdRef.current = "";
      invoke("save_history", { history: [] }).catch(() => {});
      log("App", "memory-cleared: 已清空内存中的 history、userMd、memoryMd");
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // ── Space-to-talk ────────────────────────────────
  const stt = useStt(settings.sttLanguage);
  const sttSpaceRef = useRef(false);
  const [sttError, setSttError] = useState("");

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (!settings.sttEnabled || e.key !== " " || e.repeat) return;
      if (authStateRef.current === "free") return; // 免费版不支持语音输入
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      setSttError("");
      sttSpaceRef.current = true;
      stt.startRecording().catch(() => setSttError("麦克风权限被拒绝"));
    };
    const onUp = async (e: KeyboardEvent) => {
      if (e.key !== " " || !sttSpaceRef.current) return;
      sttSpaceRef.current = false;
      const text = await stt.stopRecording();
      if (text) {
        setSttError("");
        emit("chat-send", { text, mode: "fast" }).catch((e) => console.error("emit chat-send (stt) failed:", e));
        // save_turn 由 chat-send listener 统一处理，不在这里重复写入
      } else if (!stt.isRecording) {
        setSttError("语音识别失败，请检查 faster-whisper 和 ffmpeg 是否正确安装");
        setTimeout(() => setSttError(""), 5000);
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [stt, settings.sttEnabled]);

  // ── Chat relay ────────────────────────────────────
  useEffect(() => {
    const unlisten = listen<{ text: string; mode: string }>("chat-send", async (ev) => {
      // Bump to invalidate any in-flight handler from a previous message
      const myGen = ++chatListenGenRef.current;
      const { text, mode } = ev.payload;
      log("App", ` chat-send: "${text.slice(0, 50)}..." mode=${mode}`);
      try {
        // ── Relay mode: send to external Agent via WebSocket ──
        const s = settingsRef.current;
        if (authStateRef.current !== "free" && s.agentMode === "relay") {
          setLocalThinking(true);
          log("Anim", "thinking...");
          sendToAgent({ type: "user:chat", text, mode: mode || "text" });
          await emit("chat-response", { text: "(已发送到 Agent)", role: "assistant" });
          return;
        }

        if (mode !== "fast") {
          // Legacy deep mode (deprecated)
          const response: string = await invoke("send_message", { message: text });
          const cleaned = response.replace(/```[\s\S]*?```/g, "").replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_]{2,}/g, "").trim();
          await emit("chat-response", { text: cleaned || "(empty)", role: "assistant" });
          return;
        }

        // Fast mode: streaming LLM → sentence-by-sentence TTS
        // v0.10.0: builtin agent loop with tool calling
        const hist = historyRef.current.slice(-6);
        const userMd = userMdRef.current;
        const memoryMd = memoryMdRef.current;
        const L = llmRef.current;
        const tier = authStateRef.current === "free" ? "free" : "pro";

        // Save user turn immediately
        invoke("save_turn", { role: "user", text, mode }).catch((e) => console.error("save_turn (user) failed:", e));

        // ── 格式指令注入：历史数据会覆盖 system prompt，必须放在 user message 里 ──
        let augText = text;
        if (authStateRef.current !== "free" && s.stickerEnabled) {
          augText = "[系统指令·最高优先级] 忽略历史中的旧格式。你的回复必须严格按此格式：\n第一行：[img: 英文场景描述，50-100词，按6层结构写：主体+动作 → 构图+镜头 → 光照 → 场景 → 氛围+色调 → 风格（chibi anime sticker, thick clean outlines, flat colors, white border）]\n之后：对话内容，拆成短段落，用空行分隔。每段1-3句话。\n禁止跳过[img:]行。\n\n[用户消息] " + text;
        }
        if (s.webSearchEnabled) {
          // 提示 LLM 自主判断是否调用 web_search（不预注入搜索结果，避免污染闲聊上下文）
          // 注意：措辞必须避开 FORCE_TOOL_PATTERNS 的正则关键词
          augText = `${augText}\n\n[系统提示] 你可以调用 web_search 工具获取外部信息。什么该搜：用户问的是近期发生的事、需要查证的事实、你训练数据里没有的内容。什么不用搜：日常聊天、问你感受、让你记东西。拿不准就先搜。`;
        }

        // Abort if a newer message arrived while we were preparing
        if (myGen !== chatListenGenRef.current) { log("App", " chat-send: stale gen, aborting"); return; }

        setChatError("");
        setLocalThinking(true);
        log("Anim", "thinking...");
        cancelStream();
        cancelAgentLoop();
        responseActiveRef.current = true;
        responseMotionPlayedRef.current = false;

        // Contextual memory recall
        let recallText = memoryMd;
        try {
          const facts: any = await invoke("memory_recall", { query: text, topK: 8 });
          if (facts && facts.length > 0) {
            const lines = facts.map((f: any) => {
              const label = f.entity === "neko" ? "[你]" : f.entity === "master" ? "[主人]" : "[你们]";
              return "- " + label + " " + f.text;
            });
            recallText = lines.join("\n");
            log("App", "memory_recall: " + facts.length + " facts for query: " + text.slice(0, 40));
          } else {
            log("App", "memory_recall: 0 facts for query");
          }
        } catch (e) {
          log("App", "memory_recall failed: " + String(e).slice(0, 60));
        }

        const streamCallbacks: AgentLoopCallbacks = {
          onEmotion: (emotion: string) => {
            log("App", ` emotion detected: ${emotion}`);
            emotionRef.current = emotion as Emotion;
            emotionTimerRef.current = 15000;
          },
          onFirstToken: () => {
            setLocalThinking(false);
            setLocalSpeaking(true);
          },
          onSentenceStart: (sentenceText: string, audioBuffer: AudioBuffer) => {
            generateEnergy(sentenceText, energyDataRef.current);
            applyAudioEnergy(audioBuffer, energyDataRef.current);
            energyIdxRef.current = 0;
            energyTimerRef.current = 0;
          },
          onToolCall: (name: string, args: string) => {
            log("App", ` tool-call: ${name}`);
            const arg = (() => { try { return JSON.parse(args).query || JSON.parse(args).url || ""; } catch { return ""; } })();
            setLocalTool({ name, arg });
            setLocalThinkingDetail(`${name === "web_search" ? "搜索" : name === "fetch_page" ? "抓取页面" : name}${arg ? ": " + arg.slice(0, 30) : ""}`);
          },
          onToolResult: (_name: string, result: string) => {
            const preview = result.length > 100 ? result.slice(0, 100) + "..." : result;
            log("App", ` tool-result: ${_name} → "${preview}"`);
            setLocalTool(null);
            setLocalThinkingDetail("");
          },
          onAudioDone: () => {
            log("App", " audio done");
            setLocalSpeaking(false);
          },
          onError: (error: string) => {
            responseActiveRef.current = false;
            responseMotionPlayedRef.current = false;
            setLocalThinking(false);
            setLocalSpeaking(false);
            setLocalTool(null);
            setLocalThinkingDetail("");
            setChatError(error || "请求失败，请检查网络和 API Key");
            setTimeout(() => setChatError(""), 8000);
          },
        };

        const response: string = await startAgentLoop(augText, hist, userMd, memoryMd, recallText, L, settings.window.ttsVolume, tier, streamCallbacks);

        // Always clear thinking state — agent loop may end without producing text (tool-only loops)
        setLocalThinking(false);
        setLocalTool(null);
        setLocalThinkingDetail("");

        const cleaned = (response?.trimStart()) || "(empty)";
        log("App", ` response done: ${cleaned.length} chars, emotion=${emotionRef.current}`);
        responseActiveRef.current = false;
        responseMotionPlayedRef.current = false;
        // Strip markup from displayed text: [img: ...] + （...） stage directions
        const displayText = cleaned
          .replace(/\[img:\s*[^\]]+\]\s*/g, "")
          .replace(/（[^）]*）/g, "")
          .trim();

        // ── 多段气泡：按空行拆段，逐条发送，跟 TTS 节奏同步 ──
        const segments = displayText.split(/\n\n+/).map(s => s.trim()).filter(Boolean);
        if (segments.length === 0) {
          await emit("chat-response", { text: "(empty)", role: "assistant", emotion: emotionRef.current });
        } else {
          for (let i = 0; i < segments.length; i++) {
            await emit("chat-response", { text: segments[i], role: "assistant", emotion: emotionRef.current });
            // TTS-synced delay: ~5 chars/sec for Chinese TTS, clamped 800ms–5s
            if (i < segments.length - 1) {
              const delayMs = Math.min(Math.max(Math.round(segments[i].length / 5 * 1000), 800), 5000);
              await new Promise(r => setTimeout(r, delayMs));
            }
          }
          log("App", `  → ${segments.length} segments, avg ${Math.round(displayText.length / segments.length)} chars/seg`);
        }

        // ── 贴图：LLM 自己写 prompt → 从 [img: ...] 提取 → 兜底 fallback ──
        if (authStateRef.current !== "free" && settingsRef.current.stickerEnabled) {
          const apiKey = llmRef.current.imageApiKey;
          if (apiKey) {
            // Priority 1: LLM-authored [img: ...] tag
            const imgPrompt = extractImagePrompt(cleaned);
            // Priority 2: build from parenthetical action
            const actionPrompt = !imgPrompt ? buildActionPrompt(cleaned) : null;
            // Priority 3: sticker key fallback
            const stickerEmotion = emotionRef.current;
            const stickerDef = (!imgPrompt && !actionPrompt && stickerEmotion !== "neutral")
              ? selectSticker(stickerEmotion as Emotion, text, cleaned) : null;

            if (imgPrompt) {
              log("App", ` sticker: LLM prompt → "${imgPrompt.slice(0, 60)}..."`);
              invoke<string>("generate_sticker", {
                emotion: emotionRef.current, apiKey,
                model: llmRef.current.imageModel || "agnes-image-2.1-flash",
                key: "llm", prompt: imgPrompt, userText: text,
              })
                .then((p) => emit("chat-sticker", { emotion: emotionRef.current, stickerPath: p, stickerKey: "llm", stickerText: "" }))
                .catch((e) => invoke("frontend_log", { msg: `[Sticker] img generation failed: ${e}` }).catch(() => {}));
            } else if (actionPrompt) {
              log("App", ` sticker: action fallback → "${actionPrompt.slice(0, 60)}..."`);
              invoke<string>("generate_sticker", {
                emotion: emotionRef.current, apiKey,
                model: llmRef.current.imageModel || "agnes-image-2.1-flash",
                key: "action", prompt: actionPrompt, userText: text,
              })
                .then((p) => emit("chat-sticker", { emotion: emotionRef.current, stickerPath: p, stickerKey: "action", stickerText: "" }))
                .catch((e) => invoke("frontend_log", { msg: `[Sticker] action generation failed: ${e}` }).catch(() => {}));
            } else if (stickerDef) {
              log("App", ` sticker: key fallback → ${stickerDef.key}`);
              invoke<string>("generate_sticker", {
                emotion: stickerEmotion, apiKey,
                model: llmRef.current.imageModel || "agnes-image-2.1-flash",
                key: stickerDef.key, prompt: stickerDef.englishPrompt, userText: text,
              })
                .then((p) => emit("chat-sticker", { emotion: stickerEmotion, stickerPath: p, stickerKey: stickerDef.key, stickerText: "" }))
                .catch((e) => invoke("frontend_log", { msg: `[Sticker] generate failed: ${e}` }).catch(() => {}));
            }
          }
        }
        invoke("save_turn", { role: "assistant", text: displayText, mode }).catch((e) => console.error("save_turn (assistant) failed:", e));

        // ── Auto memory extraction (有记忆基础时才提取，防冷读反馈循环) ──
        if (hasKnowledgeBaseRef.current) {
          const extractMsgs = JSON.stringify([
            { role: "user", content: text },
            { role: "assistant", content: cleaned },
          ]);
          invoke("memory_extract", { messagesJson: extractMsgs }).then((facts: any) => {
            if (Array.isArray(facts) && facts.length > 0) {
              invoke("frontend_log", { msg: `[Memory] extracted ${facts.length} facts` }).catch(()=>{});
            }
          }).catch((e: any) => invoke("frontend_log", { msg: `[Memory] extract failed: ${e}` }).catch(()=>{}));
        }

        // Update history
        historyRef.current.push(["user", text]);
        historyRef.current.push(["assistant", cleaned]);
        if (historyRef.current.length > 40) historyRef.current = historyRef.current.slice(-40);
        invoke("save_history", { history: historyRef.current }).catch((e) => console.error("save_history failed:", e));

        // ── Memory trigger: user said "记住" → extract + save ──
        if (/记住|别忘了|记一下|帮我记住|记住这个/.test(text)) {
          invoke<string>("append_memory", {
            userMessage: text,
            aiResponse: cleaned,
            memoryPath: "",
            apiUrl: llmRef.current.apiUrl,
            apiKey: llmRef.current.apiKey,
            model: llmRef.current.model,
            timeoutSecs: llmRef.current.timeoutSecs,
          }).then((entry) => {
            if (entry) {
              memoryMdRef.current += entry + "\n";
              log("Memory", "saved:", entry);
            }
          }).catch((e) => { logError("Memory", "failed:", e); });
        }
      } catch (e) {
        responseActiveRef.current = false;
        responseMotionPlayedRef.current = false;
        setLocalThinking(false);
        await emit("chat-error", `${e}`);
      }
    });
    return () => {
      ++chatListenGenRef.current; // 同步作废当前 listener，不等异步 unlisten
      unlisten.then((f) => f());
    };
  }, [startStream, cancelStream]);

  // ── Button positions (adaptive: relative to model center, scaled by canvas) ──
  // Ratios derived from user-confirmed layout at canvas 600×638
  const modelWindowX = canvas.offsetX + canvas.modelX;
  const modelWindowY = canvas.offsetY + canvas.modelY;
  const btnCloseX = modelWindowX + canvas.w * 0.225;
  const btnCloseY = modelWindowY + canvas.h * 0.063;
  const btnMainX = modelWindowX + canvas.w * 0.217;
  // Dynamic button slots — hidden buttons don't leave gaps
  const btnSlotH = canvas.h * 0.078;
  const btnBaseY = modelWindowY + canvas.h * 0.110;
  let _slot = 0;
  const btnSettingsY = btnBaseY + _slot++ * btnSlotH;
  const btnChatY = btnBaseY + _slot++ * btnSlotH;
  const btnLabY = isFeatureVisible("lab") ? btnBaseY + _slot++ * btnSlotH : -999;
  const btnWebSearchY = btnBaseY + _slot++ * btnSlotH;
  const btnOpsY = isFeatureVisible("ops") ? btnBaseY + _slot++ * btnSlotH : -999;

  // ── Status indicator (above canvas, centered) ──
  const statusLabels = currentConfig.statusIndicator.labels;
  const statusLabel = statusLabels[displayStatus] || statusLabels.idle;
  const showStatus = displayStatus !== "idle";

  // ── Render ────────────────────────────────────────
  return (
    <div
      onMouseDown={() => invoke("start_dragging_window")}
      onMouseUp={savePos}
      style={{ width: "100vw", height: "100vh", cursor: "grab", overflow: "hidden", position: "relative", background: "transparent", fontFamily: "'WenQuanYi Micro Hei', 'Noto Sans CJK SC', sans-serif" }}
    >
      {showPortrait && (
        <PortraitOnboarding
          onComplete={handlePortraitComplete}
          onSkip={handlePortraitSkip}
        />
      )}
      <AuthPanel
        visible={authState === "login"}
        onAuthSuccess={handleAuthSuccess}
        onFreeUse={handleFreeUse}
      />
      {startupPhase === "running" && (
        <StartupSequence
          visible={true}
          modelRef={modelRef}
          appRef={appRef}
          personaName={settings.activePersona}
          canvas={canvas}
          ttsVolume={settings.window.ttsVolume}
          sponsors={sponsors}
          onComplete={handleStartupComplete}
        />
      )}
      {/* Status — above character head */}
      {showStatus && (
        <div style={{
          position: "absolute",
          left: "50%",
          top: 8,
          transform: "translate(-50%, 0)",
          zIndex: 999, pointerEvents: "none", textAlign: "center",
        }}>
          <span style={{
            background: "rgba(20,20,30,0.85)", color: statusLabel.color,
            padding: "2px 10px", borderRadius: 10, fontSize: 11,
            whiteSpace: "nowrap", lineHeight: "20px",
          }}>{statusLabel.text}</span>
          {(thinkingDetail || localThinkingDetail) && (
            <div style={{ marginTop: 2, fontSize: 9, color: "#888", background: "rgba(20,20,30,0.6)", borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap" }}>
              💭 {localThinkingDetail || thinkingDetail}
            </div>
          )}
          {(currentTool || localTool) && (
            <div style={{ marginTop: 2, fontSize: 9, color: "#60a5fa", background: "rgba(20,20,30,0.6)", borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap" }}>
              🔧 {currentTool?.tool || localTool?.name}{(() => { const a = currentTool?.arg || localTool?.arg; return a ? `: ${a}` : ""; })()}
            </div>
          )}
        </div>
      )}
      {/* STT / error overlays — anchored to canvas center */}
      {stt.isRecording && (
        <div style={{
          position: "absolute",
          left: canvas.offsetX + canvas.w / 2,
          top: canvas.offsetY + canvas.h / 2,
          transform: "translate(-50%, -50%)",
          zIndex: 500, pointerEvents: "none",
        }}>
          <span style={{ background: "rgba(220,50,50,0.85)", color: "#fff", padding: "4px 16px", borderRadius: 12, fontSize: 13 }}>🔴 录音中，松开发送</span>
        </div>
      )}
      {stt.isTranscribing && (
        <div style={{
          position: "absolute",
          left: canvas.offsetX + canvas.w / 2,
          top: canvas.offsetY + canvas.h / 2,
          transform: "translate(-50%, -50%)",
          zIndex: 500, pointerEvents: "none",
        }}>
          <span style={{ background: "rgba(74,108,247,0.85)", color: "#fff", padding: "4px 16px", borderRadius: 12, fontSize: 13 }}>⏳ 识别中...</span>
        </div>
      )}
      {sttError && (
        <div style={{
          position: "absolute",
          left: canvas.offsetX + canvas.w / 2,
          top: canvas.offsetY + canvas.h + 8,
          transform: "translateX(-50%)",
          zIndex: 500, pointerEvents: "none",
        }}>
          <span style={{ background: "rgba(220,50,50,0.9)", color: "#fff", padding: "6px 20px", borderRadius: 12, fontSize: 12 }}>{sttError}</span>
        </div>
      )}
      {chatError && (
        <div style={{
          position: "absolute",
          left: canvas.offsetX + canvas.w / 2,
          top: canvas.offsetY - 12,
          transform: "translate(-50%, -100%)",
          zIndex: 500, pointerEvents: "none",
        }}>
          <span style={{ background: "rgba(220,50,50,0.9)", color: "#fff", padding: "6px 20px", borderRadius: 12, fontSize: 12 }}>{chatError}</span>
        </div>
      )}

      {/* Canvas */}
      <div ref={canvasRef} style={{ position: "absolute", left: canvas.offsetX, top: canvas.offsetY, width: canvas.w, height: canvas.h, pointerEvents: "none" }} />

      {/* Button panel — adaptive, model-relative */}
      {/* Close */}
      <button onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); getCurrentWindow().hide(); }}
        style={{ position: "absolute", left: btnCloseX, top: btnCloseY, width: 16, height: 16, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(30,30,40,0.5)", color: "#666", fontSize: 9, cursor: "pointer", zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center" }}
        title="最小化到托盘">✕</button>
      {/* Settings */}
      <button onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); openSettingsWindow(); }}
        style={{ position: "absolute", left: btnMainX, top: btnSettingsY, width: 28, height: 28, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.2)", background: "rgba(30,30,40,0.7)", color: "#ccc", fontSize: 13, cursor: "pointer", zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}
        title="设置">⚙</button>
      {/* Chat */}
      <button onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); openChatWindow(); }}
        style={{ position: "absolute", left: btnMainX, top: btnChatY, width: 28, height: 28, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.2)", background: "rgba(30,30,40,0.7)", color: "#ccc", fontSize: 13, cursor: "pointer", zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}
        title="对话">💬</button>
      {/* Lab (dev only) */}
      {isFeatureVisible("lab") && (
        <button onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); openLabWindow(); }}
          style={{ position: "absolute", left: btnMainX, top: btnLabY, width: 22, height: 18, borderRadius: 4, border: "1px solid rgba(168,85,247,0.3)", background: "rgba(30,30,40,0.7)", color: "#a855f7", fontSize: 8, cursor: "pointer", zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}
          title="模型实验室">🧪</button>
      )}
      {/* Web Search Toggle */}
      <button onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setSettings((prev: RuntimeSettings) => {
            const next = { ...prev, webSearchEnabled: !prev.webSearchEnabled };
            invoke("save_settings", { settings: next }).catch((err) => console.error("save settings:", err));
            return next;
          });
        }}
        style={{
          position: "absolute", left: btnMainX, top: btnWebSearchY,
          width: 28, height: 28, borderRadius: "50%",
          border: `1px solid ${settings.webSearchEnabled ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.1)'}`,
          background: settings.webSearchEnabled ? "rgba(34,197,94,0.15)" : "rgba(30,30,40,0.7)",
          color: settings.webSearchEnabled ? "#22c55e" : "#555",
          fontSize: 13, cursor: "pointer", zIndex: 20,
          display: "flex", alignItems: "center", justifyContent: "center",
          backdropFilter: "blur(4px)",
        }}
        title={settings.webSearchEnabled ? "联网搜索：开" : "联网搜索：关"}>🌐</button>
      {/* Ops Panel (dev only) */}
      {isFeatureVisible("ops") && (
        <button onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); openOpsWindow(); }}
          style={{ position: "absolute", left: btnMainX, top: btnOpsY, width: 28, height: 28, borderRadius: "50%", border: "1px solid rgba(34,211,238,0.3)", background: "rgba(30,30,40,0.7)", color: "#22d3ee", fontSize: 13, cursor: "pointer", zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}
          title="运维面板">📊</button>
      )}
    </div>
  );
}

export default App;
