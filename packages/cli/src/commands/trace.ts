import { Command } from 'commander'
import { FsTraceStore } from '@pravaha/adapter-trace-fs'
import { renderTrace, renderTraceSummary } from '../display/trace.js'
import { renderTraceDiff } from '../display/diff.js'
import chalk from 'chalk'

export function buildTraceCommand(): Command {
  const trace = new Command('trace')
  trace.description('Inspect Pravaha pipeline traces')

  // Pravaha trace list
  trace
    .command('list')
    .description('List recent pipeline traces')
    .option('-p, --pipeline <id>', 'Filter by pipeline ID')
    .option('-l, --limit <n>', 'Maximum number of traces to show', '20')
    .option('-d, --dir <path>', 'Trace directory', '.pravaha/traces')
    .action(async (options: { pipeline?: string; limit: string; dir: string }) => {
      const store = new FsTraceStore({ traceDir: options.dir })
      const limit = parseInt(options.limit, 10)

      if (options.pipeline) {
        const traces = await store.getByPipelineId(options.pipeline, limit)
        if (traces.length === 0) {
          console.log(chalk.dim(`No traces found for pipeline '${options.pipeline}'`))
          return
        }
        console.log(chalk.bold(`\n  Traces for pipeline: ${options.pipeline}\n`))
        traces.forEach((t, i) => console.log(renderTraceSummary(t, i + 1)))
      } else {
        const pipelines = await store.listPipelines()
        if (pipelines.length === 0) {
          console.log(chalk.dim('\n  No traces found. Run a pipeline first.\n'))
          return
        }

        for (const pipelineId of pipelines) {
          const traces = await store.getByPipelineId(pipelineId, limit)
          console.log(chalk.bold(`\n  Pipeline: ${pipelineId}`))
          traces.forEach((t, i) => console.log(renderTraceSummary(t, i + 1)))
        }
      }
      console.log('')
    })

  // Pravaha trace show <runId>
  trace
    .command('show <runId>')
    .description('Show detailed trace for a run')
    .option('-d, --dir <path>', 'Trace directory', '.pravaha/traces')
    .action(async (runId: string, options: { dir: string }) => {
      const store = new FsTraceStore({ traceDir: options.dir })
      const traceResult = await store.getByRunId(runId)

      if (!traceResult) {
        console.error(chalk.red(`\n  Trace not found: ${runId}\n`))
        process.exit(1)
      }

      console.log(renderTrace(traceResult))
    })

  // Pravaha trace diff <runIdA> <runIdB>
  trace
    .command('diff <runIdA> <runIdB>')
    .description('Compare two pipeline traces')
    .option('-d, --dir <path>', 'Trace directory', '.pravaha/traces')
    .action(async (runIdA: string, runIdB: string, options: { dir: string }) => {
      const store = new FsTraceStore({ traceDir: options.dir })

      const [traceA, traceB] = await Promise.all([
        store.getByRunId(runIdA),
        store.getByRunId(runIdB),
      ])

      if (!traceA) {
        console.error(chalk.red(`\n  Trace not found: ${runIdA}\n`))
        process.exit(1)
      }
      if (!traceB) {
        console.error(chalk.red(`\n  Trace not found: ${runIdB}\n`))
        process.exit(1)
      }

      console.log(renderTraceDiff(traceA, traceB))
    })

  return trace
}
