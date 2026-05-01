# Support Ticket Triage — Pravaha Example

Demonstrates a production-pattern agentic workflow:

1. **Classify** — Inspect ticket text to determine category (`billing` / `technical` / `general`)
2. **Route** — `ConditionalRouter` sends the classified ticket to the correct handler
3. **Respond** — Category-specific step generates a tailored response
4. **Trace** — Every step is recorded automatically, no extra code needed

## Run

```bash
pnpm install
pnpm start
```

## Extend to Production

| Swap this mock | With this real implementation |
|---|---|
| `ClassifyTicketStep` keyword logic | `ClaudeLLMStep` prompt-based classifier |
| `BillingResponseStep` template | `ClaudeLLMStep` with billing context |
| No memory | `InMemoryStore` or Redis-backed store for ticket history |
| No trace persistence | Custom `TraceStore` → PostgreSQL / Supabase |
