# Tracing

Every time a pipeline runs, Pravaha automatically produces a **trace** — a complete, immutable record of everything that happened: which steps ran, what each step received and produced, how long each step took, and which route was taken after each step.

You get this for free. There is no instrumentation code to write, no decorators to add, no logging calls to sprinkle around. The trace is always there.

## What is a Trace?

A `Trace` is the top-level record for one pipeline run:

```typescript
interface Trace {
  runId: string // unique ID for this run (UUID)
  pipelineId: string // which pipeline ran
  pipelineName: string // human-readable pipeline name
  status: 'completed' | 'failed'
  startedAt: number // Unix timestamp (ms)
  completedAt: number // Unix timestamp (ms)
  durationMs: number // total wall-clock time
  events: TraceEvent[] // one event per step, in order
  metadata: Record<string, unknown>
}
```

A `TraceEvent` is one step's execution record:

```typescript
interface TraceEvent {
  id: string // unique event ID
  runId: string // links back to the parent Trace
  pipelineId: string
  stepId: string // which step ran
  stepType: string // 'transform' | 'tool' | 'llm:claude' | 'agent' etc.
  status: 'completed' | 'failed'
  startedAt: number
  completedAt: number
  durationMs: number
  input: unknown // exactly what the step received
  output: unknown // exactly what the step returned (null on failure)
  error?: {
    // present only when status === 'failed'
    code: string
    message: string
    stack?: string
  }
  metadata: {
    routedTo?: string // next step ID (null = pipeline ended)
    routeReason?: string // why the router chose this route
    [key: string]: unknown
  }
}
```

## Reading a Trace After a Run

The trace is always in the pipeline result:

```typescript
const result = await pipeline.run(ticket)

const { trace } = result

console.log(`Run ID: ${trace.runId}`)
console.log(`Status: ${trace.status}`)
console.log(`Duration: ${trace.durationMs}ms`)
console.log(`Steps: ${trace.events.length}`)

trace.events.forEach((event, i) => {
  console.log(`\nStep ${i + 1}: ${event.stepId} [${event.stepType}]`)
  console.log(`  Status:   ${event.status}`)
  console.log(`  Duration: ${event.durationMs}ms`)
  console.log(`  Input:    ${JSON.stringify(event.input, null, 2)}`)
  console.log(`  Output:   ${JSON.stringify(event.output, null, 2)}`)
  if (event.metadata['routedTo']) {
    console.log(
      `  → ${String(event.metadata['routedTo'])} (${String(event.metadata['routeReason'])})`,
    )
  }
})
```

### Finding a specific step

```typescript
const classifyEvent = trace.events.find((e) => e.stepId === 'classify-ticket')
console.log(classifyEvent?.output) // { category: 'billing', confidence: 0.92 }
```

### Checking for failures

```typescript
const failedSteps = trace.events.filter((e) => e.status === 'failed')
if (failedSteps.length > 0) {
  const first = failedSteps[0]!
  console.error(`Step '${first.stepId}' failed: ${first.error?.message}`)
}
```

## Persisting Traces

By default, traces are held in memory and discarded when the process ends. To save them permanently, pass a `TraceStore` to the pipeline builder.

### File system store

```bash
pnpm add @pravaha/adapter-trace-fs
```

```typescript
import { FsTraceStore } from '@pravaha/adapter-trace-fs'
import { PipelineBuilder, PluginRegistry } from '@pravaha/core'

const traceStore = new FsTraceStore({
  traceDir: '.pravaha/traces',  // directory to save trace files
})

const pipeline = new PipelineBuilder(
  { id: 'my-pipeline', name: 'My Pipeline', version: '1.0.0' },
  new PluginRegistry(),
  traceStore,
)
  .step(...)
  .build()
```

After each run, the trace is saved as a JSON file in `.pravaha/traces/`. The filename is the `runId`.

### Loading traces

```typescript
// Get a specific trace by run ID
const trace = await traceStore.getByRunId('3f8a-...')

// Get the last 20 traces for a pipeline
const recent = await traceStore.getByPipelineId('support-triage', 20)
```

## Viewing Traces

Use the CLI to explore saved traces:

```bash
# List all saved traces
npx pravaha trace list

# Show a specific trace
npx pravaha trace show <runId>

# Start the visual trace viewer
npx pravaha serve
```

The visual viewer shows the full trace as an interactive timeline. See [Trace Viewer](/guide/trace-viewer) for details.

## Custom TraceStore

Implement the `TraceStore` interface to persist traces to any backend — a database, S3, or a logging service:

```typescript
import type { TraceStore, Trace } from '@pravaha/core'

class PostgresTraceStore implements TraceStore {
  async save(trace: Trace): Promise<void> {
    await db.traces.insert({
      run_id: trace.runId,
      pipeline_id: trace.pipelineId,
      status: trace.status,
      started_at: new Date(trace.startedAt),
      duration_ms: trace.durationMs,
      payload: JSON.stringify(trace),
    })
  }

  async getByRunId(runId: string): Promise<Trace | null> {
    const row = await db.traces.findByRunId(runId)
    return row ? (JSON.parse(row.payload) as Trace) : null
  }

  async getByPipelineId(pipelineId: string, limit = 50): Promise<readonly Trace[]> {
    const rows = await db.traces.findByPipeline(pipelineId, limit)
    return rows.map((r) => JSON.parse(r.payload) as Trace)
  }
}
```

## What the Trace Tells You

| Scenario                           | Where to look                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| Which route did the pipeline take? | `event.metadata.routedTo` and `event.metadata.routeReason` for each event                           |
| Why did this run fail?             | `trace.status === 'failed'`, then find the event where `status === 'failed'` and read `event.error` |
| Which step was slow?               | Sort events by `event.durationMs` descending                                                        |
| How many tokens did the LLM use?   | LLM step outputs include `usage.promptTokens` and `usage.completionTokens`                          |
| What exactly did the LLM receive?  | `event.input.messages` on the LLM step event                                                        |
| What did the LLM respond?          | `event.output.content` on the LLM step event                                                        |
