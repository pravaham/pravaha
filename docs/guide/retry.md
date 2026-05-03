# Retry Policies

LLM APIs fail. Rate limits happen. Networks time out. `withRetry` wraps any step with automatic retry logic so your pipeline keeps running instead of crashing on transient failures.

## Basic Usage

```typescript
import { withRetry, LLMRateLimitError, LLMTimeoutError } from '@pravaha/core'
import { ClaudeLLMStep } from '@pravaha/adapter-claude'

const llmStep = new ClaudeLLMStep('llm', 'LLM', {
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

// Wrap the step with retry logic
const resilientLLM = withRetry(llmStep, {
  maxAttempts: 3,
  backoffMs: 1000,
  backoffMultiplier: 2,
  retryOn: [LLMRateLimitError, LLMTimeoutError],
})

// Use exactly like any other step
pipeline.step(resilientLLM, router)
```

`withRetry` returns a new step with the same `id`, `inputSchema`, and `outputSchema` as the wrapped step. The pipeline sees no difference — routing and tracing work exactly the same.

## RetryPolicy Options

```typescript
interface RetryPolicy {
  maxAttempts?: number // total attempts including first. Default: 3
  backoffMs?: number // initial wait before first retry (ms). Default: 1000
  backoffMultiplier?: number // multiply backoff by this on each retry. Default: 2
  maxBackoffMs?: number // cap on backoff (ms). Default: 30000
  retryOn?: ErrorClass[] // only retry these error types. Default: all PravahaErrors
}
```

### Backoff calculation

With `backoffMs: 1000` and `backoffMultiplier: 2`:

- Attempt 1 fails → wait 1s
- Attempt 2 fails → wait 2s
- Attempt 3 fails → throw

With `backoffMs: 500`, `backoffMultiplier: 3`, `maxBackoffMs: 5000`:

- Attempt 1 fails → wait 500ms
- Attempt 2 fails → wait 1500ms
- Attempt 3 fails → wait 4500ms
- Attempt 4 fails → wait 5000ms (capped)
- ...

For constant backoff (same wait each time), set `backoffMultiplier: 1`.

## retryOn — Selective Retry

By default, `withRetry` retries on any `PravahaError`. Narrow this to specific error types to avoid retrying errors you cannot recover from:

```typescript
import { LLMRateLimitError, LLMTimeoutError } from '@pravaha/core'

const resilientStep = withRetry(llmStep, {
  maxAttempts: 4,
  backoffMs: 2000,
  retryOn: [LLMRateLimitError, LLMTimeoutError], // only these two
})
```

With this config:

- `LLMRateLimitError` → retried (transient, likely to resolve)
- `LLMTimeoutError` → retried (transient, likely to resolve)
- `ValidationError` → **not retried** — thrown immediately (the input is bad; retrying won't help)
- `LLMInvalidResponseError` → **not retried** — thrown immediately

## Retry on AgentStep

`AgentStep` is a regular step — you can wrap it exactly the same way:

```typescript
import { AgentStep, withRetry, LLMRateLimitError, LLMTimeoutError } from '@pravaha/core'

const agentStep = new AgentStep({
  id: 'support-agent',
  name: 'Support Agent',
  adapter,
  tools: [...],
  maxIterations: 8,
})

const resilientAgent = withRetry(agentStep, {
  maxAttempts: 2,
  backoffMs: 500,
  retryOn: [LLMRateLimitError, LLMTimeoutError],
})
```

## Attempt Count in Context

After a successful attempt, the retry wrapper records how many attempts it took in the execution context:

```typescript
// Inside a downstream step:
const attempts = context.state[`${stepId}:attempts`] as number
// e.g. context.state['llm:attempts'] === 2 means it succeeded on the second try
```

## Error Handling with Retry

When all attempts are exhausted, the last error is thrown. Handle it at the pipeline level:

```typescript
try {
  const result = await pipeline.run(input)
} catch (err) {
  if (err instanceof LLMRateLimitError) {
    // All 3 attempts failed with rate limit — maybe queue for later
    await queue.push({ input, retryAfter: Date.now() + 60_000 })
  } else if (err instanceof LLMTimeoutError) {
    // LLM is taking too long — respond with a fallback
    return fallbackResponse
  }
  throw err
}
```

## Common Configurations

### Aggressive retry for rate limits

```typescript
withRetry(step, {
  maxAttempts: 5,
  backoffMs: 2000,
  backoffMultiplier: 2,
  maxBackoffMs: 30_000,
  retryOn: [LLMRateLimitError],
})
```

### Conservative retry for flaky networks

```typescript
withRetry(step, {
  maxAttempts: 3,
  backoffMs: 500,
  backoffMultiplier: 1, // constant backoff
  retryOn: [LLMTimeoutError],
})
```

### No retry (but still wrapped for consistent error handling)

```typescript
withRetry(step, { maxAttempts: 1 })
```
