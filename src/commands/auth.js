'use strict'

const { deps } = require('../app')
const { output } = require('../format')
const { jwtExpMs } = require('../jwt')
const { fail, EXIT } = require('../errors')

// Local-only auth pre-flight: reports stored-session state without any network
// call, so scripts can check "am I logged in?" cheaply before doing real work.
// Exit code 0 when authenticated, 2 (auth) when not — the status still prints
// either way. Note this reads token expiry claims locally; a token revoked
// server-side before its exp will still show as authenticated here.
function doAuth (argv, { store, env = process.env, now = Date.now }) {
  const envToken = env.BLITZY_TOKEN
  const storedToken = store && store.get('workosToken')
  const source = envToken ? 'env' : storedToken ? 'store' : null
  const workosToken = envToken || storedToken || null

  const workosExpMs = workosToken ? jwtExpMs(workosToken) : null
  const platformExpMs = source === 'store' ? (store.get('platformTokenExp') || null) : null

  // Authenticated = a WorkOS token that isn't visibly expired, OR an expired
  // one with a refresh token present — commands refresh the session
  // automatically on their next API call. (A refresh token that the server
  // would reject can't be detected locally, so that case is optimistic.)
  const expired = !!(workosExpMs && workosExpMs <= now())
  const refreshTokenPresent = !!(store && store.get('refreshToken'))
  const refreshExpected = expired && source === 'store' && refreshTokenPresent
  const authenticated = !!workosToken && (!expired || refreshExpected)

  const iso = (ms) => (ms != null && isFinite(ms) ? new Date(ms).toISOString() : null)
  return {
    authenticated,
    source,
    email: (store && store.get('email')) || null,
    workosExpiresAt: iso(workosExpMs),
    platformExpiresAt: iso(platformExpMs),
    refreshTokenPresent,
    refreshExpected
  }
}

function renderAuth (s) {
  const line = (label, value) => { if (value !== undefined && value !== null && value !== '') console.log(`${label.padEnd(16)}${value}`) }
  console.log(s.authenticated ? 'Authenticated.' : 'Not authenticated.')
  line('Source', s.source === 'env' ? 'BLITZY_TOKEN (environment)' : s.source === 'store' ? 'stored login' : null)
  line('Email', s.email)
  line('Login expires', s.workosExpiresAt)
  line('Token expires', s.platformExpiresAt)
  line('Refresh token', s.refreshTokenPresent ? 'present' : 'absent')
  if (s.refreshExpected) console.log('\nLogin expired; the session will refresh automatically on the next command.')
  if (!s.authenticated) console.log('\nRun `blitzy login` to authenticate.')
}

async function handle (argv, context, d) {
  try {
    const status = doAuth(argv, d)
    output(argv, status, () => renderAuth(status))
    if (!status.authenticated) {
      const io = d.errio
      if (io && io.exit) io.exit(EXIT.AUTH)
      else process.exitCode = EXIT.AUTH
    }
  } catch (err) {
    return fail(argv, err, d.errio)
  }
}

module.exports = {
  flags: 'auth',
  desc: 'Show local authentication status without calling the API (exit 2 if not authed)',
  run: (argv, context) => handle(argv, context, deps()),
  handle,
  doAuth,
  renderAuth
}
