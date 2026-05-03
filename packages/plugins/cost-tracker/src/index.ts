import type { PravahaPlugin, TraceEvent, Trace } from '@pravaha/core'

export interface TokenCost {
  readonly model: string
  readonly promptCostPer1k: number
  readonly completionCostPer1k: number
}

// Approximate costs in USD — update as pricing changes
const DEFAULT_COSTS: Record<string, TokenCost> = {
  'claude-opus-4-5': {
    model: 'claude-opus-4-5',
    promptCostPer1k: 0.015,
    completionCostPer1k: 0.075,
  },
  'claude-sonnet-4-5': {
    model: 'claude-sonnet-4-5',
    promptCostPer1k: 0.003,
    completionCostPer1k: 0.015,
  },
  'gpt-4-turbo': {
    model: 'gpt-4-turbo',
    promptCostPer1k: 0.01,
    completionCostPer1k: 0.03,
  },
  'gpt-3.5-turbo': {
    model: 'gpt-3.5-turbo',
    promptCostPer1k: 0.0005,
    completionCostPer1k: 0.0015,
  },
}

export interface StepCost {
  costUsd: number
  tokens: number
}

export interface CostSummary {
  readonly runId: string
  readonly totalCostUsd: number
  readonly totalTokens: number
  readonly promptTokens: number
  readonly completionTokens: number
  readonly byStep: Record<string, StepCost>
}

interface LLMOutputShape {
  model?: string
  usage?: {
    promptTokens: number
    completionTokens: number
  }
}

/**
 * Plugin that tracks LLM token costs across a pipeline run.
 * Attach to any pipeline that uses LLM steps for automatic cost accounting.
 */
export class CostTrackerPlugin implements PravahaPlugin {
  readonly name = 'cost-tracker'
  readonly version = '0.1.0'

  private readonly runCosts = new Map<string, CostSummary>()

  constructor(private readonly costs: Record<string, TokenCost> = DEFAULT_COSTS) {}

  onStepComplete(event: TraceEvent): void {
    if (!event.stepType.startsWith('llm:')) return

    const output = event.output as LLMOutputShape | null
    if (!output?.usage || !output.model) return

    const costConfig = this.costs[output.model]
    if (!costConfig) return

    const promptCost = (output.usage.promptTokens / 1000) * costConfig.promptCostPer1k
    const completionCost = (output.usage.completionTokens / 1000) * costConfig.completionCostPer1k
    const stepCost = promptCost + completionCost

    const existing: CostSummary = this.runCosts.get(event.runId) ?? {
      runId: event.runId,
      totalCostUsd: 0,
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      byStep: {},
    }

    const existingStepCost = existing.byStep[event.stepId]

    this.runCosts.set(event.runId, {
      ...existing,
      totalCostUsd: existing.totalCostUsd + stepCost,
      totalTokens: existing.totalTokens + output.usage.promptTokens + output.usage.completionTokens,
      promptTokens: existing.promptTokens + output.usage.promptTokens,
      completionTokens: existing.completionTokens + output.usage.completionTokens,
      byStep: {
        ...existing.byStep,
        [event.stepId]: {
          costUsd: (existingStepCost?.costUsd ?? 0) + stepCost,
          tokens:
            (existingStepCost?.tokens ?? 0) +
            output.usage.promptTokens +
            output.usage.completionTokens,
        },
      },
    })
  }

  // Intentionally unused — satisfies PravahaPlugin interface
  onPipelineComplete(_trace: Trace): void {
    // Cost summaries are retrieved via getCostSummary, not emitted
  }

  getCostSummary(runId: string): CostSummary | null {
    return this.runCosts.get(runId) ?? null
  }
}
