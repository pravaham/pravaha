import { describe, it, expect, vi, afterEach } from 'vitest'
import { OllamaStreamingLLMStep } from '../src/index.js'
import { createExecutionContext, isStreamingStep, collectStream } from '@pravaha/core'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)
afterEach(() => mockFetch.mockReset())

function makeNdjsonStream(lines: string[]): ReadableStream {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + '\n'))
      }
      controller.close()
    },
  })
}

describe('OllamaStreamingLLMStep', () => {
  it('is recognized as streaming capable', () => {
    const step = new OllamaStreamingLLMStep('s', 'S')
    expect(isStreamingStep(step)).toBe(true)
  })

  it('streams NDJSON chunks correctly', async () => {
    const step = new OllamaStreamingLLMStep('s', 'S')

    mockFetch.mockResolvedValue({
      ok: true,
      body: makeNdjsonStream([
        JSON.stringify({ model: 'llama3.2', message: { content: 'Hello' }, done: false }),
        JSON.stringify({ model: 'llama3.2', message: { content: ' world' }, done: false }),
        JSON.stringify({ model: 'llama3.2', done: true, prompt_eval_count: 5, eval_count: 2 }),
      ]),
    })

    const ctx = createExecutionContext('pipe-1')
    const result = await collectStream(
      step.stream({ messages: [{ role: 'user', content: 'Hi' }] }, ctx),
    )

    expect(result).toBe('Hello world')
  })

  it('captures token usage from done event', async () => {
    const step = new OllamaStreamingLLMStep('s', 'S')

    mockFetch.mockResolvedValue({
      ok: true,
      body: makeNdjsonStream([
        JSON.stringify({ model: 'llama3.2', message: { content: 'Hi' }, done: false }),
        JSON.stringify({ model: 'llama3.2', done: true, prompt_eval_count: 10, eval_count: 5 }),
      ]),
    })

    const ctx = createExecutionContext('pipe-1')
    const onComplete = vi.fn()

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of step.stream(
      { messages: [{ role: 'user', content: 'Hello' }] },
      ctx,
      { onComplete },
    )) { /* consume */ }

    expect(onComplete.mock.calls[0]?.[0]?.usage.promptTokens).toBe(10)
    expect(onComplete.mock.calls[0]?.[0]?.usage.completionTokens).toBe(5)
  })

  it('yields chunks in order', async () => {
    const step = new OllamaStreamingLLMStep('s', 'S')

    mockFetch.mockResolvedValue({
      ok: true,
      body: makeNdjsonStream([
        JSON.stringify({ model: 'llama3.2', message: { content: 'A' }, done: false }),
        JSON.stringify({ model: 'llama3.2', message: { content: 'B' }, done: false }),
        JSON.stringify({ model: 'llama3.2', message: { content: 'C' }, done: true, prompt_eval_count: 1, eval_count: 3 }),
      ]),
    })

    const ctx = createExecutionContext('pipe-1')
    const deltas: string[] = []
    for await (const chunk of step.stream({ messages: [{ role: 'user', content: 'Hi' }] }, ctx)) {
      deltas.push(chunk.delta)
    }

    expect(deltas).toEqual(['A', 'B', 'C'])
  })
})
