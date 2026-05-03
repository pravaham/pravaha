# Support Ticket Triage

This example walks through a complete support ticket triage pipeline — the flagship Pravaha example that demonstrates most of the framework's features in a realistic scenario.

**What it does:** Takes an incoming support ticket and routes it to the appropriate response handler based on its content category (billing, technical, or general). A second pipeline uses an `AgentStep` for fully LLM-driven triage.

## Running the Example

```bash
git clone https://github.com/pravaham/pravaha.git
cd pravaha/examples/support-ticket-triage
pnpm install
pnpm dev
```

No API key is needed — the example uses mock LLM steps that simulate real responses.

## What's in the Example

```
examples/support-ticket-triage/
├── src/index.ts       — full pipeline implementation
└── package.json
```

## Data Schemas

Everything is typed end-to-end using Zod:

```typescript
// Input: an incoming support ticket
const TicketSchema = z.object({
  id: z.string(),
  subject: z.string(),
  body: z.string(),
  customerId: z.string(),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
})

// After classification
const ClassificationSchema = z.object({
  ticket: TicketSchema,
  category: z.enum(['billing', 'technical', 'general']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
})

// Final output
const ResponseSchema = z.object({
  ticketId: z.string(),
  category: z.enum(['billing', 'technical', 'general']),
  response: z.string(),
  suggestedActions: z.array(z.string()),
  escalate: z.boolean(),
})
```

## Pipeline 1: Rule-Based Triage

This pipeline uses keyword matching to classify tickets, then routes them to the appropriate response generator.

### Step 1: ClassifyTicketStep

Examines the ticket subject and body for keywords:

```typescript
class ClassifyTicketStep extends BaseStep<Ticket, Classification> {
  readonly id = 'classify-ticket'
  readonly name = 'Classify Ticket'
  // ...

  protected async run(input: Ticket): Promise<Classification> {
    const text = `${input.subject} ${input.body}`.toLowerCase()

    if (text.includes('invoice') || text.includes('refund')) {
      return { ticket: input, category: 'billing', confidence: 0.92, reasoning: '...' }
    }
    if (text.includes('error') || text.includes('crash')) {
      return { ticket: input, category: 'technical', confidence: 0.88, reasoning: '...' }
    }
    return { ticket: input, category: 'general', confidence: 0.6, reasoning: '...' }
  }
}
```

### Routing: ConditionalRouter

Based on the classification, route to one of three response generators:

```typescript
const classifyRouter = new ConditionalRouter<Classification>(
  'category-router',
  'Route by Category',
  [
    {
      condition: (output) => output.category === 'billing',
      nextStepId: 'billing-response',
      reason: 'Billing category detected',
    },
    {
      condition: (output) => output.category === 'technical',
      nextStepId: 'kb-lookup', // technical tickets first fetch KB articles
      reason: 'Technical — enriching with KB articles',
    },
    {
      condition: (output) => output.category === 'general',
      nextStepId: 'general-response',
      reason: 'General enquiry',
    },
  ],
)
```

### Step 2 (technical path): KnowledgeBaseLookup ToolStep

Technical tickets are enriched with knowledge base articles before generating a response:

```typescript
const knowledgeBaseLookup = defineToolStep({
  id: 'kb-lookup',
  name: 'Knowledge Base Lookup',
  description: 'Searches internal knowledge base for relevant solutions',
  inputSchema: ClassificationSchema,
  outputSchema: ClassificationSchema.extend({
    kbArticles: z.array(z.object({ id: z.string(), title: z.string(), summary: z.string() })),
  }),
  execute: async (input) => ({
    ...input,
    kbArticles: [{ id: 'KB-001', title: 'Login Issues', summary: 'Common login fixes' }],
  }),
})
```

### Response generators

Three simple steps generate category-appropriate responses — in production, replace these with real LLM steps:

```typescript
class BillingResponseStep extends BaseStep<Classification, TicketResponse> {
  readonly id = 'billing-response'
  // ...
  protected async run(input: Classification): Promise<TicketResponse> {
    return {
      ticketId: input.ticket.id,
      category: 'billing',
      response: `Our billing team will review your account within 1 business day.`,
      suggestedActions: ['Review invoice history', 'Process refund if applicable'],
      escalate: input.ticket.priority === 'critical',
    }
  }
}
```

### Pipeline assembly

```typescript
const pipeline = new PipelineBuilder<Ticket, TicketResponse>(
  { id: 'support-ticket-triage', name: 'Support Ticket Triage', version: '1.0.0' },
  plugins,
  traceStore,
)
  .step(classifyStep, classifyRouter)
  .step(knowledgeBaseLookup, new LinearRouter('kb-to-technical', 'technical-response'))
  .step(billingStep, new LinearRouter('billing-end', null))
  .step(technicalStep, new LinearRouter('technical-end', null))
  .step(generalStep, new LinearRouter('general-end', null))
  .build()
```

## Pipeline 2: Agent-Based Triage

The second pipeline uses `AgentStep` — the LLM decides how to classify and respond, using tools as needed:

```typescript
const agentStep = new AgentStep({
  id: 'support-agent',
  name: 'Support Agent',
  adapter: mockAgentAdapter,  // replace with ClaudeToolCallingAdapter in production
  tools: [knowledgeBaseLookupDefinition],
  systemPrompt:
    'You are a support triage agent. Classify the ticket, use tools if needed, ' +
    'and provide a structured JSON response with: category, confidence, response, escalate.',
  maxIterations: 5,
})

// Wrap with retry for resilience
const resilientAgent = withRetry(agentStep, {
  maxAttempts: 2,
  backoffMs: 500,
  retryOn: [LLMRateLimitError, LLMTimeoutError],
})

// Parse the agent's JSON response into a typed output
const agentOutputParser = defineAgentOutputParser({
  id: 'parse-agent-response',
  name: 'Parse Agent Response',
  strategy: { type: 'json' },
  outputSchema: z.object({
    category: z.enum(['billing', 'technical', 'general']),
    confidence: z.number(),
    response: z.string(),
    escalate: z.boolean(),
  }),
})

const agentPipeline = new PipelineBuilder(...)
  .step(resilientAgent, new LinearRouter('agent-to-parser', 'parse-agent-response'))
  .step(agentOutputParser)
  .build()
```

## Running the Pipelines

```typescript
// Process a billing ticket
const billingTicket = {
  id: 'TKT-001',
  subject: 'Incorrect charge on my invoice',
  body: 'I was charged twice for my subscription this month.',
  customerId: 'CUST-123',
  priority: 'high',
}

const result = await supportTicketPipeline.run(billingTicket)

console.log(result.output.category) // 'billing'
console.log(result.output.escalate) // false
console.log(result.output.response) // 'Our billing team will review...'

// Inspect the routing decisions
result.trace.events.forEach((e) => {
  console.log(`${e.stepId} → ${String(e.metadata['routedTo'] ?? 'end')}`)
})
// classify-ticket → billing-response
// billing-response → end
```

## Dry-Run Demo

The example also demonstrates dry-run mode:

```typescript
const dryResult = await supportTicketPipeline.dryRun(ticket, {
  mockResponses: {
    'classify-ticket': { ticket, category: 'technical', confidence: 0.99, reasoning: 'mock' },
    'kb-lookup': {
      ...mockClassification,
      kbArticles: [{ id: 'KB-999', title: 'Mock', summary: 'Mock' }],
    },
    'technical-response': {
      ticketId: ticket.id,
      category: 'technical',
      response: 'MOCKED response',
      suggestedActions: [],
      escalate: false,
    },
  },
  verbose: true,
})

console.log(`Dry-run result: ${dryResult.output.response}`)
console.log(`Trace steps: ${dryResult.trace.events.length}`)
```

## Adapting for Production

Replace the mock steps with real implementations:

```typescript
// 1. Replace ClassifyTicketStep with ClaudeLLMStep + JSON parser
import { ClaudeLLMStep } from '@pravaha/adapter-claude'
import { defineAgentOutputParser } from '@pravaha/core'

// 2. Replace mock KB lookup with real API call
const kbLookup = defineToolStep({
  execute: async ({ ticket }) => {
    return serviceNow.searchArticles(ticket.subject)
  },
})

// 3. Replace mock agent adapter with ClaudeToolCallingAdapter
import { ClaudeToolCallingAdapter } from '@pravaha/adapter-claude'
const adapter = new ClaudeToolCallingAdapter({ apiKey: process.env.ANTHROPIC_API_KEY! })
```

Everything else — routing, tracing, dry-run, plugins — stays exactly the same.
