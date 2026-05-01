import { z } from "zod";
import type { ExecutionContext } from "../context/index.js";
import type { PravahaId, Metadata } from "../types/index.js";
import { StepExecutionError, ValidationError } from "../errors/index.js";
import { PravahaError } from "../errors/index.js";
/**
 * Result of a step execution.
 * Contains the output and the (potentially updated) context.
 */
export interface StepResult<TOutput> {
  readonly output: TOutput;
  readonly context: ExecutionContext;
}

/**
 * Core Step interface — the fundamental unit of work in Pravaha.
 *
 * A Step is a pure, schema-validated, traceable unit that:
 * - Accepts typed input
 * - Returns typed output
 * - May update execution context
 * - Never mutates shared state
 *
 * @template TInput - Input type, validated by inputSchema
 * @template TOutput - Output type, validated by outputSchema
 */
export interface Step<TInput, TOutput> {
  /** Unique identifier within a pipeline */
  readonly id: PravahaId;
  /** Human-readable name for trace display */
  readonly name: string;
  /** Step type identifier for trace categorization */
  readonly type: string;
  /** Zod schema for input validation */
  readonly inputSchema: z.ZodType<TInput>;
  /** Zod schema for output validation */
  readonly outputSchema: z.ZodType<TOutput>;
  /** Step-level metadata */
  readonly metadata: Metadata;
  /**
   * Execute the step.
   * Must be pure — same input + context always produces same output.
   * Must not mutate context — return updated context in result.
   */
  execute(
    input: TInput,
    context: ExecutionContext,
  ): Promise<StepResult<TOutput>>;
}

/**
 * Abstract base class for steps.
 * Provides input/output validation and error wrapping automatically.
 * Extend this instead of implementing Step directly.
 */
export abstract class BaseStep<TInput, TOutput> implements Step<
  TInput,
  TOutput
> {
  abstract readonly id: PravahaId;
  abstract readonly name: string;
  abstract readonly type: string;
  abstract readonly inputSchema: z.ZodType<TInput>;
  abstract readonly outputSchema: z.ZodType<TOutput>;
  readonly metadata: Metadata = {};

  async execute(
    input: TInput,
    context: ExecutionContext,
  ): Promise<StepResult<TOutput>> {
    const inputResult = this.inputSchema.safeParse(input);
    if (!inputResult.success) {
      throw new ValidationError(
        `${this.id}.input`,
        "Input validation failed",
        inputResult.error.issues,
      );
    }

    let output: TOutput;
    try {
      output = await this.run(inputResult.data, context);
      // AFTER
    } catch (err) {
      if (err instanceof PravahaError) throw err; // pass through ALL Pravaha errors
      throw new StepExecutionError(
        this.id,
        err instanceof Error ? err.message : String(err),
        err,
      );
    }

    const outputResult = this.outputSchema.safeParse(output);
    if (!outputResult.success) {
      throw new ValidationError(
        `${this.id}.output`,
        "Output validation failed",
        outputResult.error.issues,
      );
    }

    return { output: outputResult.data, context };
  }

  /**
   * Implement step logic here.
   * Input is already validated when this is called.
   */
  protected abstract run(
    input: TInput,
    context: ExecutionContext,
  ): Promise<TOutput>;
}

/**
 * A step that transforms input to output using a pure function.
 * No LLM calls, no side effects.
 */
export class TransformStep<TInput, TOutput> extends BaseStep<TInput, TOutput> {
  readonly type = "transform";

  constructor(
    readonly id: PravahaId,
    readonly name: string,
    readonly inputSchema: z.ZodType<TInput>,
    readonly outputSchema: z.ZodType<TOutput>,
    private readonly transformer: (
      input: TInput,
      context: ExecutionContext,
    ) => TOutput | Promise<TOutput>,
  ) {
    super();
  }

  protected async run(
    input: TInput,
    context: ExecutionContext,
  ): Promise<TOutput> {
    return this.transformer(input, context);
  }
}
