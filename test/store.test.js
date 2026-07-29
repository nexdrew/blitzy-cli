'use strict'

const { test, expect } = require('bun:test')
const { Store } = require('../src/store')
const { MemBacking } = require('./helpers')

test('setSession stores creds and clears any cached platform token', () => {
  const backing = new MemBacking({ platformToken: 'old', platformTokenExp: 123 })
  const store = new Store(backing)
  store.setSession({ email: 'a@b.com', userId: 'u1', workosToken: 'wtok', refreshToken: 'rtok' })
  expect(store.get('email')).toBe('a@b.com')
  expect(store.get('workosToken')).toBe('wtok')
  expect(store.get('refreshToken')).toBe('rtok')
  expect(store.get('platformToken')).toBeUndefined()
  expect(store.get('platformTokenExp')).toBeUndefined()
})

test('setSession with only a token leaves other keys unset', () => {
  const store = new Store(new MemBacking())
  store.setSession({ workosToken: 'wtok' })
  expect(store.get('workosToken')).toBe('wtok')
  expect(store.get('email')).toBeUndefined()
})

test('setPlatformToken stores token and expiry', () => {
  const store = new Store(new MemBacking())
  store.setPlatformToken('ptok', 1785169165000)
  expect(store.get('platformToken')).toBe('ptok')
  expect(store.get('platformTokenExp')).toBe(1785169165000)
})

test('all() returns only defined known keys', () => {
  const store = new Store(new MemBacking())
  store.setSession({ email: 'a@b.com', workosToken: 'wtok' })
  expect(store.all()).toEqual({ email: 'a@b.com', workosToken: 'wtok' })
})

test('clear() wipes everything', () => {
  const store = new Store(new MemBacking())
  store.setSession({ email: 'a@b.com', workosToken: 'wtok' })
  store.clear()
  expect(store.all()).toEqual({})
})
