# Claude (Vertex AI)

The `@pravaha/adapter-claude-vertex` package provides Claude on Google Cloud Vertex AI. It is a drop-in replacement for `@pravaha/adapter-claude` — the interface is identical, the only difference is authentication and routing.

Use this when:

- Deploying on Google Cloud and want to use Workload Identity (no API keys in code)
- Your organisation has a GCP contract with Anthropic via Vertex
- You need to keep LLM traffic within a specific GCP region for compliance

## Installation

```bash
pnpm add @pravaha/adapter-claude-vertex
```

## Authentication

The adapter uses **Google Application Default Credentials (ADC)**. No API key is required.

| Environment       | How to authenticate                                                       |
| ----------------- | ------------------------------------------------------------------------- |
| GKE / Cloud Run   | Attach a service account with Vertex AI permissions — works automatically |
| Local development | Run `gcloud auth application-default login`                               |
| CI / CD           | Set `GOOGLE_APPLICATION_CREDENTIALS` to a service account key file path   |

Required IAM role: `roles/aiplatform.user`

## ClaudeVertexLLMStep

```typescript
import { ClaudeVertexLLMStep } from '@pravaha/adapter-claude-vertex'

const llm = new ClaudeVertexLLMStep('classify-llm', 'Classification LLM', {
  projectId: 'my-gcp-project',
  region: 'us-central1',
  defaultModel: 'claude-3-5-sonnet@20241022',
  defaultMaxTokens: 2048,
})
```

### Configuration

| Option             | Type           | Required | Description                        |
| ------------------ | -------------- | -------- | ---------------------------------- |
| `projectId`        | `string`       | yes      | GCP project ID                     |
| `region`           | `VertexRegion` | yes      | GCP region (must support Claude)   |
| `defaultModel`     | `string`       | no       | Model in Vertex format (see below) |
| `defaultMaxTokens` | `number`       | no       | Default: `4096`                    |
| `timeoutMs`        | `number`       | no       | Default: `60000`                   |

### Supported Regions

Only certain regions support Claude on Vertex AI:

```typescript
type VertexRegion = 'us-central1' | 'us-east4' | 'europe-west1' | 'europe-west4' | 'asia-southeast1'
```

### Model IDs

Vertex AI requires versioned model IDs. The adapter maps short names automatically:

| Short name          | Vertex model ID              |
| ------------------- | ---------------------------- |
| `claude-opus-4-5`   | `claude-3-opus@20240229`     |
| `claude-sonnet-4-5` | `claude-3-5-sonnet@20241022` |
| `claude-haiku`      | `claude-3-haiku@20240307`    |

You can also specify a versioned ID directly:

```typescript
defaultModel: 'claude-3-5-sonnet@20241022'
```

## ClaudeVertexToolCallingAdapter

Powers `AgentStep` using Claude on Vertex AI:

```typescript
import { ClaudeVertexToolCallingAdapter } from '@pravaha/adapter-claude-vertex'
import { AgentStep } from '@pravaha/core'

const adapter = new ClaudeVertexToolCallingAdapter({
  projectId: 'my-gcp-project',
  region: 'europe-west1',
  defaultModel: 'claude-3-5-sonnet@20241022',
})

const agent = new AgentStep({
  id: 'support-agent',
  name: 'Support Agent',
  adapter,
  tools: [searchKnowledgeBase, fetchCustomer],
  systemPrompt: 'You are a support agent...',
  maxIterations: 8,
})
```

## Swapping Between Direct and Vertex

The entire point of adapters is that your pipeline code never changes. Switch by changing one import:

```typescript
// Development / non-GCP deployment
import { ClaudeLLMStep, ClaudeToolCallingAdapter } from '@pravaha/adapter-claude'

const llm = new ClaudeLLMStep('llm', 'LLM', {
  apiKey: process.env.ANTHROPIC_API_KEY!,
})
```

```typescript
// Production on GCP — identical step interface
import { ClaudeVertexLLMStep, ClaudeVertexToolCallingAdapter } from '@pravaha/adapter-claude-vertex'

const llm = new ClaudeVertexLLMStep('llm', 'LLM', {
  projectId: process.env.GCP_PROJECT_ID!,
  region: 'us-central1',
})
```

The pipeline, routing, schemas, and everything else stays the same.

## Error Handling

The adapter maps GCP error responses to standard Pravaha errors:

| GCP error                     | Pravaha error             |
| ----------------------------- | ------------------------- |
| `RESOURCE_EXHAUSTED` / `429`  | `LLMRateLimitError`       |
| `DEADLINE_EXCEEDED` / timeout | `LLMTimeoutError`         |
| All other errors              | `LLMInvalidResponseError` |

```typescript
import { withRetry, LLMRateLimitError, LLMTimeoutError } from '@pravaha/core'

const resilientLLM = withRetry(llmStep, {
  maxAttempts: 3,
  backoffMs: 2000,
  retryOn: [LLMRateLimitError, LLMTimeoutError],
})
```

## Metadata in Output

The Vertex adapter adds GCP metadata to the LLM step output:

```typescript
const result = await pipeline.run(input)
const llmEvent = result.trace.events.find((e) => e.stepType === 'llm:claude-vertex')

console.log(llmEvent?.output.metadata)
// { vertexProjectId: 'my-gcp-project', vertexRegion: 'us-central1' }
```
