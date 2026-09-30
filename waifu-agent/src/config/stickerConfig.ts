// ── Sticker System ─────────────────────────────────
// 16 chibi cat-girl reaction stickers.
// Each prompt MUST produce a visually distinct image.
// Key differentiators: composition, angle, art style, color palette.

import { Emotion } from "../constants/emotion";

export type StickerScene = "daily" | "intimate" | "meme";
export type StickerKey =
  | "daily-smug" | "daily-eyeroll" | "daily-confused" | "daily-sploot"
  | "daily-nom" | "daily-chill" | "daily-musing"
  | "intimate-flustered" | "intimate-hug" | "intimate-jealous"
  | "intimate-bedhead" | "intimate-pat" | "intimate-worry"
  | "meme-business" | "meme-pet" | "meme-surrender" | "meme-thonk";

export interface StickerDef {
  key: StickerKey; scene: StickerScene; emotion: Emotion;
  chineseText: string; englishPrompt: string; triggerDescription: string;
}

export const STICKER_SCENE_KEYWORDS: Record<StickerScene, RegExp> = {
  meme: /抽象|整活|笑死|乐了|绷不住|难绷|麻了|蚌埠|lol|lmao|wtf/i,
  intimate: /亲爱的|宝贝|老公|老婆|想你了|爱你|抱抱|亲亲|喜欢|想你|dear|baby|love|honey|sweet|kiss|hug/i,
  daily: /$^/,
};
export const CARE_KEYWORDS = /(熬[夜穿了]|通宵|不睡|睡吧|快点睡|早点睡|快去睡|担心|累了|困了|休息|身体|着凉|感冒|生病|吃药|难受|睡觉|太晚|深夜)/i;

const STICKER_LIST: StickerDef[] = [

  // ═══ daily ═══

  {
    key: "daily-smug", scene: "daily", emotion: "happy",
    chineseText: "拿捏了😼",
    englishPrompt: "Extreme face close-up filling entire frame, cat-girl smirking down at viewer from above, one raised eyebrow, half-lidded confident eyes, sharp manga lineart on white background, high contrast black and white with single accent color, intense perspective from below",
    triggerDescription: "得意/调侃",
  },
  {
    key: "daily-eyeroll", scene: "daily", emotion: "angry",
    chineseText: "你开心就好🙄",
    englishPrompt: "Side profile silhouette against bright window, cat-girl rolling eyes dramatically, flat unimpressed expression, cool blue-grey tones, minimalist vector illustration style, strong rim lighting from window, clean geometric shapes",
    triggerDescription: "无语/敷衍",
  },
  {
    key: "daily-confused", scene: "daily", emotion: "surprised",
    chineseText: "啊？你说啥🤨",
    englishPrompt: "Dutch angle tilted 20 degrees, cat-girl head extremely tilted with one ear perked up, wide circular eyes with tiny pupils, giant question mark floating, ben-day dots pop art style, saturated primary colors, Roy Lichtenstein inspired",
    triggerDescription: "困惑/意想不到",
  },
  {
    key: "daily-sploot", scene: "daily", emotion: "sad",
    chineseText: "我随便🌿",
    englishPrompt: "Bird's eye view straight down, cat-girl face-down on floor like a deflated balloon, limbs sprawled in all directions, only back of head and cat ears visible, tail completely flat, warm wooden floor texture, long afternoon shadows, quiet defeated atmosphere",
    triggerDescription: "累了/摆烂",
  },
  {
    key: "daily-nom", scene: "daily", emotion: "angry",
    chineseText: "咬你哦💢",
    englishPrompt: "Dynamic action frame, cat-girl lunging toward camera mouth wide showing fangs, motion blur and speed lines radiating outward, impact-frame shonen manga composition, bright orange action background, dramatic foreshortening of outstretched hands",
    triggerDescription: "轻微不满/调侃反驳",
  },
  {
    key: "daily-chill", scene: "daily", emotion: "neutral",
    chineseText: "嗯哼~🎵",
    englishPrompt: "Rooftop at golden hour, cat-girl sitting on ledge from behind, legs dangling, earbuds in, gazing at distant city skyline, warm orange-pink gradient sky, soft watercolor style, peaceful atmosphere, wide landscape composition showing her small against the view",
    triggerDescription: "放松闲聊",
  },
  {
    key: "daily-musing", scene: "daily", emotion: "neutral",
    chineseText: "让我想想🤔",
    englishPrompt: "Cat-girl at cozy cafe window seat, chin resting on hand, looking out at rainy street through glass, warm indoor lamp glow contrasting with cool grey rain outside, soft focus dreamy atmosphere, cinematic composition with reflection layers, muted color palette, contemplative slice-of-life anime style",
    triggerDescription: "思考/日常聊天",
  },

  // ═══ intimate ═══

  {
    key: "intimate-flustered", scene: "intimate", emotion: "shy",
    chineseText: "犯规！！！😳💕",
    englishPrompt: "Cat-girl face half-hidden behind both hands, only one wide sparkling eye peeking through fingers, face burning bright red, ears flattened and trembling, floating pink hearts and sparkles, soft-focus lens, pastel pink and cream colors, shojo manga romance panel style",
    triggerDescription: "害羞/被撩",
  },
  {
    key: "intimate-hug", scene: "intimate", emotion: "loving",
    chineseText: "抱抱🥺🤲",
    englishPrompt: "First-person POV, cat-girl arms reaching directly toward viewer filling the frame, tear-glistening puppy-dog eyes looking up, soft golden sunlight rim-lighting hair, shallow depth of field, reaching-hands composition, emotional anime film still quality, warm golden tones",
    triggerDescription: "想要拥抱",
  },
  {
    key: "intimate-jealous", scene: "intimate", emotion: "angry",
    chineseText: "她谁啊👀💢",
    englishPrompt: "Split-screen composition: left half sweet smiling face, right half dark shadowed face with glowing eyes, cat tail puffed up like bottle brush, dramatic chiaroscuro lighting, yandere horror-comedy manga style, half cute half threatening",
    triggerDescription: "吃醋/嫉妒",
  },
  {
    key: "intimate-bedhead", scene: "intimate", emotion: "neutral",
    chineseText: "唔…早🥱",
    englishPrompt: "Extreme messy hair close-up, cat-girl mid-yawn in rumpled bed, silver hair complete chaos pointing everywhere, one pajama strap fallen, sleepy half-closed eyes, soft diffused morning light through sheer curtains, warm muted cream tones, intimate slice-of-life close-up",
    triggerDescription: "刚醒/深夜",
  },
  {
    key: "intimate-pat", scene: "intimate", emotion: "loving",
    chineseText: "乖啦🫳✨",
    englishPrompt: "Cat-girl hand reaching down gently toward viewer (off-frame below), soft head-pat gesture mid-motion, warm maternal smile with gentle blush, sparkles around hand, cozy warm blanket and lamp in soft-focus background, golden magical lighting, tender atmosphere",
    triggerDescription: "安慰/关心",
  },
  {
    key: "intimate-worry", scene: "intimate", emotion: "sad",
    chineseText: "担心你啦🥺",
    englishPrompt: "Cat-girl sitting on floor against wall in dark room, clutching glowing phone to chest, screen light illuminating worried face from below, big glistening eyes reflecting blue screen light, eyebrows furrowed, late night atmosphere, single lamp casting long shadows, cinematic noir lighting, emotionally heavy drama still",
    triggerDescription: "担心/关心",
  },

  // ═══ meme ═══

  {
    key: "meme-business", scene: "meme", emotion: "happy",
    chineseText: "这个项目我投了💼",
    englishPrompt: "Cat-girl in comically oversized business suit, standing on conference table like a CEO, pointing forward dramatically, money raining from above, low-angle heroic perspective, absurd corporate stock photo parody, saturated colors, over-the-top motivational poster energy, lens flare",
    triggerDescription: "工作/正经话题",
  },
  {
    key: "meme-pet", scene: "meme", emotion: "neutral",
    chineseText: "摸鱼喵~🐟",
    englishPrompt: "Cat-girl completely melted into literal puddle shape on office desk, only cat ears and tail visible above blob, keyboard pushed aside, fish plushie floating in puddle, coffee cup tipped over, coworker's concerned silhouette in blurred background doorway, surreal cartoon physics, fluorescent office lighting",
    triggerDescription: "摸鱼/摆烂",
  },
  {
    key: "meme-surrender", scene: "meme", emotion: "surprised",
    chineseText: "你赢了👏🤡",
    englishPrompt: "Cat-girl doing dramatic theatrical death scene, hand on forehead leaning backward at impossible angle, rose petals falling, single spotlight from above like stage, X_X eyes with tongue sticking out, Shakespearean tragedy parody, dramatic theater lighting, over-the-top theatrical pose",
    triggerDescription: "被说服/认输",
  },
  {
    key: "meme-thonk", scene: "meme", emotion: "angry",
    chineseText: "CPU 烧了🔥",
    englishPrompt: "Cat-girl with literal thinking emoji sphere for head and cat ears attached, gears and springs popping out top, eyes replaced with spinning loading circles, steam blasting from ears, surrounded by floating math equations and error messages, surreal internet meme collage, glitch effects and VHS distortion",
    triggerDescription: "烧脑/复杂话题",
  },
];

export { STICKER_LIST };
export const STICKER_MAP: Record<string, StickerDef> = Object.fromEntries(STICKER_LIST.map(s => [s.key, s]));

export const detectScene = (userText: string): StickerScene => {
  if (STICKER_SCENE_KEYWORDS.meme.test(userText)) return "meme";
  if (STICKER_SCENE_KEYWORDS.intimate.test(userText)) return "intimate";
  return "daily";
};

export const selectSticker = (emotion: Emotion, userText: string, aiResponse?: string): StickerDef | null => {
  if (CARE_KEYWORDS.test(userText) || (aiResponse && CARE_KEYWORDS.test(aiResponse))) {
    if (emotion === "loving") return STICKER_MAP["intimate-pat"] ?? null;
    if (emotion === "sad") return STICKER_MAP["intimate-worry"] ?? null;
    return STICKER_MAP["intimate-pat"] ?? null;
  }
  const scene = detectScene(userText);
  const exact = STICKER_LIST.find(s => s.scene === scene && s.emotion === emotion);
  if (exact) return exact;
  const matches = STICKER_LIST.filter(s => s.emotion === emotion);
  if (matches.length > 0) {
    let hash = 0;
    for (let i = 0; i < userText.length; i++) { hash = ((hash << 5) - hash) + userText.charCodeAt(i); hash |= 0; }
    return matches[Math.abs(hash) % matches.length];
  }
  return null;
};

export const getStickerPrompt = (key: string): string => STICKER_MAP[key]?.englishPrompt ?? "";

// ── Image prompt extraction ──────────────────────
// Priority 1: LLM-authored [img: ...] tag (full English scene prompt)
// Priority 2: buildActionPrompt() from parenthetical action
// Priority 3: sticker key lookup (existing 16 definitions)
// Priority 4: null (no sticker)

export function extractImagePrompt(response: string): string | null {
  const match = response.match(/\[img:\s*([^\]]+)\]/);
  if (!match || match[1].trim().length < 10) return null;
  return match[1].trim().slice(0, 300);
}

export function buildActionPrompt(response: string): string | null {
  // Fallback only — should rarely be used once LLM outputs [img:] consistently
  const match = response.match(/（([^）]+)）/);
  if (!match || match[1].length < 2) return null;
  return `Chibi anime cat-girl, expressive reaction, sticker art, vibrant colors`;
}
