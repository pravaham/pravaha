# Plugins

Plugins are the extension point for cross-cutting concerns — things like cost tracking, telemetry, logging, and alerting that you want to happen on every pipeline run without embedding that logic inside individual steps.

A plugin subscribes to lifecycle events: pipeline start, step completion, pipeline completion, and errors.

## The Plugin Interface

```typescript
interface PravahaPlugin {
  readonly name: string // unique plugin name
  readonly version: string // semver

  onPipelineStart?(context: ExecutionContext): void | Promise<void>
  onStepComplete?(event: TraceEvent): void | Promise<void>
  onPipelineComplete?(trace: Trace): void | Promise<void>
  onError?(error: PravahaError, context: ExecutionContext): void | Promise<void>
}
```

All hooks are optional — implement only the ones you need. Plugins must never throw: any error inside a plugin is caught and logged, but it will not affect pipeline execution.

## Registering Plugins

```typescript
import { PluginRegistry } from '@pravaha/core'
import { CostTrackerPlugin } from '@pravaha/plugin-cost-tracker'
import { OtelPlugin } from '@pravaha/plugin-otel'

const plugins = new PluginRegistry()
plugins.register(new CostTrackerPlugin())
plugins.register(new OtelPlugin({ serviceName: 'support-service' }))

const pipeline = new PipelineBuilder(
  { id: 'my-pipeline', name: 'My Pipeline', version: '1.0.0' },
  plugins,
)
  .step(...)
  .build()
```

## CostTrackerPlugin

The cost tracker plugin tallies LLM token costs for each pipeline run. It reads the `model` and `usage` from LLM step outputs and calculates cost using built-in pricing tables.

```bash
pnpm add @pravaha/plugin-cost-tracker
```

```typescript
import { CostTrackerPlugin } from '@pravaha/plugin-cost-tracker'

const costTracker = new CostTrackerPlugin()
const plugins = new PluginRegistry()
plugins.register(costTracker)

const pipeline = new PipelineBuilder({ ... }, plugins)
  .step(llmStep)
  .build()

const result = await pipeline.run(input)

const cost = costTracker.getCostSummary(result.trace.runId)
if (cost) {
  console.log(`Total:  $${cost.totalCostUsd.toFixed(4)}`)
  console.log(`Tokens: ${cost.totalTokens}`)

  Object.entries(cost.byStep).forEach(([stepId, stepCost]) => {
    console.log(`  ${stepId}: $${stepCost.costUsd.toFixed(4)} (${stepCost.tokens} tokens)`)
  })
}
```

### CostSummary fields

```typescript
interface CostSummary {
  runId: string
  totalCostUsd: number
  totalTokens: number
  promptTokens: number
  completionTokens: number
  byStep: Record<string, { costUsd: number; tokens: number }>
}
```

### Custom pricing

Pass a custom cost table to override the defaults:

```typescript
const costTracker = new CostTrackerPlugin({
  'my-custom-model': {
    model: 'my-custom-model',
    promptCostPer1k: 0.002,
    completionCostPer1k: 0.008,
  },
})
```

## OtelPlugin

The OpenTelemetry plugin exports traces and spans to any OTLP-compatible backend — Jaeger, Tempo, Datadog, Honeycomb, etc.

```bash
pnpm add @pravaha/plugin-otel
```

```typescript
import { OtelPlugin } from '@pravaha/plugin-otel'

const otel = new OtelPlugin({
  serviceName: 'support-service',
  serviceVersion: '1.0.0',
  // Export to an OTLP collector (Jaeger, Tempo, etc.)
  otlpEndpoint: 'http://localhost:4318/v1/traces',
})

plugins.register(otel)
```

Without `otlpEndpoint`, spans are exported to the console — useful for local development.

Each pipeline run creates one root span. Each step creates a child span. Failed steps are marked with an error status and include the exception details.

## Writing a Custom Plugin

```typescript
import type {
  PravahaPlugin,
  TraceEvent,
  Trace,
  ExecutionContext,
  PravahaError,
} from '@pravaha/core'

class SlackAlerterPlugin implements PravahaPlugin {
  readonly name = 'slack-alerter'
  readonly version = '1.0.0'

  constructor(private readonly webhookUrl: string) {}

  async onError(error: PravahaError, context: ExecutionContext): Promise<void> {
    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `Pipeline \`${context.pipelineId}\` failed: ${error.message}`,
      }),
    })
  }

  async onPipelineComplete(trace: Trace): Promise<void> {
    if (trace.status === 'failed') return // already handled by onError
    if (trace.durationMs > 5000) {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `Pipeline \`${trace.pipelineName}\` took ${trace.durationMs}ms (run: ${trace.runId})`,
        }),
      })
    }
  }
}
```

### Logging plugin example

```typescript
class PipelineLoggerPlugin implements PravahaPlugin {
  readonly name = 'pipeline-logger'
  readonly version = '1.0.0'

  onPipelineStart(context: ExecutionContext): void {
    console.log(`[${context.pipelineId}] Run started: ${context.runId}`)
  }

  onStepComplete(event: TraceEvent): void {
    const status = event.status === 'completed' ? '✓' : '✗'
    console.log(`  ${status} ${event.stepId} [${event.durationMs}ms]`)
  }

  onPipelineComplete(trace: Trace): void {
    console.log(`[${trace.pipelineId}] Run ${trace.status} in ${trace.durationMs}ms`)
  }

  onError(error: PravahaError, context: ExecutionContext): void {
    console.error(`[${context.pipelineId}] Error: ${error.code} — ${error.message}`)
  }
}
```

## Plugin Safety

Plugins are wrapped in a try/catch by the `PluginRegistry`. If a plugin throws, the error is logged to `console.error` and execution continues. Your pipeline will not crash because of a broken plugin.

This is by design: telemetry and cost tracking are observability concerns. They must never affect the correctness of your pipeline.
