'use strict'

const { deps } = require('../app')
const { output } = require('../format')

async function doLogout (argv, { store, env = process.env }) {
  const had = !!(store.get('workosToken') || store.get('email'))
  store.clear()
  return { loggedOut: had, viaEnv: !!env.BLITZY_TOKEN }
}

function renderLogout ({ loggedOut, viaEnv }) {
  console.log(loggedOut ? 'Logged out.' : 'No stored credentials to clear.')
  if (viaEnv) console.log('Note: BLITZY_TOKEN is still set in your environment and will still authenticate.')
}

module.exports = {
  flags: 'logout',
  desc: 'Clear stored credentials',
  run: async (argv, context) => {
    try {
      const result = await doLogout(argv, deps())
      output(argv, result, () => renderLogout(result))
    } catch (err) {
      return context.cliMessage(err.message)
    }
  },
  doLogout,
  renderLogout
}
