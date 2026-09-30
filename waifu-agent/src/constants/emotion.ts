// ── Emotion types ─────────────────────────────────

export const EMOTIONS = [
  "happy", "sad", "angry", "surprised",
  "neutral", "shy", "loving",
] as const;

export type Emotion = typeof EMOTIONS[number];

// ── Emotion → Expression mapping ──────────────────
// Default mapping by index in expressionNames[] (Mao model order).
// Per-model override via persona.emotionExpression.

export const EMOTION_EXPRESSION: Record<Emotion, string> = {
  happy:     "exp_02",
  sad:       "exp_05",
  angry:     "exp_08",
  surprised: "exp_04",
  neutral:   "exp_01",
  shy:       "exp_06",
  loving:    "exp_07",
};

/** Resolve the expression name for an emotion given a persona's expression config.
 *  Uses per-model emotionExpression mapping if present; falls back to EMOTION_EXPRESSION. */
export function getEmotionExpression(
  emotion: Emotion,
  expressionNames: string[],
  emotionExpression?: Record<string, string>,
): string {
  if (emotionExpression?.[emotion]) {
    return emotionExpression[emotion];
  }
  // Fallback: use Mao-style index map, clamped to available expressions
  const idx = EMOTION_EXPRESSION_INDEX[emotion];
  return expressionNames[Math.min(idx, expressionNames.length - 1)];
}

/** Mao-model index for each emotion in expressionNames[] */
export const EMOTION_EXPRESSION_INDEX: Record<Emotion, number> = {
  neutral:   0,
  happy:     1,
  surprised: 3,
  sad:       4,
  shy:       5,
  loving:    6,
  angry:     7,
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
export const EMOTION_TAG_RE = new RegExp(`^\\[(${TAG_STR})\\]`);
/** 匹配文本中任意位置的情感标签（用于 TTS 前清理） */
const ANY_EMOTION_TAG_RE = new RegExp(`\\[(${TAG_STR})\\]\\s*`, "g");

// ── Parse emotion tag from text start ──────────────

export function parseEmotionTag(text: string): { emotion: Emotion | null; cleaned: string } {
  const m = text.match(EMOTION_TAG_RE);
  if (m) {
    return { emotion: m[1] as Emotion, cleaned: text.slice(m[0].length) };
  }
  return { emotion: null, cleaned: text };
}

/** 移除文本中所有 [emotion] 标签（TTS 前用，避免把标签念出来） */
export function stripAllEmotionTags(text: string): string {
  return text.replace(ANY_EMOTION_TAG_RE, "");
}

// ── Keyword fallback ───────────────────────────────

const KEYWORDS: Record<Emotion, RegExp[]> = {
  happy:     [/哈哈|嘿嘿|嘻嘻|开心|太好[了啦]|笑死|ww+w*|😂|😊|😆|棒|cool|nice|好耶|（笑|挑眉|抬下巴|😎|🤣/],
  sad:       [/唉[~～]?|难过|伤心|可惜|遗憾|哭[了泣]|😢|😭|心疼|（叹|垂眼|低[头眉]/],
  angry:     [/哼[!！]?|生气|讨厌|烦[死了人]|可恶|过分|😠|😡|滚|闭嘴|（瞪|鼓[着起]腮|别过脸|💢/],
  surprised: [/哇[!！]?|啊[!！?？]+|天[哪呐]|不会吧|真的假的|什么[!！?？]|😲|😮|震惊|（愣|眨眼/],
  shy:       [/诶嘿|害羞|不好意思|脸红|\/\/\/|😳|👉👈|扭捏|（别[开过]脸|泛红|耳[根尖]|😅|🥲|🙇/],
  loving:    [/爱你|喜欢|❤|💕|mua|亲亲|贴贴|（柔[和声]|温[柔暖]|托腮|靠[近过]/],
  neutral:   [],
};

export function detectEmotionFallback(text: string): Emotion {
  // First pass: check for explicit emotion tags from SOUL.md instruction
  const tagMatch = text.match(/^\[(开心|难过|生气|惊讶|害羞|撒娇|平常)\]/);
  if (tagMatch) {
    const tagMap: Record<string, Emotion> = {
      '开心': 'happy', '难过': 'sad', '生气': 'angry',
      '惊讶': 'surprised', '害羞': 'shy', '撒娇': 'loving', '平常': 'neutral',
    };
    return tagMap[tagMatch[1]] || 'neutral';
  }

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
  // Require minimum score to override neutral
  if (bestScore >= 2) return best;
  return "neutral";
}
