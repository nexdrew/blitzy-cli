'use strict'

const { createTransport, USER_AGENT } = require('./transport')
const { jwtExpMs } = require('./jwt')

const DEFAULT_BASE_URL = 'https://platform.api.blitzy.com/v1'
// Refresh the 1h platform token a minute before it actually expires.
const EXP_SKEW_MS = 60 * 1000

class BlitzyApiError extends Error {
  constructor (message, { status, code, body } = {}) {
    super(message)
    this.name = 'BlitzyApiError'
    this.status = status
    this.code = code
    this.body = body
  }
}

// Bounded-concurrency map: runs `fn` over `items`, at most `limit` in flight,
// preserving input order in the result array.
async function mapLimit (items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  async function worker () {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  const size = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: size }, worker))
  return results
}

class BlitzyApi {
  constructor ({ client, store, baseUrl, env } = {}) {
    this.env = env || process.env
    this.client = client || createTransport()
    this.store = store
    this.baseUrl = baseUrl || this.env.BLITZY_API_URL || DEFAULT_BASE_URL
  }

  async request (method, path, { token, body, query } = {}) {
    const url = new URL(this.baseUrl + path)
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
      }
    }
    const headers = { accept: 'application/json', 'x-blitzy-client': USER_AGENT }
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (token) headers.authorization = `Bearer ${token}`

    let res
    try {
      res = await this.client.fetch(url.toString(), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      })
    } catch (err) {
      throw new BlitzyApiError(`Network error: ${err.message}`, {})
    }

    if (res.status === 403 && res.headers && res.headers.get && res.headers.get('cf-mitigated')) {
      throw new BlitzyApiError(
        'Blocked by Cloudflare bot protection. The default transport (impit) should pass; ' +
        'if you set BLITZY_TRANSPORT=fetch, unset it.',
        { status: 403 }
      )
    }

    const text = await res.text()
    let json = null
    if (text) {
      try { json = JSON.parse(text) } catch { json = null }
    }

    if (res.status >= 400) {
      const message = (json && (json.message || json.error)) || `HTTP ${res.status}`
      throw new BlitzyApiError(message, { status: res.status, code: json && json.code, body: json })
    }
    return json
  }

  // --- unauthenticated auth endpoints ---

  identify (email) {
    return this.request('GET', '/auth/identify', { query: { email } })
  }

  // POST /v1/auth/login { email, password }
  //   -> { refresh_token, user_id, workos_access_token }
  login (email, password) {
    return this.request('POST', '/auth/login', { body: { email, password } })
  }

  // POST /v1/auth  (Authorization: Bearer <workos_access_token>)
  //   -> { access_token }   the 1h platform JWT used by every other call
  exchange (workosToken) {
    return this.request('POST', '/auth', { token: workosToken })
  }

  // --- token management ---

  // Returns a valid platform JWT, exchanging/refreshing as needed. Precedence:
  //   1. BLITZY_TOKEN env var (treated as a workos_access_token) -> always exchanged
  //   2. cached, unexpired platform token from the store
  //   3. stored workos_access_token -> exchanged and cached
  async platformToken () {
    const envToken = this.env.BLITZY_TOKEN
    if (envToken) {
      const { access_token: accessToken } = await this.exchange(envToken)
      return accessToken
    }
    if (!this.store) throw new BlitzyApiError('Not logged in. Run `blitzy login` first.')

    const cached = this.store.get('platformToken')
    const exp = this.store.get('platformTokenExp')
    if (cached && exp && Date.now() < exp - EXP_SKEW_MS) return cached

    const workos = this.store.get('workosToken')
    if (!workos) throw new BlitzyApiError('Not logged in. Run `blitzy login` first.')

    const { access_token: accessToken } = await this.exchange(workos)
    this.store.setPlatformToken(accessToken, jwtExpMs(accessToken))
    return accessToken
  }

  async authed (method, path, opts = {}) {
    const token = await this.platformToken()
    return this.request(method, path, Object.assign({}, opts, { token }))
  }

  // --- resources ---

  profile () {
    return this.authed('GET', '/user/profile')
  }

  usage () {
    return this.authed('GET', '/subscriptions/usage')
  }

  // Reusable rules. List -> { rules: [{ id, name, scope }], totalCount };
  // detail -> { id, name, content, scope?, projects: [...], created_at, updated_at, ... }.
  listRules () {
    return this.authed('GET', '/rules')
  }

  getRule (id) {
    return this.authed('GET', `/rules/${id}`)
  }

  // Environments. List -> { environments: [{ id, name, revision }] };
  // detail -> { id, name, revision, target_os, instructions, variables, secrets, projects, ... }.
  listEnvironments () {
    return this.authed('GET', '/environments')
  }

  getEnvironment (id) {
    return this.authed('GET', `/environments/${id}`)
  }

  listProjects ({ page = 1, limit = 20, isArchived = false, sort = '-updatedAt' } = {}) {
    return this.authed('GET', '/projects', { query: { page, limit, isArchived, sort } })
  }

  getProject (id) {
    return this.authed('GET', `/projects/${id}`)
  }

  // GitHub repos linked to a project (SOURCE and TARGET). Note the singular
  // `/project/` path, unlike the plural `/projects/:id` detail endpoint.
  projectRepos (id) {
    return this.authed('GET', `/project/${id}/github/repos`)
  }

  // Per-run metering, which also carries each run's PR (number/link/status).
  projectRuns (id) {
    return this.authed('GET', `/project/${id}/runs/metering`)
  }

  // Fetch a project's detail plus its GitHub repos and runs (for PR info),
  // tolerating a failure of either auxiliary call.
  async getProjectFull (id) {
    const [project, repos, runs] = await Promise.all([
      this.getProject(id),
      this.projectRepos(id).catch(() => null),
      this.projectRuns(id).catch(() => null)
    ])
    return { project, repos, runs }
  }

  // Download one generated document as raw bytes. Requesting a single document
  // returns the raw file (e.g. text/markdown or application/pdf); requesting
  // multiple returns a zip, so we always request exactly one and get a raw file.
  // Returns { status, contentType, buffer }. Throws BlitzyApiError on HTTP error
  // (callers treat that as "this document isn't available").
  async downloadDocument (id, documentType, fileExtension) {
    const token = await this.platformToken()
    const url = `${this.baseUrl}/projects/${id}/documents/download`
    const body = JSON.stringify({ document_types: [{ document_type: documentType, file_extension: fileExtension }] })
    let res
    try {
      res = await this.client.fetch(url, {
        method: 'POST',
        headers: {
          accept: '*/*',
          'content-type': 'application/json',
          'x-blitzy-client': USER_AGENT,
          authorization: `Bearer ${token}`
        },
        body
      })
    } catch (err) {
      throw new BlitzyApiError(`Network error: ${err.message}`, {})
    }
    if (res.status === 403 && res.headers && res.headers.get && res.headers.get('cf-mitigated')) {
      throw new BlitzyApiError('Blocked by Cloudflare bot protection.', { status: 403 })
    }
    const buffer = Buffer.from(await res.arrayBuffer())
    if (res.status >= 400) {
      let message = `HTTP ${res.status}`
      try {
        const json = JSON.parse(buffer.toString('utf8'))
        message = json.message || json.error || message
      } catch { /* non-JSON error body */ }
      throw new BlitzyApiError(message, { status: res.status })
    }
    return { status: res.status, contentType: (res.headers.get && res.headers.get('content-type')) || '', buffer }
  }

  // The list endpoint returns only { id, pinned } per project, so -- like the web
  // app -- we fan out a detail call per id (bounded concurrency) to get names/status.
  async listProjectsDetailed (opts, { concurrency = 8 } = {}) {
    const list = await this.listProjects(opts)
    const stubs = (list && list.projects) || []
    const details = await mapLimit(stubs, concurrency, async (stub) => {
      try {
        const full = await this.getProject(stub.id)
        // The list query is authoritative for `pinned`; keep it over the detail copy.
        return Object.assign({}, full, { pinned: stub.pinned })
      } catch (err) {
        return { id: stub.id, pinned: stub.pinned, _error: err.message }
      }
    })
    return Object.assign({}, list, { projects: details })
  }
}

module.exports = { BlitzyApi, BlitzyApiError, mapLimit, DEFAULT_BASE_URL }
