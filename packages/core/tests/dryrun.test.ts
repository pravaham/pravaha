import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  PipelineBuilder,
  TransformStep,
  ConditionalRouter,
  LinearRouter,
  ValidationError,
} from '../src/index.js'

const ClassifySchema = z.object({
  category: z.enum(['billing', 'technical', 'general']),
  confidence: z.number(),
  reasoning: z.string(),
})

const ResponseSchema = z.object({
  response: z.string(),
  escalate: z.boolean(),
})

type ClassifyOutput = z.infer<typeof ClassifySchema>
type ResponseOutput = z.infer<typeof ResponseSchema>

function buildTestPipeline() {
  const classify = new TransformStep(
    'classify',
    'Classify',
    z.string(),
    ClassifySchema,
    () => ({ category: 'general' as const, confidence: 0.5, reasoning: 'real' }),
  )

  const billing = new TransformStep(
    'billing',
    'Billing',
    ClassifySchema,
    ResponseSchema,
    () => ({ response: 'real billing response', escalate: false }),
  )

  const general = new TransformStep(
    'general',
    'General',
    ClassifySchema,
    ResponseSchema,
    () => ({ response: 'real general response', escalate: false }),
  )

  const router = new ConditionalRouter<ClassifyOutput>('router', 'Router', [
    { condition: (o) => o.category === 'billing', nextStepId: 'billing', reason: 'Is billing' },
    { condition: (o) => o.category === 'general', nextStepId: 'general', reason: 'Is general' },
  ])

  return new PipelineBuilder<string, ResponseOutput>(
    { id: 'test-pipeline', name: 'Test Pipeline', version: '1.0.0' },
  )
    .step(classify, router)
    .step(billing, new LinearRouter('billing-end', null))
    .step(general, new LinearRouter('general-end', null))
    .build()
}

describe('Pipeline.dryRun', () => {
  it('produces full trace with mocked steps', async () => {
    const pipeline = buildTestPipeline()
    const result = await pipeline.dryRun('test input', {
      mockResponses: {
        classify: { category: 'billing', confidence: 0.99, reasoning: 'mocked' },
        billing: { response: 'mock billing', escalate: false },
      },
    })

    expect(result.trace.events).toHaveLength(2)
    expect(result.trace.status).toBe('completed')
  })

  it('routes correctly based on mocked classify output', async () => {
    const pipeline = buildTestPipeline()

    const billingResult = await pipeline.dryRun('any input', {
      mockResponses: {
        classify: { category: 'billing', confidence: 0.99, reasoning: 'mocked' },
        billing: { response: 'mock billing response', escalate: false },
      },
    })
    expect(billingResult.output.response).toBe('mock billing response')

    const generalResult = await pipeline.dryRun('any input', {
      mockResponses: {
        classify: { category: 'general', confidence: 0.8, reasoning: 'mocked' },
        general: { response: 'mock general response', escalate: false },
      },
    })
    expect(generalResult.output.response).toBe('mock general response')
  })

  it('marks dryRun in context state', async () => {
    const pipeline = buildTestPipeline()
    const result = await pipeline.dryRun('input', {
      mockResponses: {
        classify: { category: 'general', confidence: 0.8, reasoning: 'mocked' },
        general: { response: 'mock', escalate: false },
      },
    })
    expect(result.context.state['dryRun']).toBe(true)
  })

  it('throws ValidationError when mock does not match output schema', async () => {
    const pipeline = buildTestPipeline()
    await expect(
      pipeline.dryRun('input', {
        mockResponses: {
          classify: { category: 'invalid-category', confidence: 'not-a-number' },
          general: { response: 'mock', escalate: false },
        },
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('executes non-mocked steps normally', async () => {
    const pipeline = buildTestPipeline()
    // classify not mocked — runs real logic which returns 'general'
    const result = await pipeline.dryRun('input', {
      mockResponses: {
        general: { response: 'mock general', escalate: false },
      },
    })
    expect(result.output.response).toBe('mock general')
  })

  it('produces identical trace structure to real run', async () => {
    const pipeline = buildTestPipeline()

    const realResult = await pipeline.run('input')
    const dryResult = await pipeline.dryRun('input', {
      mockResponses: {
        classify: { category: 'general', confidence: 0.5, reasoning: 'mocked' },
        general: { response: 'mock', escalate: false },
      },
    })

    expect(dryResult.trace.events).toHaveLength(realResult.trace.events.length)
    expect(dryResult.trace.events.map((e) => e.stepId)).toEqual(
      realResult.trace.events.map((e) => e.stepId),
    )
  })
})
