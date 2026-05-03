import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import {
  AgentStep,
  defineAgentOutputParser,
  AgentMaxIterationsError,
  AgentToolNotFoundError,
  AgentOutputParseError,
  PipelineBuilder,
  LinearRouter,
  defineToolStep,
  createExecutionContext,
} from '../src/index.js'
import type { ToolCallingAdapter, AgentLLMResponse, ToolCallResult } from '../src/index.js'

function makeMockAdapter(responses: AgentLLMResponse[]): ToolCallingAdapter {
  let callCount = 0
  return {
    adapterName: 'mock',
    chat: vi.fn().mockImplementation(async () => {
      const response = responses[callCount++]
      if (!response) throw new Error('No more mock responses')
      return response
    }),
    buildToolResultMessage: vi.fn().mockImplementation((results: readonly ToolCallResult[]) => ({
      role: 'user' as const,
      content: JSON.stringify(results),
    })),
  }
}

const searchTool = defineToolStep({
  id: 'search-kb',
  name: 'Search KB',
  description: 'Searches knowledge base',
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ results: z.array(z.string()) }),
  execute: async ({ query }) => ({ results: [`Result for: ${query}`] }),
})

describe('AgentStep', () => {
  it('returns text response directly when LLM does not call tools', async () => {
    const adapter = makeMockAdapter([
      {
        type: 'text',
        content: 'Direct answer',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        model: 'mock',
      },
    ])

    const agent = new AgentStep({
      id: 'test-agent',
      name: 'Test Agent',
      adapter,
      tools: [],
    })

    const ctx = createExecutionContext('pipe-1')
    const result = await agent.execute('What is 2+2?', ctx)

    expect(result.output.content).toBe('Direct answer')
    expect(result.output.iterations).toHaveLength(1)
  })

  it('executes tool call and feeds result back to LLM', async () => {
    const adapter = makeMockAdapter([
      {
        type: 'tool_calls',
        toolCalls: [{ id: 'call-1', toolId: 'search-kb', input: { query: 'login error' } }],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        model: 'mock',
      },
      {
        type: 'text',
        content: 'Based on KB: restart the service',
        usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
        model: 'mock',
      },
    ])

    const agent = new AgentStep({
      id: 'test-agent',
      name: 'Test Agent',
      adapter,
      tools: [searchTool],
    })

    const ctx = createExecutionContext('pipe-1')
    const result = await agent.execute('How do I fix login error?', ctx)

    expect(result.output.content).toBe('Based on KB: restart the service')
    expect(result.output.iterations).toHaveLength(2)
    expect(result.output.iterations[0]?.toolCallResults).toHaveLength(1)
  })

  it('accumulates token usage across iterations', async () => {
    const adapter = makeMockAdapter([
      {
        type: 'tool_calls',
        toolCalls: [{ id: 'call-1', toolId: 'search-kb', input: { query: 'test' } }],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        model: 'mock',
      },
      {
        type: 'text',
        content: 'Final answer',
        usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
        model: 'mock',
      },
    ])

    const agent = new AgentStep({
      id: 'test-agent',
      name: 'Test Agent',
      adapter,
      tools: [searchTool],
    })

    const ctx = createExecutionContext('pipe-1')
    const result = await agent.execute('Question', ctx)

    expect(result.output.totalUsage.totalTokens).toBe(45) // 15 + 30
    expect(result.output.totalUsage.promptTokens).toBe(30) // 10 + 20
  })

  it('throws AgentMaxIterationsError when loop exceeds limit', async () => {
    const adapter: ToolCallingAdapter = {
      adapterName: 'mock',
      chat: vi.fn().mockResolvedValue({
        type: 'tool_calls',
        toolCalls: [{ id: 'call-1', toolId: 'search-kb', input: { query: 'test' } }],
        usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
        model: 'mock',
      }),
      buildToolResultMessage: vi.fn().mockReturnValue({ role: 'user', content: '[]' }),
    }

    const agent = new AgentStep({
      id: 'loop-agent',
      name: 'Loop Agent',
      adapter,
      tools: [searchTool],
      maxIterations: 3,
    })

    const ctx = createExecutionContext('pipe-1')
    await expect(agent.execute('Question', ctx)).rejects.toThrow(AgentMaxIterationsError)
  })

  it('throws AgentToolNotFoundError when LLM requests unknown tool', async () => {
    const adapter = makeMockAdapter([
      {
        type: 'tool_calls',
        toolCalls: [{ id: 'call-1', toolId: 'nonexistent-tool', input: {} }],
        usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
        model: 'mock',
      },
    ])

    const agent = new AgentStep({
      id: 'test-agent',
      name: 'Test Agent',
      adapter,
      tools: [searchTool],
    })

    const ctx = createExecutionContext('pipe-1')
    await expect(agent.execute('Question', ctx)).rejects.toThrow(AgentToolNotFoundError)
  })

  it('feeds tool error back to LLM instead of throwing', async () => {
    const failingTool = defineToolStep({
      id: 'failing-tool',
      name: 'Failing Tool',
      description: 'Always fails',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: async () => {
        throw new Error('External service unavailable')
      },
    })

    const adapter = makeMockAdapter([
      {
        type: 'tool_calls',
        toolCalls: [{ id: 'call-1', toolId: 'failing-tool', input: {} }],
        usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
        model: 'mock',
      },
      {
        type: 'text',
        content: 'I could not access the tool. Here is my best answer without it.',
        usage: { promptTokens: 15, completionTokens: 10, totalTokens: 25 },
        model: 'mock',
      },
    ])

    const agent = new AgentStep({
      id: 'test-agent',
      name: 'Test Agent',
      adapter,
      tools: [failingTool],
    })

    const ctx = createExecutionContext('pipe-1')
    const result = await agent.execute('Question', ctx)

    expect(result.output.content).toContain('best answer')
    expect(result.output.iterations[0]?.toolCallResults?.[0]?.error).toBe(
      'External service unavailable',
    )
  })

  it('works end-to-end in a pipeline', async () => {
    const adapter = makeMockAdapter([
      {
        type: 'text',
        content: '{"category": "billing", "confidence": 0.95}',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        model: 'mock',
      },
    ])

    const agent = new AgentStep({
      id: 'classify-agent',
      name: 'Classify Agent',
      adapter,
      tools: [],
    })

    const parser = defineAgentOutputParser({
      id: 'parse-classification',
      name: 'Parse Classification',
      strategy: { type: 'json' },
      outputSchema: z.object({
        category: z.enum(['billing', 'technical', 'general']),
        confidence: z.number(),
      }),
    })

    const pipeline = new PipelineBuilder<string, { category: string; confidence: number }>({
      id: 'agent-pipeline',
      name: 'Agent Pipeline',
      version: '1.0.0',
    })
      .step(agent, new LinearRouter('agent-to-parser', 'parse-classification'))
      .step(parser)
      .build()

    const result = await pipeline.run('Classify this ticket: wrong charge on invoice')
    expect(result.output.category).toBe('billing')
    expect(result.output.confidence).toBe(0.95)
  })
})

describe('AgentOutputParser', () => {
  function makeAgentOutput(content: string) {
    return {
      content,
      iterations: [],
      totalUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    }
  }

  it('parses valid JSON response', async () => {
    const parser = defineAgentOutputParser({
      id: 'parser',
      name: 'Parser',
      strategy: { type: 'json' },
      outputSchema: z.object({ name: z.string(), value: z.number() }),
    })

    const ctx = createExecutionContext('pipe-1')
    const result = await parser.execute(makeAgentOutput('{"name": "test", "value": 42}'), ctx)
    expect(result.output.name).toBe('test')
    expect(result.output.value).toBe(42)
  })

  it('strips markdown code fences before JSON parsing', async () => {
    const parser = defineAgentOutputParser({
      id: 'parser',
      name: 'Parser',
      strategy: { type: 'json' },
      outputSchema: z.object({ result: z.string() }),
    })

    const ctx = createExecutionContext('pipe-1')
    const result = await parser.execute(makeAgentOutput('```json\n{"result": "success"}\n```'), ctx)
    expect(result.output.result).toBe('success')
  })

  it('throws AgentOutputParseError on invalid JSON', async () => {
    const parser = defineAgentOutputParser({
      id: 'parser',
      name: 'Parser',
      strategy: { type: 'json' },
      outputSchema: z.object({ result: z.string() }),
    })

    const ctx = createExecutionContext('pipe-1')
    await expect(parser.execute(makeAgentOutput('not valid json at all'), ctx)).rejects.toThrow(
      AgentOutputParseError,
    )
  })

  it('extracts regex match from content', async () => {
    const parser = defineAgentOutputParser({
      id: 'parser',
      name: 'Parser',
      strategy: { type: 'regex', pattern: /TICKET-(\d+)/, groupIndex: 1 },
      outputSchema: z.string(),
    })

    const ctx = createExecutionContext('pipe-1')
    const result = await parser.execute(
      makeAgentOutput('I created TICKET-4521 for your issue'),
      ctx,
    )
    expect(result.output).toBe('4521')
  })

  it('throws AgentOutputParseError when regex does not match', async () => {
    const parser = defineAgentOutputParser({
      id: 'parser',
      name: 'Parser',
      strategy: { type: 'regex', pattern: /TICKET-(\d+)/, groupIndex: 1 },
      outputSchema: z.string(),
    })

    const ctx = createExecutionContext('pipe-1')
    await expect(
      parser.execute(makeAgentOutput('No ticket ID in this response'), ctx),
    ).rejects.toThrow(AgentOutputParseError)
  })

  it('uses custom parse function', async () => {
    const parser = defineAgentOutputParser({
      id: 'parser',
      name: 'Parser',
      strategy: {
        type: 'custom',
        parse: (content) => ({
          summary: content.split('\n')[0] ?? '',
          lineCount: content.split('\n').length,
        }),
      },
      outputSchema: z.object({ summary: z.string(), lineCount: z.number() }),
    })

    const ctx = createExecutionContext('pipe-1')
    const result = await parser.execute(makeAgentOutput('First line\nSecond line\nThird line'), ctx)
    expect(result.output.summary).toBe('First line')
    expect(result.output.lineCount).toBe(3)
  })
})
