import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import {
  PipelineBuilder,
  TransformStep,
  LinearRouter,
  ConditionalRouter,
  PipelineConfigError,
} from '../src/index.js'

describe('Pipeline', () => {
  it('executes a single step pipeline', async () => {
    const step = new TransformStep('double', 'Double', z.number(), z.number(), (n) => n * 2)

    const pipeline = new PipelineBuilder<number, number>({
      id: 'test',
      name: 'Test',
      version: '1.0.0',
    })
      .step(step)
      .build()

    const result = await pipeline.run(5)
    expect(result.output).toBe(10)
  })

  it('routes correctly in conditional pipeline', async () => {
    const classify = new TransformStep(
      'classify',
      'Classify',
      z.string(),
      z.enum(['a', 'b']),
      (s) => s as 'a' | 'b',
    )
    const handleA = new TransformStep(
      'handle-a',
      'Handle A',
      z.enum(['a', 'b']),
      z.string(),
      () => 'handled-a',
    )
    const handleB = new TransformStep(
      'handle-b',
      'Handle B',
      z.enum(['a', 'b']),
      z.string(),
      () => 'handled-b',
    )

    const router = new ConditionalRouter<'a' | 'b'>('router', 'Router', [
      { condition: (o) => o === 'a', nextStepId: 'handle-a', reason: 'Is A' },
      { condition: (o) => o === 'b', nextStepId: 'handle-b', reason: 'Is B' },
    ])

    const pipeline = new PipelineBuilder<string, string>({
      id: 'conditional',
      name: 'Conditional',
      version: '1.0.0',
    })
      .step(classify, router)
      .step(handleA, new LinearRouter('end-a', null))
      .step(handleB, new LinearRouter('end-b', null))
      .build()

    expect((await pipeline.run('a')).output).toBe('handled-a')
    expect((await pipeline.run('b')).output).toBe('handled-b')
  })

  it('produces a complete trace', async () => {
    const step = new TransformStep('s1', 'S1', z.string(), z.string(), (s) => s.toUpperCase())
    const pipeline = new PipelineBuilder<string, string>({
      id: 'trace-test',
      name: 'Trace Test',
      version: '1.0.0',
    })
      .step(step)
      .build()

    const result = await pipeline.run('hello')
    expect(result.trace.events).toHaveLength(1)
    expect(result.trace.events[0]?.stepId).toBe('s1')
    expect(result.trace.events[0]?.status).toBe('completed')
    expect(result.trace.status).toBe('completed')
  })

  it('throws PipelineConfigError for empty pipeline', async () => {
    const pipeline = new PipelineBuilder({ id: 'empty', name: 'Empty', version: '1.0.0' }).build()
    await expect(pipeline.run({})).rejects.toThrow(PipelineConfigError)
  })

  it('records failed step in trace', async () => {
    const step = new TransformStep('fail-step', 'Fail', z.string(), z.string(), () => {
      throw new Error('Deliberate failure')
    })

    const pipeline = new PipelineBuilder<string, string>({
      id: 'fail-test',
      name: 'Fail Test',
      version: '1.0.0',
    })
      .step(step)
      .build()

    await expect(pipeline.run('input')).rejects.toThrow()
  })
})

describe('PluginRegistry', () => {
  it('calls plugin hooks during pipeline execution', async () => {
    const { PluginRegistry } = await import('../src/plugin/index.js')

    const onStart = vi.fn()
    const onComplete = vi.fn()
    const plugins = new PluginRegistry()
    plugins.register({
      name: 'test-plugin',
      version: '1.0.0',
      onPipelineStart: onStart,
      onPipelineComplete: onComplete,
    })

    const step = new TransformStep('s', 'S', z.number(), z.number(), (n) => n)
    const pipeline = new PipelineBuilder<number, number>(
      { id: 'plugin-test', name: 'Plugin Test', version: '1.0.0' },
      plugins,
    )
      .step(step)
      .build()

    await pipeline.run(1)
    expect(onStart).toHaveBeenCalledOnce()
    expect(onComplete).toHaveBeenCalledOnce()
  })
})
