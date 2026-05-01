import type { Step } from '../step/index.js'
import type { Router } from '../router/index.js'
import type { DryRunOptions } from '../dryrun/index.js'
import type { ExecutionContext } from '../context/index.js'
import { createExecutionContext, withState, withDepth } from '../context/index.js'
import { TraceCollector } from '../trace/index.js'
import type { Trace, TraceStore } from '../trace/index.js'
import type { MemoryStore } from '../memory/index.js'
import { PluginRegistry } from '../plugin/index.js'
import type { PravahaId, Metadata } from '../types/index.js'
import { PipelineConfigError, StepExecutionError, PravahaError } from '../errors/index.js'
import { LinearRouter } from '../router/index.js'

const MAX_DEPTH = 100

/**
 * Step registration within a pipeline —
 * binds a Step to its Router (what comes next)
 */
export interface PipelineStep<TInput = unknown, TOutput = unknown> {
  readonly step: Step<TInput, TOutput>
  readonly router: Router<TOutput>
}

/** Pipeline configuration */
export interface PipelineConfig {
  readonly id: PravahaId
  readonly name: string
  readonly description?: string
  readonly version: string
  readonly metadata: Metadata
}

/** Result of a pipeline execution */
export interface PipelineResult<TOutput> {
  readonly output: TOutput
  readonly trace: Trace
  readonly context: ExecutionContext
}

/**
 * Pipeline — the top-level orchestrator.
 *
 * Executes a series of steps, routing between them based on output,
 * collecting a full trace of every decision made.
 */
export class Pipeline<TInput, TOutput> {
  private readonly stepMap = new Map<PravahaId, PipelineStep>()
  private entryStepId: PravahaId | null = null

  constructor(
    private readonly config: PipelineConfig,
    private readonly plugins: PluginRegistry = new PluginRegistry(),
    private readonly traceStore?: TraceStore,
    _memory?: MemoryStore,
  ) {}

  /**
   * Register a step with its router.
   * First step registered becomes the entry point unless overridden.
   */
  addStep<SI, SO>(step: Step<SI, SO>, router: Router<SO>): this {
    if (this.stepMap.has(step.id)) {
      throw new PipelineConfigError(
        `Step '${step.id}' is already registered in pipeline '${this.config.id}'`,
      )
    }
    this.stepMap.set(step.id, { step, router } as PipelineStep)
    if (!this.entryStepId) {
      this.entryStepId = step.id
    }
    return this
  }

  /** Override the entry step (defaults to first registered) */
  setEntryStep(stepId: PravahaId): this {
    if (!this.stepMap.has(stepId)) {
      throw new PipelineConfigError(`Entry step '${stepId}' not found in pipeline`)
    }
    this.entryStepId = stepId
    return this
  }

  /**
   * Execute the pipeline with the given input.
   *
   * Returns a PipelineResult containing:
   * - The final output
   * - The complete execution trace
   * - The final execution context
   */
  async run(
    input: TInput,
    initialState: Record<string, unknown> = {},
  ): Promise<PipelineResult<TOutput>> {
    if (!this.entryStepId) {
      throw new PipelineConfigError(
        `Pipeline '${this.config.id}' has no steps registered`,
      )
    }

    const context = createExecutionContext(
      this.config.id,
      initialState,
      this.config.metadata,
    )
    const collector = new TraceCollector(context.runId, this.config.id, this.config.name)

    await this.plugins.emit('onPipelineStart', context)

    let currentStepId: PravahaId | null = this.entryStepId
    let currentInput: unknown = input
    let currentContext = context
    let finalOutput: unknown = input

    try {
      while (currentStepId !== null) {
        if (currentContext.depth > MAX_DEPTH) {
          throw new PipelineConfigError(
            `Maximum execution depth of ${MAX_DEPTH} exceeded. Possible infinite loop in pipeline '${this.config.id}'`,
          )
        }

        const registered = this.stepMap.get(currentStepId)
        if (!registered) {
          throw new PipelineConfigError(
            `Step '${currentStepId}' not found in pipeline '${this.config.id}'`,
          )
        }

        const { step, router } = registered
        const stepStart = Date.now()

        try {
          const result = await step.execute(currentInput, currentContext)
          const stepEnd = Date.now()

          const routeDecision = await router.route(result.output, result.context)

          const eventBase = {
            stepId: step.id,
            stepType: step.type,
            status: 'completed' as const,
            startedAt: stepStart,
            completedAt: stepEnd,
            durationMs: stepEnd - stepStart,
            input: currentInput,
            output: result.output,
            metadata: {
              ...step.metadata,
              routedTo: routeDecision.nextStepId,
              routeReason: routeDecision.reason,
            },
          }

          collector.recordEvent(eventBase)

          await this.plugins.emit('onStepComplete', {
            ...eventBase,
            id: crypto.randomUUID(),
            runId: context.runId,
            pipelineId: this.config.id,
          })

          finalOutput = result.output
          currentInput = result.output
          currentContext = withDepth(withState(result.context, { lastStepId: step.id }))
          currentStepId = routeDecision.nextStepId
        } catch (err) {
          const stepEnd = Date.now()
          const error =
            err instanceof PravahaError
              ? err
              : new StepExecutionError(
                  step.id,
                  err instanceof Error ? err.message : String(err),
                  err,
                )

          const errorInfo: {
            code: string
            message: string
            stack?: string
          } = { code: error.code, message: error.message }
          if (error.stack !== undefined) {
            errorInfo.stack = error.stack
          }

          collector.recordEvent({
            stepId: step.id,
            stepType: step.type,
            status: 'failed',
            startedAt: stepStart,
            completedAt: stepEnd,
            durationMs: stepEnd - stepStart,
            input: currentInput,
            output: null,
            error: errorInfo,
            metadata: step.metadata,
          })

          await this.plugins.emit('onError', error, currentContext)
          const failedTrace = collector.build('failed')
          if (this.traceStore) await this.traceStore.save(failedTrace)
          await this.plugins.emit('onPipelineComplete', failedTrace)

          throw error
        }
      }

      const trace = collector.build('completed')
      if (this.traceStore) await this.traceStore.save(trace)
      await this.plugins.emit('onPipelineComplete', trace)

      return {
        output: finalOutput as TOutput,
        trace,
        context: currentContext,
      }
    } catch (err) {
      if (err instanceof PravahaError) throw err
      throw new StepExecutionError(
        'pipeline',
        err instanceof Error ? err.message : String(err),
        err,
      )
    }
  }

  /**
   * Expose step entries for dry-run pipeline cloning.
   * Returns an iterator over [stepId, PipelineStep] pairs.
   * @internal
   */
  getStepEntries(): IterableIterator<[PravahaId, PipelineStep]> {
    return this.stepMap.entries()
  }

  /**
   * Execute this pipeline in dry-run mode.
   *
   * Runs the complete pipeline using mock responses for specified steps.
   * Full trace is produced. All routing logic is exercised.
   * Zero real LLM or external API calls are made for mocked steps.
   *
   * Steps without a mock entry in options.mockResponses execute normally.
   *
   * @example
   * const result = await pipeline.dryRun(input, {
   *   mockResponses: {
   *     'classify-ticket': { category: 'billing', confidence: 0.95, reasoning: 'mock' },
   *     'billing-response': { ticketId: 'TKT-001', category: 'billing', response: 'Mock', suggestedActions: [], escalate: false }
   *   },
   *   verbose: true
   * })
   * console.log(result.trace) // Full trace with mock steps marked
   */
  async dryRun(
    input: TInput,
    options: DryRunOptions,
    initialState: Record<string, unknown> = {},
  ): Promise<PipelineResult<TOutput>> {
    const { buildDryRunPipeline } = await import('../dryrun/index.js')
    const dryRunPipeline = buildDryRunPipeline(this, options)
    return dryRunPipeline.run(input, { ...initialState, dryRun: true })
  }

  get id(): PravahaId {
    return this.config.id
  }
  get name(): string {
    return this.config.name
  }
}

/**
 * Fluent builder for constructing pipelines.
 * Preferred over direct Pipeline construction.
 *
 * @example
 * const pipeline = new PipelineBuilder({ id: 'my-pipeline', name: 'My Pipeline', version: '1.0.0' })
 *   .step(classifyStep, new ConditionalRouter(...))
 *   .step(respondStep, new LinearRouter('respond', null))
 *   .build()
 */
export class PipelineBuilder<TInput, TOutput = TInput> {
  private readonly pipeline: Pipeline<TInput, TOutput>

  constructor(
    config: Omit<PipelineConfig, 'metadata'> & { metadata?: Metadata },
    plugins?: PluginRegistry,
    traceStore?: TraceStore,
    memory?: MemoryStore,
  ) {
    this.pipeline = new Pipeline<TInput, TOutput>(
      { metadata: {}, ...config },
      plugins,
      traceStore,
      memory,
    )
  }

  step<SI, SO>(step: Step<SI, SO>, router?: Router<SO>): this {
    const effectiveRouter =
      router ?? (new LinearRouter(`${step.id}-router`, null) as unknown as Router<SO>)
    this.pipeline.addStep(step, effectiveRouter)
    return this
  }

  build(): Pipeline<TInput, TOutput> {
    return this.pipeline
  }
}
