/**
 * useWsStatus — WebSocket 客户端
 *
 * 连接 waifu-tts Plugin 的 WebSocket 服务，
 * 接收 agent:start/step/end 事件，暴露为 React 状态。
 */

import { useEffect, useRef, useState, useCallback } from "react";

export type AgentStatus = "idle" | "thinking" | "speaking" | "error" | "disconnected";

export interface AgentTool {
  tool: string;
  arg: string;
}

export interface AgentMotion {
  motion: string;
  index?: number;
  priority?: number;
}

export interface WsStatusState {
  status: AgentStatus;
  toolNames: string[];
  lastResponse: string;
  connected: boolean;
  ttsAudioBase64: string;
  ttsDurationMs: number;
  ttsText: string;
  thinkingDetail: string;
  currentTool: AgentTool | null;
  emotion: string;
  motion: AgentMotion | null;
  timeline: string[];
  /** agent:end 带 synthesize:true 时置入（seq 递增触发一次本地 TTS）——见 Agent Relay 协议.md §3.4 */
  synthRequest: { text: string; seq: number } | null;
}

export interface WebSocketConfig {
  url: string;
  reconnectDelayMs: number;
  fallbackTimeoutMs: number;
  hardTimeoutMs: number;
  defaultTtsDurationMs: number;
}

const MAX_TIMELINE = 10;

export function useWsStatus(wsCfg: WebSocketConfig, enabled: boolean = true) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const wsCfgRef = useRef(wsCfg);
  wsCfgRef.current = wsCfg;

  const [state, setState] = useState<WsStatusState>({
    status: "disconnected",
    toolNames: [],
    lastResponse: "",
    connected: false,
    ttsAudioBase64: "",
    ttsDurationMs: 0,
    ttsText: "",
    thinkingDetail: "",
    currentTool: null,
    emotion: "",
    motion: null,
    timeline: [],
    synthRequest: null,
  });

  const addTimeline = useCallback((msg: string) => {
    setState((prev) => ({
      ...prev,
      timeline: [...prev.timeline.slice(-(MAX_TIMELINE - 1)), msg],
    }));
  }, []);

  const connect = useCallback(() => {
    const cfg = wsCfgRef.current;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(cfg.url);
    wsRef.current = ws;

    ws.onopen = () => {
      setState((prev) => ({ ...prev, connected: true, status: "idle" }));
      addTimeline("connected");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case "connected":
            addTimeline("WS connected");
            break;

          case "agent:start":
            setState((prev) => ({
              ...prev,
              status: "thinking",
              toolNames: [],
              lastResponse: "",
              ttsAudioBase64: "",
              ttsText: "",
              thinkingDetail: "",
              currentTool: null,
            }));
            addTimeline(`thinking: ${(data.message || "").slice(0, 50)}`);
            break;

          case "agent:thinking":
            setState((prev) => ({
              ...prev,
              status: "thinking",
              thinkingDetail: data.detail || "",
            }));
            addTimeline(`thinking: ${(data.detail || "").slice(0, 50)}`);
            break;

          case "agent:tool":
            setState((prev) => ({
              ...prev,
              status: "thinking",
              currentTool: { tool: data.tool || "", arg: data.arg || "" },
            }));
            addTimeline(`tool: ${data.tool || ""}`);
            break;

          case "agent:step":
            setState((prev) => ({
              ...prev,
              toolNames: data.tool_names || [],
              status: "thinking",
            }));
            addTimeline(`step: ${(data.tool_names || []).join(", ")}`);
            break;

          case "agent:emotion":
            setState((prev) => ({
              ...prev,
              emotion: data.emotion || "",
            }));
            addTimeline(`emotion: ${data.emotion || ""}`);
            break;

          case "agent:motion":
            setState((prev) => ({
              ...prev,
              motion: { motion: data.motion || "", index: data.index, priority: data.priority },
            }));
            addTimeline(`motion: ${data.motion || ""}`);
            break;

          case "agent:end":
            setState((prev) => ({
              ...prev,
              status: "speaking",
              toolNames: [],
              lastResponse: (data.response || "").slice(0, 200),
              // synthesize:true ⇒ 外部 Agent 要求 waifu 用**自身 TTS** 把 response 说出来
              // （Agent Relay 协议.md §3.4 扩展）。不带则维持旧行为：等 tts:audio，否则静默显示文字。
              synthRequest: (data.synthesize && data.response)
                ? { text: data.response, seq: (prev.synthRequest?.seq ?? 0) + 1 }
                : prev.synthRequest,
            }));
            addTimeline("end: response received");
            setTimeout(() => {
              setState((prev) =>
                prev.status === "speaking" && !prev.ttsAudioBase64
                  ? { ...prev, status: "idle" }
                  : prev
              );
            }, cfg.fallbackTimeoutMs);
            setTimeout(() => {
              setState((prev) =>
                prev.status === "speaking"
                  ? { ...prev, status: "idle" }
                  : prev
              );
            }, cfg.hardTimeoutMs);
            break;

          case "tts:audio":
            setState((prev) => ({
              ...prev,
              ttsAudioBase64: data.audio,
              ttsDurationMs: data.duration_ms || cfg.defaultTtsDurationMs,
              ttsText: data.text || "",
            }));
            addTimeline(`tts: ${(data.text || "").slice(0, 40)}...`);
            break;

          default:
            addTimeline(`unknown: ${data.type}`);
        }
      } catch (_e) {
        // non-JSON message, ignore
      }
    };

    ws.onerror = () => {
      addTimeline("WS error");
    };

    ws.onclose = () => {
      setState((prev) => ({
        ...prev,
        connected: false,
        status: "disconnected",
      }));
      addTimeline("disconnected, reconnecting...");
      wsRef.current = null;

      reconnectTimer.current = setTimeout(connect, cfg.reconnectDelayMs);
    };
  }, [addTimeline]);

  const resetStatusToIdle = useCallback(() => {
    setState((prev) => ({
      ...prev,
      status: "idle",
      ttsAudioBase64: "",
      ttsDurationMs: 0,
      ttsText: "",
    }));
  }, []);

  const sendJson = useCallback((payload: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const sendToAgent = useCallback((payload: unknown) => {
    sendJson(payload);
  }, [sendJson]);

  const skipAgentResponse = useCallback(() => {
    sendJson({ type: "user:skip", reason: "click" });
    resetStatusToIdle();
  }, [sendJson, resetStatusToIdle]);

  // Connect on mount, reconnect on URL change
  useEffect(() => {
    clearTimeout(reconnectTimer.current);
    wsRef.current?.close();
    wsRef.current = null;
    if (enabled) {
      connect();
    } else {
      setState((prev) => ({ ...prev, connected: false, status: "disconnected" as AgentStatus }));
    }
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect, wsCfg.url, wsCfg.reconnectDelayMs, enabled]);

  return { ...state, resetStatusToIdle, sendToAgent, skipAgentResponse };
}
