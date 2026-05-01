# Observability

## Automatic Tracing

Every pipeline run produces a complete `Trace` automatically.
No configuration needed.

```typescript
const result = await pipeline.run(input)

result.trace.runId        // unique identifier
result.trace.status       // 'completed' | 'failed'
result.trace.durationMs   // total wall time
result.trace.events       // one event per step
```

## Trace Viewer

```bash
# Start visual trace viewer
npx pravaha serve

# Export standalone HTML report
npx pravaha trace export html --output report.html

# CLI inspection
npx pravaha trace list
npx pravaha trace show <runId>
npx pravaha trace diff <runIdA> <runIdB>
```

## Persist Traces

```typescript
import { FsTraceStore } from '@pravaha/adapter-trace-fs'

const traceStore = new FsTraceStore({
  traceDir: '.pravaha/traces',
  maxTracesPerPipeline: 100,
})

const pipeline = new PipelineBuilder({ ... }, plugins, traceStore)
  .step(...)
  .build()
```

## OpenTelemetry

Export traces to Jaeger, Datadog, Grafana, Honeycomb:

```typescript
import { OtelPlugin } from '@pravaha/plugin-otel'

// Console exporter — zero config, great for development
const plugins = new PluginRegistry()
plugins.register(new OtelPlugin())

// OTLP exporter — production
// Requires: pnpm add @opentelemetry/exporter-trace-otlp-http
plugins.register(new OtelPlugin({
  exporter: 'otlp',
  otlpEndpoint: 'http://my-collector:4318/v1/traces',
  serviceName: 'my-service',
}))
```

Every pipeline run becomes a root span. Every step becomes a child span with:
- Input/output attributes
- Token usage (prompt, completion, total)
- Model name
- Error details with stack trace
