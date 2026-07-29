'use strict'

const { test, expect } = require('bun:test')
const { deps } = require('../src/app')

// deps() wires the real Store + BlitzyApi + gh wrapper. Constructing them reads no
// network and does not write config (configstore only writes on set), so this just
// verifies the shape of what command run handlers receive.
test('deps() returns a store, api client, and gh wrapper', () => {
  const d = deps()
  expect(d.store).toBeDefined()
  expect(typeof d.store.get).toBe('function')
  expect(typeof d.api.listProjects).toBe('function')
  expect(typeof d.api.downloadDocument).toBe('function')
  expect(typeof d.gh.available).toBe('function')
})
