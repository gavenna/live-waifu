/**
 * StatusIndicator — Agent 状态可视化
 *
 * 在角色窗口上方显示当前 agent 状态。
 * 文字和颜色由 persona.config.ts 中的 labels 定义，通过 props 传入。
 */

import type { AgentStatus, AgentTool } from "../hooks/useWsStatus";

export interface StatusLabels {
  [key: string]: { text: string; color: string };
}

interface Props {
  status: AgentStatus;
  toolNames: string[];
  connected: boolean;
  lastResponse: string;
  thinkingDetail: string;
  currentTool: AgentTool | null;
  statusLabels: StatusLabels;
  indicatorPadding: string;
  indicatorFontSize: number;
}

export function StatusIndicator({ status, toolNames, connected, lastResponse, thinkingDetail, currentTool, statusLabels, indicatorPadding, indicatorFontSize }: Props) {
  const info = statusLabels[status];
  const show = status !== "idle";

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        padding: indicatorPadding,
        fontSize: indicatorFontSize,
        fontFamily: "'WenQuanYi Micro Hei', sans-serif",
        color: "#ccc",
        zIndex: 10,
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      {show && (
        <div
          style={{
            display: "inline-block",
            padding: "2px 8px",
            borderRadius: 4,
            background: info.color + "33",
            color: info.color,
            fontSize: indicatorFontSize,
          }}
        >
          {info.text}
          {!connected && (
            <span style={{ color: "#f59e0b", marginLeft: 6 }}>disconnected</span>
          )}
        </div>
      )}

      {thinkingDetail && (
        <div style={{ marginTop: 2, opacity: 0.5, fontSize: indicatorFontSize - 1 }}>
          💭 {thinkingDetail}
        </div>
      )}

      {currentTool && (
        <div style={{ marginTop: 2, opacity: 0.6 }}>
          🔧 {currentTool.tool}{currentTool.arg ? `: ${currentTool.arg}` : ""}
        </div>
      )}

      {!currentTool && toolNames.length > 0 && (
        <div style={{ marginTop: 2, opacity: 0.6 }}>
          {toolNames.map((t, i) => (
            <span key={i} style={{ marginRight: 4 }}>
              🔧 {t}
            </span>
          ))}
        </div>
      )}

      {status === "speaking" && lastResponse && (
        <div
          style={{
            marginTop: 4,
            opacity: 0.5,
            fontSize: indicatorFontSize - 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {lastResponse.slice(0, 80)}
        </div>
      )}
    </div>
  );
}
