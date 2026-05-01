import chalk from 'chalk'
import type { Trace, TraceEvent } from '@pravaha/core'

/**
 * Compares two traces and renders a diff showing:
 * - Steps present in both (with timing comparison)
 * - Steps only in trace A
 * - Steps only in trace B
 * - Steps with different outcomes
 */
export function renderTraceDiff(traceA: Trace, traceB: Trace): string {
  const lines: string[] = []

  lines.push('')
  lines.push(chalk.bold('─'.repeat(70)))
  lines.push(chalk.bold('  Trace Diff'))
  lines.push(`  ${chalk.cyan('A:')} ${traceA.runId} (${traceA.pipelineName}) — ${traceA.durationMs}ms`)
  lines.push(`  ${chalk.yellow('B:')} ${traceB.runId} (${traceB.pipelineName}) — ${traceB.durationMs}ms`)
  lines.push(chalk.bold('─'.repeat(70)))
  lines.push('')

  const aById = new Map(traceA.events.map((e) => [e.stepId, e]))
  const bById = new Map(traceB.events.map((e) => [e.stepId, e]))
  const allStepIds = new Set([...aById.keys(), ...bById.keys()])

  lines.push(chalk.bold('  Steps:'))
  lines.push('')

  for (const stepId of allStepIds) {
    const aEvent = aById.get(stepId)
    const bEvent = bById.get(stepId)

    if (aEvent && bEvent) {
      lines.push(...renderStepComparison(stepId, aEvent, bEvent))
    } else if (aEvent) {
      lines.push(`  ${chalk.cyan('A only')}  ${chalk.bold(stepId)} — not present in B`)
      lines.push('')
    } else if (bEvent) {
      lines.push(`  ${chalk.yellow('B only')}  ${chalk.bold(stepId)} — not present in A`)
      lines.push('')
    }
  }

  const durationDiff = traceB.durationMs - traceA.durationMs
  const durationSign = durationDiff > 0 ? '+' : ''
  const durationColor = durationDiff > 0 ? chalk.red : chalk.green

  lines.push(chalk.bold('─'.repeat(70)))
  lines.push(`  Total duration: A=${traceA.durationMs}ms  B=${traceB.durationMs}ms  Δ=${durationColor(`${durationSign}${durationDiff}ms`)}`)
  lines.push(chalk.bold('─'.repeat(70)))
  lines.push('')

  return lines.join('\n')
}

function renderStepComparison(stepId: string, a: TraceEvent, b: TraceEvent): string[] {
  const lines: string[] = []
  const statusMatch = a.status === b.status
  const durationDiff = b.durationMs - a.durationMs
  const durationSign = durationDiff > 0 ? '+' : ''
  const durationColor =
    Math.abs(durationDiff) > 100
      ? durationDiff > 0
        ? chalk.red
        : chalk.green
      : chalk.dim

  const statusIndicator = statusMatch ? chalk.dim('=') : chalk.red('≠')

  lines.push(
    `  ${statusIndicator} ${chalk.bold(stepId)}  A:${a.durationMs}ms  B:${b.durationMs}ms  Δ:${durationColor(`${durationSign}${durationDiff}ms`)}`,
  )

  if (!statusMatch) {
    lines.push(`    ${chalk.red(`Status changed: ${a.status} → ${b.status}`)}`)
  }

  if (a.error && !b.error) {
    lines.push(`    ${chalk.green('Error resolved in B')}`)
  } else if (!a.error && b.error) {
    lines.push(`    ${chalk.red(`Error introduced in B: ${b.error.message}`)}`)
  }

  lines.push('')
  return lines
}
