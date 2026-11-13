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

test('login token path with --refresh-token stores both tokens', async () => {
  const { api, store } = setup({
    'POST /auth': { status: 200, body: { access_token: futureJwt() } },
    'GET /user/profile': { status: 200, body: profile }
  })
  await login.doLogin({ token: 'wtok', 'refresh-token': 'rtok' }, { api, store, io: { isTty: false } })
  expect(store.get('workosToken')).toBe('wtok')
  expect(store.get('refreshToken')).toBe('rtok')
})

test('login token path without --refresh-token drops a refresh token from an earlier login', async () => {
  const { api, store } = setup({
    'POST /auth': { status: 200, body: { access_token: futureJwt() } },
    'GET /user/profile': { status: 200, body: profile }
  }, { backing: { workosToken: 'old-wtok', refreshToken: 'old-rtok' } })
  await login.doLogin({ token: 'wtok' }, { api, store, io: { isTty: false } })
  expect(store.get('workosToken')).toBe('wtok')
  expect(store.get('refreshToken')).toBeFalsy()
})

test('a failed --token login puts back the session that was stored before', async () => {
  const before = { email: 'a@b.com', userId: 'user_1', workosToken: 'good-wtok', refreshToken: 'good-rtok', platformToken: 'ptok', platformTokenExp: 123 }
  const { api, store } = setup({
    'POST /auth': { status: 401, body: { error: 'Invalid credentials' } }
  }, { backing: before })
  await expect(
    login.doLogin({ token: 'x', 'refresh-token': 'x' }, { api, store, io: { isTty: false } })
  ).rejects.toThrow('Blitzy rejected the token. No stored login was changed.')
  expect(store.all()).toEqual(before)
})

test('a failed --token login with nothing stored before leaves the store empty', async () => {
  const { api, store } = setup({ 'POST /auth': { status: 401, body: { error: 'Invalid credentials' } } })
  await expect(login.doLogin({ token: 'x' }, { api, store, io: { isTty: false } })).rejects.toThrow()
  expect(store.all()).toEqual({})
})

test('login rejects --refresh-token without --token', async () => {
  const { api, store, client } = setup({})
  await expect(
    login.doLogin({ 'refresh-token': 'rtok' }, { api, store, io: { isTty: true } })
  ).rejects.toThrow(/together with --token/)
  expect(client.calls).toHaveLength(0)
})

// Hidden-prompt stub: returns the answers in order and records the labels.
function hiddenPrompts (answers) {
  const labels = []
  return { labels, promptHidden: async (label) => { labels.push(label); return answers.shift() } }
}

const tokenRoutes = {
  'POST /auth': { status: 200, body: { access_token: futureJwt() } },
  'GET /user/profile': { status: 200, body: profile }
}

test('login --token without a value prompts (hidden) for both tokens', async () => {
  const { api, store } = setup(tokenRoutes)
  const prompts = hiddenPrompts([' wtok ', 'rtok\n'])
  const result = await login.doLogin({ token: '' }, { api, store, io: { isTty: true }, prompts })
  expect(result.method).toBe('token')
  expect(prompts.labels).toHaveLength(2)
  expect(prompts.labels[0]).toContain('workos_session_token')
  expect(prompts.labels[1]).toContain('workos_refresh_token')
  expect(store.get('workosToken')).toBe('wtok')
  expect(store.get('refreshToken')).toBe('rtok')
})

test('login --token prompt: Enter skips the refresh token', async () => {
  const { api, store } = setup(tokenRoutes, { backing: { refreshToken: 'old-rtok' } })
  const prompts = hiddenPrompts(['wtok', ''])
  await login.doLogin({ token: '' }, { api, store, io: { isTty: true }, prompts })
  expect(store.get('workosToken')).toBe('wtok')
  expect(store.get('refreshToken')).toBeFalsy()
})

test('login --token without a value does not prompt for a refresh token given as a value', async () => {
  const { api, store } = setup(tokenRoutes)
  const prompts = hiddenPrompts(['wtok'])
  await login.doLogin({ token: '', 'refresh-token': 'rtok' }, { api, store, io: { isTty: true }, prompts })
  expect(prompts.labels).toHaveLength(1)
  expect(store.get('refreshToken')).toBe('rtok')
})

test('login --token <value> --refresh-token without a value prompts for the refresh token only', async () => {
  const { api, store } = setup(tokenRoutes)
  const prompts = hiddenPrompts(['rtok'])
  await login.doLogin({ token: 'wtok', 'refresh-token': '' }, { api, store, io: { isTty: true }, prompts })
  expect(prompts.labels).toHaveLength(1)
  expect(prompts.labels[0]).toContain('workos_refresh_token')
  expect(store.get('workosToken')).toBe('wtok')
  expect(store.get('refreshToken')).toBe('rtok')
})

test('login --token <value> does not prompt', async () => {
  const { api, store } = setup(tokenRoutes)
  const prompts = hiddenPrompts([])
  await login.doLogin({ token: 'wtok' }, { api, store, io: { isTty: true }, prompts })
  expect(prompts.labels).toHaveLength(0)
})

test('login --token without a value needs an interactive terminal', async () => {
  const { api, store, client } = setup(tokenRoutes)
  await expect(
    login.doLogin({ token: '' }, { api, store, io: { isTty: false }, prompts: hiddenPrompts([]) })
  ).rejects.toThrow('--token needs a value when there is no interactive terminal.')
  expect(client.calls).toHaveLength(0)
  expect(store.get('workosToken')).toBeUndefined()
})

test('login --token prompt rejects an empty access token', async () => {
  const { api, store, client } = setup(tokenRoutes)
  await expect(
    login.doLogin({ token: '' }, { api, store, io: { isTty: true }, prompts: hiddenPrompts(['']) })
  ).rejects.toThrow('Access token is required.')
  expect(client.calls).toHaveLength(0)
})

const codeRoutes = (verify) => ({
  'POST /auth/magic-link': { status: 202, body: { message: 'Check your inbox' } },
  'POST /auth/magic-link/verify-code': verify || { status: 200, body: { next_step: 'signed_in', refresh_token: 'rtok', user_id: 'user_1', workos_access_token: 'wtok' } },
  'POST /auth': { status: 200, body: { access_token: futureJwt() } },
  'GET /user/profile': { status: 200, body: profile }
})

test('login code path sends a code, prompts for it, and stores the session', async () => {
  const { api, store, client } = setup(codeRoutes())
  const answers = ['andrew.goode@livtech.com', '708916']
  const questions = []
  const prompts = { promptLine: async (q) => { questions.push(q); return answers.shift() } }
  const result = await login.doLogin({}, { api, store, io: { isTty: true }, prompts })
  expect(result.method).toBe('code')
  expect(questions[1]).toContain('andrew.goode@livtech.com')
  const verify = client.calls.find((c) => c.url.endsWith('/verify-code'))
  expect(JSON.parse(verify.init.body)).toEqual({ email: 'andrew.goode@livtech.com', code: '708916' })
  expect(store.get('email')).toBe('andrew.goode@livtech.com')
  expect(store.get('workosToken')).toBe('wtok')
  expect(store.get('refreshToken')).toBe('rtok')
  expect(store.get('userId')).toBe('user_1')
})

test('login without a terminal sends the code and stops (two-step, step 1)', async () => {
  const { api, store, client } = setup(codeRoutes())
  const result = await login.doLogin({ email: 'a@b.com' }, { api, store, io: { isTty: false } })
  expect(result).toEqual({ codeSent: true, email: 'a@b.com' })
  expect(client.countOf('POST', '/auth/magic-link')).toBe(1)
  expect(client.countOf('POST', '/verify-code')).toBe(0)
  expect(store.get('workosToken')).toBeUndefined()
  const out = await captureLog(() => login.renderLogin(result))
  expect(out).toContain('Sign-in code sent to a@b.com.')
  expect(out).toContain('blitzy login --email a@b.com --code <code>')
})

test('login with --code verifies without sending a new code (two-step, step 2)', async () => {
  const { api, store, client } = setup(codeRoutes())
  const result = await login.doLogin({ email: 'a@b.com', code: ' 012345 ' }, { api, store, io: { isTty: false } })
  expect(result.method).toBe('code')
  expect(client.calls.filter((c) => c.url.endsWith('/auth/magic-link'))).toHaveLength(0)
  const verify = client.calls.find((c) => c.url.endsWith('/verify-code'))
  expect(JSON.parse(verify.init.body)).toEqual({ email: 'a@b.com', code: '012345' })
  expect(store.get('workosToken')).toBe('wtok')
})

test('login asks again after a wrong code while attempts are left', async () => {
  let n = 0
  const { api, store } = setup(codeRoutes(() => ++n === 1
    ? { status: 400, body: { attempts_left: 9, error: 'This code is invalid or has expired', errorCode: 'CODE_INVALID' } }
    : { status: 200, body: { next_step: 'signed_in', refresh_token: 'rtok', user_id: 'user_1', workos_access_token: 'wtok' } }))
  const answers = ['000000', '708916']
  const questions = []
  const prompts = { promptLine: async (q) => { questions.push(q); return answers.shift() } }
  const result = await login.doLogin({ email: 'a@b.com' }, { api, store, io: { isTty: true }, prompts })
  expect(result.method).toBe('code')
  expect(n).toBe(2)
  expect(questions[1]).toContain('9 tries left')
})

test('login with --code does not ask again after a wrong code', async () => {
  const { api, store, client } = setup(codeRoutes({ status: 400, body: { attempts_left: 9, error: 'This code is invalid or has expired', errorCode: 'CODE_INVALID' } }))
  await expect(
    login.doLogin({ email: 'a@b.com', code: '000000' }, { api, store, io: { isTty: true } })
  ).rejects.toThrow('This code is invalid or has expired')
  expect(client.countOf('POST', '/verify-code')).toBe(1)
  expect(store.get('workosToken')).toBeUndefined()
})

test('login stops when no attempts are left', async () => {
  const { api, store, client } = setup(codeRoutes({ status: 400, body: { attempts_left: 0, error: 'Too many attempts', errorCode: 'CODE_LOCKED' } }))
  const prompts = { promptLine: async () => '000000' }
  await expect(
    login.doLogin({ email: 'a@b.com' }, { api, store, io: { isTty: true }, prompts })
  ).rejects.toThrow('Too many attempts')
  expect(client.countOf('POST', '/verify-code')).toBe(1)
})

test('login refuses an SSO account with a helpful message', async () => {
  const { api, store } = setup(codeRoutes({ status: 403, body: { error: 'sso_required', errorCode: 'SSO_REQUIRED' } }))
  await expect(
    login.doLogin({ email: 'x@corp.com', code: '123456' }, { api, store, io: { isTty: false } })
  ).rejects.toThrow(/must sign in with SSO.*run `blitzy login --token`/)
})

test('login errors clearly when Blitzy returns no session', async () => {
  const { api, store } = setup(codeRoutes({ status: 200, body: { next_step: 'sign_up', email_proof: 'proof' } }))
  await expect(
    login.doLogin({ email: 'nobody@x.com', code: '123456' }, { api, store, io: { isTty: false } })
  ).rejects.toThrow(/did not return a session for nobody@x.com \(next step: sign_up\)/)
  expect(store.get('workosToken')).toBeUndefined()
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
  // the list shows the run status, not the constant project `status`
  expect(out.split('\n')[0]).toMatch(/STAGE\s+RUN STATUS\s+DONE/)
  expect(out).toContain(projectDetail.currentStatus.status)
  expect(out).not.toContain('GITHUB_COMPLETED')
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
    authenticated: async () => true,
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
    authenticated: async () => true,
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
  expect(out).toContain('186,825 / 1,250,000 (14.9%, 1,063,175 left)')
  expect(out).toContain('Hours saved')
  // no overage and nothing reserved: those lines are left out
  expect(out).not.toContain('overage')
  expect(out).not.toContain('reserved')
})

test('usage shows reserved lines and overage only when they are more than zero', async () => {
  const u = Object.assign({}, usageFixture, {
    reservedLinesGenerated: 12000,
    costLinesGeneratedOverage: 1250.5,
    chargeLinesGeneratedOverage: 0.5,
    costLinesOnboardedOverage: 0
  })
  const out = await captureLog(() => usage.renderUsage({ usage: u }))
  expect(out).toMatch(/^Lines reserved +12,000$/m)
  expect(out).toMatch(/^Generated overage +1,250\.5 \(rate 0\.5 per line\)$/m)
  expect(out).not.toContain('Onboarded overage')
})

test('usage says when the API reports no quota', async () => {
  const out = await captureLog(() => usage.renderUsage({ usage: { linesGenerated: 500, linesOnboarded: 900, quotaLinesOnboarded: 0 } }))
  expect(out).toMatch(/^Lines generated +500 \(no quota reported\)$/m)
  expect(out).toMatch(/^Lines onboarded +900 \(no quota reported\)$/m)
})

test('usage explains a 403 with the role rule from the Blitzy docs', async () => {
  const lines = []
  const api = { usage: async () => { const e = new Error('You do not have permission to perform this action'); e.status = 403; throw e } }
  await usage.handle({}, {}, { api, errio: { stderr: (l) => lines.push(l), exit: () => {} } })
  expect(lines[0]).toBe('You do not have permission to perform this action Usage statistics are for the Admin and Super Admin roles.')
})

// --- v1.1: gh metadata + raw runs in detail results ---

test('projects detail reports gh metadata and skips enrichment when gh is unauthenticated', async () => {
  const { api } = projectDetailApi()
  const gh = {
    available: async () => true,
    authenticated: async () => false,
    prView: async () => { throw new Error('prView() should not be called when unauthenticated') }
  }
  const result = await projects.doProjects({ uuid: '50930af1-5165-41e6-89a3-7d4445ba4593' }, { api, gh })
  expect(result.ghUsed).toBe(false)
  expect(result.gh).toEqual({ enabled: true, available: true, authenticated: false, used: false, truncatedAt: null })
  const out = await captureLog(() => projects.renderDetail(result))
  expect(out).toContain('gh installed but not authenticated')
})

test('projects detail carries the raw runs payload through for --json consumers', async () => {
  const { api } = projectDetailApi()
  const result = await projects.doProjects({ uuid: '50930af1-5165-41e6-89a3-7d4445ba4593' }, { api })
  expect(result.runs).toBeTruthy()
  expect(Array.isArray(result.runs.runs)).toBe(true)
  expect(result.gh.enabled).toBe(false) // no gh wrapper supplied
})
