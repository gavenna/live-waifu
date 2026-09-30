import { useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { parseEmotionTag, detectEmotionFallback, stripAllEmotionTags } from "../constants/emotion";

import { log, logError } from "../utils/logger";

// ── Types ─────────────────────────────────────────

interface LlmConfig {
  provider: string;
  apiUrl: string;
  apiKey: string;
  model: string;
  timeoutSecs: number;
}

export interface StreamCallbacks {
  onEmotion: (emotion: string) => void;
  onFirstToken: () => void;
  onSentenceStart: (sentenceText: string, audioBuffer: AudioBuffer) => void;
  onError: (error: string) => void;
}

// ── Sentence boundary detection ───────────────────

const SENTENCE_BOUNDARY = /([。！？；\n])/;
const COMMA_SPLIT = /(，)/;
const MAX_UNBROKEN_CHARS = 100;

/** 过滤无 TTS 价值的句子：去括号内容后 <3 个有效字符则跳过 */
function isTtsWorthy(text: string): boolean {
  const withoutParens = text.replace(/[（(][^）)]*[）)]/g, '');
  const meaningful = withoutParens.replace(/[^一-鿿\w\d]/g, '');
  return meaningful.length >= 3;
}

function splitSentences(buffer: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = [];
  let remaining = buffer;

  while (remaining.length > 0) {
    const match = SENTENCE_BOUNDARY.exec(remaining);
    if (match) {
      const idx = match.index + match[0].length;
      const sentence = remaining.slice(0, idx).trim();
      remaining = remaining.slice(idx);
      if (sentence) sentences.push(sentence);
    } else if (remaining.length > MAX_UNBROKEN_CHARS) {
      const commaMatch = COMMA_SPLIT.exec(remaining);
      if (commaMatch) {
        const idx = commaMatch.index + commaMatch[0].length;
        const sentence = remaining.slice(0, idx).trim();
        remaining = remaining.slice(idx);
        if (sentence) sentences.push(sentence);
      } else {
        sentences.push(remaining.trim());
        remaining = "";
      }
    } else {
      break;
    }
  }

  return { sentences, remainder: remaining };
}

// ── Hook ──────────────────────────────────────────

export function useChatStream(
  generateTts: (text: string) => Promise<AudioBuffer>,
  playTtsBuffer: (buf: AudioBuffer, vol: number) => Promise<void>,
) {
  const cancelledRef = useRef(false);
  const genRef = useRef(0);

  /// Start a streaming chat session. Returns the full response text when done.
  const startStream = useCallback(async (
    text: string,
    history: Array<[string, string]>,
    userMd: string,
    memoryMd: string,
    llm: LlmConfig,
    ttsVolume: number,
    cb: StreamCallbacks,
  ): Promise<string> => {
    const t0 = Date.now();
    const gen = ++genRef.current;
    cancelledRef.current = false;

    log("ChatStream", `[gen=${gen}] startStream text="${text.slice(0, 60)}..." model=${llm.model}`);

    let textBuffer = "";
    let fullText = "";
    let streaming = true;
    let firstToken = false;
    let chunkCount = 0;
    let sentenceCount = 0;
    let ttsGenCount = 0;

    const ttsQueue: string[] = [];
    interface AudioItem { text: string; buffer: AudioBuffer }
    const audioQueue: AudioItem[] = [];
    let ttsGenerating = false;
    let audioPlaying = false;

    const unlisteners: UnlistenFn[] = [];

    const isCancelled = () => cancelledRef.current || gen !== genRef.current;

    // ── All-done resolver ──
    let resolvePromise: (value: string) => void = () => {};
    const donePromise = new Promise<string>((resolve) => { resolvePromise = resolve; });

    // ── Process queue (re-entrant, 生成与播放独立并行) ──
    const processQueue = () => {
      if (isCancelled()) { log("ChatStream", `[gen=${gen}] processQueue cancelled`); return; }

      // 生成：有句子就启动，不阻塞播放
      if (ttsQueue.length > 0 && !ttsGenerating) {
        const sentence = ttsQueue.shift()!;
        ttsGenCount++;
        log("ChatStream", `[gen=${gen}] TTS generate #${ttsGenCount}: "${sentence.slice(0, 40)}..." (${sentence.length} chars)`);
        const t2 = Date.now();
        ttsGenerating = true;
        generateTts(sentence).then((buf) => {
          log("ChatStream", `[gen=${gen}] TTS generate #${ttsGenCount} done (${Date.now() - t2}ms, ${buf.duration.toFixed(1)}s audio)`);
          if (!isCancelled()) audioQueue.push({ text: sentence, buffer: buf });
          ttsGenerating = false;
          processQueue();
        }).catch((e) => {
          logError("ChatStream", `TTS generate #${ttsGenCount} failed:`, e);
          ttsGenerating = false;
          processQueue();
        });
        // 不 return — 继续检查是否可以播放
      }

      // 播放：有音频就启动，不阻塞生成
      if (audioQueue.length > 0 && !audioPlaying) {
        const item = audioQueue.shift()!;
        const t3 = Date.now();
        log("ChatStream", `[gen=${gen}] play start: "${item.text.slice(0, 40)}..." (${item.buffer.duration.toFixed(1)}s)`);
        cb.onSentenceStart(item.text, item.buffer);
        audioPlaying = true;
        playTtsBuffer(item.buffer, ttsVolume).then(() => {
          log("ChatStream", `[gen=${gen}] play done (${Date.now() - t3}ms)`);
          audioPlaying = false;
          if (!isCancelled()) processQueue();
        }).catch((e) => {
          logError("ChatStream", "TTS play failed:", e);
          audioPlaying = false;
          if (!isCancelled()) processQueue();
        });
      }

      // All queues drained and stream ended
      if (!streaming && ttsQueue.length === 0 && audioQueue.length === 0 && !ttsGenerating && !audioPlaying) {
        log("ChatStream", `[gen=${gen}] ALL DONE: ${sentenceCount} sentences, ${fullText.length} chars, ${(Date.now() - t0)}ms total`);
        for (const u of unlisteners) u();
        resolvePromise(fullText);
      }
    };

    // ── Setup event listeners ──
    try {
      let emotionDetected = false;

      const u1 = await listen<{ content: string }>("chat-chunk", (ev) => {
        if (isCancelled()) return;

        if (!firstToken) {
          firstToken = true;
          log("ChatStream", `[gen=${gen}] FIRST TOKEN: ${Date.now() - t0}ms from start`);
          cb.onFirstToken();
        }

        const chunk = ev.payload.content;
        chunkCount++;
        fullText += chunk;
        textBuffer += chunk;  // 始终累积，情绪检测不阻塞切句

        // ── Emotion tag detection (独立于切句，不阻塞流水线) ──
        if (!emotionDetected) {
          const { emotion, cleaned } = parseEmotionTag(fullText);
          if (emotion) {
            emotionDetected = true;
            log("ChatStream", `[gen=${gen}] EMOTION: ${emotion}`);
            cb.onEmotion(emotion);
            fullText = cleaned;
            textBuffer = cleaned;  // 清洗掉标签
          } else if (fullText.length > 200) {
            emotionDetected = true;
            const fallback = detectEmotionFallback(fullText);
            log("ChatStream", `[gen=${gen}] EMOTION (fallback): ${fallback}`);
            cb.onEmotion(fallback);
          }
        }

        // 始终切句 — 不依赖情绪检测状态
        const { sentences, remainder } = splitSentences(textBuffer);
        textBuffer = remainder;

        for (const s of sentences) {
          sentenceCount++;
          if (isTtsWorthy(s)) {
            const clean = stripAllEmotionTags(s).replace(/\[img:[^\]]*\]/gi, "");
            log("ChatStream", `[gen=${gen}] sentence #${sentenceCount}: "${clean.slice(0, 50)}..." (${clean.length} chars, queue=${ttsQueue.length + 1})`);
            ttsQueue.push(clean);
          } else {
            log("ChatStream", `[gen=${gen}] sentence #${sentenceCount} skip (not TTS-worthy): "${s.slice(0, 30)}..."`);
          }
        }

        // Log every 10th chunk
        if (chunkCount % 10 === 0) {
          log("ChatStream", `[gen=${gen}] chunk #${chunkCount}: ${fullText.length} chars total`);
        }

        processQueue();
      });

      const u2 = await listen("chat-done", () => {
        if (isCancelled()) return;
        log("ChatStream", `[gen=${gen}] chat-done: ${fullText.length} chars, ${chunkCount} chunks, ${sentenceCount} sentences, ${Date.now() - t0}ms`);
        streaming = false;

        // 情绪兜底：短回复没标签，全文关键词检测
        if (!emotionDetected) {
          emotionDetected = true;
          const fallback = detectEmotionFallback(fullText);
          log("ChatStream", `[gen=${gen}] EMOTION (fallback): ${fallback}`);
          cb.onEmotion(fallback);
        }

        // Flush 剩余文本（句子已在流式中切完）
        if (textBuffer.trim()) {
          sentenceCount++;
          const flush = textBuffer.trim();
          const cleanFlush = stripAllEmotionTags(flush).replace(/\[img:[^\]]*\]/gi, "");
          if (isTtsWorthy(cleanFlush)) {
            log("ChatStream", `[gen=${gen}] sentence #${sentenceCount} (flush): "${cleanFlush.slice(0, 50)}..."`);
            ttsQueue.push(cleanFlush);
          } else {
            log("ChatStream", `[gen=${gen}] sentence #${sentenceCount} (flush) skip: "${flush.slice(0, 30)}..."`);
          }
          textBuffer = "";
        }

        processQueue();
      });

      const u3 = await listen<{ error: string }>("chat-error", (ev) => {
        log("ChatStream", `[gen=${gen}] chat-error: ${ev.payload.error}`);
        if (isCancelled()) return;
        streaming = false;
        for (const u of unlisteners) u();
        cb.onError(ev.payload.error);
        resolvePromise(fullText || "");
      });

      unlisteners.push(u1, u2, u3);
    } catch (e) {
      log("ChatStream", `[gen=${gen}] event listen failed: ${e}`);
      cb.onError(`event listen: ${e}`);
      resolvePromise("");
      return "";
    }

    // ── Fire the streaming LLM request ──
    log("ChatStream", `[gen=${gen}] invoking quick_chat_stream...`);
    invoke("quick_chat_stream", {
      message: text,
      history,
      userMd,
      memoryMd,
      apiUrl: llm.apiUrl,
      apiKey: llm.apiKey,
      model: llm.model,
      provider: llm.provider,
      timeoutSecs: llm.timeoutSecs,
    }).catch((e) => {
      if (!isCancelled()) {
        log("ChatStream", `[gen=${gen}] invoke error: ${e}`);
        streaming = false;
        for (const u of unlisteners) u();
        cb.onError(`${e}`);
        resolvePromise(fullText || "");
      }
    });

    return donePromise;
  }, [generateTts, playTtsBuffer]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    ++genRef.current;
    log("ChatStream", `cancel: new gen=${genRef.current}`);
  }, []);

  return { startStream, cancel };
}
