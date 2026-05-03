import { describe, it, expect, vi } from 'vitest'
import { ClaudeToolCallingAdapter } from '../src/index.js'
import { z } from 'zod'
import type { ToolDefinition } from '@pravaha/core'
import { LLMRateLimitError } from '@pravaha/core'

const searchTool: ToolDefinition<{ query: string }, { results: string[] }> = {
  id: 'search',
  name: 'Search',
  description: 'Searches KB',
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ results: z.array(z.string()) }),
  execute: async ({ query }) => ({ results: [query] }),
}

describe('ClaudeToolCallingAdapter', () => {
  it('returns text response when no tool calls', async () => {
    const adapter = new ClaudeToolCallingAdapter({ apiKey: 'test' })

    // @ts-expect-error — accessing private for test
    adapter.client = {
      beta: {
        tools: {
          messages: {
            create: vi.fn().mockResolvedValue({
              content: [{ type: 'text', text: 'Direct answer' }],
              model: 'claude-opus-4-5',
              usage: { input_tokens: 10, output_tokens: 5 },
              stop_reason: 'end_turn',
            }),
          },
        },
      },
    }

    const result = await adapter.chat([{ role: 'user', content: 'Hello' }], [searchTool])

    expect(result.type).toBe('text')
    if (result.type === 'text') expect(result.content).toBe('Direct answer')
  })

  it('returns tool_calls when LLM requests tools', async () => {
    const adapter = new ClaudeToolCallingAdapter({ apiKey: 'test' })

    // @ts-expect-error — accessing private for test
    adapter.client = {
      beta: {
        tools: {
          messages: {
            create: vi.fn().mockResolvedValue({
              content: [{ type: 'tool_use', id: 'tu-1', name: 'search', input: { query: 'test' } }],
              model: 'claude-opus-4-5',
              usage: { input_tokens: 15, output_tokens: 8 },
              stop_reason: 'tool_use',
            }),
          },
        },
      },
    }

    const result = await adapter.chat([{ role: 'user', content: 'Search for test' }], [searchTool])

    expect(result.type).toBe('tool_calls')
    if (result.type === 'tool_calls') {
      expect(result.toolCalls[0]?.toolId).toBe('search')
      expect(result.toolCalls[0]?.input).toEqual({ query: 'test' })
    }
  })

  it('builds correct tool result message', () => {
    const adapter = new ClaudeToolCallingAdapter({ apiKey: 'test' })
    const message = adapter.buildToolResultMessage([
      { callId: 'tu-1', output: { results: ['item1'] } },
    ])

    expect(message.role).toBe('user')
    const parsed = JSON.parse(message.content) as Array<{
      type: string
      tool_use_id: string
      content: string
    }>
    expect(parsed[0]?.type).toBe('tool_result')
    expect(parsed[0]?.tool_use_id).toBe('tu-1')
  })

  it('maps RateLimitError correctly', async () => {
    const adapter = new ClaudeToolCallingAdapter({ apiKey: 'test' })
    const { default: Anthropic } = await import('@anthropic-ai/sdk')

    // @ts-expect-error — accessing private for test
    adapter.client = {
      beta: {
        tools: {
          messages: {
            create: vi
              .fn()
              .mockRejectedValue(
                new Anthropic.RateLimitError(429, {} as never, 'Rate limit', {} as never),
              ),
          },
        },
      },
    }

    await expect(adapter.chat([{ role: 'user', content: 'Hi' }], [])).rejects.toThrow(
      LLMRateLimitError,
    )
  })

  it('reports correct token usage', async () => {
    const adapter = new ClaudeToolCallingAdapter({ apiKey: 'test' })

    // @ts-expect-error — accessing private for test
    adapter.client = {
      beta: {
        tools: {
          messages: {
            create: vi.fn().mockResolvedValue({
              content: [{ type: 'text', text: 'Response' }],
              model: 'claude-opus-4-5',
              usage: { input_tokens: 20, output_tokens: 10 },
              stop_reason: 'end_turn',
            }),
          },
        },
      },
    }

    const result = await adapter.chat([{ role: 'user', content: 'Hi' }], [])
    expect(result.usage.promptTokens).toBe(20)
    expect(result.usage.completionTokens).toBe(10)
    expect(result.usage.totalTokens).toBe(30)
  })
})
