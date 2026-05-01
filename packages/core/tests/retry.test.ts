import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import {
  withRetry,
  TransformStep,
  LLMRateLimitError,
  LLMTimeoutError,
  createExecutionContext,
} from '../src/index.js'

function makeStep(fn: () => string) {
  return new TransformStep(
    'test-step',
    'Test Step',
    z.string(),
    z.string(),
    fn,
  )
}

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const step = makeStep(() => 'success')
    const retryStep = withRetry(step, { maxAttempts: 3 })

    const ctx = createExecutionContext('pipe-1')
    const result = await retryStep.execute('input', ctx)
    expect(result.output).toBe('success')
  })

  it('retries on failure and succeeds eventually', async () => {
    let attempts = 0
    const fn = vi.fn().mockImplementation(() => {
      attempts++
      if (attempts < 3) throw new LLMRateLimitError('test')
      return 'success on attempt 3'
    })

    const step = makeStep(fn)
    const retryStep = withRetry(step, {
      maxAttempts: 3,
      backoffMs: 10,
      retryOn: [LLMRateLimitError],
    })

    const ctx = createExecutionContext('pipe-1')
    const result = await retryStep.execute('input', ctx)
    expect(result.output).toBe('success on attempt 3')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('throws after maxAttempts exhausted', async () => {
    const fn = vi.fn().mockImplementation(() => {
      throw new LLMTimeoutError('test', 1000)
    })

    const step = makeStep(fn)
    const retryStep = withRetry(step, {
      maxAttempts: 3,
      backoffMs: 10,
      retryOn: [LLMTimeoutError],
    })

    const ctx = createExecutionContext('pipe-1')
    await expect(retryStep.execute('input', ctx)).rejects.toThrow(LLMTimeoutError)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does not retry errors not in retryOn list', async () => {
    const fn = vi.fn().mockImplementation(() => {
      throw new LLMRateLimitError('test')
    })

    const step = makeStep(fn)
    const retryStep = withRetry(step, {
      maxAttempts: 3,
      backoffMs: 10,
      retryOn: [LLMTimeoutError], // Only retry timeouts
    })

    const ctx = createExecutionContext('pipe-1')
    await expect(retryStep.execute('input', ctx)).rejects.toThrow(LLMRateLimitError)
    expect(fn).toHaveBeenCalledTimes(1) // No retry
  })

  it('preserves step id and type', () => {
    const step = makeStep(() => 'value')
    const retryStep = withRetry(step, { maxAttempts: 3 })
    expect(retryStep.id).toBe('test-step')
    expect(retryStep.type).toBe('transform')
  })

  it('retries on all PravahaErrors when retryOn is empty', async () => {
    let attempts = 0
    const fn = vi.fn().mockImplementation(() => {
      attempts++
      if (attempts < 2) throw new LLMRateLimitError('test')
      return 'success'
    })

    const step = makeStep(fn)
    const retryStep = withRetry(step, { maxAttempts: 3, backoffMs: 10 })

    const ctx = createExecutionContext('pipe-1')
    const result = await retryStep.execute('input', ctx)
    expect(result.output).toBe('success')
  })

  it('applies exponential backoff', async () => {
    const delays: number[] = []
    const originalSetTimeout = global.setTimeout
    vi.spyOn(global, 'setTimeout').mockImplementation((fn, ms) => {
      delays.push(ms as number)
      return originalSetTimeout(fn as () => void, 0)
    })

    let attempts = 0
    const fn = vi.fn().mockImplementation(() => {
      attempts++
      if (attempts < 4) throw new LLMTimeoutError('test', 1000)
      return 'success'
    })

    const step = makeStep(fn)
    const retryStep = withRetry(step, {
      maxAttempts: 4,
      backoffMs: 100,
      backoffMultiplier: 2,
      retryOn: [LLMTimeoutError],
    })

    const ctx = createExecutionContext('pipe-1')
    await retryStep.execute('input', ctx)

    expect(delays[0]).toBe(100)
    expect(delays[1]).toBe(200)
    expect(delays[2]).toBe(400)

    vi.restoreAllMocks()
  })
})
