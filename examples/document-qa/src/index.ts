/**
 * Document QA Pipeline
 *
 * Pattern: Load document → chunk it → agent answers questions using chunks as tools
 *
 * Production use case: Upload a PDF/contract/report, ask structured questions,
 * get cited answers. Directly maps to enterprise document processing workflows.
 *
 * Replace mock adapter with ClaudeToolCallingAdapter for real usage.
 */

import { z } from 'zod'
import {
  AgentStep,
  defineAgentOutputParser,
  PipelineBuilder,
  LinearRouter,
  PluginRegistry,
  withRetry,
  LLMRateLimitError,
  LLMTimeoutError,
} from '@pravaha/core'
import type { ToolDefinition } from '@pravaha/core'
import { FsTraceStore } from '@pravaha/adapter-trace-fs'
import { CostTrackerPlugin } from '@pravaha/plugin-cost-tracker'

// ─── Mock document store ──────────────────────────────────────────────────────
// In production: replace with real PDF parser + vector store

const MOCK_DOCUMENT = {
  title: 'Q3 Financial Report 2024',
  chunks: [
    { id: 'c1', text: 'Total revenue for Q3 2024 was $4.2 billion, up 12% year-over-year.' },
    {
      id: 'c2',
      text: 'Operating expenses increased to $2.1 billion, primarily due to R&D investments.',
    },
    { id: 'c3', text: 'Net profit margin improved to 18.5%, compared to 16.2% in Q3 2023.' },
    {
      id: 'c4',
      text: 'The company expanded into 3 new markets: Brazil, India, and Southeast Asia.',
    },
    {
      id: 'c5',
      text: 'Customer acquisition cost decreased by 8% following automation initiatives.',
    },
  ],
}

// ─── Tools ───────────────────────────────────────────────────────────────────

type SearchInput = { query: string }
type SearchOutput = { chunks: Array<{ id: string; text: string; relevance: number }> }

const searchDocumentTool: ToolDefinition<SearchInput, SearchOutput> = {
  id: 'search-document',
  name: 'Search Document',
  description: 'Search the document for relevant sections matching a query',
  inputSchema: z.object({ query: z.string().min(1) }),
  outputSchema: z.object({
    chunks: z.array(z.object({ id: z.string(), text: z.string(), relevance: z.number() })),
  }),
  execute: async ({ query }) => {
    const keywords = query.toLowerCase().split(' ')
    const scored = MOCK_DOCUMENT.chunks.map((chunk) => ({
      ...chunk,
      relevance:
        keywords.filter((k) => chunk.text.toLowerCase().includes(k)).length / keywords.length,
    }))
    return {
      chunks: scored
        .filter((c) => c.relevance > 0)
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, 3),
    }
  },
}

type MetaInput = Record<string, never>
type MetaOutput = { title: string; chunkCount: number }

const getDocumentMetaTool: ToolDefinition<MetaInput, MetaOutput> = {
  id: 'get-document-meta',
  name: 'Get Document Metadata',
  description: 'Get metadata about the loaded document',
  inputSchema: z.object({}),
  outputSchema: z.object({ title: z.string(), chunkCount: z.number() }),
  execute: async () => ({
    title: MOCK_DOCUMENT.title,
    chunkCount: MOCK_DOCUMENT.chunks.length,
  }),
}

// ─── Mock adapter ─────────────────────────────────────────────────────────────
// Replace with: new ClaudeToolCallingAdapter({ apiKey: process.env.ANTHROPIC_API_KEY! })

let callCount = 0
const smartMockAdapter = {
  adapterName: 'mock',
  chat: async (_messages: unknown, _tools: unknown) => {
    callCount++
    if (callCount === 1) {
      return {
        type: 'tool_calls' as const,
        toolCalls: [
          { id: 'tc-1', toolId: 'search-document', input: { query: 'revenue profit margin' } },
        ],
        usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
        model: 'mock',
      }
    }
    return {
      type: 'text' as const,
      content: JSON.stringify({
        answer: 'Q3 2024 revenue was $4.2 billion (up 12% YoY) with net profit margin of 18.5%.',
        citations: ['c1', 'c3'],
        confidence: 0.95,
      }),
      usage: { promptTokens: 80, completionTokens: 40, totalTokens: 120 },
      model: 'mock',
    }
  },
  buildToolResultMessage: () => ({ role: 'user' as const, content: '[]' }),
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

const OutputSchema = z.object({
  answer: z.string(),
  citations: z.array(z.string()),
  confidence: z.number(),
})

const agent = withRetry(
  new AgentStep({
    id: 'document-qa-agent',
    name: 'Document QA Agent',
    adapter: smartMockAdapter,
    tools: [searchDocumentTool, getDocumentMetaTool],
    systemPrompt: `You are a document analysis assistant.
Use the search-document tool to find relevant sections before answering.
Always cite the chunk IDs you used.
Respond with JSON: { "answer": string, "citations": string[], "confidence": number }`,
    maxIterations: 5,
  }),
  { maxAttempts: 2, retryOn: [LLMRateLimitError, LLMTimeoutError] },
)

const parser = defineAgentOutputParser({
  id: 'parse-qa-output',
  name: 'Parse QA Output',
  strategy: { type: 'json' },
  outputSchema: OutputSchema,
})

const plugins = new PluginRegistry()
plugins.register(new CostTrackerPlugin())

const traceStore = new FsTraceStore({ traceDir: '.pravaha/traces' })

const pipeline = new PipelineBuilder<string, z.infer<typeof OutputSchema>>(
  { id: 'document-qa', name: 'Document QA', version: '1.0.0' },
  plugins,
  traceStore,
)
  .step(agent, new LinearRouter('agent-to-parser', 'parse-qa-output'))
  .step(parser)
  .build()

// ─── Run ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const questions = ['What was the revenue and profit margin in Q3 2024?']

  for (const question of questions) {
    console.log(`\nQ: ${question}`)
    callCount = 0

    const result = await pipeline.run(question)

    console.log(`A: ${result.output.answer}`)
    console.log(`Citations: ${result.output.citations.join(', ')}`)
    console.log(`Confidence: ${(result.output.confidence * 100).toFixed(0)}%`)
    console.log(`Run ID: ${result.trace.runId}`)
  }

  console.log('\nInspect traces: npx pravaha serve')
}

main().catch(console.error)
