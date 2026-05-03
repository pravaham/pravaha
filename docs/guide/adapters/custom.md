# Writing an Adapter

Adapters are just classes that implement one of two interfaces: `ToolCallingAdapter` (for use with `AgentStep`) or a subclass of `BaseStreamingStep` (for use as a pipeline step). If you have an LLM provider not yet covered by a Pravaha adapter, writing one is straightforward.

## ToolCallingAdapter Interface

For use with `AgentStep`:

```typescript
interface ToolCallingAdapter {
  readonly adapterName: string

  chat(
    messages: readonly LLMMessage[],
    tools: readonly ToolDefinition<unknown, unknown>[],
    options?: ToolCallingOptions,
  ): Promise<AgentLLMResponse>

  buildToolResultMessage(results: readonly ToolCallResult[]): LLMMessage | readonly LLMMessage[]
}
```

`chat()` sends messages and tool schemas to the LLM and returns either:

- `{ type: 'tool_calls', toolCalls: [...], usage, model }` when the LLM wants to call a tool
- `{ type: 'text', content: '...', usage, model }` when the LLM has a final answer

`buildToolResultMessage()` formats tool results back into a message that the LLM can read.

## Example: Google Gemini Adapter

Here is a complete implementation using the Google Generative AI SDK:

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai'
import type {
  ToolCallingAdapter,
  ToolCallingOptions,
  AgentLLMResponse,
  ToolCallResult,
  ToolCallRequest,
  ToolDefinition,
  LLMMessage,
} from '@pravaha/core'
import { LLMInvalidResponseError, LLMRateLimitError, toAnthropicTool } from '@pravaha/core'

export class GeminiToolCallingAdapter implements ToolCallingAdapter {
  readonly adapterName = 'gemini'

  private readonly client: GoogleGenerativeAI

  constructor(
    private readonly config: {
      apiKey: string
      defaultModel?: string
    },
  ) {
    this.client = new GoogleGenerativeAI(config.apiKey)
  }

  async chat(
    messages: readonly LLMMessage[],
    tools: readonly ToolDefinition<unknown, unknown>[],
    options?: ToolCallingOptions,
  ): Promise<AgentLLMResponse> {
    const modelName = options?.model ?? this.config.defaultModel ?? 'gemini-1.5-pro'

    // Convert tool schemas for Gemini's format
    const geminiTools =
      tools.length > 0
        ? [
            {
              functionDeclarations: tools.map((tool) => {
                const schema = toAnthropicTool(tool)
                return {
                  name: schema.name,
                  description: schema.description,
                  parameters: schema.input_schema,
                }
              }),
            },
          ]
        : undefined

    // Build message history
    const systemMessage = messages.find((m) => m.role === 'system')
    const history = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))

    const model = this.client.getGenerativeModel({
      model: modelName,
      systemInstruction: systemMessage?.content,
    })

    const chat = model.startChat({ history: history.slice(0, -1), tools: geminiTools })

    try {
      const lastMessage = history[history.length - 1]!
      const result = await chat.sendMessage(lastMessage.parts[0]!.text)
      const response = result.response

      const functionCalls = response.functionCalls()
      if (functionCalls && functionCalls.length > 0) {
        const toolCalls: ToolCallRequest[] = functionCalls.map((fc) => ({
          id: `gemini-${Date.now()}-${fc.name}`,
          toolId: fc.name,
          input: fc.args,
        }))

        return {
          type: 'tool_calls',
          toolCalls,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model: modelName,
        }
      }

      const text = response.text()
      if (!text) {
        throw new LLMInvalidResponseError('gemini', 'Empty response from Gemini')
      }

      return {
        type: 'text',
        content: text,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: modelName,
      }
    } catch (err) {
      if (err instanceof LLMInvalidResponseError) throw err
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('429') || message.includes('quota')) {
        throw new LLMRateLimitError('gemini', undefined, err)
      }
      throw new LLMInvalidResponseError('gemini', message, err)
    }
  }

  buildToolResultMessage(results: readonly ToolCallResult[]): LLMMessage {
    return {
      role: 'user',
      content: JSON.stringify(
        results.map((r) => ({
          functionResponse: {
            name: r.callId,
            response: r.error ? { error: r.error } : r.output,
          },
        })),
      ),
    }
  }
}
```

Use it exactly like any other adapter:

```typescript
import { AgentStep } from '@pravaha/core'

const agent = new AgentStep({
  id: 'gemini-agent',
  name: 'Gemini Agent',
  adapter: new GeminiToolCallingAdapter({ apiKey: process.env.GOOGLE_API_KEY! }),
  tools: [searchTool, lookupTool],
  systemPrompt: 'You are a helpful assistant.',
  maxIterations: 8,
})
```

## LLM Step Adapter

To make a provider available as a pipeline step (not just in agents), extend `BaseStep`:

```typescript
import { z } from 'zod'
import { BaseStep, LLMInvalidResponseError } from '@pravaha/core'
import type { LLMRequest, LLMResponse, ExecutionContext, PravahaId } from '@pravaha/core'

export class GeminiLLMStep extends BaseStep<LLMRequest, LLMResponse> {
  readonly type = 'llm:gemini'

  readonly inputSchema = z.object({
    messages: z.array(
      z.object({
        role: z.enum(['system', 'user', 'assistant', 'tool']),
        content: z.string(),
      }),
    ),
    model: z.string().optional(),
    temperature: z.number().optional(),
    maxTokens: z.number().optional(),
    metadata: z.record(z.unknown()).optional(),
  }) as z.ZodType<LLMRequest>

  readonly outputSchema = z.object({
    content: z.string().min(1),
    model: z.string(),
    usage: z.object({
      promptTokens: z.number(),
      completionTokens: z.number(),
      totalTokens: z.number(),
    }),
    metadata: z.record(z.unknown()).optional(),
  }) as z.ZodType<LLMResponse>

  private readonly client: GoogleGenerativeAI

  constructor(
    readonly id: PravahaId,
    readonly name: string,
    private readonly config: { apiKey: string; defaultModel?: string },
  ) {
    super()
    this.client = new GoogleGenerativeAI(config.apiKey)
  }

  protected async run(input: LLMRequest, context: ExecutionContext): Promise<LLMResponse> {
    const modelName = input.model ?? this.config.defaultModel ?? 'gemini-1.5-flash'
    const allMessages = [...context.messages, ...input.messages]

    const systemMessage = allMessages.find((m) => m.role === 'system')
    const userMessages = allMessages.filter((m) => m.role !== 'system')

    const model = this.client.getGenerativeModel({
      model: modelName,
      systemInstruction: systemMessage?.content,
    })

    const result = await model.generateContent(userMessages.map((m) => m.content).join('\n'))

    const text = result.response.text()
    if (!text) throw new LLMInvalidResponseError('gemini', 'Empty response')

    return {
      content: text,
      model: modelName,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }
  }
}
```

## Key Principles for Adapters

1. **Map provider errors to Pravaha errors.** Always throw `LLMRateLimitError`, `LLMTimeoutError`, or `LLMInvalidResponseError` — never let raw provider errors escape.

2. **Never throw non-Pravaha errors.** Callers expect structured errors with `code` fields.

3. **Fill `usage` when available.** Cost tracking and monitoring depend on it. Zero is acceptable when the provider doesn't return usage.

4. **Handle context messages.** The `context.messages` array contains conversation history. Merge it with `input.messages` before sending to the LLM.

5. **Return `type: 'tool_calls'` or `type: 'text'` consistently.** The agent loop depends on this distinction.
