import { useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type VowelFrame, buildVowelFrames, buildVowelFramesRotation } from "../utils/vowelShape";
import { cleanTtsText } from "../utils/ttsClean";
import { log } from "../utils/logger";

let audioCtx: AudioContext | null = null;
async function getCtx(): Promise<AudioContext> {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  return audioCtx;
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const neural = voices.find(v => v.lang.startsWith("zh") && v.name.includes("Xiaoxiao"));
  if (neural) return neural;
  const female = voices.find(v => v.lang.startsWith("zh") && (v.name.includes("Huihui") || v.name.includes("Yaoyao")));
  if (female) return female;
  return voices.find(v => v.lang.startsWith("zh")) || voices[0];
}

async function base64ToAudioBuffer(b64: string): Promise<AudioBuffer> {
  const ctx = await getCtx();
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return ctx.decodeAudioData(bytes.buffer);
}

export function useTts() {
  const energyRef = useRef<VowelFrame[]>([]);
  const energyIdxRef = useRef(0);
  const energyTimerRef = useRef(0);
  const onEndRef = useRef<(() => void) | null>(null);
  const genRef = useRef(0);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    const s = window.speechSynthesis;
    const load = () => { voiceRef.current = pickVoice(); };
    load();
    if (!voiceRef.current) s.addEventListener("voiceschanged", load, { once: true });
    return () => {
      ++genRef.current;
      s.cancel();
    };
  }, []);

  const generateEnergy = useCallback((text: string, tgt: VowelFrame[]) => {
    const dur = Math.max(text.length * 200, 600);
    const n = Math.ceil(dur / 100);
    tgt.length = 0;

    // Try pinyin-based vowel frames first, fallback to rotation
    let vowelFrames: VowelFrame[];
    let debugMapping: Array<{ char: string; final: string | null; shape: VowelFrame | null }> | null = null;
    try {
      const result = buildVowelFrames(text, n);
      vowelFrames = result.frames;
      debugMapping = result.mapping;
    } catch {
      const result = buildVowelFramesRotation(n);
      vowelFrames = result.frames;
      log("Vowel", ` text="${text.slice(0, 40)}" → ROTATION fallback (${n} frames)`);
    }

    // ── Debug: character → final → vowel shape (outside try to prevent fallback) ──
    if (debugMapping) {
      log("Vowel", ` text="${text.slice(0, 40)}" frames=${n} dur=${dur}ms`);
      for (const m of debugMapping) {
        if (m.final && m.shape) {
          const s = m.shape;
          log("Vowel", `   "${m.char}" → 韵母=${m.final} → {a:${s.a.toFixed(1)} i:${s.i.toFixed(1)} u:${s.u.toFixed(1)} e:${s.e.toFixed(1)} o:${s.o.toFixed(1)} open:${s.openness.toFixed(1)}}`);
        } else {
          log("Vowel", `   "${m.char}" → ␣(无韵母,继承上字)`);
        }
      }
      // ── Sample 1st frame: amplitude breakdown ──
      if (n > 0 && vowelFrames.length > 0) {
        const s0 = vowelFrames[0];
        const p0 = 0;
        const wave1 = Math.sin(p0) * 0.35;
        const wave2 = Math.sin(p0 * 2.3) * 0.25;
        const amp0 = 0.12 + wave1 + wave2;
        log("Vowel", `   → frame#0 shape=(a:${s0.a.toFixed(1)} i:${s0.i.toFixed(1)} u:${s0.u.toFixed(1)} e:${s0.e.toFixed(1)} o:${s0.o.toFixed(1)})`);
        log("Vowel", `     amp=0.12(base)+sin(0)*0.35(${wave1.toFixed(2)})+sin(0)*0.25(${wave2.toFixed(2)}) → ${amp0.toFixed(2)}`);
        log("Vowel", `     → ParamA=${(s0.a*amp0).toFixed(2)} ParamI=${(s0.i*amp0*0.7).toFixed(2)} ParamU=${(s0.u*amp0*0.7).toFixed(2)} ParamE=${(s0.e*amp0*0.7).toFixed(2)} ParamO=${(s0.o*amp0*0.7).toFixed(2)}`);
      }
    }

    // Apply amplitude modulation on top of vowel shapes
    for (let i = 0; i < n; i++) {
      const p = (i / Math.max(n - 1, 1)) * Math.PI * 4;
      const wave = Math.sin(p) * 0.35 + Math.sin(p * 2.3) * 0.25;
      const noise = (Math.random() - 0.5) * 0.5;
      const amp = Math.max(0, Math.min(1, 0.12 + wave + noise));

      const shape = vowelFrames[i % vowelFrames.length];
      tgt.push({
        openness: amp * shape.openness,
        a: shape.a * amp,
        i: shape.i * amp * 0.7,
        u: shape.u * amp * 0.7,
        e: shape.e * amp * 0.7,
        o: shape.o * amp * 0.7,
      });
    }
  }, []);

  /// 从 AudioBuffer 提取真实幅度，覆盖到 text-based 韵母 frames 上
  const applyAudioEnergy = useCallback((buf: AudioBuffer, frames: VowelFrame[]) => {
    const data = buf.getChannelData(0);
    const frameMs = 100;
    const samplesPerFrame = Math.floor(buf.sampleRate * frameMs / 1000);
    if (samplesPerFrame < 1) return;

    for (let fi = 0; fi < frames.length; fi++) {
      const start = fi * samplesPerFrame;
      let sum = 0, count = 0;
      for (let s = start; s < Math.min(start + samplesPerFrame, data.length); s++) {
        sum += data[s] * data[s];
        count++;
      }
      const rms = count > 0 ? Math.sqrt(sum / count) : 0;
      const amp = Math.min(1, rms * 5); // normalize to 0~1
      const f = frames[fi];
      f.openness = amp * f.openness;
      f.a *= amp;
      f.i *= amp;
      f.u *= amp;
      f.e *= amp;
      f.o *= amp;
    }
  }, []);

  // ── Split generate & play for streaming pipeline ──

  /// Generate TTS audio buffer from text (no playback)
  const generate = useCallback(async (text: string): Promise<AudioBuffer> => {
    const clean = cleanTtsText(text);
    const b64: string = await invoke("edge_tts", { text: clean });
    return base64ToAudioBuffer(b64);
  }, []);

  /// Play a pre-generated AudioBuffer — stops previous source to prevent overlap
  const playBuffer = useCallback(async (buf: AudioBuffer, vol: number): Promise<void> => {
    // Stop previous audio to prevent overlapping (e.g. game announcer rapid-fire)
    if (activeSourceRef.current) {
      try { activeSourceRef.current.stop(); } catch (_) { /* already stopped */ }
      activeSourceRef.current = null;
    }
    const ctx = await getCtx();
    const g = ctx.createGain(); g.gain.value = vol / 100;
    const s = ctx.createBufferSource(); s.buffer = buf;
    s.connect(g); g.connect(ctx.destination);
    activeSourceRef.current = s;
    return new Promise((resolve) => {
      s.onended = () => {
        if (activeSourceRef.current === s) activeSourceRef.current = null;
        resolve();
      };
      s.start();
    });
  }, []);

  // ── Combined speak (backward compat) ─────────────

  const speak = useCallback(async (text: string, vol: number) => {
    ++genRef.current;
    window.speechSynthesis.cancel();
    if (!text) return;
    const clean = cleanTtsText(text);
    if (!clean) return;
    const gen = genRef.current;
    const done = () => { if (genRef.current === gen) onEndRef.current?.(); };

    // Primary: Edge TTS (Python edge-tts)
    try {
      const buf = await generate(clean);
      if (genRef.current !== gen) return;
      await playBuffer(buf, vol);
      if (genRef.current !== gen) return;
      done();
      return;
    } catch (e) {
      console.warn("[TTS] Edge TTS unavailable, fallback:", e);
      if (genRef.current !== gen) return;
    }

    // Fallback: Web Speech API
    const u = new SpeechSynthesisUtterance(clean);
    u.volume = vol / 100; u.rate = 1.0; u.lang = "zh-CN";
    if (voiceRef.current) u.voice = voiceRef.current;
    u.onend = done;
    u.onerror = (e) => { if (e.error !== "canceled") done(); };
    window.speechSynthesis.speak(u);
  }, [generate, playBuffer]);

  /// Play base64-encoded audio directly (used by WS relay TTS)
  const playBase64 = useCallback(async (b64: string, _durationMs: number, vol: number) => {
    if (!b64) return;
    ++genRef.current;
    const gen = genRef.current;
    try {
      const buf = await base64ToAudioBuffer(b64);
      if (genRef.current !== gen) return;
      await playBuffer(buf, vol);
    } catch (e) {
      console.warn("[TTS] playBase64 failed:", e);
    }
  }, [playBuffer]);

  const stop = useCallback(() => {
    ++genRef.current;
    window.speechSynthesis.cancel();
    onEndRef.current?.();
  }, []);

  return { energyRef, energyIdxRef, energyTimerRef, onEndRef, generateEnergy, applyAudioEnergy, generate, playBuffer, playBase64, speak, stop };
}
