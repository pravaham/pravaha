import { describe, it, expect, vi, afterEach } from 'vitest'
import { OllamaToolCallingAdapter } from '../src/index.js'
import { z } from 'zod'
import type { ToolDefinition } from '@pravaha/core'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)
afterEach(() => mockFetch.mockReset())

const searchTool: ToolDefinition<{ query: string }, { results: string[] }> = {
  id: 'search',
  name: 'Search',
  description: 'Searches KB',
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ results: z.array(z.string()) }),
  execute: async ({ query }) => ({ results: [query] }),
}

function mockOllamaResponse(content: string) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      model: 'llama3.1',
      message: { content },
      prompt_eval_count: 10,
      eval_count: 20,
    }),
  })
}

describe('OllamaToolCallingAdapter', () => {
  it('returns text response for plain text content', async () => {
    const adapter = new OllamaToolCallingAdapter()
    mockOllamaResponse('This is a plain text answer')

    const result = await adapter.chat([{ role: 'user', content: 'Hello' }], [searchTool])

    expect(result.type).toBe('text')
    if (result.type === 'text') expect(result.content).toBe('This is a plain text answer')
  })

  it('parses JSON tool call format', async () => {
    const adapter = new OllamaToolCallingAdapter()
    mockOllamaResponse(
      '{"tool_call": {"id": "tc-1", "name": "search", "input": {"query": "login error"}}}',
    )

    const result = await adapter.chat(
      [{ role: 'user', content: 'Search for login error' }],
      [searchTool],
    )

    expect(result.type).toBe('tool_calls')
    if (result.type === 'tool_calls') {
      expect(result.toolCalls[0]?.toolId).toBe('search')
      expect(result.toolCalls[0]?.input).toEqual({ query: 'login error' })
    }
  })

  it('builds tool result as user message', () => {
    const adapter = new OllamaToolCallingAdapter()
    const message = adapter.buildToolResultMessage([
      { callId: 'tc-1', output: { results: ['item'] } },
    ])

    expect(message.role).toBe('user')
    expect(message.content).toContain('Tool results')
  })

  it('injects tool schema into system prompt', async () => {
    const adapter = new OllamaToolCallingAdapter()
    mockOllamaResponse('Answer')

    await adapter.chat([{ role: 'user', content: 'Hello' }], [searchTool])

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as {
      messages: Array<{ role: string; content: string }>
    }
    const systemMsg = body.messages.find((m) => m.role === 'system')
    expect(systemMsg).toBeDefined()
    expect(systemMsg?.content).toContain('search')
  })

  it('appends tool schema to existing system message', async () => {
    const adapter = new OllamaToolCallingAdapter()
    mockOllamaResponse('Answer')

    await adapter.chat(
      [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Help me' },
      ],
      [searchTool],
    )

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as {
      messages: Array<{ role: string; content: string }>
    }
    const systemMsg = body.messages.find((m) => m.role === 'system')
    expect(systemMsg?.content).toContain('You are a helpful assistant.')
    expect(systemMsg?.content).toContain('search')
  })

  it('returns correct token usage', async () => {
    const adapter = new OllamaToolCallingAdapter()
    mockOllamaResponse('Answer')

    const result = await adapter.chat([{ role: 'user', content: 'Hi' }], [])
    expect(result.usage.promptTokens).toBe(10)
    expect(result.usage.completionTokens).toBe(20)
    expect(result.usage.totalTokens).toBe(30)
  })
})
