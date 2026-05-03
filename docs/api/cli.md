# @pravaha/cli

The Pravaha CLI — inspect, visualise, and debug pipeline traces.

```bash
pnpm add -D @pravaha/cli
# or use without installing:
npx pravaha <command>
```

---

## Commands

### `pravaha trace list`

List all saved traces, ordered most recent first.

```bash
npx pravaha trace list
npx pravaha trace list --trace-dir ./my-traces
```

**Output:**

```
RUN ID                               PIPELINE              STATUS     DURATION
3f8a4b2c-1234-5678-abcd-ef0123456789  Support Ticket Triage  completed  142ms
7c9d3e1a-5678-1234-ef01-abcd23456789  Support Ticket Triage  completed   98ms
1a2b3c4d-abcd-efgh-ijkl-mnopqrstuvwx  Support Ticket Triage  failed      23ms
```

**Options:**

| Flag          | Default           | Description                      |
| ------------- | ----------------- | -------------------------------- |
| `--trace-dir` | `.pravaha/traces` | Directory containing trace files |

---

### `pravaha trace show <runId>`

Print a full trace to the terminal in a readable format.

```bash
npx pravaha trace show 3f8a4b2c-1234-5678-abcd-ef0123456789
npx pravaha trace show 3f8a4b2c-1234-5678-abcd-ef0123456789 --trace-dir ./my-traces
```

**Output includes:**

- Pipeline name, status, duration
- Each step with its input, output, duration, and routing decision
- Error details if any step failed

---

### `pravaha serve`

Start the visual trace viewer at `http://localhost:4321`.

```bash
npx pravaha serve
npx pravaha serve --port 8080
npx pravaha serve --trace-dir ./my-traces
```

**Options:**

| Flag          | Default           | Description                   |
| ------------- | ----------------- | ----------------------------- |
| `--port`      | `4321`            | Port to listen on             |
| `--trace-dir` | `.pravaha/traces` | Directory to read traces from |

Opens a web UI that shows:

- List of all saved traces
- Interactive timeline for each trace
- Step-by-step input/output inspection
- Diff view between step input and output

See [Trace Viewer](/guide/trace-viewer) for a full walkthrough.

---

### `pravaha export <runId>`

Export a trace to a file.

```bash
npx pravaha export 3f8a4b2c-1234-5678-abcd-ef0123456789
npx pravaha export 3f8a4b2c-1234-5678-abcd-ef0123456789 --format csv
npx pravaha export 3f8a4b2c-1234-5678-abcd-ef0123456789 --output ./my-trace.json
```

**Options:**

| Flag          | Default           | Description                    |
| ------------- | ----------------- | ------------------------------ |
| `--format`    | `json`            | Output format: `json` or `csv` |
| `--output`    | stdout            | Output file path               |
| `--trace-dir` | `.pravaha/traces` | Directory to read from         |

---

## Setup

For the CLI to find traces, you must configure a `FsTraceStore` in your pipeline:

```typescript
import { FsTraceStore } from '@pravaha/adapter-trace-fs'

const traceStore = new FsTraceStore({
  traceDir: '.pravaha/traces',  // must match --trace-dir flag
})

const pipeline = new PipelineBuilder({ ... }, plugins, traceStore)
  .step(...)
  .build()
```

Add `.pravaha/` to your `.gitignore`:

```
.pravaha/
```

---

## Global Flags

| Flag        | Description                |
| ----------- | -------------------------- |
| `--version` | Print CLI version          |
| `--help`    | Print help for any command |

```bash
npx pravaha --version
npx pravaha trace --help
npx pravaha serve --help
```
