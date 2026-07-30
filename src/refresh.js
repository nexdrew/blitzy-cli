'use strict'

const { USER_AGENT } = require('./transport')
const { jwtExpMs } = require('./jwt')

// --- Blitzy session refresh --------------------------------------------------
//
// Confirmed from the platform web app (traffic capture + bundle inspection,
// 2026-07-30): the SPA refreshes an expiring session through Blitzy's own
// proxy endpoint,
//
//   POST {BLITZY_API_URL}/auth/refresh    body: { refresh_token }
//
// whose response may carry any of:
//   access_token         a fresh ~1h PLATFORM token (usable directly)
//   workos_access_token  a fresh ~24h WorkOS access token
//   refresh_token        the ROTATED refresh token
//
// (The bundle also embeds WorkOS AuthKit's public client — POST
// api.workos.com/user_management/authenticate with grant_type=refresh_token
// and client_id client_01KG5HZ34N0G3JZ5HPZZB4S99Z — but the app's own refresh
// path is the proxy above, so the CLI uses the same. BLITZY_REFRESH_URL
// overrides the endpoint if it ever moves.)
//
// Semantics:
//   1. Live-verified 2026-07-30: Blitzy's proxy currently returns a STABLE
//      refresh token (two consecutive refreshes succeeded with the same one).
//      The code still handles rotation defensively — WorkOS supports rotating
//      single-use refresh tokens, and Blitzy could enable that any time — by
//      persisting whatever the response carries before returning.
//   2. If rotation ever appears, two concurrent CLI invocations can race: the
//      loser's refresh token would be burned. Rather than a lockfile, callers
//      use re-read-and-retry: on refresh failure, re-read the store — if
//      another process rotated the session while we were trying, use its
//      fresh token.

function refreshUrl (env = process.env, baseUrl) {
  if (env.BLITZY_REFRESH_URL) return env.BLITZY_REFRESH_URL
  return baseUrl ? `${baseUrl}/auth/refresh` : null
}

// Shape the refresh request exactly as the web app does.
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

// Normalize the response body. `access_token` is the PLATFORM token here (the
// proxy's naming), not a WorkOS token.
function parseTokens (json) {
  if (!json) return null
  const out = {
    workosToken: json.workos_access_token || null,
    platformToken: json.access_token || null,
    refreshToken: json.refresh_token || null
  }
  if (!out.workosToken && !out.platformToken) return null
  return out
}

// Attempt a session refresh. On success, persists the rotated tokens to the
// store and returns { workosToken?, platformToken? }. Returns null when
// refresh isn't possible (no refresh token stored, endpoint unavailable, or
// the attempt failed). Never throws — callers fall back to "please log in".
async function refreshSession ({ client, store, env = process.env, baseUrl } = {}) {
  const url = refreshUrl(env, baseUrl)
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
    if (after && after !== before) return { workosToken: after, platformToken: null }
    return null
  }

  let json = null
  try { json = JSON.parse(await res.text()) } catch { return null }
  const tokens = parseTokens(json)
  if (!tokens) return null

  // Persist the rotation first (setSession also drops the cached platform
  // token), then cache the fresh platform token if the response included one.
  if (tokens.workosToken || tokens.refreshToken) {
    store.setSession({
      workosToken: tokens.workosToken || undefined,
      refreshToken: tokens.refreshToken || undefined
    })
  }
  if (tokens.platformToken) {
    store.setPlatformToken(tokens.platformToken, jwtExpMs(tokens.platformToken))
  }
  return tokens
}

module.exports = { refreshSession, refreshUrl, buildRequest, parseTokens }
