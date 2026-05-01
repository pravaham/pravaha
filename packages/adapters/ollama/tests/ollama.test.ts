import { describe, it, expect, vi, afterEach } from 'vitest'
import { OllamaLLMStep } from '../src/index.js'
import { createExecutionContext, LLMInvalidResponseError, LLMTimeoutError } from '@pravaha/core'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

afterEach(() => {
  mockFetch.mockReset()
})

function makeStep(config: Record<string, unknown> = {}) {
  return new OllamaLLMStep('ollama-step', 'Ollama Step', {
    baseUrl: 'http://localhost:11434',
    ...config,
  })
}

function mockOllamaResponse(content: string, model = 'llama3.2') {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      model,
      message: { role: 'assistant', content },
      done: true,
      prompt_eval_count: 10,
      eval_count: 20,
    }),
  })
}

describe('OllamaLLMStep', () => {
  it('initializes with correct id and type', () => {
    const step = makeStep()
    expect(step.id).toBe('ollama-step')
    expect(step.type).toBe('llm:ollama')
  })

  it('returns structured LLMResponse', async () => {
    const step = makeStep()
    mockOllamaResponse('Hello from Llama')

    const ctx = createExecutionContext('pipe-1')
    const result = await step.execute(
      { messages: [{ role: 'user', content: 'Hi' }] },
      ctx,
    )

    expect(result.output.content).toBe('Hello from Llama')
    expect(result.output.model).toBe('llama3.2')
    expect(result.output.usage.promptTokens).toBe(10)
    expect(result.output.usage.completionTokens).toBe(20)
    expect(result.output.usage.totalTokens).toBe(30)
  })

  it('appends exchange to context after execution', async () => {
    const step = makeStep()
    mockOllamaResponse('Response')

    const ctx = createExecutionContext('pipe-1')
    const result = await step.execute(
      { messages: [{ role: 'user', content: 'Hello' }] },
      ctx,
    )

    expect(result.context.messages).toHaveLength(2)
    expect(result.context.messages[1]?.role).toBe('assistant')
  })

  it('uses custom model when specified', async () => {
    const step = makeStep()
    mockOllamaResponse('Response', 'mistral')

    const ctx = createExecutionContext('pipe-1')
    await step.execute(
      { messages: [{ role: 'user', content: 'Hi' }], model: 'mistral' },
      ctx,
    )

    const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body as string) as { model: string }
    expect(calledBody.model).toBe('mistral')
  })

  it('throws LLMInvalidResponseError when model not found (404)', async () => {
    const step = makeStep()
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'model not found',
    })

    const ctx = createExecutionContext('pipe-1')
    await expect(
      step.execute({ messages: [{ role: 'user', content: 'Hi' }] }, ctx),
    ).rejects.toThrow(LLMInvalidResponseError)
  })

  it('throws LLMInvalidResponseError when Ollama is not running', async () => {
    const step = makeStep()
    const connError = new Error('connect ECONNREFUSED 127.0.0.1:11434')
    mockFetch.mockRejectedValue(connError)

    const ctx = createExecutionContext('pipe-1')
    const err = await step
      .execute({ messages: [{ role: 'user', content: 'Hi' }] }, ctx)
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(LLMInvalidResponseError)
    expect((err as LLMInvalidResponseError).message).toContain('Is Ollama running?')
  })

  it('attaches ollamaBaseUrl to response metadata', async () => {
    const step = makeStep({ baseUrl: 'http://my-ollama-server:11434' })
    mockOllamaResponse('Response')

    const ctx = createExecutionContext('pipe-1')
    const result = await step.execute(
      { messages: [{ role: 'user', content: 'Hi' }] },
      ctx,
    )

    expect(result.output.metadata?.ollamaBaseUrl).toBe('http://my-ollama-server:11434')
  })

  it('healthCheck returns ok:true with model list when Ollama is running', async () => {
    const step = makeStep()
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: 'llama3.2' }, { name: 'mistral' }],
      }),
    })

    const health = await step.healthCheck()
    expect(health.ok).toBe(true)
    expect(health.models).toContain('llama3.2')
    expect(health.models).toContain('mistral')
  })

  it('healthCheck returns ok:false when Ollama is not running', async () => {
    const step = makeStep()
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))

    const health = await step.healthCheck()
    expect(health.ok).toBe(false)
    expect(health.error).toBeDefined()
  })

  it('handles zero token counts gracefully', async () => {
    const step = makeStep()
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'llama3.2',
        message: { role: 'assistant', content: 'Response' },
        done: true,
      }),
    })

    const ctx = createExecutionContext('pipe-1')
    const result = await step.execute(
      { messages: [{ role: 'user', content: 'Hi' }] },
      ctx,
    )

    expect(result.output.usage.totalTokens).toBe(0)
  })

  it('throws LLMTimeoutError on abort', async () => {
    const step = new OllamaLLMStep('step', 'Step', {
      baseUrl: 'http://localhost:11434',
      timeoutMs: 1,
    })

    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'
    mockFetch.mockRejectedValue(abortError)

    const ctx = createExecutionContext('pipe-1')
    await expect(
      step.execute({ messages: [{ role: 'user', content: 'Hi' }] }, ctx),
    ).rejects.toThrow(LLMTimeoutError)
  })
})
