'use strict'

const Configstore = require('configstore')
const pkg = require('../package.json')

// Persisted credential keys. The password is NEVER stored.
const KEYS = ['email', 'userId', 'workosToken', 'refreshToken', 'platformToken', 'platformTokenExp']

class Store {
  // `backing` lets tests inject an in-memory object; production uses configstore,
  // which writes ~/.config/configstore/blitzy-cli.json with 0600 permissions.
  constructor (backing) {
    this._cs = backing || new Configstore(pkg.name)
  }

  get (key) {
    return this._cs.get(key)
  }

  set (key, value) {
    this._cs.set(key, value)
  }

  all () {
    const out = {}
    for (const k of KEYS) {
      const v = this._cs.get(k)
      if (v !== undefined) out[k] = v
    }
    return out
  }

  // Store the result of a successful login. Any of these may be omitted (e.g. a
  // token pasted via --token has only workosToken).
  setSession ({ email, userId, workosToken, refreshToken }) {
    if (email !== undefined) this._cs.set('email', email)
    if (userId !== undefined) this._cs.set('userId', userId)
    if (workosToken !== undefined) this._cs.set('workosToken', workosToken)
    if (refreshToken !== undefined) this._cs.set('refreshToken', refreshToken)
    // A new session invalidates any cached platform token.
    this._cs.delete('platformToken')
    this._cs.delete('platformTokenExp')
  }

  setPlatformToken (token, expMs) {
    this._cs.set('platformToken', token)
    if (expMs != null) this._cs.set('platformTokenExp', expMs)
    else this._cs.delete('platformTokenExp')
  }

  clear () {
    this._cs.clear()
  }

  get path () {
    return this._cs.path
  }
}

module.exports = { Store, KEYS }
