'use strict'

const { test, expect } = require('bun:test')
const { BlitzyApi } = require('../src/api')
const { Store } = require('../src/store')
const { MemBacking, routeClient, makeJwt, captureLog, fakeContext, fakeErrio } = require('./helpers')
const cves = require('../src/commands/cves')

const branches = require('./fixtures/cve-branches.json')
const findings = require('./fixtures/cve-findings.json')

const BRANCH = 'eeeeeeee-0000-4000-8000-000000000001'
const futureJwt = () => makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })

function setup (routes) {
  const client = routeClient(Object.assign({ 'POST /auth': { status: 200, body: { access_token: futureJwt() } } }, routes))
  const store = new Store(new MemBacking({ workosToken: 'wtok' }))
  return { api: new BlitzyApi({ client, store, env: {} }), client }
}

const queryOf = (client, path) => Object.fromEntries(new URL(client.calls.find((c) => c.url.includes(path)).url).searchParams)

// --- branches ---

test('cves without an id lists one row for each scanned branch', async () => {
  const { api, client } = setup({ 'GET /cve/branches': { status: 200, body: branches } })
  const result = await cves.doCves({}, { api })
  expect(result.mode).toBe('branches')
  expect(new URL(client.calls[1].url).pathname).toBe('/v1/cve/branches')
  const out = await captureLog(() => cves.renderBranches(result))
  expect(out.split('\n')[0]).toMatch(/REPO\s+BRANCH\s+FINDINGS\s+BLITZY\s+KEV\s+SCANNED\s+ID/)
  expect(out).toMatch(/example-org\/web-app\s+main\s+1,234\s+40\s+1\s+.*eeeeeeee-0000-4000-8000-000000000001/)
  expect(out).toMatch(/example-org\/web-app\s+release\s+0\s+0\s+0\s+scanning now/)
  expect(out).toMatch(/example-org\/api\s+main\s+7\s+3\s+0/)
  expect(out).toContain('3 branches shown.')
})

test('cves reports when no branch has a scan', async () => {
  const out = await captureLog(() => cves.renderBranches({ result: { repos: [], recent_branches: [] } }))
  expect(out).toBe('No scanned branches found.')
})

// --- findings ---

test('cves <id> requests the findings with the default sort and page size', async () => {
  const { api, client } = setup({ 'GET /cve-findings': { status: 200, body: findings } })
  const result = await cves.doCves({ uuid: BRANCH, sort: 'severity desc', page: 1, limit: 25 }, { api })
  expect(result.mode).toBe('findings')
  expect(queryOf(client, '/cve-findings')).toEqual({ branch_pattern_id: BRANCH, sort: 'severity desc', page: '1', page_size: '25' })
})

test('cves <id> passes the filters to the server', async () => {
  const { api, client } = setup({ 'GET /cve-findings': { status: 200, body: findings } })
  await cves.doCves({ uuid: BRANCH, severity: 'critical, high', reachability: 'internet', kev: true, search: 'sql', sort: 'severity asc', page: 2, limit: 100 }, { api })
  expect(queryOf(client, '/cve-findings')).toEqual({
    branch_pattern_id: BRANCH,
    search: 'sql',
    severity: 'CRITICAL,HIGH',
    reachability: 'INTERNET',
    is_kev: 'true',
    sort: 'severity asc',
    page: '2',
    page_size: '100'
  })
})

test('listArg normalizes a comma-delimited filter', () => {
  expect(cves.listArg('critical, High ,')).toBe('CRITICAL,HIGH')
  expect(cves.listArg('')).toBeUndefined()
  expect(cves.listArg(undefined)).toBeUndefined()
})

test('findings table shows severity, id, reachability, status, and a shortened title', async () => {
  const out = await captureLog(() => cves.renderFindings({ result: findings }))
  const lines = out.split('\n')
  expect(lines[0]).toMatch(/^Commit 0123456789ab, scanned /)
  expect(lines[2]).toMatch(/^SEVERITY\s+KEV\s+ID\s+REACHABILITY\s+STATUS\s+PACKAGE\s+TITLE\s*$/)
  expect(out).toMatch(/CRITICAL\s+BLITZY-0a1b2c3d4e5f\s+INTERNET\s+OPEN\s+Example login route accepts a forged token/)
  expect(out).toMatch(/MEDIUM\s+yes\s+CVE-2020-11023\s+INTERNAL\s+OPEN\s+jquery\s+Example library/)
  // the long title is cut to the column width and marked
  const long = lines.find((l) => l.includes('BLITZY-9f8e7d6c5b4a'))
  expect(long.endsWith('…')).toBe(true)
  expect(long).not.toContain('through the filter field')
  expect(out).toContain('3 shown, 1,234 total (page 1).')
})

test('the KEV and PACKAGE columns appear only when a finding uses them', async () => {
  const plain = { findings: [findings.findings[0]], total_count: 1, page: 1 }
  const out = await captureLog(() => cves.renderFindings({ result: plain }))
  expect(out.split('\n')[0]).toMatch(/^SEVERITY\s+ID\s+REACHABILITY\s+STATUS\s+TITLE\s*$/)
})

test('findings table reports an empty result', async () => {
  const out = await captureLog(() => cves.renderFindings({ result: { findings: [], total_count: 0, page: 1 } }))
  expect(out).toBe('No findings found.')
})

// --- handle ---

test('cves handle --json emits the raw API response', async () => {
  const { api } = setup({ 'GET /cve-findings': { status: 200, body: findings }, 'GET /cve/branches': { status: 200, body: branches } })
  const list = JSON.parse(await captureLog(() => cves.handle({ json: true }, fakeContext(), { api })))
  expect(list.repos).toHaveLength(2)
  const one = JSON.parse(await captureLog(() => cves.handle({ uuid: BRANCH, json: true }, fakeContext(), { api })))
  expect(one.findings[0].summary).toBe('Example summary.')
})

test('cves handle: an unknown branch exits with the not-found code', async () => {
  const { api } = setup({ 'GET /cve-findings': { status: 404, body: { error: 'Branch pattern not found: x' } } })
  const e = fakeErrio()
  await cves.handle({ uuid: 'x' }, fakeContext(), { api, errio: e.io })
  expect(e.lines[0]).toBe('Branch pattern not found: x')
  expect(e.codes[0]).toBe(3)
})

test('cves handle: a rejected sort field exits with the general error code', async () => {
  const { api } = setup({ 'GET /cve-findings': { status: 400, body: { error: 'Invalid sort field: bogus' } } })
  const e = fakeErrio()
  await cves.handle({ uuid: BRANCH, sort: 'bogus' }, fakeContext(), { api, errio: e.io })
  expect(e.lines[0]).toBe('Invalid sort field: bogus')
  expect(e.codes[0]).toBe(1)
})
