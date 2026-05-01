import type { LLMResponse, Metadata } from '../types/index.js'

/**
 * A single chunk from a streaming LLM response.
 * Carries an incremental token delta.
 */
export interface StreamChunk {
  /** Incremental text delta — append to build full response */
  readonly delta: string
  /** Cumulative text so far — convenience field */
  readonly accumulated: string
  /** Chunk index (0-based) */
  readonly index: number
  /** Provider-specific metadata for this chunk */
  readonly metadata?: Metadata
}

/**
 * Callback invoked for each stream chunk.
 * Alternative to async iteration for simpler use cases.
 */
export type StreamChunkCallback = (chunk: StreamChunk) => void | Promise<void>

/**
 * Options for streaming LLM calls
 */
export interface StreamOptions {
  /** Called for each chunk as it arrives */
  readonly onChunk?: StreamChunkCallback
  /** Called when stream completes with full response */
  readonly onComplete?: (response: LLMResponse) => void | Promise<void>
  /** Called if stream errors */
  readonly onError?: (error: Error) => void | Promise<void>
}

/**
 * Interface for steps that support streaming.
 *
 * Streaming steps implement both execute() (standard) and stream() (streaming).
 * This is a capability marker — not all steps need to implement it.
 *
 * Check if a step supports streaming:
 * @example
 * if (isStreamingStep(step)) {
 *   for await (const chunk of step.stream(input, ctx)) {
 *     process.stdout.write(chunk.delta)
 *   }
 * }
 */
export interface StreamingCapable {
  /**
   * Stream LLM response token by token.
   * Yields StreamChunk for each token received.
   * Resolves when stream is complete.
   */
  stream(
    input: unknown,
    context: unknown,
    options?: StreamOptions,
  ): AsyncGenerator<StreamChunk, void, unknown>

  /**
   * Returns the full LLMResponse after stream() completes.
   * Returns null if stream() has not been called yet.
   */
  getLastResponse(): LLMResponse | null
}

/**
 * Type guard — checks if a step implements StreamingCapable
 */
export function isStreamingStep(step: unknown): step is StreamingCapable {
  return (
    typeof step === 'object' &&
    step !== null &&
    'stream' in step &&
    typeof (step as StreamingCapable).stream === 'function'
  )
}

/**
 * Collects all chunks from a stream into a single string.
 * Utility for when you want streaming progress but need the full result.
 *
 * @example
 * const fullText = await collectStream(step.stream(input, ctx))
 */
export async function collectStream(
  generator: AsyncGenerator<StreamChunk, void, unknown>,
): Promise<string> {
  let accumulated = ''
  for await (const chunk of generator) {
    accumulated += chunk.delta
  }
  return accumulated
}
