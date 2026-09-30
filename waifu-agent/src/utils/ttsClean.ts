// TTS text cleaning — mirrors Rust clean_tts_text in lib.rs

const EMOJI_RE = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{FE00}-\u{FE0F}\u{200D}]/gu;
// ASCII punctuation: !"#$%&'()*+,-./ :;<=>?@ [\]^_` {|}~
// Using hex escapes to avoid bracket escaping issues in character class
const ASCII_PUNCT_RE = /[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/g;

/** Strip emoji, parenthesized/bracket content, and ASCII punctuation — mirrors Rust clean_tts_text */
export function cleanTtsText(text: string): string {
  // Strip <think>...</think> blocks (MiniMax M3 thinking mode, defense-in-depth)
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  // Remove parenthesized content (both half- and full-width)
  cleaned = cleaned.replace(/\([^)]*\)/g, "");
  cleaned = cleaned.replace(/（[^）]*）/g, "");
  // Remove bracket-wrapped stage directions (both half- and full-width) — e.g. [teasing] [sigh]
  cleaned = cleaned.replace(/\[[^\]]*\]/g, "");
  cleaned = cleaned.replace(/【[^】]*】/g, "");
  // Remove emoji
  cleaned = cleaned.replace(EMOJI_RE, "");
  // Remove ASCII punctuation
  cleaned = cleaned.replace(ASCII_PUNCT_RE, "");
  return cleaned.slice(0, 500);
}
