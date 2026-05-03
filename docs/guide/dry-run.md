# Dry-Run Mode

Dry-run mode lets you run an entire pipeline using mock responses for specified steps. All routing logic executes, all schemas are validated, a full trace is produced — but the mocked steps skip their real implementation and return the value you provide instead.

This means you can:

- Run your full CI test suite without API keys or network access
- Test routing logic and schema compatibility without paying for LLM calls
- Reproduce a production run locally with controlled inputs
- Develop new pipeline steps without triggering real side effects

## Basic Usage

Call `pipeline.dryRun()` instead of `pipeline.run()`:

```typescript
const result = await pipeline.dryRun(
  input, // same input as a real run
  {
    mockResponses: {
      'step-id': mockOutputValue,
    },
    verbose: true, // log which steps are mocked vs real
  },
)

console.log(result.output) // the final output (may be mocked)
console.log(result.trace.events) // full trace — all steps appear
```

## mockResponses

`mockResponses` is an object where each key is a step ID and each value is the mock output that step will return.

```typescript
const result = await pipeline.dryRun(ticket, {
  mockResponses: {
    // Mock the classification step
    'classify-ticket': {
      ticket,
      category: 'technical',
      confidence: 0.95,
      reasoning: 'Mock: simulating a technical ticket',
    },

    // Mock the knowledge base lookup
    'kb-lookup': {
      ticket,
      category: 'technical',
      confidence: 0.95,
      reasoning: 'Mock',
      kbArticles: [{ id: 'KB-001', title: 'Login Troubleshooting', summary: 'Common login fixes' }],
    },

    // Mock the response generator
    'technical-response': {
      ticketId: ticket.id,
      category: 'technical',
      response: 'Our team will investigate the login issue.',
      suggestedActions: ['Check logs', 'Escalate to L2'],
      escalate: false,
    },
  },
  verbose: true,
})
```

With `verbose: true`, dry-run logs each step:

```
[DryRun] Step 'classify-ticket': MOCKED
[DryRun] Step 'kb-lookup': MOCKED
[DryRun] Step 'technical-response': MOCKED
```

## Mock Validation

The mock value is validated against the step's `outputSchema` before it is returned. If your mock value does not match the schema, dry-run throws a `ValidationError` immediately — catching schema mismatches before they hide in a test that always passes.

```typescript
// This will throw ValidationError because 'confidence' is missing
mockResponses: {
  'classify-ticket': { category: 'technical' },  // missing required fields
}
```

```
ValidationError: Validation failed for 'classify-ticket.mockOutput':
  - confidence: Required
  - reasoning: Required
```

## Partial Mocking

You do not have to mock every step. Steps not listed in `mockResponses` run their real implementation. This is useful when you want to test a new LLM prompt but keep your real database lookups running:

```typescript
// Only mock the LLM call — let the KB lookup run for real
const result = await pipeline.dryRun(input, {
  mockResponses: {
    'classify-ticket': { category: 'billing', confidence: 0.9, reasoning: 'mock' },
  },
})
```

## Testing with Dry-Run

Dry-run is perfect for unit and integration tests:

```typescript
import { describe, it, expect } from 'vitest'
import { supportTicketPipeline } from './pipeline.js'

const testTicket = {
  id: 'TKT-001',
  subject: 'Incorrect charge on my invoice',
  body: 'I was charged twice for my subscription.',
  customerId: 'CUST-123',
  priority: 'high' as const,
}

describe('Support Ticket Pipeline', () => {
  it('routes billing tickets to the billing step', async () => {
    const result = await supportTicketPipeline.dryRun(testTicket, {
      mockResponses: {
        'classify-ticket': {
          ticket: testTicket,
          category: 'billing',
          confidence: 0.95,
          reasoning: 'billing keywords',
        },
        'billing-response': {
          ticketId: testTicket.id,
          category: 'billing',
          response: 'We will review your invoice.',
          suggestedActions: ['Check invoice history'],
          escalate: false,
        },
      },
    })

    expect(result.output.category).toBe('billing')
    expect(result.output.escalate).toBe(false)

    // Verify the route was taken
    const classifyEvent = result.trace.events.find((e) => e.stepId === 'classify-ticket')
    expect(classifyEvent?.metadata['routedTo']).toBe('billing-response')
  })

  it('escalates critical tickets', async () => {
    const criticalTicket = { ...testTicket, priority: 'critical' as const }

    const result = await supportTicketPipeline.dryRun(criticalTicket, {
      mockResponses: {
        'classify-ticket': {
          ticket: criticalTicket,
          category: 'billing',
          confidence: 0.95,
          reasoning: 'billing',
        },
        'billing-response': {
          ticketId: criticalTicket.id,
          category: 'billing',
          response: 'Escalating immediately.',
          suggestedActions: ['Escalate to billing manager'],
          escalate: true,
        },
      },
    })

    expect(result.output.escalate).toBe(true)
  })
})
```

## Dry-Run in CI

A typical CI setup runs only dry-run tests, with no API keys required:

```yaml
# .github/workflows/ci.yml
- name: Test
  run: pnpm test
  # No ANTHROPIC_API_KEY or OPENAI_API_KEY needed
```

All routing logic, schema validation, and trace generation is exercised. The only thing skipped is the actual LLM call.

## How It Works

Dry-run builds a new pipeline internally where each mocked step is replaced with a `MockStep`. The `MockStep` has the same `id`, `inputSchema`, and `outputSchema` as the original step — but its `run()` method returns the mock value after validating it.

The original pipeline is never modified. The dry-run pipeline is a separate, temporary instance created for that invocation.
