import { createRequire } from 'node:module'
import { trace, context, SpanStatusCode } from '@opentelemetry/api'
import type { Tracer, Span } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  BatchSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { Resource } from '@opentelemetry/resources'
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'
import type { PravahaPlugin, Trace, TraceEvent, ExecutionContext } from '@pravaha/core'
import { PravahaError } from '@pravaha/core'

const _require = createRequire(import.meta.url)

/**
 * OTEL exporter type selection
 */
export type OtelExporterType = 'console' | 'otlp'

/**
 * Configuration for OtelPlugin
 */
export interface OtelPluginConfig {
  /**
   * Service name reported to OTEL collector.
   * Default: 'pravaha'
   */
  readonly serviceName?: string

  /**
   * Service version reported to OTEL collector.
   * Default: '0.1.0'
   */
  readonly serviceVersion?: string

  /**
   * Exporter type.
   * - 'console' — logs spans to console. Zero config. Default.
   * - 'otlp' — sends to OTEL collector via HTTP.
   *   Requires @opentelemetry/exporter-trace-otlp-http installed.
   */
  readonly exporter?: OtelExporterType

  /**
   * OTLP collector endpoint.
   * Only used when exporter === 'otlp'.
   * Default: 'http://localhost:4318/v1/traces'
   */
  readonly otlpEndpoint?: string

  /**
   * Additional resource attributes attached to all spans.
   */
  readonly resourceAttributes?: Record<string, string>

  /**
   * Use BatchSpanProcessor instead of SimpleSpanProcessor.
   * Recommended for production (OTLP). Default: true for otlp, false for console.
   */
  readonly batch?: boolean
}

const DEFAULT_SERVICE_NAME = 'pravaha'
const DEFAULT_SERVICE_VERSION = '0.1.0'
const DEFAULT_OTLP_ENDPOINT = 'http://localhost:4318/v1/traces'

/**
 * OpenTelemetry plugin for Pravaha.
 *
 * Exports every pipeline run as an OTEL trace:
 * - Pipeline run → root span
 * - Each step → child span with input/output attributes
 * - Errors → span status ERROR with exception event
 * - Token usage → span attributes
 *
 * Console mode (default — zero config):
 * @example
 * const plugins = new PluginRegistry()
 * plugins.register(new OtelPlugin())
 *
 * OTLP mode (production — requires @opentelemetry/exporter-trace-otlp-http):
 * @example
 * plugins.register(new OtelPlugin({
 *   exporter: 'otlp',
 *   otlpEndpoint: 'http://my-collector:4318/v1/traces',
 *   serviceName: 'my-support-service',
 * }))
 */
export class OtelPlugin implements PravahaPlugin {
  readonly name = 'otel'
  readonly version = '0.1.0'

  private readonly tracer: Tracer
  private readonly provider: BasicTracerProvider
  private readonly activeSpans = new Map<string, Span>()

  constructor(config: OtelPluginConfig = {}) {
    const serviceName = config.serviceName ?? DEFAULT_SERVICE_NAME
    const serviceVersion = config.serviceVersion ?? DEFAULT_SERVICE_VERSION
    const exporterType = config.exporter ?? 'console'
    const useBatch = config.batch ?? exporterType === 'otlp'

    this.provider = new BasicTracerProvider({
      resource: new Resource({
        [SEMRESATTRS_SERVICE_NAME]: serviceName,
        [SEMRESATTRS_SERVICE_VERSION]: serviceVersion,
        ...(config.resourceAttributes ?? {}),
      }),
    })

    const exporter = this.createExporter(exporterType, config.otlpEndpoint)
    const processor = useBatch
      ? new BatchSpanProcessor(exporter)
      : new SimpleSpanProcessor(exporter)

    this.provider.addSpanProcessor(processor)
    this.provider.register()

    this.tracer = trace.getTracer(serviceName, serviceVersion)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private createExporter(type: OtelExporterType, endpoint?: string): any {
    if (type === 'console') {
      return new ConsoleSpanExporter()
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = _require('@opentelemetry/exporter-trace-otlp-http') as any
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      return new mod.OTLPTraceExporter({
        url: endpoint ?? DEFAULT_OTLP_ENDPOINT,
      }) as ConsoleSpanExporter
    } catch {
      console.warn(
        '[Pravaha OtelPlugin] @opentelemetry/exporter-trace-otlp-http is not installed. ' +
          'Falling back to console exporter. ' +
          'Run: pnpm add @opentelemetry/exporter-trace-otlp-http',
      )
      return new ConsoleSpanExporter()
    }
  }

  onPipelineStart(ctx: ExecutionContext): void {
    const span = this.tracer.startSpan(`pipeline:${ctx.pipelineId}`, {
      attributes: {
        'pravaha.pipeline.id': ctx.pipelineId,
        'pravaha.run.id': ctx.runId,
        'pravaha.dry_run': String(ctx.state['dryRun'] ?? false),
      },
    })

    this.activeSpans.set(ctx.runId, span)
  }

  onStepComplete(event: TraceEvent): void {
    const rootSpan = this.activeSpans.get(event.runId)

    const stepSpan = this.tracer.startSpan(
      `step:${event.stepId}`,
      {
        attributes: {
          'pravaha.step.id': event.stepId,
          'pravaha.step.type': event.stepType,
          'pravaha.step.status': event.status,
          'pravaha.step.duration_ms': event.durationMs,
        },
        startTime: event.startedAt,
      },
      rootSpan ? trace.setSpan(context.active(), rootSpan) : undefined,
    )

    const output = event.output as Record<string, unknown> | null
    if (output?.['usage'] && typeof output['usage'] === 'object') {
      const usage = output['usage'] as Record<string, number>
      if (usage['promptTokens']) stepSpan.setAttribute('llm.prompt_tokens', usage['promptTokens'])
      if (usage['completionTokens'])
        stepSpan.setAttribute('llm.completion_tokens', usage['completionTokens'])
      if (usage['totalTokens']) stepSpan.setAttribute('llm.total_tokens', usage['totalTokens'])
    }

    if (typeof output?.['model'] === 'string') {
      stepSpan.setAttribute('llm.model', output['model'])
    }

    if (event.error) {
      stepSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: event.error.message,
      })
      stepSpan.recordException({
        name: event.error.code,
        message: event.error.message,
        ...(event.error.stack !== undefined ? { stack: event.error.stack } : {}),
      })
    } else {
      stepSpan.setStatus({ code: SpanStatusCode.OK })
    }

    stepSpan.end(event.completedAt)
  }

  onPipelineComplete(trace: Trace): void {
    const rootSpan = this.activeSpans.get(trace.runId)
    if (!rootSpan) return

    rootSpan.setAttributes({
      'pravaha.pipeline.status': trace.status,
      'pravaha.pipeline.duration_ms': trace.durationMs,
      'pravaha.pipeline.step_count': trace.events.length,
    })

    if (trace.status === 'failed') {
      rootSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'Pipeline failed' })
    } else {
      rootSpan.setStatus({ code: SpanStatusCode.OK })
    }

    rootSpan.end(trace.completedAt)
    this.activeSpans.delete(trace.runId)
  }

  onError(error: PravahaError, ctx: ExecutionContext): void {
    const rootSpan = this.activeSpans.get(ctx.runId)
    if (!rootSpan) return

    rootSpan.recordException(error)
    rootSpan.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
  }

  /**
   * Flush all pending spans and shut down the provider.
   * Call this before process exit in production.
   */
  async shutdown(): Promise<void> {
    await this.provider.shutdown()
  }
}
