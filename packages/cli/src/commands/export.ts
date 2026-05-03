import { Command } from 'commander'
import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'
import { exec } from 'node:child_process'
import { FsTraceStore } from '@pravaha/adapter-trace-fs'
import type { Trace } from '@pravaha/core'
import { generateTraceViewerHtml } from '../viewer/template.js'
import chalk from 'chalk'

export function buildExportCommand(): Command {
  const exportCmd = new Command('export')
  exportCmd.description('Export trace data as a standalone HTML report')

  exportCmd
    .command('html')
    .description('Export all traces as a self-contained HTML file')
    .option('-o, --output <path>', 'Output file path', 'pravaha-traces.html')
    .option('-p, --pipeline <id>', 'Export traces for a specific pipeline only')
    .option('-l, --limit <n>', 'Maximum traces per pipeline', '50')
    .option('-d, --dir <path>', 'Trace directory', '.pravaha/traces')
    .action(async (options: { output: string; pipeline?: string; limit: string; dir: string }) => {
      const store = new FsTraceStore({ traceDir: options.dir })
      const limit = parseInt(options.limit, 10)

      const pipelineIds = options.pipeline ? [options.pipeline] : await store.listPipelines()

      if (pipelineIds.length === 0) {
        console.log(chalk.dim('\n  No traces found. Run a pipeline first.\n'))
        return
      }

      const allTraces: Trace[] = []
      for (const pid of pipelineIds) {
        const traces = await store.getByPipelineId(pid, limit)
        allTraces.push(...traces)
      }

      allTraces.sort((a, b) => b.startedAt - a.startedAt)

      const html = generateTraceViewerHtml(allTraces)
      const outputPath = resolve(options.output)
      await fs.writeFile(outputPath, html, 'utf-8')

      console.log('')
      console.log(chalk.bold('  Pravaha Trace Export'))
      console.log('')
      console.log(
        `  ${chalk.green('v')} Exported ${allTraces.length} trace${allTraces.length !== 1 ? 's' : ''}`,
      )
      console.log(`  ${chalk.dim('File:')} ${chalk.cyan(outputPath)}`)
      console.log('')
      console.log(chalk.dim('  Open the file in any browser — no server required.'))
      console.log('')

      openBrowser(outputPath)
    })

  return exportCmd
}

function openBrowser(filePath: string): void {
  const { platform } = process

  const url = platform === 'win32' ? filePath : `file://${filePath}`
  const command =
    platform === 'win32'
      ? `start "" "${url}"`
      : platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`

  exec(command, () => {
    /* non-critical */
  })
}
