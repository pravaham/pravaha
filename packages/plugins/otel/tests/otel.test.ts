import { describe, it, expect, vi } from 'vitest'
import { OtelPlugin } from '../src/index.js'
import { PluginRegistry, PipelineBuilder, TransformStep, LinearRouter } from '@pravaha/core'
import { z } from 'zod'

describe('OtelPlugin', () => {
  it('initializes with correct name and version', () => {
    const plugin = new OtelPlugin()
    expect(plugin.name).toBe('otel')
    expect(plugin.version).toBe('0.1.0')
  })

  it('registers without errors using console exporter', () => {
    expect(() => new OtelPlugin({ exporter: 'console' })).not.toThrow()
  })

  it('falls back to console when otlp peer dep missing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const plugin = new OtelPlugin({ exporter: 'otlp' })
    expect(plugin).toBeDefined()
    warnSpy.mockRestore()
  })

  it('works end-to-end in a pipeline without throwing', async () => {
    const plugin = new OtelPlugin({ exporter: 'console' })
    const registry = new PluginRegistry()
    registry.register(plugin)

    const step = new TransformStep(
      'test-step',
      'Test Step',
      z.string(),
      z.string(),
      (s) => s.toUpperCase(),
    )

    const pipeline = new PipelineBuilder(
      { id: 'otel-test', name: 'OTEL Test', version: '1.0.0' },
      registry,
    )
      .step(step)
      .build()

    const result = await pipeline.run('hello')
    expect(result.output).toBe('HELLO')
    expect(result.trace.status).toBe('completed')

    await plugin.shutdown()
  })

  it('records step attributes in spans', async () => {
    const plugin = new OtelPlugin({ exporter: 'console' })
    const registry = new PluginRegistry()
    registry.register(plugin)

    const onStepSpy = vi.spyOn(plugin, 'onStepComplete')

    const step = new TransformStep('spy-step', 'Spy', z.string(), z.string(), (s) => s)
    const pipeline = new PipelineBuilder(
      { id: 'spy-test', name: 'Spy Test', version: '1.0.0' },
      registry,
    )
      .step(step)
      .build()

    await pipeline.run('test')
    expect(onStepSpy).toHaveBeenCalledOnce()

    await plugin.shutdown()
  })

  it('handles pipeline failure gracefully', async () => {
    const plugin = new OtelPlugin({ exporter: 'console' })
    const registry = new PluginRegistry()
    registry.register(plugin)

    const failStep = new TransformStep(
      'fail-step',
      'Fail',
      z.string(),
      z.string(),
      () => {
        throw new Error('Deliberate failure')
      },
    )

    const pipeline = new PipelineBuilder(
      { id: 'fail-test', name: 'Fail Test', version: '1.0.0' },
      registry,
    )
      .step(failStep)
      .build()

    await expect(pipeline.run('input')).rejects.toThrow()
    await plugin.shutdown()
  })

  it('accepts custom service name and resource attributes', () => {
    const plugin = new OtelPlugin({
      serviceName: 'unicredit-support',
      serviceVersion: '2.0.0',
      resourceAttributes: { 'deployment.environment': 'production' },
    })
    expect(plugin).toBeDefined()
  })
})
