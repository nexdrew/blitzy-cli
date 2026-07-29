'use strict'

const { test, expect } = require('bun:test')
const { EventEmitter } = require('node:events')
const { promptHidden } = require('../src/prompt')

const DEL = String.fromCharCode(127)

// Minimal fake of a TTY stdin that emits the given chunks on the next tick.
function fakeTtyInput (chunks) {
  const ee = new EventEmitter()
  ee.isTTY = true
  ee.isRaw = false
  ee.setRawMode = (v) => { ee.isRaw = v; return ee }
  ee.setEncoding = () => {}
  ee.resume = () => { setImmediate(() => { for (const c of chunks) ee.emit('data', Buffer.from(c)) }) }
  ee.pause = () => {}
  return ee
}

function fakeOutput () {
  const o = { buf: '', write: (s) => { o.buf += s; return true } }
  return o
}

test('promptHidden shows the label and returns the typed value', async () => {
  const input = fakeTtyInput(['sec', 'ret\n'])
  const output = fakeOutput()
  const value = await promptHidden('Password: ', { input, output })
  expect(value).toBe('secret')
  expect(output.buf).toContain('Password: ')
})

test('promptHidden does not echo the secret', async () => {
  const input = fakeTtyInput(['hunter2\r'])
  const output = fakeOutput()
  await promptHidden('Password: ', { input, output })
  expect(output.buf).not.toContain('hunter2')
})

test('promptHidden handles backspace', async () => {
  const input = fakeTtyInput([`abcx${DEL}\n`]) // type abcx, delete the x, then enter
  const output = fakeOutput()
  const value = await promptHidden('Password: ', { input, output })
  expect(value).toBe('abc')
})

test('promptHidden restores raw mode afterwards', async () => {
  const input = fakeTtyInput(['pw\n'])
  const output = fakeOutput()
  await promptHidden('Password: ', { input, output })
  expect(input.isRaw).toBe(false)
})
