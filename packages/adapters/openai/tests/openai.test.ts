import { describe, it, expect, vi } from 'vitest'
import { OpenAILLMStep } from '../src/index.js'
import {
  createExecutionContext,
  LLMRateLimitError,
  LLMInvalidResponseError,
  LLMTimeoutError,
} from '@pravaha/core'

function makeStep() {
  return new OpenAILLMStep('openai-step', 'OpenAI Step', { apiKey: 'test-key' })
}

function mockClient(step: OpenAILLMStep, response: unknown) {
  // @ts-expect-error — accessing private for test
  step.client = { chat: { completions: { create: vi.fn().mockResolvedValue(response) } } }
}

function mockClientError(step: OpenAILLMStep, error: unknown) {
  // @ts-expect-error — accessing private for test
  step.client = { chat: { completions: { create: vi.fn().mockRejectedValue(error) } } }
}

const validResponse = {
  model: 'gpt-4o',
  choices: [{ message: { content: 'Hello from OpenAI' } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
}

describe('OpenAILLMStep', () => {
  it('initializes with correct id and type', () => {
    const step = makeStep()
    expect(step.id).toBe('openai-step')
    expect(step.type).toBe('llm:openai')
  })

  it('returns structured LLMResponse', async () => {
    const step = makeStep()
    mockClient(step, validResponse)
    const ctx = createExecutionContext('pipe-1')
    const result = await step.execute({ messages: [{ role: 'user', content: 'Hi' }] }, ctx)
    expect(result.output.content).toBe('Hello from OpenAI')
    expect(result.output.model).toBe('gpt-4o')
    expect(result.output.usage.totalTokens).toBe(15)
  })

  it('appends exchange to context messages after execution', async () => {
    const step = makeStep()
    mockClient(step, validResponse)
    const ctx = createExecutionContext('pipe-1')
    const result = await step.execute({ messages: [{ role: 'user', content: 'Hi' }] }, ctx)
    expect(result.context.messages).toHaveLength(2)
    expect(result.context.messages[0]?.role).toBe('user')
    expect(result.context.messages[1]?.role).toBe('assistant')
    expect(result.context.messages[1]?.content).toBe('Hello from OpenAI')
  })

  it('merges prior context messages into API call', async () => {
    const step = makeStep()
    const mockCreate = vi.fn().mockResolvedValue(validResponse)
    // @ts-expect-error — accessing private for test
    step.client = { chat: { completions: { create: mockCreate } } }

    const { withMessages } = await import('@pravaha/core')
    const ctx = withMessages(createExecutionContext('pipe-1'), [
      { role: 'user', content: 'First message' },
      { role: 'assistant', content: 'First response' },
    ])

    await step.execute({ messages: [{ role: 'user', content: 'Second message' }] }, ctx)

    const calledMessages = mockCreate.mock.calls[0][0].messages
    expect(calledMessages).toHaveLength(3)
  })

  it('uses custom model when specified in request', async () => {
    const step = makeStep()
    const mockCreate = vi.fn().mockResolvedValue(validResponse)
    // @ts-expect-error — accessing private for test
    step.client = { chat: { completions: { create: mockCreate } } }

    const ctx = createExecutionContext('pipe-1')
    await step.execute(
      {
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'gpt-4-turbo',
      },
      ctx,
    )

    expect(mockCreate.mock.calls[0][0].model).toBe('gpt-4-turbo')
  })

  it('uses defaultModel from config when not specified in request', async () => {
    const step = new OpenAILLMStep('step', 'Step', {
      apiKey: 'key',
      defaultModel: 'gpt-3.5-turbo',
    })
    const mockCreate = vi.fn().mockResolvedValue(validResponse)
    // @ts-expect-error — accessing private for test
    step.client = { chat: { completions: { create: mockCreate } } }

    const ctx = createExecutionContext('pipe-1')
    await step.execute({ messages: [{ role: 'user', content: 'Hi' }] }, ctx)

    expect(mockCreate.mock.calls[0][0].model).toBe('gpt-3.5-turbo')
  })

  it('throws LLMInvalidResponseError on empty choice content', async () => {
    const step = makeStep()
    mockClient(step, {
      model: 'gpt-4o',
      choices: [{ message: { content: null } }],
      usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
    })

    const ctx = createExecutionContext('pipe-1')
    await expect(
      step.execute({ messages: [{ role: 'user', content: 'Hi' }] }, ctx),
    ).rejects.toThrow(LLMInvalidResponseError)
  })

  it('throws LLMInvalidResponseError on empty choices array', async () => {
    const step = makeStep()
    mockClient(step, {
      model: 'gpt-4o',
      choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
    })

    const ctx = createExecutionContext('pipe-1')
    await expect(
      step.execute({ messages: [{ role: 'user', content: 'Hi' }] }, ctx),
    ).rejects.toThrow(LLMInvalidResponseError)
  })

  it('throws LLMRateLimitError on rate limit error', async () => {
    const step = makeStep()
    const { default: OpenAI } = await import('openai')
    const rateLimitErr = new OpenAI.RateLimitError(
      429,
      { headers: { 'retry-after': '30' } } as never,
      'Rate limit exceeded',
      {} as never,
    )
    mockClientError(step, rateLimitErr)

    const ctx = createExecutionContext('pipe-1')
    await expect(
      step.execute({ messages: [{ role: 'user', content: 'Hi' }] }, ctx),
    ).rejects.toThrow(LLMRateLimitError)
  })

  it('throws LLMTimeoutError on connection timeout', async () => {
    const step = makeStep()
    const { default: OpenAI } = await import('openai')
    const timeoutErr = new OpenAI.APIConnectionTimeoutError({} as never)
    mockClientError(step, timeoutErr)

    const ctx = createExecutionContext('pipe-1')
    await expect(
      step.execute({ messages: [{ role: 'user', content: 'Hi' }] }, ctx),
    ).rejects.toThrow(LLMTimeoutError)
  })

  it('handles zero usage gracefully', async () => {
    const step = makeStep()
    mockClient(step, {
      model: 'gpt-4o',
      choices: [{ message: { content: 'Response' } }],
      usage: undefined,
    })

    const ctx = createExecutionContext('pipe-1')
    const result = await step.execute({ messages: [{ role: 'user', content: 'Hi' }] }, ctx)
    expect(result.output.usage.totalTokens).toBe(0)
    expect(result.output.usage.promptTokens).toBe(0)
    expect(result.output.usage.completionTokens).toBe(0)
  })
})
