import { describe, it, expect } from 'vitest'
import { ClaudeLLMStep } from '../src/index.js'

describe('ClaudeLLMStep', () => {
  it('initializes with valid config', () => {
    const step = new ClaudeLLMStep('test', 'Test Step', {
      apiKey: 'test-key',
    })
    expect(step.id).toBe('test')
    expect(step.type).toBe('llm:claude')
  })

  it('has correct input/output schemas', () => {
    const step = new ClaudeLLMStep('test', 'Test Step', {
      apiKey: 'test-key',
    })
    expect(step.inputSchema).toBeDefined()
    expect(step.outputSchema).toBeDefined()
  })
})
