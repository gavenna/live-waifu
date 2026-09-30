/**
 * OpsPanel — 运维面板
 * 独立窗口组件，提供日志查看、运行时状态、文件浏览、快速诊断、快捷操作
 */

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useOpsData } from "../hooks/useOpsData";
import type { LogLine, FileEntry, RuntimeState } from "../hooks/useOpsData";
import { LOG_SWITCH } from "../config/logConfig";

function S({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details open={defaultOpen} style={{ marginBottom: 2 }}>
      <summary style={{ color: "#aaa", fontSize: 11, cursor: "pointer", padding: "3px 0", userSelect: "none" }}>{title}</summary>
      <div style={{ padding: "2px 0 4px 8px" }}>{children}</div>
    </details>
  );
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

const KNOWN_TAGS = Object.keys(LOG_SWITCH) as string[];
const MONO = "'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace";

const wrapperStyle: React.CSSProperties = {
  width: "100vw", height: "100vh", background: "#0d0d1a", color: "#ccc",
  fontFamily: "'WenQuanYi Micro Hei', 'Noto Sans CJK SC', sans-serif",
  fontSize: 11, display: "flex", flexDirection: "column", overflow: "hidden",
};
const hdrStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "6px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0,
};
const scrollStyle: React.CSSProperties = { flex: 1, overflowY: "auto", padding: "6px 10px" };
const logBox: React.CSSProperties = {
  maxHeight: "50vh", overflowY: "auto", background: "rgba(0,0,0,0.3)",
  borderRadius: 6, padding: "6px 8px", fontFamily: MONO, fontSize: 10,
  lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-all",
};
const inpStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 4, padding: "2px 6px", color: "#ddd", fontSize: 10, outline: "none",
  flex: 1, minWidth: 100,
};
const selStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 4, padding: "2px 4px", color: "#ddd", fontSize: 10, outline: "none",
};
const abtn: React.CSSProperties = {
  padding: "4px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.08)", color: "#ccc", fontSize: 11, cursor: "pointer",
};
const dbtn: React.CSSProperties = {
  ...abtn, border: "1px solid rgba(239,68,68,0.3)",
  background: "rgba(239,68,68,0.1)", color: "#f87171",
};
const sc: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "8px 10px",
  border: "1px solid rgba(255,255,255,0.06)", display: "flex",
  flexDirection: "column", alignItems: "center", gap: 2,
};
const fr: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, padding: "3px 6px",
  borderRadius: 3, cursor: "pointer", fontFamily: MONO, fontSize: 10,
};

export function OpsPanel() {
  const { logLines, files, stats, loading, error, refreshAll, clearLogs } = useOpsData(2000);
  const [rtState, setRtState] = useState<RuntimeState>({
    status: "idle", emotion: "", motion: "", thinkingDetail: "", currentTool: "", lastResponse: "",
  });
  const [logFilter, setLogFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [stickerPrompts, setStickerPrompts] = useState<{ time: string; emotion: string; key: string; prompt: string; cache: string }[]>([]);

  useEffect(() => {
    const unlisten = listen("ops-status-update", (ev: any) => {
      setRtState(ev.payload as RuntimeState);
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  useEffect(() => {
    invoke<string>("read_file_content", { relativePath: "stickers/prompts.jsonl" })
      .then((raw) => {
        const records = raw.split("\n").filter(Boolean).map((line) => {
          try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean);
        setStickerPrompts(records);
      })
      .catch(() => {}); // file doesn't exist yet
  }, [stats]);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logLines, autoScroll]);

  const filtered = useMemo(() => {
    let lines = logLines;
    if (tagFilter) lines = lines.filter((l) => l.tag === tagFilter);
    if (logFilter) {
      const lower = logFilter.toLowerCase();
      lines = lines.filter((l) => l.raw.toLowerCase().includes(lower));
    }
    return lines;
  }, [logLines, tagFilter, logFilter]);

  const lineColor = useCallback((l: LogLine) => {
    if (l.raw.includes("[ERROR]") || l.raw.toLowerCase().includes("error")) return "#f88";
    if (l.source === "frontend") return "#88b";
    if (l.source === "rust") return "#8b8";
    return "#999";
  }, []);

  const openPreview = useCallback(async (path: string) => {
    setPreviewPath(path);
    setPreviewLoading(true);
    try {
      const content: string = await invoke("read_file_content", { relativePath: path });
      setPreviewContent(content);
    } catch (e) {
      setPreviewContent("读取失败: " + String(e));
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const handleClearLog = useCallback(() => {
    if (!window.confirm("确认清除日志文件？")) return;
    clearLogs();
    setFeedback("日志已清除");
    setTimeout(() => setFeedback(""), 3000);
  }, [clearLogs]);

  const handleClearMemory = useCallback(async () => {
    if (!window.confirm("确认清除所有记忆？此操作不可撤销。")) return;
    try {
      const msg: string = await invoke("clear_memory");
      setFeedback(msg);
    } catch (e) {
      setFeedback("清除失败: " + String(e));
    }
    setTimeout(() => setFeedback(""), 3000);
  }, []);

  const handleOpenExplorer = useCallback(async () => {
    try {
      const p: string = await invoke("ops_open_explorer");
      setFeedback("已打开: " + p);
    } catch (e) {
      setFeedback("打开失败: " + String(e));
    }
    setTimeout(() => setFeedback(""), 4000);
  }, []);

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const fileTree = useMemo(() => {
    const roots: FileEntry[] = [];
    const children = new Map<string, FileEntry[]>();
    for (const f of files) {
      const parent = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
      if (!parent) { roots.push(f); }
      else { const list = children.get(parent) || []; list.push(f); children.set(parent, list); }
    }
    return { roots, children };
  }, [files]);

  const statusColor = useMemo(() => {
    switch (rtState.status) {
      case "thinking": return { bg: "rgba(6,182,212,0.2)", text: "#06b6d4" };
      case "speaking": return { bg: "rgba(74,108,247,0.2)", text: "#4a6cf7" };
      case "error": return { bg: "rgba(239,68,68,0.2)", text: "#ef4444" };
      case "disconnected": return { bg: "rgba(245,158,11,0.2)", text: "#f59e0b" };
      default: return { bg: "rgba(34,197,94,0.2)", text: "#22c55e" };
    }
  }, [rtState.status]);

  return (
    <div style={wrapperStyle}>
      <div style={hdrStyle}>
        <span style={{ color: "#ccc", fontSize: 13, fontWeight: 600 }}>运维面板</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {feedback && <span style={{ fontSize: 10, color: "#22d3ee" }}>{feedback}</span>}
          {loading && <span style={{ fontSize: 10, color: "#888" }}>加载中...</span>}
        </div>
      </div>
      <div style={scrollStyle}>
        <S title="日志查看" defaultOpen>
          <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
            <input type="text" placeholder="搜索日志..." value={logFilter} onChange={(e) => setLogFilter(e.target.value)} style={inpStyle} />
            <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} style={selStyle}>
              <option value="">全部标签</option>
              {KNOWN_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <label style={{ fontSize: 10, color: "#ccc", cursor: "pointer", display: "flex", alignItems: "center", gap: 3, whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} style={{ margin: 0 }} />自动
            </label>
            <span style={{ fontSize: 9, color: "#666", whiteSpace: "nowrap" }}>共 {logLines.length} | {filtered.length}</span>
          </div>
          <div style={logBox} ref={logContainerRef}>
            {filtered.length === 0 && <div style={{ color: "#666", textAlign: "center", padding: 20 }}>等待日志...</div>}
            {filtered.map((l, i) => (
              <div key={l.timestamp + "-" + i} style={{ color: lineColor(l) }}>{l.raw}</div>
            ))}
          </div>
        </S>

        <S title="运行时状态" defaultOpen>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "#888" }}>Agent:</span>
              <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 3, fontSize: 10, fontWeight: 600, background: statusColor.bg, color: statusColor.text }}>{rtState.status}</span>
            </div>
            {rtState.emotion && <div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ color: "#888" }}>表情:</span><span style={{ color: "#a78bfa" }}>{rtState.emotion}</span></div>}
            {rtState.motion && <div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ color: "#888" }}>动作:</span><span style={{ color: "#22d3ee" }}>{rtState.motion}</span></div>}
            {rtState.currentTool && <div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ color: "#888" }}>工具:</span><span style={{ color: "#f59e0b" }}>{rtState.currentTool}</span></div>}
            {rtState.thinkingDetail && <div style={{ width: "100%", marginTop: 2 }}><span style={{ color: "#888" }}>思考:</span><span style={{ color: "#999", marginLeft: 4, fontSize: 10 }}>{rtState.thinkingDetail}</span></div>}
            {rtState.lastResponse && <div style={{ width: "100%" }}><span style={{ color: "#888" }}>最近回复:</span><span style={{ color: "#aaa", marginLeft: 4, fontSize: 10 }}>{rtState.lastResponse.slice(0, 120)}</span></div>}
            {!rtState.emotion && !rtState.motion && !rtState.currentTool && rtState.status === "idle" && <span style={{ color: "#666" }}>等待 agent 活动...</span>}
          </div>
        </S>

        <S title="文件浏览">
          {files.length === 0 ? <span style={{ color: "#666" }}>无法读取文件列表</span> :
            renderFileTree(fileTree.roots, fileTree.children, expandedDirs, toggleDir, openPreview)}
          {previewPath && (
            <div style={{ marginTop: 8, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px", background: "rgba(255,255,255,0.04)" }}>
                <span style={{ fontSize: 10, color: "#22d3ee", fontFamily: MONO }}>{previewPath}</span>
                <button onClick={() => { setPreviewPath(null); setPreviewContent(""); }} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 14 }}>X</button>
              </div>
              <pre style={{ maxHeight: 300, overflow: "auto", margin: 0, padding: "6px 10px", fontSize: 10, fontFamily: MONO, color: "#ccc", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{previewLoading ? "加载中..." : previewContent}</pre>
            </div>
          )}
        </S>

        <S title="快速诊断" defaultOpen>
          {!stats ? <span style={{ color: "#666" }}>加载中...</span> :
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              <div style={sc}><span style={{ fontSize: 10, color: "#888" }}>记忆条目</span><span style={{ fontSize: 18, color: "#e0e0e0", fontWeight: 600, fontFamily: MONO }}>{stats.memory_facts_count}</span></div>
              <div style={sc}><span style={{ fontSize: 10, color: "#888" }}>今日对话</span><span style={{ fontSize: 18, color: "#e0e0e0", fontWeight: 600, fontFamily: MONO }}>{stats.today_conversations}</span></div>
              <div style={sc}><span style={{ fontSize: 10, color: "#888" }}>全部对话</span><span style={{ fontSize: 18, color: "#e0e0e0", fontWeight: 600, fontFamily: MONO }}>{stats.total_conversations}</span></div>
              <div style={sc}><span style={{ fontSize: 10, color: "#888" }}>Prompt 大小</span><span style={{ fontSize: 14, color: "#e0e0e0", fontWeight: 600, fontFamily: MONO }}>{fmtSize(stats.last_prompt_size)}</span></div>
              <div style={sc}><span style={{ fontSize: 10, color: "#888" }}>日志大小</span><span style={{ fontSize: 14, color: "#e0e0e0", fontWeight: 600, fontFamily: MONO }}>{fmtSize(stats.log_size)}</span></div>
              <div style={sc}><span style={{ fontSize: 10, color: "#888" }}>数据目录</span><span style={{ fontSize: 14, color: "#e0e0e0", fontWeight: 600, fontFamily: MONO }}>{fmtSize(stats.total_app_data_size)}</span></div>
            </div>
          }
        </S>

        <S title={`贴图 Prompt 历史 (${stickerPrompts.length})`} defaultOpen>
          {stickerPrompts.length === 0 ? <span style={{ color: "#666" }}>暂无记录</span> :
            <div style={{ maxHeight: 300, overflowY: "auto" }}>
              {[...stickerPrompts].reverse().map((r, i) => (
                <div key={i} style={{ marginBottom: 6, padding: "6px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 4, border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ display: "flex", gap: 8, marginBottom: 2 }}>
                    <span style={{ color: "#888", fontSize: 9, fontFamily: MONO }}>{r.time}</span>
                    <span style={{
                      color: r.emotion === "neutral" ? "#888" : r.emotion === "happy" ? "#4f4" : r.emotion === "angry" ? "#f44" : r.emotion === "sad" ? "#48f" : r.emotion === "surprised" ? "#ff4" : r.emotion === "shy" ? "#f8f" : r.emotion === "loving" ? "#f84" : "#aaa",
                      fontSize: 9, fontWeight: 600,
                    }}>{r.emotion}</span>
                    <span style={{ color: "#666", fontSize: 9, fontFamily: MONO }}>{r.key}</span>
                  </div>
                  <div style={{ color: "#bbb", fontSize: 10, fontFamily: MONO, lineHeight: 1.4, wordBreak: "break-all" }}>{r.prompt}</div>
                  <div style={{ color: "#555", fontSize: 9, fontFamily: MONO, marginTop: 2 }}>{r.cache.split("\\").pop()}</div>
                </div>
              ))}
            </div>
          }
        </S>

        <S title="快捷操作">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={handleClearLog} style={dbtn}>清除日志</button>
            <button onClick={handleClearMemory} style={dbtn}>清除记忆</button>
            <button onClick={handleOpenExplorer} style={abtn}>打开数据目录</button>
            <button onClick={refreshAll} style={abtn}>刷新全部</button>
          </div>
        </S>

        {error && <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 6, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171", fontSize: 10 }}>{error}</div>}
      </div>
    </div>
  );
}

function renderFileTree(
  roots: FileEntry[],
  children: Map<string, FileEntry[]>,
  expandedDirs: Set<string>,
  toggleDir: (path: string) => void,
  onPreview: (path: string) => void,
): JSX.Element {
  return (
    <>
      {roots.map((f) => {
        const subs = children.get(f.path) || [];
        const isExpanded = expandedDirs.has(f.path);
        return (
          <div key={f.path}>
            <div style={{ ...fr, background: isExpanded ? "rgba(255,255,255,0.03)" : "transparent" }}
              onClick={() => { if (f.is_dir) toggleDir(f.path); else onPreview(f.path); }}>
              <span style={{ width: 14, textAlign: "center", flexShrink: 0, color: "#666" }}>{f.is_dir ? (isExpanded ? "v" : ">") : " "}</span>
              <span style={{ color: f.is_dir ? "#22d3ee" : "#ccc", flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{f.is_dir ? f.path + "/" : f.path}</span>
              <span style={{ color: "#666", flexShrink: 0 }}>{fmtSize(f.size)}</span>
              <span style={{ color: "#555", fontSize: 9, flexShrink: 0, width: 120, textAlign: "right" }}>{f.modified}</span>
            </div>
            {f.is_dir && isExpanded && subs.length > 0 && (
              <div style={{ paddingLeft: 14 }}>{renderFileTree(subs, children, expandedDirs, toggleDir, onPreview)}</div>
            )}
          </div>
        );
      })}
    </>
  );
}
