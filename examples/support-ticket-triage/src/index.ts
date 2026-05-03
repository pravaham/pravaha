/**
 * Support Ticket Triage Pipeline
 *
 * Demonstrates a real-world agentic workflow:
 * 1. Classify incoming support ticket (billing / technical / general)
 * 2. Route to appropriate response generator
 * 3. Generate context-aware response
 * 4. Output structured result with full trace
 *
 * Production usage:
 * - Replace mock LLM steps with ClaudeLLMStep or OpenAILLMStep
 * - Add a ToolStep for knowledge base lookup
 * - Add memory for ticket history context
 */

import { z } from 'zod'
import {
  BaseStep,
  ConditionalRouter,
  LinearRouter,
  PipelineBuilder,
  PluginRegistry,
  defineToolStep,
  AgentStep,
  defineAgentOutputParser,
  withRetry,
  LLMRateLimitError,
  LLMTimeoutError,
} from '@pravaha/core'
import type { ExecutionContext, ToolCallingAdapter } from '@pravaha/core'
import type { ToolDefinition } from '@pravaha/core'
import { CostTrackerPlugin } from '@pravaha/plugin-cost-tracker'
import { FsTraceStore } from '@pravaha/adapter-trace-fs'

// ─── Schemas ────────────────────────────────────────────────────────────────

const TicketSchema = z.object({
  id: z.string(),
  subject: z.string(),
  body: z.string(),
  customerId: z.string(),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
})

const ClassificationSchema = z.object({
  ticket: TicketSchema,
  category: z.enum(['billing', 'technical', 'general']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
})

const ResponseSchema = z.object({
  ticketId: z.string(),
  category: z.enum(['billing', 'technical', 'general']),
  response: z.string(),
  suggestedActions: z.array(z.string()),
  escalate: z.boolean(),
})

type Ticket = z.infer<typeof TicketSchema>
type Classification = z.infer<typeof ClassificationSchema>
type TicketResponse = z.infer<typeof ResponseSchema>

// ─── Steps ──────────────────────────────────────────────────────────────────

class ClassifyTicketStep extends BaseStep<Ticket, Classification> {
  readonly id = 'classify-ticket'
  readonly name = 'Classify Ticket'
  readonly type = 'transform'
  readonly inputSchema = TicketSchema
  readonly outputSchema = ClassificationSchema

  protected async run(input: Ticket, _context: ExecutionContext): Promise<Classification> {
    const text = `${input.subject} ${input.body}`.toLowerCase()

    let category: Classification['category'] = 'general'
    let confidence = 0.6
    let reasoning = 'No specific keywords matched, defaulting to general'

    if (
      text.includes('invoice') ||
      text.includes('charge') ||
      text.includes('refund') ||
      text.includes('payment')
    ) {
      category = 'billing'
      confidence = 0.92
      reasoning = 'Billing-related keywords detected: invoice/charge/refund/payment'
    } else if (
      text.includes('error') ||
      text.includes('bug') ||
      text.includes('crash') ||
      text.includes('not working')
    ) {
      category = 'technical'
      confidence = 0.88
      reasoning = 'Technical issue keywords detected: error/bug/crash'
    }

    return { ticket: input, category, confidence, reasoning }
  }
}

class BillingResponseStep extends BaseStep<Classification, TicketResponse> {
  readonly id = 'billing-response'
  readonly name = 'Generate Billing Response'
  readonly type = 'llm:mock'
  readonly inputSchema = ClassificationSchema
  readonly outputSchema = ResponseSchema

  protected async run(input: Classification): Promise<TicketResponse> {
    return {
      ticketId: input.ticket.id,
      category: 'billing',
      response: `Dear Customer ${input.ticket.customerId}, thank you for reaching out about your billing concern. Our billing team will review your account and respond within 1 business day. Reference: ${input.ticket.id}`,
      suggestedActions: [
        'Review invoice history',
        'Process refund if applicable',
        'Update payment method if needed',
      ],
      escalate: input.ticket.priority === 'critical',
    }
  }
}

class TechnicalResponseStep extends BaseStep<Classification, TicketResponse> {
  readonly id = 'technical-response'
  readonly name = 'Generate Technical Response'
  readonly type = 'llm:mock'
  readonly inputSchema = ClassificationSchema
  readonly outputSchema = ResponseSchema

  protected async run(input: Classification): Promise<TicketResponse> {
    return {
      ticketId: input.ticket.id,
      category: 'technical',
      response: `Dear Customer ${input.ticket.customerId}, we have received your technical support request. Our engineering team is investigating. Reference: ${input.ticket.id}`,
      suggestedActions: [
        'Check system status page',
        'Collect error logs',
        'Escalate to L2 if unresolved in 2h',
      ],
      escalate: input.ticket.priority === 'critical' || input.ticket.priority === 'high',
    }
  }
}

class GeneralResponseStep extends BaseStep<Classification, TicketResponse> {
  readonly id = 'general-response'
  readonly name = 'Generate General Response'
  readonly type = 'llm:mock'
  readonly inputSchema = ClassificationSchema
  readonly outputSchema = ResponseSchema

  protected async run(input: Classification): Promise<TicketResponse> {
    return {
      ticketId: input.ticket.id,
      category: 'general',
      response: `Dear Customer ${input.ticket.customerId}, thank you for contacting support. We will respond within 2 business days. Reference: ${input.ticket.id}`,
      suggestedActions: ['Review FAQ', 'Check knowledge base'],
      escalate: false,
    }
  }
}

// ─── Tool Steps ─────────────────────────────────────────────────────────────

/**
 * Simulates a knowledge base lookup.
 * In production: replace with real ServiceNow/Confluence API call.
 */
// Add explicit input/output types first
type KBLookupInput = {
  ticket: {
    id: string
    subject: string
    body: string
    customerId: string
    priority: 'low' | 'medium' | 'high' | 'critical'
  }
  category: 'billing' | 'technical' | 'general'
  confidence: number
  reasoning: string
}

type KBLookupOutput = KBLookupInput & {
  kbArticles: Array<{ id: string; title: string; summary: string }>
}

const knowledgeBaseLookupDefinition: ToolDefinition<KBLookupInput, KBLookupOutput> = {
  id: 'kb-lookup',
  name: 'Knowledge Base Lookup',
  description: 'Searches internal knowledge base for relevant solutions',
  inputSchema: z.object({
    ticket: z.object({
      id: z.string(),
      subject: z.string(),
      body: z.string(),
      customerId: z.string(),
      priority: z.enum(['low', 'medium', 'high', 'critical']),
    }),
    category: z.enum(['billing', 'technical', 'general']),
    confidence: z.number(),
    reasoning: z.string(),
  }),
  outputSchema: z.object({
    ticket: z.object({
      id: z.string(),
      subject: z.string(),
      body: z.string(),
      customerId: z.string(),
      priority: z.enum(['low', 'medium', 'high', 'critical']),
    }),
    category: z.enum(['billing', 'technical', 'general']),
    confidence: z.number(),
    reasoning: z.string(),
    kbArticles: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        summary: z.string(),
      }),
    ),
  }),
  execute: async (input: KBLookupInput): Promise<KBLookupOutput> => ({
    ...input,
    kbArticles: [
      {
        id: 'KB-001',
        title: 'Login Issues Troubleshooting',
        summary: 'Steps to resolve common login failures',
      },
      { id: 'KB-002', title: 'Password Reset Procedure', summary: 'How to reset user passwords' },
    ],
  }),
}

// The pipeline step wrapper — used in pipeline.step()
const knowledgeBaseLookup = defineToolStep(knowledgeBaseLookupDefinition)

// ─── Pipeline Assembly ───────────────────────────────────────────────────────

const costTracker = new CostTrackerPlugin()
const plugins = new PluginRegistry()
plugins.register(costTracker)

const traceStore = new FsTraceStore({ traceDir: '.pravaha/traces' })

const classifyStep = new ClassifyTicketStep()
const billingStep = new BillingResponseStep()
const technicalStep = new TechnicalResponseStep()
const generalStep = new GeneralResponseStep()

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
      nextStepId: 'kb-lookup',
      reason: 'Technical category — enriching with KB articles',
    },
    {
      condition: (output) => output.category === 'general',
      nextStepId: 'general-response',
      reason: 'General category — default handler',
    },
  ],
)

export const supportTicketPipeline = new PipelineBuilder<Ticket, TicketResponse>(
  {
    id: 'support-ticket-triage',
    name: 'Support Ticket Triage',
    description: 'Classifies and routes support tickets to appropriate response handlers',
    version: '1.0.0',
  },
  plugins,
  traceStore,
)
  .step(classifyStep, classifyRouter)
  .step(knowledgeBaseLookup, new LinearRouter('kb-to-technical', 'technical-response'))
  .step(billingStep, new LinearRouter('billing-end', null))
  .step(technicalStep, new LinearRouter('technical-end', null))
  .step(generalStep, new LinearRouter('general-end', null))
  .build()

// ─── Agent Pipeline ──────────────────────────────────────────────────────────

/**
 * Agent-based support triage pipeline.
 * The LLM decides which tools to call rather than following hardcoded routing.
 *
 * In production: replace mockAgentAdapter with ClaudeToolCallingAdapter
 */

// Mock adapter for demo purposes — replace with ClaudeToolCallingAdapter in production
const mockAgentAdapter: ToolCallingAdapter = {
  adapterName: 'mock-agent',
  chat: async () => ({
    type: 'text' as const,
    content:
      '{"category": "billing", "confidence": 0.95, "response": "We will review your invoice within 1 business day.", "escalate": false}',
    usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
    model: 'mock',
  }),
  buildToolResultMessage: () => ({ role: 'user' as const, content: '[]' }),
}

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

const agentStep = new AgentStep({
  id: 'support-agent',
  name: 'Support Agent',
  adapter: mockAgentAdapter,
  tools: [knowledgeBaseLookupDefinition],
  systemPrompt:
    'You are a support triage agent. Classify the ticket, use tools if needed, and provide a structured JSON response.',
  maxIterations: 5,
})

const resilientAgentStep = withRetry(agentStep, {
  maxAttempts: 2,
  backoffMs: 500,
  retryOn: [LLMRateLimitError, LLMTimeoutError],
})

export const agentSupportPipeline = new PipelineBuilder<
  string,
  { category: string; confidence: number; response: string; escalate: boolean }
>(
  {
    id: 'agent-support-triage',
    name: 'Agent Support Triage',
    version: '1.0.0',
  },
  plugins,
  traceStore,
)
  .step(resilientAgentStep, new LinearRouter('agent-to-parser', 'parse-agent-response'))
  .step(agentOutputParser)
  .build()

// ─── Run ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const testTickets: Ticket[] = [
    {
      id: 'TKT-001',
      subject: 'Incorrect charge on my invoice',
      body: 'I was charged twice for my subscription this month. Please refund the duplicate charge.',
      customerId: 'CUST-123',
      priority: 'high',
    },
    {
      id: 'TKT-002',
      subject: 'Application crashes on login',
      body: 'Getting an error when I try to login. The app crashes immediately after entering password.',
      customerId: 'CUST-456',
      priority: 'critical',
    },
    {
      id: 'TKT-003',
      subject: 'How do I export my data?',
      body: 'I would like to export all my data as CSV. Is this feature available?',
      customerId: 'CUST-789',
      priority: 'low',
    },
  ]

  for (const ticket of testTickets) {
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`Processing: ${ticket.id} — "${ticket.subject}"`)

    const result = await supportTicketPipeline.run(ticket)

    console.log(`\n  Category: ${result.output.category}`)
    console.log(`  Escalate: ${result.output.escalate}`)
    console.log(`  Response: ${result.output.response}`)
    console.log(`\n  Trace: ${result.trace.events.length} steps, ${result.trace.durationMs}ms`)
    result.trace.events.forEach((e) => {
      console.log(
        `    ${e.stepId} [${e.stepType}] [${e.durationMs}ms] → ${String(e.metadata['routeReason'] ?? 'end')}`,
      )
    })
  }

  console.log('\n--- DRY RUN DEMO ---')
  const firstTicket = testTickets[0]!
  const dryResult = await supportTicketPipeline.dryRun(firstTicket, {
    mockResponses: {
      'classify-ticket': {
        ticket: firstTicket,
        category: 'technical',
        confidence: 0.99,
        reasoning: 'Mocked for dry-run demo',
      },
      'kb-lookup': {
        ticket: firstTicket,
        category: 'technical',
        confidence: 0.99,
        reasoning: 'Mocked for dry-run demo',
        kbArticles: [{ id: 'KB-999', title: 'Mock Article', summary: 'Mock summary' }],
      },
      'technical-response': {
        ticketId: firstTicket.id,
        category: 'technical',
        response: 'MOCKED: This is a dry-run technical response',
        suggestedActions: ['Check logs'],
        escalate: false,
      },
    },
    verbose: true,
  })
  console.log(`Dry-run output: ${dryResult.output.response}`)
  console.log(`Dry-run trace events: ${dryResult.trace.events.length}`)
  console.log(`Run this to inspect: npx pravaha trace show ${dryResult.trace.runId}`)

  console.log('\n--- AGENT PIPELINE DEMO ---')
  const agentResult = await agentSupportPipeline.run(
    'I was charged twice for my subscription this month. Please refund the duplicate charge.',
  )
  console.log(`Agent category: ${agentResult.output.category}`)
  console.log(`Agent response: ${agentResult.output.response}`)
  console.log(`Escalate: ${agentResult.output.escalate}`)
  console.log(`Confidence: ${agentResult.output.confidence}`)
  console.log(`Trace events: ${agentResult.trace.events.length}`)
}

main().catch(console.error)
