import type { PravahaId, LLMMessage, Metadata } from '../types/index.js'

/**
 * Immutable execution context passed through every step in a pipeline run.
 * Never mutate this directly — use withXxx methods to produce new context.
 *
 * This is the single source of truth for all state during a pipeline run.
 */
export interface ExecutionContext {
  /** Unique ID for this pipeline run */
  readonly runId: PravahaId
  /** ID of the pipeline being executed */
  readonly pipelineId: PravahaId
  /** Conversation history for LLM steps */
  readonly messages: readonly LLMMessage[]
  /** Shared state accessible across steps — use sparingly */
  readonly state: Readonly<Record<string, unknown>>
  /** Run-level metadata */
  readonly metadata: Metadata
  /** Step execution depth — used to detect circular routes */
  readonly depth: number
}

/** Creates the initial execution context for a pipeline run */
export function createExecutionContext(
  pipelineId: PravahaId,
  initialState: Record<string, unknown> = {},
  metadata: Metadata = {},
): ExecutionContext {
  return Object.freeze({
    runId: crypto.randomUUID(),
    pipelineId,
    messages: Object.freeze([]),
    state: Object.freeze(initialState),
    metadata: Object.freeze(metadata),
    depth: 0,
  })
}

/**
 * Returns a new context with additional messages appended.
 * Original context is never modified.
 */
export function withMessages(
  ctx: ExecutionContext,
  messages: readonly LLMMessage[],
): ExecutionContext {
  return Object.freeze({
    ...ctx,
    messages: Object.freeze([...ctx.messages, ...messages]),
  })
}

/**
 * Returns a new context with state merged.
 * Original context is never modified.
 */
export function withState(ctx: ExecutionContext, state: Record<string, unknown>): ExecutionContext {
  return Object.freeze({
    ...ctx,
    state: Object.freeze({ ...ctx.state, ...state }),
  })
}

/** Returns a new context with incremented depth. */
export function withDepth(ctx: ExecutionContext): ExecutionContext {
  return Object.freeze({ ...ctx, depth: ctx.depth + 1 })
}
