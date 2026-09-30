/**
 * ChatUI — 底部紧凑聊天面板
 *
 * 消息通过 Rust command 发送。
 * 快速模式: quick_chat → LLM API (1-3秒)
 * 深度模式: send_message → Hermes (5-15秒)
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

type ChatMode = "fast"; // deep mode deprecated, replaced by relay agentMode

interface Message {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  mode?: ChatMode;
}

export interface ChatUIConfig {
  userBubbleColor: string;
  aiBubbleBg: string;
  bubbleRadius: number;
  fontSize: number;
}

interface Props {
  visible: boolean;
  onToggle: () => void;
  onSpeaking: (text: string) => void;
  chatConfig: ChatUIConfig;
  windowHeight: number;
  panelWidth?: number; // % of window width, default 100
  agentMode?: "builtin" | "relay";
  /** 当前情绪贴图路径 (app_data_dir/stickers/{emotion}.png) */
  stickerPath?: string;
  /** 当前情绪名称 */
  emotion?: string;
  /** 是否启用贴图 */
  stickerEnabled?: boolean;
}

export function ChatUI({ visible, onToggle, onSpeaking, chatConfig: C, windowHeight, panelWidth, agentMode, stickerPath, emotion, stickerEnabled }: Props) {
  // Adaptive: message area scales with window height
  const msgMaxH = Math.max(48, Math.round(windowHeight * 0.18));
  const inputFontSize = Math.max(11, Math.round(C.fontSize * (windowHeight / 800)));
  const pw = panelWidth ?? 100;
  const chatPanelStyle: React.CSSProperties = {
    ...barStyle,
    width: pw < 100 ? `${pw}%` : undefined,
    left: pw < 100 ? `${(100 - pw) / 2}%` : 0,
    right: pw < 100 ? `${(100 - pw) / 2}%` : 0,
  };
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [mode] = useState<ChatMode>("fast");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const text = inputText.trim();
    if (!text || sending) return;

    setInputText("");
    setSending(true);

    const userMsg: Message = { role: "user", text, timestamp: Date.now(), mode };
    setMessages((prev) => [...prev, userMsg]);

    // Relay mode: emit event to main window for WS relay
    if (agentMode === "relay") {
      await emit("chat-send", { text, mode: "relay" }).catch(() => {});
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: "(已发送到 Agent)",
        timestamp: Date.now(),
      }]);
      setSending(false);
      return;
    }

    // Builtin mode: direct LLM call
    try {
      const raw = await invoke<string>("quick_chat", { message: text });
      const displayText = raw || "(empty)";
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: displayText,
        timestamp: Date.now(),
        mode,
      }]);
      onSpeaking(displayText);
      invoke("save_turn", { role: "user", text: userMsg.text, mode }).catch(() => {});
      invoke("save_turn", { role: "assistant", text: displayText, mode }).catch(() => {});
    } catch (e) {
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: `⚠️ ${e}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setSending(false);
    }
  }, [inputText, sending, onSpeaking, agentMode]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage]
  );

  if (!visible) return null;

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      style={chatPanelStyle}>
      {/* Header row */}
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            onClick={() => {/* mode now controlled by settings.agentMode */}}
            disabled={agentMode === "relay"}
            style={{
              ...modeToggleStyle,
              background: agentMode === "relay" ? "rgba(16,185,129,0.15)" : "rgba(34,211,238,0.15)",
              color: agentMode === "relay" ? "#10b981" : "#22d3ee",
              borderColor: agentMode === "relay" ? "rgba(16,185,129,0.3)" : "rgba(34,211,238,0.3)",
            }}
            title={agentMode === "relay" ? "中继模式 (外部 Agent)" : "内置模式 (LLM API)"}
          >
            {agentMode === "relay" ? "🔌 中继" : "⚡ 快"}
          </button>
          <span style={{ color: "#888", fontSize: C.fontSize - 1 }}>对话</span>
        </div>
        <button onClick={onToggle} style={closeBtnStyle}>✕</button>
      </div>

      {/* Messages */}
      {messages.length > 0 && (
        <div ref={listRef} style={msgRowStyle(msgMaxH)}>
          {messages.slice(-10).map((msg, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                padding: "1px 6px",
                alignItems: "flex-end",
                gap: 4,
              }}
            >
              {msg.role === "assistant" && msg.mode && (
                <span style={{
                  fontSize: C.fontSize - 3,
                  color: "#22d3ee",
                  opacity: 0.7,
                  minWidth: 22,
                  textAlign: "center",
                }}>
⚡
                </span>
              )}
              <span style={{
                background: msg.role === "user" ? C.userBubbleColor : C.aiBubbleBg,
                padding: "2px 8px",
                borderRadius: C.bubbleRadius,
                fontSize: C.fontSize,
                lineHeight: 1.3,
                maxWidth: msg.role === "user" ? "75%" : "80%",
              }}>
                {msg.text.length > 200 ? msg.text.slice(0, 200) + "…" : msg.text}
              </span>
            </div>
          ))}
          {stickerEnabled && stickerPath && (
            <div style={{ display: "flex", justifyContent: "flex-start", padding: "1px 6px" }}>
              <img src={convertFileSrc(stickerPath.replace(/\\/g, "/"))} width={128} height={128} style={{ width: "128px", height: "128px", borderRadius: 10, flexShrink: 0, display: "block", maxWidth: "none", maxHeight: "none" }} alt={emotion || ""} />
            </div>
          )}
          {sending && <div style={{ color: "#888", fontSize: C.fontSize, padding: "1px 10px" }}>...</div>}
        </div>
      )}

      {/* Input row */}
      <div style={inputRowStyle}>
        <input
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={agentMode === "relay" ? "Agent 中继…" : "快速聊…"}
          disabled={sending}
          style={{ ...inputStyle, fontSize: inputFontSize }}
        />
        <button
          onClick={sendMessage}
          disabled={sending || !inputText.trim()}
          style={{ ...btnStyle, background: agentMode === "relay" ? "#10b981" : "#22d3ee" }}
        >
          {sending ? "…" : "➤"}
        </button>
      </div>

    </div>
  );
}

// --- Styles ---

const barStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 0, left: 0, right: 0,
  background: "rgba(10, 10, 20, 0.88)",
  backdropFilter: "blur(6px)",
  borderTopLeftRadius: 10, borderTopRightRadius: 10,
  zIndex: 10, paddingBottom: 4,
};

const headerStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "2px 8px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
};

const closeBtnStyle: React.CSSProperties = {
  width: 18, height: 18, borderRadius: "50%",
  border: "none", background: "rgba(255,255,255,0.06)",
  color: "#666", fontSize: 9, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
};

const msgRowStyle = (maxH: number): React.CSSProperties => ({
  display: "flex", flexDirection: "column", gap: 1,
  padding: "2px 0", maxHeight: maxH, overflowY: "auto",
});

const inputRowStyle: React.CSSProperties = {
  display: "flex", padding: "3px 6px", gap: 4, alignItems: "center",
};

const inputStyle: React.CSSProperties = {
  flex: 1, background: "rgba(255,255,255,0.1)",
  border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6,
  padding: "5px 8px", color: "#fff", outline: "none",
};

const btnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6, border: "none",
  color: "#fff", fontSize: 12, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  flexShrink: 0,
};

const modeToggleStyle: React.CSSProperties = {
  height: 20, padding: "0 6px", borderRadius: 4,
  border: "1px solid",
  fontSize: 9, cursor: "pointer",
  display: "flex", alignItems: "center",
};

