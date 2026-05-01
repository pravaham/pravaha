<div align="center">
  <h1>⬡ Pravaha</h1>
  <p><strong>Composable agentic AI workflows. No magic, no bloat.</strong></p>
  <p>
    <a href="https://pravaha.dev">Docs</a> ·
    <a href="https://pravaha.dev/guide/getting-started">Quick Start</a> ·
    <a href="https://github.com/pravaham/pravaha/issues">Issues</a>
  </p>
  <p>
    <img src="https://img.shields.io/npm/v/@pravaha/core?color=6366f1&label=%40pravaha%2Fcore" alt="npm version" />
    <img src="https://img.shields.io/github/license/pravaham/pravaha?color=22c55e" alt="MIT license" />
    <img src="https://img.shields.io/github/actions/workflow/status/pravaham/pravaha/ci.yml?label=CI" alt="CI" />
  </p>
</div>

---

## Why Pravaha?

Building AI agents with LangChain means fighting the framework.
Building without a framework means untestable spaghetti.

Pravaha gives you structure without complexity:

- **No hidden state** — every step input and output is explicit and inspectable
- **Full observability** — every run produces a complete trace automatically
- **Test without LLMs** — dry-run entire pipelines with mock responses
- **Provider-agnostic** — Claude, OpenAI, Ollama — swap in one line
- **True agentic loops** — AgentStep with tool calling across all providers
- **TypeScript-first** — strict types end to end, no `any`

## Quick Start

```bash
npm create pravaha-app@latest
```

Or install manually:

```bash
npm install @pravaha/core @pravaha/adapter-claude
```

```typescript
import { PipelineBuilder, TransformStep, LinearRouter } from '@pravaha/core'
import type { LLMRequest } from '@pravaha/core'
import { ClaudeLLMStep } from '@pravaha/adapter-claude'

const prepare = new TransformStep('prepare', 'Prepare', z.string(), LLMRequestSchema,
  (q): LLMRequest => ({ messages: [{ role: 'user', content: q }] }))

const llm = new ClaudeLLMStep('llm', 'LLM', { apiKey: process.env.ANTHROPIC_API_KEY! })

const pipeline = new PipelineBuilder({ id: 'my-pipeline', name: 'My Pipeline', version: '1.0.0' })
  .step(prepare, new LinearRouter('to-llm', 'llm'))
  .step(llm)
  .build()

const result = await pipeline.run('What is 2 + 2?')
console.log(result.output.content) // "4"
console.log(result.trace)          // Full execution trace
```

## Agentic Pipelines

```typescript
import { AgentStep, defineToolStep, defineAgentOutputParser, withRetry } from '@pravaha/core'
import { ClaudeToolCallingAdapter } from '@pravaha/adapter-claude'
import { z } from 'zod'

const searchTool = defineToolStep({
  id: 'search',
  name: 'Search KB',
  description: 'Search knowledge base for relevant articles',
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ articles: z.array(z.string()) }),
  execute: async ({ query }) => knowledgeBase.search(query),
})

const agent = withRetry(
  new AgentStep({
    id: 'support-agent',
    name: 'Support Agent',
    adapter: new ClaudeToolCallingAdapter({ apiKey: process.env.ANTHROPIC_API_KEY! }),
    tools: [searchTool],
    systemPrompt: 'Use tools to find the best answer.',
    maxIterations: 10,
  }),
  { maxAttempts: 3, retryOn: [LLMRateLimitError] },
)
```

## Inspect Every Run

```bash
# View traces in browser
npx pravaha serve

# Export standalone HTML report
npx pravaha trace export html

# CLI inspection
npx pravaha trace list
npx pravaha trace show <runId>
```

## Packages

| Package | Description |
|---|---|
| `@pravaha/core` | Pipeline engine, AgentStep, ToolStep, withRetry |
| `@pravaha/adapter-claude` | Anthropic Claude — direct + Vertex AI |
| `@pravaha/adapter-openai` | OpenAI + Azure OpenAI |
| `@pravaha/adapter-ollama` | Local models via Ollama |
| `@pravaha/adapter-memory-redis` | Redis memory backend |
| `@pravaha/adapter-trace-fs` | File-system trace store |
| `@pravaha/plugin-cost-tracker` | Token cost tracking |
| `@pravaha/cli` | Trace inspector CLI |

## vs LangChain

| | Pravaha | LangChain |
|---|---|---|
| Bundle size | Minimal | Heavy |
| TypeScript | Strict, first-class | Partial |
| Debugging | Full trace on every run | Console logs |
| Testing | Dry-run mode, mock adapters | Hard |
| Learning curve | 30 minutes | Days |
| Provider swap | One import change | Refactor |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All contributions welcome.

## License

MIT © [Pravaha Contributors](LICENSE)
