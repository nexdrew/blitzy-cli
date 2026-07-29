'use strict'

// Decode a JWT payload without verifying the signature. We only read non-sensitive
// claims (like `exp`) to decide when to refresh; the server is the source of truth.
function decodeJwt (token) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8')
    return JSON.parse(json)
  } catch {
    return null
  }
}

// Returns the token's expiry as epoch milliseconds, or null if unknown.
function jwtExpMs (token) {
  const payload = decodeJwt(token)
  if (!payload || typeof payload.exp !== 'number') return null
  return payload.exp * 1000
}

module.exports = { decodeJwt, jwtExpMs }
