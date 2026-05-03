# OpenAI

The `@pravaha/adapter-openai` package provides three classes for working with OpenAI's models:

- **`OpenAILLMStep`** — standard LLM step
- **`OpenAIStreamingLLMStep`** — streaming LLM step
- **`OpenAIToolCallingAdapter`** — tool-calling backend for `AgentStep`

All three follow the same interface contract as the Claude adapter — swap adapters with one import change.

## Installation

```bash
pnpm add @pravaha/adapter-openai
```

## OpenAILLMStep

```typescript
import { OpenAILLMStep } from '@pravaha/adapter-openai'

const llm = new OpenAILLMStep('classify-llm', 'Classification LLM', {
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: 'gpt-4o',
  defaultMaxTokens: 1024,
  timeoutMs: 30_000,
})
```

### Configuration

| Option             | Type     | Default         | Description                                   |
| ------------------ | -------- | --------------- | --------------------------------------------- |
| `apiKey`           | `string` | required        | Your OpenAI API key                           |
| `defaultModel`     | `string` | `'gpt-4-turbo'` | Model to use when not specified per-request   |
| `defaultMaxTokens` | `number` | `4096`          | Max tokens when not specified per-request     |
| `timeoutMs`        | `number` | `60000`         | Request timeout in milliseconds               |
| `baseURL`          | `string` | —               | Custom base URL (for Azure OpenAI or proxies) |

### Input / Output

Input and output are identical to the Claude adapter — `LLMRequest` in, `LLMResponse` out. Your pipeline steps do not care which LLM is underneath.

```typescript
// Input
{
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'What is the capital of France?' },
  ],
  model: 'gpt-4o',        // optional override
  temperature: 0.0,
}

// Output
{
  content: 'The capital of France is Paris.',
  model: 'gpt-4o-2024-05-13',
  usage: {
    promptTokens: 27,
    completionTokens: 9,
    totalTokens: 36,
  },
}
```

## OpenAIStreamingLLMStep

For token-by-token streaming in real-time interfaces:

```typescript
import { OpenAIStreamingLLMStep } from '@pravaha/adapter-openai'

const llm = new OpenAIStreamingLLMStep('llm', 'Streaming LLM', {
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: 'gpt-4o',
})

// Works as a regular pipeline step (collects full response internally)
const result = await pipeline.run(input)

// Or stream explicitly
for await (const chunk of llm.stream(input, context, {
  onChunk: (chunk) => process.stdout.write(chunk.delta),
})) {
}
```

**Note:** OpenAI's streaming API does not return token usage in streaming mode. The `usage` field in the output will be zeroed when streaming. Use `OpenAILLMStep` if you need accurate token counts.

## OpenAIToolCallingAdapter

Powers `AgentStep` using OpenAI's native `tool_calls` format:

```typescript
import { OpenAIToolCallingAdapter } from '@pravaha/adapter-openai'
import { AgentStep } from '@pravaha/core'

const adapter = new OpenAIToolCallingAdapter({
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: 'gpt-4o',
  defaultMaxTokens: 4096,
})

const agent = new AgentStep({
  id: 'research-agent',
  name: 'Research Agent',
  adapter,
  tools: [searchWeb, fetchPage, summarise],
  systemPrompt: 'You are a research assistant. Use tools to find accurate information.',
  maxIterations: 12,
})
```

### Configuration

| Option             | Type     | Default    | Description             |
| ------------------ | -------- | ---------- | ----------------------- |
| `apiKey`           | `string` | required   | Your OpenAI API key     |
| `defaultModel`     | `string` | `'gpt-4o'` | Model used by the agent |
| `defaultMaxTokens` | `number` | `4096`     | Max tokens per LLM call |
| `timeoutMs`        | `number` | `60000`    | Timeout per LLM call    |
| `baseURL`          | `string` | —          | Custom base URL         |

## Azure OpenAI

Both `OpenAILLMStep` and `OpenAIToolCallingAdapter` support Azure OpenAI via the `baseURL` option:

```typescript
const llm = new OpenAILLMStep('llm', 'Azure LLM', {
  apiKey: process.env.AZURE_OPENAI_API_KEY!,
  baseURL: `https://${process.env.AZURE_OPENAI_ENDPOINT}.openai.azure.com/openai/deployments/${process.env.AZURE_DEPLOYMENT_NAME}`,
  defaultModel: 'gpt-4o',
})
```

## Error Handling

```typescript
import { withRetry, LLMRateLimitError, LLMTimeoutError } from '@pravaha/core'

const resilientLLM = withRetry(new OpenAILLMStep('llm', 'LLM', config), {
  maxAttempts: 3,
  backoffMs: 2000,
  backoffMultiplier: 2,
  retryOn: [LLMRateLimitError, LLMTimeoutError],
})
```

| OpenAI error                | Pravaha error             |
| --------------------------- | ------------------------- |
| `RateLimitError`            | `LLMRateLimitError`       |
| `APIConnectionTimeoutError` | `LLMTimeoutError`         |
| Empty response              | `LLMInvalidResponseError` |
| All other errors            | `LLMInvalidResponseError` |

## Supported Models

Any model your API key has access to. Common choices:

| Model           | Best for                                 |
| --------------- | ---------------------------------------- |
| `gpt-4o`        | Complex reasoning, best quality          |
| `gpt-4-turbo`   | Strong reasoning, lower cost than gpt-4o |
| `gpt-3.5-turbo` | Fast, very low cost                      |

Pass the model per-request to override the default:

```typescript
const input: LLMRequest = {
  messages: [...],
  model: 'gpt-3.5-turbo',  // override for this specific call
}
```
