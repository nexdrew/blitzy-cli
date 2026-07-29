'use strict'

const readline = require('node:readline')

// Prompt for a line of visible input. Returns the trimmed answer.
function promptLine (question, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output, terminal: true })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

// Prompt for a secret without echoing it. We read raw keystrokes ourselves rather
// than using readline: readline with terminal:true redraws (and clears) the current
// line, which wipes a separately-written prompt label. Reading raw keeps the label
// on screen and the typed characters hidden.
function promptHidden (question, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve) => {
    output.write(question)

    const canRaw = input.isTTY && typeof input.setRawMode === 'function'
    const wasRaw = input.isRaw
    if (canRaw) input.setRawMode(true)
    input.resume()
    if (typeof input.setEncoding === 'function') input.setEncoding('utf8')

    let value = ''
    const cleanup = () => {
      input.removeListener('data', onData)
      if (canRaw) input.setRawMode(!!wasRaw)
      input.pause()
    }
    const done = () => {
      cleanup()
      output.write('\n')
      resolve(value)
    }
    const onData = (chunk) => {
      const str = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      for (const ch of str) {
        const code = ch.charCodeAt(0)
        if (ch === '\n' || ch === '\r' || code === 4) { // Enter / Ctrl-D
          done()
          return
        } else if (code === 3) { // Ctrl-C
          cleanup()
          output.write('\n')
          process.exit(130)
        } else if (code === 127 || ch === '\b') { // Backspace / Delete
          value = value.slice(0, -1)
        } else if (code >= 32) { // ignore other control chars
          value += ch
        }
      }
    }
    input.on('data', onData)
  })
}

module.exports = { promptLine, promptHidden }
