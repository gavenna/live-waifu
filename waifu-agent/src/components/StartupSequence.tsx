/**
 * StartupSequence — 启动动画编排组件
 *
 * Phase 0-1: 终端打字机 overlay (React DOM)
 * Phase 1.5: 赞助致谢画面 (新增)
 * Phase 2:   终端文字淡出 + PIXI 粒子汇聚
 * Phase 3:   模型渐显 + 闭眼→睁眼苏醒动画
 * Phase 4:   微笑表情 + motion + TTS 问候
 *
 * 打字机阶段点击跳过全部；致谢阶段点击跳到 Phase 2。
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  createParticles,
  createFloatingParticles,
  destroyParticles,
  updateParticles,
  updateFloatingParticles,
  startConverge,
  startWakeUpAnimation,
  playGreeting,
  playGreetingTts,
  type Particle,
} from "../animation/startupTimeline";
import type { TtsCleanup } from "../animation/startupTimeline";
import {
  getStartupConfig,
  PHASE_TIMINGS,
  PARTICLE_COUNT,
  FLOATING_PARTICLE_COUNT,
  FLOATING_PARTICLE_COLORS,
  FLOAT_SPEED_RANGE,
  FLOAT_AMPLITUDE_RANGE,
  FLOATING_PARTICLE_SIZE_MIN,
  FLOATING_PARTICLE_SIZE_MAX,
  CREDITS_DURATION,
  CREDITS_TITLE_FADE,
  CREDITS_ROW_DELAY,
} from "../constants/startup";
import { PRESETS, DEFAULT_PERSONA, resolveMotionGroups } from "../persona.config";
import { getEmotionExpression } from "../constants/emotion";
import type { PersonaName } from "../persona.config";

interface Sponsor {
  name: string;
  tier: string;
}

interface Props {
  visible: boolean;
  modelRef: React.MutableRefObject<any>;
  appRef: React.MutableRefObject<any>;
  personaName: string;
  canvas: { w: number; h: number; modelX: number; modelY: number };
  ttsVolume: number;
  sponsors: Sponsor[];
  onComplete: () => void;
}

export function StartupSequence({
  visible,
  modelRef,
  appRef,
  personaName,
  canvas,
  ttsVolume,
  sponsors,
  onComplete,
}: Props) {
  // ── 打字机状态 ──
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [terminalDone, setTerminalDone] = useState(false);
  const terminalDoneRef = useRef(false);
  const setTerminalDoneBoth = useCallback((v: boolean) => {
    terminalDoneRef.current = v;
    setTerminalDone(v);
  }, []);
  // Phase 2+ 终端文字淡出
  const [terminalFading, setTerminalFading] = useState(false);

  // ── 致谢画面状态 ──
  const [showCredits, setShowCredits] = useState(false);
  const [creditsFading, setCreditsFading] = useState(false);
  const [creditsRows, setCreditsRows] = useState(0);
  const inCreditsRef = useRef(false);
  const startCreditsFadeOutRef = useRef<() => void>(() => {});
  const sponsorsRef = useRef(sponsors);
  sponsorsRef.current = sponsors; // always fresh, for useEffect closures

  // ── 内部 refs ──
  const genRef = useRef(0);
  const phaseRef = useRef(0);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef(0);
  const floatingRafRef = useRef(0);
  const lastFloatMsRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const ttsCleanupRef = useRef<(() => void) | null>(null);
  const completedRef = useRef(false);

  // ── Per-model greeting expression & motion ──────
  const greetingExpr = useMemo(() => {
    const preset = PRESETS[personaName as PersonaName] || PRESETS[DEFAULT_PERSONA];
    const names = (preset as any).expressionNames as string[] | undefined;
    const emoMap = (preset as any).emotionExpression as Record<string, string> | undefined;
    return getEmotionExpression("happy", names?.length ? names : ["exp_01","exp_02","exp_03","exp_04","exp_05","exp_06","exp_07","exp_08"], emoMap);
  }, [personaName]);
  const greetingMotion = useMemo(() => {
    const preset = PRESETS[personaName as PersonaName] || PRESETS[DEFAULT_PERSONA];
    return resolveMotionGroups(preset).tapBody;
  }, [personaName]);

  // ── DOM 漂浮粒子数据 (致谢背景，稳定随机) ──
  const floatingDots = useMemo(() => {
    const count = 20;
    const colors = FLOATING_PARTICLE_COLORS;
    const dots: { x: number; y: number; size: number; color: string; opacity: number; dur: number; delay: number; variant: number; glow: number }[] = [];
    for (let i = 0; i < count; i++) {
      dots.push({
        x: 5 + Math.random() * 90,
        y: 5 + Math.random() * 90,
        size: 2 + Math.random() * 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        opacity: 0.3 + Math.random() * 0.5,
        dur: 2.5 + Math.random() * 4,
        delay: Math.random() * 3,
        variant: i % 4,
        glow: 4 + Math.random() * 10,
      });
    }
    return dots;
  }, []);

  // ── 安全 addTimer ──
  const addTimer = useCallback((fn: () => void, ms: number) => {
    const g = genRef.current;
    const t = setTimeout(() => {
      if (genRef.current !== g) return;
      fn();
    }, ms);
    timersRef.current.push(t);
    return t;
  }, []);

  // ── 完成 / 跳过 ──
  const finish = useCallback(
    (skipped: boolean) => {
      if (completedRef.current) return;
      completedRef.current = true;
      ++genRef.current;

      // 清除所有定时器
      for (const t of timersRef.current) clearTimeout(t);
      timersRef.current = [];

      // 取消 RAF
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      if (floatingRafRef.current) {
        cancelAnimationFrame(floatingRafRef.current);
        floatingRafRef.current = 0;
      }

      // 销毁粒子
      if (particlesRef.current.length > 0) {
        destroyParticles(particlesRef.current);
        particlesRef.current = [];
      }

      // 停止 TTS
      ttsCleanupRef.current?.();
      ttsCleanupRef.current = null;

      // 重置模型状态
      const model = modelRef.current;
      if (model) {
        model.alpha = 1;
        const core = model.internalModel?.coreModel as any;
        if (core) {
          try { core.setParameterValueById("ParamEyeLOpen", 1); } catch {}
          try { core.setParameterValueById("ParamEyeROpen", 1); } catch {}
          try { core.setParameterValueById("ParamBodyAngleY", 0); } catch {}
          try { core.setParameterValueById("ParamAuraOn", 0); } catch {}
          try { core.setParameterValueById("ParamAura", 0); } catch {}
          try { core.setParameterValueById("ParamEyeEffect", 0); } catch {}
        }
        if (!skipped) {
          model.expression("exp_02").catch(() => {});
        }
      }

      onComplete();
    },
    [modelRef, onComplete],
  );

  // ── 主序列 ──
  useEffect(() => {
    if (!visible) return;
    const gen = ++genRef.current;
    completedRef.current = false;
    const t0 = performance.now();
    const log = (msg: string) => {
      import("@tauri-apps/api/core").then(m => m.invoke("frontend_log", { msg: `[STARTUP TIMELINE] +${(performance.now() - t0).toFixed(0)}ms ${msg}` })).catch(()=>{});
    };
    log("StartupSequence started");

    // 移除 index.html 预加载 splash (如果有), 然后正常播终端动画
    document.getElementById("waifu-splash")?.remove();

    const config = getStartupConfig(personaName);

    // ── Phase 0-1: 打字机效果 ──
    // 始终完整播放 — splash 是项目介绍, 和终端动画不重叠
      const lines = config.bootLines;
      let charIdx = 0;
      let lineIdx = 0;
      let currentLine = "";
      const displayed: string[] = [];

      const typeNext = () => {
        if (genRef.current !== gen || completedRef.current) return;
        if (lineIdx >= lines.length) {
          log("terminal typewriter done");
          setTerminalDoneBoth(true);
          return;
        }
        const fullLine = lines[lineIdx];
        if (charIdx < fullLine.length) {
          currentLine += fullLine[charIdx];
          charIdx++;
          setTerminalLines([...displayed, currentLine]);
          addTimer(typeNext, PHASE_TIMINGS.CHAR_INTERVAL);
        } else {
          displayed.push(currentLine);
          currentLine = "";
          charIdx = 0;
          lineIdx++;
          setTerminalLines([...displayed]);
          addTimer(typeNext, PHASE_TIMINGS.LINE_DELAY);
        }
      };
      addTimer(typeNext, 150);

    // ── Phase 1→1.5: 终端就绪 + 模型就绪 → 致谢画面 ──
    const startPhase2 = () => {
      if (genRef.current !== gen || completedRef.current) return;
      log("Phase 2 dissolve start");
      phaseRef.current = 2;
      inCreditsRef.current = false;
      setTerminalFading(true);
      setCreditsFading(true);

      // 如果还没有粒子（跳过了致谢阶段），创建新粒子
      if (particlesRef.current.length === 0) {
        const app = appRef.current;
        if (app) {
          const particles = createParticles(
            app, canvas, canvas.modelX, canvas.modelY,
            config.particleColors, PARTICLE_COUNT,
          );
          particlesRef.current = particles;
        }
      }

      const dissolveStart = performance.now();
      const dissolveMs = PHASE_TIMINGS.DISSOLVE_DURATION;
      const animateDissolve = () => {
        if (genRef.current !== gen || completedRef.current) return;
        const elapsed = performance.now() - dissolveStart;
        const progress = Math.min(1, elapsed / dissolveMs);
        const done = updateParticles(particlesRef.current, progress);
        if (!done && progress < 1) {
          rafRef.current = requestAnimationFrame(animateDissolve);
        } else {
          destroyParticles(particlesRef.current);
          particlesRef.current = [];
          startPhase3();
        }
      };
      rafRef.current = requestAnimationFrame(animateDissolve);
    };

    // ── 致谢完成 → Phase 2 ──
    const startCreditsFadeOut = () => {
      if (genRef.current !== gen || completedRef.current) return;
      if (!inCreditsRef.current) return; // 已经淡出过了
      log("credits done, fading to Phase 2");
      inCreditsRef.current = false;
      setCreditsFading(true);

      // 停止漂浮循环，切换粒子为收敛模式
      if (floatingRafRef.current) {
        cancelAnimationFrame(floatingRafRef.current);
        floatingRafRef.current = 0;
      }
      if (particlesRef.current.length > 0) {
        startConverge(particlesRef.current, canvas.modelX, canvas.modelY);
      }

      // 等 CSS opacity 过渡完再进 Phase 2
      addTimer(startPhase2, 400);
    };
    startCreditsFadeOutRef.current = startCreditsFadeOut;

    const tryTransitionToCredits = () => {
      if (genRef.current !== gen || completedRef.current) return;
      if (!terminalDoneRef.current) {
        timersRef.current.push(setTimeout(tryTransitionToCredits, 200));
        return;
      }
      if (!modelRef.current || !appRef.current) {
        timersRef.current.push(setTimeout(tryTransitionToCredits, 200));
        return;
      }
      log("Phase 1.5 credits start");
      phaseRef.current = 1.5;
      inCreditsRef.current = true;
      setShowCredits(true);

      // 创建背景漂浮粒子
      const fps = createFloatingParticles(appRef.current, canvas, {
        count: FLOATING_PARTICLE_COUNT,
        colors: FLOATING_PARTICLE_COLORS,
        sizeMin: FLOATING_PARTICLE_SIZE_MIN,
        sizeMax: FLOATING_PARTICLE_SIZE_MAX,
        speedMin: FLOAT_SPEED_RANGE[0],
        speedMax: FLOAT_SPEED_RANGE[1],
        ampMin: FLOAT_AMPLITUDE_RANGE[0],
        ampMax: FLOAT_AMPLITUDE_RANGE[1],
      });
      particlesRef.current = fps;
      log(`floating particles created: ${fps.length}`);

      // 启动漂浮 RAF 循环
      lastFloatMsRef.current = performance.now();
      const floatTick = () => {
        if (genRef.current !== gen || completedRef.current) return;
        const now = performance.now();
        const delta = now - lastFloatMsRef.current;
        lastFloatMsRef.current = now;
        updateFloatingParticles(particlesRef.current, Math.min(delta, 50)); // cap dt 防跳帧
        floatingRafRef.current = requestAnimationFrame(floatTick);
      };
      floatingRafRef.current = requestAnimationFrame(floatTick);

      // 逐行动画：每行延迟出现（用 ref 读最新值，避免闭包过期）
      const rows = sponsorsRef.current.length;
      for (let i = 0; i < rows; i++) {
        addTimer(() => {
          if (genRef.current !== gen || completedRef.current) return;
          setCreditsRows(i + 1);
        }, CREDITS_TITLE_FADE + i * CREDITS_ROW_DELAY);
      }
      // 自动超时进 Phase 2
      addTimer(startCreditsFadeOut, CREDITS_DURATION);
    };
    addTimer(() => tryTransitionToCredits(), 500);

    // ── Phase 3: 模型苏醒 ──
    const startPhase3 = () => {
      if (genRef.current !== gen || completedRef.current) return;
      log("Phase 3 wake-up start");
      phaseRef.current = 3;

      // 模型可能还在加载中 — 轮询等待, 就绪后再苏醒
      const tryStart = () => {
        if (genRef.current !== gen || completedRef.current) return;
        const m = modelRef.current;
        const a = appRef.current;
        if (!m || !a) {
          timersRef.current.push(setTimeout(tryStart, 200));
          return;
        }
        const core = m.internalModel?.coreModel as any;
        if (!core) {
          timersRef.current.push(setTimeout(tryStart, 200));
          return;
        }
        // 模型就绪, 开始苏醒动画
        log("Phase 3 model ready, starting wake-up animation");
        startWakeUpAnimation(
          {
            modelAlpha: { set: (v: number) => { m.alpha = v; } },
            core: { set: (id: string, v: number) => { try { core.setParameterValueById(id, v); } catch {} } },
            setExpression: (name: string) => { m.expression(name).catch(() => {}); },
          },
          PHASE_TIMINGS.WAKEUP_DURATION,
          rafRef,
          () => {
            if (genRef.current !== gen || completedRef.current) return;
            startPhase4();
          },
        );
      };
      tryStart();
    };

    // ── Phase 4: 问候 ──
    const startPhase4 = () => {
      if (genRef.current !== gen || completedRef.current) return;
      log("Phase 4 greeting start");
      phaseRef.current = 4;

      if (modelRef.current) {
        playGreeting(modelRef.current, greetingExpr, greetingMotion, 3).catch(() => {});
      }

      // 等 TTS 播完再收尾，避免冷启动时 daemon 慢导致收尾 timer 比 TTS 先触发
      const MAX_WAIT = 8000; // 最多等 8s，防止 TTS 彻底失败时卡住
      let finished = false;
      const doFinish = () => {
        if (finished) return;
        finished = true;
        log("startup sequence complete");
        finish(false);
      };

      playGreetingTts(config.greeting, ttsVolume).then((cleanup) => {
        if (genRef.current !== gen || completedRef.current) return;
        if (cleanup) ttsCleanupRef.current = cleanup;
        // TTS 拿到后再等播放时长 + 300ms 缓冲
        const duration = (cleanup as TtsCleanup | null)?._duration ?? PHASE_TIMINGS.GREETING_DURATION;
        addTimer(doFinish, Math.max(500, duration));
      }).catch(() => {
        // TTS 失败，降级到固定延迟
        addTimer(doFinish, PHASE_TIMINGS.GREETING_DURATION);
      });

      // 兜底：超过 MAX_WAIT 强制收尾
      addTimer(doFinish, MAX_WAIT);
    };

    // ── 清理 ──
    return () => {
      ++genRef.current;
      for (const t of timersRef.current) clearTimeout(t);
      timersRef.current = [];
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      if (floatingRafRef.current) {
        cancelAnimationFrame(floatingRafRef.current);
        floatingRafRef.current = 0;
      }
      ttsCleanupRef.current?.();
      ttsCleanupRef.current = null;
      // 销毁可能残留的粒子
      if (particlesRef.current.length > 0) {
        destroyParticles(particlesRef.current);
        particlesRef.current = [];
      }
    };
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // 赞助数据在致谢阶段异步到达时，立即补刷显示
  useEffect(() => {
    if (showCredits && sponsors.length > 0 && creditsRows < sponsors.length) {
      setCreditsRows(sponsors.length);
    }
  }, [sponsors, showCredits, creditsRows]);

  // 如果已完成/不可见，返回 null
  if (!visible || completedRef.current) return null;

  const isTerminalPhase = !terminalFading && !showCredits;
  const isCreditsPhase = showCredits;
  const overlayOpacity = (terminalFading || creditsFading) ? 0 : 1;
  const overlayBg = isTerminalPhase ? "#0a0a0f" : isCreditsPhase ? "#0a0a0f" : "transparent";

  const handleOverlayClick = () => {
    if (inCreditsRef.current) {
      startCreditsFadeOutRef.current();
    } else {
      finish(true);
    }
  };

  return (
    <>
      <style>{`
        @keyframes waifu-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes shimmer {
          0% { background-position: 200% center; }
          100% { background-position: -200% center; }
        }
        .shimmer-credits {
          color: #ddd;
          background: linear-gradient(90deg, rgba(241,196,15,0) 10%, rgba(241,196,15,0.33) 30%, rgba(241,196,15,0.65) 50%, rgba(241,196,15,0.33) 70%, rgba(241,196,15,0) 90%);
          background-size: 200% 100%;
          animation: shimmer 2s linear infinite;
          padding: 2px 24px;
          border-radius: 4px;
        }
        @keyframes title-glow {
          0%, 100% {
            text-shadow: 0 0 10px rgba(241,196,15,0.3), 0 0 20px rgba(241,196,15,0.1);
          }
          50% {
            text-shadow: 0 0 15px rgba(241,196,15,0.6), 0 0 30px rgba(241,196,15,0.3), 0 0 50px rgba(241,196,15,0.15);
          }
        }
        @keyframes float-dot {
          0%, 100% { transform: translate(0, 0); }
          25% { transform: translate(6px, -10px); }
          50% { transform: translate(-3px, -5px); }
          75% { transform: translate(-8px, 7px); }
        }
        @keyframes float-dot-alt {
          0%, 100% { transform: translate(0, 0); }
          33% { transform: translate(-7px, -6px); }
          66% { transform: translate(5px, 10px); }
        }
        @keyframes float-dot-slow {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(10px, -12px); }
        }
      `}</style>
      <div
        onClick={handleOverlayClick}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        transition: "opacity 0.4s ease-out",
        opacity: overlayOpacity,
        background: overlayBg,
        pointerEvents: overlayOpacity > 0.01 ? "auto" : "none",
      }}
    >
      {/* 终端打字机 */}
      {isTerminalPhase && (
        <div
          style={{
            fontFamily: "'Consolas', 'Courier New', monospace",
            fontSize: 13,
            color: "#a0d2db",
            lineHeight: "1.8",
            padding: "0 32px",
            maxWidth: 480,
            userSelect: "none",
          }}
        >
          {terminalLines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          <span
            style={{
              display: terminalDone ? "inline-block" : "none",
              color: "#f1c40f",
              animation: "waifu-blink 0.7s step-end infinite",
            }}
          >
            _
          </span>
          {terminalDone && (
            <div style={{ marginTop: 16, fontSize: 11, color: "#555" }}>
              click anywhere to skip
            </div>
          )}
        </div>
      )}

      {/* 致谢画面 */}
      {isCreditsPhase && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            userSelect: "none",
            transition: "opacity 0.4s ease-out",
            opacity: creditsFading ? 0 : 1,
          }}
        >
          {/* ── DOM 漂浮粒子 ── */}
          {floatingDots.map((dot, i) => {
            const animName = dot.variant === 0 ? "float-dot" : dot.variant === 1 ? "float-dot-alt" : "float-dot-slow";
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: `${dot.x}%`,
                  top: `${dot.y}%`,
                  width: dot.size,
                  height: dot.size,
                  borderRadius: "50%",
                  background: dot.color,
                  opacity: dot.opacity,
                  boxShadow: `0 0 ${dot.glow}px ${dot.color}`,
                  animation: `${animName} ${dot.dur}s ease-in-out infinite`,
                  animationDelay: `${dot.delay}s`,
                  pointerEvents: "none",
                } as React.CSSProperties}
              />
            );
          })}

          {/* 标题 */}
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "#f1c40f",
              marginBottom: 32,
              letterSpacing: 4,
              transition: "opacity 0.4s ease-out",
              opacity: creditsRows >= 0 ? 1 : 0,
              animation: "title-glow 2s ease-in-out infinite",
            }}
          >
            ★ 感谢每一位赞助者 ★
          </div>

          {/* 赞助名单 */}
          <div style={{
            textAlign: "center",
            maxHeight: "60vh",
            overflowY: "auto",
            paddingRight: 8,
            // 隐藏滚动条但保留滚动能力
            scrollbarWidth: "none",
          } as React.CSSProperties}>
            {sponsors.length === 0 ? (
              <div
                style={{
                  fontSize: 14,
                  color: "#666",
                  letterSpacing: 2,
                  opacity: creditsRows >= 1 ? 1 : 0,
                  transition: "opacity 0.4s ease-out",
                }}
              >
                你的名字会出现在这里
              </div>
            ) : (
              <>
                {sponsors.map((s, i) => {
                  // 人多时自动缩小字号
                  const fontSize = sponsors.length > 12 ? 12 : sponsors.length > 8 ? 13 : 15;
                  const marginBottom = sponsors.length > 12 ? 6 : sponsors.length > 8 ? 8 : 12;
                  return (
                    <div
                      key={i}
                      className="shimmer-credits"
                      style={{
                        fontSize,
                        marginBottom,
                        opacity: i < creditsRows ? 1 : 0,
                        transition: "opacity 0.3s ease-out",
                      }}
                    >
                      {s.name}
                      <span style={{ fontSize: fontSize - 3, opacity: 0.65, marginLeft: 12 }}>
                        {s.tier}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* 虚位以待 */}
          <div
            style={{
              marginTop: 20,
              fontSize: 13,
              color: "#555",
              letterSpacing: 2,
              opacity: creditsRows >= sponsors.length ? 1 : 0,
              transition: "opacity 0.5s ease-out",
            }}
          >
            —— 虚位以待 ——
          </div>

          {/* 跳过提示 */}
          <div style={{ marginTop: 24, fontSize: 10, color: "#444" }}>
            click to skip
          </div>
        </div>
      )}
    </div>
    </>
  );
}
