/**
 * Base error class for all Pravaha errors.
 * All errors carry a machine-readable code for programmatic handling.
 */
export abstract class PravahaError extends Error {
  abstract readonly code: string

  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message)
    this.name = this.constructor.name
    // V8-specific — improves stack traces in Node.js
    const errorCtor = Error as typeof Error & {
      captureStackTrace?: (target: object, ctor: unknown) => void
    }
    if (errorCtor.captureStackTrace) {
      errorCtor.captureStackTrace(this, this.constructor)
    }
  }
}

/** Thrown when a step fails during execution */
export class StepExecutionError extends PravahaError {
  readonly code = 'STEP_EXECUTION_ERROR'

  constructor(
    public readonly stepId: string,
    message: string,
    cause?: unknown,
  ) {
    super(`Step '${stepId}' failed: ${message}`, cause)
  }
}

/** Thrown when a router cannot determine the next step */
export class RouterError extends PravahaError {
  readonly code = 'ROUTER_ERROR'

  constructor(
    public readonly routerId: string,
    message: string,
    cause?: unknown,
  ) {
    super(`Router '${routerId}' error: ${message}`, cause)
  }
}

/** Base class for all adapter errors */
export abstract class AdapterError extends PravahaError {
  constructor(
    public readonly adapterName: string,
    message: string,
    cause?: unknown,
  ) {
    super(`Adapter '${adapterName}': ${message}`, cause)
  }
}

/** Thrown when LLM request times out */
export class LLMTimeoutError extends AdapterError {
  readonly code = 'LLM_TIMEOUT'

  constructor(adapterName: string, timeoutMs: number, cause?: unknown) {
    super(adapterName, `Request timed out after ${timeoutMs}ms`, cause)
  }
}

/** Thrown when LLM rate limit is hit */
export class LLMRateLimitError extends AdapterError {
  readonly code = 'LLM_RATE_LIMIT'

  constructor(
    adapterName: string,
    public readonly retryAfterMs?: number,
    cause?: unknown,
  ) {
    super(
      adapterName,
      `Rate limit exceeded${retryAfterMs !== undefined ? `. Retry after ${retryAfterMs}ms` : ''}`,
      cause,
    )
  }
}

/** Thrown when LLM returns an invalid or unparseable response */
export class LLMInvalidResponseError extends AdapterError {
  readonly code = 'LLM_INVALID_RESPONSE'

  constructor(adapterName: string, message: string, cause?: unknown) {
    super(adapterName, `Invalid response: ${message}`, cause)
  }
}

/** Thrown when input/output schema validation fails */
export class ValidationError extends PravahaError {
  readonly code = 'VALIDATION_ERROR'

  constructor(
    public readonly field: string,
    message: string,
    public readonly issues?: unknown[],
  ) {
    super(`Validation failed for '${field}': ${message}`)
  }
}

/** Thrown when pipeline configuration is invalid */
export class PipelineConfigError extends PravahaError {
  readonly code = 'PIPELINE_CONFIG_ERROR'

  constructor(message: string, cause?: unknown) {
    super(`Pipeline configuration error: ${message}`, cause)
  }
}

/** Thrown when memory operations fail */
export class MemoryError extends PravahaError {
  readonly code = 'MEMORY_ERROR'

  constructor(message: string, cause?: unknown) {
    super(`Memory error: ${message}`, cause)
  }
}
