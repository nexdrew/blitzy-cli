#!/usr/bin/env node
'use strict'

const sywac = require('sywac')
const sywacStyleBasic = require('sywac-style-basic')
const pkg = require('../package.json')

sywac
  // sywac derives the program name from process.argv[1]; set it explicitly so
  // help text always reads "blitzy", regardless of how the entry file is named.
  .configure({ name: 'blitzy' })

  .command(require('./commands/login'))
  .command(require('./commands/whoami'))
  .command(require('./commands/logout'))
  .command(require('./commands/projects'))
  .command(require('./commands/rules'))
  .command(require('./commands/envs'))
  .command(require('./commands/download'))
  .command(require('./commands/usage'))
  .showHelpByDefault()

  // Global options.
  .boolean('--json', { group: 'Global Options:', desc: 'Output raw JSON instead of formatted text' })
  .help('-h, --help', { group: 'Global Options:', desc: 'Show help' })
  // Pass version explicitly: sywac's auto-detection walks require.main.filename,
  // which is undefined under some entry points and throws.
  .version('-v, --version', { group: 'Global Options:', desc: 'Show version number', version: pkg.version })

  .outputSettings({ maxWidth: 101, showHelpOnError: false })
  .style(sywacStyleBasic)
  .epilogue('Set BLITZY_TOKEN to authenticate without `blitzy login`. Docs: https://github.com/nexdrew/blitzy-cli')
  .example('$0 login', { desc: 'Authenticate with your Blitzy work email and password' })
  .example('$0 projects', { desc: 'List your projects' })
  .example('$0 projects 50930af1-5165-41e6-89a3-7d4445ba4593', { desc: 'Show one project' })

async function main () {
  await sywac.parseAndExit()
}

main()
