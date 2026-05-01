import { Command } from 'commander'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { exec } from 'node:child_process'
import { FsTraceStore } from '@pravaha/adapter-trace-fs'
import type { Trace } from '@pravaha/core'
import { generateTraceViewerHtml } from '../viewer/template.js'
import chalk from 'chalk'

export function buildServeCommand(): Command {
  return new Command('serve')
    .description('Start local trace viewer server with live reload')
    .option('-p, --port <n>', 'Port to listen on', '4000')
    .option('-d, --dir <path>', 'Trace directory', '.pravaha/traces')
    .action(async (options: { port: string; dir: string }) => {
      const port = parseInt(options.port, 10)
      const store = new FsTraceStore({ traceDir: options.dir })

      const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        const allTraces: Trace[] = []
        const pipelines = await store.listPipelines()
        for (const pid of pipelines) {
          const traces = await store.getByPipelineId(pid, 50)
          allTraces.push(...traces)
        }
        allTraces.sort((a, b) => b.startedAt - a.startedAt)

        if (req.url === '/traces' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(allTraces))
          return
        }

        const html = generateTraceViewerHtml(allTraces)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html)
      })

      server.listen(port, () => {
        console.log('')
        console.log(chalk.bold('  Pravaha Trace Viewer'))
        console.log('')
        console.log(`  ${chalk.dim('Local:')}   ${chalk.cyan(`http://localhost:${port}`)}`)
        console.log(`  ${chalk.dim('Traces:')}  ${options.dir}`)
        console.log('')
        console.log(chalk.dim('  Watching for new traces. Refresh browser to update.'))
        console.log(chalk.dim('  Press Ctrl+C to stop.'))
        console.log('')

        openBrowser(`http://localhost:${port}`)
      })
    })
}

function openBrowser(url: string): void {
  const { platform } = process

  const command =
    platform === 'win32' ? `start "" "${url}"` :
    platform === 'darwin' ? `open "${url}"` :
    `xdg-open "${url}"`

  exec(command, () => { /* non-critical */ })
}
