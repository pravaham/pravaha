# @pravaha/adapter-claude

Claude (Anthropic) adapter for Pravaha.

```bash
pnpm add @pravaha/adapter-claude
```

---

## ClaudeLLMStep

Standard (non-streaming) Claude LLM step.

```typescript
import { ClaudeLLMStep } from '@pravaha/adapter-claude'

new ClaudeLLMStep(id: PravahaId, name: string, config: ClaudeAdapterConfig)
```

### ClaudeAdapterConfig

| Property           | Type     | Default             | Description          |
| ------------------ | -------- | ------------------- | -------------------- |
| `apiKey`           | `string` | required            | Anthropic API key    |
| `defaultModel`     | `string` | `'claude-opus-4-5'` | Default model        |
| `defaultMaxTokens` | `number` | `4096`              | Default max tokens   |
| `timeoutMs`        | `number` | `60000`             | Request timeout (ms) |

**Input:** `LLMRequest` — `messages`, optional `model`, `temperature`, `maxTokens`

**Output:** `LLMResponse` — `content`, `model`, `usage`

**Step type:** `'llm:claude'`

**Errors thrown:** `LLMRateLimitError`, `LLMTimeoutError`, `LLMInvalidResponseError`

---

## ClaudeStreamingLLMStep

Streaming Claude step. Supports both `execute()` (collects full response) and `stream()` (yields token deltas).

```typescript
import { ClaudeStreamingLLMStep } from '@pravaha/adapter-claude'

new ClaudeStreamingLLMStep(id: PravahaId, name: string, config: {
  apiKey: string
  defaultModel?: string
  defaultMaxTokens?: number
})
```

**Step type:** `'llm:claude:streaming'`

### `stream(input, context, options?)`

```typescript
for await (const chunk of step.stream(input, context, {
  onChunk?: (chunk: StreamChunk) => void | Promise<void>
  onComplete?: (response: LLMResponse) => void | Promise<void>
  onError?: (err: Error) => void
})) {
  chunk.delta       // new text fragment
  chunk.accumulated // full text so far
  chunk.index       // chunk index (0-based)
}
```

After the loop, call `step.getLastResponse()` to get the final `LLMResponse`.

---

## ClaudeToolCallingAdapter

Tool-calling backend for `AgentStep` using Anthropic's native `tool_use` content blocks.

```typescript
import { ClaudeToolCallingAdapter } from '@pravaha/adapter-claude'

new ClaudeToolCallingAdapter(config: ClaudeToolCallingAdapterConfig)
```

### ClaudeToolCallingAdapterConfig

| Property           | Type     | Default             | Description                   |
| ------------------ | -------- | ------------------- | ----------------------------- |
| `apiKey`           | `string` | required            | Anthropic API key             |
| `defaultModel`     | `string` | `'claude-opus-4-5'` | Default model for agent calls |
| `defaultMaxTokens` | `number` | `4096`              | Default max tokens            |
| `timeoutMs`        | `number` | `60000`             | Request timeout (ms)          |

**adapterName:** `'claude'`

**Compatible with:** All Claude models that support tool use (claude-opus-4-5, claude-sonnet-4-5, claude-haiku).

---

## Examples

### Basic LLM pipeline

```typescript
import { ClaudeLLMStep } from '@pravaha/adapter-claude'
import { PipelineBuilder, TransformStep, LinearRouter } from '@pravaha/core'

const llm = new ClaudeLLMStep('llm', 'LLM', {
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

const pipeline = new PipelineBuilder({ id: 'qa', name: 'QA', version: '1.0.0' })
  .step(
    new TransformStep('prep', 'Prepare', z.string(), z.object({ messages: z.array(...) }),
      (q) => ({ messages: [{ role: 'user', content: q }] })
    ),
    new LinearRouter('to-llm', 'llm'),
  )
  .step(llm)
  .build()
```

### Agent with Claude

```typescript
import { ClaudeToolCallingAdapter } from '@pravaha/adapter-claude'
import { AgentStep, withRetry, LLMRateLimitError } from '@pravaha/core'

const agent = new AgentStep({
  id: 'agent',
  name: 'Agent',
  adapter: new ClaudeToolCallingAdapter({
    apiKey: process.env.ANTHROPIC_API_KEY!,
    defaultModel: 'claude-opus-4-5',
  }),
  tools: [myTool],
  systemPrompt: 'Use tools to answer the question.',
  maxIterations: 8,
})

const resilient = withRetry(agent, {
  maxAttempts: 3,
  retryOn: [LLMRateLimitError],
})
```
