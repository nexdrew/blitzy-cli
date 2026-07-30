'use strict'

// End-to-end tests of the built argv surface: strict mode, stream routing, and
// typed exit codes. Spawns the real entry point with an isolated config dir so
// nothing here touches the developer's stored session (and no test needs the
// network — strict/usage errors stop commands before any API call).

const { test, expect } = require('bun:test')
const { spawnSync } = require('node:child_process')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const nodepath = require('node:path')

const CLI = nodepath.join(__dirname, '..', 'src', 'cli.js')

function run (args, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 15000,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: mkdtempSync(nodepath.join(tmpdir(), 'blitzy-cli-test-')),
      BLITZY_TOKEN: '',
      ...env
    }
  })
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }
}

test('--help prints usage on stdout and exits 0', () => {
  const r = run(['--help'])
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('Usage:')
  expect(r.stderr).toBe('')
})

test('unknown command errors on stderr and exits 1', () => {
  const r = run(['boguscmd'])
  expect(r.code).toBe(1)
  expect(r.stderr).toContain('Unknown command: boguscmd')
  expect(r.stdout).toBe('')
})

test('unknown flag on a command errors on stderr and exits 1 (strict mode)', () => {
  const r = run(['projects', '--bogus-flag'])
  expect(r.code).toBe(1)
  expect(r.stderr).toContain('Unknown options: --bogus-flag')
  expect(r.stdout).toBe('')
})

test('missing required argument errors on stderr and exits 1', () => {
  const r = run(['download'])
  expect(r.code).toBe(1)
  expect(r.stderr).toContain('Missing required argument: uuid')
})

test('usage errors are JSON-wrapped on stderr under --json', () => {
  const r = run(['boguscmd', '--json'])
  expect(r.code).toBe(1)
  const parsed = JSON.parse(r.stderr)
  expect(parsed.error.kind).toBe('usage')
  expect(parsed.error.message).toContain('boguscmd')
})

test('auth pre-flight exits 2 with parseable JSON when not logged in', () => {
  const r = run(['auth', '--json'])
  expect(r.code).toBe(2)
  const parsed = JSON.parse(r.stdout)
  expect(parsed.authenticated).toBe(false)
  expect(parsed.source).toBe(null)
})

test('runtime auth errors exit 2 with a JSON error body on stderr', () => {
  const r = run(['whoami', '--json'])
  expect(r.code).toBe(2)
  const parsed = JSON.parse(r.stderr)
  expect(parsed.error.kind).toBe('auth')
  expect(parsed.error.message).toMatch(/Not logged in/)
})
