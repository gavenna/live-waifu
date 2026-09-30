import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface LogLine {
  raw: string;
  timestamp: string;
  tag?: string;
  source: "rust" | "frontend" | "unknown";
}

export interface FileEntry {
  path: string;
  size: number;
  modified: string;
  is_dir: boolean;
}

export interface OpsStats {
  memory_facts_count: number;
  today_conversations: number;
  total_conversations: number;
  last_prompt_size: number;
  log_size: number;
  total_app_data_size: number;
}

export interface RuntimeState {
  status: string;
  emotion: string;
  motion: string;
  thinkingDetail: string;
  currentTool: string;
  lastResponse: string;
}

function parseLogLine(line: string): LogLine {
  const tsMatch = line.match(/^\[(\d+\.\d+)\]\s*/);
  const timestamp = tsMatch ? tsMatch[1] : "";
  let tag: string | undefined;
  let source: "rust" | "frontend" | "unknown" = "unknown";

  if (line.includes("[FRONTEND]")) {
    source = "frontend";
    const tagMatch = line.match(/\[(ChatStream|Anim|Vowel|VowelVerify|Startup|Memory|App|Auth|STT|TTS|Lab)\]/);
    if (tagMatch) tag = tagMatch[1];
  } else if (/^\[\d+\.\d+\]/.test(line)) {
    source = "rust";
    const rustTag = line.match(/^\[\d+\.\d+\]\s*\[(\w[\w-]*)\]/);
    if (rustTag) tag = rustTag[1];
  }

  return { raw: line, timestamp, tag, source };
}

const MAX_LOG_LINES = 1000;
const LOG_POLL_TAIL = 500;

export function useOpsData(pollIntervalMs = 2000) {
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [stats, setStats] = useState<OpsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollLogs = useCallback(async () => {
    try {
      const lines: string[] = await invoke("read_log_lines", { tail: LOG_POLL_TAIL });
      const parsed = lines.map(parseLogLine);
      setLogLines((prev) => {
        const merged = [...prev];
        for (const p of parsed) {
          const key = p.timestamp + p.raw.slice(0, 40);
          if (!seenRef.current.has(key)) {
            seenRef.current.add(key);
            merged.push(p);
          }
        }
        if (merged.length > MAX_LOG_LINES) {
          const trimmed = merged.slice(merged.length - MAX_LOG_LINES);
          seenRef.current = new Set(trimmed.map((l) => l.timestamp + l.raw.slice(0, 40)));
          return trimmed;
        }
        return merged;
      });
    } catch (_e) { /* ignore poll errors */ }
  }, []);

  const refreshFiles = useCallback(async () => {
    try {
      const f: FileEntry[] = await invoke("list_app_data");
      setFiles(f);
    } catch (e) { console.error("list_app_data:", e); }
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      const s: OpsStats = await invoke("get_ops_stats");
      setStats(s);
    } catch (e) { console.error("get_ops_stats:", e); }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([pollLogs(), refreshFiles(), refreshStats()]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [pollLogs, refreshFiles, refreshStats]);

  const clearLogs = useCallback(async () => {
    try {
      await invoke("ops_clear_log");
      seenRef.current.clear();
      setLogLines([]);
    } catch (e) { console.error("ops_clear_log:", e); }
  }, []);

  useEffect(() => {
    refreshAll();
    pollRef.current = setInterval(pollLogs, pollIntervalMs);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [pollLogs, refreshAll, pollIntervalMs]);

  return {
    logLines, files, stats, loading, error,
    refreshAll, clearLogs,
  };
}
