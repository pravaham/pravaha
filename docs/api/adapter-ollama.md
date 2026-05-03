# @pravaha/adapter-ollama

Ollama adapter for Pravaha — run local models with zero API cost.

```bash
pnpm add @pravaha/adapter-ollama
```

**Requires:** [Ollama](https://ollama.ai) running locally or on your network.

---

## OllamaLLMStep

Standard (non-streaming) Ollama LLM step.

```typescript
import { OllamaLLMStep } from '@pravaha/adapter-ollama'

new OllamaLLMStep(id: PravahaId, name: string, config?: OllamaAdapterConfig)
```

### OllamaAdapterConfig

| Property           | Type     | Default                    | Description                                     |
| ------------------ | -------- | -------------------------- | ----------------------------------------------- |
| `baseUrl`          | `string` | `'http://localhost:11434'` | Ollama server URL                               |
| `defaultModel`     | `string` | `'llama3.2'`               | Default model                                   |
| `defaultMaxTokens` | `number` | —                          | Max tokens (`num_predict`)                      |
| `timeoutMs`        | `number` | `120000`                   | Request timeout (ms) — local models can be slow |

**Input:** `LLMRequest`

**Output:** `LLMResponse`

**Step type:** `'llm:ollama'`

**Errors:** `LLMTimeoutError`, `LLMInvalidResponseError`

### `healthCheck()`

```typescript
const health = await ollamaStep.healthCheck()
// { ok: boolean, models: string[], error?: string }
```

Check whether Ollama is reachable and list available models. Useful in `onPipelineStart` hooks or startup checks.

---

## OllamaStreamingLLMStep

Streaming Ollama step using NDJSON streaming.

```typescript
import { OllamaStreamingLLMStep } from '@pravaha/adapter-ollama'

new OllamaStreamingLLMStep(id: PravahaId, name: string, config?: {
  baseUrl?: string
  defaultModel?: string
  timeoutMs?: number
})
```

**Step type:** `'llm:ollama:streaming'`

### `stream(input, context, options?)`

```typescript
for await (const chunk of step.stream(input, context, {
  onChunk?: (chunk: StreamChunk) => void | Promise<void>
  onComplete?: (response: LLMResponse) => void | Promise<void>
  onError?: (err: Error) => void
})) {
  chunk.delta       // new text fragment
  chunk.accumulated // full text so far
}
```

---

## OllamaToolCallingAdapter

Tool-calling backend for `AgentStep`. Uses JSON-mode prompt engineering since most Ollama models lack native function calling.

```typescript
import { OllamaToolCallingAdapter } from '@pravaha/adapter-ollama'

new OllamaToolCallingAdapter(config?: {
  baseUrl?: string
  defaultModel?: string
  timeoutMs?: number
})
```

| Property       | Type     | Default                    | Description                                  |
| -------------- | -------- | -------------------------- | -------------------------------------------- |
| `baseUrl`      | `string` | `'http://localhost:11434'` | Ollama server URL                            |
| `defaultModel` | `string` | `'llama3.1'`               | Model (llama3.1 or mistral-nemo recommended) |
| `timeoutMs`    | `number` | `120000`                   | Request timeout (ms)                         |

**adapterName:** `'ollama'`

**Note:** Tool-calling quality varies by model. `llama3.1` (8B) and `mistral-nemo` have the best support. `llama3.2` (2B) is unreliable for tool calling.

---

## Error Messages

| Scenario           | Error message                                                              |
| ------------------ | -------------------------------------------------------------------------- |
| Ollama not running | `"Cannot connect to Ollama at http://localhost:11434. Is Ollama running?"` |
| Model not pulled   | `"Model 'llama3.2' not found. Run: ollama pull llama3.2"`                  |
| Request timeout    | `LLMTimeoutError`                                                          |

---

## Examples

### Local LLM step

```typescript
import { OllamaLLMStep } from '@pravaha/adapter-ollama'

const llm = new OllamaLLMStep('llm', 'Local LLM', {
  defaultModel: 'llama3.2',
})

// Health check at startup
const health = await llm.healthCheck()
if (!health.ok) throw new Error(`Ollama unavailable: ${health.error}`)
```

### Local agent

```typescript
import { OllamaToolCallingAdapter } from '@pravaha/adapter-ollama'
import { AgentStep } from '@pravaha/core'

const agent = new AgentStep({
  id: 'local-agent',
  name: 'Local Agent',
  adapter: new OllamaToolCallingAdapter({ defaultModel: 'llama3.1' }),
  tools: [searchTool],
  systemPrompt: 'Use available tools to answer the question.',
  maxIterations: 5,
})
```

### Provider swap pattern

```typescript
// Development
import { OllamaLLMStep } from '@pravaha/adapter-ollama'
const llm = new OllamaLLMStep('llm', 'LLM', { defaultModel: 'llama3.2' })

// Production — change one import, zero other changes
import { ClaudeLLMStep } from '@pravaha/adapter-claude'
const llm = new ClaudeLLMStep('llm', 'LLM', { apiKey: process.env.ANTHROPIC_API_KEY! })
```
