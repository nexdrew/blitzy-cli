'use strict'

const { test, expect } = require('bun:test')
const { BlitzyApi } = require('../src/api')
const { Store } = require('../src/store')
const { MemBacking, routeClient, makeJwt, captureLog } = require('./helpers')

const login = require('../src/commands/login')
const whoami = require('../src/commands/whoami')
const logout = require('../src/commands/logout')
const projects = require('../src/commands/projects')
const usage = require('../src/commands/usage')

const profile = require('./fixtures/profile.json')
const projectsList = require('./fixtures/projects-list.json')
const projectDetail = require('./fixtures/project-detail.json')
const projectRepos = require('./fixtures/project-repos.json')
const projectRuns = require('./fixtures/project-runs.json')
const usageFixture = require('./fixtures/usage.json')

const futureJwt = () => makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })

function setup (routes, { env, backing } = {}) {
  const store = new Store(new MemBacking(backing || {}))
  const client = routeClient(routes)
  const api = new BlitzyApi({ client, store, env: env || {} })
  return { api, store, client }
}

// --- login ---

test('login token path stores the token and validates via profile', async () => {
  const { api, store } = setup({
    'POST /auth': { status: 200, body: { access_token: futureJwt() } },
    'GET /user/profile': { status: 200, body: profile }
  })
  const result = await login.doLogin({ token: 'wtok' }, { api, store, io: { isTty: false } })
  expect(result.method).toBe('token')
  expect(store.get('workosToken')).toBe('wtok')
  expect(store.get('email')).toBe(profile.email)
  const out = await captureLog(() => login.renderLogin(result))
  expect(out).toContain('Logged in as Andrew Goode <andrew.goode@livtech.com> at LivTech.')
})

test('login password path runs identify -> login -> profile and stores the session', async () => {
  const { api, store } = setup({
    'GET /auth/identify': { status: 200, body: { auth_mechanism: 'Password', sso_configured: false, user_exists: true } },
    'POST /auth/login': { status: 200, body: { refresh_token: 'rtok', user_id: 'user_1', workos_access_token: 'wtok' } },
    'POST /auth': { status: 200, body: { access_token: futureJwt() } },
    'GET /user/profile': { status: 200, body: profile }
  })
  const prompts = { promptLine: async () => 'andrew.goode@livtech.com', promptHidden: async () => 'secret' }
  const result = await login.doLogin({}, { api, store, io: { isTty: true }, prompts })
  expect(result.method).toBe('password')
  expect(store.get('workosToken')).toBe('wtok')
  expect(store.get('refreshToken')).toBe('rtok')
  expect(store.get('userId')).toBe('user_1')
})

test('login refuses an SSO account with a helpful message', async () => {
  const { api, store } = setup({
    'GET /auth/identify': { status: 200, body: { auth_mechanism: 'SSO', auth_provider: 'microsoft', sso_configured: true, user_exists: true } }
  })
  await expect(
    login.doLogin({ email: 'x@corp.com' }, { api, store, io: { isTty: true } })
  ).rejects.toThrow(/SSO sign-in|--token/)
})

test('login errors clearly for an unknown account', async () => {
  const { api, store } = setup({
    'GET /auth/identify': { status: 200, body: { auth_mechanism: 'Password', user_exists: false } }
  })
  await expect(
    login.doLogin({ email: 'nobody@x.com' }, { api, store, io: { isTty: true } })
  ).rejects.toThrow(/No Blitzy account/)
})

// --- whoami ---

test('whoami returns the profile and renders key fields', async () => {
  const { api, store } = setup({
    'POST /auth': { status: 200, body: { access_token: futureJwt() } },
    'GET /user/profile': { status: 200, body: profile }
  }, { backing: { workosToken: 'wtok' } })
  const result = await whoami.doWhoami({}, { api, store, env: {} })
  expect(result.profile.email).toBe('andrew.goode@livtech.com')
  const out = await captureLog(() => whoami.renderWhoami(result))
  expect(out).toContain('Andrew Goode <andrew.goode@livtech.com>')
  expect(out).toContain('ENTERPRISE')
  expect(out).toContain('SUPER_ADMIN')
})

// --- logout ---

test('logout clears creds and reports it', async () => {
  const { store } = setup({}, { backing: { workosToken: 'wtok', email: 'a@b.com' } })
  const result = await logout.doLogout({}, { store, env: {} })
  expect(result.loggedOut).toBe(true)
  expect(store.all()).toEqual({})
  const out = await captureLog(() => logout.renderLogout(result))
  expect(out).toContain('Logged out.')
})

test('logout on empty store says nothing to clear', async () => {
  const { store } = setup({}, {})
  const result = await logout.doLogout({}, { store, env: {} })
  expect(result.loggedOut).toBe(false)
})

// --- projects ---

test('projects list mode fans out and renders a table', async () => {
  const { api } = setup({
    'POST /auth': { status: 200, body: { access_token: futureJwt() } },
    'GET /projects/': (url) => {
      const id = url.split('/projects/')[1].split('?')[0]
      return { status: 200, body: Object.assign({}, projectDetail, { id, name: `Proj ${id.slice(0, 4)}` }) }
    },
    'GET /projects': { status: 200, body: projectsList }
  }, { backing: { workosToken: 'wtok' } })
  const result = await projects.doProjects({}, { api })
  expect(result.mode).toBe('list')
  expect(result.result.projects).toHaveLength(3)
  const out = await captureLog(() => projects.renderList(result))
  expect(out).toContain('NAME')
  expect(out).toContain('Proj 5093')
  expect(out).toContain('90.2%')
  expect(out).toContain('3 total')
  // the full UUID must be shown so it can be pasted into `projects <uuid>`
  expect(out).toContain('50930af1-5165-41e6-89a3-7d4445ba4593')
})

function projectDetailApi () {
  return setup({
    'POST /auth': { status: 200, body: { access_token: futureJwt() } },
    'GET /github/repos': { status: 200, body: projectRepos },
    'GET /runs/metering': { status: 200, body: projectRuns },
    'GET /projects/': { status: 200, body: projectDetail }
  }, { backing: { workosToken: 'wtok' } })
}

// Fake gh: bodies keyed "repo#number", states keyed "repo#number".
function fakeGh (bodies = {}, states = {}) {
  const calls = []
  return {
    calls,
    available: async () => true,
    prView: async (repo, number, fields) => {
      calls.push({ repo, number, fields })
      if (fields.includes('body')) return { body: bodies[`${repo}#${number}`] || '' }
      if (fields.includes('state')) return { state: states[`${repo}#${number}`] }
      return {}
    }
  }
}

test('projects detail mode fetches project + repos + runs and renders GitHub info', async () => {
  const { api } = projectDetailApi()
  const result = await projects.doProjects({ uuid: '50930af1-5165-41e6-89a3-7d4445ba4593' }, { api })
  expect(result.mode).toBe('detail')
  const out = await captureLog(() => projects.renderDetail(result))
  expect(out).toContain('AloraDL Native Port')
  expect(out).toContain('GITHUB_COMPLETED')
  expect(out).toContain('CODEGEN')
  // real GitHub repo + branch, not repoPrefix/repoUrl
  expect(out).toContain('LivTech-Alora/blitzy-pilot-parent')
  expect(out).toContain('main')
  expect(out).not.toContain('aloradl-native-port') // internal repoPrefix must be gone
  // PRs, newest first
  expect(out).toContain('#19')
  expect(out).toContain('#18')
  expect(out).toContain('https://github.com/LivTech-Alora/blitzy-pilot-parent/pull/19')
  expect(out.indexOf('#19')).toBeLessThan(out.indexOf('#18'))
})

test('projects detail uses gh to surface submodule PRs under their parent', async () => {
  const { api } = projectDetailApi()
  const gh = fakeGh(
    { 'LivTech-Alora/blitzy-pilot-parent#19': 'notes\nSubmodule PR created: https://github.com/LivTech-Alora/alora-plus/pull/265\n' },
    { 'LivTech-Alora/alora-plus#265': 'MERGED' }
  )
  const result = await projects.doProjects({ uuid: '50930af1-5165-41e6-89a3-7d4445ba4593' }, { api, gh })
  expect(result.ghUsed).toBe(true)
  const out = await captureLog(() => projects.renderDetail(result))
  expect(out).toContain('submodule LivTech-Alora/alora-plus#265')
  expect(out).toContain('(MERGED)')
  expect(out).toContain('https://github.com/LivTech-Alora/alora-plus/pull/265')
})

test('projects detail caps gh enrichment to the most recent PRs', async () => {
  // 7 PRs, newest (#107) first by created_at.
  const runs = { runs: [], total_count: 7 }
  for (let i = 0; i < 7; i++) {
    const n = 101 + i
    runs.runs.push({
      created_at: 1784000000 + i, // ascending; #107 is newest
      pr_number: n,
      pr_link: `https://github.com/LivTech-Alora/blitzy-pilot-parent/pull/${n}`,
      pr_status: 'PENDING'
    })
  }
  const { api } = setup({
    'POST /auth': { status: 200, body: { access_token: futureJwt() } },
    'GET /github/repos': { status: 200, body: projectRepos },
    'GET /runs/metering': { status: 200, body: runs },
    'GET /projects/': { status: 200, body: projectDetail }
  }, { backing: { workosToken: 'wtok' } })
  const gh = fakeGh() // empty bodies; we only care which PRs get looked up

  const result = await projects.doProjects({ uuid: '50930af1-5165-41e6-89a3-7d4445ba4593' }, { api, gh })

  // only the 5 newest parent PRs get a gh body lookup
  const bodyLookups = gh.calls.filter((c) => c.fields.includes('body'))
  expect(bodyLookups).toHaveLength(projects.GH_ENRICH_LIMIT)
  expect(bodyLookups.map((c) => c.number).sort((a, b) => b - a)).toEqual([107, 106, 105, 104, 103])
  // the two oldest were not enriched (submodules stays undefined)
  expect(result.prs.find((p) => p.number === 102).submodules).toBeUndefined()

  const out = await captureLog(() => projects.renderDetail(result))
  expect(out).toContain('most recent PRs only')
})

test('projects detail --no-gh skips gh entirely', async () => {
  const { api } = projectDetailApi()
  const gh = {
    available: async () => { throw new Error('available() should not be called') },
    prView: async () => { throw new Error('prView() should not be called') }
  }
  const result = await projects.doProjects({ uuid: '50930af1-5165-41e6-89a3-7d4445ba4593', 'no-gh': true }, { api, gh })
  expect(result.ghUsed).toBe(false)
  const out = await captureLog(() => projects.renderDetail(result))
  expect(out).not.toContain('submodule')
})

test('projects detail degrades gracefully when a gh lookup fails', async () => {
  const { api } = projectDetailApi()
  const gh = {
    available: async () => true,
    prView: async () => { throw new Error('gh: not authenticated') }
  }
  const result = await projects.doProjects({ uuid: '50930af1-5165-41e6-89a3-7d4445ba4593' }, { api, gh })
  const out = await captureLog(() => projects.renderDetail(result))
  // parent PRs still render; no submodule lines, no crash
  expect(out).toContain('#19')
  expect(out).not.toContain('submodule')
})

test('renderDetail spaces labels from values even for the longest metering label', async () => {
  const out = await captureLog(() => projects.renderDetail({ project: projectDetail, repos: null, runs: null }))
  // no label should butt directly against its numeric value
  for (const line of out.split('\n')) {
    const m = line.match(/^ {2}([A-Za-z].*?)(\d.*)$/)
    if (m) expect(m[1].endsWith(' ')).toBe(true)
  }
})

test('prsFromRuns sorts by created_at desc, dedups, drops PR-less runs', () => {
  const prs = projects.prsFromRuns(projectRuns)
  expect(prs.map((p) => p.number)).toEqual([19, 18])
})

test('primaryRepo prefers TARGET repo but falls back for the branch', () => {
  const repo = projects.primaryRepo(projectRepos)
  expect(repo.full).toBe('LivTech-Alora/blitzy-pilot-parent')
  expect(repo.branch).toBe('main')
})

// --- usage ---

test('usage renders quota lines with percentages', async () => {
  const { api } = setup({
    'POST /auth': { status: 200, body: { access_token: futureJwt() } },
    'GET /subscriptions/usage': { status: 200, body: usageFixture }
  }, { backing: { workosToken: 'wtok' } })
  const result = await usage.doUsage({}, { api })
  const out = await captureLog(() => usage.renderUsage(result))
  expect(out).toContain('Lines generated')
  expect(out).toContain('186,825 / 1,250,000')
  expect(out).toContain('Hours saved')
})
