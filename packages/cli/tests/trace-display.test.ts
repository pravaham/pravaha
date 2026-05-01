import { describe, it, expect } from 'vitest'
import { renderTrace, renderTraceSummary } from '../src/display/trace.js'
import { renderTraceDiff } from '../src/display/diff.js'
import type { Trace } from '@pravaha/core'

function makeTrace(overrides: Partial<Trace> = {}): Trace {
  const now = Date.now()
  return {
    runId: 'test-run-id-123',
    pipelineId: 'test-pipeline',
    pipelineName: 'Test Pipeline',
    status: 'completed',
    startedAt: now,
    completedAt: now + 250,
    durationMs: 250,
    events: [
      {
        id: 'evt-1',
        stepId: 'classify',
        stepType: 'transform',
        pipelineId: 'test-pipeline',
        runId: 'test-run-id-123',
        status: 'completed',
        startedAt: now,
        completedAt: now + 100,
        durationMs: 100,
        input: { text: 'hello' },
        output: { category: 'billing' },
        metadata: { routeReason: 'billing category detected' },
      },
      {
        id: 'evt-2',
        stepId: 'billing-response',
        stepType: 'llm:mock',
        pipelineId: 'test-pipeline',
        runId: 'test-run-id-123',
        status: 'completed',
        startedAt: now + 100,
        completedAt: now + 250,
        durationMs: 150,
        input: { category: 'billing' },
        output: { response: 'Here is your refund' },
        metadata: { routeReason: 'Pipeline complete' },
      },
    ],
    metadata: {},
    ...overrides,
  }
}

describe('renderTrace', () => {
  it('includes pipeline name', () => {
    const output = renderTrace(makeTrace())
    expect(output).toContain('Test Pipeline')
  })

  it('includes run ID', () => {
    const output = renderTrace(makeTrace())
    expect(output).toContain('test-run-id-123')
  })

  it('includes all step IDs', () => {
    const output = renderTrace(makeTrace())
    expect(output).toContain('classify')
    expect(output).toContain('billing-response')
  })

  it('includes step durations', () => {
    const output = renderTrace(makeTrace())
    expect(output).toContain('100ms')
    expect(output).toContain('150ms')
  })

  it('shows COMPLETED for successful trace', () => {
    const output = renderTrace(makeTrace())
    expect(output.toLowerCase()).toContain('completed')
  })

  it('shows FAILED for failed trace', () => {
    const output = renderTrace(makeTrace({ status: 'failed' }))
    expect(output.toLowerCase()).toContain('failed')
  })

  it('shows error details for failed steps', () => {
    const trace = makeTrace()
    const events = [...trace.events]
    events[0] = {
      ...events[0]!,
      status: 'failed',
      error: { code: 'STEP_EXECUTION_ERROR', message: 'Connection refused' },
    }
    const output = renderTrace({ ...trace, events, status: 'failed' })
    expect(output).toContain('Connection refused')
  })
})

describe('renderTraceSummary', () => {
  it('includes run ID prefix', () => {
    const output = renderTraceSummary(makeTrace(), 1)
    expect(output).toContain('test-run')
  })

  it('includes duration', () => {
    const output = renderTraceSummary(makeTrace(), 1)
    expect(output).toContain('250ms')
  })
})

describe('renderTraceDiff', () => {
  it('shows both run IDs', () => {
    const a = makeTrace({ runId: 'run-a' })
    const b = makeTrace({ runId: 'run-b' })
    const output = renderTraceDiff(a, b)
    expect(output).toContain('run-a')
    expect(output).toContain('run-b')
  })

  it('detects step present only in A', () => {
    const a = makeTrace()
    const b = makeTrace({ events: [a.events[1]!] })
    const output = renderTraceDiff(a, b)
    expect(output).toContain('A only')
    expect(output).toContain('classify')
  })

  it('detects step present only in B', () => {
    const a = makeTrace({ events: [makeTrace().events[0]!] })
    const b = makeTrace()
    const output = renderTraceDiff(a, b)
    expect(output).toContain('B only')
  })

  it('shows duration delta', () => {
    const a = makeTrace({ durationMs: 100 })
    const b = makeTrace({ durationMs: 250 })
    const output = renderTraceDiff(a, b)
    expect(output).toContain('150ms')
  })
})
