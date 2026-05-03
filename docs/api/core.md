# @pravaha/core

The core package. No LLM providers, no network calls — just the framework primitives.

```bash
pnpm add @pravaha/core
```

---

## Pipeline

### `PipelineBuilder<TInput, TOutput>`

Fluent builder for constructing pipelines.

```typescript
new PipelineBuilder(config, plugins?, traceStore?, memory?)
```

| Parameter    | Type             | Description                   |
| ------------ | ---------------- | ----------------------------- |
| `config`     | `PipelineConfig` | Pipeline identity and version |
| `plugins`    | `PluginRegistry` | Optional plugin registry      |
| `traceStore` | `TraceStore`     | Optional trace persistence    |
| `memory`     | `MemoryStore`    | Optional memory backend       |

**Methods:**

```typescript
.step(step: Step, router?: Router): this
.build(): Pipeline<TInput, TOutput>
```

If `router` is omitted, a `LinearRouter` pointing to `null` (terminal) is attached automatically.

---

### `Pipeline<TInput, TOutput>`

```typescript
pipeline.run(input: TInput, initialState?: Record<string, unknown>): Promise<PipelineResult<TOutput>>
pipeline.dryRun(input: TInput, options: DryRunOptions, initialState?: Record<string, unknown>): Promise<PipelineResult<TOutput>>
pipeline.id: string
pipeline.name: string
```

---

### `PipelineResult<TOutput>`

```typescript
interface PipelineResult<TOutput> {
  output: TOutput
  trace: Trace
  context: ExecutionContext
}
```

---

### `PipelineConfig`

```typescript
interface PipelineConfig {
  id: string
  name: string
  description?: string
  version: string
  metadata?: Record<string, unknown>
}
```

---

## Steps

### `BaseStep<TInput, TOutput>` (abstract)

Extend this to create custom steps.

```typescript
abstract class BaseStep<TInput, TOutput> implements Step<TInput, TOutput> {
  abstract id: PravahaId
  abstract name: string
  abstract type: string
  abstract inputSchema: z.ZodType<TInput>
  abstract outputSchema: z.ZodType<TOutput>
  metadata: Metadata // optional, defaults to {}

  protected abstract run(input: TInput, context: ExecutionContext): Promise<TOutput>

  // Called by the pipeline — validates input/output, wraps errors
  execute(input: TInput, context: ExecutionContext): Promise<StepResult<TOutput>>
}
```

---

### `TransformStep<TInput, TOutput>`

Pure data transformation step.

```typescript
new TransformStep(
  id: string,
  name: string,
  inputSchema: z.ZodType<TInput>,
  outputSchema: z.ZodType<TOutput>,
  transformer: (input: TInput, context: ExecutionContext) => TOutput | Promise<TOutput>,
)
```

---

### `ToolStep<TInput, TOutput>`

Wraps a `ToolDefinition` as a pipeline step. Use `defineToolStep()` instead of constructing directly.

---

### `defineToolStep<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): ToolStep<TInput, TOutput>`

Factory function — creates a `ToolStep` from a `ToolDefinition`.

---

### `ToolDefinition<TInput, TOutput>`

```typescript
interface ToolDefinition<TInput, TOutput> {
  id: PravahaId
  name: string
  description: string
  inputSchema: z.ZodType<TInput>
  outputSchema: z.ZodType<TOutput>
  execute(input: TInput, context: ExecutionContext): Promise<TOutput>
  metadata?: Metadata
}
```

---

### `toAnthropicTool(tool: ToolDefinition<unknown, unknown>)`

Converts a `ToolDefinition` to the Anthropic/OpenAI JSON Schema tool format for use with LLMs.

---

## Routers

### `LinearRouter`

```typescript
new LinearRouter(id: string, nextStepId: PravahaId | null)
```

Always routes to `nextStepId`. Pass `null` to end the pipeline.

---

### `ConditionalRouter<TOutput>`

```typescript
new ConditionalRouter(
  id: string,
  name: string,
  routes: Array<{
    condition: (output: TOutput, context: ExecutionContext) => boolean
    nextStepId: PravahaId | null
    reason: string
  }>,
  fallback?: PravahaId | null,
)
```

Routes to the first matching condition. Throws `RouterError` if no condition matches and no fallback is set.

---

### `Router<TOutput>` interface

```typescript
interface Router<TOutput = unknown> {
  id: PravahaId
  name: string
  route(output: TOutput, context: ExecutionContext): RouteDecision | Promise<RouteDecision>
}
```

---

### `RouteDecision`

```typescript
interface RouteDecision {
  nextStepId: PravahaId | null
  reason: string
}
```

---

## AgentStep

### `AgentStep`

```typescript
new AgentStep(config: AgentStepConfig)

interface AgentStepConfig {
  id: PravahaId
  name: string
  adapter: ToolCallingAdapter
  tools: ToolDefinition<unknown, unknown>[]
  systemPrompt?: string
  maxIterations?: number   // default: 10
  metadata?: Metadata
}
```

Implements the think–act–observe loop. See [Agents](/guide/agents).

---

## Context

### `ExecutionContext`

```typescript
interface ExecutionContext {
  runId: string
  pipelineId: string
  messages: readonly LLMMessage[]
  state: Readonly<Record<string, unknown>>
  metadata: Metadata
  depth: number
}
```

---

### Context helpers

```typescript
createExecutionContext(pipelineId, initialState?, metadata?): ExecutionContext
withMessages(ctx, messages): ExecutionContext
withState(ctx, state): ExecutionContext
withDepth(ctx): ExecutionContext
```

---

## Retry

### `withRetry<TInput, TOutput>(step, policy): Step<TInput, TOutput>`

Wraps any step with retry logic.

### `RetryPolicy`

```typescript
interface RetryPolicy {
  maxAttempts?: number // default: 3
  backoffMs?: number // default: 1000
  backoffMultiplier?: number // default: 2
  maxBackoffMs?: number // default: 30000
  retryOn?: Array<new (...args: never[]) => PravahaError>
}
```

---

## Errors

All exported from `@pravaha/core`:

| Class                     | Code                    | Thrown when                                     |
| ------------------------- | ----------------------- | ----------------------------------------------- |
| `PravahaError`            | —                       | Base class (abstract)                           |
| `StepExecutionError`      | `STEP_EXECUTION_ERROR`  | step `run()` throws a non-Pravaha error         |
| `RouterError`             | `ROUTER_ERROR`          | no condition matches and no fallback configured |
| `ValidationError`         | `VALIDATION_ERROR`      | input/output schema validation fails            |
| `PipelineConfigError`     | `PIPELINE_CONFIG_ERROR` | pipeline definition is invalid                  |
| `MemoryError`             | `MEMORY_ERROR`          | memory store operation fails                    |
| `LLMRateLimitError`       | `LLM_RATE_LIMIT`        | provider returns 429                            |
| `LLMTimeoutError`         | `LLM_TIMEOUT`           | request exceeds timeout                         |
| `LLMInvalidResponseError` | `LLM_INVALID_RESPONSE`  | provider returns unparseable response           |

---

## Plugins

### `PluginRegistry`

```typescript
const plugins = new PluginRegistry()
plugins.register(plugin: PravahaPlugin): void
plugins.registered: readonly PravahaPlugin[]
```

### `PravahaPlugin` interface

```typescript
interface PravahaPlugin {
  name: string
  version: string
  onPipelineStart?(context: ExecutionContext): void | Promise<void>
  onStepComplete?(event: TraceEvent): void | Promise<void>
  onPipelineComplete?(trace: Trace): void | Promise<void>
  onError?(error: PravahaError, context: ExecutionContext): void | Promise<void>
}
```

---

## Tracing

### `Trace`

```typescript
interface Trace {
  runId: string
  pipelineId: string
  pipelineName: string
  status: 'completed' | 'failed'
  startedAt: number
  completedAt: number
  durationMs: number
  events: readonly TraceEvent[]
  metadata: Metadata
}
```

### `TraceEvent`

```typescript
interface TraceEvent {
  id: string
  runId: string
  pipelineId: string
  stepId: string
  stepType: string
  status: 'completed' | 'failed'
  startedAt: number
  completedAt: number
  durationMs: number
  input: unknown
  output: unknown
  error?: { code: string; message: string; stack?: string }
  metadata: Metadata
}
```

### `TraceStore` interface

```typescript
interface TraceStore {
  save(trace: Trace): Promise<void>
  getByRunId(runId: string): Promise<Trace | null>
  getByPipelineId(pipelineId: string, limit?: number): Promise<readonly Trace[]>
}
```

---

## Memory

### `MemoryStore` interface

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

---

## Streaming

### `BaseStreamingStep` (abstract)

Extend to create streaming LLM steps. Provides `stream()` alongside the standard `execute()`.

### `isStreamingStep(step): boolean`

Type guard — returns `true` if the step implements `StreamingCapable`.

### `collectStream(step, input, context, options?): Promise<LLMResponse>`

Convenience function — calls `stream()` and collects all chunks into a complete `LLMResponse`.

---

## Types

```typescript
type PravahaId = string
type Metadata = Record<string, unknown>
type ExecutionStatus = 'completed' | 'failed'
type MessageRole = 'system' | 'user' | 'assistant' | 'tool'

interface LLMMessage {
  role: MessageRole
  content: string
}

interface LLMRequest {
  messages: LLMMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
  metadata?: Metadata
}

interface LLMResponse {
  content: string
  model: string
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  metadata?: Metadata
}
```

---

## Dry-Run

### `DryRunOptions`

```typescript
interface DryRunOptions {
  mockResponses: Readonly<Record<PravahaId, unknown>>
  verbose?: boolean
}
```

Used with `pipeline.dryRun()`. See [Dry-Run Mode](/guide/dry-run).
