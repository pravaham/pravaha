/**
 * Research Agent Pipeline
 *
 * Pattern: Given a topic → agent searches multiple sources → synthesizes report
 *
 * Production use case: Automated research, competitive intelligence,
 * market analysis. Agent decides what to search and how to synthesize.
 *
 * Replace mock adapter with ClaudeToolCallingAdapter for real usage.
 * Replace mock search tools with real APIs (Tavily, Serper, Brave Search).
 */

import { z } from 'zod'
import {
  AgentStep,
  defineAgentOutputParser,
  PipelineBuilder,
  LinearRouter,
  withRetry,
  LLMRateLimitError,
  LLMTimeoutError,
} from '@pravaha/core'
import type { ToolDefinition } from '@pravaha/core'
import { FsTraceStore } from '@pravaha/adapter-trace-fs'

// ─── Tools ───────────────────────────────────────────────────────────────────

type SearchInput = { query: string; maxResults: number }
type SearchOutput = { results: Array<{ title: string; url: string; snippet: string }> }

const webSearchTool: ToolDefinition<SearchInput, SearchOutput> = {
  id: 'web-search',
  name: 'Web Search',
  description: 'Search the web for recent information on a topic',
  inputSchema: z.object({
    query: z.string(),
    maxResults: z.number().min(1).max(10),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string(),
    })),
  }),
  execute: async ({ query, maxResults }) => {
    // Production: use Tavily, Serper, or Brave Search API
    return {
      results: Array.from({ length: Math.min(maxResults, 3) }, (_, i) => ({
        title: `${query} — Source ${i + 1}`,
        url: `https://example.com/${query.replace(/\s/g, '-')}-${i + 1}`,
        snippet: `Relevant information about ${query}. This would be real web content in production.`,
      })),
    }
  },
}

type SummarizeInput = { url: string }
type SummarizeOutput = { summary: string; keyPoints: string[] }

const summarizeSourceTool: ToolDefinition<SummarizeInput, SummarizeOutput> = {
  id: 'summarize-source',
  name: 'Summarize Source',
  description: 'Fetch and summarize content from a URL',
  inputSchema: z.object({ url: z.string().url() }),
  outputSchema: z.object({ summary: z.string(), keyPoints: z.array(z.string()) }),
  execute: async ({ url }) => {
    // Production: fetch URL, extract text, summarize with LLM
    return {
      summary: `Summary of content from ${url}`,
      keyPoints: ['Key point 1', 'Key point 2', 'Key point 3'],
    }
  },
}

// ─── Mock adapter ─────────────────────────────────────────────────────────────

let researchCallCount = 0
const researchMockAdapter = {
  adapterName: 'mock',
  chat: async () => {
    researchCallCount++
    if (researchCallCount === 1) {
      return {
        type: 'tool_calls' as const,
        toolCalls: [
          { id: 'tc-1', toolId: 'web-search', input: { query: 'agentic AI frameworks 2024', maxResults: 3 } },
        ],
        usage: { promptTokens: 60, completionTokens: 25, totalTokens: 85 },
        model: 'mock',
      }
    }
    return {
      type: 'text' as const,
      content: JSON.stringify({
        title: 'Agentic AI Frameworks: State of the Market 2024',
        summary: 'The agentic AI space is rapidly evolving with frameworks focusing on tool calling, observability, and production reliability.',
        keyFindings: [
          'LangChain dominates but developers seek simpler alternatives',
          'Observability and debugging are top pain points',
          'TypeScript-first frameworks gaining traction',
        ],
        sources: ['https://example.com/agentic-ai-1', 'https://example.com/agentic-ai-2'],
        confidence: 0.87,
      }),
      usage: { promptTokens: 120, completionTokens: 80, totalTokens: 200 },
      model: 'mock',
    }
  },
  buildToolResultMessage: () => ({ role: 'user' as const, content: '[]' }),
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

const ResearchOutputSchema = z.object({
  title: z.string(),
  summary: z.string(),
  keyFindings: z.array(z.string()),
  sources: z.array(z.string()),
  confidence: z.number(),
})

const researchAgent = withRetry(
  new AgentStep({
    id: 'research-agent',
    name: 'Research Agent',
    adapter: researchMockAdapter,
    tools: [webSearchTool, summarizeSourceTool],
    systemPrompt: `You are a research assistant. Given a topic:
1. Use web-search to find relevant sources
2. Use summarize-source on the most relevant URLs
3. Synthesize findings into a structured report
Respond with JSON matching the required schema.`,
    maxIterations: 8,
  }),
  { maxAttempts: 2, retryOn: [LLMRateLimitError, LLMTimeoutError] },
)

const researchParser = defineAgentOutputParser({
  id: 'parse-research',
  name: 'Parse Research Output',
  strategy: { type: 'json' },
  outputSchema: ResearchOutputSchema,
})

const traceStore = new FsTraceStore({ traceDir: '.pravaha/traces' })

const researchPipeline = new PipelineBuilder<string, z.infer<typeof ResearchOutputSchema>>(
  { id: 'research-agent', name: 'Research Agent', version: '1.0.0' },
  undefined,
  traceStore,
)
  .step(researchAgent, new LinearRouter('to-parser', 'parse-research'))
  .step(researchParser)
  .build()

async function main(): Promise<void> {
  researchCallCount = 0
  const topic = 'agentic AI frameworks and their adoption in enterprise'
  console.log(`\nResearching: "${topic}"`)

  const result = await researchPipeline.run(topic)

  console.log(`\n${result.output.title}`)
  console.log(`\nSummary: ${result.output.summary}`)
  console.log('\nKey Findings:')
  result.output.keyFindings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))
  console.log(`\nConfidence: ${(result.output.confidence * 100).toFixed(0)}%`)
  console.log(`Sources: ${result.output.sources.length}`)
  console.log(`\nRun ID: ${result.trace.runId}`)
  console.log('Inspect: npx pravaha serve')
}

main().catch(console.error)
