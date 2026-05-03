# Contributing to Pravaha

## Prerequisites

- Node.js >= 20
- pnpm >= 8

## Setup

```bash
git clone https://github.com/your-org/pravaha
cd pravaha
pnpm install
pnpm build
pnpm test
```

## Principles

Before contributing, read [ARCHITECTURE.md](ARCHITECTURE.md) and the ADRs in `docs/architecture/decisions/`. Every PR must respect these decisions.

**Non-negotiables:**

- No `any` types — ever
- `@pravaha/core` must not gain new external dependencies (only `zod` is allowed)
- `ExecutionContext` must remain immutable
- Every new step type must have corresponding tests
- Every public export must have JSDoc

## Adding a New Adapter

1. Create `packages/adapters/<provider>/`
2. Implement `Step<LLMRequest, LLMResponse>` by extending `BaseStep`
3. Map provider-specific errors to `LLMTimeoutError`, `LLMRateLimitError`, or `LLMInvalidResponseError`
4. Write tests that mock the provider SDK
5. Export from `src/index.ts`

## Adding a New Plugin

1. Create `packages/plugins/<name>/`
2. Implement `PravahaPlugin` interface
3. Plugins must never throw — all errors must be caught internally
4. Provide a typed public API for querying plugin state (e.g., `getCostSummary`)

## Changesets

This repo uses [Changesets](https://github.com/changesets/changesets). Add a changeset for every user-facing change:

```bash
pnpm changeset
```

## Code Style

- Prettier handles formatting (run `pnpm prettier --write .`)
- ESLint handles linting (run `pnpm lint`)
- No comments explaining what the code does — only why
