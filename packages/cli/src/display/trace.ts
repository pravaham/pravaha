import chalk from 'chalk'
import type { Trace, TraceEvent } from '@pravaha/core'

const STATUS_COLORS = {
  completed: chalk.green,
  failed: chalk.red,
  running: chalk.yellow,
  pending: chalk.gray,
  skipped: chalk.dim,
} as const

/**
 * Renders a full trace to terminal output.
 * Designed for readability at a glance.
 */
export function renderTrace(trace: Trace): string {
  const lines: string[] = []

  lines.push('')
  lines.push(chalk.bold('─'.repeat(60)))
  lines.push(chalk.bold(`  Pipeline: ${trace.pipelineName}`))
  lines.push(`  Run ID:   ${chalk.cyan(trace.runId)}`)
  lines.push(`  Status:   ${STATUS_COLORS[trace.status](trace.status.toUpperCase())}`)
  lines.push(`  Duration: ${chalk.yellow(`${trace.durationMs}ms`)}`)
  lines.push(`  Steps:    ${trace.events.length}`)
  lines.push(`  Started:  ${new Date(trace.startedAt).toISOString()}`)
  if (Object.keys(trace.metadata).length > 0) {
    lines.push(`  Metadata: ${JSON.stringify(trace.metadata)}`)
  }
  lines.push(chalk.bold('─'.repeat(60)))
  lines.push('')

  if (trace.events.length === 0) {
    lines.push(chalk.dim('  No steps recorded.'))
  } else {
    lines.push(chalk.bold('  Steps:'))
    lines.push('')
    trace.events.forEach((event, i) => {
      lines.push(renderTraceEvent(event, i + 1))
    })
  }

  lines.push(chalk.bold('─'.repeat(60)))
  lines.push('')

  return lines.join('\n')
}

function renderTraceEvent(event: TraceEvent, index: number): string {
  const lines: string[] = []
  const statusColor = STATUS_COLORS[event.status]
  const statusIcon = event.status === 'completed' ? '✓' : event.status === 'failed' ? '✗' : '○'

  lines.push(
    `  ${chalk.dim(`${index}.`)} ${statusColor(statusIcon)} ${chalk.bold(event.stepId)} ${chalk.dim(`[${event.stepType}]`)} ${chalk.yellow(`${event.durationMs}ms`)}`,
  )

  if (event.metadata['routeReason']) {
    lines.push(`     ${chalk.dim('→')} ${chalk.dim(String(event.metadata['routeReason']))}`)
  }

  if (event.error) {
    lines.push(`     ${chalk.red('Error:')} ${event.error.message}`)
    lines.push(`     ${chalk.red('Code:')}  ${event.error.code}`)
  }

  if (event.metadata['dryRun'] === true || event.stepType === 'mock') {
    lines.push(`     ${chalk.magenta('[MOCK]')}`)
  }

  lines.push('')
  return lines.join('\n')
}

/**
 * Renders a compact one-line summary of a trace for list view.
 */
export function renderTraceSummary(trace: Trace, index: number): string {
  const statusColor = STATUS_COLORS[trace.status]
  const date = new Date(trace.startedAt).toISOString().replace('T', ' ').slice(0, 19)

  return [
    chalk.dim(`${index}.`),
    statusColor(trace.status === 'completed' ? '✓' : '✗'),
    chalk.cyan(trace.runId.slice(0, 8) + '...'),
    chalk.dim(date),
    chalk.yellow(`${trace.durationMs}ms`),
    chalk.dim(`${trace.events.length} steps`),
  ].join('  ')
}
