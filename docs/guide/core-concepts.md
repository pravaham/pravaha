# Core Concepts

Pravaha has five core primitives. Everything else is built on these.

## Pipeline

A Pipeline orchestrates a sequence of Steps.
It runs them in order, routes between them based on output,
and produces a complete Trace.

```typescript
const pipeline = new PipelineBuilder({
  id: 'my-pipeline',
  name: 'My Pipeline',
  version: '1.0.0',
})
  .step(stepA, routerAtoB)
  .step(stepB, routerBtoC)
  .step(stepC)
  .build()

const result = await pipeline.run(input)
result.output // final typed output
result.trace // complete execution record
```

## Step

A Step is a single unit of work — validated input in, validated output out.

Four built-in step types:

- **TransformStep** — pure function, no LLM, no side effects
- **ToolStep** — external API call, database query, file operation
- **LLMStep** — call an LLM (Claude, OpenAI, Ollama)
- **AgentStep** — LLM-driven loop with tool calling

Custom steps extend `BaseStep`:

```typescript
class MyStep extends BaseStep<MyInput, MyOutput> {
  readonly id = 'my-step'
  readonly name = 'My Step'
  readonly type = 'custom'
  readonly inputSchema = MyInputSchema
  readonly outputSchema = MyOutputSchema

  protected async run(input: MyInput, ctx: ExecutionContext): Promise<MyOutput> {
    return { result: input.value.toUpperCase() }
  }
}
```

## Router

A Router decides the next step based on current output.

```typescript
// Conditional routing
const router = new ConditionalRouter('router', 'Route', [
  { condition: (o) => o.category === 'billing', nextStepId: 'billing-handler', reason: 'Billing' },
  { condition: (o) => o.category === 'technical', nextStepId: 'tech-handler', reason: 'Technical' },
])

// Linear routing (always go to next step)
const linear = new LinearRouter('next', 'handle-response')

// End pipeline (null = done)
const end = new LinearRouter('end', null)
```

## Trace

A Trace is the complete record of a pipeline run.
Produced automatically — no configuration needed.

```typescript
result.trace.runId // unique run identifier
result.trace.status // 'completed' | 'failed'
result.trace.durationMs // total wall-clock time
result.trace.events // one TraceEvent per step

result.trace.events[0].stepId // which step
result.trace.events[0].input // what went in
result.trace.events[0].output // what came out
result.trace.events[0].durationMs // how long it took
result.trace.events[0].error // error details if failed
```

## ExecutionContext

Immutable state passed through every step.
Never mutated — always returns a new context.

```typescript
// Access context in a step
protected async run(input: MyInput, ctx: ExecutionContext): Promise<MyOutput> {
  const userId = ctx.state['userId'] as string
  const history = ctx.messages
  // ...
}

// Pass initial state when running
const result = await pipeline.run(input, { userId: 'user-123' })
```
