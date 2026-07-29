'use strict'

const { test, expect } = require('bun:test')
const { output, relTime, relTimeIso, pct, table, toMs } = require('../src/format')
const { captureLog } = require('./helpers')

test('output emits JSON when argv.json, else calls the human renderer', async () => {
  const jsonOut = await captureLog(() => output({ json: true }, { a: 1 }, () => { throw new Error('should not render') }))
  expect(JSON.parse(jsonOut)).toEqual({ a: 1 })

  let rendered = false
  const humanOut = await captureLog(() => output({}, { a: 1 }, () => { rendered = true; console.log('human') }))
  expect(rendered).toBe(true)
  expect(humanOut).toContain('human')
})

test('relTimeIso parses ISO strings and rejects junk', () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 3600e3).toISOString()
  expect(relTimeIso(twoHoursAgo)).toBe('2 hours ago')
  expect(relTimeIso('not-a-date')).toBe('-')
  expect(relTimeIso(null)).toBe('-')
})

test('toMs handles integer and float epoch seconds', () => {
  expect(toMs(1780506508)).toBe(1780506508000)
  expect(toMs(1784924709.963547)).toBe(1784924709964)
  expect(toMs('nope')).toBeNull()
})

test('relTime renders a human delta', () => {
  const twoHoursAgo = (Date.now() - 2 * 3600e3) / 1000
  expect(relTime(twoHoursAgo)).toBe('2 hours ago')
  const inThreeDays = (Date.now() + 3 * 24 * 3600e3) / 1000
  expect(relTime(inThreeDays)).toBe('in 3 days')
  expect(relTime(null)).toBe('-')
})

test('pct', () => {
  expect(pct(90.2)).toBe('90.2%')
  expect(pct(undefined)).toBe('-')
})

test('table aligns columns and includes headers', () => {
  const out = table([
    { header: 'NAME', get: (r) => r.name },
    { header: 'CT', get: (r) => r.n }
  ], [
    { name: 'alpha', n: 1 },
    { name: 'beta-longer', n: 20 }
  ])
  const lines = out.split('\n')
  expect(lines[0]).toContain('NAME')
  expect(lines[0]).toContain('CT')
  expect(lines[1]).toContain('alpha')
  expect(lines[2]).toContain('beta-longer')
  // the second column's value starts at the same offset as its header
  const col2 = lines[0].indexOf('CT')
  expect(lines[1][col2]).toBe('1')
  expect(lines[2][col2]).toBe('2')
})
