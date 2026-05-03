# Trace Viewer

The Pravaha CLI includes a visual trace viewer — a local web UI that lets you explore pipeline traces without writing any code.

## Starting the Viewer

```bash
npx pravaha serve
```

This starts a local server at `http://localhost:4321` (by default) and opens the trace viewer in your browser.

The viewer reads traces from the directory you configured in your `FsTraceStore`. By default it looks for `.pravaha/traces/` in the current directory.

```bash
# Custom port
npx pravaha serve --port 8080

# Custom trace directory
npx pravaha serve --trace-dir ./my-traces
```

## What the Viewer Shows

The viewer displays each trace as an interactive timeline:

- **Pipeline overview** — run ID, status (completed / failed), total duration, step count
- **Step timeline** — each step as a bar, scaled to its duration relative to the total
- **Step detail** — click any step to expand it and see its full input, output, error, and routing metadata
- **Diff view** — compare the input and output of any step side-by-side

### Reading the timeline

Steps appear in execution order from top to bottom. A green bar means the step completed successfully; a red bar means it failed. The width of the bar is proportional to the step's duration.

The arrow at the end of each step shows where the router sent execution next, and the reason the router gave.

## CLI Commands

### List traces

```bash
npx pravaha trace list
```

Prints a table of all saved traces, ordered by most recent first:

```
RUN ID                               PIPELINE              STATUS     DURATION
3f8a4b2c-1234-5678-abcd-ef0123456789  Support Ticket Triage  completed  142ms
7c9d3e1a-...                          Support Ticket Triage  completed   98ms
1a2b3c4d-...                          Support Ticket Triage  failed      23ms
```

### Show a specific trace

```bash
npx pravaha trace show <runId>
```

Prints the full trace to the terminal in a readable format, including each step's input and output.

```bash
npx pravaha trace show 3f8a4b2c-1234-5678-abcd-ef0123456789
```

### Export a trace

```bash
npx pravaha export <runId> --format json
npx pravaha export <runId> --format csv
```

Exports the trace to a file for analysis in external tools.

## Using the Trace Viewer in Development

A typical development workflow:

1. Add an `FsTraceStore` to your pipeline (one line of code)
2. Run your pipeline with test inputs
3. Open `npx pravaha serve` to inspect what happened
4. Adjust your prompts, schemas, or routing logic
5. Run again and compare traces

This replaces the cycle of adding `console.log` statements and re-running. Instead of guessing what the LLM received or why a route was taken, you see the exact inputs and outputs in a structured UI.

## Setting Up Trace Storage

To use the viewer, your pipeline must have a `FsTraceStore` attached:

```bash
pnpm add @pravaha/adapter-trace-fs
```

```typescript
import { FsTraceStore } from '@pravaha/adapter-trace-fs'
import { PipelineBuilder, PluginRegistry } from '@pravaha/core'

const traceStore = new FsTraceStore({
  traceDir: '.pravaha/traces',
})

const pipeline = new PipelineBuilder(
  { id: 'my-pipeline', name: 'My Pipeline', version: '1.0.0' },
  new PluginRegistry(),
  traceStore,
)
  .step(...)
  .build()
```

Add `.pravaha/` to your `.gitignore` so traces don't end up in version control:

```
# .gitignore
.pravaha/
```

## Sharing a Run ID

Every pipeline run produces a unique `runId`. When something goes wrong in production, you can log the `runId` alongside your application logs, then use it to pull up the exact trace:

```typescript
const result = await pipeline.run(ticket)
logger.info({ runId: result.trace.runId, ticketId: ticket.id }, 'Pipeline completed')
```

Later:

```bash
npx pravaha trace show <runId-from-logs>
```
