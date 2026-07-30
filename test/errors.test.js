'use strict'

const { test, expect } = require('bun:test')
const { EXIT, classify, exitCodeFor, fail, failMessage } = require('../src/errors')
const { fakeErrio } = require('./helpers')

test('classify prefers an explicit kind over status', () => {
  const err = new Error('x')
  err.kind = 'network'
  err.status = 404
  expect(classify(err)).toBe('network')
})

test('classify falls back to HTTP status', () => {
  const e401 = new Error('unauthorized'); e401.status = 401
  const e404 = new Error('missing'); e404.status = 404
  const e500 = new Error('server'); e500.status = 500
  expect(classify(e401)).toBe('auth')
  expect(classify(e404)).toBe('not_found')
  expect(classify(e500)).toBe('error')
  expect(classify(new Error('plain'))).toBe('error')
})

test('exitCodeFor maps kinds to typed codes', () => {
  expect(exitCodeFor('auth')).toBe(EXIT.AUTH)
  expect(exitCodeFor('not_found')).toBe(EXIT.NOT_FOUND)
  expect(exitCodeFor('network')).toBe(EXIT.NETWORK)
  expect(exitCodeFor('error')).toBe(EXIT.ERROR)
  expect(exitCodeFor('anything-else')).toBe(EXIT.ERROR)
})

test('fail writes plain text without --json', () => {
  const e = fakeErrio()
  const err = new Error('boom')
  const code = fail({}, err, e.io)
  expect(code).toBe(1)
  expect(e.lines).toEqual(['boom'])
  expect(e.codes).toEqual([1])
})

test('fail writes structured JSON with --json', () => {
  const e = fakeErrio()
  const err = new Error('nope')
  err.status = 401
  err.code = 'UNAUTHENTICATED'
  const code = fail({ json: true }, err, e.io)
  expect(code).toBe(EXIT.AUTH)
  const parsed = JSON.parse(e.lines[0])
  expect(parsed.error.message).toBe('nope')
  expect(parsed.error.kind).toBe('auth')
  expect(parsed.error.status).toBe(401)
  expect(parsed.error.code).toBe('UNAUTHENTICATED')
})

test('fail tolerates non-Error values', () => {
  const e = fakeErrio()
  fail({}, 'string failure', e.io)
  expect(e.lines[0]).toBe('string failure')
})

test('failMessage writes text and a default exit code of 1', () => {
  const e = fakeErrio()
  const code = failMessage('nothing to do', e.io)
  expect(code).toBe(1)
  expect(e.lines).toEqual(['nothing to do'])
  expect(e.codes).toEqual([1])
})
