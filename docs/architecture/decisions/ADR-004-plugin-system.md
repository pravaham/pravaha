# ADR-004: Plugin System Design

**Status:** Accepted  
**Date:** 2024-01-01

## Context

Cross-cutting concerns like cost tracking, telemetry, alerting, and audit logging should not pollute pipeline business logic. We need a clean extension mechanism.

## Decision

Pravaha provides a `PravahaPlugin` interface with optional lifecycle hooks:

- `onPipelineStart` — called when a run begins
- `onStepComplete` — called after every step (success or failure)
- `onPipelineComplete` — called when a run finishes
- `onError` — called on any pipeline error

The `PluginRegistry` collects plugins and safely invokes hooks. Plugin errors are caught and logged — they never crash the pipeline. This is a hard guarantee.

Plugins are registered at pipeline construction time and cannot be added to a running pipeline.

## Consequences

**Positive:**

- Cost tracking, observability, alerting — all zero-touch additions
- Pipeline logic is unmodified by cross-cutting concerns
- Plugin failure isolation prevents cascading failures
- Plugins are testable in isolation

**Negative:**

- Plugins cannot alter pipeline execution flow (by design)
- Async plugins slow each step by the hook duration
- Plugin errors are silent (logged only) — requires monitoring
