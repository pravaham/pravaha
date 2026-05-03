import { z } from 'zod'
import { BaseStep } from '../step/index.js'
import type { StepResult } from '../step/index.js'
import type { ToolDefinition } from '../step/tool.js'
import type { ExecutionContext } from '../context/index.js'
import { withMessages } from '../context/index.js'
import type { PravahaId, LLMMessage, Metadata } from '../types/index.js'
import type {
  ToolCallingAdapter,
  ToolCallResult,
  AgentIteration,
  AgentStepOutput,
} from './types.js'
import { PravahaError } from '../errors/index.js'
import {
  AgentMaxIterationsError,
  AgentToolNotFoundError,
  AgentInvalidToolInputError,
} from './errors.js'

const DEFAULT_MAX_ITERATIONS = 10

/**
 * Configuration for AgentStep
 */
export interface AgentStepConfig {
  readonly id: PravahaId
  readonly name: string
  /** The tool-calling capable LLM adapter */
  readonly adapter: ToolCallingAdapter
  /** Tools available to the agent */
  readonly tools: readonly ToolDefinition<unknown, unknown>[]
  /** System prompt injected at the start of every agent run */
  readonly systemPrompt?: string
  /**
   * Maximum number of LLM iterations before throwing AgentMaxIterationsError.
   * Prevents infinite loops. Default: 10
   */
  readonly maxIterations?: number
  readonly metadata?: Metadata
}

/**
 * AgentStep — the core agentic loop in Pravaha.
 *
 * Executes a think-act-observe loop:
 * 1. Call LLM with available tools
 * 2. If LLM requests tool calls → execute tools → feed results back → repeat
 * 3. If LLM returns text → return AgentStepOutput
 * 4. If max iterations hit → throw AgentMaxIterationsError
 *
 * Output is always a string (AgentStepOutput.content).
 * Use AgentOutputParser after this step to parse into typed output.
 *
 * @example
 * const agent = new AgentStep({
 *   id: 'support-agent',
 *   name: 'Support Agent',
 *   adapter: new ClaudeToolCallingAdapter({ apiKey: process.env.ANTHROPIC_API_KEY }),
 *   tools: [searchKBTool, lookupCustomerTool, createTicketTool],
 *   systemPrompt: 'You are a support agent. Use tools to resolve customer issues.',
 *   maxIterations: 10,
 * })
 */
export class AgentStep extends BaseStep<string, AgentStepOutput> {
  readonly type = 'agent'
  readonly id: PravahaId
  readonly name: string
  override readonly metadata: Metadata

  readonly inputSchema = z.string() as z.ZodType<string>
  readonly outputSchema = z.object({
    content: z.string().min(1),
    iterations: z.array(
      z.object({
        iteration: z.number(),
        response: z.unknown(),
        toolCallResults: z.array(z.unknown()).optional(),
        durationMs: z.number(),
      }),
    ),
    totalUsage: z.object({
      promptTokens: z.number(),
      completionTokens: z.number(),
      totalTokens: z.number(),
    }),
  }) as z.ZodType<AgentStepOutput>

  private readonly adapter: ToolCallingAdapter
  private readonly tools: readonly ToolDefinition<unknown, unknown>[]
  private readonly toolMap: ReadonlyMap<string, ToolDefinition<unknown, unknown>>
  private readonly systemPrompt: string | undefined
  private readonly maxIterations: number

  constructor(config: AgentStepConfig) {
    super()
    this.id = config.id
    this.name = config.name
    this.adapter = config.adapter
    this.tools = config.tools
    this.toolMap = new Map(config.tools.map((t) => [t.id, t]))
    this.systemPrompt = config.systemPrompt
    this.maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS
    this.metadata = config.metadata ?? {}
  }

  protected async run(input: string, context: ExecutionContext): Promise<AgentStepOutput> {
    const iterations: AgentIteration[] = []
    const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

    const messages: LLMMessage[] = [...context.messages]

    if (this.systemPrompt) {
      messages.unshift({ role: 'system', content: this.systemPrompt })
    }

    messages.push({ role: 'user', content: input })

    let currentMessages: LLMMessage[] = [...messages]

    for (let i = 0; i < this.maxIterations; i++) {
      const iterStart = Date.now()

      const response = await this.adapter.chat(currentMessages, this.tools)

      totalUsage.promptTokens += response.usage.promptTokens
      totalUsage.completionTokens += response.usage.completionTokens
      totalUsage.totalTokens += response.usage.totalTokens

      if (response.type === 'text') {
        iterations.push({
          iteration: i + 1,
          response,
          durationMs: Date.now() - iterStart,
        })

        return {
          content: response.content,
          iterations,
          totalUsage,
        }
      }

      // Tool calls — execute and loop
      const toolCallResults: ToolCallResult[] = []

      for (const toolCall of response.toolCalls) {
        const tool = this.toolMap.get(toolCall.toolId)

        if (!tool) {
          throw new AgentToolNotFoundError(
            this.id,
            toolCall.toolId,
            Array.from(this.toolMap.keys()),
          )
        }

        const inputValidation = tool.inputSchema.safeParse(toolCall.input)
        if (!inputValidation.success) {
          throw new AgentInvalidToolInputError(
            this.id,
            toolCall.toolId,
            'Input validation failed',
            inputValidation.error.issues,
          )
        }

        try {
          const output = await tool.execute(inputValidation.data, context)
          toolCallResults.push({ callId: toolCall.id, output })
        } catch (err) {
          // Tool errors are fed back to LLM as error results — not thrown.
          // This allows LLM to recover and try a different approach.
          // Unwrap PravahaError.cause to surface the root error message.
          const cause = err instanceof PravahaError && err.cause instanceof Error ? err.cause : null
          toolCallResults.push({
            callId: toolCall.id,
            output: null,
            error: cause ? cause.message : err instanceof Error ? err.message : String(err),
          })
        }
      }

      iterations.push({
        iteration: i + 1,
        response,
        toolCallResults,
        durationMs: Date.now() - iterStart,
      })

      const assistantMessage: LLMMessage = {
        role: 'assistant',
        content: JSON.stringify(response.toolCalls),
      }

      const resultMessages = this.adapter.buildToolResultMessage(toolCallResults)
      const resultMessageArray = Array.isArray(resultMessages)
        ? (resultMessages as readonly LLMMessage[])
        : [resultMessages as LLMMessage]

      currentMessages = [...currentMessages, assistantMessage, ...resultMessageArray]
    }

    throw new AgentMaxIterationsError(this.id, this.maxIterations, this.maxIterations)
  }

  /** Override execute to update context with full agent conversation */
  override async execute(
    input: string,
    context: ExecutionContext,
  ): Promise<StepResult<AgentStepOutput>> {
    const result = await super.execute(input, context)

    const updatedContext = withMessages(context, [
      { role: 'user', content: input },
      { role: 'assistant', content: result.output.content },
    ])

    return { output: result.output, context: updatedContext }
  }
}
