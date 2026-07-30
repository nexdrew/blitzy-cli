'use strict'

const { test, expect } = require('bun:test')
const auth = require('../src/commands/auth')
const { Store } = require('../src/store')
const { MemBacking, makeJwt, captureLog, fakeContext, fakeErrio } = require('./helpers')

const NOW = 1_800_000_000_000 // fixed clock for deterministic expiry math
const liveJwt = () => makeJwt({ exp: (NOW + 3600e3) / 1000 })
const deadJwt = () => makeJwt({ exp: (NOW - 60e3) / 1000 })

function storeWith (data) {
  return new Store(new MemBacking(data))
}

test('doAuth reports an authenticated stored session', () => {
  const store = storeWith({
    email: 'a@b.com',
    workosToken: liveJwt(),
    refreshToken: 'r1',
    platformTokenExp: NOW + 1800e3
  })
  const s = auth.doAuth({}, { store, env: {}, now: () => NOW })
  expect(s.authenticated).toBe(true)
  expect(s.source).toBe('store')
  expect(s.email).toBe('a@b.com')
  expect(Date.parse(s.workosExpiresAt)).toBe(NOW + 3600e3)
  expect(Date.parse(s.platformExpiresAt)).toBe(NOW + 1800e3)
  expect(s.refreshTokenPresent).toBe(true)
})

test('doAuth counts an expired workos token WITH a refresh token as authenticated (auto-refresh)', () => {
  const store = storeWith({ workosToken: deadJwt(), refreshToken: 'r1' })
  const s = auth.doAuth({}, { store, env: {}, now: () => NOW })
  expect(s.authenticated).toBe(true)
  expect(s.refreshExpected).toBe(true)
  expect(s.source).toBe('store')
})

test('doAuth treats an expired workos token WITHOUT a refresh token as not authenticated', () => {
  const store = storeWith({ workosToken: deadJwt() })
  const s = auth.doAuth({}, { store, env: {}, now: () => NOW })
  expect(s.authenticated).toBe(false)
  expect(s.refreshExpected).toBe(false)
})

test('doAuth prefers BLITZY_TOKEN over the store', () => {
  const store = storeWith({ workosToken: deadJwt() })
  const s = auth.doAuth({}, { store, env: { BLITZY_TOKEN: liveJwt() }, now: () => NOW })
  expect(s.authenticated).toBe(true)
  expect(s.source).toBe('env')
  expect(s.platformExpiresAt).toBe(null) // env tokens never use the cached platform token
})

test('doAuth reports nothing stored as not authenticated', () => {
  const s = auth.doAuth({}, { store: storeWith({}), env: {}, now: () => NOW })
  expect(s.authenticated).toBe(false)
  expect(s.source).toBe(null)
  expect(s.workosExpiresAt).toBe(null)
})

test('auth handle prints status and exits 0 when authenticated', async () => {
  const e = fakeErrio()
  const store = storeWith({ workosToken: liveJwt() })
  const out = await captureLog(() => auth.handle({}, fakeContext(), { store, env: {}, now: () => NOW, errio: e.io }))
  expect(out).toContain('Authenticated.')
  expect(e.codes).toHaveLength(0)
})

test('auth handle still prints status but exits 2 when not authenticated', async () => {
  const e = fakeErrio()
  const out = await captureLog(() => auth.handle({}, fakeContext(), { store: storeWith({}), env: {}, now: () => NOW, errio: e.io }))
  expect(out).toContain('Not authenticated.')
  expect(out).toContain('blitzy login')
  expect(e.codes).toEqual([2])
})

test('auth handle --json emits the status object', async () => {
  const e = fakeErrio()
  const store = storeWith({ workosToken: liveJwt(), email: 'a@b.com' })
  const out = await captureLog(() => auth.handle({ json: true }, fakeContext(), { store, env: {}, now: () => NOW, errio: e.io }))
  const parsed = JSON.parse(out)
  expect(parsed.authenticated).toBe(true)
  expect(parsed.email).toBe('a@b.com')
})
