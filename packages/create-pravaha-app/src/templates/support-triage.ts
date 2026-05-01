export const supportTriageTemplateFiles: Record<string, string> = {
  'src/index.ts': `import 'dotenv/config'
import { z } from 'zod'
import {
  PipelineBuilder,
  BaseStep,
  ConditionalRouter,
  LinearRouter,
  PluginRegistry,
} from '@pravaha/core'
import type { ExecutionContext } from '@pravaha/core'
import { FsTraceStore } from '@pravaha/adapter-trace-fs'
import { CostTrackerPlugin } from '@pravaha/plugin-cost-tracker'

// ─── Schemas ─────────────────────────────────────────────────────────────────

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
  confidence: z.number(),
})

const ResponseSchema = z.object({
  ticketId: z.string(),
  category: z.enum(['billing', 'technical', 'general']),
  response: z.string(),
  escalate: z.boolean(),
})

type Ticket = z.infer<typeof TicketSchema>
type Classification = z.infer<typeof ClassificationSchema>
type TicketResponse = z.infer<typeof ResponseSchema>

// ─── Steps ───────────────────────────────────────────────────────────────────
// Replace these mock steps with real LLM steps using your API key

class ClassifyStep extends BaseStep<Ticket, Classification> {
  readonly id = 'classify'
  readonly name = 'Classify Ticket'
  readonly type = 'transform'
  readonly inputSchema = TicketSchema
  readonly outputSchema = ClassificationSchema

  protected async run(input: Ticket, _context: ExecutionContext): Promise<Classification> {
    const text = \`\${input.subject} \${input.body}\`.toLowerCase()
    const category =
      text.includes('invoice') || text.includes('charge') ? 'billing' :
      text.includes('error') || text.includes('crash') ? 'technical' :
      'general'
    return { ticket: input, category, confidence: 0.9 }
  }
}

class BillingStep extends BaseStep<Classification, TicketResponse> {
  readonly id = 'billing'
  readonly name = 'Billing Response'
  readonly type = 'transform'
  readonly inputSchema = ClassificationSchema
  readonly outputSchema = ResponseSchema

  protected async run(input: Classification, _context: ExecutionContext): Promise<TicketResponse> {
    return {
      ticketId: input.ticket.id,
      category: 'billing',
      response: \`Billing team will review your account within 1 business day. Ref: \${input.ticket.id}\`,
      escalate: input.ticket.priority === 'critical',
    }
  }
}

class TechnicalStep extends BaseStep<Classification, TicketResponse> {
  readonly id = 'technical'
  readonly name = 'Technical Response'
  readonly type = 'transform'
  readonly inputSchema = ClassificationSchema
  readonly outputSchema = ResponseSchema

  protected async run(input: Classification, _context: ExecutionContext): Promise<TicketResponse> {
    return {
      ticketId: input.ticket.id,
      category: 'technical',
      response: \`Engineering team is investigating. Ref: \${input.ticket.id}\`,
      escalate: input.ticket.priority === 'critical' || input.ticket.priority === 'high',
    }
  }
}

class GeneralStep extends BaseStep<Classification, TicketResponse> {
  readonly id = 'general'
  readonly name = 'General Response'
  readonly type = 'transform'
  readonly inputSchema = ClassificationSchema
  readonly outputSchema = ResponseSchema

  protected async run(input: Classification, _context: ExecutionContext): Promise<TicketResponse> {
    return {
      ticketId: input.ticket.id,
      category: 'general',
      response: \`We will respond within 2 business days. Ref: \${input.ticket.id}\`,
      escalate: false,
    }
  }
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

const plugins = new PluginRegistry()
plugins.register(new CostTrackerPlugin())

const traceStore = new FsTraceStore({ traceDir: '.pravaha/traces' })

const pipeline = new PipelineBuilder<Ticket, TicketResponse>(
  { id: 'support-triage', name: 'Support Triage', version: '1.0.0' },
  plugins,
  traceStore,
)
  .step(new ClassifyStep(), new ConditionalRouter('router', 'Route by Category', [
    { condition: (o) => o.category === 'billing', nextStepId: 'billing', reason: 'Billing ticket' },
    { condition: (o) => o.category === 'technical', nextStepId: 'technical', reason: 'Technical ticket' },
    { condition: (o) => o.category === 'general', nextStepId: 'general', reason: 'General ticket' },
  ]))
  .step(new BillingStep(), new LinearRouter('billing-end', null))
  .step(new TechnicalStep(), new LinearRouter('technical-end', null))
  .step(new GeneralStep(), new LinearRouter('general-end', null))
  .build()

// ─── Run ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const tickets: Ticket[] = [
    { id: 'TKT-001', subject: 'Wrong charge on invoice', body: 'I was charged twice', customerId: 'C-1', priority: 'high' },
    { id: 'TKT-002', subject: 'App crashes on login', body: 'Getting error on startup', customerId: 'C-2', priority: 'critical' },
    { id: 'TKT-003', subject: 'How to export data?', body: 'I need to download my data as CSV', customerId: 'C-3', priority: 'low' },
  ]

  for (const ticket of tickets) {
    const result = await pipeline.run(ticket)
    console.log(\`[\${result.output.category.toUpperCase()}] \${ticket.id}: \${result.output.response}\`)
    console.log(\`  Escalate: \${result.output.escalate} | \${result.trace.durationMs}ms\`)
  }

  console.log('')
  console.log('View traces: npx pravaha serve')
}

main().catch(console.error)
`,

  'package.json': `{
  "name": "{{PROJECT_NAME}}",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "trace": "pravaha serve"
  },
  "dependencies": {
    "@pravaha/core": "latest",
    "@pravaha/adapter-trace-fs": "latest",
    "@pravaha/plugin-cost-tracker": "latest",
    "@pravaha/cli": "latest",
    "dotenv": "^16.0.0",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "tsx": "^4.7.0",
    "typescript": "^5.4.0"
  }
}
`,

  'tsconfig.json': `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
`,

  '.env.example': `# Pravaha — {{PROJECT_NAME}}
# Copy this file to .env and fill in your values
# This template uses mock steps — no API key required to run as-is
# To use a real LLM, add your key here and update src/index.ts

{{#if claude}}# Anthropic API Key — https://console.anthropic.com
ANTHROPIC_API_KEY=your_api_key_here{{/if}}
{{#if openai}}# OpenAI API Key — https://platform.openai.com
OPENAI_API_KEY=your_api_key_here{{/if}}
{{#if ollama}}# Ollama runs locally — no API key needed
# Make sure Ollama is running: ollama serve{{/if}}
`,

  'README.md': `# {{PROJECT_NAME}}

Built with [Pravaha](https://pravaha.dev) — composable agentic AI workflows.

This template demonstrates a **classify → route → respond** pipeline for support ticket triage.

## Run

\`\`\`bash
pnpm install
pnpm dev
\`\`\`

## Inspect Traces

\`\`\`bash
pnpm trace
\`\`\`

## Learn More

- [Pravaha Docs](https://pravaha.dev)
- [Routers Guide](https://pravaha.dev/guide/routers)
`,
}
