# ADR-002: Immutable Execution Context

**Status:** Accepted  
**Date:** 2024-01-01

## Context

Shared mutable state is the primary source of subtle bugs in multi-step pipelines. If steps can mutate a shared context object, state management becomes unpredictable and pipelines become hard to test in isolation.

## Decision

`ExecutionContext` is immutable. Steps receive a context and return a new context. Mutation is impossible at the type level — all properties are `readonly` and the object is frozen at runtime via `Object.freeze`.

Context updates use pure functions:
- `withMessages(ctx, messages)` — appends messages
- `withState(ctx, state)` — merges state
- `withDepth(ctx)` — increments execution depth

The pipeline runner applies these functions after each step and threads the updated context forward.

## Consequences

**Positive:**
- Each step is independently testable with explicit inputs
- No race conditions in async pipelines
- Context changes are explicit and traceable
- Time-travel debugging: any intermediate context can be replayed

**Negative:**
- Object allocation on every step (shallow copies via spread)
- Developers new to functional patterns may find this unfamiliar
