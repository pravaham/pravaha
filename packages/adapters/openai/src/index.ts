import OpenAI from 'openai'
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

export interface OpenAIAdapterConfig {
  readonly apiKey: string
  readonly defaultModel?: string
  readonly defaultMaxTokens?: number
  readonly timeoutMs?: number
}

const DEFAULT_MODEL = 'gpt-4-turbo'
const DEFAULT_MAX_TOKENS = 4096

/**
 * LLM Step backed by OpenAI.
 * Follows the same interface contract as ClaudeLLMStep.
 */
export class OpenAILLMStep extends BaseStep<LLMRequest, LLMResponse> {
  readonly type = 'llm:openai'

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

  private readonly client: OpenAI

  constructor(
    readonly id: PravahaId,
    readonly name: string,
    private readonly config: OpenAIAdapterConfig,
  ) {
    super()
    this.client = new OpenAI({ apiKey: config.apiKey })
  }

  protected async run(input: LLMRequest, context: ExecutionContext): Promise<LLMResponse> {
    const model = input.model ?? this.config.defaultModel ?? DEFAULT_MODEL
    const maxTokens = input.maxTokens ?? this.config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS

    const allMessages = [...context.messages, ...input.messages]

    try {
      const response = await this.client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        messages: allMessages.map((m) => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
        })),
      })

      const choice = response.choices[0]
      const content = choice?.message.content
      if (!content) {
        throw new LLMInvalidResponseError('openai', 'Empty content in response')
      }

      return {
        content,
        model: response.model,
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
      }
    } catch (err) {
      if (err instanceof OpenAI.RateLimitError) {
        throw new LLMRateLimitError('openai', undefined, err)
      }
      if (err instanceof OpenAI.APIConnectionTimeoutError) {
        throw new LLMTimeoutError('openai', this.config.timeoutMs ?? 60_000, err)
      }
      if (
        err instanceof LLMInvalidResponseError ||
        err instanceof LLMRateLimitError ||
        err instanceof LLMTimeoutError
      ) {
        throw err
      }
      throw new LLMInvalidResponseError(
        'openai',
        err instanceof Error ? err.message : String(err),
        err,
      )
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

// ─── OpenAIToolCallingAdapter ────────────────────────────────────────────────

export interface OpenAIToolCallingAdapterConfig {
  readonly apiKey: string
  readonly defaultModel?: string
  readonly defaultMaxTokens?: number
  readonly timeoutMs?: number
  readonly baseURL?: string
}

/**
 * OpenAI implementation of ToolCallingAdapter.
 *
 * Uses OpenAI's tool_calls array format.
 * Compatible with GPT-4o, GPT-4-turbo, and Azure OpenAI.
 *
 * @example
 * const adapter = new OpenAIToolCallingAdapter({
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   defaultModel: 'gpt-4o',
 * })
 */
export class OpenAIToolCallingAdapter implements ToolCallingAdapter {
  readonly adapterName = 'openai'
  private readonly client: OpenAI
  private readonly defaultModel: string
  private readonly defaultMaxTokens: number

  constructor(private readonly config: OpenAIToolCallingAdapterConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      timeout: config.timeoutMs ?? 60_000,
    })
    this.defaultModel = config.defaultModel ?? 'gpt-4o'
    this.defaultMaxTokens = config.defaultMaxTokens ?? 4096
  }

  async chat(
    messages: readonly LLMMessage[],
    tools: readonly ToolDefinition<unknown, unknown>[],
    options?: ToolCallingOptions,
  ): Promise<AgentLLMResponse> {
    const model = options?.model ?? this.defaultModel
    const maxTokens = options?.maxTokens ?? this.defaultMaxTokens

    const openAiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map((tool) => {
      const anthropicTool = toAnthropicTool(tool)
      return {
        type: 'function',
        function: {
          name: anthropicTool.name,
          description: anthropicTool.description,
          parameters: anthropicTool.input_schema as OpenAI.FunctionParameters,
        },
      }
    })

    const allMessages: OpenAI.Chat.ChatCompletionMessageParam[] = []
    if (options?.systemPrompt) {
      allMessages.push({ role: 'system', content: options.systemPrompt })
    }

    for (const msg of messages) {
      if (msg.role === 'system' || msg.role === 'user' || msg.role === 'assistant') {
        allMessages.push({ role: msg.role, content: msg.content })
      }
    }

    try {
      const response = await this.client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        messages: allMessages,
        ...(openAiTools.length > 0 ? { tools: openAiTools } : {}),
      })

      const choice = response.choices[0]
      if (!choice) throw new LLMInvalidResponseError('openai', 'Empty choices in response')

      const usage = {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      }

      if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
        const toolCalls: ToolCallRequest[] = choice.message.tool_calls.map((tc) => ({
          id: tc.id,
          toolId: tc.function.name,
          input: JSON.parse(tc.function.arguments) as unknown,
        }))

        return { type: 'tool_calls', toolCalls, usage, model: response.model }
      }

      if (!choice.message.content) {
        throw new LLMInvalidResponseError('openai', 'Empty content and no tool calls in response')
      }

      return { type: 'text', content: choice.message.content, usage, model: response.model }
    } catch (err) {
      if (err instanceof LLMInvalidResponseError) throw err
      if (err instanceof OpenAI.RateLimitError) throw new LLMRateLimitError('openai', undefined, err)
      if (err instanceof OpenAI.APIConnectionTimeoutError)
        throw new LLMTimeoutError('openai', this.config.timeoutMs ?? 60_000, err)
      throw new LLMInvalidResponseError(
        'openai',
        err instanceof Error ? err.message : String(err),
        err,
      )
    }
  }

  buildToolResultMessage(results: readonly ToolCallResult[]): readonly LLMMessage[] {
    return results.map((r) => ({
      role: 'tool' as const,
      content: r.error ? `Error: ${r.error}` : JSON.stringify(r.output),
    }))
  }
}

// ─── OpenAIStreamingLLMStep ──────────────────────────────────────────────────

/**
 * Streaming-capable OpenAI LLM Step.
 *
 * Supports both standard execute() and streaming stream() modes.
 * Use when you need real-time token delivery for user-facing interfaces.
 *
 * @example
 * for await (const chunk of step.stream(input, ctx)) {
 *   process.stdout.write(chunk.delta)
 * }
 */
export class OpenAIStreamingLLMStep extends BaseStreamingStep {
  readonly type = 'llm:openai:streaming'

  readonly inputSchema = z.object({
    messages: z.array(
      z.object({
        role: z.enum(['system', 'user', 'assistant', 'tool']),
        content: z.string(),
      }),
    ),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
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

  private readonly client: OpenAI
  private streamedModel = ''

  constructor(
    readonly id: PravahaId,
    readonly name: string,
    private readonly config: {
      apiKey: string
      defaultModel?: string
      defaultMaxTokens?: number
      baseURL?: string
    },
  ) {
    super()
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL })
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
    const model = input.model ?? this.config.defaultModel ?? 'gpt-4o'
    const allMessages = [...context.messages, ...input.messages]

    try {
      const stream = await this.client.chat.completions.create({
        model,
        max_tokens: input.maxTokens ?? this.config.defaultMaxTokens ?? 4096,
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        stream: true,
        messages: allMessages.map((m) => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
        })),
      })

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta.content
        if (delta) {
          this.streamedModel = chunk.model
          yield delta
        }
      }
    } catch (err) {
      if (err instanceof OpenAI.RateLimitError) throw new LLMRateLimitError('openai', undefined, err)
      if (err instanceof OpenAI.APIConnectionTimeoutError) throw new LLMTimeoutError('openai', 60_000, err)
      throw new LLMInvalidResponseError('openai', err instanceof Error ? err.message : String(err), err)
    }
  }

  protected async buildResponseFromStream(
    accumulated: string,
    _input: LLMRequest,
  ): Promise<LLMResponse> {
    return {
      content: accumulated,
      model: this.streamedModel || 'gpt-4o',
      // OpenAI streaming does not return usage by default — zeroed
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
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
