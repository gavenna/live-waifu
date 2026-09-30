/**
 * messageBuilder.ts — 构建 agent loop 中传给 chat_stream_continue 的消息
 *
 * 当 LLM 返回 tool_calls 后，需要将这些调用 + 执行结果追加到消息历史中
 * 然后继续流式对话。extra_messages 包含：
 *   1. assistant 消息（带 tool_calls）
 *   2. tool 消息们（每个工具调用一个结果）
 */

import type { ToolCallRequest } from "../tools/registry";

interface AssistantToolCallMessage {
  role: "assistant";
  content: string | null;
  tool_calls: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

interface ToolResultMessage {
  role: "tool";
  tool_call_id: string;
  content: string;
}

type ExtraMessage = AssistantToolCallMessage | ToolResultMessage;

/** Build the assistant + tool_result messages for agent loop continuation */
export function buildExtraMessages(
  fullText: string,
  toolCalls: ToolCallRequest[],
  results: ToolResultMessage[],
): ExtraMessage[] {
  const assistantMsg: AssistantToolCallMessage = {
    role: "assistant",
    content: fullText || null,
    tool_calls: toolCalls.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    })),
  };

  return [assistantMsg, ...results];
}
