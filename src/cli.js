#!/usr/bin/env node
'use strict'

const sywac = require('sywac')
const sywacStyleBasic = require('sywac-style-basic')
const pkg = require('../package.json')
const { EXIT } = require('./errors')

sywac
  // sywac derives the program name from process.argv[1]; set it explicitly so
  // help text always reads "blitzy", regardless of how the entry file is named.
  .configure({ name: 'blitzy' })

  .command(require('./commands/login'))
  .command(require('./commands/whoami'))
  .command(require('./commands/auth'))
  .command(require('./commands/logout'))
  .command(require('./commands/projects'))
  .command(require('./commands/rules'))
  .command(require('./commands/envs'))
  .command(require('./commands/teams'))
  .command(require('./commands/download'))
  .command(require('./commands/usage'))
  .showHelpByDefault()
  // Reject unknown flags/arguments on commands (child APIs inherit strict mode)
  // instead of silently ignoring them.
  .strict(true)

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

// Positional args left unclaimed by any command (before any `--`). Unknown
// top-level commands fall through to sywac's default help command with exit 0,
// so we detect and reject them here.
function unknownCommandArgs (argv) {
  const rest = (argv && argv._) || []
  const stop = rest.indexOf('--')
  return rest.slice(0, stop === -1 ? rest.length : stop)
}

function writeErr (text, jsonMode) {
  const body = jsonMode
    ? JSON.stringify({ error: { message: text, kind: 'usage', status: null, code: null } }, null, 2)
    : text
  process.stderr.write(body + '\n')
}

// Like sywac.parseAndExit(), but errors go to stderr (structured under --json)
// and command handlers set typed exit codes via src/errors.js. Only help and
// version output belongs on stdout.
async function main () {
  const jsonMode = process.argv.slice(2).includes('--json')
  const result = await sywac.parse()

  if (result.code !== 0) {
    if (result.output) writeErr(result.output, jsonMode)
    process.exitCode = EXIT.ERROR
    return
  }

  const unknown = unknownCommandArgs(result.argv)
  if (unknown.length) {
    writeErr(`Unknown command: ${unknown.join(' ')}\nRun \`blitzy --help\` for usage.`, jsonMode)
    process.exitCode = EXIT.ERROR
    return
  }

  // Help or version text (exit 0).
  if (result.output) console.log(result.output)
  // Otherwise a command handler ran; it set process.exitCode on failure.
}

main()
