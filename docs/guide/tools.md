# Tools

A **tool** is any typed, named, executable function — an API call, a database query, a file operation, an external service. In Pravaha, tools serve two purposes:

1. **As pipeline steps** — use `defineToolStep` to wrap a function as a step with full schema validation, tracing, and error handling.
2. **As LLM tools** — pass tool definitions to `AgentStep` so the LLM can decide when to call them.

## Defining a Tool

A tool is a plain object implementing `ToolDefinition<TInput, TOutput>`:

```typescript
import { z } from 'zod'
import type { ToolDefinition } from '@pravaha/core'

const searchKnowledgeBase: ToolDefinition<
  { query: string; limit?: number },
  { articles: Array<{ id: string; title: string; summary: string }> }
> = {
  id: 'kb-search',
  name: 'Knowledge Base Search',
  description: 'Searches the internal knowledge base for relevant articles',
  inputSchema: z.object({
    query: z.string(),
    limit: z.number().int().positive().optional(),
  }),
  outputSchema: z.object({
    articles: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        summary: z.string(),
      }),
    ),
  }),
  execute: async ({ query, limit = 5 }) => {
    const results = await knowledgeBase.search(query, limit)
    return { articles: results.map((r) => ({ id: r.id, title: r.title, summary: r.excerpt })) }
  },
}
```

The `description` field matters when using the tool with an `AgentStep` — it is what the LLM reads to decide whether to call the tool.

## Using Tools as Pipeline Steps

Wrap any `ToolDefinition` as a pipeline step using `defineToolStep`:

```typescript
import { defineToolStep } from '@pravaha/core'

const kbSearchStep = defineToolStep(searchKnowledgeBase)

// Now use it exactly like any other step
pipeline
  .step(classifyStep, classifyRouter)
  .step(kbSearchStep, new LinearRouter('kb-to-respond', 'respond-step'))
  .step(respondStep)
  .build()
```

`defineToolStep` returns a `ToolStep` which:

- Validates input with `inputSchema` before calling `execute`
- Validates output with `outputSchema` after `execute` returns
- Records the step in the trace with `type: 'tool'`
- Wraps non-Pravaha errors in `StepExecutionError`

## Using Tools with AgentStep

Pass tool definitions to `AgentStep` and the LLM will decide when to call them:

```typescript
import { AgentStep } from '@pravaha/core'
import { ClaudeToolCallingAdapter } from '@pravaha/adapter-claude'

const agent = new AgentStep({
  id: 'support-agent',
  name: 'Support Agent',
  adapter: new ClaudeToolCallingAdapter({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  tools: [searchKnowledgeBase, createTicketTool, lookupCustomerTool],
  systemPrompt: `You are a support agent. Use tools to investigate and resolve customer issues.
Return a JSON object with: { category, response, escalate }`,
  maxIterations: 8,
})
```

The agent loop:

1. Sends the user message + tool schemas to the LLM
2. If the LLM calls a tool, executes `execute()` with the LLM's input
3. Feeds the tool result back to the LLM
4. Repeats until the LLM gives a final text response

See [Agents](/guide/agents) for a complete guide to the agent loop.

## Real-World Tool Examples

### Database lookup

```typescript
import { z } from 'zod'
import type { ToolDefinition } from '@pravaha/core'

const fetchCustomer: ToolDefinition<
  { customerId: string },
  { name: string; plan: string; balance: number }
> = {
  id: 'fetch-customer',
  name: 'Fetch Customer',
  description: 'Retrieves customer account details including name, plan, and current balance',
  inputSchema: z.object({ customerId: z.string() }),
  outputSchema: z.object({
    name: z.string(),
    plan: z.enum(['free', 'pro', 'enterprise']),
    balance: z.number(),
  }),
  execute: async ({ customerId }) => {
    const customer = await db.customers.findById(customerId)
    if (!customer) throw new Error(`Customer ${customerId} not found`)
    return { name: customer.name, plan: customer.plan, balance: customer.accountBalance }
  },
}
```

### External API call

```typescript
const getWeather: ToolDefinition<{ city: string }, { temp: number; condition: string }> = {
  id: 'get-weather',
  name: 'Get Weather',
  description: 'Returns the current temperature and weather condition for a city',
  inputSchema: z.object({ city: z.string() }),
  outputSchema: z.object({ temp: z.number(), condition: z.string() }),
  execute: async ({ city }) => {
    const response = await fetch(`https://api.weather.example.com/current?city=${city}`)
    const data = (await response.json()) as { temp: number; condition: string }
    return { temp: data.temp, condition: data.condition }
  },
}
```

### File operation

```typescript
import { readFile } from 'node:fs/promises'

const readDocument: ToolDefinition<{ path: string }, { content: string; lines: number }> = {
  id: 'read-document',
  name: 'Read Document',
  description: 'Reads a text file and returns its content and line count',
  inputSchema: z.object({ path: z.string() }),
  outputSchema: z.object({ content: z.string(), lines: z.number() }),
  execute: async ({ path }) => {
    const content = await readFile(path, 'utf-8')
    return { content, lines: content.split('\n').length }
  },
}
```

## Tool Schema Export

When you pass a tool to an `AgentStep`, Pravaha automatically converts its `inputSchema` to a JSON Schema format that LLMs understand. You can also do this manually:

```typescript
import { toAnthropicTool } from '@pravaha/core'

const schema = toAnthropicTool(searchKnowledgeBase)
// {
//   name: 'kb-search',
//   description: 'Searches the internal knowledge base...',
//   input_schema: { type: 'object', properties: { query: { type: 'string' }, ... } }
// }
```

## AnyToolDefinition

When writing functions that accept any tool regardless of its specific input/output types, use `AnyToolDefinition`:

```typescript
import type { AnyToolDefinition } from '@pravaha/core'

function logToolNames(tools: AnyToolDefinition[]): void {
  tools.forEach((t) => console.log(t.id, '-', t.description))
}
```
