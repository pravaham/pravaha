# Streaming

Streaming delivers LLM tokens in real-time as they are generated.
Use for user-facing interfaces where latency matters.

## Check Streaming Support

```typescript
import { isStreamingStep } from '@pravaha/core'

if (isStreamingStep(step)) {
  // This step supports streaming
}
```

## Stream Tokens

```typescript
import { ClaudeStreamingLLMStep } from '@pravaha/adapter-claude'

const step = new ClaudeStreamingLLMStep('llm', 'LLM', {
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

// Async iteration
for await (const chunk of step.stream(input, ctx)) {
  process.stdout.write(chunk.delta)  // incremental token
  console.log(chunk.accumulated)     // full text so far
}

// With callbacks
for await (const _ of step.stream(input, ctx, {
  onChunk: (chunk) => sendToWebSocket(chunk.delta),
  onComplete: (response) => saveToDatabase(response),
})) {}
```

## Collect Full Response

```typescript
import { collectStream } from '@pravaha/core'

const fullText = await collectStream(step.stream(input, ctx))
```

## Available Streaming Steps

| Step | Package |
|---|---|
| `ClaudeStreamingLLMStep` | `@pravaha/adapter-claude` |
| `OpenAIStreamingLLMStep` | `@pravaha/adapter-openai` |
| `OllamaStreamingLLMStep` | `@pravaha/adapter-ollama` |
