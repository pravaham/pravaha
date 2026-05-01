import { z } from 'zod'
import { BaseStep } from '../step/index.js'
import { ValidationError } from '../errors/index.js'
import { PipelineBuilder } from '../pipeline/index.js'
import type { Pipeline } from '../pipeline/index.js'
import type { Step } from '../step/index.js'
import type { ExecutionContext } from '../context/index.js'
import type { PravahaId } from '../types/index.js'

/**
 * Mock response registry for dry-run execution.
 * Maps step IDs to their mock output values.
 *
 * The mock value must conform to the step's outputSchema.
 * If it doesn't, a ValidationError is thrown — catching schema mismatches early.
 */
export type MockResponses = Readonly<Record<PravahaId, unknown>>

/**
 * Options for dry-run execution
 */
export interface DryRunOptions {
  /**
   * Mock responses keyed by step ID.
   * Steps without a mock entry execute normally.
   * Steps with a mock entry return the mock without executing real logic.
   */
  readonly mockResponses: MockResponses
  /**
   * If true, logs each step as it executes with mock/real indicator.
   * Default: false
   */
  readonly verbose?: boolean
}

/**
 * A step wrapper that returns a mock response instead of executing real logic.
 * Used internally by dry-run mode — not exported as public API.
 */
export class MockStep<TInput, TOutput> extends BaseStep<TInput, TOutput> {
  readonly type = 'mock'

  private readonly wrapped: Step<TInput, TOutput>
  private readonly mockOutput: unknown

  constructor(wrapped: Step<TInput, TOutput>, mockOutput: unknown) {
    super()
    this.wrapped = wrapped
    this.mockOutput = mockOutput
  }

  get id(): PravahaId {
    return this.wrapped.id
  }

  get name(): string {
    return `[MOCK] ${this.wrapped.name}`
  }

  get inputSchema(): z.ZodType<TInput> {
    return this.wrapped.inputSchema
  }

  get outputSchema(): z.ZodType<TOutput> {
    return this.wrapped.outputSchema
  }

  protected async run(_input: TInput, _context: ExecutionContext): Promise<TOutput> {
    const result = this.outputSchema.safeParse(this.mockOutput)
    if (!result.success) {
      throw new ValidationError(
        `${this.id}.mockOutput`,
        `Mock response does not match step output schema`,
        result.error.issues,
      )
    }
    return result.data
  }
}

/**
 * Builds a dry-run version of a pipeline by wrapping steps with mock responses.
 *
 * Returns a new pipeline instance with mock steps injected — the original
 * pipeline is never modified.
 *
 * @internal — used by Pipeline.dryRun()
 */
export function buildDryRunPipeline<TInput, TOutput>(
  pipeline: Pipeline<TInput, TOutput>,
  options: DryRunOptions,
): Pipeline<TInput, TOutput> {
  const builder = new PipelineBuilder<TInput, TOutput>({
    id: `${pipeline.id}:dryrun`,
    name: `${pipeline.name} [DRY RUN]`,
    version: '0.0.0',
    metadata: { dryRun: true },
  })

  for (const [stepId, registered] of pipeline.getStepEntries()) {
    if (options.verbose === true) {
      const isMocked = options.mockResponses[stepId] !== undefined
      console.log(`[DryRun] Step '${stepId}': ${isMocked ? 'MOCKED' : 'REAL'}`)
    }

    const mockOutput = options.mockResponses[stepId]
    const step =
      mockOutput !== undefined
        ? new MockStep(registered.step as Step<unknown, unknown>, mockOutput)
        : registered.step

    builder.step(step as Step<unknown, unknown>, registered.router)
  }

  return builder.build() as Pipeline<TInput, TOutput>
}
