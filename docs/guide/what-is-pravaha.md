# What is Pravaha?

**Pravaha** is a TypeScript framework for building agentic AI pipelines — workflows where an LLM reads data, calls tools, makes decisions, and produces a result.

The word _pravaha_ (प्रवाह) means "flow" in Sanskrit. That is exactly what the framework does: it gives structure to the flow of data through AI-powered steps.

## The Problem

Building production AI workflows is harder than it looks. A basic `fetch + prompt` prototype takes an afternoon. But making it production-ready takes weeks:

- **No observability.** When something goes wrong, you have no idea which step failed or what it received as input.
- **Untestable.** You cannot run CI without real API keys and real costs.
- **Fragile error handling.** Rate limits, timeouts, and invalid responses each need individual handling.
- **Provider lock-in.** Switching from OpenAI to Claude means rewriting half your application.
- **No type safety.** Data flowing between steps is unvalidated — one bad LLM response corrupts every downstream step.

Pravaha solves all of these at the framework level, so you write logic instead of plumbing.

## What Pravaha Gives You

### Full observability out of the box

Every pipeline run automatically produces a complete trace — a timestamped log of every step, its input, its output, which route was taken, and how long it took. You get this for free. No instrumentation code needed.

```typescript
const result = await pipeline.run(ticket)

// Full trace is always here
console.log(result.trace.durationMs) // total time
console.log(result.trace.events) // every step
console.log(result.trace.events[0].input) // what step 0 received
console.log(result.trace.events[0].output) // what step 0 produced
```

### Test without LLM calls

Dry-run mode lets you run an entire pipeline — including all routing logic — using mock responses instead of real API calls. Your CI runs in milliseconds with no API keys.

```typescript
const result = await pipeline.dryRun(input, {
  mockResponses: {
    'classify-ticket': { category: 'billing', confidence: 0.9, reasoning: 'mock' },
    'billing-response': { response: 'We will review your account.', escalate: false },
  },
})
// Full trace, real routing, zero API calls
```

### Swap LLM providers with one import change

All adapters implement the same interface. Your pipeline code never changes when you switch providers.

```typescript
// Development
import { ClaudeLLMStep } from '@pravaha/adapter-claude'

// Production on GCP — same interface, zero pipeline changes
import { ClaudeVertexLLMStep } from '@pravaha/adapter-claude-vertex'

// Testing locally for free
import { OllamaLLMStep } from '@pravaha/adapter-ollama'
```

### Schema validation on every boundary

Every step declares its input and output schemas using [Zod](https://zod.dev). Pravaha validates at every boundary automatically. A bad LLM response is caught immediately — before it corrupts downstream steps — with a clear `ValidationError` telling you exactly which field failed and why.

### True agentic loops

`AgentStep` implements a full think–act–observe loop. The LLM decides which tools to call, calls them, observes the results, and keeps iterating until it has a final answer. You define the tools and guardrails; the LLM drives the logic.

## Who Is It For?

Pravaha is for **TypeScript developers** building AI features that need to be production-quality:

- **Backend engineers** adding LLM-powered features to existing Node.js services
- **AI engineers** building multi-step agentic workflows
- **Teams** who need observability, testability, and type safety — not just a working prototype

If you need a quick one-off prompt, a raw `fetch` to the Anthropic API is fine. Pravaha is for when you need your pipeline to be reliable, debuggable, and maintainable.

## How It Compares

|                                  | Pravaha | Raw SDK calls | LangChain     |
| -------------------------------- | ------- | ------------- | ------------- |
| Type safe end to end             | ✅      | ❌            | Partial       |
| Automatic traces                 | ✅      | ❌            | Plugin needed |
| Dry-run / mock testing           | ✅      | ❌            | ❌            |
| Provider agnostic                | ✅      | ❌            | ✅            |
| No abstractions beyond necessary | ✅      | ✅            | ❌            |

## Core Design Principles

**No magic.** Pravaha does not use decorators, reflection, or hidden global state. Every piece of behaviour is explicit in your code.

**No bloat.** The core package has two dependencies: `zod` and nothing else. Adapters pull in only what they need.

**Immutability.** Execution context is never mutated. Each step receives context and returns a new context. This makes pipelines easy to reason about and test.

**Ports and adapters.** Storage (traces, memory) and LLM providers are interfaces. You can swap any of them without touching pipeline logic.

## Next Steps

- [Getting Started](/guide/getting-started) — build your first pipeline in 5 minutes
- [Core Concepts](/guide/core-concepts) — understand Pipeline, Step, Router, and Trace
- [Steps](/guide/steps) — the different step types and when to use each
