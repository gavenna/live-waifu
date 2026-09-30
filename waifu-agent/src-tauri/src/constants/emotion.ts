// ── Emotion types ─────────────────────────────────

export const EMOTIONS = [
  "happy", "sad", "angry", "surprised",
  "neutral", "shy", "loving",
] as const;

export type Emotion = typeof EMOTIONS[number];

// ── Emotion → Expression mapping ──────────────────
// Maps each emotion to the Live2D expression name.
// Mao model: exp_01=neutral, exp_02=smile, exp_04=surprise,
//            exp_05=sad, exp_06=shy, exp_07=dazed/loving, exp_08=angry

export const EMOTION_EXPRESSION: Record<Emotion, string> = {
  happy:     "exp_02",
  sad:       "exp_05",
  angry:     "exp_08",
  surprised: "exp_04",
  neutral:   "exp_01",
  shy:       "exp_06",
  loving:    "exp_07",
};

// ── Emotion → Motion bias ─────────────────────────

export interface MotionBias {
  /** Multiplier for motion frequency (1.0 = normal) */
  freqMul: number;
  /** Probability boost for special/magic motions (0-1 added to base chance) */
  specialBoost: number;
}

export const EMOTION_MOTION_BIAS: Record<Emotion, MotionBias> = {
  happy:     { freqMul: 1.3,  specialBoost: 0.2 },
  sad:       { freqMul: 0.6,  specialBoost: 0 },
  angry:     { freqMul: 1.2,  specialBoost: 0 },
  surprised: { freqMul: 1.1,  specialBoost: 0.15 },
  neutral:   { freqMul: 1.0,  specialBoost: 0 },
  shy:       { freqMul: 0.8,  specialBoost: 0 },
  loving:    { freqMul: 0.9,  specialBoost: 0.1 },
};

// ── Pattern ───────────────────────────────────────

const TAG_STR = EMOTIONS.join("|");
export const EMOTION_TAG_RE = new RegExp("^\[(" + TAG_STR + ")\]");

// ── Parse emotion tag from text start ──────────────

export function parseEmotionTag(text: string): { emotion: Emotion | null; cleaned: string } {
  const m = text.match(EMOTION_TAG_RE);
  if (m) {
    return { emotion: m[1] as Emotion, cleaned: text.slice(m[0].length) };
  }
  return { emotion: null, cleaned: text };
}

// ── Keyword fallback ───────────────────────────────

const KEYWORDS: Record<Emotion, RegExp[]> = {
  happy:     [/哈哈|嘿嘿|嘻嘻|开心|太好[了啦]|笑死|ww+w*|😂|😊|😆|棒|cool|nice|好耶/],
  sad:       [/唉[~～]?|难过|伤心|可惜|遗憾|哭[了泣]|😢|😭|抱抱|心疼/],
  angry:     [/哼[!！]?|生气|讨厌|烦[死了人]|可恶|过分|😠|😡|滚|闭嘴/],
  surprised: [/哇[!！]?|啊[!！]?|天[哪呐]|不会吧|真的假的|什么[!！?？]|😲|😮|震惊/],
  shy:       [/诶嘿|害羞|不好意思|脸红|\/\/\/|😳|👉👈|扭捏/],
  loving:    [/爱你|喜欢|❤|💕|mua|亲亲|抱抱|贴贴/],
  neutral:   [], // fallback default
};

export function detectEmotionFallback(text: string): Emotion {
  const scores: Record<string, number> = {};
  for (const [emotion, patterns] of Object.entries(KEYWORDS)) {
    if (patterns.length === 0) continue;
    scores[emotion] = patterns.reduce((sum, re) => sum + (re.test(text) ? 1 : 0), 0);
  }
  let best: Emotion = "neutral";
  let bestScore = 0;
  for (const [emotion, score] of Object.entries(scores)) {
    if (score > bestScore) { bestScore = score; best = emotion as Emotion; }
  }
  return best;
}
