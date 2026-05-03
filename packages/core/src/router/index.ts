import type { ExecutionContext } from '../context/index.js'
import type { PravahaId } from '../types/index.js'
import { RouterError } from '../errors/index.js'

/** Route decision returned by a Router */
export interface RouteDecision {
  /** ID of the next step to execute */
  readonly nextStepId: PravahaId | null
  /** Human-readable reason for this routing decision — appears in trace */
  readonly reason: string
}

/**
 * Router interface — determines the next step based on current output and context.
 *
 * Routers are what make pipelines conditional and dynamic.
 * A null nextStepId signals pipeline completion.
 */
export interface Router<TOutput = unknown> {
  readonly id: PravahaId
  readonly name: string
  route(output: TOutput, context: ExecutionContext): RouteDecision | Promise<RouteDecision>
}

/** Simple conditional router — routes based on a predicate map */
export class ConditionalRouter<TOutput> implements Router<TOutput> {
  readonly id: PravahaId
  readonly name: string

  constructor(
    id: PravahaId,
    name: string,
    private readonly routes: ReadonlyArray<{
      readonly condition: (output: TOutput, context: ExecutionContext) => boolean
      readonly nextStepId: PravahaId | null
      readonly reason: string
    }>,
    private readonly fallback?: PravahaId | null,
  ) {
    this.id = id
    this.name = name
  }

  route(output: TOutput, context: ExecutionContext): RouteDecision {
    for (const route of this.routes) {
      if (route.condition(output, context)) {
        return { nextStepId: route.nextStepId, reason: route.reason }
      }
    }

    if (this.fallback !== undefined) {
      return { nextStepId: this.fallback, reason: 'Fallback route' }
    }

    throw new RouterError(this.id, `No matching route for output: ${JSON.stringify(output)}`)
  }
}

/** Linear router — always goes to next step in sequence */
export class LinearRouter implements Router {
  readonly id: PravahaId
  readonly name: string

  constructor(
    id: PravahaId,
    private readonly nextStepId: PravahaId | null,
  ) {
    this.id = id
    this.name = `linear-to-${nextStepId ?? 'end'}`
  }

  route(): RouteDecision {
    return {
      nextStepId: this.nextStepId,
      reason: this.nextStepId ? `Continue to step '${this.nextStepId}'` : 'Pipeline complete',
    }
  }
}
