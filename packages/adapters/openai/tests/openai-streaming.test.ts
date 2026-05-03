import { describe, it, expect, vi } from 'vitest'
import { OpenAIStreamingLLMStep } from '../src/index.js'
import { createExecutionContext, isStreamingStep, collectStream } from '@pravaha/core'

describe('OpenAIStreamingLLMStep', () => {
  it('is recognized as streaming capable', () => {
    const step = new OpenAIStreamingLLMStep('s', 'S', { apiKey: 'test' })
    expect(isStreamingStep(step)).toBe(true)
  })

  it('streams tokens and collects into full string', async () => {
    const step = new OpenAIStreamingLLMStep('s', 'S', { apiKey: 'test' })

    async function* mockStream() {
      yield { model: 'gpt-4o', choices: [{ delta: { content: 'Hello' } }] }
      yield { model: 'gpt-4o', choices: [{ delta: { content: ' world' } }] }
    }

    // @ts-expect-error — accessing private for test
    step.client = { chat: { completions: { create: vi.fn().mockResolvedValue(mockStream()) } } }

    const ctx = createExecutionContext('pipe-1')
    const result = await collectStream(
      step.stream({ messages: [{ role: 'user', content: 'Hi' }] }, ctx),
    )

    expect(result).toBe('Hello world')
  })

  it('yields correct delta and accumulated values', async () => {
    const step = new OpenAIStreamingLLMStep('s', 'S', { apiKey: 'test' })

    async function* mockStream() {
      yield { model: 'gpt-4o', choices: [{ delta: { content: 'Foo' } }] }
      yield { model: 'gpt-4o', choices: [{ delta: { content: 'Bar' } }] }
    }

    // @ts-expect-error — accessing private for test
    step.client = { chat: { completions: { create: vi.fn().mockResolvedValue(mockStream()) } } }

    const ctx = createExecutionContext('pipe-1')
    const chunks = []
    for await (const chunk of step.stream({ messages: [{ role: 'user', content: 'Hi' }] }, ctx)) {
      chunks.push(chunk)
    }

    expect(chunks[0]?.delta).toBe('Foo')
    expect(chunks[0]?.accumulated).toBe('Foo')
    expect(chunks[1]?.accumulated).toBe('FooBar')
  })

  it('calls onChunk for each yielded token', async () => {
    const step = new OpenAIStreamingLLMStep('s', 'S', { apiKey: 'test' })
    const onChunk = vi.fn()

    async function* mockStream() {
      yield { model: 'gpt-4o', choices: [{ delta: { content: 'A' } }] }
      yield { model: 'gpt-4o', choices: [{ delta: { content: 'B' } }] }
      yield { model: 'gpt-4o', choices: [{ delta: { content: 'C' } }] }
    }

    // @ts-expect-error — accessing private for test
    step.client = { chat: { completions: { create: vi.fn().mockResolvedValue(mockStream()) } } }

    const ctx = createExecutionContext('pipe-1')
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of step.stream({ messages: [{ role: 'user', content: 'Hi' }] }, ctx, {
      onChunk,
    })) {
      /* consume */
    }

    expect(onChunk).toHaveBeenCalledTimes(3)
  })

  it('getLastResponse returns null before streaming', () => {
    const step = new OpenAIStreamingLLMStep('s', 'S', { apiKey: 'test' })
    expect(step.getLastResponse()).toBeNull()
  })
})
