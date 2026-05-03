# Steps

A **step** is the fundamental unit of work in Pravaha. Every step does one thing: it receives a typed input, does something, and returns a typed output. Pipelines are built by connecting steps together.

Every step has:

- A unique `id` within the pipeline
- An `inputSchema` (Zod) — validated automatically before your code runs
- An `outputSchema` (Zod) — validated automatically after your code runs
- A `run()` method containing the actual logic

Validation is not optional and not something you implement — it happens automatically on every execution.

## TransformStep

Use `TransformStep` for pure data transformation: reshaping, formatting, computing, or converting between types. No LLM calls, no external APIs.

```typescript
import { z } from 'zod'
import { TransformStep } from '@pravaha/core'
import type { LLMRequest } from '@pravaha/core'

// Converts a plain string into the LLMRequest shape that LLM steps expect
const prepare = new TransformStep(
  'prepare', // step id
  'Prepare Request', // human-readable name
  z.string(), // inputSchema
  z.object({
    // outputSchema
    messages: z.array(
      z.object({
        role: z.enum(['system', 'user', 'assistant', 'tool']),
        content: z.string(),
      }),
    ),
  }),
  (query): LLMRequest => ({
    messages: [{ role: 'user', content: query }],
  }),
)
```

`TransformStep` is also useful for enriching data between steps:

```typescript
const enrich = new TransformStep(
  'enrich',
  'Enrich with Timestamp',
  TicketSchema,
  EnrichedTicketSchema,
  (ticket) => ({
    ...ticket,
    receivedAt: Date.now(),
    region: process.env.REGION ?? 'us',
  }),
)
```

## Custom Step (extending BaseStep)

For anything more complex than a pure transform — steps that keep internal state, call multiple things, or have custom error handling — extend `BaseStep` directly.

```typescript
import { z } from 'zod'
import { BaseStep } from '@pravaha/core'
import type { ExecutionContext } from '@pravaha/core'

const TicketSchema = z.object({
  id: z.string(),
  subject: z.string(),
  body: z.string(),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
})

const ClassificationSchema = z.object({
  category: z.enum(['billing', 'technical', 'general']),
  confidence: z.number(),
})

class ClassifyTicketStep extends BaseStep<
  z.infer<typeof TicketSchema>,
  z.infer<typeof ClassificationSchema>
> {
  readonly id = 'classify-ticket'
  readonly name = 'Classify Ticket'
  readonly type = 'transform'
  readonly inputSchema = TicketSchema
  readonly outputSchema = ClassificationSchema

  protected async run(
    input: z.infer<typeof TicketSchema>,
    _context: ExecutionContext,
  ): Promise<z.infer<typeof ClassificationSchema>> {
    const text = `${input.subject} ${input.body}`.toLowerCase()

    if (text.includes('invoice') || text.includes('refund')) {
      return { category: 'billing', confidence: 0.92 }
    }
    if (text.includes('error') || text.includes('crash')) {
      return { category: 'technical', confidence: 0.88 }
    }
    return { category: 'general', confidence: 0.6 }
  }
}
```

The `_context` parameter gives you access to the execution context — shared state, conversation history, and the run ID. See [Core Concepts](/guide/core-concepts) for details.

## ToolStep

`ToolStep` wraps any async function (an external API call, database query, etc.) as a pipeline step with full schema validation. See [Tools](/guide/tools) for a full guide.

```typescript
import { z } from 'zod'
import { defineToolStep } from '@pravaha/core'

const fetchUser = defineToolStep({
  id: 'fetch-user',
  name: 'Fetch User',
  description: 'Fetches a user record from the database',
  inputSchema: z.object({ userId: z.string() }),
  outputSchema: z.object({ name: z.string(), email: z.string(), plan: z.string() }),
  execute: async ({ userId }) => {
    const user = await db.users.findById(userId)
    return { name: user.name, email: user.email, plan: user.subscription.plan }
  },
})
```

## LLM Steps

LLM steps are provided by adapter packages. They all follow the same `LLMRequest → LLMResponse` contract.

```typescript
import { ClaudeLLMStep } from '@pravaha/adapter-claude'
import { OpenAILLMStep } from '@pravaha/adapter-openai'
import { OllamaLLMStep } from '@pravaha/adapter-ollama'

// All three have identical interfaces
const llm = new ClaudeLLMStep('llm', 'LLM', {
  apiKey: process.env.ANTHROPIC_API_KEY!,
  defaultModel: 'claude-opus-4-5',
})

// Input shape
const input = {
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Summarize this ticket: ...' },
  ],
  temperature: 0.2,
  maxTokens: 1024,
}
```

The LLM step output always includes `content` (the response text), `model` (which model responded), and `usage` (token counts).

See the adapter guides for full configuration options:

- [Claude](/guide/adapters/claude)
- [OpenAI](/guide/adapters/openai)
- [Ollama](/guide/adapters/ollama)

## AgentStep

`AgentStep` implements a full agentic loop: the LLM decides which tools to call, executes them, observes the results, and repeats until it has a final answer. See [Agents](/guide/agents) for a full guide.

```typescript
import { AgentStep } from '@pravaha/core'
import { ClaudeToolCallingAdapter } from '@pravaha/adapter-claude'

const agent = new AgentStep({
  id: 'support-agent',
  name: 'Support Agent',
  adapter: new ClaudeToolCallingAdapter({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  tools: [knowledgeBaseTool, createTicketTool],
  systemPrompt: 'You are a support triage agent. Use tools to investigate and respond.',
  maxIterations: 10,
})
```

## How Validation Works

You never call validation manually. `BaseStep.execute()` (which is what the pipeline calls) validates input before `run()` and validates output after `run()`. If either fails, a `ValidationError` is thrown immediately with the exact field and reason.

```
ValidationError: Validation failed for 'classify-ticket.output':
  - confidence: Expected number, received string
```

This catches schema mismatches at the boundary where they happen — not three steps later when the bad data causes a confusing error elsewhere.

## Step Type Reference

| Type           | Class                                  | When to use                                |
| -------------- | -------------------------------------- | ------------------------------------------ |
| Pure transform | `TransformStep`                        | Data reshaping, formatting, enrichment     |
| Custom logic   | Extend `BaseStep`                      | Complex classification, multi-branch logic |
| External call  | `defineToolStep`                       | APIs, databases, file system               |
| LLM call       | `ClaudeLLMStep` / `OpenAILLMStep` etc. | Text generation, classification via prompt |
| Agentic loop   | `AgentStep`                            | LLM-driven tool selection and reasoning    |
