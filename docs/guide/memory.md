# Memory

**Memory** in Pravaha is a key-value store that pipeline steps can read and write during execution. It is separate from the execution context — context is immutable and scoped to a single run, while memory persists across multiple runs.

Use memory for:

- Storing conversation history across multiple pipeline invocations
- Caching expensive lookup results (customer records, KB articles)
- Sharing state between unrelated pipeline runs (e.g. processing a batch of tickets where each run should know about the others)

## The MemoryStore Interface

All memory backends implement this interface:

```typescript
interface MemoryStore {
  set(key: string, value: unknown, ttlMs?: number): Promise<void>
  get<T = unknown>(key: string): Promise<T | null>
  delete(key: string): Promise<void>
  has(key: string): Promise<boolean>
  clear(): Promise<void>
  keys(prefix?: string): Promise<readonly string[]>
}
```

`get` returns `null` on a miss — it never throws for a missing key. All methods are async to support both local and remote backends with the same interface.

## In-Memory Store

The in-memory adapter stores data in a JavaScript `Map`. It is ideal for development, testing, and single-process deployments where persistence across restarts is not required.

```bash
pnpm add @pravaha/adapter-memory-inmemory
```

```typescript
import { InMemoryStore } from '@pravaha/adapter-memory-inmemory'

const memory = new InMemoryStore()

// Store a value
await memory.set('user:123:context', { lastTicket: 'TKT-001', preferredLanguage: 'en' })

// Retrieve it
const ctx = await memory.get<{ lastTicket: string; preferredLanguage: string }>('user:123:context')
console.log(ctx?.lastTicket) // 'TKT-001'

// Set with TTL (expires after 10 minutes)
await memory.set('session:abc', sessionData, 10 * 60 * 1000)

// List all keys for a user
const keys = await memory.keys('user:123:')
```

## Redis Store

For production, multi-process, or multi-instance deployments, use the Redis adapter. Data persists across restarts and is shared across all instances.

```bash
pnpm add @pravaha/adapter-memory-redis
```

```typescript
import { RedisMemoryStore } from '@pravaha/adapter-memory-redis'

const memory = new RedisMemoryStore({
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  keyPrefix: 'pravaha:', // optional — namespaces all keys
})

await memory.set('user:123:history', conversationHistory)
const history = await memory.get('user:123:history')
```

## Using Memory in a Pipeline

Pass a memory store to `PipelineBuilder` and access it via `context.state` (for values set before the run) or use a `ToolStep` to read/write during execution.

### Approach 1: Pre-load memory before the run

```typescript
// Load user context before starting
const userMemory = await memory.get<UserContext>(`user:${userId}`)

const result = await pipeline.run(ticket, {
  userId,
  userMemory: userMemory ?? { history: [] },
})
```

Then access it inside steps:

```typescript
protected async run(input: Ticket, context: ExecutionContext): Promise<Response> {
  const userMemory = context.state['userMemory'] as UserContext
  // Use userMemory.history to provide personalised responses
}
```

### Approach 2: Memory tool steps

Wrap memory operations as `ToolStep`s so the pipeline reads and writes during execution:

```typescript
import { z } from 'zod'
import { defineToolStep } from '@pravaha/core'

const loadHistory = defineToolStep({
  id: 'load-history',
  name: 'Load Conversation History',
  description: 'Loads previous conversation history for this customer',
  inputSchema: z.object({ customerId: z.string() }),
  outputSchema: z.object({
    customerId: z.string(),
    history: z.array(z.object({ role: z.string(), content: z.string() })),
  }),
  execute: async ({ customerId }) => {
    const history = await memory.get<Array<{ role: string; content: string }>>(
      `history:${customerId}`,
    )
    return { customerId, history: history ?? [] }
  },
})

const saveHistory = defineToolStep({
  id: 'save-history',
  name: 'Save Conversation History',
  description: 'Persists the updated conversation history',
  inputSchema: z.object({
    customerId: z.string(),
    message: z.string(),
    response: z.string(),
  }),
  outputSchema: z.object({ saved: z.boolean() }),
  execute: async ({ customerId, message, response }) => {
    const existing =
      (await memory.get<Array<{ role: string; content: string }>>(`history:${customerId}`)) ?? []

    await memory.set(`history:${customerId}`, [
      ...existing,
      { role: 'user', content: message },
      { role: 'assistant', content: response },
    ])

    return { saved: true }
  },
})
```

## Key Naming Conventions

Use structured keys to keep memory organised and queryable by prefix:

```
user:{userId}:context        — per-user context
user:{userId}:history        — conversation history
session:{sessionId}:state    — per-session ephemeral state
cache:kb:{query}             — cached knowledge base lookups
pipeline:{pipelineId}:stats  — pipeline-level aggregates
```

Query by prefix:

```typescript
const userKeys = await memory.keys('user:123:')
// ['user:123:context', 'user:123:history']
```

## MemoryEntry

Every stored value is wrapped in a `MemoryEntry`:

```typescript
interface MemoryEntry {
  id: string // unique entry ID
  key: string // the key you used
  value: unknown // the stored value
  createdAt: number // Unix timestamp (ms)
  expiresAt?: number // Unix timestamp (ms), if TTL was set
  metadata: Record<string, unknown> // arbitrary extra data
}
```

You normally work with values directly via `get()` and `set()`, but adapters expose `MemoryEntry` when you need the full record including timestamps.
