# Claude (Anthropic)

The `@pravaha/adapter-claude` package provides three classes for working with Anthropic's Claude models:

- **`ClaudeLLMStep`** — standard (non-streaming) LLM step
- **`ClaudeStreamingLLMStep`** — streaming LLM step with token-by-token output
- **`ClaudeToolCallingAdapter`** — tool-calling backend for `AgentStep`

## Installation

```bash
pnpm add @pravaha/adapter-claude
```

## ClaudeLLMStep

Use this for standard request-response LLM calls inside a pipeline.

```typescript
import { ClaudeLLMStep } from '@pravaha/adapter-claude'

const llm = new ClaudeLLMStep(
  'classify-llm', // step id
  'Classification LLM', // step name
  {
    apiKey: process.env.ANTHROPIC_API_KEY!,
    defaultModel: 'claude-opus-4-5',
    defaultMaxTokens: 1024,
    timeoutMs: 30_000,
  },
)
```

### Configuration

| Option             | Type     | Default             | Description                                 |
| ------------------ | -------- | ------------------- | ------------------------------------------- |
| `apiKey`           | `string` | required            | Your Anthropic API key                      |
| `defaultModel`     | `string` | `'claude-opus-4-5'` | Model to use when not specified per-request |
| `defaultMaxTokens` | `number` | `4096`              | Max tokens when not specified per-request   |
| `timeoutMs`        | `number` | `60000`             | Request timeout in milliseconds             |

### Input / Output

```typescript
// Input (LLMRequest)
{
  messages: [
    { role: 'system', content: 'You are a support classifier. Respond with JSON only.' },
    { role: 'user', content: ticket.subject + '\n\n' + ticket.body },
  ],
  model: 'claude-opus-4-5',     // optional override
  temperature: 0.1,              // optional
  maxTokens: 512,                // optional override
}

// Output (LLMResponse)
{
  content: '{"category": "billing", "confidence": 0.92}',
  model: 'claude-opus-4-5',
  usage: {
    promptTokens: 145,
    completionTokens: 23,
    totalTokens: 168,
  },
}
```

### Full pipeline example

```typescript
import { z } from 'zod'
import { PipelineBuilder, TransformStep, LinearRouter, BaseStep } from '@pravaha/core'
import type { LLMRequest, LLMResponse, ExecutionContext } from '@pravaha/core'
import { ClaudeLLMStep } from '@pravaha/adapter-claude'

const prepare = new TransformStep(
  'prepare',
  'Prepare',
  z.string(),
  z.object({
    messages: z.array(
      z.object({ role: z.enum(['system', 'user', 'assistant', 'tool']), content: z.string() }),
    ),
  }),
  (text): LLMRequest => ({
    messages: [
      { role: 'system', content: 'Summarise the following text in one sentence.' },
      { role: 'user', content: text },
    ],
    temperature: 0.2,
  }),
)

const llm = new ClaudeLLMStep('llm', 'LLM', {
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

class ExtractContent extends BaseStep<LLMResponse, string> {
  readonly id = 'extract'
  readonly name = 'Extract'
  readonly type = 'transform'
  readonly inputSchema = z.object({
    content: z.string(),
    model: z.string(),
    usage: z.object({
      promptTokens: z.number(),
      completionTokens: z.number(),
      totalTokens: z.number(),
    }),
  }) as z.ZodType<LLMResponse>
  readonly outputSchema = z.string()

  protected async run(input: LLMResponse): Promise<string> {
    return input.content
  }
}

const pipeline = new PipelineBuilder({ id: 'summarise', name: 'Summarise', version: '1.0.0' })
  .step(prepare, new LinearRouter('to-llm', 'llm'))
  .step(llm, new LinearRouter('to-extract', 'extract'))
  .step(new ExtractContent())
  .build()

const result = await pipeline.run('Your long article text here...')
console.log(result.output) // one sentence summary
```

## ClaudeStreamingLLMStep

Use this when you need to stream tokens as they arrive — for real-time user interfaces or long responses where you want to show progress.

```typescript
import { ClaudeStreamingLLMStep } from '@pravaha/adapter-claude'

const llm = new ClaudeStreamingLLMStep('llm', 'Streaming LLM', {
  apiKey: process.env.ANTHROPIC_API_KEY!,
  defaultModel: 'claude-opus-4-5',
})

// Use in a pipeline just like ClaudeLLMStep — execute() works normally
const result = await pipeline.run(input)

// Or stream tokens directly
for await (const chunk of llm.stream(input, context, {
  onChunk: (chunk) => process.stdout.write(chunk.delta),
  onComplete: (response) => console.log('\nDone:', response.usage),
})) {
  // chunk.delta — the new text fragment
  // chunk.accumulated — full text so far
  // chunk.index — chunk number
}
```

See [Streaming Responses](/guide/streaming) for a full guide.

## ClaudeToolCallingAdapter

The tool-calling adapter powers `AgentStep`. It uses Anthropic's native `tool_use` / `tool_result` content blocks.

```typescript
import { ClaudeToolCallingAdapter } from '@pravaha/adapter-claude'
import { AgentStep } from '@pravaha/core'

const adapter = new ClaudeToolCallingAdapter({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  defaultModel: 'claude-opus-4-5',
  defaultMaxTokens: 4096,
})

const agent = new AgentStep({
  id: 'support-agent',
  name: 'Support Agent',
  adapter,
  tools: [searchKnowledgeBase, fetchCustomer, createTicket],
  systemPrompt:
    'You are a support agent. Investigate the issue using available tools and provide a resolution.',
  maxIterations: 10,
})
```

### Configuration

| Option             | Type     | Default             | Description             |
| ------------------ | -------- | ------------------- | ----------------------- |
| `apiKey`           | `string` | required            | Your Anthropic API key  |
| `defaultModel`     | `string` | `'claude-opus-4-5'` | Model used by the agent |
| `defaultMaxTokens` | `number` | `4096`              | Max tokens per LLM call |
| `timeoutMs`        | `number` | `60000`             | Timeout per LLM call    |

## Error Handling

All three classes throw typed Pravaha errors:

```typescript
import { LLMRateLimitError, LLMTimeoutError, LLMInvalidResponseError } from '@pravaha/core'
import { withRetry } from '@pravaha/core'

const resilientLLM = withRetry(llmStep, {
  maxAttempts: 3,
  backoffMs: 2000,
  backoffMultiplier: 2,
  retryOn: [LLMRateLimitError, LLMTimeoutError],
})
```

## Supported Models

Any Claude model that your API key has access to. Common choices:

| Model               | Best for                             |
| ------------------- | ------------------------------------ |
| `claude-opus-4-5`   | Complex reasoning, agentic workflows |
| `claude-sonnet-4-5` | Balanced speed and quality           |
| `claude-haiku`      | Fast, cost-efficient tasks           |

Pass the model per-request to override the default:

```typescript
const input: LLMRequest = {
  messages: [...],
  model: 'claude-haiku',  // override for this specific call
}
```
