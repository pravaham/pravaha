# Pipelines

A **pipeline** is the top-level orchestrator. It holds a collection of steps, connects them via routers, executes them in order, and produces a complete trace of every decision made.

You build a pipeline once and run it many times — once per incoming request, ticket, document, or whatever your use case processes.

## Building a Pipeline

Use `PipelineBuilder` — a fluent API that makes it easy to assemble steps and routers:

```typescript
import { PipelineBuilder, LinearRouter, ConditionalRouter } from '@pravaha/core'

const pipeline = new PipelineBuilder<TicketInput, TicketResponse>({
  id: 'support-triage', // unique ID — used in traces and logs
  name: 'Support Ticket Triage',
  version: '1.0.0',
  description: 'Routes support tickets to the right team',
})
  .step(classifyStep, categoryRouter)
  .step(billingStep, new LinearRouter('billing-end', null))
  .step(technicalStep, new LinearRouter('technical-end', null))
  .step(generalStep) // no router = terminal step
  .build()
```

### Type parameters

`PipelineBuilder<TInput, TOutput>` carries the input and output types. TypeScript will enforce that the first step accepts `TInput` and the last step produces `TOutput`.

### Step registration order

The first step registered becomes the entry point. You can override this with `.setEntryStep('step-id')` if needed.

## Running a Pipeline

```typescript
const result = await pipeline.run(ticket)

console.log(result.output) // the final step's output — typed as TOutput
console.log(result.trace) // full execution trace
console.log(result.context) // final execution context
```

### Passing initial state

You can pass key-value state that will be available to all steps via `context.state`:

```typescript
const result = await pipeline.run(ticket, {
  userId: 'user-123',
  region: 'eu-west',
  featureFlags: { newRouter: true },
})
```

Inside any step:

```typescript
protected async run(input: Ticket, context: ExecutionContext): Promise<Classification> {
  const region = context.state['region'] as string
  // ...
}
```

## Reading the Result

`PipelineResult<TOutput>` has three fields:

```typescript
interface PipelineResult<TOutput> {
  output: TOutput // final output — typed
  trace: Trace // complete execution record
  context: ExecutionContext // final context state
}
```

### Inspecting the trace

```typescript
console.log(result.trace.runId) // unique ID for this run
console.log(result.trace.status) // 'completed' | 'failed'
console.log(result.trace.durationMs) // total wall-clock time

result.trace.events.forEach((event) => {
  console.log(`${event.stepId} [${event.stepType}]`)
  console.log(`  duration: ${event.durationMs}ms`)
  console.log(`  status:   ${event.status}`)
  console.log(`  input:    ${JSON.stringify(event.input)}`)
  console.log(`  output:   ${JSON.stringify(event.output)}`)
  console.log(`  routed →  ${String(event.metadata['routedTo'] ?? 'end')}`)
  console.log(`  reason:   ${String(event.metadata['routeReason'])}`)
})
```

## Dry-Run Mode

Dry-run runs the full pipeline with mock responses substituted for specified steps. Routing logic, schema validation, and tracing all run normally — only the specified steps skip their real implementation.

```typescript
const result = await pipeline.dryRun(ticket, {
  mockResponses: {
    'classify-ticket': {
      ticket,
      category: 'billing',
      confidence: 0.95,
      reasoning: 'Mock response for CI',
    },
    'billing-response': {
      ticketId: ticket.id,
      category: 'billing',
      response: 'We will review your account.',
      suggestedActions: ['Check invoice'],
      escalate: false,
    },
  },
  verbose: true, // logs which steps are mocked vs real
})

console.log(result.output) // the mocked output
console.log(result.trace.events) // trace still shows all steps
```

Steps not listed in `mockResponses` run their real implementation. This lets you mock only the LLM steps in CI while keeping your custom transform steps running for real.

See [Dry-Run Mode](/guide/dry-run) for a complete guide.

## Attaching Plugins

Plugins add cross-cutting behaviour — cost tracking, telemetry, logging — without touching pipeline logic.

```typescript
import { PluginRegistry } from '@pravaha/core'
import { CostTrackerPlugin } from '@pravaha/plugin-cost-tracker'

const costTracker = new CostTrackerPlugin()
const plugins = new PluginRegistry()
plugins.register(costTracker)

const pipeline = new PipelineBuilder(
  { id: 'my-pipeline', name: 'My Pipeline', version: '1.0.0' },
  plugins,
)
  .step(llmStep)
  .build()

const result = await pipeline.run(input)

const cost = costTracker.getCostSummary(result.trace.runId)
console.log(`Total cost: $${cost?.totalCostUsd.toFixed(4)}`)
```

See [Plugins](/guide/plugins) for a full guide.

## Persisting Traces

Pass a `TraceStore` to the builder to automatically save traces after each run:

```typescript
import { FsTraceStore } from '@pravaha/adapter-trace-fs'

const traceStore = new FsTraceStore({ traceDir: '.pravaha/traces' })

const pipeline = new PipelineBuilder({ ... }, plugins, traceStore)
  .step(...)
  .build()
```

After running, each trace is saved to disk. Use the CLI to inspect them:

```bash
npx pravaha trace list
npx pravaha serve   # visual trace viewer at http://localhost:4321
```

## Error Handling

If any step throws, the pipeline:

1. Records the failed step in the trace with `status: 'failed'`
2. Saves the partial trace to the trace store (if configured)
3. Emits `onError` to all plugins
4. Re-throws the error

```typescript
try {
  const result = await pipeline.run(input)
} catch (err) {
  if (err instanceof LLMRateLimitError) {
    // Retry after a delay
  }
  if (err instanceof ValidationError) {
    // Bad data — log and discard
  }
  throw err
}
```

See [Error Handling](/guide/errors) for the full error hierarchy.

## Pipeline Configuration Reference

```typescript
interface PipelineConfig {
  id: string // unique pipeline identifier
  name: string // human-readable name (shown in traces and viewer)
  description?: string // optional description
  version: string // semver — good for tracking pipeline changes in traces
  metadata?: Record<string, unknown> // arbitrary key-value attached to every trace
}
```
