#!/usr/bin/env node

import { Command } from 'commander'
import { buildTraceCommand } from './commands/trace.js'
import { buildServeCommand } from './commands/serve.js'
import { buildExportCommand } from './commands/export.js'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { version: string }

const program = new Command()

program
  .name('pravaha')
  .description('Pravaha CLI — inspect and debug agentic pipelines')
  .version(pkg.version)

program.addCommand(buildTraceCommand())
program.addCommand(buildServeCommand())
program.addCommand(buildExportCommand())

program.parse()
