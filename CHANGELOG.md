# Changelog

All notable changes to Pravaha are documented here.

This project follows [Semantic Versioning](https://semver.org/) and uses
[Changesets](https://github.com/changesets/changesets) for release management.

## [0.1.0] — Initial Release

### Packages

- `@pravaha/core` — Pipeline engine, AgentStep, ToolStep, withRetry, dry-run
- `@pravaha/adapter-claude` — Anthropic Claude adapter + streaming + tool calling
- `@pravaha/adapter-claude-vertex` — GCP Vertex AI adapter
- `@pravaha/adapter-openai` — OpenAI adapter + streaming + tool calling
- `@pravaha/adapter-ollama` — Ollama local model adapter + streaming + tool calling
- `@pravaha/adapter-memory-inmemory` — In-memory store
- `@pravaha/adapter-memory-redis` — Redis store
- `@pravaha/adapter-trace-fs` — File-system trace store
- `@pravaha/plugin-cost-tracker` — Token cost tracking
- `@pravaha/cli` — Trace inspector CLI with serve and export
