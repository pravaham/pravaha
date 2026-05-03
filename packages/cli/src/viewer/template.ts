import type { Trace } from '@pravaha/core'

function escHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmt(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

/**
 * Generates a self-contained single-file HTML trace viewer.
 *
 * Zero dependencies — pure HTML, CSS, JavaScript.
 * Can be opened directly in any browser without a server.
 * Can be served by Pravaha serve for live updates.
 *
 * Pipeline names and step IDs are HTML-escaped at generation time.
 * The JSON data blob uses Unicode escapes to prevent script injection.
 */
export function generateTraceViewerHtml(traces: readonly Trace[]): string {
  // Escape < and > in the JSON blob so <script> tags can't break out of the script block
  const tracesJson = JSON.stringify(traces).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')

  // Pre-render sidebar server-side — pipeline names are HTML-escaped here
  const sidebarItems = traces
    .map((trace, i) => {
      const statusClass = trace.status === 'completed' ? 'completed' : 'failed'
      const hasMock = trace.events.some(
        (e) =>
          e.stepType === 'mock' || (e.metadata as Record<string, unknown>)?.['dryRun'] === true,
      )
      return (
        `<div class="trace-item" id="trace-item-${i}" onclick="selectTrace(${i})">` +
        `<div class="pipeline-name">${escHtml(trace.pipelineName)}</div>` +
        `<div class="run-id">${escHtml(trace.runId.slice(0, 16))}&hellip;</div>` +
        `<div class="meta">` +
        `<span class="badge ${statusClass}">${escHtml(trace.status)}</span>` +
        (hasMock ? '<span class="badge mock">dry-run</span>' : '') +
        `<span>${fmt(trace.durationMs)}</span>` +
        `<span>${trace.events.length} steps</span>` +
        `</div>` +
        `</div>`
      )
    })
    .join('\n')

  const statsText = `${traces.length} run${traces.length !== 1 ? 's' : ''}`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pravaha Trace Viewer</title>
  <style>
    :root {
      --bg: #0f1117;
      --surface: #1a1d27;
      --surface2: #242736;
      --border: #2e3347;
      --text: #e2e8f0;
      --text-dim: #64748b;
      --accent: #6366f1;
      --accent-dim: #4f52c4;
      --success: #22c55e;
      --error: #ef4444;
      --warning: #f59e0b;
      --mock: #a855f7;
      --font: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg);
      color: var(--text);
      height: 100vh;
      display: grid;
      grid-template-rows: 48px 1fr;
      grid-template-columns: 300px 1fr 360px;
      grid-template-areas:
        "header header header"
        "sidebar graph detail";
      overflow: hidden;
    }

    header {
      grid-area: header;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      padding: 0 20px;
      gap: 12px;
    }

    header .logo {
      font-weight: 700;
      font-size: 16px;
      color: var(--accent);
      letter-spacing: -0.5px;
    }

    header .subtitle { font-size: 12px; color: var(--text-dim); }
    header .stats { margin-left: auto; font-size: 12px; color: var(--text-dim); }

    #sidebar {
      grid-area: sidebar;
      background: var(--surface);
      border-right: 1px solid var(--border);
      overflow-y: auto;
    }

    .sidebar-section {
      padding: 12px 16px 8px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      border-bottom: 1px solid var(--border);
    }

    .trace-item {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      cursor: pointer;
      transition: background 0.1s;
    }

    .trace-item:hover { background: var(--surface2); }
    .trace-item.selected { background: var(--surface2); border-left: 2px solid var(--accent); }

    .trace-item .pipeline-name {
      font-size: 13px; font-weight: 600; margin-bottom: 4px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    .trace-item .run-id {
      font-size: 11px; color: var(--text-dim); font-family: var(--font); margin-bottom: 4px;
    }

    .trace-item .meta { display: flex; gap: 8px; font-size: 11px; color: var(--text-dim); }

    .badge {
      display: inline-flex; align-items: center; padding: 1px 6px;
      border-radius: 10px; font-size: 10px; font-weight: 600;
    }

    .badge.completed { background: rgba(34,197,94,0.15); color: var(--success); }
    .badge.failed { background: rgba(239,68,68,0.15); color: var(--error); }
    .badge.mock { background: rgba(168,85,247,0.15); color: var(--mock); }

    #graph {
      grid-area: graph;
      overflow: auto; padding: 32px;
      display: flex; flex-direction: column; align-items: center; gap: 0;
    }

    .graph-empty {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; height: 100%; gap: 12px; color: var(--text-dim);
    }

    .graph-empty .icon { font-size: 48px; opacity: 0.3; }

    .step-node { display: flex; flex-direction: column; align-items: center; }

    .step-card {
      width: 280px; background: var(--surface); border: 1px solid var(--border);
      border-radius: 8px; padding: 12px 16px; cursor: pointer;
      transition: border-color 0.15s, box-shadow 0.15s;
    }

    .step-card:hover { border-color: var(--accent-dim); box-shadow: 0 0 0 1px var(--accent-dim); }
    .step-card.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
    .step-card.status-failed { border-color: var(--error); }
    .step-card.status-mock { border-color: var(--mock); }

    .step-card .step-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }

    .step-card .step-icon {
      width: 20px; height: 20px; border-radius: 4px;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; flex-shrink: 0;
    }

    .step-icon.type-transform { background: rgba(99,102,241,0.2); color: var(--accent); }
    .step-icon.type-tool { background: rgba(34,197,94,0.2); color: var(--success); }
    .step-icon.type-llm { background: rgba(245,158,11,0.2); color: var(--warning); }
    .step-icon.type-agent { background: rgba(168,85,247,0.2); color: var(--mock); }
    .step-icon.type-mock { background: rgba(168,85,247,0.1); color: var(--mock); }

    .step-card .step-id {
      font-size: 13px; font-weight: 600; flex: 1;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    .step-card .step-meta { display: flex; gap: 8px; font-size: 11px; color: var(--text-dim); }
    .step-card .step-type { font-family: var(--font); font-size: 10px; color: var(--text-dim); }

    .status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .status-dot.completed { background: var(--success); }
    .status-dot.failed { background: var(--error); }
    .status-dot.skipped { background: var(--text-dim); }

    .connector { width: 2px; height: 24px; background: var(--border); margin: 0 auto; }

    .route-label {
      font-size: 10px; color: var(--text-dim); font-family: var(--font);
      text-align: center; margin: -4px 0; padding: 2px 8px;
      background: var(--bg); border-radius: 4px; z-index: 1;
    }

    #detail {
      grid-area: detail; background: var(--surface);
      border-left: 1px solid var(--border);
      overflow-y: auto; display: flex; flex-direction: column;
    }

    .detail-empty {
      display: flex; align-items: center; justify-content: center;
      height: 100%; color: var(--text-dim); font-size: 13px;
    }

    .detail-section { padding: 14px 16px; border-bottom: 1px solid var(--border); }

    .detail-section h3 {
      font-size: 11px; font-weight: 600; color: var(--text-dim);
      text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px;
    }

    .detail-kv { display: grid; grid-template-columns: 100px 1fr; gap: 4px 8px; font-size: 12px; }
    .detail-kv .key { color: var(--text-dim); }
    .detail-kv .val { font-family: var(--font); word-break: break-all; }

    .json-block {
      background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
      padding: 10px 12px; font-family: var(--font); font-size: 11px;
      white-space: pre-wrap; word-break: break-all; max-height: 200px;
      overflow-y: auto; line-height: 1.5;
    }

    .error-block {
      background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.3);
      border-radius: 6px; padding: 10px 12px; font-family: var(--font);
      font-size: 11px; color: var(--error);
    }

    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  </style>
</head>
<body>

<header>
  <div class="logo">Pravaha</div>
  <div class="subtitle">Trace Viewer</div>
  <div class="stats">${escHtml(statsText)}</div>
</header>

<div id="sidebar">
  <div class="sidebar-section">Pipeline Runs</div>
  <div id="trace-list">${sidebarItems}</div>
</div>

<div id="graph">
  <div class="graph-empty">
    <div class="icon">*</div>
    <div>Select a run to inspect</div>
  </div>
</div>

<div id="detail">
  <div class="detail-empty">Select a step to inspect</div>
</div>

<script>
  const TRACES = ${tracesJson};

  let selectedTraceIndex = -1;
  let selectedEvent = null;

  function fmt(ms) {
    if (ms < 1000) return ms + 'ms';
    return (ms / 1000).toFixed(1) + 's';
  }

  function fmtDate(ts) {
    return new Date(ts).toLocaleString();
  }

  function fmtJson(val) {
    try { return JSON.stringify(val, null, 2); }
    catch { return String(val); }
  }

  function stepIcon(type) {
    if (type === 'tool') return 'T';
    if (type.startsWith('llm')) return 'L';
    if (type === 'agent') return 'A';
    if (type === 'mock') return 'M';
    return 'S';
  }

  function stepIconClass(type) {
    if (type === 'tool') return 'type-tool';
    if (type.startsWith('llm')) return 'type-llm';
    if (type === 'agent') return 'type-agent';
    if (type === 'mock') return 'type-mock';
    return 'type-transform';
  }

  function isMock(event) {
    return event.stepType === 'mock' || (event.metadata && event.metadata.dryRun === true);
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function updateSidebarSelection() {
    const items = document.querySelectorAll('.trace-item');
    items.forEach(function(item, i) {
      if (i === selectedTraceIndex) {
        item.classList.add('selected');
      } else {
        item.classList.remove('selected');
      }
    });
  }

  function renderGraph() {
    const graph = document.getElementById('graph');
    const selectedTrace = selectedTraceIndex >= 0 ? TRACES[selectedTraceIndex] : null;

    if (!selectedTrace) {
      graph.innerHTML = '<div class="graph-empty"><div class="icon">*</div><div>Select a run to inspect</div></div>';
      return;
    }

    const events = selectedTrace.events;
    if (events.length === 0) {
      graph.innerHTML = '<div class="graph-empty"><div>No steps recorded</div></div>';
      return;
    }

    const nodes = events.map(function(event, i) {
      const isSelected = selectedEvent && selectedEvent.id === event.id;
      const isMockStep = isMock(event);
      const routeReason = event.metadata && event.metadata.routeReason;
      const isLast = i === events.length - 1;

      const cardClasses = ['step-card', 'status-' + event.status, isSelected ? 'selected' : '', isMockStep ? 'status-mock' : ''].filter(Boolean).join(' ');

      return '<div class="step-node">' +
        '<div class="' + cardClasses + '" onclick="selectEvent(\'' + event.id + '\')">' +
          '<div class="step-header">' +
            '<div class="step-icon ' + stepIconClass(event.stepType) + '">' + stepIcon(event.stepType) + '</div>' +
            '<div class="step-id">' + escHtml(event.stepId) + '</div>' +
            '<div class="status-dot ' + event.status + '"></div>' +
          '</div>' +
          '<div class="step-meta">' +
            '<span class="step-type">' + event.stepType + '</span>' +
            '<span>' + fmt(event.durationMs) + '</span>' +
            (isMockStep ? '<span style="color:var(--mock)">mock</span>' : '') +
          '</div>' +
        '</div>' +
        (!isLast ? '<div class="connector"></div>' +
          (routeReason ? '<div class="route-label">' + escHtml(String(routeReason)) + '</div><div class="connector"></div>' : '')
          : '') +
      '</div>';
    }).join('');

    graph.innerHTML = nodes;
  }

  function renderDetail() {
    const detail = document.getElementById('detail');

    if (!selectedEvent) {
      detail.innerHTML = '<div class="detail-empty">Select a step to inspect</div>';
      return;
    }

    const e = selectedEvent;

    let usageHtml = '';
    const output = e.output;
    if (output && typeof output === 'object' && output.usage) {
      const u = output.usage;
      usageHtml = '<div class="detail-section"><h3>Token Usage</h3><div class="detail-kv">' +
        '<span class="key">Prompt</span><span class="val">' + (u.promptTokens || 0) + '</span>' +
        '<span class="key">Completion</span><span class="val">' + (u.completionTokens || 0) + '</span>' +
        '<span class="key">Total</span><span class="val">' + (u.totalTokens || 0) + '</span>' +
        '</div></div>';
    }

    const metaKeys = e.metadata ? Object.keys(e.metadata) : [];

    detail.innerHTML =
      '<div class="detail-section"><h3>Step</h3><div class="detail-kv">' +
        '<span class="key">ID</span><span class="val">' + escHtml(e.stepId) + '</span>' +
        '<span class="key">Type</span><span class="val">' + escHtml(e.stepType) + '</span>' +
        '<span class="key">Status</span><span class="val">' + e.status + '</span>' +
        '<span class="key">Duration</span><span class="val">' + fmt(e.durationMs) + '</span>' +
        '<span class="key">Started</span><span class="val">' + fmtDate(e.startedAt) + '</span>' +
      '</div></div>' +
      (e.error ? '<div class="detail-section"><h3>Error</h3><div class="error-block"><div><strong>' + escHtml(e.error.code) + '</strong></div><div>' + escHtml(e.error.message) + '</div></div></div>' : '') +
      '<div class="detail-section"><h3>Input</h3><div class="json-block">' + escHtml(fmtJson(e.input)) + '</div></div>' +
      '<div class="detail-section"><h3>Output</h3><div class="json-block">' + escHtml(fmtJson(e.output)) + '</div></div>' +
      usageHtml +
      (metaKeys.length > 0 ? '<div class="detail-section"><h3>Metadata</h3><div class="json-block">' + escHtml(fmtJson(e.metadata)) + '</div></div>' : '');
  }

  function selectTrace(index) {
    selectedTraceIndex = index;
    selectedEvent = null;
    updateSidebarSelection();
    renderGraph();
    renderDetail();
  }

  function selectEvent(eventId) {
    const selectedTrace = selectedTraceIndex >= 0 ? TRACES[selectedTraceIndex] : null;
    if (!selectedTrace) return;
    selectedEvent = null;
    for (let i = 0; i < selectedTrace.events.length; i++) {
      if (selectedTrace.events[i].id === eventId) {
        selectedEvent = selectedTrace.events[i];
        break;
      }
    }
    renderGraph();
    renderDetail();
  }

  if (TRACES.length > 0) {
    selectTrace(0);
  }
</script>
</body>
</html>`
}
