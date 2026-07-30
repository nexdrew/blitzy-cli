'use strict'

// In-memory stand-in for configstore, matching the subset of its API that Store uses.
class MemBacking {
  constructor (data = {}) { this.data = Object.assign({}, data) }
  get (k) { return this.data[k] }
  set (k, v) { this.data[k] = v }
  delete (k) { delete this.data[k] }
  clear () { this.data = {} }
  get path () { return '/dev/null' }
}

function makeResponse (status, body, headers = {}) {
  const lower = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  const asText = () => (body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body))
  return {
    status,
    headers: { get: (k) => (k.toLowerCase() in lower ? lower[k.toLowerCase()] : null) },
    text: async () => asText(),
    arrayBuffer: async () => {
      if (Buffer.isBuffer(body)) return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
      const buf = Buffer.from(asText())
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    }
  }
}

// Build a fetch-compatible stub. `handler(method, url, init)` returns
// { status, body, headers } (or undefined for a 404). Records every call.
function stubClient (handler) {
  const client = {
    name: 'stub',
    calls: [],
    fetch (url, init = {}) {
      const method = init.method || 'GET'
      client.calls.push({ method, url, init })
      const r = handler(method, url, init) || { status: 404, body: { message: 'not found', code: 404 } }
      return Promise.resolve(makeResponse(r.status, r.body, r.headers))
    },
    countOf (method, pathIncludes) {
      return client.calls.filter((c) => c.method === method && c.url.includes(pathIncludes)).length
    }
  }
  return client
}

// A route table keyed by "METHOD /path" (path matched by includes, ignoring query).
// Values are { status, body } or a function (url, init) => { status, body }.
function routeClient (routes) {
  return stubClient((method, url, init) => {
    // longest matching path wins, so "/projects/<id>" beats "/projects"
    const u = new URL(url)
    // Match on pathname.includes so route keys can omit the /v1 base prefix;
    // longest path wins so "/projects/<id>" beats "/projects".
    const candidates = Object.keys(routes)
      .filter((key) => {
        const [m, p] = key.split(' ')
        return m === method && u.pathname.includes(p)
      })
      .sort((a, b) => b.split(' ')[1].length - a.split(' ')[1].length)
    if (!candidates.length) return undefined
    const val = routes[candidates[0]]
    return typeof val === 'function' ? val(url, init) : val
  })
}

// Build an unsigned JWT with the given payload (for exp-decoding tests only).
function makeJwt (payload) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(payload)}.signature`
}

// Capture console.log output produced by `fn`.
async function captureLog (fn) {
  const lines = []
  const original = console.log
  console.log = (...args) => lines.push(args.join(' '))
  try {
    await fn()
  } finally {
    console.log = original
  }
  return lines.join('\n')
}

// Fake sywac context capturing cliMessage calls (which drive exit code 1).
function fakeContext () {
  const messages = []
  return {
    messages,
    cliMessage: (...args) => { messages.push(args) }
  }
}

// Fake error IO for src/errors.js fail()/failMessage(): captures stderr lines
// and exit codes instead of touching process. Pass `io` as d.errio in handlers.
function fakeErrio () {
  const lines = []
  const codes = []
  return {
    lines,
    codes,
    io: {
      stderr: (line) => lines.push(line),
      exit: (code) => codes.push(code)
    },
    get errio () { return this.io }
  }
}

module.exports = { MemBacking, stubClient, routeClient, makeJwt, captureLog, makeResponse, fakeContext, fakeErrio }
