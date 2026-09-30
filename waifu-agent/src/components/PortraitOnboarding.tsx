import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── 入门配置题库 ──────────────────────────────────

interface Question {
  id: string;
  type: "choice" | "text";
  ask: string;
  options?: { key: string; emoji?: string; label: string; desc?: string }[];
  placeholder?: string;
  multiLine?: boolean;
}

const QUESTIONS: Question[] = [
  {
    id: "name",
    type: "text",
    ask: "你希望我怎么称呼你？\n名字、网名、外号都可以。",
    placeholder: "输入你的称呼…",
  },
  {
    id: "personality",
    type: "choice",
    ask: "你希望我是什么样的性格？",
    options: [
      { key: "mao-girlfriend", emoji: "💗", label: "女友", desc: "温柔亲昵，护着你" },
      { key: "mao-teasing", emoji: "😏", label: "毒舌损友", desc: "会怼你但关心你" },
      { key: "mao-warm", emoji: "💕", label: "温柔体贴", desc: "会鼓励你陪着你" },
      { key: "mao-cool", emoji: "😎", label: "冷静理性", desc: "有事说事不废话" },
      { key: "mao-energetic", emoji: "⚡", label: "元气满满", desc: "活泼话多" },
      { key: "mao-rebel", emoji: "🔥", label: "叛逆不羁", desc: "不按套路出牌" },
    ],
  },
  {
    id: "usage",
    type: "choice",
    ask: "你主要想让我陪你做什么？",
    options: [
      { key: "chat", label: "🗣 闲聊陪伴", desc: "有个能说话的对象" },
      { key: "work", label: "💻 工作帮手", desc: "讨论问题，整理思路" },
      { key: "vent", label: "💬 情绪垃圾桶", desc: "需要有人听、有人懂" },
      { key: "mixed", label: "🎯 都来点", desc: "看心情切换" },
    ],
  },
  {
    id: "topics",
    type: "text",
    ask: "你喜欢聊什么？有什么话题不想让我碰？\n不想聊的可以不写——以后随时能改。",
    placeholder: "喜欢聊：游戏开发、AI、独立游戏…\n不想聊：……",
    multiLine: true,
  },
];

interface Props {
  onComplete: (portraitText: string) => void;
  onSkip: () => void;
}

type Phase = "intro" | "asking" | "done";

export function PortraitOnboarding({ onComplete, onSkip }: Props) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<{ question_id: string; type: string; value: string }[]>([]);
  const [textValue, setTextValue] = useState("");
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);

  const current = QUESTIONS[qIndex];
  const isLast = qIndex >= QUESTIONS.length - 1;

  const handleChoice = useCallback(async (key: string) => {
    const answer = { question_id: current.id, type: "choice", value: key };
    const newAnswers = [...answers, answer];
    setAnswers(newAnswers);

    const feedbacks = ["嗯，记下了。", "好，下一题——", "了解。接着来。", "行，我知道了。"];
    setFeedback(feedbacks[Math.floor(Math.random() * feedbacks.length)]);

    await new Promise(r => setTimeout(r, 500));

    if (isLast) {
      finish(newAnswers);
    } else {
      setFeedback("");
      setQIndex(prev => prev + 1);
    }
  }, [qIndex, answers, current, isLast]);

  const handleTextSubmit = useCallback(async () => {
    const val = textValue.trim();
    if (!val) return;

    const answer = { question_id: current.id, type: "text", value: val };
    const newAnswers = [...answers, answer];
    setAnswers(newAnswers);

    const feedbacks = ["嗯，记下了。", "好，下一题——", "了解。接着来。", "行，我知道了。"];
    setFeedback(feedbacks[Math.floor(Math.random() * feedbacks.length)]);

    await new Promise(r => setTimeout(r, 500));

    if (isLast) {
      finish(newAnswers);
    } else {
      setFeedback("");
      setTextValue("");
      setQIndex(prev => prev + 1);
    }
  }, [textValue, current, qIndex, answers, isLast]);

  const finish = useCallback(async (finalAnswers: typeof answers) => {
    setPhase("done");
    setSaving(true);
    try {
      const portraitText: string = await invoke("portrait_save", {
        answers: finalAnswers,
      });
      setSaving(false);
      onComplete(portraitText);
    } catch (e) {
      console.error("portrait_save failed:", e);
      setSaving(false);
      onComplete("");
    }
  }, [onComplete]);

  const progressPct = Math.round(((qIndex + 1) / QUESTIONS.length) * 100);

  // ── Intro ──
  if (phase === "intro") {
    return (
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
        style={{
        position: "absolute", inset: 0, zIndex: 100,
        background: "rgba(10,10,20,0.92)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "40px 32px",
        fontFamily: "'WenQuanYi Micro Hei', sans-serif",
        color: "#ccc",
      }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🐱</div>
        <div style={{ fontSize: 18, marginBottom: 8, color: "#e0e0e0", textAlign: "center" }}>
          初次见面！先简单认识一下
        </div>
        <div style={{ fontSize: 13, color: "#888", textAlign: "center", lineHeight: 1.6, maxWidth: 360 }}>
          {QUESTIONS.length} 个问题，让我知道怎么跟你相处。
          <br />不想回答的可以跳过。
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 28 }}>
          <button onClick={() => setPhase("asking")}
            style={{
              padding: "10px 32px", borderRadius: 20,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(255,255,255,0.1)", color: "#fff",
              fontSize: 14, cursor: "pointer",
            }}>开始</button>
          <button onClick={onSkip}
            style={{
              padding: "10px 20px", borderRadius: 20,
              border: "none", background: "transparent",
              color: "#666", fontSize: 13, cursor: "pointer",
            }}>下次再说</button>
        </div>
      </div>
    );
  }

  // ── Done ──
  if (phase === "done") {
    return (
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
        style={{
        position: "absolute", inset: 0, zIndex: 100,
        background: "rgba(10,10,20,0.92)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "40px 32px",
        fontFamily: "'WenQuanYi Micro Hei', sans-serif",
        color: "#ccc",
      }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>
          {saving ? "⏳" : "✨"}
        </div>
        <div style={{ fontSize: 18, marginBottom: 8, color: "#e0e0e0", textAlign: "center" }}>
          {saving ? "正在保存…" : "搞定！"}
        </div>
        <div style={{ fontSize: 13, color: "#888", textAlign: "center", lineHeight: 1.6, maxWidth: 360 }}>
          {saving ? "" : "以后聊天的时候，我会记得这些的。"}
        </div>
        {!saving && (
          <button onClick={onSkip}
            style={{
              marginTop: 28, padding: "10px 32px", borderRadius: 20,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(255,255,255,0.1)", color: "#fff",
              fontSize: 14, cursor: "pointer",
            }}>好</button>
        )}
      </div>
    );
  }

  // ── Asking ──
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      style={{
      position: "absolute", inset: 0, zIndex: 100,
      background: "rgba(10,10,20,0.92)",
      display: "flex", flexDirection: "column",
      padding: "32px 28px 28px",
      fontFamily: "'WenQuanYi Micro Hei', sans-serif",
      color: "#ccc",
    }}>
      {/* Progress */}
      <div style={{
        height: 2, background: "rgba(255,255,255,0.08)",
        borderRadius: 1, marginBottom: 24, flexShrink: 0,
      }}>
        <div style={{
          height: 2, width: `${progressPct}%`,
          background: "linear-gradient(90deg, #8b5cf6, #06b6d4)",
          borderRadius: 1, transition: "width 0.3s",
        }} />
      </div>
      <div style={{ fontSize: 10, color: "#555", marginBottom: 24, textAlign: "right" }}>
        {qIndex + 1}/{QUESTIONS.length}
      </div>

      {/* Question */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto", paddingBottom: 12 }}>
        <div style={{
          fontSize: 15, color: "#e0e0e0", lineHeight: 1.7, marginBottom: 24,
          whiteSpace: "pre-line",
        }}>
          {current.ask}
        </div>

        {current.type === "choice" && current.options ? (
          /* ── 选择题 ── */
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {current.options.map((opt) => (
              <button key={opt.key}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                onClick={() => handleChoice(opt.key)}
                style={{
                  padding: "11px 14px", borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.05)",
                  color: "#ccc", fontSize: 13, cursor: "pointer",
                  textAlign: "left", lineHeight: 1.4,
                  display: "flex", alignItems: "center", gap: 8,
                }}
              >
                {opt.emoji && <span style={{ fontSize: 18 }}>{opt.emoji}</span>}
                <span style={{ fontWeight: 500 }}>{opt.label}</span>
                {opt.desc && <span style={{ color: "#777", fontSize: 12, marginLeft: 4 }}>— {opt.desc}</span>}
              </button>
            ))}
          </div>
        ) : (
          /* ── 文本题 ── */
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {current.multiLine ? (
              <textarea
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.ctrlKey) {
                    e.preventDefault();
                    handleTextSubmit();
                  }
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                placeholder={current.placeholder}
                autoFocus
                rows={4}
                style={{
                  padding: "12px 14px", borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(255,255,255,0.06)",
                  color: "#e0e0e0", fontSize: 13,
                  fontFamily: "'WenQuanYi Micro Hei', sans-serif",
                  resize: "none", outline: "none",
                  lineHeight: 1.6,
                }}
              />
            ) : (
              <input
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleTextSubmit();
                  }
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                placeholder={current.placeholder}
                autoFocus
                style={{
                  padding: "12px 14px", borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(255,255,255,0.06)",
                  color: "#e0e0e0", fontSize: 14,
                  fontFamily: "'WenQuanYi Micro Hei', sans-serif",
                  outline: "none",
                }}
              />
            )}
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onMouseUp={(e) => e.stopPropagation()}
              onClick={handleTextSubmit}
              disabled={!textValue.trim()}
              style={{
                padding: "10px 0", borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.15)",
                background: textValue.trim()
                  ? "rgba(139,92,246,0.25)"
                  : "rgba(255,255,255,0.04)",
                color: textValue.trim() ? "#e0e0e0" : "#555",
                fontSize: 13, cursor: textValue.trim() ? "pointer" : "default",
                transition: "all 0.2s",
              }}
            >
              {isLast ? "完成" : "继续"}
            </button>
            {isLast && current.multiLine && (
              <div style={{ fontSize: 10, color: "#555", textAlign: "center" }}>
                Ctrl + Enter 提交
              </div>
            )}
          </div>
        )}

        {/* Feedback */}
        {feedback && (
          <div style={{
            marginTop: 16, fontSize: 12, color: "#06b6d4",
            textAlign: "center", fontStyle: "italic",
          }}>
            {feedback}
          </div>
        )}
      </div>
    </div>
  );
}
