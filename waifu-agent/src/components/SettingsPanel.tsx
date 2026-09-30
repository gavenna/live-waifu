/**
 * SettingsPanel — 运行时设置面板
 *
 * 8 个可折叠区域，修改即时生效，2 秒后自动写入磁盘。
 * 仿 DiagPanel 风格：深色背景、绝对定位、z-index 999。
 */

import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { isFeatureVisible } from "../config/featureFlags";
import { PRESETS, DEFAULT_PERSONA } from "../persona.config";
import type { RuntimeSettings } from "../types/settings";


interface Props {
  visible: boolean;
  onClose?: () => void;
  settings: RuntimeSettings;
  onSettingsChange: (s: RuntimeSettings) => void;
  standalone?: boolean;
  onSave?: () => void;
  onReset?: () => void;
  dirty?: boolean;
}

function updateSettings(
  prev: RuntimeSettings,
  section: string,
  field: string,
  value: any,
): RuntimeSettings {
  return {
    ...prev,
    [section]: {
      ...(prev as any)[section],
      [field]: value,
    },
  };
}

// ── Section wrapper ─────────────────────────────────

function Section({ title, defaultOpen, children }: {
  title: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} style={{ marginBottom: 4 }}>
      <summary style={summaryStyle}>{title}</summary>
      <div style={sectionBodyStyle}>{children}</div>
    </details>
  );
}

// ── Small input helpers ─────────────────────────────

function NumInput({ value, onChange, min, max, step, label }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label?: string;
}) {
  return (
    <label style={fieldLabelStyle}>
      {label && <span style={labelTextStyle}>{label}</span>}
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        min={min} max={max} step={step || 0.01}
        style={numInputStyle}
      />
    </label>
  );
}

function Toggle({ value, onChange, label }: {
  value: boolean; onChange: (v: boolean) => void; label: string;
}) {
  return (
    <label style={{ ...fieldLabelStyle, cursor: "pointer" }}>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        style={{ margin: 0, accentColor: "#4a6cf7" }}
      />
      <span style={{ fontSize: 11, color: "#ccc" }}>{label}</span>
    </label>
  );
}

// ── Main component ──────────────────────────────────

export function SettingsPanel({ visible, onClose, settings, onSettingsChange, standalone, onSave, onReset, dirty }: Props) {
  const [showKey, setShowKey] = useState(false);
  const [userTier, setUserTier] = useState(() =>
    localStorage.getItem("waifu-free-mode") === "1" ? "free" : "");

  // 同步 tier（监听 auth-updated + localStorage）
  useEffect(() => {
    const check = async () => {
      try {
        const token: any = await invoke("load_auth_token");
        if (token?.tier) { setUserTier(token.tier); localStorage.removeItem("waifu-free-mode"); }
        else if (localStorage.getItem("waifu-free-mode") === "1") { setUserTier("free"); }
      } catch { /* ignore */ }
    };
    check();
    const unlisten = listen("auth-updated", () => { check(); });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  const s = settings;

  const change = useCallback(
    (section: string, field: string, value: any) => {
      onSettingsChange(updateSettings(settings, section, field, value));
    },
    [settings, onSettingsChange],
  );

  const handleReset = useCallback(() => {
    const d = PRESETS[DEFAULT_PERSONA];
    const defs: RuntimeSettings = {
      activePersona: DEFAULT_PERSONA,
      character: { ...d.character },
      appearance: { ...d.appearance },
      breathing: { ...d.breathing },
      lipsync: { ...d.lipsync },
      statusIndicator: { ...d.statusIndicator },
      chat: { ...d.chat },
      websocket: { ...d.websocket },
      layout: { chatPanelWidth: 100, statusPosition: "left", centerModel: true },
      llm: {
        provider: "deepseek",
        apiUrl: "https://api.deepseek.com/v1/chat/completions",
        apiKey: "",
        model: "deepseek-v4-flash",
        timeoutSecs: 30,
        tavilyApiKey: "",
        imageApiKey: "",
        imageModel: "agnes-image-2.1-flash",
      },
      window: { alwaysOnTop: true, skipTaskbar: true, ttsVolume: 80, width: 600, height: 800 },
      sttEnabled: true,
      sttLanguage: "zh",
      sttIndicatorPosition: "top",
      autostart: false,
      agentMode: "builtin" as const,
      webSearchEnabled: true,
      stickerEnabled: true,
      soulPreset: "mao-teasing",
    };
    onSettingsChange(defs);
  }, [onSettingsChange]);

  const handleSave = useCallback(() => {
    invoke("save_settings", { settings }).catch((e) => console.error("save_settings failed:", e));
    emit("settings-updated", settings).catch((e) => console.error("emit settings-updated failed:", e));
  }, [settings]);

  if (!visible) return null;

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      style={standalone ? standalonePanelStyle : panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ color: "#ccc", fontSize: 13, fontWeight: 600 }}>⚙ 设置</span>
        {!standalone && (
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onClose?.(); }}
            style={closeBtnStyle}>✕</button>
        )}
      </div>

      {/* Scrollable content */}
      <div style={scrollStyle}>
        {/* 1. 模型 */}
        <Section title="模型 (Model)" defaultOpen>
          {userTier === "free" && (
            <div style={{ fontSize: 10, color: "#a78bfa", marginBottom: 8 }}>
              🔒 免费版仅 Haru — <a href="https://ifdian.net/a/eidolonByKevin?tab=shop" target="_blank" rel="noopener noreferrer" style={{ color: "#a78bfa" }}>升级 Pro</a> 解锁 Mao
            </div>
          )}
          <label style={fieldLabelStyle}>
            <span style={labelTextStyle}>模型</span>
            <select
              value={s.activePersona === "mao" ? "mao" : "haru"}
              onChange={(e) => {
                if (userTier === "free" && e.target.value !== "haru") return;
                const modelMap: Record<string, string> = { haru: "default", mao: "mao" };
                onSettingsChange({ ...settings, activePersona: modelMap[e.target.value] || "default" });
              }}
              style={selectStyle}
            >
              <option value="haru">Haru Greeter</option>
              <option value="mao">{userTier === "free" ? "Mao 🔒" : "Mao"}</option>
            </select>
          </label>
        </Section>

        {/* 2. Character (USER 可见 — 用户需要调角色大小位置) */}
        <Section title="角色尺寸 (Character)">
          <NumInput label="缩放" value={s.character.scale} onChange={(v) => change("character", "scale", v)} min={0.01} max={2} step={0.01} />
          <NumInput label="X 位置" value={s.character.posX} onChange={(v) => change("character", "posX", v)} min={0} max={2000} step={1} />
          <NumInput label="Y 位置" value={s.character.posY} onChange={(v) => change("character", "posY", v)} min={0} max={2000} step={1} />
          <NumInput label="Canvas 宽" value={s.character.canvasWidth} onChange={(v) => change("character", "canvasWidth", v)} min={100} max={2000} step={10} />
          <NumInput label="Canvas 高" value={s.character.canvasHeight} onChange={(v) => change("character", "canvasHeight", v)} min={100} max={2000} step={10} />
        </Section>

        {/* 3. Appearance (dev only) */}
        {isFeatureVisible("appearance") && (
        <Section title="外观 (Appearance)">
          <div style={rowStyle}>
            <NumInput label="R" value={s.appearance.bgColor.r} onChange={(v) => change("appearance", "bgColor", { ...s.appearance.bgColor, r: v })} min={0} max={255} step={1} />
            <NumInput label="G" value={s.appearance.bgColor.g} onChange={(v) => change("appearance", "bgColor", { ...s.appearance.bgColor, g: v })} min={0} max={255} step={1} />
            <NumInput label="B" value={s.appearance.bgColor.b} onChange={(v) => change("appearance", "bgColor", { ...s.appearance.bgColor, b: v })} min={0} max={255} step={1} />
            <NumInput label="A" value={s.appearance.bgColor.a} onChange={(v) => change("appearance", "bgColor", { ...s.appearance.bgColor, a: v })} min={0} max={1} step={0.05} />
          </div>
          <NumInput label="圆角" value={s.appearance.borderRadius} onChange={(v) => change("appearance", "borderRadius", v)} min={0} max={40} step={1} />
          <NumInput label="按钮大小" value={s.appearance.chatBtnSize} onChange={(v) => change("appearance", "chatBtnSize", v)} min={20} max={60} step={1} />
          <NumInput label="按钮边距" value={s.appearance.chatBtnMargin} onChange={(v) => change("appearance", "chatBtnMargin", v)} min={2} max={40} step={1} />
        </Section>
        )}

        {/* 4. Breathing (dev only) */}
        {isFeatureVisible("breathing") && (
        <Section title="呼吸 (Breathing)">
          <NumInput label="周期 (ms)" value={s.breathing.periodMs} onChange={(v) => change("breathing", "periodMs", v)} min={500} max={10000} step={100} />
          <NumInput label="幅度" value={s.breathing.amplitude} onChange={(v) => change("breathing", "amplitude", v)} min={0.001} max={0.2} step={0.001} />
        </Section>
        )}

        {/* 5. Lipsync (dev only) */}
        {isFeatureVisible("lipsync") && (
        <Section title="口型 (Lipsync)">
          <NumInput label="速度" value={s.lipsync.speed} onChange={(v) => change("lipsync", "speed", v)} min={10} max={200} step={1} />
          <NumInput label="幅度" value={s.lipsync.amplitude} onChange={(v) => change("lipsync", "amplitude", v)} min={0} max={1} step={0.01} />
          <NumInput label="偏移" value={s.lipsync.offset} onChange={(v) => change("lipsync", "offset", v)} min={0} max={1} step={0.01} />
          <NumInput label="子频率" value={s.lipsync.subFreq} onChange={(v) => change("lipsync", "subFreq", v)} min={0} max={10} step={0.1} />
          <NumInput label="子幅度" value={s.lipsync.subAmplitude} onChange={(v) => change("lipsync", "subAmplitude", v)} min={0} max={1} step={0.01} />
          <NumInput label="子偏移" value={s.lipsync.subOffset} onChange={(v) => change("lipsync", "subOffset", v)} min={0} max={1} step={0.01} />
        </Section>
        )}

        {/* 6. AI 模式 (Pro only) */}
        {userTier !== "free" && isFeatureVisible("agentMode") && (
        <Section title="AI 模式 (Agent Mode)" defaultOpen>
          <label style={fieldLabelStyle}>
            <span style={labelTextStyle}>模式</span>
            <select
              value={s.agentMode}
              onChange={(e) => onSettingsChange({ ...settings, agentMode: e.target.value as "builtin" | "relay" })}
              style={selectStyle}
            >
              <option value="builtin">🌟 内置 (LLM API)</option>
              <option value="relay">🔌 中继 (外部 Agent)</option>
            </select>
          </label>
          <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>
            {s.agentMode === "relay"
              ? "通过 WebSocket 连接外部 Agent (Hermes/OpenClaw/自定义)，waifu 不碰 API key。"
              : "waifu 内置 LLM 客户端，需要配置下方 API 信息。"}
          </div>
        </Section>
        )}
        {/* 6b. LLM API (仅内置模式) */}
        {s.agentMode !== "relay" && (
          <Section title="LLM API">
            <label style={fieldLabelStyle}>
              <span style={labelTextStyle}>Provider</span>
              <select
                value={s.llm.provider || "deepseek"}
                onChange={(e) => change("llm", "provider", e.target.value)}
                style={selectStyle}
              >
                <option value="deepseek">DeepSeek (官方)</option>
                <option value="minimax-relay">MiniMax M3 (推荐)</option>
              </select>
            </label>
            {s.llm.provider !== "minimax-relay" && (
            <label style={fieldLabelStyle}>
              <span style={labelTextStyle}>API URL</span>
              <input
                type="text"
                value={s.llm.apiUrl}
                onChange={(e) => change("llm", "apiUrl", e.target.value)}
                style={textInputStyle}
              />
            </label>
            )}
            <label style={fieldLabelStyle}>
              <span style={labelTextStyle}>API Key</span>
              <div style={{ display: "flex", gap: 2 }}>
                <input
                  type={showKey ? "text" : "password"}
                  value={s.llm.apiKey}
                  onChange={(e) => change("llm", "apiKey", e.target.value)}
                  style={{ ...textInputStyle, flex: 1 }}
                />
                <button
                  onClick={() => setShowKey((v) => !v)}
                  style={tinyBtnStyle}
                >{showKey ? "●" : "○"}</button>
              </div>
            </label>
            {s.llm.provider !== "minimax-relay" && (
            <label style={fieldLabelStyle}>
              <span style={labelTextStyle}>Model</span>
              <input
                type="text"
                value={s.llm.model}
                onChange={(e) => change("llm", "model", e.target.value)}
                style={textInputStyle}
              />
            </label>
            )}
            {s.llm.provider === "minimax-relay" && (
              <div style={{ fontSize: 10, color: "#8b9cf7", marginBottom: 6, marginLeft: 48 }}>
                URL 和模型已预设，只需填写中转站 API Key
              </div>
            )}
            <label style={fieldLabelStyle}>
              <span style={labelTextStyle}>Tavily Key</span>
              <input
                type="password"
                value={s.llm.tavilyApiKey || ""}
                onChange={(e) => change("llm", "tavilyApiKey", e.target.value)}
                placeholder="搜索质量 key，空则用 Bing"
                style={textInputStyle}
              />
              <a href="https://app.tavily.com/" target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: "#666", marginLeft: 6, textDecoration: "none" }} title="Tavily 免费 1000 次/月">获取 Key ↗</a>
            </label>
            <NumInput label="超时 (s)" value={s.llm.timeoutSecs} onChange={(v) => change("llm", "timeoutSecs", v)} min={5} max={300} step={5} />
          </Section>
        )}

        {/* 6c. 图片生成 API (Pro only) */}
        {userTier !== "free" && (
        <Section title="图片生成 (Image Gen)" defaultOpen>
          <label style={fieldLabelStyle}>
            <span style={labelTextStyle}>API Key</span>
            <div style={{ display: "flex", gap: 2 }}>
              <input
                type={showKey ? "text" : "password"}
                value={s.llm.imageApiKey || ""}
                onChange={(e) => change("llm", "imageApiKey", e.target.value)}
                placeholder="sk-lcc-... (LiteChipCloud)"
                style={{ ...textInputStyle, flex: 1 }}
              />
            </div>
          </label>
          <label style={fieldLabelStyle}>
            <span style={labelTextStyle}>Model</span>
            <select
              value={s.llm.imageModel || "agnes-image-2.1-flash"}
              onChange={(e) => change("llm", "imageModel", e.target.value)}
              style={selectStyle}
            >
              <option value="agnes-image-2.1-flash">agnes-image-2.1-flash (文生图)</option>
              <option value="agnes-image-2.0-flash">agnes-image-2.0-flash (图生图)</option>
            </select>
          </label>
          <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>
            LiteChipCloud Agnes 系列，OpenAI images 协议。文生图 / 图生图。
          </div>
        </Section>
        )}

        {/* 7. Window */}
        <Section title="窗口 (Window)" defaultOpen>
          <Toggle label="始终置顶" value={s.window.alwaysOnTop} onChange={(v) => change("window", "alwaysOnTop", v)} />
          <Toggle label="隐藏任务栏" value={s.window.skipTaskbar} onChange={(v) => change("window", "skipTaskbar", v)} />
          <Toggle label="开机自启" value={s.autostart} onChange={(v) => onSettingsChange({ ...settings, autostart: v })} />
          <label style={fieldLabelStyle}>
            <span style={labelTextStyle}>TTS 音量</span>
            <input type="range" min={0} max={100} step={5}
              value={s.window.ttsVolume} onChange={(e) => change("window", "ttsVolume", parseInt(e.target.value))}
              style={{ flex: 1, maxWidth: 100, accentColor: "#4a6cf7" }} />
            <span style={{ fontSize: 10, color: "#aaa", marginLeft: 4 }}>{s.window.ttsVolume}%</span>
          </label>
          <label style={fieldLabelStyle}>
            <span style={labelTextStyle}>窗口尺寸</span>
            <input type="number" min={300} max={1200} step={10}
              value={s.window.width} onChange={(e) => change("window", "width", parseInt(e.target.value) || 600)}
              style={{ ...numInputStyle, width: 48 }} />
            <span style={{ fontSize: 10, color: "#888" }}>×</span>
            <input type="number" min={400} max={1600} step={10}
              value={s.window.height} onChange={(e) => change("window", "height", parseInt(e.target.value) || 800)}
              style={{ ...numInputStyle, width: 48 }} />
          </label>
        </Section>

        {/* 8. 用户 & 记忆 (dev only) */}
        {isFeatureVisible("memoryMgmt") && (
        <Section title="用户 & 记忆 (User & Memory)">
          <div style={{ fontSize: 9, color: "#666", marginTop: 4 }}>
            USER.md 手动编辑，MEMORY.md 由 AI 在你说"记住"时自动写入。文件保存在应用数据目录。
          </div>
          <ClearMemoryButton />
        </Section>
        )}

        {/* 9. STT 语音输入 */}
        {isFeatureVisible("stt") && (
        <Section title="语音输入 (STT)" defaultOpen>
          {userTier === "free" ? (
            <div style={{ fontSize: 10, color: "#a78bfa", marginBottom: 8 }}>
              🔒 语音输入为 Pro 专属功能 — <a href="https://ifdian.net/a/eidolonByKevin?tab=shop" target="_blank" rel="noopener noreferrer" style={{ color: "#a78bfa" }}>升级 Pro</a>
            </div>
          ) : (
            <Toggle label="空格语音输入" value={s.sttEnabled} onChange={(v) => onSettingsChange({ ...settings, sttEnabled: v })} />
          )}
          <label style={fieldLabelStyle}>
            <span style={labelTextStyle}>识别语言</span>
            <select
              value={s.sttLanguage || "zh"}
              onChange={(e) => onSettingsChange({ ...settings, sttLanguage: e.target.value })}
              style={{ ...textInputStyle, width: 100 }}
            >
              <option value="zh">中文</option>
              <option value="">自动检测</option>
            </select>
          </label>
          <label style={fieldLabelStyle}>
            <span style={labelTextStyle}>指示器位置</span>
            <select
              value={s.sttIndicatorPosition || "top"}
              onChange={(e) => onSettingsChange({ ...settings, sttIndicatorPosition: e.target.value })}
              style={{ ...textInputStyle, width: 100 }}
            >
              <option value="top">顶部</option>
              <option value="center">居中</option>
              <option value="bottom">底部</option>
            </select>
          </label>
        </Section>
        )}

        {/* 联网搜索 */}
        {isFeatureVisible("webSearch") && (
        <Section title="联网搜索 (Web Search)">
          <Toggle label="自动联网搜索" value={s.webSearchEnabled ?? true} onChange={(v) => onSettingsChange({ ...settings, webSearchEnabled: v })} />
          <div style={{ fontSize: 10, color: "#888", marginTop: 4 }}>
            {s.webSearchEnabled ? '每条消息自动搜索 (Tavily 1000次/月免费)' : '仅匹配关键词时搜索'}
          </div>
        </Section>
        )}

        {/* 情绪贴图 (Pro only) */}
        {userTier !== "free" && (
        <Section title="情绪贴图 (Stickers)">
          <Toggle label="AI 回复旁显示 chibi 贴图" value={s.stickerEnabled ?? true} onChange={(v) => onSettingsChange({ ...settings, stickerEnabled: v })} />
          <div style={{ fontSize: 10, color: "#888", marginTop: 4 }}>
            根据 AI 回复情绪自动展示 mao 表情贴图，首次生成需几秒。
          </div>
        </Section>
        )}

        {/* SOUL 预设 (Pro only) */}
        {userTier !== "free" && isFeatureVisible("soulPreset") && (
        <Section title="角色性格 (SOUL Preset)">
          <select
            value={s.soulPreset ?? "mao-teasing"}
            onChange={(e) => onSettingsChange({ ...settings, soulPreset: e.target.value })}
            style={selectStyle}
          >
            <option value="mao-girlfriend">女友 — 温柔亲昵，护着你，会撒娇</option>
            <option value="mao-teasing">毒舌傲娇 — 调侃不是嘲讽，是亲密</option>
            <option value="mao-warm">安静陪伴 — 话不多，但说在对的时候</option>
            <option value="mao-cool">冷淡观察 — 看穿不说穿，偶尔扎心</option>
            <option value="mao-energetic">元气话痨 — 什么都好奇，碎碎念</option>
            <option value="mao-rebel">反叛挑战 — 不是为了抬杠，是让你想清楚</option>
          </select>
          <div style={{ fontSize: 10, color: "#888", marginTop: 4 }}>
            切换后下次对话生效，不重启。清除记忆时会重置为默认。
          </div>
        </Section>
        )}

        {/* 10. Layout */}
        {isFeatureVisible("layout") && (
        <Section title="布局 (Layout)">
          <label style={fieldLabelStyle}>
            <span style={labelTextStyle}>聊天宽度</span>
            <input
              type="range"
              min={40} max={100} step={5}
              value={s.layout.chatPanelWidth}
              onChange={(e) => change("layout", "chatPanelWidth", parseInt(e.target.value))}
              style={{ flex: 1, maxWidth: 100, accentColor: "#4a6cf7" }}
            />
            <span style={{ fontSize: 10, color: "#aaa", marginLeft: 4 }}>{s.layout.chatPanelWidth}%</span>
          </label>
          <label style={fieldLabelStyle}>
            <span style={labelTextStyle}>状态位置</span>
            <select
              value={s.layout.statusPosition}
              onChange={(e) => change("layout", "statusPosition", e.target.value)}
              style={selectStyle}
            >
              <option value="left">← 左</option>
              <option value="center">↔ 中</option>
              <option value="right">→ 右</option>
            </select>
          </label>
          <Toggle label="角色居中对称" value={s.layout.centerModel} onChange={(v) => change("layout", "centerModel", v)} />
        </Section>
        )}

        {/* 9. WebSocket (Pro only) */}
        {userTier !== "free" && isFeatureVisible("websocket") && (
        <Section title="WebSocket">
          <label style={fieldLabelStyle}>
            <span style={labelTextStyle}>URL</span>
            <input
              type="text"
              value={s.websocket.url}
              onChange={(e) => change("websocket", "url", e.target.value)}
              style={textInputStyle}
            />
          </label>
          <NumInput label="重连延迟 (ms)" value={s.websocket.reconnectDelayMs} onChange={(v) => change("websocket", "reconnectDelayMs", v)} min={500} max={30000} step={500} />
        </Section>
        )}
        {/* 账号 (USER 可见) */}
        <AccountSection />
      </div>

      {/* Footer buttons */}
      <div style={footerStyle}>
        <button
          onClick={onReset || handleReset}
          style={actionBtnStyle}
        >重置默认值</button>
        {standalone ? (
          <button
            onClick={onSave}
            style={{
              ...actionBtnStyle,
              background: dirty ? "#22c55e" : "#4a6cf7",
              color: "#fff",
              fontWeight: dirty ? 600 : 400,
            }}
          >{dirty ? "● 保存并应用" : "保存"}</button>
        ) : (
          <button
            onClick={handleSave}
            style={{ ...actionBtnStyle, background: "#4a6cf7", color: "#fff" }}
          >立即保存</button>
        )}
      </div>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────

const standalonePanelStyle: React.CSSProperties = {
  width: "100%", height: "100%",
  background: "#1a1a2e",
  display: "flex", flexDirection: "column",
};

const panelStyle: React.CSSProperties = {
  position: "absolute",
  top: "4%", left: "4%", right: "4%", bottom: "4%",
  background: "rgba(0, 0, 0, 0.95)",
  backdropFilter: "blur(8px)",
  borderRadius: 12,
  zIndex: 999,
  display: "flex",
  flexDirection: "column",
  boxShadow: "0 0 40px rgba(0,0,0,0.5)",
};

const headerStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "8px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.1)",
  flexShrink: 0,
};

const closeBtnStyle: React.CSSProperties = {
  width: 32, height: 32, borderRadius: "50%",
  border: "none", background: "rgba(255,255,255,0.1)",
  color: "#fff", fontSize: 16, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
};

const scrollStyle: React.CSSProperties = {
  flex: 1, overflowY: "auto", padding: "6px 10px",
};

const footerStyle: React.CSSProperties = {
  display: "flex", gap: 8, padding: "6px 10px",
  borderTop: "1px solid rgba(255,255,255,0.08)",
  flexShrink: 0,
};

const summaryStyle: React.CSSProperties = {
  color: "#aaa", fontSize: 11, cursor: "pointer",
  padding: "3px 0", userSelect: "none",
};

const sectionBodyStyle: React.CSSProperties = {
  padding: "2px 0 6px 8px",
  display: "flex", flexWrap: "wrap", gap: 3,
};

const fieldLabelStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 4,
  marginBottom: 2,
};

const labelTextStyle: React.CSSProperties = {
  fontSize: 10, color: "#888", width: 44, textAlign: "right", flexShrink: 0,
};

const numInputStyle: React.CSSProperties = {
  flex: "1 1 52px", maxWidth: 80, minWidth: 40,
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)", borderRadius: 4,
  padding: "2px 4px", color: "#ddd", fontSize: 10, outline: "none",
};

const textInputStyle: React.CSSProperties = {
  flex: "1 1 80px", maxWidth: "100%",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)", borderRadius: 4,
  padding: "2px 4px", color: "#ddd", fontSize: 10, outline: "none",
};

const selectStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)", borderRadius: 4,
  padding: "2px 4px", color: "#ddd", fontSize: 10, outline: "none",
};

const rowStyle: React.CSSProperties = {
  display: "flex", gap: 3, flexWrap: "wrap",
};

const tinyBtnStyle: React.CSSProperties = {
  width: 22, height: 22, borderRadius: 4,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.06)", color: "#aaa",
  fontSize: 10, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
};

const actionBtnStyle: React.CSSProperties = {
  padding: "4px 12px", borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.08)", color: "#ccc",
  fontSize: 11, cursor: "pointer",
};

// ── Account Section ──
function AccountSection() {
  const [tier, setTier] = useState("");
  const [displayId, setDisplayId] = useState("");
  const [deviceLimit, setDeviceLimit] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);

  const load = useCallback(async () => {
    try {
      const token: any = await invoke("load_auth_token");
      if (!token?.access_token) {
        if (localStorage.getItem("waifu-free-mode") === "1") {
          setTier("free"); setLoggedIn(true);
        } else {
          setLoggedIn(false);
        }
        setLoading(false); return;
      }
      // 有真实 token 时清除 free mode 标记
      localStorage.removeItem("waifu-free-mode");
      setTier(token.tier || 'unknown');
      // display_id 优先从 token 字段取，没有则从 JWT 解码
      let did = token.display_id || '';
      if (!did && token.access_token) {
        try {
          const payload = JSON.parse(atob(token.access_token.split('.')[1]));
          did = payload.display_id || '';
        } catch { /* JWT 解码失败，忽略 */ }
      }
      setDisplayId(did);
      setDeviceLimit(token.device_limit || 1);
      setLoggedIn(true);
    } catch { /* not logged in */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // 监听 MainWindow 的认证状态变化，同步更新
  useEffect(() => {
    const unlisten = listen("auth-updated", () => { load(); });
    return () => { unlisten.then(fn => fn()); };
  }, [load]);

  const handleLogout = async () => {
    localStorage.removeItem("waifu-free-mode");
    await invoke("clear_auth_token").catch((e) => console.error("clear token failed:", e));
    // 通知主窗口回到登录页（SettingsPanel 可能在独立窗口里，reload 只刷新自己）
    await emit("auth-logout").catch((e) => console.error("emit auth-logout failed:", e));
    window.location.reload();
  };

  return (
    <Section title="账号 (Account)">
      {loading ? (
        <div style={{ color: "#888", fontSize: 11 }}>加载中...</div>
      ) : !loggedIn ? (
        <div style={{ color: "#888", fontSize: 11 }}>未激活</div>
      ) : (
        <div>
          <div style={{ color: "#ccc", fontSize: 12, marginBottom: 4 }}>
            {tier === "pro" ? "Pro 用户" : tier === "dev" ? "Dev 用户" : tier === "free" ? "免费版" : "Trial 用户"}
          </div>
          {displayId ? (
            <>
              <div style={{ color: "#ccc", fontSize: 14, fontWeight: 600, marginBottom: 2, fontFamily: "monospace" }}>
                ID: {displayId}
              </div>
              <div style={{ marginBottom: 6 }}>
                <button onClick={() => { navigator.clipboard.writeText(displayId); }}
                  style={{ fontSize: 10, padding: "2px 8px", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 4, background: "rgba(255,255,255,0.06)", color: "#aaa", cursor: "pointer" }}>
                  复制 ID
                </button>
              </div>
              <div style={{ color: "#777", fontSize: 9, marginBottom: 10 }}>
                如遇问题，将此 ID 提供给管理员
              </div>
            </>
          ) : (
            <div style={{ color: "#666", fontSize: 11, marginBottom: 10 }}>
              升级 Pro 获取专属 ID
            </div>
          )}
          <div style={{ color: "#888", fontSize: 10, marginBottom: 8 }}>
            设备: {deviceLimit} 台
          </div>
          {tier === "free" && (
            <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 6, background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.25)" }}>
              <div style={{ color: "#a78bfa", fontSize: 11, marginBottom: 6 }}>
                🔒 以下功能需要 Pro 版
              </div>
              <div style={{ color: "#888", fontSize: 10, lineHeight: 1.6 }}>
                全部角色皮肤 · 多音色 TTS · Agent 工具箱 · 点击穿透 · 记忆增强
              </div>
              <a
                href="https://ifdian.net/a/eidolonByKevin?tab=shop"
                target="_blank" rel="noopener noreferrer"
                style={{ display: "inline-block", marginTop: 8, padding: "4px 12px", borderRadius: 4, background: "rgba(139,92,246,0.5)", color: "#fff", fontSize: 11, fontWeight: 600, textDecoration: "none" }}
              >
                升级 Pro → 爱发电赞助
              </a>
            </div>
          )}
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button onClick={handleLogout} style={actionBtnStyle}>{tier === "free" ? "退出免费模式" : "退出登录"}</button>
            <button onClick={() => { emit("portrait-redo").catch((e) => console.warn("emit portrait-redo failed:", e)); }} style={{ ...actionBtnStyle, color: "#06b6d4", borderColor: "rgba(6,182,212,0.3)" }}>
              🔄 重新认识我
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

// ── 清空记忆按钮 ──

function ClearMemoryButton() {
  const [state, setState] = useState<"idle" | "confirm" | "done">("idle");

  const handleClear = useCallback(async () => {
    try {
      setState("done");
      const msg: string = await invoke("clear_memory");
      console.log("[Settings] clear_memory:", msg);
      // 通知主窗口清空内存中的 ref（history、userMd、memoryMd）
      emit("memory-cleared").catch(() => {});
      setTimeout(() => setState("idle"), 2000);
    } catch (e) {
      console.error("[Settings] clear_memory failed:", e);
      setState("idle");
    }
  }, []);

  return (
    <div style={{ marginTop: 8 }}>
      {state === "idle" && (
        <button
          onClick={() => setState("confirm")}
          style={{
            fontSize: 11, padding: "4px 12px",
            border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4,
            background: "rgba(239,68,68,0.1)", color: "#f87171", cursor: "pointer",
          }}
        >
          🗑️ 清空角色记忆
        </button>
      )}
      {state === "confirm" && (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "#f87171" }}>确定清空所有对话记忆？</span>
          <button onClick={handleClear} style={{
            fontSize: 10, padding: "3px 10px", borderRadius: 4,
            background: "rgba(239,68,68,0.7)", color: "#fff", border: "none", cursor: "pointer",
          }}>确认</button>
          <button onClick={() => setState("idle")} style={{
            fontSize: 10, padding: "3px 10px", borderRadius: 4,
            background: "rgba(255,255,255,0.06)", color: "#ccc", border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer",
          }}>取消</button>
        </div>
      )}
      {state === "done" && (
        <span style={{ fontSize: 10, color: "#4ade80" }}>✅ 已清空，重启后生效</span>
      )}
    </div>
  );
}
