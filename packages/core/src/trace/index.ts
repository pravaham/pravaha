import type { PravahaId, ExecutionStatus, Metadata } from '../types/index.js'

/**
 * A single event in the execution trace.
 * Every step execution produces one TraceEvent.
 * Immutable by design.
 */
export interface TraceEvent {
  readonly id: PravahaId
  readonly stepId: PravahaId
  readonly stepType: string
  readonly pipelineId: PravahaId
  readonly runId: PravahaId
  readonly status: ExecutionStatus
  readonly startedAt: number
  readonly completedAt: number
  readonly durationMs: number
  readonly input: unknown
  readonly output: unknown
  readonly error?: {
    readonly code: string
    readonly message: string
    readonly stack?: string
  }
  readonly metadata: Metadata
}

/**
 * Complete trace for a single pipeline run.
 * Contains all events in chronological order.
 */
export interface Trace {
  readonly runId: PravahaId
  readonly pipelineId: PravahaId
  readonly pipelineName: string
  readonly status: ExecutionStatus
  readonly startedAt: number
  readonly completedAt: number
  readonly durationMs: number
  readonly events: readonly TraceEvent[]
  readonly metadata: Metadata
}

/**
 * Port for persisting and retrieving traces.
 * Implement this interface for any storage backend.
 */
export interface TraceStore {
  save(trace: Trace): Promise<void>
  getByRunId(runId: PravahaId): Promise<Trace | null>
  getByPipelineId(pipelineId: PravahaId, limit?: number): Promise<readonly Trace[]>
}

/**
 * In-memory trace collector used during pipeline execution.
 * Accumulates events and produces the final Trace.
 */
export class TraceCollector {
  private readonly events: TraceEvent[] = []
  private readonly startedAt: number

  constructor(
    private readonly runId: PravahaId,
    private readonly pipelineId: PravahaId,
    private readonly pipelineName: string,
  ) {
    this.startedAt = Date.now()
  }

  /** Records a completed step event */
  recordEvent(event: Omit<TraceEvent, 'id' | 'runId' | 'pipelineId'>): void {
    this.events.push({
      ...event,
      id: crypto.randomUUID(),
      runId: this.runId,
      pipelineId: this.pipelineId,
    })
  }

  /** Builds the final immutable Trace */
  build(status: ExecutionStatus): Trace {
    const completedAt = Date.now()
    return Object.freeze({
      runId: this.runId,
      pipelineId: this.pipelineId,
      pipelineName: this.pipelineName,
      status,
      startedAt: this.startedAt,
      completedAt,
      durationMs: completedAt - this.startedAt,
      events: Object.freeze([...this.events]),
      metadata: {},
    })
  }
}
