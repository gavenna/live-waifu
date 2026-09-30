/**
 * 启动动画核心逻辑 — 粒子系统、模型参数动画、问候
 *
 * 从 StartupSequence 组件调用，不依赖 React。
 */
import * as PIXI from "pixi.js";

// ── 缓动函数 ──

export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ── 粒子系统 ──

export interface Particle {
  g: PIXI.Graphics;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  delay: number; // 启动延迟 (0-1)
  color: number;
  radius: number;
  // ── 漂浮状态 (Phase 1.5 致谢背景) ──
  baseX?: number;
  baseY?: number;
  floatPhase?: number;
  floatSpeed?: number;  // radians/sec
  floatAmpX?: number;
  floatAmpY?: number;
}

export function createParticles(
  app: PIXI.Application,
  _canvas: { w: number; h: number },
  targetX: number,
  targetY: number,
  colors: string[],
  count: number = 28,
): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 150 + Math.random() * 300;
    const startX = targetX + Math.cos(angle) * dist;
    const startY = targetY + Math.sin(angle) * dist;
    const g = new PIXI.Graphics();
    const colorStr = colors[Math.floor(Math.random() * colors.length)];
    const color = parseInt(colorStr.replace("#", ""), 16);
    const radius = 1.5 + Math.random() * 3;
    g.beginFill(color, 0.9);
    g.drawCircle(0, 0, radius);
    g.endFill();
    g.x = startX;
    g.y = startY;
    g.alpha = 0;
    app.stage.addChild(g);

    particles.push({
      g,
      startX,
      startY,
      targetX: targetX + (Math.random() - 0.5) * 40,
      targetY: targetY + (Math.random() - 0.5) * 40,
      delay: Math.random() * 0.6,
      color,
      radius,
    });
  }
  return particles;
}

export function destroyParticles(particles: Particle[]): void {
  for (const p of particles) {
    p.g.destroy();
  }
}

/** 返回 true 表示动画完成 */
export function updateParticles(
  particles: Particle[],
  progress: number, // 0..1 整体进度
): boolean {
  let allDone = true;
  for (const p of particles) {
    const localT = Math.max(0, Math.min(1, (progress - p.delay) / (1 - p.delay)));
    if (localT <= 0) {
      p.g.alpha = 0;
      allDone = false;
      continue;
    }
    const eased = easeOut(localT);
    p.g.x = p.startX + (p.targetX - p.startX) * eased;
    p.g.y = p.startY + (p.targetY - p.startY) * eased;
    // 先亮后灭
    if (localT < 0.4) {
      p.g.alpha = localT / 0.4;
    } else {
      p.g.alpha = 1 - (localT - 0.4) / 0.6;
    }
    p.g.scale.set(1 + eased * 0.5);
    if (localT < 0.98) allDone = false;
  }
  return allDone;
}

// ── 漂浮粒子系统 (Phase 1.5 致谢背景) ──

export interface FloatingParticleOptions {
  count: number;
  colors: string[];
  sizeMin: number;
  sizeMax: number;
  speedMin: number;   // 漂浮周期 (秒)
  speedMax: number;
  ampMin: number;     // 振幅 (px)
  ampMax: number;
}

/** 在整个 canvas 范围内散布漂浮粒子，用于致谢画面背景 */
export function createFloatingParticles(
  app: PIXI.Application,
  canvas: { w: number; h: number },
  opts: FloatingParticleOptions,
): Particle[] {
  const particles: Particle[] = [];
  const margin = 40;

  for (let i = 0; i < opts.count; i++) {
    const g = new PIXI.Graphics();
    const colorStr = opts.colors[Math.floor(Math.random() * opts.colors.length)];
    const color = parseInt(colorStr.replace("#", ""), 16);
    const radius = opts.sizeMin + Math.random() * (opts.sizeMax - opts.sizeMin);

    // 外晕 (大圈低透明度)
    g.beginFill(color, 0.15);
    g.drawCircle(0, 0, radius * 3);
    g.endFill();
    // 核心 (小圈高透明度)
    g.beginFill(color, 0.8);
    g.drawCircle(0, 0, radius);
    g.endFill();

    const x = margin + Math.random() * (canvas.w - margin * 2);
    const y = margin + Math.random() * (canvas.h - margin * 2);
    g.x = x;
    g.y = y;
    g.alpha = 0.4 + Math.random() * 0.45;

    app.stage.addChild(g);

    const speedRad = (2 * Math.PI) / (opts.speedMin + Math.random() * (opts.speedMax - opts.speedMin));

    particles.push({
      g,
      startX: x,
      startY: y,
      targetX: x,
      targetY: y,
      delay: Math.random() * 0.6,
      color,
      radius,
      baseX: x,
      baseY: y,
      floatPhase: Math.random() * Math.PI * 2,
      floatSpeed: speedRad,
      floatAmpX: opts.ampMin + Math.random() * (opts.ampMax - opts.ampMin),
      floatAmpY: opts.ampMin + Math.random() * (opts.ampMax - opts.ampMin),
    });
  }
  return particles;
}

/** 每帧更新漂浮粒子位置（正弦漂移 + alpha 脉动） */
export function updateFloatingParticles(particles: Particle[], deltaMs: number): void {
  const dt = deltaMs / 1000;
  for (const p of particles) {
    if (p.floatPhase === undefined) continue;
    p.floatPhase += p.floatSpeed! * dt;
    // X/Y 用不同频率，避免走圆形轨道，更自然
    p.g.x = p.baseX! + Math.sin(p.floatPhase) * p.floatAmpX!;
    p.g.y = p.baseY! + Math.cos(p.floatPhase * 0.7) * p.floatAmpY!;
    // 缓慢 alpha 脉动
    p.g.alpha = 0.4 + 0.35 * (0.5 + 0.5 * Math.sin(p.floatPhase * 1.3));
  }
}

/** 将漂浮粒子切换到收敛模式：锁定当前位置为起点，目标指向角色位置 */
export function startConverge(
  particles: Particle[],
  targetX: number,
  targetY: number,
): void {
  for (const p of particles) {
    p.startX = p.g.x;
    p.startY = p.g.y;
    p.targetX = targetX + (Math.random() - 0.5) * 40;
    p.targetY = targetY + (Math.random() - 0.5) * 40;
    p.delay = Math.random() * 0.4;
  }
}

// ── 模型苏醒动画 (Phase 3) ──

export interface WakeUpParams {
  modelAlpha: { set(v: number): void };
  core: {
    set(id: string, v: number): void;
  };
  /** 设置表情, 返回 promise (可忽略) */
  setExpression: (name: string) => void;
}

/**
 * 在 requestAnimationFrame 中运行动画参数。
 * 调用者应在组件卸载/跳过时 cancelAnimationFrame(rafRef.current)。
 */
export function startWakeUpAnimation(
  params: WakeUpParams,
  duration: number,
  rafRef: { current: number },
  onComplete: () => void,
): void {
  const startTime = performance.now();

  // 初始状态
  params.setExpression("exp_03");
  params.core.set("ParamEyeLOpen", 0);
  params.core.set("ParamEyeROpen", 0);
  params.core.set("ParamBodyAngleY", -15);
  params.core.set("ParamAuraOn", 0);
  params.core.set("ParamAura", 0);
  params.modelAlpha.set(0);

  const tick = () => {
    const elapsed = performance.now() - startTime;
    const t = Math.max(0, Math.min(1, elapsed / duration));

    // ── Alpha: 整个阶段 easeInOut ──
    const alphaT = Math.min(1, t / 0.8);
    params.modelAlpha.set(easeInOut(alphaT));

    // ── 身体回正: t=0.3..0.7 easeOut ──
    const bodyT = Math.max(0, Math.min(1, (t - 0.3) / 0.4));
    const bodyVal = -15 * (1 - easeOut(bodyT));
    params.core.set("ParamBodyAngleY", bodyVal);

    // ── 睁眼: t=0.6..0.85 easeOut ──
    const eyeT = Math.max(0, Math.min(1, (t - 0.6) / 0.25));
    const eyeVal = easeOut(eyeT);
    params.core.set("ParamEyeLOpen", eyeVal);
    params.core.set("ParamEyeROpen", eyeVal);

    // ── 光环脉冲: t=0.7..1.0 ──
    if (t >= 0.7) {
      params.core.set("ParamAuraOn", 1);
      const auraT = (t - 0.7) / 0.3;
      if (auraT < 0.3) {
        // 快速升起
        params.core.set("ParamAura", 30 * (auraT / 0.3));
      } else {
        // 缓慢回落
        params.core.set("ParamAura", 30 * (1 - (auraT - 0.3) / 0.7));
      }
    }

    // ── 眼神光: t=0.65..0.85 闪烁一次 ──
    if (t >= 0.65 && t < 0.75) {
      params.core.set("ParamEyeEffect", (t - 0.65) / 0.1);
    } else if (t >= 0.75 && t < 0.85) {
      params.core.set("ParamEyeEffect", 1 - (t - 0.75) / 0.1);
    } else if (t >= 0.85) {
      params.core.set("ParamEyeEffect", 0);
    }

    if (t < 1) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      // 确保最终状态
      params.modelAlpha.set(1);
      params.core.set("ParamBodyAngleY", 0);
      params.core.set("ParamEyeLOpen", 1);
      params.core.set("ParamEyeROpen", 1);
      params.core.set("ParamAura", 0);
      params.core.set("ParamEyeEffect", 0);
      onComplete();
    }
  };

  rafRef.current = requestAnimationFrame(tick);
}

// ── 问候 (Phase 4) ──

export async function playGreeting(
  model: any,
  expressionName: string,
  motionGroup: string,
  motionIndex: number,
): Promise<void> {
  try {
    await model.expression(expressionName);
  } catch {
    // 表情切换失败不影响后续
  }
  try {
    await model.motion(motionGroup, motionIndex, 3); // FORCE priority
  } catch {
    // motion 失败不影响
  }
}

export interface TtsCleanup {
  (): void;
  _duration: number; // 音频实际播放时长 ms，供 Phase 4 收尾计时使用
}

/** 调用 Tauri edge_tts 命令播放语音, 返回清理函数 */
export async function playGreetingTts(
  text: string,
  volume: number,
): Promise<TtsCleanup | null> {
  const t0 = Date.now();
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const base64: string = await invoke("edge_tts", { text });
    console.log("[startup] TTS invoke done", Date.now() - t0, "ms, len:", base64.length);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    const buffer = await ctx.decodeAudioData(bytes.buffer);
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, volume / 100));
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
    console.log("[startup] TTS playing, volume:", volume, "duration:", buffer.duration);

    const cleanup = () => {
      try { source.stop(); } catch { /* 已停止 */ }
      ctx.close().catch(() => {});
    };
    (cleanup as TtsCleanup)._duration = Math.ceil(buffer.duration * 1000) + 300;
    return cleanup as TtsCleanup;
  } catch (e) {
    console.warn("[startup] TTS greeting failed:", e);
    return null;
  }
}
