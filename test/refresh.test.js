'use strict'

const { test, expect } = require('bun:test')
const { refreshSession, refreshUrl, parseTokens } = require('../src/refresh')
const { Store } = require('../src/store')
const { MemBacking, stubClient, makeJwt } = require('./helpers')

const BASE = 'https://platform.api.blitzy.com/v1'
const OVERRIDE_URL = 'https://example.test/custom/refresh'
const platformJwt = () => makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })

function storeWith (data) {
  return new Store(new MemBacking(data))
}

test('refreshUrl defaults to the API base /auth/refresh, with env override', () => {
  expect(refreshUrl({}, BASE)).toBe(`${BASE}/auth/refresh`)
  expect(refreshUrl({ BLITZY_REFRESH_URL: OVERRIDE_URL }, BASE)).toBe(OVERRIDE_URL)
  expect(refreshUrl({}, undefined)).toBe(null)
})

test('parseTokens maps the proxy response fields (access_token is the PLATFORM token)', () => {
  expect(parseTokens({ access_token: 'p', workos_access_token: 'w', refresh_token: 'r' }))
    .toEqual({ workosToken: 'w', platformToken: 'p', refreshToken: 'r' })
  expect(parseTokens({ workos_access_token: 'w' }))
    .toEqual({ workosToken: 'w', platformToken: null, refreshToken: null })
  expect(parseTokens({ access_token: 'p' }))
    .toEqual({ workosToken: null, platformToken: 'p', refreshToken: null })
  expect(parseTokens({ refresh_token: 'r' })).toBe(null) // rotation without a usable token
  expect(parseTokens({})).toBe(null)
  expect(parseTokens(null)).toBe(null)
})

test('refresh returns null without a stored refresh token', async () => {
  const client = stubClient(() => ({ status: 200, body: {} }))
  const store = storeWith({ workosToken: 'old' })
  const result = await refreshSession({ client, store, env: {}, baseUrl: BASE })
  expect(result).toBe(null)
  expect(client.calls).toHaveLength(0)
})

test('refresh POSTs { refresh_token } to {base}/auth/refresh by default', async () => {
  const client = stubClient((method, url, init) => {
    expect(method).toBe('POST')
    expect(url).toBe(`${BASE}/auth/refresh`)
    expect(JSON.parse(init.body)).toEqual({ refresh_token: 'r1' })
    return { status: 200, body: { workos_access_token: 'new-workos', refresh_token: 'r2' } }
  })
  const store = storeWith({ workosToken: 'old', refreshToken: 'r1' })
  const result = await refreshSession({ client, store, env: {}, baseUrl: BASE })
  expect(result.workosToken).toBe('new-workos')
})

test('successful refresh persists the ROTATED pair and drops the platform cache', async () => {
  const client = stubClient(() => ({ status: 200, body: { workos_access_token: 'new-workos', refresh_token: 'r2' } }))
  const store = storeWith({ workosToken: 'old', refreshToken: 'r1', platformToken: 'p', platformTokenExp: 123 })
  const result = await refreshSession({ client, store, env: {}, baseUrl: BASE })
  expect(result).toEqual({ workosToken: 'new-workos', platformToken: null, refreshToken: 'r2' })
  expect(store.get('workosToken')).toBe('new-workos')
  expect(store.get('refreshToken')).toBe('r2') // single use: the old one is burned
  expect(store.get('platformToken')).toBeUndefined()
  expect(store.get('platformTokenExp')).toBeUndefined()
})

test('a response with a platform access_token is cached with its expiry', async () => {
  const p = platformJwt()
  const client = stubClient(() => ({
    status: 200,
    body: { access_token: p, workos_access_token: 'new-workos', refresh_token: 'r2' }
  }))
  const store = storeWith({ workosToken: 'old', refreshToken: 'r1' })
  const result = await refreshSession({ client, store, env: {}, baseUrl: BASE })
  expect(result.platformToken).toBe(p)
  expect(store.get('platformToken')).toBe(p)
  expect(store.get('platformTokenExp')).toBeGreaterThan(Date.now())
  expect(store.get('workosToken')).toBe('new-workos')
  expect(store.get('refreshToken')).toBe('r2')
})

test('platform-token-only response leaves the workos token untouched', async () => {
  const p = platformJwt()
  const client = stubClient(() => ({ status: 200, body: { access_token: p, refresh_token: 'r2' } }))
  const store = storeWith({ workosToken: 'old', refreshToken: 'r1' })
  const result = await refreshSession({ client, store, env: {}, baseUrl: BASE })
  expect(result).toEqual({ workosToken: null, platformToken: p, refreshToken: 'r2' })
  expect(store.get('workosToken')).toBe('old')
  expect(store.get('refreshToken')).toBe('r2')
  expect(store.get('platformToken')).toBe(p)
})

test('failed refresh returns null and leaves the store untouched', async () => {
  const client = stubClient(() => ({ status: 400, body: { error: 'Token refresh failed' } }))
  const store = storeWith({ workosToken: 'old', refreshToken: 'burned' })
  const result = await refreshSession({ client, store, env: {}, baseUrl: BASE })
  expect(result).toBe(null)
  expect(store.get('workosToken')).toBe('old')
  expect(store.get('refreshToken')).toBe('burned')
})

test('losing a rotation race recovers the winner session on re-read', async () => {
  const backing = new MemBacking({ workosToken: 'old', refreshToken: 'burned' })
  const store = new Store(backing)
  const client = stubClient(() => {
    // Simulate a concurrent invocation winning the race while our request is
    // in flight: it rotated the session, and our token is now rejected.
    backing.set('workosToken', 'winner-workos')
    backing.set('refreshToken', 'winner-refresh')
    return { status: 400, body: { error: 'Token refresh failed' } }
  })
  const result = await refreshSession({ client, store, env: {}, baseUrl: BASE })
  expect(result).toEqual({ workosToken: 'winner-workos', platformToken: null })
  expect(store.get('refreshToken')).toBe('winner-refresh') // winner's pair intact
})

test('network failure during refresh returns null', async () => {
  const client = { fetch: async () => { throw new Error('offline') } }
  const store = storeWith({ workosToken: 'old', refreshToken: 'r1' })
  const result = await refreshSession({ client, store, env: {}, baseUrl: BASE })
  expect(result).toBe(null)
})
