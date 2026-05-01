import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { FsTraceStore } from '../src/index.js'
import type { Trace } from '@pravaha/core'

const TEST_DIR = join(process.cwd(), '.test-traces')

function makeTrace(overrides: Partial<Trace> = {}): Trace {
  const now = Date.now()
  return {
    runId: `run-${Math.random().toString(36).slice(2)}`,
    pipelineId: 'test-pipeline',
    pipelineName: 'Test Pipeline',
    status: 'completed',
    startedAt: now,
    completedAt: now + 100,
    durationMs: 100,
    events: [],
    metadata: {},
    ...overrides,
  }
}

describe('FsTraceStore', () => {
  let store: FsTraceStore

  beforeEach(() => {
    store = new FsTraceStore({ traceDir: TEST_DIR })
  })

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true })
  })

  it('saves and retrieves a trace by runId', async () => {
    const trace = makeTrace()
    await store.save(trace)
    const retrieved = await store.getByRunId(trace.runId)
    expect(retrieved?.runId).toBe(trace.runId)
    expect(retrieved?.pipelineId).toBe('test-pipeline')
  })

  it('returns null for unknown runId', async () => {
    const result = await store.getByRunId('nonexistent-run')
    expect(result).toBeNull()
  })

  it('retrieves traces by pipelineId', async () => {
    const t1 = makeTrace({ runId: 'run-1' })
    const t2 = makeTrace({ runId: 'run-2' })
    await store.save(t1)
    await store.save(t2)

    const traces = await store.getByPipelineId('test-pipeline')
    expect(traces).toHaveLength(2)
  })

  it('returns empty array for unknown pipelineId', async () => {
    const traces = await store.getByPipelineId('nonexistent-pipeline')
    expect(traces).toEqual([])
  })

  it('respects limit in getByPipelineId', async () => {
    for (let i = 0; i < 5; i++) {
      await store.save(makeTrace({ runId: `run-${i}` }))
    }
    const traces = await store.getByPipelineId('test-pipeline', 3)
    expect(traces).toHaveLength(3)
  })

  it('enforces retention limit', async () => {
    const limitedStore = new FsTraceStore({
      traceDir: TEST_DIR,
      maxTracesPerPipeline: 3,
    })

    for (let i = 0; i < 5; i++) {
      await limitedStore.save(makeTrace({ runId: `run-${i}` }))
    }

    const traces = await limitedStore.getByPipelineId('test-pipeline', 100)
    expect(traces.length).toBeLessThanOrEqual(3)
  })

  it('persists trace as readable JSON', async () => {
    const trace = makeTrace({ runId: 'json-test' })
    await store.save(trace)

    const filePath = join(TEST_DIR, 'test-pipeline', 'json-test.json')
    const content = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(content) as { runId: string }
    expect(parsed.runId).toBe('json-test')
  })

  it('lists all pipeline IDs', async () => {
    await store.save(makeTrace({ pipelineId: 'pipeline-a' }))
    await store.save(makeTrace({ pipelineId: 'pipeline-b' }))

    const pipelines = await store.listPipelines()
    expect(pipelines).toContain('pipeline-a')
    expect(pipelines).toContain('pipeline-b')
  })

  it('clears all traces for a pipeline', async () => {
    await store.save(makeTrace())
    await store.clearPipeline('test-pipeline')

    const traces = await store.getByPipelineId('test-pipeline')
    expect(traces).toHaveLength(0)
  })

  it('creates trace dir automatically if missing', async () => {
    const newStore = new FsTraceStore({ traceDir: join(TEST_DIR, 'nested', 'dir') })
    await newStore.save(makeTrace())
    // No error thrown — dir was created
  })
})
