'use strict'

const { deps } = require('../app')
const { output } = require('../format')
const { jwtExpMs } = require('../jwt')

async function doWhoami (argv, { api, store, env = process.env }) {
  const profile = await api.profile()
  const platform = store && store.get('platformToken')
  return {
    profile,
    tokenExpMs: platform ? jwtExpMs(platform) : null,
    viaEnv: !!env.BLITZY_TOKEN
  }
}

function renderWhoami ({ profile, tokenExpMs, viaEnv }) {
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
}

async function handle (argv, context, d) {
  try {
    const result = await doWhoami(argv, d)
    output(argv, result.profile, () => renderWhoami(result))
  } catch (err) {
    return context.cliMessage(err.message)
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
