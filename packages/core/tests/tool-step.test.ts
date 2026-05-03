import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import {
  defineToolStep,
  PipelineBuilder,
  LinearRouter,
  ValidationError,
  StepExecutionError,
} from '../src/index.js'

describe('ToolStep', () => {
  it('executes a tool function with validated input/output', async () => {
    const tool = defineToolStep({
      id: 'add',
      name: 'Add Numbers',
      description: 'Adds two numbers',
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      outputSchema: z.object({ result: z.number() }),
      execute: async ({ a, b }) => ({ result: a + b }),
    })

    const pipeline = new PipelineBuilder({ id: 'test', name: 'Test', version: '1.0.0' })
      .step(tool)
      .build()

    const result = await pipeline.run({ a: 3, b: 4 })
    expect(result.output.result).toBe(7)
  })

  it('records tool step type in trace', async () => {
    const tool = defineToolStep({
      id: 'noop',
      name: 'Noop',
      description: 'Does nothing',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: async () => ({}),
    })

    const pipeline = new PipelineBuilder({ id: 'trace-test', name: 'Trace Test', version: '1.0.0' })
      .step(tool)
      .build()

    const result = await pipeline.run({})
    expect(result.trace.events[0]?.stepType).toBe('tool')
  })

  it('throws ValidationError on invalid input', async () => {
    const tool = defineToolStep({
      id: 'strict',
      name: 'Strict',
      description: 'Requires a positive number',
      inputSchema: z.object({ value: z.number().positive() }),
      outputSchema: z.object({ value: z.number() }),
      execute: async (input) => input,
    })

    const pipeline = new PipelineBuilder({
      id: 'validation-test',
      name: 'Validation Test',
      version: '1.0.0',
    })
      .step(tool)
      .build()

    await expect(pipeline.run({ value: -1 })).rejects.toThrow(ValidationError)
  })

  it('wraps tool execution errors in StepExecutionError', async () => {
    const tool = defineToolStep({
      id: 'failing-tool',
      name: 'Failing Tool',
      description: 'Always fails',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: async () => {
        throw new Error('External API down')
      },
    })

    const pipeline = new PipelineBuilder({ id: 'error-test', name: 'Error Test', version: '1.0.0' })
      .step(tool)
      .build()

    await expect(pipeline.run({})).rejects.toThrow(StepExecutionError)
  })

  it('passes execution context to tool function', async () => {
    const contextCapture = vi.fn()

    const tool = defineToolStep({
      id: 'ctx-tool',
      name: 'Context Tool',
      description: 'Captures context',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: async (_input, context) => {
        contextCapture(context)
        return {}
      },
    })

    const pipeline = new PipelineBuilder({ id: 'ctx-test', name: 'Ctx Test', version: '1.0.0' })
      .step(tool)
      .build()

    await pipeline.run({}, { userId: 'test-user' })
    expect(contextCapture).toHaveBeenCalledOnce()
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect((contextCapture.mock.calls[0] as unknown[])[0]).toMatchObject({
      state: { userId: 'test-user' },
    })
  })

  it('chains tool steps via pipeline', async () => {
    const fetchData = defineToolStep({
      id: 'fetch',
      name: 'Fetch Data',
      description: 'Fetches data',
      inputSchema: z.object({ id: z.string() }),
      outputSchema: z.object({ id: z.string(), data: z.string() }),
      execute: async ({ id }) => ({ id, data: `data-for-${id}` }),
    })

    const processData = defineToolStep({
      id: 'process',
      name: 'Process Data',
      description: 'Processes data',
      inputSchema: z.object({ id: z.string(), data: z.string() }),
      outputSchema: z.object({ result: z.string() }),
      execute: async ({ data }) => ({ result: data.toUpperCase() }),
    })

    const pipeline = new PipelineBuilder<{ id: string }, { result: string }>({
      id: 'chain-test',
      name: 'Chain Test',
      version: '1.0.0',
    })
      .step(fetchData, new LinearRouter('fetch-to-process', 'process'))
      .step(processData)
      .build()

    const result = await pipeline.run({ id: 'abc' })
    expect(result.output.result).toBe('DATA-FOR-ABC')
    expect(result.trace.events).toHaveLength(2)
  })
})
