# ADR-001: Hexagonal Architecture

**Status:** Accepted  
**Date:** 2024-01-01

## Context

AI agent frameworks tend to grow tightly coupled to specific LLM providers. Swapping providers or backends requires significant refactoring. We need an architecture that keeps the core domain logic independent of all external systems.

## Decision

Pravaha uses hexagonal architecture (ports & adapters). The `@pravaha/core` package defines all ports (interfaces). Adapters in separate packages implement those ports for specific external systems.

**Core ports defined in `@pravaha/core`:**

- `MemoryStore` — memory backend port
- `TraceStore` — trace persistence port
- `Step` — unit of work port
- `Router` — routing decision port

**Adapters implement ports:**

- `@pravaha/adapter-claude` → `Step` (via `ClaudeLLMStep`)
- `@pravaha/adapter-openai` → `Step` (via `OpenAILLMStep`)
- `@pravaha/adapter-memory-inmemory` → `MemoryStore`

## Consequences

**Positive:**

- Core has zero dependencies on external providers
- Providers are swappable at construction time with no code changes to pipelines
- Core logic is fully testable without network access
- New providers are addable without touching core

**Negative:**

- More packages to maintain
- Interface changes in core require updates across all adapters
