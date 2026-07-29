'use strict'

const pkg = require('../package.json')

const USER_AGENT = `${pkg.name}/${pkg.version}`

// The Blitzy API host sits behind Cloudflare Bot Management, which challenges any
// client whose TLS/HTTP2 fingerprint is not a real browser's -- a valid token does
// not help, because the challenge happens at the edge before the origin sees it.
// `impit` impersonates a browser fingerprint and passes; plain fetch does not.
// The fetch transport is kept as an escape hatch for the day Blitzy allow-lists a
// non-browser client (e.g. a WAF skip rule keyed on the x-blitzy-client header).
function createImpitClient () {
  const { Impit } = require('impit')
  const impit = new Impit({ browser: 'chrome' })
  return {
    name: 'impit',
    fetch: (url, init) => impit.fetch(url, init)
  }
}

function createFetchClient () {
  return {
    name: 'fetch',
    fetch: (url, init = {}) => {
      const headers = Object.assign({ 'user-agent': USER_AGENT }, init.headers)
      return fetch(url, Object.assign({}, init, { headers }))
    }
  }
}

function createTransport (kind) {
  if ((kind || process.env.BLITZY_TRANSPORT) === 'fetch') return createFetchClient()
  return createImpitClient()
}

module.exports = { createTransport, createImpitClient, createFetchClient, USER_AGENT }
