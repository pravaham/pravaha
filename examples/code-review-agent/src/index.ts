/**
 * Code Review Agent Pipeline
 *
 * Pattern: Takes a code diff → agent reviews it using analysis tools → structured review
 *
 * Production use case: Automated PR review, security scanning,
 * code quality enforcement. Integrates with GitHub/GitLab webhooks.
 */

import { z } from 'zod'
import {
  AgentStep,
  defineAgentOutputParser,
  TransformStep,
  PipelineBuilder,
  LinearRouter,
  withRetry,
  LLMRateLimitError,
  LLMTimeoutError,
} from '@pravaha/core'
import type { ToolDefinition } from '@pravaha/core'
import { FsTraceStore } from '@pravaha/adapter-trace-fs'

// ─── Schemas ─────────────────────────────────────────────────────────────────

const DiffSchema = z.object({
  pr: z.string(),
  title: z.string(),
  diff: z.string(),
  author: z.string(),
})

const ReviewSchema = z.object({
  verdict: z.enum(['approve', 'request_changes', 'comment']),
  summary: z.string(),
  issues: z.array(
    z.object({
      severity: z.enum(['critical', 'major', 'minor', 'suggestion']),
      description: z.string(),
      line: z.string().optional(),
    }),
  ),
  positives: z.array(z.string()),
  score: z.number().min(0).max(10),
})

type Diff = z.infer<typeof DiffSchema>
type Review = z.infer<typeof ReviewSchema>

// ─── Tools ───────────────────────────────────────────────────────────────────

type ComplexityInput = { code: string }
type ComplexityOutput = {
  cyclomaticComplexity: number
  cognitiveComplexity: number
  recommendation: string
}

const analyzeComplexityTool: ToolDefinition<ComplexityInput, ComplexityOutput> = {
  id: 'analyze-complexity',
  name: 'Analyze Complexity',
  description: 'Analyze cyclomatic complexity and cognitive complexity of changed functions',
  inputSchema: z.object({ code: z.string() }),
  outputSchema: z.object({
    cyclomaticComplexity: z.number(),
    cognitiveComplexity: z.number(),
    recommendation: z.string(),
  }),
  execute: async ({ code }) => {
    // Production: use a real complexity analyzer
    const lines = code.split('\n').length
    const complexity = Math.min(Math.floor(lines / 10) + 1, 15)
    return {
      cyclomaticComplexity: complexity,
      cognitiveComplexity: Math.floor(complexity * 0.8),
      recommendation:
        complexity > 10 ? 'Consider breaking this function down' : 'Complexity is acceptable',
    }
  },
}

type SecurityInput = { diff: string }
type SecurityOutput = { issues: Array<{ pattern: string; severity: string; line: string }> }

const checkSecurityPatternsTool: ToolDefinition<SecurityInput, SecurityOutput> = {
  id: 'check-security',
  name: 'Check Security Patterns',
  description: 'Check for common security anti-patterns in the diff',
  inputSchema: z.object({ diff: z.string() }),
  outputSchema: z.object({
    issues: z.array(z.object({ pattern: z.string(), severity: z.string(), line: z.string() })),
  }),
  execute: async ({ diff }) => {
    // Production: use a real SAST tool
    const issues: Array<{ pattern: string; severity: string; line: string }> = []
    if (diff.includes('eval('))
      issues.push({ pattern: 'eval() usage', severity: 'critical', line: 'detected' })
    if (diff.includes('TODO'))
      issues.push({ pattern: 'TODO comment', severity: 'minor', line: 'detected' })
    if (diff.includes('console.log'))
      issues.push({ pattern: 'console.log left in code', severity: 'minor', line: 'detected' })
    return { issues }
  },
}

// ─── Format step ─────────────────────────────────────────────────────────────

class FormatDiffStep extends TransformStep<Diff, string> {
  constructor() {
    super(
      'format-diff',
      'Format Diff for Review',
      DiffSchema,
      z.string(),
      (input: Diff) =>
        `PR #${input.pr}: ${input.title}\nAuthor: ${input.author}\n\nDiff:\n${input.diff}`,
    )
  }
}

// ─── Mock adapter ─────────────────────────────────────────────────────────────

let reviewCallCount = 0
const reviewMockAdapter = {
  adapterName: 'mock',
  chat: async () => {
    reviewCallCount++
    if (reviewCallCount === 1) {
      return {
        type: 'tool_calls' as const,
        toolCalls: [
          { id: 'tc-1', toolId: 'check-security', input: { diff: '+  eval(userInput)' } },
        ],
        usage: { promptTokens: 80, completionTokens: 30, totalTokens: 110 },
        model: 'mock',
      }
    }
    return {
      type: 'text' as const,
      content: JSON.stringify({
        verdict: 'request_changes',
        summary:
          'Critical security issue found. eval() usage with user input is a severe security risk.',
        issues: [
          {
            severity: 'critical',
            description: 'eval() called with user input — XSS/injection risk',
            line: '+  eval(userInput)',
          },
          { severity: 'minor', description: 'console.log left in production code' },
        ],
        positives: ['Good test coverage', 'Clear variable naming'],
        score: 3,
      }),
      usage: { promptTokens: 150, completionTokens: 60, totalTokens: 210 },
      model: 'mock',
    }
  },
  buildToolResultMessage: () => ({ role: 'user' as const, content: '[]' }),
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

const reviewAgent = withRetry(
  new AgentStep({
    id: 'code-review-agent',
    name: 'Code Review Agent',
    adapter: reviewMockAdapter,
    tools: [analyzeComplexityTool, checkSecurityPatternsTool],
    systemPrompt: `You are an expert code reviewer. For each diff:
1. Use check-security to scan for security issues
2. Use analyze-complexity on complex functions
3. Provide a structured review with verdict, issues, positives, and score
Respond with JSON matching the required schema.`,
    maxIterations: 6,
  }),
  { maxAttempts: 2, retryOn: [LLMRateLimitError, LLMTimeoutError] },
)

const reviewParser = defineAgentOutputParser({
  id: 'parse-review',
  name: 'Parse Review Output',
  strategy: { type: 'json' },
  outputSchema: ReviewSchema,
})

const traceStore = new FsTraceStore({ traceDir: '.pravaha/traces' })

const reviewPipeline = new PipelineBuilder<Diff, Review>(
  { id: 'code-review', name: 'Code Review Agent', version: '1.0.0' },
  undefined,
  traceStore,
)
  .step(new FormatDiffStep(), new LinearRouter('format-to-agent', 'code-review-agent'))
  .step(reviewAgent, new LinearRouter('agent-to-parser', 'parse-review'))
  .step(reviewParser)
  .build()

// ─── Run ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  reviewCallCount = 0

  const mockPR: Diff = {
    pr: '1234',
    title: 'Add user input processing',
    author: 'dev@company.com',
    diff: `
+function processUserInput(input) {
+  console.log('Processing:', input)
+  return eval(input) // TODO: fix this later
+}
    `.trim(),
  }

  console.log(`\nReviewing PR #${mockPR.pr}: ${mockPR.title}`)

  const result = await reviewPipeline.run(mockPR)

  const verdictEmoji =
    result.output.verdict === 'approve'
      ? '✅'
      : result.output.verdict === 'request_changes'
        ? '❌'
        : '💬'

  console.log(`\n${verdictEmoji} Verdict: ${result.output.verdict.toUpperCase()}`)
  console.log(`Score: ${result.output.score}/10`)
  console.log(`\nSummary: ${result.output.summary}`)

  if (result.output.issues.length > 0) {
    console.log('\nIssues:')
    result.output.issues.forEach((issue) => {
      const icon =
        issue.severity === 'critical'
          ? '🔴'
          : issue.severity === 'major'
            ? '🟠'
            : issue.severity === 'minor'
              ? '🟡'
              : '💡'
      console.log(`  ${icon} [${issue.severity}] ${issue.description}`)
    })
  }

  if (result.output.positives.length > 0) {
    console.log('\nPositives:')
    result.output.positives.forEach((p) => console.log(`  ✓ ${p}`))
  }

  console.log(`\nRun ID: ${result.trace.runId}`)
  console.log('Inspect: npx pravaha serve')
}

main().catch(console.error)
