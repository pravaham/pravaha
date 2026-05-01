import { z } from 'zod'
import {
  BaseStep,
  BaseStreamingStep,
  LLMTimeoutError,
  LLMInvalidResponseError,
  withMessages,
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

export interface OllamaAdapterConfig {
  /**
   * Ollama server base URL.
   * Default: 'http://localhost:11434'
   */
  readonly baseUrl?: string
  readonly defaultModel?: string
  readonly defaultMaxTokens?: number
  readonly timeoutMs?: number
}

const DEFAULT_BASE_URL = 'http://localhost:11434'
const DEFAULT_MODEL = 'llama3.2'
const DEFAULT_TIMEOUT_MS = 120_000

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface OllamaChatResponse {
  model: string
  message: {
    role: string
    content: string
  }
  done: boolean
  prompt_eval_count?: number
  eval_count?: number
}

interface OllamaTagsResponse {
  models: Array<{ name: string }>
}

/**
 * LLM Step backed by Ollama — runs local models with zero API cost.
 *
 * Requires Ollama running locally or on your network:
 *   https://ollama.ai
 *
 * Pull a model first:
 *   ollama pull llama3.2
 *   ollama pull mistral
 *   ollama pull codellama
 *
 * Enterprise use case: air-gapped environments where data cannot
 * leave the network. No API keys. No external calls.
 *
 * @example
 * const step = new OllamaLLMStep('local-classify', 'Local Classifier', {
 *   baseUrl: 'http://localhost:11434',
 *   defaultModel: 'llama3.2',
 * })
 */
export class OllamaLLMStep extends BaseStep<LLMRequest, LLMResponse> {
  readonly type = 'llm:ollama'

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

  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(
    readonly id: PravahaId,
    readonly name: string,
    private readonly config: OllamaAdapterConfig = {},
  ) {
    super()
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  protected async run(input: LLMRequest, context: ExecutionContext): Promise<LLMResponse> {
    const model = input.model ?? this.config.defaultModel ?? DEFAULT_MODEL

    const allMessages = [...context.messages, ...input.messages]

    const messages: OllamaChatMessage[] = allMessages
      .filter((m) => m.role !== 'tool')
      .map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      }))

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          options: {
            temperature: input.temperature,
            num_predict: input.maxTokens ?? this.config.defaultMaxTokens,
          },
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const body = await response.text().catch(() => 'Unknown error')
        if (response.status === 404) {
          throw new LLMInvalidResponseError(
            'ollama',
            `Model '${model}' not found. Run: ollama pull ${model}`,
          )
        }
        throw new LLMInvalidResponseError('ollama', `HTTP ${response.status}: ${body}`)
      }

      const data = (await response.json()) as OllamaChatResponse

      if (!data.message?.content) {
        throw new LLMInvalidResponseError('ollama', 'Empty content in response')
      }

      const promptTokens = data.prompt_eval_count ?? 0
      const completionTokens = data.eval_count ?? 0

      return {
        content: data.message.content,
        model: data.model,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        metadata: {
          ollamaBaseUrl: this.baseUrl,
        },
      }
    } catch (err) {
      if (err instanceof LLMInvalidResponseError) throw err

      if (err instanceof Error && err.name === 'AbortError') {
        throw new LLMTimeoutError('ollama', this.timeoutMs, err)
      }
      if (err instanceof Error && err.message.includes('ECONNREFUSED')) {
        throw new LLMInvalidResponseError(
          'ollama',
          `Cannot connect to Ollama at ${this.baseUrl}. Is Ollama running?`,
          err,
        )
      }

      throw new LLMInvalidResponseError(
        'ollama',
        err instanceof Error ? err.message : String(err),
        err,
      )
    } finally {
      clearTimeout(timeout)
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

  /**
   * Check if Ollama is reachable and list available models.
   * Useful for health checks and pipeline initialization.
   */
  async healthCheck(): Promise<{ ok: boolean; models: string[]; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) return { ok: false, models: [], error: `HTTP ${response.status}` }

      const data = (await response.json()) as OllamaTagsResponse
      const models = data.models.map((m) => m.name)
      return { ok: true, models }
    } catch (err) {
      return {
        ok: false,
        models: [],
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
}

// ─── OllamaToolCallingAdapter ────────────────────────────────────────────────

interface OllamaToolMessage {
  role: string
  content: string
}

/**
 * Ollama implementation of ToolCallingAdapter.
 *
 * Uses JSON-mode prompt engineering for models without native tool support.
 * The LLM is instructed to respond in a specific JSON format when it wants
 * to call a tool, which we parse and dispatch.
 *
 * NOTE: Tool calling quality varies significantly by model.
 * llama3.1 and mistral-nemo have best tool-calling support in Ollama.
 *
 * @example
 * const adapter = new OllamaToolCallingAdapter({
 *   baseUrl: 'http://localhost:11434',
 *   defaultModel: 'llama3.1',
 * })
 */
export class OllamaToolCallingAdapter implements ToolCallingAdapter {
  readonly adapterName = 'ollama'
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly defaultModel: string

  constructor(
    config: {
      readonly baseUrl?: string
      readonly defaultModel?: string
      readonly timeoutMs?: number
    } = {},
  ) {
    this.baseUrl = (config.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '')
    this.defaultModel = config.defaultModel ?? 'llama3.1'
    this.timeoutMs = config.timeoutMs ?? 120_000
  }

  async chat(
    messages: readonly LLMMessage[],
    tools: readonly ToolDefinition<unknown, unknown>[],
    options?: ToolCallingOptions,
  ): Promise<AgentLLMResponse> {
    const model = options?.model ?? this.defaultModel

    const ollamaMessages: OllamaToolMessage[] = messages
      .filter((m) => m.role !== 'tool')
      .map((m) => ({ role: m.role, content: m.content }))

    const toolSchemaPrompt = tools.length > 0 ? this.buildToolSchemaPrompt(tools) : ''

    if (toolSchemaPrompt) {
      const firstMsg = ollamaMessages[0]
      if (firstMsg?.role === 'system') {
        ollamaMessages[0] = {
          role: firstMsg.role,
          content: `${firstMsg.content}\n\n${toolSchemaPrompt}`,
        }
      } else {
        ollamaMessages.unshift({ role: 'system', content: toolSchemaPrompt })
      }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: ollamaMessages,
          stream: false,
          ...(options?.temperature !== undefined
            ? { options: { temperature: options.temperature } }
            : {}),
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new LLMInvalidResponseError('ollama', `HTTP ${response.status}`)
      }

      const data = (await response.json()) as {
        model: string
        message: { content: string }
        prompt_eval_count?: number
        eval_count?: number
      }

      const content = data.message.content
      const usage = {
        promptTokens: data.prompt_eval_count ?? 0,
        completionTokens: data.eval_count ?? 0,
        totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      }

      const toolCall = this.tryParseToolCall(content)
      if (toolCall) {
        return { type: 'tool_calls', toolCalls: [toolCall], usage, model: data.model }
      }

      return { type: 'text', content, usage, model: data.model }
    } catch (err) {
      if (err instanceof LLMInvalidResponseError) throw err
      if (err instanceof Error && err.name === 'AbortError') {
        throw new LLMTimeoutError('ollama', this.timeoutMs, err)
      }
      throw new LLMInvalidResponseError(
        'ollama',
        err instanceof Error ? err.message : String(err),
        err,
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  buildToolResultMessage(results: readonly ToolCallResult[]): LLMMessage {
    return {
      role: 'user',
      content: `Tool results:\n${JSON.stringify(results, null, 2)}`,
    }
  }

  private buildToolSchemaPrompt(tools: readonly ToolDefinition<unknown, unknown>[]): string {
    const toolSchemas = tools.map(toAnthropicTool)
    return [
      'You have access to the following tools:',
      JSON.stringify(toolSchemas, null, 2),
      '',
      'To call a tool, respond with ONLY this JSON format (no other text):',
      '{"tool_call": {"id": "<unique_id>", "name": "<tool_name>", "input": <input_object>}}',
      '',
      'To give a final answer, respond with plain text (not JSON).',
    ].join('\n')
  }

  private tryParseToolCall(content: string): ToolCallRequest | null {
    const trimmed = content.trim()
    if (!trimmed.startsWith('{')) return null

    try {
      const parsed = JSON.parse(trimmed) as {
        tool_call?: { id?: string; name?: string; input?: unknown }
      }
      if (parsed.tool_call?.name) {
        return {
          id: parsed.tool_call.id ?? `ollama-${Date.now()}`,
          toolId: parsed.tool_call.name,
          input: parsed.tool_call.input ?? {},
        }
      }
      return null
    } catch {
      return null
    }
  }
}

// ─── OllamaStreamingLLMStep ──────────────────────────────────────────────────

/**
 * Streaming-capable Ollama LLM Step.
 * Uses Ollama's NDJSON streaming format.
 *
 * @example
 * for await (const chunk of step.stream(input, ctx)) {
 *   process.stdout.write(chunk.delta)
 * }
 */
export class OllamaStreamingLLMStep extends BaseStreamingStep {
  readonly type = 'llm:ollama:streaming'

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

  private readonly baseUrl: string
  private readonly timeoutMs: number
  private streamedModel = ''
  private streamedUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  constructor(
    readonly id: PravahaId,
    readonly name: string,
    private readonly config: {
      baseUrl?: string
      defaultModel?: string
      timeoutMs?: number
    } = {},
  ) {
    super()
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
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
    const model = input.model ?? this.config.defaultModel ?? DEFAULT_MODEL
    const allMessages = [...context.messages, ...input.messages]
      .filter((m) => m.role !== 'tool')
      .map((m) => ({ role: m.role, content: m.content }))

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: allMessages,
          stream: true,
          options: { temperature: input.temperature },
        }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        throw new LLMInvalidResponseError('ollama', `HTTP ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const data = JSON.parse(line) as {
              model: string
              message?: { content: string }
              done: boolean
              prompt_eval_count?: number
              eval_count?: number
            }

            if (data.message?.content) {
              this.streamedModel = data.model
              yield data.message.content
            }

            if (data.done) {
              this.streamedUsage = {
                promptTokens: data.prompt_eval_count ?? 0,
                completionTokens: data.eval_count ?? 0,
                totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
              }
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch (err) {
      if (err instanceof LLMInvalidResponseError) throw err
      if (err instanceof Error && err.name === 'AbortError') {
        throw new LLMTimeoutError('ollama', this.timeoutMs, err)
      }
      throw new LLMInvalidResponseError(
        'ollama',
        err instanceof Error ? err.message : String(err),
        err,
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  protected async buildResponseFromStream(
    accumulated: string,
    _input: LLMRequest,
  ): Promise<LLMResponse> {
    return {
      content: accumulated,
      model: this.streamedModel || DEFAULT_MODEL,
      usage: this.streamedUsage,
      metadata: { ollamaBaseUrl: this.baseUrl },
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
