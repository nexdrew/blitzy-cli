'use strict'

const { deps } = require('../app')
const prompt = require('../prompt')
const { output } = require('../format')
const { fail } = require('../errors')

const BROWSER_HINT = 'Sign in through the browser, then run `blitzy login --token <token> --refresh-token <token>`.'

// Verify the email code. In an interactive terminal, a wrong code gets another
// prompt while the server reports attempts left. A code given via --code gets
// one attempt only.
async function verifyCode (api, email, code, ask) {
  for (;;) {
    try {
      return await api.verifyCode(email, code)
    } catch (err) {
      if (err.code === 'SSO_REQUIRED') {
        err.message = `Account ${email} must sign in with SSO, which this CLI cannot do. ${BROWSER_HINT}`
        throw err
      }
      const left = err.body && err.body.attempts_left
      if (!ask || err.code !== 'CODE_INVALID' || !(left > 0)) throw err
      code = await ask(`Incorrect code (${left} ${left === 1 ? 'try' : 'tries'} left). Sign-in code: `)
      if (!code) throw new Error('Sign-in code is required.')
    }
  }
}

async function doLogin (argv, { api, store, io = {}, prompts = prompt }) {
  const isTty = io.isTty !== undefined ? io.isTty : process.stdin.isTTY
  const refreshToken = argv['refresh-token']

  // Path 1: tokens copied from a browser session (--token, optionally with
  // --refresh-token). Without a refresh token the session cannot renew itself.
  // A refresh token from an earlier login must not stay with the new token,
  // so it is set to null when --refresh-token is absent.
  if (argv.token) {
    store.setSession({ workosToken: argv.token, refreshToken: refreshToken || null })
    const profile = await api.profile() // exchanges + caches the platform token, and validates
    if (profile && profile.email) store.set('email', profile.email)
    if (profile && profile.id) store.set('userId', profile.id)
    return { profile, method: 'token' }
  }
  if (refreshToken) throw new Error('Use --refresh-token together with --token.')

  // Path 2: email code. Blitzy sends a 6-digit code to the email address.
  let email = argv.email || (store && store.get('email'))
  if (!email) {
    if (!isTty) throw new Error('No email provided. Use --email, --token, or run in an interactive terminal.')
    email = await prompts.promptLine('Work email: ')
  }
  if (!email) throw new Error('Email is required.')

  // With --code, the code is already known: do not send a new one.
  let code = argv.code
  let ask = null
  if (!code) {
    await api.requestCode(email)
    // No terminal to ask for the code: stop here. A second run with --code completes the login.
    if (!isTty) return { codeSent: true, email }
    ask = prompts.promptLine
    code = await ask(`Sign-in code sent to ${email}: `)
    if (!code) throw new Error('Sign-in code is required.')
  }

  const session = await verifyCode(api, email, String(code).trim(), ask)
  if (!session || !session.workos_access_token) {
    const step = session && session.next_step ? ` (next step: ${session.next_step})` : ''
    throw new Error(`Blitzy did not return a session for ${email}${step}. ${BROWSER_HINT}`)
  }
  store.setSession({
    email,
    userId: session.user_id,
    workosToken: session.workos_access_token,
    refreshToken: session.refresh_token
  })
  const profile = await api.profile()
  return { profile, method: 'code' }
}

function renderLogin ({ profile, codeSent, email }) {
  if (codeSent) {
    console.log(`Sign-in code sent to ${email}.`)
    console.log(`To complete the login, run: blitzy login --email ${email} --code <code>`)
    return
  }
  const name = profile ? [profile.firstName, profile.lastName].filter(Boolean).join(' ') : ''
  const who = name && profile.email ? `${name} <${profile.email}>` : (profile && profile.email) || 'Blitzy'
  const at = profile && profile.company ? ` at ${profile.company}` : ''
  console.log(`Logged in as ${who}${at}.`)
}

async function handle (argv, context, d) {
  try {
    const result = await doLogin(argv, d)
    output(argv, result.codeSent ? result : result.profile, () => renderLogin(result))
  } catch (err) {
    return fail(argv, err, d.errio)
  }
}

module.exports = {
  flags: 'login',
  desc: 'Authenticate with Blitzy and store credentials',
  setup: (sywac) => {
    sywac
      .string('--email <email>', { desc: 'Work email (skips the prompt)' })
      .string('--code <code>', { desc: 'Sign-in code from the email (completes the login without a prompt)' })
      .string('--token <token>', { desc: 'Use a WorkOS access token from a browser session' })
      .string('--refresh-token <token>', { desc: 'With --token: the refresh token from the same browser session' })
  },
  run: (argv, context) => handle(argv, context, deps()),
  handle,
  doLogin,
  renderLogin
}
