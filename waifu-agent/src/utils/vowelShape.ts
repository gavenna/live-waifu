import { pinyin } from "pinyin-pro";

// ── Vowel frame ───────────────────────────────────

export interface VowelFrame {
  /** Overall mouth openness 0-1 */
  openness: number;
  /** 5 Japanese-style vowel parameters 0-1 */
  a: number;  // ParamA — wide open
  i: number;  // ParamI — lips stretched sideways
  u: number;  // ParamU — lips pursed forward
  e: number;  // ParamE — medium open, corners slightly spread
  o: number;  // ParamO — rounded, medium-small opening
}

// ── Final (韵母) → vowel mix mapping ──────────────
// Each Chinese final maps to a blend of the 5 Japanese vowel shapes.
// Openness is derived from the vowel mix: a-dominant → most open, u-dominant → most closed.

const FINAL_MAP: Record<string, VowelFrame> = {
  a:  { a:1,   i:0,   u:0,   e:0,   o:0,   openness:0.9 },
  o:  { a:0,   i:0,   u:0,   e:0,   o:1,   openness:0.6 },
  e:  { a:0,   i:0,   u:0,   e:1,   o:0,   openness:0.55 },
  i:  { a:0,   i:1,   u:0,   e:0,   o:0,   openness:0.35 },
  u:  { a:0,   i:0,   u:1,   e:0,   o:0,   openness:0.25 },
  ü:  { a:0,   i:0.4, u:0.6, e:0,   o:0,   openness:0.3 },
  ai: { a:0.6, i:0.4, u:0,   e:0,   o:0,   openness:0.6 },
  ei: { a:0,   i:0.4, u:0,   e:0.6, o:0,   openness:0.5 },
  ao: { a:0.5, i:0,   u:0,   e:0,   o:0.5, openness:0.75 },
  ou: { a:0,   i:0,   u:0.4, e:0,   o:0.6, openness:0.5 },
  ia: { a:0.7, i:0.3, u:0,   e:0,   o:0,   openness:0.7 },
  ie: { a:0,   i:0.3, u:0,   e:0.7, o:0,   openness:0.5 },
  ua: { a:0.7, i:0,   u:0.3, e:0,   o:0,   openness:0.7 },
  uo: { a:0,   i:0,   u:0.3, e:0,   o:0.7, openness:0.55 },
  üe: { a:0,   i:0.2, u:0.2, e:0.6, o:0,   openness:0.45 },
  iao:{ a:0.4, i:0.2, u:0,   e:0,   o:0.4, openness:0.6 },
  iou: { a:0,  i:0.3, u:0.3, e:0,   o:0.4, openness:0.45 },
  iu: { a:0,  i:0.3, u:0.3, e:0,   o:0.4, openness:0.45 },
  uai:{ a:0.5, i:0.3, u:0.2, e:0,   o:0,   openness:0.55 },
  uei: { a:0,  i:0.3, u:0.2, e:0.5, o:0,   openness:0.5 },
  ui: { a:0,  i:0.3, u:0.2, e:0.5, o:0,   openness:0.5 },
  an: { a:0.7, i:0,   u:0,   e:0.3, o:0,   openness:0.7 },
  en: { a:0,   i:0,   u:0,   e:0.7, o:0,   openness:0.5 },
  in: { a:0,   i:0.6, u:0,   e:0.4, o:0,   openness:0.4 },
  ün: { a:0,   i:0.3, u:0.3, e:0.4, o:0,   openness:0.4 },
  ang:{ a:0.7, i:0,   u:0,   e:0,   o:0.3, openness:0.75 },
  eng:{ a:0,   i:0,   u:0,   e:0.7, o:0.3, openness:0.55 },
  ing:{ a:0,   i:0.5, u:0,   e:0.3, o:0.2, openness:0.45 },
  ong:{ a:0,   i:0,   u:0.5, e:0,   o:0.5, openness:0.5 },
  ian:{ a:0.5, i:0.2, u:0,   e:0.3, o:0,   openness:0.6 },
  uan:{ a:0.5, i:0,   u:0.3, e:0.2, o:0,   openness:0.6 },
  üan:{ a:0.3, i:0.2, u:0.2, e:0.3, o:0,   openness:0.5 },
  iang:{a:0.5, i:0.2, u:0,   e:0,   o:0.3, openness:0.65 },
  uang:{a:0.4, i:0,   u:0.3, e:0,   o:0.3, openness:0.6 },
  iong:{a:0,   i:0.2, u:0.3, e:0,   o:0.5, openness:0.5 },
};

// ── Pinyin extraction helpers ──────────────────────

/// Get the final (韵母) from a pinyin syllable string.
/// e.g. "xiao" → "iao", "da" → "a", "zhi" → "i", "shi" → "i"
function extractFinal(py: string): string {
  // Remove tone number/mark
  const clean = py.replace(/[0-5]/g, "");
  // zh/ch/sh + i → i (zhi/chi/shi/ri/zi/ci/si)
  if (/^(zh|ch|sh|r|z|c|s)i$/.test(clean)) return "i";
  // Remove initial consonant(s)
  const initial = "b|p|m|f|d|t|n|l|g|k|h|j|q|x|zh|ch|sh|r|z|c|s|y|w";
  const re = new RegExp(`^(?:${initial})?(.+)$`);
  const m = clean.match(re);
  const final = m?.[1] || clean;
  // Normalize: "iu" = "iou", "ui" = "uei", "un" = "uen" (but we keep separate mappings)
  return final || clean;
}

/// Get pinyin finals for a Chinese text string.
/// Returns an array matching each character position.
/// Non-Chinese characters (punctuation, numbers, etc.) get null.
function getFinals(text: string): (string | null)[] {
  try {
    const py = pinyin(text, { type: "array", toneType: "none" });
    return py.map((s: string) => {
      // s is pinyin with tone number, e.g. "dao4" or multi-char pinyin
      const clean = String(s).replace(/[0-5]/g, "").trim().toLowerCase();
      if (!clean || clean === "undefined" || /^[a-z]+$/.test(clean) === false) return null;
      return extractFinal(clean);
    });
  } catch {
    return Array.from(text).map(() => null);
  }
}

// ── Frame generation ───────────────────────────────

/// Mapping result: character → final → vowel shape
export interface CharMapping {
  char: string;
  final: string | null;
  shape: VowelFrame | null;
}

/// Generate vowel frames for a text, aligned to the energy grid.
/// Returns frames + per-character mapping for debug logging.
export function buildVowelFrames(text: string, frameCount: number): { frames: VowelFrame[]; mapping: CharMapping[] } {
  const chars = Array.from(text);
  const finals = getFinals(text);

  const frames: VowelFrame[] = [];
  const framesPerChar = frameCount / Math.max(chars.length, 1);

  const neutral: VowelFrame = { a: 0, i: 0, u: 0, e: 0, o: 0, openness: 0 };
  const mapping: CharMapping[] = [];

  let lastShape: VowelFrame = neutral;

  for (let i = 0; i < chars.length; i++) {
    const final = finals[i];
    const shape = (final && FINAL_MAP[final]) ? { ...FINAL_MAP[final] } : null;
    if (final && !shape) {
      // Unknown final — log and treat as neutral
      // Vowel warning suppressed: unknown pinyin finals for non-Chinese chars are expected
    }
    mapping.push({ char: chars[i], final, shape });
  }

  for (let i = 0; i < frameCount; i++) {
    const charIdx = Math.min(Math.floor(i / framesPerChar), chars.length - 1);
    const final = finals[charIdx];

    if (final && FINAL_MAP[final]) {
      lastShape = { ...FINAL_MAP[final] };
    }

    frames.push({ ...lastShape });
  }

  return { frames, mapping };
}

// ── Fallback: vowel rotation (no pinyin data) ──────

const ROTATION: VowelFrame[] = [
  { a:1,   i:0,   u:0,   e:0,   o:0,   openness:0.9  }, // a — wide open
  { a:0.4, i:0.6, u:0,   e:0,   o:0,   openness:0.55 }, // i — stretched
  { a:0,   i:0,   u:0,   e:0.7, o:0.3, openness:0.5  }, // e — medium
  { a:0,   i:0,   u:0.3, e:0,   o:0.7, openness:0.5  }, // o — rounded
  { a:0.3, i:0,   u:0.7, e:0,   o:0,   openness:0.4  }, // u — pursed
];

/// Generate vowel frames using a rotating vowel pattern.
/// Used as fallback when pinyin parsing fails.
export function buildVowelFramesRotation(frameCount: number): { frames: VowelFrame[] } {
  const frames: VowelFrame[] = [];
  for (let i = 0; i < frameCount; i++) {
    // Progress through rotation, spending ~3 frames per vowel
    const idx = Math.floor(i / 3) % ROTATION.length;
    const next = (idx + 1) % ROTATION.length;
    const t = ((i % 3) / 3); // blend factor

    const cur = ROTATION[idx];
    const nxt = ROTATION[next];

    // Blend between current and next vowel
    frames.push({
      a: cur.a + (nxt.a - cur.a) * t,
      i: cur.i + (nxt.i - cur.i) * t,
      u: cur.u + (nxt.u - cur.u) * t,
      e: cur.e + (nxt.e - cur.e) * t,
      o: cur.o + (nxt.o - cur.o) * t,
      openness: cur.openness + (nxt.openness - cur.openness) * t,
    });
  }
  return { frames };
}
