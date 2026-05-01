import { describe, it, expect } from 'vitest'
import { generateTraceViewerHtml } from '../src/viewer/template.js'
import type { Trace } from '@pravaha/core'

function makeTrace(overrides: Partial<Trace> = {}): Trace {
  const now = Date.now()
  return {
    runId: 'test-run-abc123',
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
        runId: 'test-run-abc123',
        status: 'completed',
        startedAt: now,
        completedAt: now + 100,
        durationMs: 100,
        input: { text: 'billing issue' },
        output: { category: 'billing' },
        metadata: { routeReason: 'billing category' },
      },
    ],
    metadata: {},
    ...overrides,
  }
}

describe('generateTraceViewerHtml', () => {
  it('generates valid HTML structure', () => {
    const html = generateTraceViewerHtml([makeTrace()])
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<html')
    expect(html).toContain('</html>')
  })

  it('embeds trace data as JSON', () => {
    const trace = makeTrace()
    const html = generateTraceViewerHtml([trace])
    expect(html).toContain(trace.runId)
    expect(html).toContain('Test Pipeline')
  })

  it('handles empty trace list', () => {
    const html = generateTraceViewerHtml([])
    expect(html).toContain('[]')
  })

  it('includes all step IDs', () => {
    const html = generateTraceViewerHtml([makeTrace()])
    expect(html).toContain('classify')
  })

  it('escapes HTML in pipeline names', () => {
    const trace = makeTrace({ pipelineName: '<script>alert("xss")</script>' })
    const html = generateTraceViewerHtml([trace])
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('&lt;script&gt;')
  })

  it('handles multiple traces', () => {
    const traces = [
      makeTrace({ runId: 'run-1', pipelineName: 'Pipeline A' }),
      makeTrace({ runId: 'run-2', pipelineName: 'Pipeline B' }),
    ]
    const html = generateTraceViewerHtml(traces)
    expect(html).toContain('run-1')
    expect(html).toContain('run-2')
    expect(html).toContain('Pipeline A')
    expect(html).toContain('Pipeline B')
  })

  it('marks failed traces correctly', () => {
    const html = generateTraceViewerHtml([makeTrace({ status: 'failed' })])
    expect(html).toContain('failed')
  })

  it('is a self-contained file — no external script or stylesheet src', () => {
    const html = generateTraceViewerHtml([makeTrace()])
    expect(html).not.toContain('cdn.jsdelivr')
    expect(html).not.toContain('unpkg.com')
    expect(html).not.toContain('<script src=')
    expect(html).not.toContain('<link rel="stylesheet"')
  })
})
