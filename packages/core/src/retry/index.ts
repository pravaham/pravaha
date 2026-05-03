import type { Step, StepResult } from '../step/index.js'
import type { ExecutionContext } from '../context/index.js'
import type { PravahaId, Metadata } from '../types/index.js'
import { PravahaError, StepExecutionError } from '../errors/index.js'
import { z } from 'zod'

/**
 * Retry policy configuration
 */
export interface RetryPolicy {
  /** Maximum number of attempts (including the first). Default: 3 */
  readonly maxAttempts?: number
  /** Initial backoff in milliseconds. Default: 1000 */
  readonly backoffMs?: number
  /**
   * Backoff multiplier for exponential backoff. Default: 2
   * Example: backoffMs=1000, multiplier=2 → 1s, 2s, 4s
   * Set to 1 for constant backoff.
   */
  readonly backoffMultiplier?: number
  /** Maximum backoff cap in milliseconds. Default: 30000 */
  readonly maxBackoffMs?: number
  /**
   * Error classes to retry on.
   * Only errors that are instances of these classes will trigger a retry.
   * Other errors are thrown immediately.
   * Default: retries on all PravahaError subclasses.
   */
  readonly retryOn?: ReadonlyArray<new (...args: never[]) => PravahaError>
}

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BACKOFF_MS = 1000
const DEFAULT_BACKOFF_MULTIPLIER = 2
const DEFAULT_MAX_BACKOFF_MS = 30_000

/**
 * Wraps a step with retry logic.
 *
 * Returns a new step that transparently retries the wrapped step
 * on specified errors. The original step is never modified.
 *
 * @example
 * const resilientClassify = withRetry(claudeClassifyStep, {
 *   maxAttempts: 3,
 *   backoffMs: 1000,
 *   backoffMultiplier: 2,
 *   retryOn: [LLMRateLimitError, LLMTimeoutError],
 * })
 *
 * // Use exactly like any other step
 * pipeline.step(resilientClassify, router)
 */
export function withRetry<TInput, TOutput>(
  step: Step<TInput, TOutput>,
  policy: RetryPolicy,
): Step<TInput, TOutput> {
  return new RetryStep(step, policy)
}

class RetryStep<TInput, TOutput> implements Step<TInput, TOutput> {
  readonly id: PravahaId
  readonly name: string
  readonly type: string
  readonly inputSchema: z.ZodType<TInput>
  readonly outputSchema: z.ZodType<TOutput>
  readonly metadata: Metadata

  private readonly maxAttempts: number
  private readonly backoffMs: number
  private readonly backoffMultiplier: number
  private readonly maxBackoffMs: number
  private readonly retryOn: ReadonlyArray<new (...args: never[]) => PravahaError> | undefined

  constructor(
    private readonly wrapped: Step<TInput, TOutput>,
    policy: RetryPolicy,
  ) {
    this.id = wrapped.id
    this.name = `${wrapped.name} [with retry]`
    this.type = wrapped.type
    this.inputSchema = wrapped.inputSchema
    this.outputSchema = wrapped.outputSchema
    this.metadata = { ...wrapped.metadata, retryPolicy: policy }
    this.maxAttempts = policy.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
    this.backoffMs = policy.backoffMs ?? DEFAULT_BACKOFF_MS
    this.backoffMultiplier = policy.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER
    this.maxBackoffMs = policy.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS
    this.retryOn = policy.retryOn
  }

  async execute(input: TInput, context: ExecutionContext): Promise<StepResult<TOutput>> {
    let lastError: PravahaError | undefined
    let currentBackoff = this.backoffMs

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const result = await this.wrapped.execute(input, context)

        return {
          output: result.output,
          context: {
            ...result.context,
            state: {
              ...result.context.state,
              [`${this.id}:attempts`]: attempt,
            },
          },
        }
      } catch (err) {
        const pravahaError =
          err instanceof PravahaError
            ? err
            : new StepExecutionError(this.id, err instanceof Error ? err.message : String(err), err)

        if (!this.shouldRetry(pravahaError)) {
          throw pravahaError
        }

        lastError = pravahaError

        if (attempt < this.maxAttempts) {
          await sleep(currentBackoff)
          currentBackoff = Math.min(currentBackoff * this.backoffMultiplier, this.maxBackoffMs)
        }
      }
    }

    // Safe: loop runs at least once (maxAttempts >= 1) and lastError is set on every failure
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    throw lastError!
  }

  private shouldRetry(error: PravahaError): boolean {
    if (!this.retryOn || this.retryOn.length === 0) return true
    return this.retryOn.some((ErrorClass) => error instanceof ErrorClass)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
