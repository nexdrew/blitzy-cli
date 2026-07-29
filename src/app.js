'use strict'

const { Store } = require('./store')
const { BlitzyApi } = require('./api')
const { createGh } = require('./gh')

// Build the real runtime dependencies (persistent store + API client + gh wrapper).
// Command run handlers call this; unit tests call the exported do*() logic with stubs.
function deps () {
  const store = new Store()
  const api = new BlitzyApi({ store })
  const gh = createGh()
  return { store, api, gh }
}

module.exports = { deps }
