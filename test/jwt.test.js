'use strict'

const { test, expect } = require('bun:test')
const { decodeJwt, jwtExpMs } = require('../src/jwt')
const { makeJwt } = require('./helpers')

test('decodeJwt reads the payload', () => {
  const token = makeJwt({ sub: 'user_1', exp: 1785169165 })
  expect(decodeJwt(token)).toEqual({ sub: 'user_1', exp: 1785169165 })
})

test('decodeJwt returns null for junk', () => {
  expect(decodeJwt('not-a-jwt')).toBeNull()
  expect(decodeJwt(null)).toBeNull()
  expect(decodeJwt(123)).toBeNull()
})

test('jwtExpMs converts exp seconds to ms', () => {
  expect(jwtExpMs(makeJwt({ exp: 1785169165 }))).toBe(1785169165000)
})

test('jwtExpMs returns null when no exp', () => {
  expect(jwtExpMs(makeJwt({ sub: 'x' }))).toBeNull()
  expect(jwtExpMs('garbage')).toBeNull()
})
