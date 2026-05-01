export const agentTemplateFiles: Record<string, string> = {
  'src/index.ts': `import 'dotenv/config'
import { z } from 'zod'
import {
  AgentStep,
  defineAgentOutputParser,
  defineToolStep,
  withRetry,
  PipelineBuilder,
  LinearRouter,
  LLMRateLimitError,
  LLMTimeoutError,
} from '@pravaha/core'
import type { ToolCallingAdapter, AgentLLMResponse } from '@pravaha/core'
import { FsTraceStore } from '@pravaha/adapter-trace-fs'

// ─── Tools ───────────────────────────────────────────────────────────────────

const searchTool = defineToolStep({
  id: 'search',
  name: 'Search',
  description: 'Search for information on a topic',
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ results: z.array(z.string()) }),
  execute: async ({ query }) => {
    // Replace with real search API
    return { results: [\`Result 1 for: \${query}\`, \`Result 2 for: \${query}\`] }
  },
})

const calculatorTool = defineToolStep({
  id: 'calculate',
  name: 'Calculator',
  description: 'Perform arithmetic calculations',
  inputSchema: z.object({ expression: z.string() }),
  outputSchema: z.object({ result: z.number() }),
  execute: async ({ expression }) => {
    // Safe eval for demo — use a proper math parser in production
    const result = Function('"use strict"; return (' + expression + ')')() as number
    return { result }
  },
})

// ─── Agent ───────────────────────────────────────────────────────────────────

// Mock adapter — replace with ClaudeToolCallingAdapter or OpenAIToolCallingAdapter
const mockAdapter: ToolCallingAdapter = {
  adapterName: 'mock',
  chat: async (_messages, _tools, _options) => ({
    type: 'text' as const,
    content: '{"answer": "42", "reasoning": "The answer to everything"}',
    usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
    model: 'mock',
  }) as AgentLLMResponse,
  buildToolResultMessage: (_results) => ({ role: 'user' as const, content: '[]' }),
}

// For Claude: import { ClaudeToolCallingAdapter } from '@pravaha/adapter-claude'
// const adapter = new ClaudeToolCallingAdapter({ apiKey: process.env.ANTHROPIC_API_KEY! })

const agent = new AgentStep({
  id: 'main-agent',
  name: 'Main Agent',
  adapter: mockAdapter,
  tools: [searchTool, calculatorTool],
  systemPrompt: 'You are a helpful assistant. Use tools when needed.',
  maxIterations: 10,
})

const resilientAgent = withRetry(agent, {
  maxAttempts: 3,
  backoffMs: 1000,
  retryOn: [LLMRateLimitError, LLMTimeoutError],
})

const outputParser = defineAgentOutputParser({
  id: 'parse-output',
  name: 'Parse Output',
  strategy: { type: 'json' },
  outputSchema: z.object({
    answer: z.string(),
    reasoning: z.string(),
  }),
})

// ─── Pipeline ────────────────────────────────────────────────────────────────

const traceStore = new FsTraceStore({ traceDir: '.pravaha/traces' })

const pipeline = new PipelineBuilder<string, { answer: string; reasoning: string }>(
  { id: '{{PROJECT_NAME}}', name: '{{PROJECT_NAME}}', version: '1.0.0' },
  undefined,
  traceStore,
)
  .step(resilientAgent, new LinearRouter('agent-to-parser', 'parse-output'))
  .step(outputParser)
  .build()

// ─── Run ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const result = await pipeline.run('What is the meaning of life?')

  console.log('Answer:', result.output.answer)
  console.log('Reasoning:', result.output.reasoning)
  console.log('')
  console.log('Run ID:', result.trace.runId)
  console.log('Inspect: npx pravaha trace show', result.trace.runId)
}

main().catch(console.error)
`,

  'package.json': `{
  "name": "{{PROJECT_NAME}}",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "trace": "pravaha serve"
  },
  "dependencies": {
    "@pravaha/core": "latest",
    "{{ADAPTER_PACKAGE}}": "latest",
    "@pravaha/adapter-trace-fs": "latest",
    "@pravaha/cli": "latest",
    "dotenv": "^16.0.0",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "tsx": "^4.7.0",
    "typescript": "^5.4.0"
  }
}
`,

  'tsconfig.json': `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
`,

  '.env.example': `# Pravaha — {{PROJECT_NAME}}
# Copy this file to .env and fill in your values

{{#if claude}}# Anthropic API Key — https://console.anthropic.com
ANTHROPIC_API_KEY=your_api_key_here{{/if}}
{{#if openai}}# OpenAI API Key — https://platform.openai.com
OPENAI_API_KEY=your_api_key_here{{/if}}
{{#if ollama}}# Ollama runs locally — no API key needed
# Make sure Ollama is running: ollama serve
# Pull a model first: ollama pull llama3.2{{/if}}
`,

  'README.md': `# {{PROJECT_NAME}}

Built with [Pravaha](https://pravaha.dev) — composable agentic AI workflows.

This template demonstrates an **AgentStep** with tool calling, output parsing, and retry logic.

## Setup

\`\`\`bash
cp .env.example .env
# Add your API key to .env, then swap the mockAdapter in src/index.ts
pnpm install
\`\`\`

## Run

\`\`\`bash
pnpm dev
\`\`\`

## Inspect Traces

\`\`\`bash
pnpm trace
\`\`\`

## Learn More

- [Pravaha Docs](https://pravaha.dev)
- [Agents Guide](https://pravaha.dev/guide/agents)
`,
}
