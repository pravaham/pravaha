import { z } from 'zod'
import { BaseStep } from '../step/index.js'
import type { ExecutionContext } from '../context/index.js'
import type { PravahaId, Metadata } from '../types/index.js'
import type { AgentStepOutput } from './types.js'
import { AgentOutputParseError } from './errors.js'

/**
 * Parser strategy for AgentOutputParser.
 * Three built-in strategies plus custom function support.
 */
export type ParserStrategy<TOutput> =
  | { readonly type: 'json' }
  | { readonly type: 'regex'; readonly pattern: RegExp; readonly groupIndex?: number }
  | { readonly type: 'custom'; readonly parse: (content: string) => TOutput }

/**
 * Configuration for AgentOutputParser
 */
export interface AgentOutputParserConfig<TOutput> {
  readonly id: PravahaId
  readonly name: string
  readonly strategy: ParserStrategy<TOutput>
  readonly outputSchema: z.ZodType<TOutput>
  readonly metadata?: Metadata
}

/**
 * AgentOutputParser — transforms AgentStepOutput (string) into typed, validated output.
 *
 * Used immediately after AgentStep in a pipeline.
 * Handles JSON parsing, regex extraction, or custom parsing logic.
 *
 * Three strategies:
 *
 * 1. JSON — parses LLM response as JSON, validates against outputSchema
 * @example
 * const parser = defineAgentOutputParser({
 *   id: 'parse-classification',
 *   name: 'Parse Classification',
 *   strategy: { type: 'json' },
 *   outputSchema: z.object({ category: z.enum(['billing', 'technical', 'general']) }),
 * })
 *
 * 2. Regex — extracts a pattern from the response
 * @example
 * const parser = defineAgentOutputParser({
 *   id: 'extract-ticket-id',
 *   name: 'Extract Ticket ID',
 *   strategy: { type: 'regex', pattern: /TICKET-(\d+)/, groupIndex: 1 },
 *   outputSchema: z.string(),
 * })
 *
 * 3. Custom — full control over parsing
 * @example
 * const parser = defineAgentOutputParser({
 *   id: 'custom-parse',
 *   name: 'Custom Parse',
 *   strategy: {
 *     type: 'custom',
 *     parse: (content) => ({ summary: content.split('\n')[0], full: content }),
 *   },
 *   outputSchema: z.object({ summary: z.string(), full: z.string() }),
 * })
 */
export class AgentOutputParser<TOutput> extends BaseStep<AgentStepOutput, TOutput> {
  readonly type = 'agent:output-parser'
  readonly id: PravahaId
  readonly name: string
  override readonly metadata: Metadata

  readonly inputSchema = z.object({
    content: z.string().min(1),
    iterations: z.array(z.unknown()),
    totalUsage: z.object({
      promptTokens: z.number(),
      completionTokens: z.number(),
      totalTokens: z.number(),
    }),
  }) as z.ZodType<AgentStepOutput>

  readonly outputSchema: z.ZodType<TOutput>

  private readonly strategy: ParserStrategy<TOutput>

  constructor(config: AgentOutputParserConfig<TOutput>) {
    super()
    this.id = config.id
    this.name = config.name
    this.outputSchema = config.outputSchema
    this.strategy = config.strategy
    this.metadata = config.metadata ?? {}
  }

  protected run(input: AgentStepOutput, _context: ExecutionContext): Promise<TOutput> {
    const { content } = input

    switch (this.strategy.type) {
      case 'json':
        return Promise.resolve(this.parseJson(content))

      case 'regex':
        return Promise.resolve(this.parseRegex(content, this.strategy.pattern, this.strategy.groupIndex))

      case 'custom':
        return Promise.resolve(this.parseCustom(content, this.strategy.parse))
    }
  }

  private parseJson(content: string): TOutput {
    // Strip markdown code fences — LLMs often wrap JSON in ```json ... ```
    const stripped = content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()

    try {
      return JSON.parse(stripped) as TOutput
    } catch (err) {
      throw new AgentOutputParseError(
        this.id,
        `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        content,
        err,
      )
    }
  }

  private parseRegex(content: string, pattern: RegExp, groupIndex = 0): TOutput {
    const match = pattern.exec(content)
    if (!match) {
      throw new AgentOutputParseError(
        this.id,
        `Pattern ${pattern.toString()} did not match response`,
        content,
      )
    }

    const extracted = match[groupIndex]
    if (extracted === undefined) {
      throw new AgentOutputParseError(
        this.id,
        `Pattern matched but group ${groupIndex} is undefined`,
        content,
      )
    }

    return extracted as unknown as TOutput
  }

  private parseCustom(content: string, parse: (c: string) => TOutput): TOutput {
    try {
      return parse(content)
    } catch (err) {
      throw new AgentOutputParseError(
        this.id,
        err instanceof Error ? err.message : String(err),
        content,
        err,
      )
    }
  }
}

/**
 * Factory function — preferred way to create AgentOutputParsers.
 */
export function defineAgentOutputParser<TOutput>(
  config: AgentOutputParserConfig<TOutput>,
): AgentOutputParser<TOutput> {
  return new AgentOutputParser(config)
}
