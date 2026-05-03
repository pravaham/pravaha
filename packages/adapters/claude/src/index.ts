import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import {
  BaseStep,
  BaseStreamingStep,
  LLMTimeoutError,
  LLMRateLimitError,
  LLMInvalidResponseError,
  toAnthropicTool,
} from '@pravaha/core'
import type {
  PravahaId,
  LLMRequest,
  LLMResponse,
  ExecutionContext,
  StepResult,
  ToolCallingAdapter,
  ToolCallingOptions,
  AgentLLMResponse,
  ToolCallResult,
  ToolCallRequest,
  ToolDefinition,
  LLMMessage,
} from '@pravaha/core'
import { withMessages } from '@pravaha/core'

export interface ClaudeAdapterConfig {
  readonly apiKey: string
  readonly defaultModel?: string
  readonly defaultMaxTokens?: number
  readonly timeoutMs?: number
}

const DEFAULT_MODEL = 'claude-opus-4-5'
const DEFAULT_MAX_TOKENS = 4096
const DEFAULT_TIMEOUT_MS = 60_000

/**
 * LLM Step backed by Anthropic Claude.
 *
 * Handles:
 * - Rate limit errors with retryAfter
 * - Timeout errors
 * - Invalid response errors
 * - Automatic message history management via ExecutionContext
 */
export class ClaudeLLMStep extends BaseStep<LLMRequest, LLMResponse> {
  readonly type = 'llm:claude'

  readonly inputSchema = z.object({
    messages: z.array(
      z.object({
        role: z.enum(['system', 'user', 'assistant', 'tool']),
        content: z.string(),
      }),
    ),
    model: z.string().optional(),
    temperature: z.number().min(0).max(1).optional(),
    maxTokens: z.number().positive().optional(),
    metadata: z.record(z.unknown()).optional(),
  }) as z.ZodType<LLMRequest>

  readonly outputSchema = z.object({
    content: z.string().min(1),
    model: z.string(),
    usage: z.object({
      promptTokens: z.number(),
      completionTokens: z.number(),
      totalTokens: z.number(),
    }),
    metadata: z.record(z.unknown()).optional(),
  }) as z.ZodType<LLMResponse>

  private readonly client: Anthropic

  constructor(
    readonly id: PravahaId,
    readonly name: string,
    private readonly config: ClaudeAdapterConfig,
  ) {
    super()
    this.client = new Anthropic({ apiKey: config.apiKey })
  }

  protected async run(input: LLMRequest, context: ExecutionContext): Promise<LLMResponse> {
    const model = input.model ?? this.config.defaultModel ?? DEFAULT_MODEL
    const maxTokens = input.maxTokens ?? this.config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS

    const allMessages = [...context.messages, ...input.messages]
    const systemMessages = allMessages.filter((m) => m.role === 'system')
    const conversationMessages = allMessages.filter((m) => m.role !== 'system')
    const systemPrompt = systemMessages.map((m) => m.content).join('\n\n')

    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        messages: conversationMessages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      })

      const content = response.content[0]
      if (!content || content.type !== 'text') {
        throw new LLMInvalidResponseError('claude', 'Expected text content block in response')
      }

      return {
        content: content.text,
        model: response.model,
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        },
      }
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) {
        throw new LLMRateLimitError('claude', undefined, err)
      }
      if (err instanceof Anthropic.APIConnectionTimeoutError) {
        throw new LLMTimeoutError('claude', this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS, err)
      }
      if (
        err instanceof LLMInvalidResponseError ||
        err instanceof LLMRateLimitError ||
        err instanceof LLMTimeoutError
      ) {
        throw err
      }
      throw new LLMInvalidResponseError(
        'claude',
        err instanceof Error ? err.message : String(err),
        err,
      )
    }
  }

  /** Override execute to also update context messages after LLM call */
  override async execute(
    input: LLMRequest,
    context: ExecutionContext,
  ): Promise<StepResult<LLMResponse>> {
    const result = await super.execute(input, context)

    const updatedContext = withMessages(result.context, [
      ...input.messages,
      { role: 'assistant', content: result.output.content },
    ])

    return { output: result.output, context: updatedContext }
  }
}

// ─── ClaudeToolCallingAdapter ────────────────────────────────────────────────

export interface ClaudeToolCallingAdapterConfig {
  readonly apiKey: string
  readonly defaultModel?: string
  readonly defaultMaxTokens?: number
  readonly timeoutMs?: number
}

const TOOL_DEFAULT_MODEL = 'claude-opus-4-5'
const TOOL_DEFAULT_MAX_TOKENS = 4096

/**
 * Anthropic Claude implementation of ToolCallingAdapter.
 *
 * Uses Anthropic's native tool_use / tool_result content blocks.
 * Compatible with all Claude models that support tool use.
 *
 * @example
 * const adapter = new ClaudeToolCallingAdapter({
 *   apiKey: process.env.ANTHROPIC_API_KEY!,
 *   defaultModel: 'claude-opus-4-5',
 * })
 *
 * const agent = new AgentStep({
 *   id: 'my-agent',
 *   name: 'My Agent',
 *   adapter,
 *   tools: [searchTool, lookupTool],
 * })
 */
export class ClaudeToolCallingAdapter implements ToolCallingAdapter {
  readonly adapterName = 'claude'
  private readonly client: Anthropic
  private readonly defaultModel: string
  private readonly defaultMaxTokens: number

  constructor(private readonly config: ClaudeToolCallingAdapterConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey })
    this.defaultModel = config.defaultModel ?? TOOL_DEFAULT_MODEL
    this.defaultMaxTokens = config.defaultMaxTokens ?? TOOL_DEFAULT_MAX_TOKENS
  }

  async chat(
    messages: readonly LLMMessage[],
    tools: readonly ToolDefinition<unknown, unknown>[],
    options?: ToolCallingOptions,
  ): Promise<AgentLLMResponse> {
    const model = options?.model ?? this.defaultModel
    const maxTokens = options?.maxTokens ?? this.defaultMaxTokens

    const systemMessages = messages.filter((m) => m.role === 'system')
    const conversationMessages = messages.filter((m) => m.role !== 'system')
    const systemParts: string[] = []
    if (options?.systemPrompt) systemParts.push(options.systemPrompt)
    systemMessages.forEach((m) => systemParts.push(m.content))
    const systemPrompt = systemParts.join('\n\n')

    // Tool calling uses the beta.tools.messages API in SDK v0.20.x
    const anthropicTools = tools.map(toAnthropicTool) as Anthropic.Beta.Tools.Tool[]

    try {
      const response = await this.client.beta.tools.messages.create({
        model,
        max_tokens: maxTokens,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        tools: anthropicTools,
        messages: conversationMessages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      })

      const usage = {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      }

      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.Beta.Tools.ToolUseBlock => block.type === 'tool_use',
      )

      if (toolUseBlocks.length > 0) {
        const toolCalls: ToolCallRequest[] = toolUseBlocks.map((block) => ({
          id: block.id,
          toolId: block.name,
          input: block.input,
        }))

        return { type: 'tool_calls', toolCalls, usage, model: response.model }
      }

      const textBlock = response.content.find((block) => block.type === 'text')
      if (!textBlock || textBlock.type !== 'text') {
        throw new LLMInvalidResponseError('claude', 'No text or tool_use block in response')
      }

      return { type: 'text', content: textBlock.text, usage, model: response.model }
    } catch (err) {
      if (err instanceof LLMInvalidResponseError) throw err
      if (err instanceof Anthropic.RateLimitError)
        throw new LLMRateLimitError('claude', undefined, err)
      if (err instanceof Anthropic.APIConnectionTimeoutError)
        throw new LLMTimeoutError('claude', this.config.timeoutMs ?? 60_000, err)
      throw new LLMInvalidResponseError(
        'claude',
        err instanceof Error ? err.message : String(err),
        err,
      )
    }
  }

  buildToolResultMessage(results: readonly ToolCallResult[]): LLMMessage {
    return {
      role: 'user',
      content: JSON.stringify(
        results.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.callId,
          content: r.error ? `Error: ${r.error}` : JSON.stringify(r.output),
        })),
      ),
    }
  }
}

// ─── ClaudeStreamingLLMStep ──────────────────────────────────────────────────

/**
 * Streaming-capable Claude LLM Step.
 *
 * Supports both standard execute() and streaming stream() modes.
 * Use when you need real-time token delivery for user-facing interfaces.
 *
 * @example
 * const step = new ClaudeStreamingLLMStep('llm', 'LLM', { apiKey: '...' })
 *
 * // Standard mode — unchanged API
 * const result = await step.execute(input, ctx)
 *
 * // Streaming mode
 * for await (const chunk of step.stream(input, ctx, { onChunk: (c) => process.stdout.write(c.delta) })) {}
 * const fullResponse = step.getLastResponse()
 */
export class ClaudeStreamingLLMStep extends BaseStreamingStep {
  readonly type = 'llm:claude:streaming'

  readonly inputSchema = z.object({
    messages: z.array(
      z.object({
        role: z.enum(['system', 'user', 'assistant', 'tool']),
        content: z.string(),
      }),
    ),
    model: z.string().optional(),
    temperature: z.number().min(0).max(1).optional(),
    maxTokens: z.number().positive().optional(),
    metadata: z.record(z.unknown()).optional(),
  }) as z.ZodType<LLMRequest>

  readonly outputSchema = z.object({
    content: z.string().min(1),
    model: z.string(),
    usage: z.object({
      promptTokens: z.number(),
      completionTokens: z.number(),
      totalTokens: z.number(),
    }),
    metadata: z.record(z.unknown()).optional(),
  }) as z.ZodType<LLMResponse>

  private readonly client: Anthropic
  private streamedModel = ''
  private streamedUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  constructor(
    readonly id: PravahaId,
    readonly name: string,
    private readonly config: { apiKey: string; defaultModel?: string; defaultMaxTokens?: number },
  ) {
    super()
    this.client = new Anthropic({ apiKey: config.apiKey })
  }

  protected async run(input: LLMRequest, context: ExecutionContext): Promise<LLMResponse> {
    let accumulated = ''
    for await (const delta of this.runStream(input, context)) {
      accumulated += delta
    }
    return this.buildResponseFromStream(accumulated, input)
  }

  protected async *runStream(
    input: LLMRequest,
    context: ExecutionContext,
  ): AsyncGenerator<string, void, unknown> {
    const model = input.model ?? this.config.defaultModel ?? 'claude-opus-4-5'
    const maxTokens = input.maxTokens ?? this.config.defaultMaxTokens ?? 4096

    const allMessages = [...context.messages, ...input.messages]
    const systemMessages = allMessages.filter((m) => m.role === 'system')
    const conversationMessages = allMessages.filter((m) => m.role !== 'system')
    const systemPrompt = systemMessages.map((m) => m.content).join('\n\n')

    try {
      const stream = this.client.messages.stream({
        model,
        max_tokens: maxTokens,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        messages: conversationMessages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      })

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text
        }
      }

      const finalMessage = await stream.finalMessage()
      this.streamedModel = finalMessage.model
      this.streamedUsage = {
        promptTokens: finalMessage.usage.input_tokens,
        completionTokens: finalMessage.usage.output_tokens,
        totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
      }
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError)
        throw new LLMRateLimitError('claude', undefined, err)
      if (err instanceof Anthropic.APIConnectionTimeoutError)
        throw new LLMTimeoutError('claude', 60_000, err)
      throw new LLMInvalidResponseError(
        'claude',
        err instanceof Error ? err.message : String(err),
        err,
      )
    }
  }

  protected async buildResponseFromStream(
    accumulated: string,
    _input: LLMRequest,
  ): Promise<LLMResponse> {
    return {
      content: accumulated,
      model: this.streamedModel || 'claude-opus-4-5',
      usage: this.streamedUsage,
    }
  }

  override async execute(
    input: LLMRequest,
    context: ExecutionContext,
  ): Promise<StepResult<LLMResponse>> {
    const result = await super.execute(input, context)
    const updatedContext = withMessages(result.context, [
      ...input.messages,
      { role: 'assistant', content: result.output.content },
    ])
    return { output: result.output, context: updatedContext }
  }
}
