# Pravaha Architecture

## Overview

Pravaha is built on hexagonal architecture (ports & adapters). The core domain contains zero knowledge of external systems. All integrations are adapters implementing core-defined ports.

## Core Principles

### 1. Hexagonal Architecture

Core logic is isolated from infrastructure. LLM providers, memory backends, and trace stores are all adapters that implement interfaces defined in `@pravaha/core`.

### 2. Immutable Execution Context

`ExecutionContext` is never mutated. Every step receives a context and returns a new context. This eliminates shared mutable state bugs and makes pipeline execution fully reproducible.

### 3. Interface-First Design

All public contracts are TypeScript interfaces defined before any implementation. Contributors implement interfaces — they never inherit from concrete classes unless explicitly intended.

### 4. Trace as First-Class Citizen

Every pipeline execution automatically produces a complete `Trace` — a structured, immutable log of every step, decision, input, and output. This is not optional logging — it is built into the pipeline runner.

### 5. Plugin System

Cross-cutting concerns (cost tracking, telemetry, alerting) are implemented as plugins. The plugin registry safely invokes hooks — plugin errors never crash pipeline execution.

### 6. Schema Validation at Boundaries

Every step validates input and output using Zod schemas. Type safety is enforced at runtime, not just compile time.

## Package Structure

| Package                            | Purpose                             | External Deps       |
| ---------------------------------- | ----------------------------------- | ------------------- |
| `@pravaha/core`                    | Pipeline engine, interfaces, errors | `zod` only          |
| `@pravaha/adapter-claude`          | Anthropic Claude LLM adapter        | `@anthropic-ai/sdk` |
| `@pravaha/adapter-openai`          | OpenAI adapter                      | `openai`            |
| `@pravaha/adapter-memory-inmemory` | Default memory store                | none                |
| `@pravaha/plugin-cost-tracker`     | Token cost tracking plugin          | none                |

## Execution Flow

```
Pipeline.run(input)
  └── createExecutionContext()
  └── plugins.emit('onPipelineStart')
  └── loop: while (currentStepId !== null)
        ├── step.execute(input, context)       ← validates input, runs logic, validates output
        ├── router.route(output, context)       ← determines next step
        ├── collector.recordEvent(...)          ← immutable trace entry
        ├── plugins.emit('onStepComplete')      ← plugin hooks (safe, non-blocking)
        └── withDepth(withState(context, ...))  ← new immutable context
  └── collector.build('completed')
  └── plugins.emit('onPipelineComplete')
  └── return { output, trace, context }
```

## ADR Index

- [ADR-001](docs/architecture/decisions/ADR-001-hexagonal-architecture.md) — Hexagonal Architecture
- [ADR-002](docs/architecture/decisions/ADR-002-immutable-context.md) — Immutable Execution Context
- [ADR-003](docs/architecture/decisions/ADR-003-zod-schema-validation.md) — Zod for Schema Validation
- [ADR-004](docs/architecture/decisions/ADR-004-plugin-system.md) — Plugin System Design
