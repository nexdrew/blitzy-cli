'use strict'

const { USER_AGENT } = require('./transport')

// --- WorkOS session refresh -------------------------------------------------
//
// The 24h WorkOS access token stored by `blitzy login` eventually expires, and
// historically the only recovery was a fully interactive re-login. Login also
// returns a refresh_token, which this module uses to mint a new session.
//
// Two things a caller must know about WorkOS refresh semantics:
//   1. Refresh tokens are SINGLE-USE and ROTATE: a successful refresh returns a
//      new access token AND a new refresh token, invalidating the old one. We
//      persist the rotated pair immediately via store.setSession().
//   2. Because of (1), two concurrent CLI invocations can race: the loser's
//      refresh token is already burned. Rather than a lockfile, callers use
//      re-read-and-retry: on refresh failure, re-read the store — if another
//      process rotated the session while we were trying, use its fresh token.
//
// ENDPOINT STATUS: the exact refresh endpoint Blitzy's web app uses has not
// been confirmed yet (pending a browser traffic capture). The two candidates:
//   a. a Blitzy proxy, e.g. POST {BLITZY_API_URL}/auth/refresh
//   b. WorkOS public   POST https://api.workos.com/user_management/authenticate
//      with { grant_type: 'refresh_token', client_id, refresh_token }
// Until confirmed, refresh is DISABLED by default and activates only when
// BLITZY_REFRESH_URL is set (absolute URL, POSTed { refresh_token }). Once the
// capture lands, bake the real endpoint into DEFAULT_REFRESH_URL and shape the
// request in buildRequest() accordingly.
const DEFAULT_REFRESH_URL = null

function refreshUrl (env = process.env) {
  return env.BLITZY_REFRESH_URL || DEFAULT_REFRESH_URL
}

// Shape the refresh request. Kept separate so the confirmed endpoint's exact
// contract (WorkOS grant_type form vs Blitzy proxy JSON) lands in one place.
function buildRequest (url, refreshToken) {
  return {
    url,
    init: {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-blitzy-client': USER_AGENT
      },
      body: JSON.stringify({ refresh_token: refreshToken })
    }
  }
}

// Normalize the response body: tolerate either Blitzy naming
// (workos_access_token) or WorkOS naming (access_token).
function parseTokens (json) {
  if (!json) return null
  const workosToken = json.workos_access_token || json.access_token
  const refreshToken = json.refresh_token
  if (!workosToken || !refreshToken) return null
  return { workosToken, refreshToken }
}

// Attempt a session refresh. Returns the new workos access token on success,
// or null when refresh isn't possible (disabled, no refresh token stored, or
// the attempt failed). Never throws — callers fall back to "please log in".
async function refreshSession ({ client, store, env = process.env } = {}) {
  const url = refreshUrl(env)
  if (!url || !client || !store) return null

  const before = store.get('workosToken')
  const refreshToken = store.get('refreshToken')
  if (!refreshToken) return null

  let res
  try {
    const { url: u, init } = buildRequest(url, refreshToken)
    res = await client.fetch(u, init)
  } catch {
    return null
  }

  if (res.status >= 400) {
    // Possibly lost a rotation race to a concurrent invocation: re-read the
    // store and use the winner's session if one appeared.
    const after = store.get('workosToken')
    if (after && after !== before) return after
    return null
  }

  let json = null
  try { json = JSON.parse(await res.text()) } catch { return null }
  const tokens = parseTokens(json)
  if (!tokens) return null

  // Persist the rotated pair; setSession also drops the cached platform token.
  store.setSession({ workosToken: tokens.workosToken, refreshToken: tokens.refreshToken })
  return tokens.workosToken
}

module.exports = { refreshSession, refreshUrl, buildRequest, parseTokens, DEFAULT_REFRESH_URL }
