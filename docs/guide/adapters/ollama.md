# Ollama

The `@pravaha/adapter-ollama` package lets you run pipelines against local models using [Ollama](https://ollama.ai). No API keys, no network calls, no costs.

Use this when:

- Developing locally without spending on API credits
- Running in air-gapped environments where data cannot leave the network
- Testing with fast local models before switching to a cloud provider

## Prerequisites

1. Install Ollama from [ollama.ai](https://ollama.ai)
2. Pull a model:

```bash
ollama pull llama3.2      # 2B parameter — fast and small
ollama pull llama3.1      # 8B — better quality, best tool calling support
ollama pull mistral       # 7B — good all-rounder
ollama pull codellama     # specialised for code
```

3. Verify Ollama is running:

```bash
ollama list   # shows installed models
curl http://localhost:11434/api/tags  # API health check
```

## Installation

```bash
pnpm add @pravaha/adapter-ollama
```

## OllamaLLMStep

```typescript
import { OllamaLLMStep } from '@pravaha/adapter-ollama'

const llm = new OllamaLLMStep('local-llm', 'Local LLM', {
  baseUrl: 'http://localhost:11434', // default
  defaultModel: 'llama3.2',
  defaultMaxTokens: 2048,
  timeoutMs: 120_000, // local models can be slow — 2 min default
})
```

### Configuration

| Option             | Type     | Default                    | Description                                     |
| ------------------ | -------- | -------------------------- | ----------------------------------------------- |
| `baseUrl`          | `string` | `'http://localhost:11434'` | Ollama server URL                               |
| `defaultModel`     | `string` | `'llama3.2'`               | Model to use                                    |
| `defaultMaxTokens` | `number` | —                          | Max tokens (`num_predict` in Ollama)            |
| `timeoutMs`        | `number` | `120000`                   | Request timeout (ms) — local models can be slow |

### Health Check

`OllamaLLMStep` includes a `healthCheck()` method to verify Ollama is running before starting a pipeline:

```typescript
const health = await llm.healthCheck()

if (!health.ok) {
  console.error('Ollama is not running:', health.error)
  process.exit(1)
}

console.log('Available models:', health.models)
// ['llama3.2:latest', 'llama3.1:latest', 'mistral:latest']
```

### Error messages

If you try to use a model that is not installed, you get a clear error:

```
LLMInvalidResponseError: Model 'llama3.2' not found. Run: ollama pull llama3.2
```

## OllamaStreamingLLMStep

```typescript
import { OllamaStreamingLLMStep } from '@pravaha/adapter-ollama'

const llm = new OllamaStreamingLLMStep('llm', 'Streaming LLM', {
  baseUrl: 'http://localhost:11434',
  defaultModel: 'llama3.2',
})

for await (const chunk of llm.stream(input, context, {
  onChunk: (c) => process.stdout.write(c.delta),
})) {
}
```

## OllamaToolCallingAdapter

Tool calling with Ollama uses JSON-mode prompt engineering — the model is instructed to respond in a specific JSON format when calling tools.

**Recommendation:** Use `llama3.1` or `mistral-nemo` for best tool-calling results. Smaller models (e.g. `llama3.2`) have inconsistent tool-calling behaviour.

```typescript
import { OllamaToolCallingAdapter } from '@pravaha/adapter-ollama'
import { AgentStep } from '@pravaha/core'

const adapter = new OllamaToolCallingAdapter({
  baseUrl: 'http://localhost:11434',
  defaultModel: 'llama3.1', // 8B — best tool calling
  timeoutMs: 180_000,
})

const agent = new AgentStep({
  id: 'local-agent',
  name: 'Local Agent',
  adapter,
  tools: [searchKnowledgeBase, fetchCustomer],
  systemPrompt: 'You are a support agent. Use tools to investigate and resolve customer issues.',
  maxIterations: 5,
})
```

### How tool calling works with Ollama

Since most Ollama models don't support native function calling, the adapter injects a system prompt that instructs the model to respond with a specific JSON format when it wants to call a tool:

```json
{ "tool_call": { "id": "1", "name": "kb-search", "input": { "query": "login error" } } }
```

If the model responds with plain text instead, that is treated as the final answer.

## Local Development Workflow

Develop with Ollama locally, deploy with Claude or OpenAI in production — swap with one import change:

```typescript
// Local development (free, fast, private)
import { OllamaLLMStep } from '@pravaha/adapter-ollama'
const llm = new OllamaLLMStep('llm', 'LLM', { defaultModel: 'llama3.2' })

// Production (switch to Claude with no other changes)
import { ClaudeLLMStep } from '@pravaha/adapter-claude'
const llm = new ClaudeLLMStep('llm', 'LLM', { apiKey: process.env.ANTHROPIC_API_KEY! })
```

## Remote Ollama

For team setups where one server hosts Ollama for all developers:

```typescript
const llm = new OllamaLLMStep('llm', 'Shared LLM', {
  baseUrl: 'http://ollama.internal.company.com:11434',
  defaultModel: 'llama3.1',
})
```

## Error Handling

```typescript
import { withRetry, LLMTimeoutError } from '@pravaha/core'

// Local models are slow — retry on timeout
const resilientLLM = withRetry(llmStep, {
  maxAttempts: 2,
  backoffMs: 1000,
  retryOn: [LLMTimeoutError],
})
```

| Scenario           | Error                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| Ollama not running | `LLMInvalidResponseError` — "Cannot connect to Ollama at http://localhost:11434. Is Ollama running?" |
| Model not pulled   | `LLMInvalidResponseError` — "Model 'x' not found. Run: ollama pull x"                                |
| Request timeout    | `LLMTimeoutError`                                                                                    |
| HTTP error         | `LLMInvalidResponseError`                                                                            |
