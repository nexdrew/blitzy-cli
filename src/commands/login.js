'use strict'

const { deps } = require('../app')
const prompt = require('../prompt')
const { output } = require('../format')

async function doLogin (argv, { api, store, io = {}, prompts = prompt }) {
  const isTty = io.isTty !== undefined ? io.isTty : process.stdin.isTTY

  // Path 1: a WorkOS access token pasted via --token (also the CI escape hatch).
  if (argv.token) {
    store.setSession({ workosToken: argv.token })
    const profile = await api.profile() // exchanges + caches the platform token, and validates
    if (profile && profile.email) store.set('email', profile.email)
    if (profile && profile.id) store.set('userId', profile.id)
    return { profile, method: 'token' }
  }

  // Path 2: interactive email + password.
  let email = argv.email || (store && store.get('email'))
  if (!email) {
    if (!isTty) throw new Error('No email provided. Use --email, --token, or run in an interactive terminal.')
    email = await prompts.promptLine('Work email: ')
  }
  if (!email) throw new Error('Email is required.')

  const id = await api.identify(email)
  if (id && id.user_exists === false) {
    throw new Error(`No Blitzy account found for ${email}.`)
  }
  if (id && (id.sso_configured || (id.auth_mechanism && id.auth_mechanism !== 'Password'))) {
    throw new Error(
      `Account ${email} uses ${id.auth_provider || 'SSO'} sign-in, which this CLI can't perform directly yet. ` +
      'Sign in through the browser, then pass the token with `blitzy login --token <token>`.'
    )
  }

  if (!isTty) throw new Error('Password required. Run in an interactive terminal, or use --token.')
  const password = await prompts.promptHidden('Password: ')
  if (!password) throw new Error('Password is required.')

  const session = await api.login(email, password)
  store.setSession({
    email,
    userId: session.user_id,
    workosToken: session.workos_access_token,
    refreshToken: session.refresh_token
  })
  const profile = await api.profile()
  return { profile, method: 'password' }
}

function renderLogin ({ profile }) {
  const name = profile ? [profile.firstName, profile.lastName].filter(Boolean).join(' ') : ''
  const who = name && profile.email ? `${name} <${profile.email}>` : (profile && profile.email) || 'Blitzy'
  const at = profile && profile.company ? ` at ${profile.company}` : ''
  console.log(`Logged in as ${who}${at}.`)
}

module.exports = {
  flags: 'login',
  desc: 'Authenticate with Blitzy and store credentials',
  setup: (sywac) => {
    sywac
      .string('--email <email>', { desc: 'Work email (skips the prompt)' })
      .string('--token <token>', { desc: 'Use a WorkOS access token instead of email/password' })
  },
  run: async (argv, context) => {
    try {
      const result = await doLogin(argv, deps())
      output(argv, result.profile, () => renderLogin(result))
    } catch (err) {
      return context.cliMessage(err.message)
    }
  },
  doLogin,
  renderLogin
}
