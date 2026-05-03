import { describe, it, expect, vi } from 'vitest'
import { ClaudeVertexToolCallingAdapter } from '../src/index.js'
import { z } from 'zod'
import type { AnyToolDefinition } from '@pravaha/core'
import { LLMRateLimitError } from '@pravaha/core'

vi.mock('@anthropic-ai/vertex-sdk', () => ({
  AnthropicVertex: vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn() },
  })),
}))

const searchTool: AnyToolDefinition = {
  id: 'search',
  name: 'Search',
  description: 'Searches KB',
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ results: z.array(z.string()) }),
  execute: async ({ query }: { query: string }) => ({ results: [query] }),
}

describe('ClaudeVertexToolCallingAdapter', () => {
  it('initializes with correct adapterName', () => {
    const adapter = new ClaudeVertexToolCallingAdapter({
      projectId: 'test-project',
      region: 'us-central1',
    })
    expect(adapter.adapterName).toBe('claude-vertex')
  })

  it('returns text response when no tool calls', async () => {
    const adapter = new ClaudeVertexToolCallingAdapter({
      projectId: 'test-project',
      region: 'us-central1',
    })

    // @ts-expect-error — accessing private for test
    adapter.client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Direct answer' }],
          model: 'claude-3-5-sonnet@20241022',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      },
    }

    const result = await adapter.chat([{ role: 'user', content: 'Hello' }], [searchTool])

    expect(result.type).toBe('text')
    if (result.type === 'text') expect(result.content).toBe('Direct answer')
  })

  it('returns tool_calls when LLM requests tools', async () => {
    const adapter = new ClaudeVertexToolCallingAdapter({
      projectId: 'test-project',
      region: 'europe-west1',
    })

    // @ts-expect-error — accessing private for test
    adapter.client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'tool_use', id: 'tu-1', name: 'search', input: { query: 'test' } }],
          model: 'claude-3-5-sonnet@20241022',
          usage: { input_tokens: 15, output_tokens: 8 },
        }),
      },
    }

    const result = await adapter.chat([{ role: 'user', content: 'Search for test' }], [searchTool])

    expect(result.type).toBe('tool_calls')
    if (result.type === 'tool_calls') {
      expect(result.toolCalls[0]?.toolId).toBe('search')
      expect(result.metadata?.['vertexProjectId']).toBe('test-project')
      expect(result.metadata?.['vertexRegion']).toBe('europe-west1')
    }
  })

  it('maps RESOURCE_EXHAUSTED to LLMRateLimitError', async () => {
    const adapter = new ClaudeVertexToolCallingAdapter({
      projectId: 'test-project',
      region: 'us-central1',
    })

    // @ts-expect-error — accessing private for test
    adapter.client = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error('RESOURCE_EXHAUSTED: Quota exceeded')),
      },
    }

    await expect(adapter.chat([{ role: 'user', content: 'Hi' }], [])).rejects.toThrow(
      LLMRateLimitError,
    )
  })

  it('builds correct tool result message', () => {
    const adapter = new ClaudeVertexToolCallingAdapter({
      projectId: 'test-project',
      region: 'us-central1',
    })

    const message = adapter.buildToolResultMessage([
      { callId: 'tu-1', output: { results: ['item1'] } },
    ])

    expect(message.role).toBe('user')
    const parsed = JSON.parse(message.content) as unknown[]
    const first = parsed[0] as Record<string, unknown>
    expect(first['type']).toBe('tool_result')
    expect(first['tool_use_id']).toBe('tu-1')
  })
})
