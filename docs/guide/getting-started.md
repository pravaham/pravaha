# Getting Started

## Prerequisites

- Node.js 20+
- pnpm, npm, or yarn

## Scaffold a New Project

The fastest way to start:

```bash
npm create pravaha-app@latest
```

This walks you through:
1. Project name
2. Template (basic / agent / support-triage)
3. LLM provider (Claude / OpenAI / Ollama)

Then:

```bash
cd my-project
cp .env.example .env
# Add your API key
pnpm install
pnpm dev
```

## Manual Installation

```bash
pnpm add @pravaha/core @pravaha/adapter-claude
```

## Your First Pipeline

```typescript
import { z } from 'zod'
import { PipelineBuilder, TransformStep, LinearRouter } from '@pravaha/core'
import type { LLMRequest } from '@pravaha/core'
import { ClaudeLLMStep } from '@pravaha/adapter-claude'

const LLMRequestSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant', 'tool']), content: z.string() })),
})

const prepare = new TransformStep(
  'prepare', 'Prepare',
  z.string(), LLMRequestSchema,
  (q): LLMRequest => ({ messages: [{ role: 'user', content: q }] }),
)

const llm = new ClaudeLLMStep('llm', 'LLM', {
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

const pipeline = new PipelineBuilder({
  id: 'my-first-pipeline',
  name: 'My First Pipeline',
  version: '1.0.0',
})
  .step(prepare, new LinearRouter('to-llm', 'llm'))
  .step(llm)
  .build()

const result = await pipeline.run('Hello!')
console.log(result.output.content)
```

## Inspect the Trace

Every run produces a full trace:

```typescript
console.log(result.trace.runId)        // unique run ID
console.log(result.trace.durationMs)   // total duration
console.log(result.trace.events)       // all step events
```

Or use the visual trace viewer:

```bash
npx pravaha serve
```

## Next Steps

- [Core Concepts](/guide/core-concepts) — understand Pipeline, Step, Router, Trace
- [Building Agents](/guide/agents) — LLM-driven tool selection
- [Dry-Run Mode](/guide/dry-run) — test without API calls
