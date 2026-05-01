import { BaseStep } from '../step/index.js'
import type { ExecutionContext } from '../context/index.js'
import type { LLMRequest, LLMResponse } from '../types/index.js'
import { ValidationError } from '../errors/index.js'
import type { StreamChunk, StreamOptions, StreamingCapable } from './index.js'

/**
 * Abstract base class for LLM steps that support streaming.
 *
 * Subclasses implement:
 * - run() — standard non-streaming execution (required by BaseStep)
 * - runStream() — streaming execution returning AsyncGenerator<string>
 *
 * The execute() method from BaseStep works normally for non-streaming use.
 * The stream() method provides streaming access.
 */
export abstract class BaseStreamingStep
  extends BaseStep<LLMRequest, LLMResponse>
  implements StreamingCapable
{
  private lastResponse: LLMResponse | null = null

  getLastResponse(): LLMResponse | null {
    return this.lastResponse
  }

  async *stream(
    input: LLMRequest,
    context: ExecutionContext,
    options: StreamOptions = {},
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const inputResult = this.inputSchema.safeParse(input)
    if (!inputResult.success) {
      throw new ValidationError(
        `${this.id}.input`,
        'Input validation failed',
        inputResult.error.issues,
      )
    }

    let accumulated = ''
    let index = 0

    try {
      for await (const delta of this.runStream(inputResult.data, context)) {
        accumulated += delta

        const chunk: StreamChunk = { delta, accumulated, index: index++ }

        if (options.onChunk) {
          await options.onChunk(chunk)
        }

        yield chunk
      }

      const response = await this.buildResponseFromStream(accumulated, inputResult.data)
      this.lastResponse = response

      if (options.onComplete) {
        await options.onComplete(response)
      }
    } catch (err) {
      if (options.onError) {
        options.onError(err instanceof Error ? err : new Error(String(err)))
      }
      throw err
    }
  }

  /**
   * Implement streaming logic here.
   * Yields string deltas as they arrive from the LLM.
   */
  protected abstract runStream(
    input: LLMRequest,
    context: ExecutionContext,
  ): AsyncGenerator<string, void, unknown>

  /**
   * Build a complete LLMResponse from the accumulated stream content.
   * Override to include accurate token usage if the provider supplies it.
   */
  protected abstract buildResponseFromStream(
    accumulated: string,
    input: LLMRequest,
  ): Promise<LLMResponse>
}
