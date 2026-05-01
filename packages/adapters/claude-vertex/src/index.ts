import { AnthropicVertex } from '@anthropic-ai/vertex-sdk'
import { z } from 'zod'
import {
  BaseStep,
  LLMTimeoutError,
  LLMRateLimitError,
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
  AnyToolDefinition,
  LLMMessage,
} from '@pravaha/core'

/**
 * Vertex AI region identifiers for Claude deployments.
 * Only these regions support Claude on Vertex AI.
 */
export type VertexRegion =
  | 'us-central1'
  | 'us-east4'
  | 'europe-west1'
  | 'europe-west4'
  | 'asia-southeast1'

/**
 * Configuration for the Vertex AI Claude adapter.
 *
 * Authentication is handled via Google Application Default Credentials (ADC).
 * No API key required — set up ADC via:
 *   - Workload Identity (GKE/Cloud Run) — recommended for production
 *   - Service Account key file — for local dev: GOOGLE_APPLICATION_CREDENTIALS env var
 *   - gcloud auth application-default login — for local dev
 */
export interface ClaudeVertexAdapterConfig {
  /** GCP Project ID */
  readonly projectId: string
  /** Vertex AI region — must be a Claude-supported region */
  readonly region: VertexRegion
  /**
   * Model ID in Vertex AI format: `{model-name}@{version}`
   * Example: 'claude-3-5-sonnet@20241022'
   * Leave undefined to use DEFAULT_VERTEX_MODEL
   */
  readonly defaultModel?: string
  readonly defaultMaxTokens?: number
  readonly timeoutMs?: number
}

const DEFAULT_VERTEX_MODEL = 'claude-3-5-sonnet@20241022'
const DEFAULT_MAX_TOKENS = 4096

/**
 * Maps short model names to Vertex AI versioned model IDs.
 * Vertex AI requires pinned versions — floating model names are not supported.
 */
const MODEL_VERSION_MAP: Record<string, string> = {
  'claude-opus-4-5': 'claude-3-opus@20240229',
  'claude-sonnet-4-5': 'claude-3-5-sonnet@20241022',
  'claude-haiku': 'claude-3-haiku@20240307',
}

function resolveVertexModel(model: string): string {
  if (model.includes('@')) return model
  return MODEL_VERSION_MAP[model] ?? DEFAULT_VERTEX_MODEL
}

/**
 * LLM Step backed by Anthropic Claude via Google Cloud Vertex AI.
 *
 * Drop-in replacement for ClaudeLLMStep when deploying on GCP.
 * Authentication uses Application Default Credentials — no API key needed.
 *
 * Pipeline code requires ZERO changes when switching between direct and Vertex:
 *
 * @example
 * // Development
 * import { ClaudeLLMStep } from '@pravaha/adapter-claude'
 *
 * // Production on GCP — identical interface
 * import { ClaudeVertexLLMStep } from '@pravaha/adapter-claude-vertex'
 */
export class ClaudeVertexLLMStep extends BaseStep<LLMRequest, LLMResponse> {
  readonly type = 'llm:claude-vertex'

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

  private readonly client: AnthropicVertex

  constructor(
    readonly id: PravahaId,
    readonly name: string,
    private readonly config: ClaudeVertexAdapterConfig,
  ) {
    super()
    this.client = new AnthropicVertex({
      projectId: config.projectId,
      region: config.region,
    })
  }

  protected async run(input: LLMRequest, context: ExecutionContext): Promise<LLMResponse> {
    const rawModel = input.model ?? this.config.defaultModel ?? DEFAULT_VERTEX_MODEL
    const model = resolveVertexModel(rawModel)
    const maxTokens = input.maxTokens ?? this.config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS

    const allMessages = [...context.messages, ...input.messages]
    const systemMessages = allMessages.filter((m) => m.role === 'system')
    const conversationMessages = allMessages.filter((m) => m.role !== 'system')
    const systemPrompt = systemMessages.map((m) => m.content).join('\n\n')

    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt || undefined,
        temperature: input.temperature,
        messages: conversationMessages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      })

      const content = response.content[0]
      if (!content || content.type !== 'text') {
        throw new LLMInvalidResponseError('claude-vertex', 'Expected text content block in response')
      }

      return {
        content: content.text,
        model: response.model,
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        },
        metadata: {
          vertexProjectId: this.config.projectId,
          vertexRegion: this.config.region,
        },
      }
    } catch (err) {
      if (err instanceof LLMInvalidResponseError) throw err

      const message = err instanceof Error ? err.message : String(err)

      if (message.includes('RESOURCE_EXHAUSTED') || message.includes('429')) {
        throw new LLMRateLimitError('claude-vertex', undefined, err)
      }
      if (message.includes('DEADLINE_EXCEEDED') || message.includes('timeout')) {
        throw new LLMTimeoutError('claude-vertex', this.config.timeoutMs ?? 60_000, err)
      }
      throw new LLMInvalidResponseError('claude-vertex', message, err)
    }
  }

  override async execute(input: LLMRequest, context: ExecutionContext): Promise<StepResult<LLMResponse>> {
    const result = await super.execute(input, context)
    const updatedContext = withMessages(result.context, [
      ...input.messages,
      { role: 'assistant', content: result.output.content },
    ])
    return { output: result.output, context: updatedContext }
  }
}

/**
 * Vertex AI implementation of ToolCallingAdapter.
 *
 * Drop-in replacement for ClaudeToolCallingAdapter when deploying on GCP.
 * Uses Application Default Credentials — no API key needed.
 *
 * @example
 * const adapter = new ClaudeVertexToolCallingAdapter({
 *   projectId: 'my-gcp-project',
 *   region: 'europe-west1',
 * })
 *
 * const agent = new AgentStep({
 *   id: 'support-agent',
 *   adapter,
 *   tools: [searchTool, lookupTool],
 * })
 */
export class ClaudeVertexToolCallingAdapter implements ToolCallingAdapter {
  readonly adapterName = 'claude-vertex'
  private readonly client: AnthropicVertex
  private readonly defaultModel: string
  private readonly defaultMaxTokens: number
  private readonly projectId: string
  private readonly region: VertexRegion

  constructor(config: ClaudeVertexAdapterConfig) {
    this.client = new AnthropicVertex({
      projectId: config.projectId,
      region: config.region,
    })
    this.projectId = config.projectId
    this.region = config.region
    this.defaultModel = config.defaultModel ?? DEFAULT_VERTEX_MODEL
    this.defaultMaxTokens = config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS
  }

  async chat(
    messages: readonly LLMMessage[],
    tools: readonly AnyToolDefinition[],
    options?: ToolCallingOptions,
  ): Promise<AgentLLMResponse> {
    const rawModel = options?.model ?? this.defaultModel
    const model = resolveVertexModel(rawModel)
    const maxTokens = options?.maxTokens ?? this.defaultMaxTokens

    const systemMessages = messages.filter((m) => m.role === 'system')
    const conversationMessages = messages.filter((m) => m.role !== 'system')
    const systemPrompt = [
      ...(options?.systemPrompt ? [options.systemPrompt] : []),
      ...systemMessages.map((m) => m.content),
    ].join('\n\n')

    const anthropicTools = tools.map(toAnthropicTool)

    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt || undefined,
        temperature: options?.temperature,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: anthropicTools as any,
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolUseBlocks = response.content.filter((b: any) => b.type === 'tool_use')

      if (toolUseBlocks.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolCalls: ToolCallRequest[] = toolUseBlocks.map((block: any) => ({
          id: block.id as string,
          toolId: block.name as string,
          input: block.input,
        }))
        return {
          type: 'tool_calls',
          toolCalls,
          usage,
          model: response.model,
          metadata: { vertexProjectId: this.projectId, vertexRegion: this.region },
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const textBlock = response.content.find((b: any) => b.type === 'text')
      if (!textBlock) {
        throw new LLMInvalidResponseError('claude-vertex', 'No text or tool_use block in response')
      }

      return {
        type: 'text',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content: (textBlock as any).text as string,
        usage,
        model: response.model,
        metadata: { vertexProjectId: this.projectId, vertexRegion: this.region },
      }
    } catch (err) {
      if (err instanceof LLMInvalidResponseError) throw err
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('RESOURCE_EXHAUSTED') || message.includes('429')) {
        throw new LLMRateLimitError('claude-vertex', undefined, err)
      }
      if (message.includes('DEADLINE_EXCEEDED') || message.includes('timeout')) {
        throw new LLMTimeoutError('claude-vertex', 60_000, err)
      }
      throw new LLMInvalidResponseError('claude-vertex', message, err)
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
