import { describe, it, expect, vi } from 'vitest'
import { OpenAIToolCallingAdapter } from '../src/index.js'
import { z } from 'zod'
import type { ToolDefinition } from '@pravaha/core'
import { LLMRateLimitError } from '@pravaha/core'

const weatherTool: ToolDefinition<{ city: string }, { temp: number }> = {
  id: 'get-weather',
  name: 'Get Weather',
  description: 'Gets current weather',
  inputSchema: z.object({ city: z.string() }),
  outputSchema: z.object({ temp: z.number() }),
  execute: async () => ({ temp: 22 }),
}

describe('OpenAIToolCallingAdapter', () => {
  it('returns text response when no tool calls', async () => {
    const adapter = new OpenAIToolCallingAdapter({ apiKey: 'test' })

    // @ts-expect-error — accessing private for test
    adapter.client = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            model: 'gpt-4o',
            choices: [{ message: { content: 'Direct answer', tool_calls: null } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
        },
      },
    }

    const result = await adapter.chat([{ role: 'user', content: 'Hello' }], [weatherTool])

    expect(result.type).toBe('text')
    if (result.type === 'text') expect(result.content).toBe('Direct answer')
  })

  it('returns tool_calls when LLM requests tools', async () => {
    const adapter = new OpenAIToolCallingAdapter({ apiKey: 'test' })

    // @ts-expect-error — accessing private for test
    adapter.client = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            model: 'gpt-4o',
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'call-1',
                      function: { name: 'get-weather', arguments: '{"city":"London"}' },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 15, completion_tokens: 8, total_tokens: 23 },
          }),
        },
      },
    }

    const result = await adapter.chat(
      [{ role: 'user', content: 'Weather in London?' }],
      [weatherTool],
    )

    expect(result.type).toBe('tool_calls')
    if (result.type === 'tool_calls') {
      expect(result.toolCalls[0]?.toolId).toBe('get-weather')
      expect(result.toolCalls[0]?.input).toEqual({ city: 'London' })
    }
  })

  it('builds one message per tool result', () => {
    const adapter = new OpenAIToolCallingAdapter({ apiKey: 'test' })
    const messages = adapter.buildToolResultMessage([
      { callId: 'call-1', output: { temp: 22 } },
      { callId: 'call-2', output: { temp: 18 } },
    ])

    expect(Array.isArray(messages)).toBe(true)
    expect((messages as unknown[]).length).toBe(2)
  })

  it('maps RateLimitError correctly', async () => {
    const adapter = new OpenAIToolCallingAdapter({ apiKey: 'test' })
    const { default: OpenAI } = await import('openai')

    // @ts-expect-error — accessing private for test
    adapter.client = {
      chat: {
        completions: {
          create: vi
            .fn()
            .mockRejectedValue(
              new OpenAI.RateLimitError(429, {} as never, 'Rate limit', {} as never),
            ),
        },
      },
    }

    await expect(adapter.chat([{ role: 'user', content: 'Hi' }], [])).rejects.toThrow(
      LLMRateLimitError,
    )
  })

  it('includes error message in tool result when error is set', () => {
    const adapter = new OpenAIToolCallingAdapter({ apiKey: 'test' })
    const messages = adapter.buildToolResultMessage([
      { callId: 'call-1', output: null, error: 'Service unavailable' },
    ])

    const arr = messages as readonly { role: string; content: string }[]
    expect(arr[0]?.content).toBe('Error: Service unavailable')
    expect(arr[0]?.role).toBe('tool')
  })
})
