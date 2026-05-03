# ADR-003: Zod for Schema Validation

**Status:** Accepted  
**Date:** 2024-01-01

## Context

TypeScript types are erased at runtime. Step inputs and outputs can be any shape at runtime, even if TypeScript thinks they're typed. We need runtime validation at every step boundary.

## Decision

Every `Step` carries `inputSchema` and `outputSchema` as Zod schemas. `BaseStep.execute` validates input before calling `run` and validates output before returning. Validation failures throw `ValidationError` with full Zod issue details.

Zod was chosen over alternatives because:

- It is the only mandatory dependency of `@pravaha/core` (acceptable tradeoff)
- It produces TypeScript types from schemas (`z.infer<typeof Schema>`)
- Error messages are actionable and machine-readable
- It has no runtime dependencies of its own

## Consequences

**Positive:**

- Type safety enforced at runtime, not just compile time
- Validation errors carry structured issue details for debugging
- Schema doubles as documentation for step contracts

**Negative:**

- Zod is a mandatory peer dependency — cannot be avoided
- Validation overhead on every step (acceptable for I/O boundaries)
- Large schemas can be verbose
