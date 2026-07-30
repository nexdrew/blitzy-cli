'use strict'

const { test, expect } = require('bun:test')
const { BlitzyApi, BlitzyApiError, mapLimit } = require('../src/api')
const { Store } = require('../src/store')
const { MemBacking, stubClient, routeClient, makeJwt, makeResponse } = require('./helpers')

const profile = require('./fixtures/profile.json')
const projectsList = require('./fixtures/projects-list.json')
const projectDetail = require('./fixtures/project-detail.json')

const futureJwt = () => makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })

function apiWith (routes, { store, env } = {}) {
  const client = routeClient(routes)
  const api = new BlitzyApi({ client, store, env: env || {} })
  return { api, client }
}

test('request throws BlitzyApiError with server message on 4xx', async () => {
  const { api } = apiWith({ 'GET /auth/identify': { status: 401, body: { message: 'Jwt is missing', code: 401 } } })
  await expect(api.identify('a@b.com')).rejects.toThrow('Jwt is missing')
})

test('request wraps a transport failure as a network BlitzyApiError', async () => {
  const client = { fetch: () => Promise.reject(new Error('ECONNREFUSED')) }
  const api = new BlitzyApi({ client, env: {} })
  await expect(api.identify('a@b.com')).rejects.toThrow(/Network error: ECONNREFUSED/)
})

test('downloadDocument wraps a transport failure as a network error', async () => {
  const client = {
    fetch: (url) => url.includes('/auth')
      ? Promise.resolve(makeResponse(200, { access_token: futureJwt() }))
      : Promise.reject(new Error('ECONNRESET'))
  }
  const store = new Store(new MemBacking({ workosToken: 'wtok' }))
  const api = new BlitzyApi({ client, store, env: {} })
  await expect(api.downloadDocument('pid', 'project_guide', 'md')).rejects.toThrow(/Network error/)
})

test('request surfaces a Cloudflare challenge distinctly', async () => {
  const client = stubClient(() => ({ status: 403, body: '<html>challenge</html>', headers: { 'cf-mitigated': 'challenge' } }))
  const api = new BlitzyApi({ client, env: {} })
  await expect(api.identify('a@b.com')).rejects.toThrow(/Cloudflare/)
})

test('identify sends the email as a query param', async () => {
  const { api, client } = apiWith({ 'GET /auth/identify': { status: 200, body: { auth_mechanism: 'Password', user_exists: true } } })
  await api.identify('andrew.goode@livtech.com')
  expect(client.calls[0].url).toContain('email=andrew.goode%40livtech.com')
})

test('login posts email and password', async () => {
  const { api, client } = apiWith({
    'POST /auth/login': (url, init) => {
      const body = JSON.parse(init.body)
      expect(body).toEqual({ email: 'a@b.com', password: 'secret' })
      return { status: 200, body: { refresh_token: 'r', user_id: 'user_1', workos_access_token: 'w' } }
    }
  })
  const out = await api.login('a@b.com', 'secret')
  expect(out.workos_access_token).toBe('w')
  expect(client.calls[0].init.method).toBe('POST')
})

test('platformToken exchanges the stored workos token and caches the result', async () => {
  const jwt = futureJwt()
  const store = new Store(new MemBacking({ workosToken: 'wtok' }))
  const { api, client } = apiWith({
    'POST /auth': { status: 200, body: { access_token: jwt } },
    'GET /user/profile': { status: 200, body: profile }
  }, { store })

  await api.profile()
  await api.profile()

  // Exchange should happen once; the cached platform token serves the second call.
  expect(client.countOf('POST', '/auth')).toBe(1)
  expect(store.get('platformToken')).toBe(jwt)
})

test('platformToken re-exchanges when the cached token is expired', async () => {
  const expired = makeJwt({ exp: Math.floor(Date.now() / 1000) - 10 })
  const fresh = futureJwt()
  const store = new Store(new MemBacking({ workosToken: 'wtok', platformToken: expired, platformTokenExp: Date.now() - 10000 }))
  const { api, client } = apiWith({
    'POST /auth': { status: 200, body: { access_token: fresh } },
    'GET /user/profile': { status: 200, body: profile }
  }, { store })

  await api.profile()
  expect(client.countOf('POST', '/auth')).toBe(1)
  expect(store.get('platformToken')).toBe(fresh)
})

test('BLITZY_TOKEN env overrides the store and is exchanged each call', async () => {
  const { api, client } = apiWith({
    'POST /auth': { status: 200, body: { access_token: futureJwt() } },
    'GET /user/profile': { status: 200, body: profile }
  }, { env: { BLITZY_TOKEN: 'env-wtok' } })

  await api.profile()
  expect(client.calls[0].init.headers.authorization).toBe('Bearer env-wtok')
})

test('not logged in without a token or store', async () => {
  const api = new BlitzyApi({ client: stubClient(() => undefined), env: {} })
  await expect(api.profile()).rejects.toThrow(/Not logged in/)
})

test('listProjectsDetailed fans out one detail call per project, order preserved', async () => {
  const store = new Store(new MemBacking({ workosToken: 'wtok' }))
  const { api, client } = apiWith({
    'POST /auth': { status: 200, body: { access_token: futureJwt() } },
    'GET /projects/': (url) => {
      const id = url.split('/projects/')[1].split('?')[0]
      return { status: 200, body: Object.assign({}, projectDetail, { id, name: `Project ${id.slice(0, 4)}` }) }
    },
    'GET /projects': { status: 200, body: projectsList }
  }, { store })

  const out = await api.listProjectsDetailed()
  expect(out.projects).toHaveLength(3)
  expect(out.projects.map((p) => p.id)).toEqual(projectsList.projects.map((p) => p.id))
  expect(out.projects[0].name).toBe('Project 5093')
  expect(out.projects[1].pinned).toBe(true) // carried from the list stub
  expect(client.countOf('GET', '/projects/')).toBe(3)
})

test('listProjectsDetailed tolerates a failed detail call', async () => {
  const store = new Store(new MemBacking({ workosToken: 'wtok' }))
  const { api } = apiWith({
    'POST /auth': { status: 200, body: { access_token: futureJwt() } },
    'GET /projects/5d6057a8-742d-40fa-b731-c9a6c20b6e61': { status: 500, body: { message: 'boom' } },
    'GET /projects/': (url) => {
      const id = url.split('/projects/')[1].split('?')[0]
      return { status: 200, body: Object.assign({}, projectDetail, { id }) }
    },
    'GET /projects': { status: 200, body: projectsList }
  }, { store })

  const out = await api.listProjectsDetailed()
  const failed = out.projects.find((p) => p.id === '5d6057a8-742d-40fa-b731-c9a6c20b6e61')
  expect(failed._error).toBeDefined()
})

test('getProjectFull returns detail even when repos/runs calls fail', async () => {
  const store = new Store(new MemBacking({ workosToken: 'wtok' }))
  const { api } = apiWith({
    'POST /auth': { status: 200, body: { access_token: futureJwt() } },
    'GET /github/repos': { status: 500, body: { message: 'boom' } },
    'GET /runs/metering': { status: 500, body: { message: 'boom' } },
    'GET /projects/': { status: 200, body: projectDetail }
  }, { store })
  const full = await api.getProjectFull('50930af1-5165-41e6-89a3-7d4445ba4593')
  expect(full.project.name).toBe('AloraDL Native Port')
  expect(full.repos).toBeNull()
  expect(full.runs).toBeNull()
})

test('getProjectFull aggregates detail, repos, and runs', async () => {
  const store = new Store(new MemBacking({ workosToken: 'wtok' }))
  const { api } = apiWith({
    'POST /auth': { status: 200, body: { access_token: futureJwt() } },
    'GET /github/repos': { status: 200, body: [{ type: 'TARGET', orgName: 'Org', repoName: 'repo', branchName: 'main' }] },
    'GET /runs/metering': { status: 200, body: { runs: [{ created_at: 1, pr_number: 7, pr_link: 'x', pr_status: 'OPEN' }] } },
    'GET /projects/': { status: 200, body: projectDetail }
  }, { store })
  const full = await api.getProjectFull('50930af1-5165-41e6-89a3-7d4445ba4593')
  expect(full.repos[0].repoName).toBe('repo')
  expect(full.runs.runs[0].pr_number).toBe(7)
})

test('mapLimit preserves order and respects the concurrency cap', async () => {
  let inFlight = 0
  let peak = 0
  const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
    inFlight++
    peak = Math.max(peak, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 5))
    inFlight--
    return n * 10
  })
  expect(out).toEqual([10, 20, 30, 40, 50, 60])
  expect(peak).toBeLessThanOrEqual(2)
})

test('BlitzyApiError carries status and code', async () => {
  const { api } = apiWith({ 'GET /auth/identify': { status: 429, body: { message: 'slow down', code: 429 } } })
  try {
    await api.identify('a@b.com')
    throw new Error('should have thrown')
  } catch (err) {
    expect(err).toBeInstanceOf(BlitzyApiError)
    expect(err.status).toBe(429)
    expect(err.code).toBe(429)
  }
})

// --- v1.1: session refresh integration in platformToken ---

const REFRESH_URL = 'https://example.test/auth/refresh'
const expiredJwt = () => makeJwt({ exp: Math.floor(Date.now() / 1000) - 60 })

test('platformToken refreshes an expired workos session before exchanging', async () => {
  const store = new Store(new MemBacking({ workosToken: expiredJwt(), refreshToken: 'r1' }))
  const exchanged = []
  const { api } = apiWith({
    'POST /auth/refresh': { status: 200, body: { workos_access_token: 'fresh-workos', refresh_token: 'r2' } },
    'POST /auth': (url, init) => {
      exchanged.push(init.headers.authorization)
      return init.headers.authorization === 'Bearer fresh-workos'
        ? { status: 200, body: { access_token: futureJwt() } }
        : { status: 401, body: { message: 'Jwt is expired' } }
    }
  }, { store, env: { BLITZY_REFRESH_URL: REFRESH_URL } })

  const token = await api.platformToken()
  expect(token).toBeTruthy()
  expect(exchanged).toEqual(['Bearer fresh-workos']) // never wasted a 401 on the dead token
  expect(store.get('workosToken')).toBe('fresh-workos')
  expect(store.get('refreshToken')).toBe('r2')
})

test('platformToken retries via refresh when the exchange 401s unexpectedly', async () => {
  // Opaque workos token (no exp claim) revoked server-side: the pre-check can't
  // see it, so the first exchange 401s and the refresh retry kicks in.
  const store = new Store(new MemBacking({ workosToken: 'revoked-opaque', refreshToken: 'r1' }))
  const { api } = apiWith({
    'POST /auth/refresh': { status: 200, body: { workos_access_token: 'fresh-workos', refresh_token: 'r2' } },
    'POST /auth': (url, init) => (init.headers.authorization === 'Bearer fresh-workos'
      ? { status: 200, body: { access_token: futureJwt() } }
      : { status: 401, body: { message: 'Jwt is expired' } })
  }, { store, env: { BLITZY_REFRESH_URL: REFRESH_URL } })

  const token = await api.platformToken()
  expect(token).toBeTruthy()
  expect(store.get('refreshToken')).toBe('r2')
})

test('a refresh response carrying a platform access_token skips the exchange', async () => {
  const store = new Store(new MemBacking({ workosToken: expiredJwt(), refreshToken: 'r1' }))
  const platform = futureJwt()
  const exchanges = []
  const { api } = apiWith({
    // Default endpoint: no BLITZY_REFRESH_URL — {base}/auth/refresh is used.
    'POST /auth/refresh': { status: 200, body: { access_token: platform, refresh_token: 'r2' } },
    'POST /auth': () => { exchanges.push(1); return { status: 401, body: { message: 'should not be called' } } }
  }, { store, env: {} })

  const token = await api.platformToken()
  expect(token).toBe(platform)
  expect(exchanges).toHaveLength(0) // platform token came straight from the refresh
  expect(store.get('platformToken')).toBe(platform)
  expect(store.get('refreshToken')).toBe('r2')
})

test('platformToken reports session expiry as an auth error when refresh is unavailable', async () => {
  const store = new Store(new MemBacking({ workosToken: 'revoked', refreshToken: 'r1' }))
  const { api } = apiWith({
    'POST /auth': { status: 401, body: { message: 'Jwt is expired' } }
  }, { store, env: {} }) // no BLITZY_REFRESH_URL -> refresh disabled

  try {
    await api.platformToken()
    throw new Error('should have thrown')
  } catch (err) {
    expect(err.message).toMatch(/Session expired\. Run `blitzy login` again\./)
    expect(err.kind).toBe('auth')
    expect(err.status).toBe(401)
  }
})

test('platformToken flags an invalid BLITZY_TOKEN distinctly', async () => {
  const { api } = apiWith({
    'POST /auth': { status: 401, body: { message: 'Jwt is expired' } }
  }, { env: { BLITZY_TOKEN: 'stale-env-token' } })

  try {
    await api.platformToken()
    throw new Error('should have thrown')
  } catch (err) {
    expect(err.message).toMatch(/BLITZY_TOKEN is invalid or expired/)
    expect(err.kind).toBe('auth')
  }
})
