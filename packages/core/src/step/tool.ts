import { z } from 'zod'
import { BaseStep } from './index.js'
import type { ExecutionContext } from '../context/index.js'
import type { PravahaId, Metadata } from '../types/index.js'

/**
 * Tool definition — a typed, named, executable function.
 *
 * Tools are the bridge between AI pipelines and the real world:
 * API calls, database queries, file operations, external services.
 *
 * @template TInput - Validated input type
 * @template TOutput - Validated output type
 */
export interface ToolDefinition<TInput, TOutput> {
  /** Unique tool identifier */
  readonly id: PravahaId
  /** Human-readable name shown in traces */
  readonly name: string
  /** Description used when exposing tool to LLMs */
  readonly description: string
  /** Zod schema for input validation */
  readonly inputSchema: z.ZodType<TInput>
  /** Zod schema for output validation */
  readonly outputSchema: z.ZodType<TOutput>
  /** The actual function to execute */
  execute(input: TInput, context: ExecutionContext): Promise<TOutput>
  /** Optional metadata */
  readonly metadata?: Metadata
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDefinition = ToolDefinition<any, any>
/**
 * ToolStep — executes a ToolDefinition as a pipeline step.
 *
 * Wraps any async function with:
 * - Schema validation on input and output
 * - Automatic trace recording
 * - Consistent error handling
 * - Full type safety
 *
 * @example
 * const searchTool = defineToolStep({
 *   id: 'kb-search',
 *   name: 'Knowledge Base Search',
 *   description: 'Searches the internal knowledge base for relevant articles',
 *   inputSchema: z.object({ query: z.string(), limit: z.number().default(5) }),
 *   outputSchema: z.object({ articles: z.array(ArticleSchema) }),
 *   execute: async ({ query, limit }) => knowledgeBase.search(query, limit),
 * })
 */
export class ToolStep<TInput, TOutput> extends BaseStep<TInput, TOutput> {
  readonly type = 'tool'

  readonly id: PravahaId
  readonly name: string
  readonly inputSchema: z.ZodType<TInput>
  readonly outputSchema: z.ZodType<TOutput>
  override readonly metadata: Metadata

  private readonly tool: ToolDefinition<TInput, TOutput>

  constructor(tool: ToolDefinition<TInput, TOutput>) {
    super()
    this.tool = tool
    this.id = tool.id
    this.name = tool.name
    this.inputSchema = tool.inputSchema
    this.outputSchema = tool.outputSchema
    this.metadata = {
      ...(tool.metadata ?? {}),
      toolDescription: tool.description,
    }
  }

  protected async run(input: TInput, context: ExecutionContext): Promise<TOutput> {
    return this.tool.execute(input, context)
  }
}

/**
 * Factory function — preferred way to create ToolSteps.
 * Cleaner than `new ToolStep(...)` for inline definitions.
 *
 * @example
 * const myStep = defineToolStep({
 *   id: 'fetch-ticket',
 *   name: 'Fetch Ticket',
 *   description: 'Fetches ticket details from ServiceNow',
 *   inputSchema: z.object({ ticketId: z.string() }),
 *   outputSchema: TicketSchema,
 *   execute: async ({ ticketId }) => serviceNow.getTicket(ticketId),
 * })
 */
export function defineToolStep<TInput, TOutput>(
  tool: ToolDefinition<TInput, TOutput>,
): ToolStep<TInput, TOutput> {
  return new ToolStep(tool)
}

/**
 * Converts a ToolDefinition to an LLM-compatible tool schema (OpenAI/Anthropic format).
 * Used when exposing tools to LLMs for function calling.
 */
export function toAnthropicTool(tool: ToolDefinition<unknown, unknown>): {
  name: string
  description: string
  input_schema: Record<string, unknown>
} {
  return {
    name: tool.id,
    description: tool.description,
    input_schema: zodToJsonSchema(tool.inputSchema),
  }
}

/**
 * Minimal Zod → JSON Schema converter for tool schemas.
 * Handles the common cases needed for LLM tool definitions.
 * For full JSON Schema output, use the `zod-to-json-schema` package in adapters.
 */
function zodToJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodType<unknown>>
    const properties: Record<string, unknown> = {}
    const required: string[] = []

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value)
      if (!(value instanceof z.ZodOptional)) {
        required.push(key)
      }
    }

    return { type: 'object', properties, required }
  }

  if (schema instanceof z.ZodString) return { type: 'string' }
  if (schema instanceof z.ZodNumber) return { type: 'number' }
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' }
  if (schema instanceof z.ZodArray) return { type: 'array', items: zodToJsonSchema(schema.element as z.ZodType<unknown>) }
  if (schema instanceof z.ZodOptional) return zodToJsonSchema(schema.unwrap() as z.ZodType<unknown>)
  if (schema instanceof z.ZodEnum) return { type: 'string', enum: schema.options as string[] }

  return {}
}
