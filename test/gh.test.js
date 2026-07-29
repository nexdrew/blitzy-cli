'use strict'

const { test, expect } = require('bun:test')
const { createGh, parseSubmodulePrs, repoFromPrUrl } = require('../src/gh')

test('parseSubmodulePrs extracts submodule PRs from a body', () => {
  const body = [
    'Some summary text.',
    'Submodule PR created: https://github.com/LivTech-Alora/alora-plus/pull/265',
    'More notes.',
    'Submodule PR created: https://github.com/LivTech-Alora/rcm-lib/pull/7'
  ].join('\n')
  expect(parseSubmodulePrs(body)).toEqual([
    { repo: 'LivTech-Alora/alora-plus', number: 265, url: 'https://github.com/LivTech-Alora/alora-plus/pull/265' },
    { repo: 'LivTech-Alora/rcm-lib', number: 7, url: 'https://github.com/LivTech-Alora/rcm-lib/pull/7' }
  ])
})

test('parseSubmodulePrs returns empty for no matches or empty body', () => {
  expect(parseSubmodulePrs('nothing here')).toEqual([])
  expect(parseSubmodulePrs('')).toEqual([])
  expect(parseSubmodulePrs(null)).toEqual([])
})

test('repoFromPrUrl parses owner/repo and number', () => {
  expect(repoFromPrUrl('https://github.com/LivTech-Alora/blitzy-pilot-parent/pull/19'))
    .toEqual({ repo: 'LivTech-Alora/blitzy-pilot-parent', number: 19 })
  expect(repoFromPrUrl('not a url')).toBeNull()
})

test('createGh.available caches and reflects the runner result', async () => {
  let versionCalls = 0
  const okRun = (args) => { if (args[0] === '--version') versionCalls++; return Promise.resolve('gh version 2.96.0') }
  const gh = createGh({ run: okRun })
  expect(await gh.available()).toBe(true)
  expect(await gh.available()).toBe(true)
  expect(versionCalls).toBe(1) // cached
})

test('createGh.available is false when gh is missing', async () => {
  const gh = createGh({ run: () => Promise.reject(new Error('ENOENT')) })
  expect(await gh.available()).toBe(false)
})

test('createGh.prView shells out and parses JSON', async () => {
  const calls = []
  const run = (args) => {
    calls.push(args)
    return Promise.resolve(JSON.stringify({ state: 'MERGED', body: 'hi' }))
  }
  const gh = createGh({ run })
  const out = await gh.prView('org/repo', 42, ['state', 'body'])
  expect(out).toEqual({ state: 'MERGED', body: 'hi' })
  expect(calls[0]).toEqual(['pr', 'view', '42', '--repo', 'org/repo', '--json', 'state,body'])
})
