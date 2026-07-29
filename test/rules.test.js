'use strict'

const { test, expect } = require('bun:test')
const { BlitzyApi } = require('../src/api')
const { Store } = require('../src/store')
const { MemBacking, routeClient, makeJwt, captureLog } = require('./helpers')
const rules = require('../src/commands/rules')

const rulesList = require('./fixtures/rules-list.json')
const ruleDetail = require('./fixtures/rule-detail.json')

const futureJwt = () => makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })

function api (routes) {
  const store = new Store(new MemBacking({ workosToken: 'wtok' }))
  return new BlitzyApi({ client: routeClient(Object.assign({ 'POST /auth': { status: 200, body: { access_token: futureJwt() } } }, routes)), store, env: {} })
}

test('rules list mode returns rules and renders a table', async () => {
  const result = await rules.doRules({}, { api: api({ 'GET /rules': { status: 200, body: rulesList } }) })
  expect(result.mode).toBe('list')
  expect(result.result.rules).toHaveLength(3)
  const out = await captureLog(() => rules.renderList(result))
  expect(out).toContain('NAME')
  expect(out).toContain('Locale and Time Zone Independent Tests')
  expect(out).toContain('PERSONAL')
  expect(out).toContain('12775763-a828-4fd7-8403-9bfe9f898565') // full uuid
  expect(out).toContain('3 total')
})

test('rules detail mode fetches one rule and prints its content', async () => {
  const result = await rules.doRules({ uuid: 'ce7a92db-affa-4520-9794-0ebaba84c23d' }, {
    api: api({ 'GET /rules/': { status: 200, body: ruleDetail } })
  })
  expect(result.mode).toBe('detail')
  const out = await captureLog(() => rules.renderDetail(result))
  expect(out).toContain('Data-Access-Layer Conventions for the Recommended Architecture')
  expect(out).toContain('Used by')
  expect(out).toContain('Alora SProc Rewrite - Phase 0')
  // the full rule content is printed (that's the point for scoping)
  expect(out).toContain('framework-neutral contract seam')
})

test('rules list surfaces a not-logged-in error via the API', async () => {
  const store = new Store(new MemBacking({}))
  const bad = new BlitzyApi({ client: routeClient({}), store, env: {} })
  await expect(rules.doRules({}, { api: bad })).rejects.toThrow(/Not logged in/)
})
