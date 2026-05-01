import type { Trace, TraceEvent } from '../trace/index.js'
import type { ExecutionContext } from '../context/index.js'
import type { PravahaError } from '../errors/index.js'

/**
 * Plugin lifecycle hooks.
 * All hooks are optional — implement only what you need.
 *
 * Plugins are the extension point for cross-cutting concerns:
 * cost tracking, telemetry, logging, alerting, etc.
 *
 * IMPORTANT: Plugins must never throw — errors in plugins
 * must not affect pipeline execution.
 */
export interface PravahaPlugin {
  /** Unique plugin name */
  readonly name: string
  /** Semver version string */
  readonly version: string

  /** Called when a pipeline run begins */
  onPipelineStart?(context: ExecutionContext): void | Promise<void>

  /** Called when a single step completes (success or failure) */
  onStepComplete?(event: TraceEvent): void | Promise<void>

  /** Called when an entire pipeline run completes */
  onPipelineComplete?(trace: Trace): void | Promise<void>

  /** Called when any error occurs during execution */
  onError?(error: PravahaError, context: ExecutionContext): void | Promise<void>
}

/**
 * Plugin registry — manages plugin lifecycle and safe invocation.
 * Uses overloaded emit signatures to enforce correct argument types at call sites.
 */
export class PluginRegistry {
  private readonly plugins: PravahaPlugin[] = []

  register(plugin: PravahaPlugin): void {
    if (this.plugins.some((p) => p.name === plugin.name)) {
      throw new Error(`Plugin '${plugin.name}' is already registered`)
    }
    this.plugins.push(plugin)
  }

  async emit(hook: 'onPipelineStart', context: ExecutionContext): Promise<void>
  async emit(hook: 'onStepComplete', event: TraceEvent): Promise<void>
  async emit(hook: 'onPipelineComplete', trace: Trace): Promise<void>
  async emit(hook: 'onError', error: PravahaError, context: ExecutionContext): Promise<void>
  async emit(hook: string, ...args: unknown[]): Promise<void> {
    for (const plugin of this.plugins) {
      const fn: unknown = (plugin as unknown as Record<string, unknown>)[hook]
      if (typeof fn !== 'function') continue
      try {
        const callable = fn as (...a: unknown[]) => unknown
        await Promise.resolve(callable.call(plugin, ...args))
      } catch (err) {
        // Plugin errors must never crash the pipeline
        console.error(`[Pravaha] Plugin '${plugin.name}' threw in hook '${hook}':`, err)
      }
    }
  }

  get registered(): readonly PravahaPlugin[] {
    return [...this.plugins]
  }
}
