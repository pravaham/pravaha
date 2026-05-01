import { describe, it, expect } from 'vitest'
import { CostTrackerPlugin } from '../src/index.js'

function makeTraceEvent(overrides: Partial<Parameters<CostTrackerPlugin['onStepComplete']>[0]> = {}) {
  return {
    id: 'evt-1',
    stepId: 'llm-step',
    stepType: 'llm:claude',
    pipelineId: 'pipe-1',
    runId: 'run-1',
    status: 'completed' as const,
    startedAt: Date.now(),
    completedAt: Date.now(),
    durationMs: 100,
    input: {},
    output: {
      content: 'Hello',
      model: 'claude-sonnet-4-5',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    },
    metadata: {},
    ...overrides,
  }
}

describe('CostTrackerPlugin', () => {
  it('initializes with correct name and version', () => {
    const plugin = new CostTrackerPlugin()
    expect(plugin.name).toBe('cost-tracker')
    expect(plugin.version).toBe('0.1.0')
  })

  it('returns null for unknown runId', () => {
    const plugin = new CostTrackerPlugin()
    expect(plugin.getCostSummary('unknown-run')).toBeNull()
  })

  it('tracks cost for a known model', () => {
    const plugin = new CostTrackerPlugin()
    plugin.onStepComplete(makeTraceEvent())
    const summary = plugin.getCostSummary('run-1')
    expect(summary).not.toBeNull()
    expect(summary?.totalTokens).toBe(150)
    expect(summary?.totalCostUsd).toBeGreaterThan(0)
  })

  it('ignores non-llm step types', () => {
    const plugin = new CostTrackerPlugin()
    plugin.onStepComplete(makeTraceEvent({ stepType: 'tool', runId: 'run-2' }))
    expect(plugin.getCostSummary('run-2')).toBeNull()
  })

  it('ignores unknown models', () => {
    const plugin = new CostTrackerPlugin()
    plugin.onStepComplete(makeTraceEvent({
      runId: 'run-3',
      output: {
        content: 'Hi',
        model: 'unknown-model-xyz',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      },
    }))
    expect(plugin.getCostSummary('run-3')).toBeNull()
  })

  it('accumulates cost across multiple steps in same run', () => {
    const plugin = new CostTrackerPlugin()
    plugin.onStepComplete(makeTraceEvent({ stepId: 'step-1' }))
    plugin.onStepComplete(makeTraceEvent({ stepId: 'step-2' }))
    const summary = plugin.getCostSummary('run-1')
    expect(summary?.totalTokens).toBe(300)
    expect(summary?.byStep['step-1']).toBeDefined()
    expect(summary?.byStep['step-2']).toBeDefined()
  })

  it('tracks prompt and completion tokens separately', () => {
    const plugin = new CostTrackerPlugin()
    plugin.onStepComplete(makeTraceEvent())
    const summary = plugin.getCostSummary('run-1')
    expect(summary?.promptTokens).toBe(100)
    expect(summary?.completionTokens).toBe(50)
  })

  it('tracks costs across different runs independently', () => {
    const plugin = new CostTrackerPlugin()
    plugin.onStepComplete(makeTraceEvent({ runId: 'run-A' }))
    plugin.onStepComplete(makeTraceEvent({ runId: 'run-B' }))
    expect(plugin.getCostSummary('run-A')?.totalTokens).toBe(150)
    expect(plugin.getCostSummary('run-B')?.totalTokens).toBe(150)
  })

  it('calculates cost correctly for claude-sonnet', () => {
    const plugin = new CostTrackerPlugin()
    // 1000 prompt tokens at $0.003/1k = $0.003
    // 500 completion tokens at $0.015/1k = $0.0075
    plugin.onStepComplete(makeTraceEvent({
      output: {
        content: 'Hi',
        model: 'claude-sonnet-4-5',
        usage: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
      },
    }))
    const summary = plugin.getCostSummary('run-1')
    expect(summary?.totalCostUsd).toBeCloseTo(0.0105, 6)
  })
})