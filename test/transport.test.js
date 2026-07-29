'use strict'

const { test, expect, afterEach } = require('bun:test')
const { createTransport, createImpitClient, createFetchClient, USER_AGENT } = require('../src/transport')

const origFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = origFetch })

test('USER_AGENT is blitzy-cli/<version>', () => {
  expect(USER_AGENT).toMatch(/^blitzy-cli\/\d+\.\d+\.\d+/)
})

test('createImpitClient returns a named fetch client without making a request', () => {
  const c = createImpitClient()
  expect(c.name).toBe('impit')
  expect(typeof c.fetch).toBe('function')
})

test('createFetchClient adds an honest User-Agent and preserves caller headers', async () => {
  let seen
  globalThis.fetch = async (url, init) => { seen = { url, init }; return { ok: true } }
  const c = createFetchClient()
  await c.fetch('https://example.com', { headers: { accept: 'application/json' } })
  expect(c.name).toBe('fetch')
  expect(seen.init.headers['user-agent']).toBe(USER_AGENT)
  expect(seen.init.headers.accept).toBe('application/json')
})

test('createFetchClient works with no init', async () => {
  let seen
  globalThis.fetch = async (url, init) => { seen = init; return {} }
  await createFetchClient().fetch('https://example.com')
  expect(seen.headers['user-agent']).toBe(USER_AGENT)
})

test('createTransport selects impit by default and fetch on request', () => {
  expect(createTransport().name).toBe('impit')
  expect(createTransport('fetch').name).toBe('fetch')
  expect(createTransport('impit').name).toBe('impit')
})

test('createTransport honors BLITZY_TRANSPORT=fetch', () => {
  const prev = process.env.BLITZY_TRANSPORT
  process.env.BLITZY_TRANSPORT = 'fetch'
  try {
    expect(createTransport().name).toBe('fetch')
  } finally {
    if (prev === undefined) delete process.env.BLITZY_TRANSPORT
    else process.env.BLITZY_TRANSPORT = prev
  }
})
