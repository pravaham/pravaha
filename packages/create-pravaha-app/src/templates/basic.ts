export const basicTemplateFiles: Record<string, string> = {
  'src/index.ts': `import 'dotenv/config'
import { z } from 'zod'
import { PipelineBuilder, TransformStep, LinearRouter } from '@pravaha/core'
import type { LLMRequest } from '@pravaha/core'
import { FsTraceStore } from '@pravaha/adapter-trace-fs'
{{ADAPTER_IMPORT}}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const LLMRequestSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant', 'tool']), content: z.string() })),
  model: z.string().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
})

const OutputSchema = z.object({ response: z.string() })

// ─── Steps ───────────────────────────────────────────────────────────────────

const prepareStep = new TransformStep(
  'prepare',
  'Prepare Input',
  z.string().min(1),
  LLMRequestSchema,
  (query): LLMRequest => ({ messages: [{ role: 'user', content: query }] }),
)

const llmStep = new {{STEP_CLASS}}('llm', 'LLM', {
{{#if claude}}  apiKey: process.env.ANTHROPIC_API_KEY!,{{/if}}
{{#if openai}}  apiKey: process.env.OPENAI_API_KEY!,{{/if}}
{{#if ollama}}  baseUrl: 'http://localhost:11434',{{/if}}
})

const formatStep = new TransformStep(
  'format',
  'Format Output',
  z.object({
    content: z.string(),
    model: z.string(),
    usage: z.object({ promptTokens: z.number(), completionTokens: z.number(), totalTokens: z.number() }),
  }),
  OutputSchema,
  (input) => ({ response: input.content }),
)

// ─── Pipeline ────────────────────────────────────────────────────────────────

const traceStore = new FsTraceStore({ traceDir: '.pravaha/traces' })

const pipeline = new PipelineBuilder<string, { response: string }>(
  { id: '{{PROJECT_NAME}}', name: '{{PROJECT_NAME}}', version: '1.0.0' },
  undefined,
  traceStore,
)
  .step(prepareStep, new LinearRouter('prepare-to-llm', 'llm'))
  .step(llmStep, new LinearRouter('llm-to-format', 'format'))
  .step(formatStep)
  .build()

// ─── Run ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const result = await pipeline.run('What is the capital of France?')

  console.log('Response:', result.output.response)
  console.log('Run ID:', result.trace.runId)
  console.log('Duration:', result.trace.durationMs + 'ms')
  console.log('')
  console.log('Inspect trace: npx pravaha trace show', result.trace.runId)
  console.log('View all traces: npx pravaha serve')
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

## Setup

\`\`\`bash
cp .env.example .env
# Add your API key to .env
pnpm install
\`\`\`

## Run

\`\`\`bash
pnpm dev
\`\`\`

## Inspect Traces

\`\`\`bash
# View in browser
pnpm trace

# Or via CLI
npx pravaha trace list
\`\`\`

## Learn More

- [Pravaha Docs](https://pravaha.dev)
- [GitHub](https://github.com/pravaham/pravaham)
`,
}
