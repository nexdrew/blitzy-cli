'use strict'

const { deps } = require('../app')
const { output } = require('../format')
const { jwtExpMs } = require('../jwt')
const { fail } = require('../errors')

async function doWhoami (argv, { api, store, env = process.env }) {
  const profile = await api.profile()
  const platform = store && store.get('platformToken')
  const workos = env.BLITZY_TOKEN || (store && store.get('workosToken'))
  const iso = (ms) => (ms != null && isFinite(ms) ? new Date(ms).toISOString() : null)
  return {
    profile,
    tokenExpMs: platform ? jwtExpMs(platform) : null,
    viaEnv: !!env.BLITZY_TOKEN,
    // Session block for --json consumers (the profile fetch itself proves the
    // session works, so authenticated is always true on this path).
    session: {
      authenticated: true,
      source: env.BLITZY_TOKEN ? 'env' : 'store',
      workosExpiresAt: iso(workos ? jwtExpMs(workos) : null),
      platformExpiresAt: iso(platform ? jwtExpMs(platform) : null)
    }
  }
}

function renderWhoami ({ profile, tokenExpMs, viaEnv, session }) {
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ')
  console.log(`${name || '(no name)'} <${profile.email}>`)
  if (profile.company) console.log(`Company:  ${profile.company}`)
  if (profile.userRole) console.log(`Role:     ${profile.userRole}`)
  const plan = profile.subscription && profile.subscription.planName
  if (plan) console.log(`Plan:     ${plan}`)
  console.log(`Verified: ${profile.isVerified ? 'yes' : 'no'}`)
  console.log(`GitHub:   ${profile.isGithubAuthenticated ? 'connected' : 'not connected'}`)
  if (viaEnv) {
    console.log('Auth:     BLITZY_TOKEN (environment)')
  } else if (tokenExpMs) {
    const mins = Math.round((tokenExpMs - Date.now()) / 60000)
    console.log(`Session:  platform token ${mins > 0 ? `valid ~${mins} min` : 'expired (will refresh)'}`)
  }
  if (session && session.workosExpiresAt) {
    const hrs = Math.round((Date.parse(session.workosExpiresAt) - Date.now()) / 3600e3)
    console.log(`Login:    ${hrs > 0 ? `expires in ~${hrs} h` : 'expired'}`)
  }
}

async function handle (argv, context, d) {
  try {
    const result = await doWhoami(argv, d)
    output(argv, { ...result.profile, session: result.session }, () => renderWhoami(result))
  } catch (err) {
    return fail(argv, err, d.errio)
  }
}

module.exports = {
  flags: 'whoami',
  desc: 'Show the currently authenticated user',
  run: (argv, context) => handle(argv, context, deps()),
  handle,
  doWhoami,
  renderWhoami
}
