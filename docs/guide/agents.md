# Building Agents

An **AgentStep** runs a think-act-observe loop — the LLM decides which tools to call until it has enough information to give a final answer.

## Basic Agent

```typescript
import { AgentStep, defineToolStep } from '@pravaha/core'
import { ClaudeToolCallingAdapter } from '@pravaha/adapter-claude'
import { z } from 'zod'

const searchTool = defineToolStep({
  id: 'search',
  name: 'Search',
  description: 'Search for information',
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ results: z.array(z.string()) }),
  execute: async ({ query }) => mySearchApi.search(query),
})

const agent = new AgentStep({
  id: 'my-agent',
  name: 'My Agent',
  adapter: new ClaudeToolCallingAdapter({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  tools: [searchTool],
  systemPrompt: 'Use tools to find the best answer.',
  maxIterations: 10,
})
```

## Parsing Agent Output

AgentStep always returns a string. Use `AgentOutputParser` to parse it:

```typescript
import { defineAgentOutputParser } from '@pravaha/core'

const parser = defineAgentOutputParser({
  id: 'parse',
  name: 'Parse',
  strategy: { type: 'json' },
  outputSchema: z.object({ answer: z.string(), confidence: z.number() }),
})

// In pipeline
pipeline
  .step(agent, new LinearRouter('to-parser', 'parse'))
  .step(parser)
```

Three parsing strategies:
- `json` — parses JSON, strips markdown fences automatically
- `regex` — extracts pattern from response
- `custom` — full control with a parse function

## Adding Resilience

```typescript
import { withRetry, LLMRateLimitError, LLMTimeoutError } from '@pravaha/core'

const resilientAgent = withRetry(agent, {
  maxAttempts: 3,
  backoffMs: 1000,
  backoffMultiplier: 2,
  retryOn: [LLMRateLimitError, LLMTimeoutError],
})
```

## Provider Adapters

| Provider | Adapter |
|---|---|
| Anthropic Claude | `ClaudeToolCallingAdapter` from `@pravaha/adapter-claude` |
| GCP Vertex AI | `ClaudeVertexToolCallingAdapter` from `@pravaha/adapter-claude-vertex` |
| OpenAI | `OpenAIToolCallingAdapter` from `@pravaha/adapter-openai` |
| Ollama (local) | `OllamaToolCallingAdapter` from `@pravaha/adapter-ollama` |

Swap adapters without changing any pipeline code.
