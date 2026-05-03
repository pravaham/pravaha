# Error Handling

Pravaha uses a structured error hierarchy so you can catch specific failure modes and handle each one appropriately. Every error is a subclass of `PravahaError` and carries a machine-readable `code`.

## Error Hierarchy

```
PravahaError (abstract)
├── StepExecutionError        code: STEP_EXECUTION_ERROR
├── RouterError               code: ROUTER_ERROR
├── ValidationError           code: VALIDATION_ERROR
├── PipelineConfigError       code: PIPELINE_CONFIG_ERROR
├── MemoryError               code: MEMORY_ERROR
└── AdapterError (abstract)
    ├── LLMTimeoutError       code: LLM_TIMEOUT
    ├── LLMRateLimitError     code: LLM_RATE_LIMIT
    └── LLMInvalidResponseError  code: LLM_INVALID_RESPONSE
```

All errors are exported from `@pravaha/core`.

## Error Reference

### StepExecutionError

Thrown when a step's `run()` method throws a non-Pravaha error. The original error is preserved as `cause`.

```typescript
import { StepExecutionError } from '@pravaha/core'

try {
  await pipeline.run(input)
} catch (err) {
  if (err instanceof StepExecutionError) {
    console.error(`Step '${err.stepId}' failed: ${err.message}`)
    console.error('Original error:', err.cause)
  }
}
```

**When it fires:** Your `run()` method throws a `TypeError`, `RangeError`, or any other non-Pravaha error. Pravaha wraps it so the pipeline always throws structured errors.

### ValidationError

Thrown when a step's input or output does not match the declared Zod schema.

```typescript
import { ValidationError } from '@pravaha/core'

try {
  await pipeline.run(input)
} catch (err) {
  if (err instanceof ValidationError) {
    console.error(`Field: ${err.field}`) // e.g. 'classify-ticket.output'
    console.error(`Issues: ${JSON.stringify(err.issues)}`)
  }
}
```

The `field` is `'{stepId}.input'` when input validation fails, or `'{stepId}.output'` when output validation fails. The `issues` array contains the Zod validation issues.

**When it fires:**

- Step input does not match `inputSchema`
- Step output does not match `outputSchema`
- A dry-run mock value does not match the step's `outputSchema`

### LLMRateLimitError

Thrown by an adapter when the LLM provider returns a 429 rate limit response.

```typescript
import { LLMRateLimitError } from '@pravaha/core'

try {
  await pipeline.run(input)
} catch (err) {
  if (err instanceof LLMRateLimitError) {
    const retryAfter = err.retryAfterMs ?? 60_000
    console.log(`Rate limited by ${err.adapterName}. Retry in ${retryAfter}ms`)
    await sleep(retryAfter)
    // retry...
  }
}
```

**Fields:**

- `adapterName` — which adapter hit the limit (`'claude'`, `'openai'`, etc.)
- `retryAfterMs` — how long to wait before retrying (if the provider sent this)

### LLMTimeoutError

Thrown by an adapter when the LLM request exceeds the configured timeout.

```typescript
import { LLMTimeoutError } from '@pravaha/core'

try {
  await pipeline.run(input)
} catch (err) {
  if (err instanceof LLMTimeoutError) {
    console.log(`${err.adapterName} timed out after ${err.message}`)
    // Return a fallback response
  }
}
```

### LLMInvalidResponseError

Thrown by an adapter when the LLM returns something that cannot be parsed or used — an empty response, an unexpected format, an API error other than rate limiting or timeout.

```typescript
import { LLMInvalidResponseError } from '@pravaha/core'

if (err instanceof LLMInvalidResponseError) {
  console.error(`${err.adapterName}: ${err.message}`)
  // Log the full error and potentially alert
}
```

### RouterError

Thrown by `ConditionalRouter` when no condition matches and no fallback was configured.

```typescript
import { RouterError } from '@pravaha/core'

if (err instanceof RouterError) {
  console.error(`Router '${err.routerId}' had no matching route`)
}
```

To prevent this, always add a fallback to `ConditionalRouter`:

```typescript
new ConditionalRouter('my-router', 'My Router', [...conditions], 'fallback-step-id')
```

### PipelineConfigError

Thrown when the pipeline is misconfigured — a step is registered twice, a referenced step doesn't exist, or the pipeline has no steps.

```typescript
import { PipelineConfigError } from '@pravaha/core'

if (err instanceof PipelineConfigError) {
  // This is a programming error — fix the pipeline definition
  console.error('Pipeline misconfigured:', err.message)
}
```

**When it fires:**

- Adding a step with a duplicate ID
- Calling `setEntryStep` with a step ID that isn't registered
- Running a pipeline that has no steps
- Pipeline depth exceeds 100 (infinite loop guard)

### MemoryError

Thrown by memory store adapters when a storage operation fails.

```typescript
import { MemoryError } from '@pravaha/core'

if (err instanceof MemoryError) {
  console.error('Memory operation failed:', err.message)
}
```

## Catching All Pravaha Errors

Use the base class to catch any structured Pravaha error:

```typescript
import { PravahaError } from '@pravaha/core'

try {
  const result = await pipeline.run(input)
} catch (err) {
  if (err instanceof PravahaError) {
    // Structured error — safe to log with err.code
    logger.error({ code: err.code, message: err.message }, 'Pipeline error')
  } else {
    // Unexpected non-Pravaha error — should not normally happen
    logger.error({ error: err }, 'Unexpected error')
  }
}
```

## Errors in the Trace

When a step fails, the failure is recorded in the trace even though the error is also thrown:

```typescript
const failedEvent = result.trace.events.find((e) => e.status === 'failed')
if (failedEvent?.error) {
  console.log(failedEvent.error.code) // e.g. 'LLM_RATE_LIMIT'
  console.log(failedEvent.error.message)
  console.log(failedEvent.error.stack)
}
```

The partial trace (up to and including the failed step) is saved to the `TraceStore` if one is configured, so you can always inspect what happened before the failure.

## Best Practices

**Be specific in `retryOn`.** Only retry errors that are transient. Don't retry `ValidationError` — bad input won't get better.

**Handle `LLMRateLimitError` at the pipeline level.** Build backoff and retry into your request handler rather than inside individual steps.

**Treat `PipelineConfigError` as a bug.** It should never happen in production — it means your pipeline definition has a mistake. Fix the code.

**Log `err.code` for alerting.** The `code` is stable and machine-readable, making it easy to build dashboards and alerts.

```typescript
// Good: specific, actionable error handling
try {
  return await pipeline.run(input)
} catch (err) {
  if (err instanceof LLMRateLimitError) return { queued: true }
  if (err instanceof LLMTimeoutError) return { error: 'Service temporarily unavailable' }
  if (err instanceof ValidationError) return { error: 'Invalid input', field: err.field }
  throw err // unexpected — let it propagate
}
```
