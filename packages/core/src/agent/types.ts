import type { LLMMessage, Metadata } from '../types/index.js'
import type { ToolDefinition } from '../step/tool.js'

/**
 * A single tool call requested by the LLM.
 * Provider-agnostic representation.
 */
export interface ToolCallRequest {
  /** Provider-generated unique ID for this call — used to match results */
  readonly id: string
  /** Matches ToolDefinition.id */
  readonly toolId: string
  /** Raw input from LLM — validated against tool's inputSchema before execution */
  readonly input: unknown
}

/**
 * Result of executing a tool call.
 * Fed back to the LLM in the next iteration.
 */
export interface ToolCallResult {
  /** Matches ToolCallRequest.id */
  readonly callId: string
  readonly output: unknown
  readonly error?: string
}

/**
 * Token usage for a single LLM call in the agent loop
 */
export interface AgentTokenUsage {
  readonly promptTokens: number
  readonly completionTokens: number
  readonly totalTokens: number
}

/**
 * Unified LLM response from a ToolCallingAdapter.
 * Either a final text response or a request to call tools.
 */
export type AgentLLMResponse =
  | {
      readonly type: 'text'
      readonly content: string
      readonly usage: AgentTokenUsage
      readonly model: string
      readonly metadata?: Metadata
    }
  | {
      readonly type: 'tool_calls'
      readonly toolCalls: readonly ToolCallRequest[]
      readonly usage: AgentTokenUsage
      readonly model: string
      readonly metadata?: Metadata
    }

/**
 * Options for a single ToolCallingAdapter.chat() call
 */
export interface ToolCallingOptions {
  readonly model?: string
  readonly temperature?: number
  readonly maxTokens?: number
  readonly systemPrompt?: string
}

/**
 * Port for LLM providers that support tool/function calling.
 *
 * Each provider implements this interface differently:
 * - Anthropic: tool_use content blocks + tool_result messages
 * - OpenAI: tool_calls array + tool role messages
 * - Ollama: JSON mode prompt engineering (for models without native support)
 *
 * AgentStep uses this interface exclusively — never depends on a concrete adapter.
 */
export interface ToolCallingAdapter {
  /** Human-readable adapter name for trace metadata */
  readonly adapterName: string

  /**
   * Send a chat request with available tools.
   * Returns either a text response or tool call requests.
   */
  chat(
    messages: readonly LLMMessage[],
    tools: readonly ToolDefinition<unknown, unknown>[],
    options?: ToolCallingOptions,
  ): Promise<AgentLLMResponse>

  /**
   * Convert tool execution results into a provider-specific message.
   * This message is appended to the conversation before the next LLM call.
   *
   * Each provider has a different format:
   * - Anthropic: user message with tool_result content blocks
   * - OpenAI: multiple messages with role 'tool'
   * - Ollama: user message with JSON results
   */
  buildToolResultMessage(results: readonly ToolCallResult[]): LLMMessage | readonly LLMMessage[]
}

/**
 * A single iteration in the agent loop — recorded in trace
 */
export interface AgentIteration {
  readonly iteration: number
  readonly response: AgentLLMResponse
  readonly toolCallResults?: readonly ToolCallResult[]
  readonly durationMs: number
}

/**
 * Final output from an AgentStep execution
 */
export interface AgentStepOutput {
  /** The LLM's final text response */
  readonly content: string
  /** All iterations that led to this response */
  readonly iterations: readonly AgentIteration[]
  /** Cumulative token usage across all iterations */
  readonly totalUsage: AgentTokenUsage
}
