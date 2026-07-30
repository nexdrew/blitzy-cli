'use strict'

const { test, expect } = require('bun:test')
const { refreshSession, refreshUrl, parseTokens, DEFAULT_REFRESH_URL } = require('../src/refresh')
const { Store } = require('../src/store')
const { MemBacking, stubClient } = require('./helpers')

const REFRESH_URL = 'https://example.test/auth/refresh'

function storeWith (data) {
  return new Store(new MemBacking(data))
}

test('refresh is disabled until an endpoint is confirmed', async () => {
  // Guard: if someone bakes in a default endpoint, they must revisit these tests.
  expect(DEFAULT_REFRESH_URL).toBe(null)
  expect(refreshUrl({})).toBe(null)
  expect(refreshUrl({ BLITZY_REFRESH_URL: REFRESH_URL })).toBe(REFRESH_URL)

  const client = stubClient(() => ({ status: 200, body: {} }))
  const store = storeWith({ workosToken: 'old', refreshToken: 'r1' })
  const result = await refreshSession({ client, store, env: {} })
  expect(result).toBe(null)
  expect(client.calls).toHaveLength(0)
})

test('refresh returns null without a stored refresh token', async () => {
  const client = stubClient(() => ({ status: 200, body: {} }))
  const store = storeWith({ workosToken: 'old' })
  const result = await refreshSession({ client, store, env: { BLITZY_REFRESH_URL: REFRESH_URL } })
  expect(result).toBe(null)
  expect(client.calls).toHaveLength(0)
})

test('successful refresh persists the ROTATED token pair and drops the platform cache', async () => {
  const client = stubClient((method, url, init) => {
    expect(method).toBe('POST')
    expect(url).toBe(REFRESH_URL)
    expect(JSON.parse(init.body)).toEqual({ refresh_token: 'r1' })
    return { status: 200, body: { workos_access_token: 'new-workos', refresh_token: 'r2' } }
  })
  const store = storeWith({ workosToken: 'old', refreshToken: 'r1', platformToken: 'p', platformTokenExp: 123 })
  const result = await refreshSession({ client, store, env: { BLITZY_REFRESH_URL: REFRESH_URL } })
  expect(result).toBe('new-workos')
  expect(store.get('workosToken')).toBe('new-workos')
  expect(store.get('refreshToken')).toBe('r2') // single-use: the old one is burned
  expect(store.get('platformToken')).toBeUndefined()
  expect(store.get('platformTokenExp')).toBeUndefined()
})

test('refresh accepts WorkOS-style access_token naming', () => {
  expect(parseTokens({ access_token: 'a', refresh_token: 'r' })).toEqual({ workosToken: 'a', refreshToken: 'r' })
  expect(parseTokens({ workos_access_token: 'a', refresh_token: 'r' })).toEqual({ workosToken: 'a', refreshToken: 'r' })
  expect(parseTokens({ access_token: 'a' })).toBe(null) // rotation is mandatory
  expect(parseTokens(null)).toBe(null)
})

test('failed refresh returns null (caller falls back to login)', async () => {
  const client = stubClient(() => ({ status: 400, body: { message: 'invalid_grant' } }))
  const store = storeWith({ workosToken: 'old', refreshToken: 'burned' })
  const result = await refreshSession({ client, store, env: { BLITZY_REFRESH_URL: REFRESH_URL } })
  expect(result).toBe(null)
  expect(store.get('workosToken')).toBe('old') // untouched
})

test('losing a rotation race recovers the winner session on re-read', async () => {
  const backing = new MemBacking({ workosToken: 'old', refreshToken: 'burned' })
  const store = new Store(backing)
  const client = stubClient(() => {
    // Simulate a concurrent invocation winning the race while our request is
    // in flight: it rotated the session, and our token is now rejected.
    backing.set('workosToken', 'winner-workos')
    backing.set('refreshToken', 'winner-refresh')
    return { status: 400, body: { message: 'invalid_grant' } }
  })
  const result = await refreshSession({ client, store, env: { BLITZY_REFRESH_URL: REFRESH_URL } })
  expect(result).toBe('winner-workos')
  expect(store.get('refreshToken')).toBe('winner-refresh') // winner's pair intact
})

test('network failure during refresh returns null', async () => {
  const client = { fetch: async () => { throw new Error('offline') } }
  const store = storeWith({ workosToken: 'old', refreshToken: 'r1' })
  const result = await refreshSession({ client, store, env: { BLITZY_REFRESH_URL: REFRESH_URL } })
  expect(result).toBe(null)
})
