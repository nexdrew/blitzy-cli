'use strict'

const { test, expect } = require('bun:test')
const { BlitzyApi } = require('../src/api')
const { Store } = require('../src/store')
const { MemBacking, routeClient, makeJwt, captureLog } = require('./helpers')
const envs = require('../src/commands/envs')

const envsList = require('./fixtures/envs-list.json')
const envDetail = require('./fixtures/env-detail.json')

const futureJwt = () => makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })

function api (routes) {
  const store = new Store(new MemBacking({ workosToken: 'wtok' }))
  return new BlitzyApi({ client: routeClient(Object.assign({ 'POST /auth': { status: 200, body: { access_token: futureJwt() } } }, routes)), store, env: {} })
}

test('envs list mode returns environments and renders a table', async () => {
  const result = await envs.doEnvs({}, { api: api({ 'GET /environments': { status: 200, body: envsList } }) })
  expect(result.mode).toBe('list')
  expect(result.result.environments).toHaveLength(2)
  const out = await captureLog(() => envs.renderList(result))
  expect(out).toContain('NAME')
  expect(out).toContain('REV')
  expect(out).toContain('Alora Pilot - Linux Node')
  expect(out).toContain('4cd123bf-54b5-4857-a0b1-2a18696c55bb') // full uuid
})

test('envs detail mode shows OS, variables, and setup instructions', async () => {
  const result = await envs.doEnvs({ uuid: '4cd123bf-54b5-4857-a0b1-2a18696c55bb' }, {
    api: api({ 'GET /environments/': { status: 200, body: envDetail } })
  })
  expect(result.mode).toBe('detail')
  const out = await captureLog(() => envs.renderDetail(result))
  expect(out).toContain('Alora Pilot - Linux Node')
  expect(out).toContain('LINUX')
  expect(out).toContain('Variables')
  expect(out).toContain('CI=true')
  expect(out).toContain('NODE_ENV=test')
  expect(out).toContain('Used by')
  expect(out).toContain('Alora Plus Bulk Front-End XSS Remediation')
  // setup instructions are printed (that's the point for scoping)
  expect(out).toContain('Node.js 22.x LTS')
})
