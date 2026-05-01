import { z } from 'zod'

/** Unique identifier type for all Pravaha entities */
export type PravahaId = string

/** Generic schema-validated value */
export type SchemaOf<T> = z.ZodType<T>

/** Metadata bag — arbitrary key-value attached to steps, pipelines, events */
export type Metadata = Readonly<Record<string, unknown>>

/** Execution status of a step or pipeline */
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

/** LLM message role */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool'

/** A single LLM message */
export interface LLMMessage {
  readonly role: MessageRole
  readonly content: string
}

/** LLM completion request */
export interface LLMRequest {
  readonly messages: readonly LLMMessage[]
  readonly model?: string
  readonly temperature?: number
  readonly maxTokens?: number
  readonly metadata?: Metadata
}

/** LLM completion response */
export interface LLMResponse {
  readonly content: string
  readonly model: string
  readonly usage: {
    readonly promptTokens: number
    readonly completionTokens: number
    readonly totalTokens: number
  }
  readonly metadata?: Metadata
}
