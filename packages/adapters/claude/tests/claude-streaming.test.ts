import { describe, it, expect, vi } from 'vitest'
import { ClaudeStreamingLLMStep } from '../src/index.js'
import { createExecutionContext, isStreamingStep } from '@pravaha/core'

function makeStep() {
  return new ClaudeStreamingLLMStep('stream-step', 'Stream Step', { apiKey: 'test' })
}

async function* mockStreamEvents(tokens: string[]) {
  for (const token of tokens) {
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: token } }
  }
}

describe('ClaudeStreamingLLMStep', () => {
  it('is recognized as streaming capable', () => {
    expect(isStreamingStep(makeStep())).toBe(true)
  })

  it('yields chunks during streaming', async () => {
    const step = makeStep()

    const mockStream = {
      [Symbol.asyncIterator]: () => mockStreamEvents(['Hello', ' ', 'world']),
      finalMessage: vi.fn().mockResolvedValue({
        model: 'claude-opus-4-5',
        usage: { input_tokens: 10, output_tokens: 3 },
      }),
    }

    // @ts-expect-error — accessing private for test
    step.client = { messages: { stream: vi.fn().mockReturnValue(mockStream) } }

    const ctx = createExecutionContext('pipe-1')
    const chunks: string[] = []

    for await (const chunk of step.stream({ messages: [{ role: 'user', content: 'Hi' }] }, ctx)) {
      chunks.push(chunk.delta)
    }

    expect(chunks).toEqual(['Hello', ' ', 'world'])
  })

  it('accumulates chunks correctly', async () => {
    const step = makeStep()

    const mockStream = {
      [Symbol.asyncIterator]: () => mockStreamEvents(['Hello', ' ', 'world']),
      finalMessage: vi.fn().mockResolvedValue({
        model: 'claude-opus-4-5',
        usage: { input_tokens: 10, output_tokens: 3 },
      }),
    }

    // @ts-expect-error — accessing private for test
    step.client = { messages: { stream: vi.fn().mockReturnValue(mockStream) } }

    const ctx = createExecutionContext('pipe-1')
    const chunks: string[] = []

    for await (const chunk of step.stream({ messages: [{ role: 'user', content: 'Hi' }] }, ctx)) {
      chunks.push(chunk.accumulated)
    }

    expect(chunks[chunks.length - 1]).toBe('Hello world')
  })

  it('getLastResponse returns null before streaming', () => {
    const step = makeStep()
    expect(step.getLastResponse()).toBeNull()
  })

  it('calls onChunk callback for each token', async () => {
    const step = makeStep()
    const onChunk = vi.fn()

    const mockStream = {
      [Symbol.asyncIterator]: () => mockStreamEvents(['a', 'b', 'c']),
      finalMessage: vi.fn().mockResolvedValue({
        model: 'claude-opus-4-5',
        usage: { input_tokens: 5, output_tokens: 3 },
      }),
    }

    // @ts-expect-error — accessing private for test
    step.client = { messages: { stream: vi.fn().mockReturnValue(mockStream) } }

    const ctx = createExecutionContext('pipe-1')
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of step.stream(
      { messages: [{ role: 'user', content: 'Hi' }] },
      ctx,
      { onChunk },
    )) { /* consume */ }

    expect(onChunk).toHaveBeenCalledTimes(3)
  })

  it('getLastResponse populated after stream completes', async () => {
    const step = makeStep()

    const mockStream = {
      [Symbol.asyncIterator]: () => mockStreamEvents(['Hello']),
      finalMessage: vi.fn().mockResolvedValue({
        model: 'claude-opus-4-5',
        usage: { input_tokens: 10, output_tokens: 1 },
      }),
    }

    // @ts-expect-error — accessing private for test
    step.client = { messages: { stream: vi.fn().mockReturnValue(mockStream) } }

    const ctx = createExecutionContext('pipe-1')
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of step.stream({ messages: [{ role: 'user', content: 'Hi' }] }, ctx)) { /* consume */ }

    const response = step.getLastResponse()
    expect(response).not.toBeNull()
    expect(response?.content).toBe('Hello')
    expect(response?.model).toBe('claude-opus-4-5')
    expect(response?.usage.promptTokens).toBe(10)
    expect(response?.usage.completionTokens).toBe(1)
  })
})
