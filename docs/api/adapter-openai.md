# @pravaha/adapter-openai

OpenAI adapter for Pravaha.

```bash
pnpm add @pravaha/adapter-openai
```

---

## OpenAILLMStep

Standard (non-streaming) OpenAI LLM step.

```typescript
import { OpenAILLMStep } from '@pravaha/adapter-openai'

new OpenAILLMStep(id: PravahaId, name: string, config: OpenAIAdapterConfig)
```

### OpenAIAdapterConfig

| Property           | Type     | Default         | Description          |
| ------------------ | -------- | --------------- | -------------------- |
| `apiKey`           | `string` | required        | OpenAI API key       |
| `defaultModel`     | `string` | `'gpt-4-turbo'` | Default model        |
| `defaultMaxTokens` | `number` | `4096`          | Default max tokens   |
| `timeoutMs`        | `number` | `60000`         | Request timeout (ms) |

**Input:** `LLMRequest`

**Output:** `LLMResponse`

**Step type:** `'llm:openai'`

**Errors:** `LLMRateLimitError`, `LLMTimeoutError`, `LLMInvalidResponseError`

---

## OpenAIStreamingLLMStep

Streaming OpenAI step.

```typescript
import { OpenAIStreamingLLMStep } from '@pravaha/adapter-openai'

new OpenAIStreamingLLMStep(id: PravahaId, name: string, config: {
  apiKey: string
  defaultModel?: string
  defaultMaxTokens?: number
  baseURL?: string
})
```

**Step type:** `'llm:openai:streaming'`

**Note:** OpenAI streaming does not return token usage. The `usage` field in the output will be `{ promptTokens: 0, completionTokens: 0, totalTokens: 0 }` when streaming.

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

---

## OpenAIToolCallingAdapter

Tool-calling backend for `AgentStep` using OpenAI's native `tool_calls` array format.

```typescript
import { OpenAIToolCallingAdapter } from '@pravaha/adapter-openai'

new OpenAIToolCallingAdapter(config: OpenAIToolCallingAdapterConfig)
```

### OpenAIToolCallingAdapterConfig

| Property           | Type     | Default    | Description                                   |
| ------------------ | -------- | ---------- | --------------------------------------------- |
| `apiKey`           | `string` | required   | OpenAI API key                                |
| `defaultModel`     | `string` | `'gpt-4o'` | Default model for agent calls                 |
| `defaultMaxTokens` | `number` | `4096`     | Default max tokens                            |
| `timeoutMs`        | `number` | `60000`    | Request timeout (ms)                          |
| `baseURL`          | `string` | —          | Custom base URL (for Azure OpenAI or proxies) |

**adapterName:** `'openai'`

**Compatible with:** GPT-4o, GPT-4-turbo, GPT-3.5-turbo. Azure OpenAI via `baseURL`.

---

## Azure OpenAI

Both `OpenAILLMStep` and `OpenAIToolCallingAdapter` support Azure OpenAI via `baseURL`:

```typescript
new OpenAILLMStep('llm', 'Azure LLM', {
  apiKey: process.env.AZURE_OPENAI_KEY!,
  baseURL: `https://${process.env.AZURE_ENDPOINT}.openai.azure.com/openai/deployments/${process.env.AZURE_DEPLOYMENT}`,
  defaultModel: 'gpt-4o',
})
```

---

## Examples

### Basic pipeline

```typescript
import { OpenAILLMStep } from '@pravaha/adapter-openai'

const llm = new OpenAILLMStep('llm', 'LLM', {
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: 'gpt-4o',
})
```

### Agent

```typescript
import { OpenAIToolCallingAdapter } from '@pravaha/adapter-openai'
import { AgentStep } from '@pravaha/core'

const agent = new AgentStep({
  id: 'agent',
  name: 'Agent',
  adapter: new OpenAIToolCallingAdapter({
    apiKey: process.env.OPENAI_API_KEY!,
    defaultModel: 'gpt-4o',
  }),
  tools: [searchTool, lookupTool],
  systemPrompt: 'Use tools to answer user questions.',
  maxIterations: 10,
})
```

### Streaming

```typescript
import { OpenAIStreamingLLMStep } from '@pravaha/adapter-openai'

const llm = new OpenAIStreamingLLMStep('llm', 'Streaming LLM', {
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: 'gpt-4o',
})

for await (const chunk of llm.stream(input, context, {
  onChunk: (c) => process.stdout.write(c.delta),
})) {
}
```
