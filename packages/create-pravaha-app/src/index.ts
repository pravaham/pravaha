#!/usr/bin/env node

import chalk from 'chalk'
import prompts from 'prompts'
import ora from 'ora'
import { scaffold } from './scaffold.js'

async function main(): Promise<void> {
  console.log('')
  console.log(chalk.bold('  ⬡ Create Pravaha App'))
  console.log(chalk.dim('  Composable agentic AI workflows'))
  console.log('')

  let projectName = process.argv[2]

  if (!projectName) {
    const response = await prompts({
      type: 'text',
      name: 'projectName',
      message: 'Project name:',
      initial: 'my-pravaha-app',
      validate: (val: string) =>
        /^[a-z0-9-_]+$/.test(val) || 'Use lowercase letters, numbers, hyphens, underscores',
    })
    projectName = response.projectName as string
  }

  if (!projectName) {
    console.log(chalk.red('  Project name is required'))
    process.exit(1)
  }

  const { template } = await prompts({
    type: 'select',
    name: 'template',
    message: 'Select a template:',
    choices: [
      {
        title: chalk.bold('basic') + chalk.dim(' — pipeline with one LLM step, ready to run'),
        value: 'basic',
      },
      {
        title: chalk.bold('agent') + chalk.dim(' — AgentStep with tools, output parser, retry'),
        value: 'agent',
      },
      {
        title: chalk.bold('support-triage') + chalk.dim(' — classify → route → respond pipeline'),
        value: 'support-triage',
      },
    ],
    initial: 0,
  })

  if (!template) {
    console.log(chalk.dim('  Cancelled'))
    process.exit(0)
  }

  const { adapter } = await prompts({
    type: 'select',
    name: 'adapter',
    message: 'LLM provider:',
    choices: [
      { title: 'Claude (Anthropic)', value: 'claude' },
      { title: 'OpenAI', value: 'openai' },
      { title: 'Ollama (local, free)', value: 'ollama' },
    ],
    initial: 0,
  })

  if (!adapter) {
    console.log(chalk.dim('  Cancelled'))
    process.exit(0)
  }

  console.log('')
  const spinner = ora('Scaffolding project...').start()

  try {
    await scaffold({ projectName, template, adapter })
    spinner.succeed('Done!')
  } catch (err) {
    spinner.fail('Failed to scaffold project')
    console.error(err)
    process.exit(1)
  }

  console.log('')
  console.log(`  ${chalk.bold('Project created:')} ${chalk.cyan(projectName)}`)
  console.log('')
  console.log('  Next steps:')
  console.log('')
  console.log(`    ${chalk.dim('$')} cd ${projectName}`)
  console.log(`    ${chalk.dim('$')} cp .env.example .env`)
  if (adapter !== 'ollama') {
    console.log(`    ${chalk.dim('$')} # Add your API key to .env`)
  } else {
    console.log(`    ${chalk.dim('$')} # Make sure Ollama is running: ollama pull llama3.2`)
  }
  console.log(`    ${chalk.dim('$')} pnpm install`)
  console.log(`    ${chalk.dim('$')} pnpm dev`)
  console.log('')
  console.log(`  ${chalk.dim('Docs:')} ${chalk.cyan('https://pravaha.dev')}`)
  console.log('')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
