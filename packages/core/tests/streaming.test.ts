import { describe, it, expect, vi } from 'vitest'
import { isStreamingStep, collectStream } from '../src/index.js'
import type { StreamingCapable, StreamChunk } from '../src/index.js'

function makeMockStreamingStep(): StreamingCapable {
  return {
    stream: async function* (_input, _ctx, options) {
      const tokens = ['Hello', ' ', 'world', '!']
      let accumulated = ''
      let index = 0
      for (const delta of tokens) {
        accumulated += delta
        const chunk: StreamChunk = { delta, accumulated, index: index++ }
        if (options?.onChunk) await options.onChunk(chunk)
        yield chunk
      }
      if (options?.onComplete) {
        await options.onComplete({
          content: accumulated,
          model: 'mock',
          usage: { promptTokens: 5, completionTokens: 4, totalTokens: 9 },
        })
      }
    },
    getLastResponse: () => null,
  }
}

describe('isStreamingStep', () => {
  it('returns true for streaming-capable step', () => {
    expect(isStreamingStep(makeMockStreamingStep())).toBe(true)
  })

  it('returns false for non-streaming step', () => {
    expect(isStreamingStep({ execute: vi.fn() })).toBe(false)
  })

  it('returns false for null', () => {
    expect(isStreamingStep(null)).toBe(false)
  })
})

describe('collectStream', () => {
  it('collects all chunks into full string', async () => {
    const step = makeMockStreamingStep()
    const result = await collectStream(step.stream('input', {}))
    expect(result).toBe('Hello world!')
  })

  it('yields chunks in order with correct accumulated values', async () => {
    const step = makeMockStreamingStep()
    const chunks: StreamChunk[] = []
    for await (const chunk of step.stream('input', {})) {
      chunks.push(chunk)
    }
    expect(chunks[0]?.delta).toBe('Hello')
    expect(chunks[0]?.accumulated).toBe('Hello')
    expect(chunks[1]?.accumulated).toBe('Hello ')
    expect(chunks[3]?.accumulated).toBe('Hello world!')
  })

  it('calls onChunk for each token', async () => {
    const step = makeMockStreamingStep()
    const onChunk = vi.fn()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of step.stream('input', {}, { onChunk })) { /* consume */ }
    expect(onChunk).toHaveBeenCalledTimes(4)
  })

  it('calls onComplete with full response', async () => {
    const step = makeMockStreamingStep()
    const onComplete = vi.fn()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of step.stream('input', {}, { onComplete })) { /* consume */ }
    expect(onComplete).toHaveBeenCalledOnce()
    expect(onComplete.mock.calls[0]?.[0]?.content).toBe('Hello world!')
  })
})
