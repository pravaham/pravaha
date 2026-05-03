# Routers

A **router** decides what happens after a step completes. It looks at the step's output and returns the ID of the next step to run — or `null` to end the pipeline.

Routers are what turn a linear sequence of steps into a real workflow. They let you branch, merge, and make runtime decisions based on data.

Every step in a pipeline is paired with exactly one router. The router is attached when you register the step:

```typescript
pipeline
  .step(classifyStep, categoryRouter) // classifyStep → categoryRouter decides next
  .step(billingStep, new LinearRouter('billing-end', null)) // always ends
```

## LinearRouter

`LinearRouter` always goes to the same next step — or ends the pipeline. Use it when a step has only one possible successor.

```typescript
import { LinearRouter } from '@pravaha/core'

// Always go to 'format-response' after this step
const toFormatter = new LinearRouter('to-formatter', 'format-response')

// This is the last step — null means pipeline ends here
const endPipeline = new LinearRouter('end', null)
```

When you call `.step(myStep)` without a router in `PipelineBuilder`, a `LinearRouter` pointing to `null` is automatically attached, making that step a terminal step.

## ConditionalRouter

`ConditionalRouter` evaluates a list of conditions in order and routes to the first one that matches. It's like a `switch` statement driven by the step's output.

```typescript
import { ConditionalRouter } from '@pravaha/core'

const categoryRouter = new ConditionalRouter<Classification>(
  'category-router', // router id
  'Route by Category', // human-readable name
  [
    {
      condition: (output) => output.category === 'billing',
      nextStepId: 'billing-response',
      reason: 'Billing category detected',
    },
    {
      condition: (output) => output.category === 'technical',
      nextStepId: 'technical-response',
      reason: 'Technical issue',
    },
    {
      condition: (output) => output.category === 'general',
      nextStepId: 'general-response',
      reason: 'General enquiry',
    },
  ],
)
```

The `reason` string appears in the trace, making it easy to understand routing decisions after the fact.

### Fallback Route

Add a fallback as the fourth argument — this runs when no condition matches, instead of throwing a `RouterError`:

```typescript
const router = new ConditionalRouter<Result>(
  'priority-router',
  'Route by Priority',
  [
    {
      condition: (output) => output.priority === 'critical',
      nextStepId: 'escalate-immediately',
      reason: 'Critical priority — immediate escalation',
    },
    {
      condition: (output) => output.confidence < 0.5,
      nextStepId: 'human-review',
      reason: 'Low confidence — needs human review',
    },
  ],
  'standard-response', // fallback: all other cases go here
)
```

### Using Context in Conditions

Router conditions also receive the `ExecutionContext`, giving you access to shared state set by previous steps:

```typescript
const contextRouter = new ConditionalRouter<Response>(
  'context-aware-router',
  'Context Aware Router',
  [
    {
      condition: (output, context) => output.escalate && context.state['retryCount'] === 0,
      nextStepId: 'escalate-step',
      reason: 'First escalation attempt',
    },
    {
      condition: (output, context) =>
        output.escalate && (context.state['retryCount'] as number) > 0,
      nextStepId: 'notify-manager',
      reason: 'Repeated escalation — notifying manager',
    },
  ],
  'resolve-step',
)
```

## Writing a Custom Router

Implement the `Router<TOutput>` interface if neither built-in router fits:

```typescript
import type { Router, RouteDecision, ExecutionContext } from '@pravaha/core'

interface SentimentResult {
  score: number // -1 to 1
  label: string
}

class SentimentRouter implements Router<SentimentResult> {
  readonly id = 'sentiment-router'
  readonly name = 'Sentiment Router'

  route(output: SentimentResult, _context: ExecutionContext): RouteDecision {
    if (output.score < -0.5) {
      return { nextStepId: 'urgent-response', reason: 'Very negative sentiment detected' }
    }
    if (output.score > 0.5) {
      return { nextStepId: 'positive-followup', reason: 'Positive sentiment' }
    }
    return { nextStepId: 'neutral-response', reason: 'Neutral sentiment' }
  }
}
```

Custom routers can also be `async` — return a `Promise<RouteDecision>` if you need to look something up before deciding.

## Routing and Traces

Every routing decision is recorded in the trace:

```typescript
const result = await pipeline.run(input)

result.trace.events.forEach((event) => {
  console.log(event.stepId) // which step ran
  console.log(event.metadata['routedTo']) // where it routed to
  console.log(event.metadata['routeReason']) // why
})
```

This means you can inspect the exact path any pipeline run took, including the reason for every branch, without any extra logging code.

## Common Patterns

### Fan-in (multiple steps, same destination)

Multiple steps can route to the same next step:

```typescript
pipeline
  .step(classifyStep, categoryRouter) // routes to billing or technical
  .step(billingStep, new LinearRouter('b', 'format')) // both end at format
  .step(technicalStep, new LinearRouter('t', 'format'))
  .step(formatStep) // terminal
```

### Early exit

Route to `null` directly from any step to terminate the pipeline immediately:

```typescript
const earlyExitRouter = new ConditionalRouter<Result>(
  'early-exit',
  'Early Exit',
  [
    {
      condition: (output) => output.isDuplicate,
      nextStepId: null, // stop here — output is the deduplication result
      reason: 'Duplicate ticket detected — skipping processing',
    },
  ],
  'process-step', // fallback for non-duplicates
)
```
