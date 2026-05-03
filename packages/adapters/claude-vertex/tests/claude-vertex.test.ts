import { describe, it, expect, vi } from 'vitest'
import { ClaudeVertexLLMStep } from '../src/index.js'
import { createExecutionContext, LLMRateLimitError, LLMInvalidResponseError } from '@pravaha/core'

// Prevent the real AnthropicVertex constructor from making GCP auth requests.
// Each test replaces step.client directly after construction.
vi.mock('@anthropic-ai/vertex-sdk', () => ({
  AnthropicVertex: vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn() },
  })),
}))

/**
 * Unit tests for Claude Vertex adapter.
 * These test adapter logic without making real GCP API calls.
 * Integration tests against real Vertex AI require GCP credentials
 * and should be run separately in CI with appropriate service accounts.
 */
describe('ClaudeVertexLLMStep', () => {
  it('initializes with valid config', () => {
    const step = new ClaudeVertexLLMStep('test-vertex', 'Test Vertex', {
      projectId: 'my-gcp-project',
      region: 'us-central1',
    })
    expect(step.id).toBe('test-vertex')
    expect(step.type).toBe('llm:claude-vertex')
  })

  it('resolves short model names to Vertex format', async () => {
    const step = new ClaudeVertexLLMStep('vertex-step', 'Vertex Step', {
      projectId: 'test-project',
      region: 'us-central1',
      defaultModel: 'claude-sonnet-4-5',
    })

    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Hello' }],
      model: 'claude-3-5-sonnet@20241022',
      usage: { input_tokens: 10, output_tokens: 5 },
    })

    // @ts-expect-error — accessing private for test
    step.client = { messages: { create: mockCreate } }

    const context = createExecutionContext('test-pipeline')
    await step.execute({ messages: [{ role: 'user', content: 'Hi' }] }, context)

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-3-5-sonnet@20241022' }),
    )
  })

  it('passes through Vertex model IDs unchanged', async () => {
    const step = new ClaudeVertexLLMStep('vertex-step', 'Vertex Step', {
      projectId: 'test-project',
      region: 'europe-west1',
    })

    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Response' }],
      model: 'claude-3-opus@20240229',
      usage: { input_tokens: 10, output_tokens: 5 },
    })

    // @ts-expect-error — accessing private for test
    step.client = { messages: { create: mockCreate } }

    const context = createExecutionContext('test-pipeline')
    await step.execute(
      { messages: [{ role: 'user', content: 'Hi' }], model: 'claude-3-opus@20240229' },
      context,
    )

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-3-opus@20240229' }),
    )
  })

  it('maps RESOURCE_EXHAUSTED to LLMRateLimitError', async () => {
    const step = new ClaudeVertexLLMStep('vertex-step', 'Vertex Step', {
      projectId: 'test-project',
      region: 'us-central1',
    })

    // @ts-expect-error — accessing private for test
    step.client = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error('RESOURCE_EXHAUSTED: Quota exceeded')),
      },
    }

    const context = createExecutionContext('test-pipeline')
    await expect(
      step.execute({ messages: [{ role: 'user', content: 'Hi' }] }, context),
    ).rejects.toThrow(LLMRateLimitError)
  })

  it('maps unknown errors to LLMInvalidResponseError', async () => {
    const step = new ClaudeVertexLLMStep('vertex-step', 'Vertex Step', {
      projectId: 'test-project',
      region: 'us-central1',
    })

    // @ts-expect-error — accessing private for test
    step.client = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error('Some unexpected GCP error')),
      },
    }

    const context = createExecutionContext('test-pipeline')
    await expect(
      step.execute({ messages: [{ role: 'user', content: 'Hi' }] }, context),
    ).rejects.toThrow(LLMInvalidResponseError)
  })

  it('attaches GCP metadata to response', async () => {
    const step = new ClaudeVertexLLMStep('vertex-step', 'Vertex Step', {
      projectId: 'unicredit-prod',
      region: 'europe-west1',
    })

    // @ts-expect-error — accessing private for test
    step.client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Response' }],
          model: 'claude-3-5-sonnet@20241022',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      },
    }

    const context = createExecutionContext('test-pipeline')
    const result = await step.execute({ messages: [{ role: 'user', content: 'Hi' }] }, context)

    expect(result.output.metadata?.['vertexProjectId']).toBe('unicredit-prod')
    expect(result.output.metadata?.['vertexRegion']).toBe('europe-west1')
  })
})
