/**
 * tools/registry.ts — Builtin Agent 工具注册表
 *
 * 每个工具需要：
 * 1. definition — OpenAI 兼容的 tool definition（传给 LLM）
 * 2. execute   — 实际执行函数（TS 端或 invoke Rust）
 * 3. tier      — 功能分级门槛
 */

import { invoke } from "@tauri-apps/api/core";

// ── Types ────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  tier: "free" | "pro";
}

/** Matches Rust llm_client::ToolCall JSON output */
export interface ToolCallRequest {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ToolCallResult {
  tool_call_id: string;
  role: "tool";
  content: string;
}

// ── OpenAI-compatible format helpers ─────────────────

export function toOpenaiTools(defs: ToolDefinition[]): Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}> {
  return defs.map((d) => ({
    type: "function" as const,
    function: {
      name: d.name,
      description: d.description,
      parameters: d.parameters,
    },
  }));
}

// ── Tool definitions ─────────────────────────────────

const ALL_TOOLS: ToolDefinition[] = [
  {
    name: "read_clipboard",
    description: "读取当前系统剪贴板中的最新文本内容。仅在用户明确要求读取剪贴板、或用户说'我刚复制了xxx你帮我看看'等场景下调用。不要主动猜测或预判用户可能需要剪贴板内容——必须等用户明确指令。",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    tier: "free",
  },
  {
    name: "system_info",
    description: "获取当前系统信息：操作系统类型、CPU 架构、主机名。当用户问到系统相关问题时使用。",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    tier: "free",
  },
  {
    name: "web_search",
    description: "搜索网页获取最新信息（Bing 爬虫，国内直连可用）。当用户问实时事件（体育比分、新闻、天气等）、事实性问题时使用。搜索结果已含摘要，摘要不够用时可调用 fetch_page 打开链接抓取完整正文。搜索国际话题、赛事、新闻时请用英文关键词。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
      },
      required: ["query"],
    },
    tier: "free",
  },
  {
    name: "fetch_page",
    description: "打开搜索结果中的链接，抓取完整网页正文（Markdown 格式，自动去除广告和导航）。搜索后必须至少挑一条最相关的链接抓取——摘要不等于信息收集完毕。传入搜索结果中返回的 href 链接即可。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "要抓取的网页 URL" },
        max_chars: { type: "integer", description: "最大返回字符数，默认 5000" },
      },
      required: ["url"],
    },
    tier: "free",
  },
  {
    name: "analyze_screen",
    description: "截取当前屏幕并分析内容。当你需要看到用户屏幕上有什么时调用——比如用户说'看看这个''帮我看看这段代码''分析一下这个页面''屏幕上有啥'等。返回屏幕内容的文字描述。只在用户明确指代屏幕内容时使用。",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "你想了解屏幕上的什么？用中文描述。" },
      },
      required: ["question"],
    },
    tier: "free",
  },
];

// ── Tool execution ───────────────────────────────────

export interface LlmToolConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  provider: string;
}

/** 执行单个工具调用，返回 tool result 消息 */
export async function executeToolCall(
  tc: ToolCallRequest,
  llmCfg?: LlmToolConfig,
): Promise<ToolCallResult> {
  let content: string;
  try {
    switch (tc.function.name) {
      case "read_clipboard":
        content = await invoke<string>("execute_builtin_tool", {
          name: "read_clipboard",
          args: {},
        });
        break;
      case "system_info":
        content = await invoke<string>("execute_builtin_tool", {
          name: "system_info",
          args: {},
        });
        break;
      case "web_search":
        content = await invoke<string>("execute_builtin_tool", {
          name: "web_search",
          args: JSON.parse(tc.function.arguments),
        });
        break;
      case "fetch_page":
        content = await invoke<string>("execute_builtin_tool", {
          name: "fetch_page",
          args: JSON.parse(tc.function.arguments),
        });
        break;
      case "analyze_screen": {
        if (!llmCfg) { content = "analyze_screen: missing LLM config"; break; }
        const args = JSON.parse(tc.function.arguments);
        const prompt = args.question || "描述屏幕上看到的内容，用中文简要概括";
        content = await invoke<string>("analyze_screen", {
          prompt,
          apiUrl: llmCfg.apiUrl,
          apiKey: llmCfg.apiKey,
          model: llmCfg.model,
          provider: llmCfg.provider,
        });
        break;
      }
      default:
        content = `Unknown tool: ${tc.function.name}`;
    }
  } catch (e: any) {
    content = `工具执行错误: ${e}`;
  }

  return {
    tool_call_id: tc.id,
    role: "tool",
    content: `[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${content}`,
  };
}

/** 按用户 tier 过滤可用工具 */
export function getAvailableTools(tier: string): ToolDefinition[] {
  if (tier === "pro" || tier === "dev") return ALL_TOOLS;
  return ALL_TOOLS.filter((t) => t.tier === "free");
}

// 关键词 → 强制触发的工具名（部分模型 tool_choice=auto 不可靠时的保底）
const FORCE_TOOL_PATTERNS: Array<{ pattern: RegExp; tool: string }> = [
  { pattern: /剪贴板|剪切板|复制了什么|复制了啥|复制的什么|复制了什么内容|复制了什么东西|复制了啥内容|我刚.*复制|刚才.*复制|看看.{0,4}复制|读.{0,2}剪贴|读一下|读一读|读取|粘贴板|告诉我.{0,4}复制|你知.{0,4}复制|你看到.{0,2}复制|里面有.{0,2}复制/, tool: "read_clipboard" },
  { pattern: /系统信息|我的电脑|主机名|操作系统|什么系统|电脑系统|什么配置|这台电脑/, tool: "system_info" },
  // web_search: 实时信息 / 外部事实 / 需要联网才能回答的问题
  { pattern: /现在.*(什么|吗|咋|啥|情况).*(况|样|成绩|结果|比分|排名|进展)|现在.*情况|现在.*状况|搜一下|搜一搜|帮我搜|帮我查|查一下.{0,3}最新|查查.{0,3}最新|最近.*新闻|最近.*比分|.{0,2}比分.{0,2}|.{0,2}天气.{0,2}|实时消息|最新.*消息|台风|地震|海啸|暴雨|暴雪|在哪.{0,2}|到哪.{0,2}|到哪了|在哪了|在哪里|去哪里了|什么位置|.*路径.*|.*轨迹.*|.*路线.*|.*预报.*|.*预警.*|实时.*|最新.*|今天.*(发生|有).*/, tool: "web_search" },
];

/**
 * 根据用户输入检测是否应强制触发某个工具。
 * 返回 OpenAI tool_choice JSON 字符串，或 null（让模型自行判断）。
 */
export function detectForcedTool(text: string, availableTools: ToolDefinition[]): string | null {
  for (const { pattern, tool } of FORCE_TOOL_PATTERNS) {
    if (pattern.test(text) && availableTools.some((t) => t.name === tool)) {
      return JSON.stringify({ type: "function", function: { name: tool } });
    }
  }
  return null;
}
