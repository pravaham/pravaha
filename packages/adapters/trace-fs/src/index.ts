import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { MemoryError } from '@pravaha/core'
import type { Trace, TraceStore } from '@pravaha/core'
import type { PravahaId } from '@pravaha/core'

export interface FsTraceStoreConfig {
  /**
   * Directory where trace JSON files will be stored.
   * Will be created if it does not exist.
   * Default: '.pravaha/traces' relative to process.cwd()
   */
  readonly traceDir?: string
  /**
   * Maximum number of trace files to retain per pipeline.
   * Oldest traces are deleted when limit is exceeded.
   * Default: 100. Set to 0 for unlimited.
   */
  readonly maxTracesPerPipeline?: number
}

const DEFAULT_TRACE_DIR = '.pravaha/traces'
const DEFAULT_MAX_TRACES = 100

/**
 * File-system backed TraceStore.
 *
 * Stores each trace as a JSON file: `{traceDir}/{pipelineId}/{runId}.json`
 * Enables trace inspection across process restarts via the CLI.
 *
 * @example
 * const traceStore = new FsTraceStore({ traceDir: '.pravaha/traces' })
 *
 * const pipeline = new PipelineBuilder({ ... }, plugins, traceStore)
 *   .step(...)
 *   .build()
 *
 * // After running, inspect with:
 * // npx pravaha trace show <runId>
 */
export class FsTraceStore implements TraceStore {
  private readonly traceDir: string
  private readonly maxTracesPerPipeline: number

  constructor(config: FsTraceStoreConfig = {}) {
    this.traceDir = resolve(config.traceDir ?? DEFAULT_TRACE_DIR)
    this.maxTracesPerPipeline = config.maxTracesPerPipeline ?? DEFAULT_MAX_TRACES
  }

  private pipelineDir(pipelineId: PravahaId): string {
    return join(this.traceDir, pipelineId)
  }

  private tracePath(pipelineId: PravahaId, runId: PravahaId): string {
    return join(this.pipelineDir(pipelineId), `${runId}.json`)
  }

  async save(trace: Trace): Promise<void> {
    try {
      const dir = this.pipelineDir(trace.pipelineId)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(
        this.tracePath(trace.pipelineId, trace.runId),
        JSON.stringify(trace, null, 2),
        'utf-8',
      )
      await this.enforceRetentionLimit(trace.pipelineId)
    } catch (err) {
      throw new MemoryError(
        `Failed to save trace '${trace.runId}': ${err instanceof Error ? err.message : String(err)}`,
        err,
      )
    }
  }

  async getByRunId(runId: PravahaId): Promise<Trace | null> {
    try {
      const pipelineDirs = await this.listPipelineDirs()
      for (const pipelineId of pipelineDirs) {
        const path = this.tracePath(pipelineId, runId)
        try {
          const content = await fs.readFile(path, 'utf-8')
          return JSON.parse(content) as Trace
        } catch {
          // Not in this pipeline dir — continue
        }
      }
      return null
    } catch (err) {
      throw new MemoryError(
        `Failed to get trace '${runId}': ${err instanceof Error ? err.message : String(err)}`,
        err,
      )
    }
  }

  async getByPipelineId(pipelineId: PravahaId, limit = 20): Promise<readonly Trace[]> {
    try {
      const dir = this.pipelineDir(pipelineId)
      let files: string[]

      try {
        files = await fs.readdir(dir)
      } catch {
        return []
      }

      const jsonFiles = files
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, limit)

      const traces: Trace[] = []
      for (const file of jsonFiles) {
        try {
          const content = await fs.readFile(join(dir, file), 'utf-8')
          traces.push(JSON.parse(content) as Trace)
        } catch {
          // Skip corrupted trace files
        }
      }

      return traces
    } catch (err) {
      throw new MemoryError(
        `Failed to list traces for pipeline '${pipelineId}': ${err instanceof Error ? err.message : String(err)}`,
        err,
      )
    }
  }

  /**
   * List all pipeline IDs that have stored traces.
   */
  async listPipelines(): Promise<readonly string[]> {
    return this.listPipelineDirs()
  }

  /**
   * Delete all traces for a pipeline.
   */
  async clearPipeline(pipelineId: PravahaId): Promise<void> {
    try {
      await fs.rm(this.pipelineDir(pipelineId), { recursive: true, force: true })
    } catch (err) {
      throw new MemoryError(
        `Failed to clear traces for pipeline '${pipelineId}': ${err instanceof Error ? err.message : String(err)}`,
        err,
      )
    }
  }

  private async listPipelineDirs(): Promise<string[]> {
    try {
      await fs.mkdir(this.traceDir, { recursive: true })
      const entries = await fs.readdir(this.traceDir, { withFileTypes: true })
      return entries.filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      return []
    }
  }

  private async enforceRetentionLimit(pipelineId: PravahaId): Promise<void> {
    if (this.maxTracesPerPipeline === 0) return

    try {
      const dir = this.pipelineDir(pipelineId)
      const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json')).sort()

      if (files.length > this.maxTracesPerPipeline) {
        const toDelete = files.slice(0, files.length - this.maxTracesPerPipeline)
        await Promise.all(toDelete.map((f) => fs.unlink(join(dir, f))))
      }
    } catch {
      // Non-critical — don't throw on retention failures
    }
  }
}
