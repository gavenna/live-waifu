/**
 * useAgentLoop.ts — Builtin Agent tool-calling loop
 *
 * 在 while 循环中：
 *   1. 发送 messages + tools 到 LLM (流式)
 *   2. 接收 chat-chunk (文本) / chat-tool-call (工具调用)
 *   3. 如果有工具调用 → 执行 → 结果注入 → 继续循环
 *   4. 如果没有 → 返回最终文本
 *
 * 参考: smolagents ToolCallingAgent._run_stream + agentloop route.ts
 */

import { useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { parseEmotionTag, detectEmotionFallback, stripAllEmotionTags } from "../constants/emotion";
import { toOpenaiTools, executeToolCall, getAvailableTools } from "../tools/registry";
import { buildExtraMessages } from "../utils/messageBuilder";
import type { ToolCallRequest, ToolCallResult } from "../tools/registry";
import { log } from "../utils/logger";

// ── Types ────────────────────────────────────────────

interface LlmConfig {
  provider: string; apiUrl: string; apiKey: string; model: string; timeoutSecs: number;
}

export interface AgentLoopCallbacks {
  onEmotion: (emotion: string) => void;
  onFirstToken: () => void;
  onSentenceStart: (sentenceText: string, audioBuffer: AudioBuffer) => void;
  onToolCall: (name: string, args: string) => void;
  onToolResult: (name: string, result: string) => void;
  onError: (error: string) => void;
  /** 所有 TTS 音频播放完毕（resolve 之后异步触发） */
  onAudioDone?: () => void;
}

// ── Sentence boundary (same logic as useChatStream) ──

const SENTENCE_BOUNDARY = /([。！？；\n])/;
const COMMA_SPLIT = /(，)/;
const MAX_UNBROKEN_CHARS = 100;

function isTtsWorthy(text: string): boolean {
  // Reject lines starting with [img: — they're English image prompts, not dialogue
  if (/^\[img:/i.test(text.trim())) return false;
  const withoutParens = text.replace(/[（(][^）)]*[）)]/g, "");
  // Count Chinese characters — must have at least 2 for TTS
  const cjk = (withoutParens.match(/[一-鿿]/g) || []).length;
  if (cjk < 2) return false;
  return withoutParens.length >= 3;
}

function splitSentences(buffer: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = [];
  let remaining = buffer;
  while (remaining.length > 0) {
    const match = SENTENCE_BOUNDARY.exec(remaining);
    if (match) {
      const idx = match.index + match[0].length;
      sentences.push(remaining.slice(0, idx).trim());
      remaining = remaining.slice(idx);
    } else if (remaining.length > MAX_UNBROKEN_CHARS) {
      const cm = COMMA_SPLIT.exec(remaining);
      if (cm) {
        const idx = cm.index + cm[0].length;
        sentences.push(remaining.slice(0, idx).trim());
        remaining = remaining.slice(idx);
      } else {
        sentences.push(remaining.trim());
        remaining = "";
      }
    } else { break; }
  }
  return { sentences, remainder: remaining };
}

// ── Hook ─────────────────────────────────────────────

export function useAgentLoop(
  generateTts: (text: string) => Promise<AudioBuffer>,
  playTtsBuffer: (buf: AudioBuffer, vol: number) => Promise<void>,
) {
  const cancelledRef = useRef(false);
  const genRef = useRef(0);
  const MAX_AGENT_STEPS = 8;

  /** 单次流式调用 → { fullText, toolCalls }
   *  TTS 使用双队列 (生成/播放独立并行) 防止下句抢上句 */
  function streamOnce(
    command: string,
    args: Record<string, unknown>,
    ttsVolume: number,
    cb: AgentLoopCallbacks,
  ): Promise<{ fullText: string; toolCalls: ToolCallRequest[] }> {
    return new Promise((resolve) => {
      const gen = genRef.current;
      let fullText = "";
      let textBuffer = "";
      let firstToken = false;
      let emotionDetected = false;
      let streaming = true;
      const toolCalls: ToolCallRequest[] = [];
      const unlisteners: UnlistenFn[] = [];

      const isCancelled = () => cancelledRef.current || gen !== genRef.current;
      const cleanup = () => { for (const u of unlisteners) u(); };

      // ── TTS 双队列 (同 useChatStream 模式) ──
      const ttsQueue: string[] = [];
      interface AudioItem { text: string; buffer: AudioBuffer }
      const audioQueue: AudioItem[] = [];
      let ttsGenerating = false;
      let audioPlaying = false;
      let resolved = false;

      const processQueue = () => {
        if (isCancelled()) return;

        // 生成：有句子就启动
        if (ttsQueue.length > 0 && !ttsGenerating) {
          const sentence = ttsQueue.shift()!;
          ttsGenerating = true;
          generateTts(sentence).then((buf) => {
            if (!isCancelled()) audioQueue.push({ text: sentence, buffer: buf });
            ttsGenerating = false;
            processQueue();
          }).catch(() => { ttsGenerating = false; processQueue(); });
        }

        // 播放：有音频就启动（不阻塞生成）
        if (audioQueue.length > 0 && !audioPlaying) {
          const item = audioQueue.shift()!;
          cb.onSentenceStart(item.text, item.buffer);
          audioPlaying = true;
          playTtsBuffer(item.buffer, ttsVolume).then(() => {
            audioPlaying = false;
            if (!isCancelled()) processQueue();
          }).catch(() => { audioPlaying = false; if (!isCancelled()) processQueue(); });
        }

        const allDrained = !streaming && ttsQueue.length === 0 && audioQueue.length === 0 && !ttsGenerating && !audioPlaying;

        // Resolve when text fully received + TTS queued — audio continues in background
        if (!resolved && !streaming && ttsQueue.length === 0 && !ttsGenerating) {
          resolved = true;
          cleanup();
          resolve({ fullText: stripAllEmotionTags(fullText), toolCalls });
        }

        // Audio finished after resolve → notify
        if (resolved && allDrained) {
          cb.onAudioDone?.();
        }
      };

      // Wire up listeners
      Promise.all([
        listen<{ content: string }>("chat-chunk", (ev) => {
          if (isCancelled()) { cleanup(); return; }
          const chunk = ev.payload.content;
          fullText += chunk;
          textBuffer += chunk;
          // Strip complete [img: ...] tags BEFORE sentence splitting —
          // they're 300+ chars of English with no Chinese punctuation,
          // causing COMMA_SPLIT fallback which leaks English to TTS
          textBuffer = textBuffer.replace(/\[img:[^\]]*\]/gi, "");

          if (!firstToken) { firstToken = true; cb.onFirstToken(); }

          // Emotion detection
          if (!emotionDetected) {
            const { emotion, cleaned } = parseEmotionTag(fullText);
            if (emotion) {
              emotionDetected = true; cb.onEmotion(emotion);
              fullText = cleaned; textBuffer = cleaned;
            } else if (fullText.length > 200) {
              emotionDetected = true; cb.onEmotion(detectEmotionFallback(fullText));
            }
          }

          // Sentence splitting → enqueue for TTS
          const { sentences, remainder } = splitSentences(textBuffer);
          textBuffer = remainder;
          for (const s of sentences) {
            const clean = stripAllEmotionTags(s).replace(/\[img:[^\]]*\]/gi, "");
            if (isTtsWorthy(clean)) ttsQueue.push(clean);
          }
          processQueue();
        }),

        listen<{ tool_calls: ToolCallRequest[] }>("chat-tool-call", (ev) => {
          if (isCancelled()) { cleanup(); return; }
          for (const tc of ev.payload.tool_calls) {
            toolCalls.push(tc);
            cb.onToolCall(tc.function.name, tc.function.arguments);
          }
        }),

        listen("chat-done", () => {
          if (isCancelled()) { cleanup(); return; }
          streaming = false;

          // Flush remaining text
          const flushed = stripAllEmotionTags(textBuffer.trim()).replace(/\[img:[^\]]*\]/gi, "");
          if (flushed && isTtsWorthy(flushed)) {
            ttsQueue.push(flushed);
            textBuffer = "";
          }
          // Fallback emotion
          if (!emotionDetected) { cb.onEmotion(detectEmotionFallback(fullText)); }

          processQueue();
        }),

        listen<{ error: string }>("chat-error", (ev) => {
          if (isCancelled()) { cleanup(); return; }
          streaming = false; cleanup();
          cb.onError(ev.payload.error);
          resolve({ fullText: stripAllEmotionTags(fullText), toolCalls });
        }),
      ]).then((listeners) => {
        unlisteners.push(...listeners);
        invoke(command, args).catch((e) => {
          if (!isCancelled()) { cleanup(); cb.onError(`${e}`); resolve({ fullText: stripAllEmotionTags(fullText), toolCalls }); }
        });
      });
    });
  }

  /** Agent loop: iterate until LLM stops calling tools or max steps reached */
  const startAgentLoop = useCallback(async (
    text: string,
    history: Array<[string, string]>,
    userMd: string,
    memoryMd: string,
    recallText: string,
    llm: LlmConfig,
    ttsVolume: number,
    tier: string,
    cb: AgentLoopCallbacks,
  ): Promise<string> => {
    const gen = ++genRef.current;
    cancelledRef.current = false;
    const t0 = Date.now();
    log("AgentLoop", `[gen=${gen}] start: "${text.slice(0, 60)}..." model=${llm.model} tier=${tier}`);

    const toolDefs = getAvailableTools(tier);
    const toolsJson = toolDefs.length > 0 ? JSON.stringify(toOpenaiTools(toolDefs)) : null;
    log("AgentLoop", `[gen=${gen}] model=${llm.model} tools: ${toolDefs.map(t => t.name).join(", ") || "none"}`);

    // Extra messages accumulated across steps (assistant tool_calls + tool results)
    const extraMessages: Record<string, unknown>[] = [];

    // Step 1: initial call (Rust builds system prompt + history + user message)
    let result = await streamOnce("quick_chat_stream", {
      message: text, history, userMd, memoryMd, recallText,
      apiUrl: llm.apiUrl, apiKey: llm.apiKey, model: llm.model, provider: llm.provider, timeoutSecs: llm.timeoutSecs,
      toolsJson,
      toolChoiceJson: null,
    }, ttsVolume, cb);

    if (cancelledRef.current || gen !== genRef.current) return result.fullText;

    let fullText = result.fullText;

    for (let step = 1; step <= MAX_AGENT_STEPS; step++) {
      if (result.toolCalls.length === 0) {
        log("AgentLoop", `[gen=${gen}] done: ${fullText.length} chars, ${Date.now() - t0}ms`);
        return fullText;
      }

      log("AgentLoop", `[gen=${gen}] step ${step}: ${result.toolCalls.length} tool call(s) — ${result.toolCalls.map(t => t.function.name).join(", ")}`);

      // Execute tools in parallel
      const toolResults: ToolCallResult[] = await Promise.all(
        result.toolCalls.map(async (tc) => {
          const r = await executeToolCall(tc, {
            apiUrl: llm.apiUrl,
            apiKey: llm.apiKey,
            model: llm.model,
            provider: llm.provider,
          });
          cb.onToolResult(tc.function.name, r.content);
          return r;
        })
      );

      // Append this round's messages to extraMessages
      const roundExtra = buildExtraMessages(fullText, result.toolCalls, toolResults);
      extraMessages.push(...(roundExtra as unknown as Record<string, unknown>[]));

      // Continue: Rust rebuilds system+history+user, then appends extraMessages
      result = await streamOnce("chat_stream_continue", {
        message: text, history, userMd, memoryMd, recallText,
        extraMessagesJson: JSON.stringify(extraMessages),
        toolsJson,
        apiUrl: llm.apiUrl, apiKey: llm.apiKey, model: llm.model, provider: llm.provider, timeoutSecs: llm.timeoutSecs,
      }, ttsVolume, cb);

      if (cancelledRef.current || gen !== genRef.current) return fullText;
      fullText = result.fullText || fullText;
    }

    // Max steps reached — force one final synthesis call without tools
    log("AgentLoop", `[gen=${gen}] max steps reached, forcing synthesis...`);
    result = await streamOnce("chat_stream_continue", {
      message: text, history, userMd, memoryMd, recallText,
      extraMessagesJson: JSON.stringify(extraMessages),
      toolsJson,
      toolChoiceJson: "none",
      apiUrl: llm.apiUrl, apiKey: llm.apiKey, model: llm.model, provider: llm.provider, timeoutSecs: llm.timeoutSecs,
    }, ttsVolume, cb);

    if (cancelledRef.current || gen !== genRef.current) return fullText;
    if (result.fullText) fullText = result.fullText;

    log("AgentLoop", `[gen=${gen}] synthesis done: ${fullText.length} chars`);
    return fullText;
  }, [generateTts, playTtsBuffer]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    ++genRef.current;
    log("AgentLoop", `cancel: new gen=${genRef.current}`);
  }, []);

  return { startAgentLoop, cancel };
}
