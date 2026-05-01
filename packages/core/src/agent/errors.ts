import { PravahaError } from '../errors/index.js'

/**
 * Base class for all agent-related errors
 */
export abstract class AgentError extends PravahaError {
  constructor(
    public readonly agentId: string,
    message: string,
    cause?: unknown,
  ) {
    super(`Agent '${agentId}': ${message}`, cause)
  }
}

/**
 * Thrown when agent reaches max iterations without a text response.
 * Usually means the LLM is stuck in a tool-calling loop.
 */
export class AgentMaxIterationsError extends AgentError {
  readonly code = 'AGENT_MAX_ITERATIONS'

  constructor(agentId: string, maxIterations: number, iterationsRun: number) {
    super(
      agentId,
      `Reached maximum iterations (${maxIterations}) after ${iterationsRun} iterations without a final response. ` +
        `Consider increasing maxIterations or reviewing tool definitions.`,
    )
  }
}

/**
 * Thrown when the LLM requests a tool that is not registered with the agent
 */
export class AgentToolNotFoundError extends AgentError {
  readonly code = 'AGENT_TOOL_NOT_FOUND'

  constructor(agentId: string, toolId: string, availableTools: readonly string[]) {
    super(
      agentId,
      `LLM requested unknown tool '${toolId}'. Available tools: [${availableTools.join(', ')}]`,
    )
  }
}

/**
 * Thrown when tool input from LLM fails schema validation
 */
export class AgentInvalidToolInputError extends AgentError {
  readonly code = 'AGENT_INVALID_TOOL_INPUT'

  constructor(
    agentId: string,
    toolId: string,
    message: string,
    public readonly issues?: unknown[],
  ) {
    super(agentId, `Invalid input for tool '${toolId}': ${message}`)
  }
}

/**
 * Thrown when AgentOutputParser fails to parse the LLM response
 */
export class AgentOutputParseError extends AgentError {
  readonly code = 'AGENT_OUTPUT_PARSE_ERROR'

  constructor(
    agentId: string,
    message: string,
    public readonly rawContent: string,
    cause?: unknown,
  ) {
    super(agentId, `Failed to parse output: ${message}`, cause)
  }
}
