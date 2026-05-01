import { promises as fs } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { basicTemplateFiles } from './templates/basic.js'
import { agentTemplateFiles } from './templates/agent.js'
import { supportTriageTemplateFiles } from './templates/support-triage.js'

export interface ScaffoldOptions {
  projectName: string
  template: 'basic' | 'agent' | 'support-triage'
  adapter: 'claude' | 'openai' | 'ollama'
}

const TEMPLATE_MAP = {
  basic: basicTemplateFiles,
  agent: agentTemplateFiles,
  'support-triage': supportTriageTemplateFiles,
}

export async function scaffold(options: ScaffoldOptions): Promise<void> {
  const { projectName, template, adapter } = options
  const targetDir = resolve(process.cwd(), projectName)
  const displayName = basename(projectName)

  try {
    await fs.access(targetDir)
    throw new Error(`Directory '${projectName}' already exists`)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  await fs.mkdir(targetDir, { recursive: true })

  const templateFiles = TEMPLATE_MAP[template]

  for (const [filePath, content] of Object.entries(templateFiles)) {
    const fullPath = join(targetDir, filePath)
    const dir = dirname(fullPath)
    await fs.mkdir(dir, { recursive: true })

    const processed = processContent(content, { projectName: displayName, adapter })
    await fs.writeFile(fullPath, processed, 'utf-8')
  }
}

function processContent(content: string, vars: { projectName: string; adapter: string }): string {
  let result = content.replace(
    /\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, condition: string, body: string) => (condition === vars.adapter ? body : ''),
  )

  const adapterImport =
    vars.adapter === 'claude'
      ? "import { ClaudeLLMStep } from '@pravaha/adapter-claude'"
      : vars.adapter === 'openai'
        ? "import { OpenAILLMStep } from '@pravaha/adapter-openai'"
        : "import { OllamaLLMStep } from '@pravaha/adapter-ollama'"

  const stepClass =
    vars.adapter === 'claude'
      ? 'ClaudeLLMStep'
      : vars.adapter === 'openai'
        ? 'OpenAILLMStep'
        : 'OllamaLLMStep'

  const apiKeyEnv =
    vars.adapter === 'claude'
      ? 'ANTHROPIC_API_KEY'
      : vars.adapter === 'openai'
        ? 'OPENAI_API_KEY'
        : ''

  result = result
    .replace(/\{\{PROJECT_NAME\}\}/g, vars.projectName)
    .replace(/\{\{ADAPTER\}\}/g, vars.adapter)
    .replace(/\{\{ADAPTER_PACKAGE\}\}/g, `@pravaha/adapter-${vars.adapter}`)
    .replace(/\{\{ADAPTER_IMPORT\}\}/g, adapterImport)
    .replace(/\{\{STEP_CLASS\}\}/g, stepClass)
    .replace(/\{\{API_KEY_ENV\}\}/g, apiKeyEnv)

  return result
}
