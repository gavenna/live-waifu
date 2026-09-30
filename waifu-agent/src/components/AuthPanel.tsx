import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ActivateResult } from "../types/auth";

interface Props {
  visible: boolean;
  onAuthSuccess: (result: ActivateResult) => void;
  onFreeUse: () => void;
}

export function AuthPanel({ visible, onAuthSuccess, onFreeUse }: Props) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ tier: string; displayId: string; result: ActivateResult } | null>(null);

  const [state, setState] = useState<"loading" | "reauthNeeded" | "ready">("loading");

  useEffect(() => {
    if (visible) { setError(""); setLoading(false); setSuccess(null); setState("loading"); }
  }, [visible]);

  // Gitee 方案：无需 auto-reauth，直接显示激活码输入
  useEffect(() => {
    if (state !== "loading") return;
    setState("ready");
  }, [state, visible]);

  if (!visible) return null;

  /// 检查是否被限流（3 次失败 → 等 5 分钟）
  const checkRateLimit = (): string | null => {
    try {
      const raw = localStorage.getItem("authFailLog");
      if (!raw) return null;
      const log: { count: number; firstAt: number } = JSON.parse(raw);
      const elapsed = Date.now() - log.firstAt;
      if (log.count >= 3 && elapsed < 5 * 60 * 1000) {
        const remainMin = Math.ceil((5 * 60 * 1000 - elapsed) / 60000);
        return `尝试次数过多，请 ${remainMin} 分钟后再试`;
      }
      // 超过 5 分钟 — 重置
      if (elapsed >= 5 * 60 * 1000) localStorage.removeItem("authFailLog");
    } catch { /* ignore */ }
    return null;
  };

  const recordFail = () => {
    try {
      const raw = localStorage.getItem("authFailLog");
      const log: { count: number; firstAt: number } = raw
        ? JSON.parse(raw)
        : { count: 0, firstAt: Date.now() };
      log.count++;
      localStorage.setItem("authFailLog", JSON.stringify(log));
    } catch { /* ignore */ }
  };

  const handleActivate = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) { setError("请输入激活码"); return; }

    const rateLimit = checkRateLimit();
    if (rateLimit) { setError(rateLimit); return; }

    setLoading(true);
    setError("");
    try {
      const mc: string = await invoke("get_machine_code");
      const result = await invoke("auth_activate", {
        activationCode: trimmed,
        machineCode: mc,
        deviceName: "Windows PC",
      }) as ActivateResult;
      localStorage.removeItem("authFailLog"); // 成功 — 清失败计数
      let displayId = "";
      try {
        const payload = JSON.parse(atob(result.access_token.split('.')[1]));
        displayId = String(payload.display_id || (payload.user_id ? '#' + payload.user_id : ''));
      } catch { /* ignore */ }
      setSuccess({ tier: result.tier, displayId, result });
    } catch (e: any) {
      recordFail(); // 失败 — 记录
      setError(typeof e === "string" ? e : (e?.message || "激活失败，请检查网络后重试"));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleActivate();
  };

  // Success screen: show user ID before entering app
  if (success) {
    return (
      <div onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}
        style={{
          position: "absolute", inset: 0, zIndex: 9999,
          background: "rgba(10,10,20,0.92)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          fontFamily: "'WenQuanYi Micro Hei', 'Noto Sans CJK SC', sans-serif",
          backdropFilter: "blur(12px)",
        }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
        <div style={{ fontSize: 20, color: "#e0e0e0", fontWeight: 600, marginBottom: 24 }}>
          激活成功
        </div>
        <div style={{
          background: "rgba(255,255,255,0.05)", borderRadius: 12, padding: "16px 24px",
          border: "1px solid rgba(255,255,255,0.1)", marginBottom: 20, textAlign: "center",
        }}>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>
            {success.tier.toUpperCase()} 用户 · 您的专属 ID
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#e0e0e0", fontFamily: "monospace", marginBottom: 8 }}>
            {success.displayId}
          </div>
          <button
            onClick={() => { navigator.clipboard.writeText(success.displayId); }}
            style={{
              fontSize: 11, padding: "4px 16px",
              border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6,
              background: "rgba(255,255,255,0.06)", color: "#ccc", cursor: "pointer",
            }}
          >
            复制 ID
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#777", marginBottom: 24, textAlign: "center", maxWidth: 260 }}>
          如遇问题，请将此用户 ID 提供给管理员
        </div>
        <button
          onClick={() => onAuthSuccess(success.result)}
          style={{
            padding: "10px 32px", borderRadius: 8, border: "none",
            background: "rgba(139,92,246,0.8)", color: "#fff",
            fontSize: 15, fontWeight: 600, cursor: "pointer",
          }}
        >
          开始使用
        </button>
      </div>
    );
  }

  // Loading state — auto re-auth in progress
  if (state === "loading") {
    return (
      <div onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}
        style={{
          position: "absolute", inset: 0, zIndex: 9999,
          background: "rgba(10,10,20,0.92)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          fontFamily: "'WenQuanYi Micro Hei', 'Noto Sans CJK SC', sans-serif",
          backdropFilter: "blur(12px)",
        }}>
        <div style={{ fontSize: 32, marginBottom: 16 }}>🔍</div>
        <div style={{ fontSize: 14, color: "#888" }}>检测设备授权...</div>
      </div>
    );
  }

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 9999,
      background: "rgba(10,10,20,0.92)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'WenQuanYi Micro Hei', 'Noto Sans CJK SC', sans-serif",
      backdropFilter: "blur(12px)",
    }}>
      {/* Logo area — block mouse events from window drag */}
      <div onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}
        style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🤖</div>
        <div style={{ fontSize: 20, color: "#e0e0e0", fontWeight: 600, marginBottom: 4 }}>
          waifu-agent
        </div>
        <div style={{ fontSize: 12, color: "#888" }}>
          输入激活码以开始使用
        </div>
      </div>

      {/* Activation form */}
      <div onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}
        style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <input
          value={code}
          onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(""); }}
          onKeyDown={handleKeyDown}
          placeholder="WA-PRO-XXXX"
          disabled={loading}
          autoFocus
          maxLength={20}
          style={{
            width: 220, padding: "10px 14px",
            borderRadius: 8,
            border: error ? "1px solid rgba(239,68,68,0.6)" : "1px solid rgba(255,255,255,0.2)",
            background: "rgba(255,255,255,0.06)",
            color: "#fff", fontSize: 16, textAlign: "center",
            letterSpacing: 2, outline: "none",
            fontFamily: "monospace",
          }}
        />

        {error && (
          <div style={{ color: "#ef4444", fontSize: 12, maxWidth: 260, textAlign: "center" }}>
            {error}
          </div>
        )}

        <button
          onClick={handleActivate}
          disabled={loading || !code.trim()}
          style={{
            width: 220, padding: "10px 0",
            borderRadius: 8, border: "none",
            background: loading ? "rgba(139,92,246,0.4)" : "rgba(139,92,246,0.8)",
            color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer",
            opacity: loading || !code.trim() ? 0.6 : 1,
          }}
        >
          {loading ? "激活中..." : "激活"}
        </button>

        <button
          onClick={onFreeUse}
          style={{
            width: 220, padding: "10px 0", marginTop: 8,
            borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)",
            background: "transparent",
            color: "#aaa", fontSize: 13, cursor: "pointer",
          }}
        >
          免费使用（功能受限）
        </button>
      </div>

      {/* Footer */}
      <div onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}
        style={{ position: "absolute", bottom: 20, textAlign: "center" }}>
        <a
          href="https://ifdian.net/a/eidolonByKevin?tab=shop"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#8b5cf6", fontSize: 12, textDecoration: "none", opacity: 0.8 }}
        >
          获取激活码 → 爱发电赞助
        </a>
      </div>
    </div>
  );
}
