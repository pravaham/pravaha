# Changelog

All notable changes to Pravaha are documented here. Pravaha follows [Semantic Versioning](https://semver.org/).

---

## v0.1.0 — 2025-05-01

Initial public release. 🎉

### Packages Released

| Package                          | Version |
| -------------------------------- | ------- |
| `@pravaha/core`                  | `0.1.0` |
| `@pravaha/adapter-claude`        | `0.1.0` |
| `@pravaha/adapter-openai`        | `0.1.0` |
| `@pravaha/adapter-ollama`        | `0.1.0` |
| `@pravaha/adapter-claude-vertex` | `0.1.0` |
| `@pravaha/adapter-trace-fs`      | `0.1.0` |
| `@pravaha/adapter-memory-redis`  | `0.1.0` |
| `@pravaha/cli`                   | `0.1.0` |
| `create-pravaha-app`             | `0.1.0` |

### Core (`@pravaha/core`)

**Pipeline primitives**

- `PipelineBuilder` — fluent API for assembling multi-step pipelines with full TypeScript inference
- `Pipeline.run()` — execute a pipeline end-to-end, returning typed `PipelineResult`
- `Pipeline.dryRun()` — execute with mock responses for testing and CI validation
- `ExecutionContext` — immutable context carrying run ID, pipeline metadata, memory, and plugins

**Step types**

- `BaseStep<TInput, TOutput>` — abstract base class for all steps
- `TransformStep` — inline data transformation with a synchronous or async function
- `ToolStep` / `defineToolStep` — strongly typed tool invocations with Zod schema validation
- `AgentStep` — LLM agent with tool-calling loop, pluggable via `ToolCallingAdapter`
- `defineAgentOutputParser` — parse structured JSON or regex output from agent responses

**Routing**

- `LinearRouter` — routes to a fixed next step or ends the pipeline
- `ConditionalRouter` — routes based on step output with an ordered list of conditions and a fallback

**Observability**

- `Trace` / `TraceEvent` — automatic per-step tracing with timing and routing decisions
- `TraceStore` interface — pluggable trace persistence
- `InMemoryTraceStore` — default in-process store

**Memory**

- `MemoryStore` interface — key-value store for cross-run persistence
- `InMemoryStore` — default in-process implementation

**Resilience**

- `withRetry()` — wraps any step with exponential backoff retry logic
- `RetryPolicy` — configure `maxAttempts`, `backoffMs`, `retryOn` error types

**Error hierarchy**

- `PravahaError` — base class
- `ValidationError`, `StepExecutionError`, `PipelineConfigError`, `RouterError`
- `LLMRateLimitError`, `LLMTimeoutError`, `LLMInvalidResponseError`
- `AgentMaxIterationsError`, `AgentToolCallError`

**Plugins**

- `PravahaPlugin` interface — lifecycle hooks: `onPipelineStart`, `onStepStart`, `onStepComplete`, `onPipelineComplete`, `onError`
- `PluginRegistry` — manages ordered plugin execution

**Streaming**

- `BaseStreamingStep<TInput, TOutput>` — base class for streaming-capable steps
- `StreamChunk` type — `delta`, `accumulated`, `index`

### Adapters

**`@pravaha/adapter-claude`**

- `ClaudeLLMStep` — standard (non-streaming) Claude completion
- `ClaudeStreamingLLMStep` — streaming Claude completion with `stream()` async iterator
- `ClaudeToolCallingAdapter` — native `tool_use` content blocks for `AgentStep`

**`@pravaha/adapter-openai`**

- `OpenAILLMStep` — standard GPT completion
- `OpenAIStreamingLLMStep` — streaming GPT completion
- `OpenAIToolCallingAdapter` — native `tool_calls` format for `AgentStep`; Azure OpenAI supported via `baseURL`

**`@pravaha/adapter-ollama`**

- `OllamaLLMStep` — local Ollama completion with `healthCheck()` method
- `OllamaStreamingLLMStep` — streaming local completion
- `OllamaToolCallingAdapter` — JSON-mode tool calling for local models (llama3.1, mistral-nemo recommended)

**`@pravaha/adapter-claude-vertex`**

- `ClaudeVertexLLMStep` — Claude on Google Cloud Vertex AI
- `ClaudeVertexToolCallingAdapter` — tool calling via Vertex AI; supports workload identity federation

**`@pravaha/adapter-trace-fs`**

- `FsTraceStore` — writes trace files to `.pravaha/traces/` for use with the CLI

**`@pravaha/adapter-memory-redis`**

- `RedisMemoryStore` — Redis-backed `MemoryStore` for persistent cross-run memory

### CLI (`@pravaha/cli`)

- `pravaha trace list` — list all saved traces ordered most recent first
- `pravaha trace show <runId>` — print a full trace to the terminal
- `pravaha serve` — start the visual trace viewer at `http://localhost:4321`
- `pravaha export <runId>` — export a trace to JSON or CSV

### Scaffolding (`create-pravaha-app`)

- `pnpm create pravaha-app` — interactive project scaffold
- Templates: `basic`, `agent`, `streaming`
- Generates a fully configured TypeScript project with the selected template

### Examples

- `support-ticket-triage` — flagship example demonstrating rule-based routing, KB lookup ToolStep, AgentStep triage, dry-run, and production adaptation guide

---

## Versioning Policy

Pravaha follows [Semantic Versioning](https://semver.org/):

- **Patch** (`0.1.x`) — bug fixes and documentation updates
- **Minor** (`0.x.0`) — new features, backwards-compatible
- **Major** (`x.0.0`) — breaking changes; migration guide provided

Breaking changes are called out explicitly in the changelog entry with a **Breaking:** label and a migration path.

---

## Stay Updated

- **GitHub Releases** — each release has a tagged GitHub release with full notes
- **npm** — all packages publish to the `@pravaha` scope on npm
- **Discussions** — [GitHub Discussions](https://github.com/pravaham/pravaha/discussions) for questions and feedback
