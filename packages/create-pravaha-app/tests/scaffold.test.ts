import { describe, it, expect, afterEach } from 'vitest'
import { scaffold } from '../src/scaffold.js'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const TEST_DIR = join(tmpdir(), 'pravaha-scaffold-test-' + Date.now())

afterEach(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true })
})

describe('scaffold', () => {
  it('creates project directory', async () => {
    const targetDir = join(TEST_DIR, 'test-project')
    await scaffold({ projectName: targetDir, template: 'basic', adapter: 'claude' })

    const stat = await fs.stat(targetDir)
    expect(stat.isDirectory()).toBe(true)
  })

  it('creates src/index.ts', async () => {
    const targetDir = join(TEST_DIR, 'test-src')
    await scaffold({ projectName: targetDir, template: 'basic', adapter: 'claude' })

    const indexPath = join(targetDir, 'src', 'index.ts')
    const content = await fs.readFile(indexPath, 'utf-8')
    expect(content).toContain('PipelineBuilder')
  })

  it('replaces ADAPTER_IMPORT for claude', async () => {
    const targetDir = join(TEST_DIR, 'test-claude')
    await scaffold({ projectName: targetDir, template: 'basic', adapter: 'claude' })

    const indexPath = join(targetDir, 'src', 'index.ts')
    const content = await fs.readFile(indexPath, 'utf-8')
    expect(content).toContain('@pravaha/adapter-claude')
  })

  it('replaces ADAPTER_IMPORT for openai', async () => {
    const targetDir = join(TEST_DIR, 'test-openai')
    await scaffold({ projectName: targetDir, template: 'basic', adapter: 'openai' })

    const indexPath = join(targetDir, 'src', 'index.ts')
    const content = await fs.readFile(indexPath, 'utf-8')
    expect(content).toContain('@pravaha/adapter-openai')
  })

  it('creates .env.example', async () => {
    const targetDir = join(TEST_DIR, 'test-env')
    await scaffold({ projectName: targetDir, template: 'basic', adapter: 'openai' })

    const envPath = join(targetDir, '.env.example')
    const content = await fs.readFile(envPath, 'utf-8')
    expect(content).toContain('OPENAI_API_KEY')
  })

  it('throws if directory already exists', async () => {
    const targetDir = join(TEST_DIR, 'existing-dir')
    await fs.mkdir(targetDir, { recursive: true })

    await expect(
      scaffold({ projectName: targetDir, template: 'basic', adapter: 'claude' }),
    ).rejects.toThrow('already exists')
  })

  it('scaffolds agent template', async () => {
    const targetDir = join(TEST_DIR, 'test-agent')
    await scaffold({ projectName: targetDir, template: 'agent', adapter: 'claude' })

    const indexPath = join(targetDir, 'src', 'index.ts')
    const content = await fs.readFile(indexPath, 'utf-8')
    expect(content).toContain('AgentStep')
    expect(content).toContain('withRetry')
  })

  it('scaffolds support-triage template', async () => {
    const targetDir = join(TEST_DIR, 'test-triage')
    await scaffold({ projectName: targetDir, template: 'support-triage', adapter: 'claude' })

    const indexPath = join(targetDir, 'src', 'index.ts')
    const content = await fs.readFile(indexPath, 'utf-8')
    expect(content).toContain('ConditionalRouter')
    expect(content).toContain('CostTrackerPlugin')
  })
})
