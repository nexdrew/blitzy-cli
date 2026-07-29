'use strict'

const { test, expect } = require('bun:test')
const { captureLog, fakeContext } = require('./helpers')

const login = require('../src/commands/login')
const whoami = require('../src/commands/whoami')
const logout = require('../src/commands/logout')
const usage = require('../src/commands/usage')
const rules = require('../src/commands/rules')
const envs = require('../src/commands/envs')
const projects = require('../src/commands/projects')
const download = require('../src/commands/download')

const profile = require('./fixtures/profile.json')
const usageFixture = require('./fixtures/usage.json')
const rulesList = require('./fixtures/rules-list.json')
const ruleDetail = require('./fixtures/rule-detail.json')
const envsList = require('./fixtures/envs-list.json')
const envDetail = require('./fixtures/env-detail.json')
const projectsList = require('./fixtures/projects-list.json')
const projectDetail = require('./fixtures/project-detail.json')

// --- setup (flag definitions) ---

test('command setup() functions wire their flags without throwing', () => {
  const fakeSywac = () => {
    const s = {}
    for (const m of ['boolean', 'number', 'string']) s[m] = () => s
    return s
  }
  for (const cmd of [login, projects, download]) {
    expect(() => cmd.setup(fakeSywac())).not.toThrow()
  }
})

// --- login ---

test('login handle (token path) renders and does not error', async () => {
  const ctx = fakeContext()
  const store = { setSession: () => {}, set: () => {} }
  const api = { profile: async () => profile }
  const out = await captureLog(() => login.handle({ token: 'wtok' }, ctx, { api, store, io: { isTty: false } }))
  expect(out).toContain('Logged in as Andrew Goode')
  expect(ctx.messages).toHaveLength(0)
})

test('login handle routes errors to cliMessage', async () => {
  const ctx = fakeContext()
  const store = { setSession: () => {}, set: () => {}, get: () => null }
  const api = { profile: async () => { throw new Error('bad token') } }
  await login.handle({ token: 'x' }, ctx, { api, store, io: { isTty: false } })
  expect(ctx.messages[0][0]).toBe('bad token')
})

test('renderLogin falls back gracefully with a sparse profile', async () => {
  const out = await captureLog(() => login.renderLogin({ profile: { email: 'x@y.com' } }))
  expect(out).toBe('Logged in as x@y.com.')
  const bare = await captureLog(() => login.renderLogin({ profile: {} }))
  expect(bare).toContain('Blitzy')
})

// --- whoami ---

test('whoami handle renders on success', async () => {
  const ctx = fakeContext()
  const api = { profile: async () => profile }
  const out = await captureLog(() => whoami.handle({}, ctx, { api, store: { get: () => null }, env: {} }))
  expect(out).toContain('andrew.goode@livtech.com')
  expect(ctx.messages).toHaveLength(0)
})

test('whoami handle routes errors to cliMessage', async () => {
  const ctx = fakeContext()
  const api = { profile: async () => { throw new Error('Not logged in.') } }
  await whoami.handle({}, ctx, { api, store: { get: () => null }, env: {} })
  expect(ctx.messages[0][0]).toMatch(/Not logged in/)
})

test('whoami handle --json emits raw profile', async () => {
  const ctx = fakeContext()
  const api = { profile: async () => profile }
  const out = await captureLog(() => whoami.handle({ json: true }, ctx, { api, store: { get: () => null }, env: {} }))
  expect(JSON.parse(out).email).toBe('andrew.goode@livtech.com')
})

// --- logout ---

test('logout handle renders result', async () => {
  const ctx = fakeContext()
  const store = { get: () => 'x', clear: () => {} }
  const out = await captureLog(() => logout.handle({}, ctx, { store, env: {} }))
  expect(out).toContain('Logged out.')
})

// --- usage ---

test('usage handle renders and errors route to cliMessage', async () => {
  const okOut = await captureLog(() => usage.handle({}, fakeContext(), { api: { usage: async () => usageFixture } }))
  expect(okOut).toContain('Lines generated')

  const ctx = fakeContext()
  await usage.handle({}, ctx, { api: { usage: async () => { throw new Error('boom') } } })
  expect(ctx.messages[0][0]).toBe('boom')
})

// --- rules ---

test('rules handle: list, detail, and error paths', async () => {
  const listOut = await captureLog(() => rules.handle({}, fakeContext(), { api: { listRules: async () => rulesList } }))
  expect(listOut).toContain('3 total')

  const detailOut = await captureLog(() => rules.handle({ uuid: 'x' }, fakeContext(), { api: { getRule: async () => ruleDetail } }))
  expect(detailOut).toContain('framework-neutral contract seam')

  const ctx = fakeContext()
  await rules.handle({}, ctx, { api: { listRules: async () => { throw new Error('nope') } } })
  expect(ctx.messages[0][0]).toBe('nope')
})

// --- envs ---

test('envs handle: list, detail, and error paths', async () => {
  const listOut = await captureLog(() => envs.handle({}, fakeContext(), { api: { listEnvironments: async () => envsList } }))
  expect(listOut).toContain('Alora Pilot - Linux Node')

  const detailOut = await captureLog(() => envs.handle({ uuid: 'x' }, fakeContext(), { api: { getEnvironment: async () => envDetail } }))
  expect(detailOut).toContain('Node.js 22.x LTS')

  const ctx = fakeContext()
  await envs.handle({ uuid: 'x' }, ctx, { api: { getEnvironment: async () => { throw new Error('gone') } } })
  expect(ctx.messages[0][0]).toBe('gone')
})

// --- projects ---

test('projects handle: list and json detail', async () => {
  const api = {
    listProjectsDetailed: async () => Object.assign({}, projectsList, {
      projects: projectsList.projects.map((s) => Object.assign({}, projectDetail, { id: s.id }))
    })
  }
  const listOut = await captureLog(() => projects.handle({}, fakeContext(), { api, gh: null }))
  expect(listOut).toContain('AloraDL Native Port')

  const detailApi = { getProjectFull: async () => ({ project: projectDetail, repos: null, runs: null }) }
  const jsonOut = await captureLog(() => projects.handle({ uuid: 'x', json: true }, fakeContext(), { api: detailApi, gh: null }))
  expect(JSON.parse(jsonOut).name).toBe('AloraDL Native Port')
})

test('projects handle routes errors to cliMessage', async () => {
  const ctx = fakeContext()
  await projects.handle({}, ctx, { api: { listProjectsDetailed: async () => { throw new Error('down') } }, gh: null })
  expect(ctx.messages[0][0]).toBe('down')
})

// --- download ---

const dlApi = (docs) => ({
  getProject: async () => ({ name: 'Proj' }),
  downloadDocument: async (id, doc) => {
    if (!(doc in docs)) { const e = new Error('not found'); e.status = 404; throw e }
    return { buffer: Buffer.from(docs[doc]) }
  }
})
const dlIo = () => {
  const io = { files: {}, now: () => new Date(2026, 0, 2, 3, 4), cwd: () => '/w', mkdirp: () => {}, writeFile: (p, b) => { io.files[p] = b } }
  return io
}

test('download handle --json exits 0 with structured output', async () => {
  const ctx = fakeContext()
  const api = dlApi({ project_guide: '# g' })
  const out = await captureLog(() => download.handle({ uuid: 'abcdabcd-0000-0000-0000-000000000000', guide: true, json: true }, ctx, { api, io: dlIo() }))
  const parsed = JSON.parse(out)
  expect(parsed.saved.length + parsed.skipped.length).toBeGreaterThan(0)
  expect(ctx.messages).toHaveLength(0)
})

test('download handle exits non-zero (cliMessage) when nothing saved', async () => {
  const ctx = fakeContext()
  const api = dlApi({}) // nothing available -> all skipped
  await download.handle({ uuid: 'abcdabcd-0000-0000-0000-000000000000', guide: true }, ctx, { api, io: dlIo() })
  expect(ctx.messages).toHaveLength(1)
  expect(ctx.messages[0][1]).toMatch(/skipped guide/)
})

test('download handle prints normally when something saved', async () => {
  const ctx = fakeContext()
  const api = dlApi({ project_guide: '# guide' })
  const out = await captureLog(() => download.handle({ uuid: 'abcdabcd-0000-0000-0000-000000000000', guide: true }, ctx, { api, io: dlIo() }))
  expect(out).toContain('Downloaded to')
  expect(ctx.messages).toHaveLength(0)
})

test('download handle routes unexpected errors to cliMessage', async () => {
  const ctx = fakeContext()
  const api = dlApi({ project_guide: '# g' })
  const io = dlIo()
  io.mkdirp = () => { throw new Error('EACCES: mkdir failed') }
  await download.handle({ uuid: 'abcdabcd-0000-0000-0000-000000000000', guide: true }, ctx, { api, io })
  expect(ctx.messages[0][0]).toMatch(/mkdir failed/)
})

test('renderDownload prints the formatted result', async () => {
  const out = await captureLog(() => download.renderDownload({
    dir: '/w/proj', saved: [{ path: '/w/proj/x.md', bytes: 10 }], skipped: []
  }))
  expect(out).toContain('Downloaded to /w/proj:')
})

// --- render edge cases (empty lists / no PRs) ---

test('empty-list renders say so', async () => {
  expect(await captureLog(() => rules.renderList({ result: { rules: [] } }))).toContain('No rules found.')
  expect(await captureLog(() => envs.renderList({ result: { environments: [] } }))).toContain('No environments found.')
  expect(await captureLog(() => projects.renderList({ result: { projects: [] } }))).toContain('No projects found.')
})

test('project detail renders "none yet" when the repo has no PRs', async () => {
  const out = await captureLog(() => projects.renderDetail({
    project: projectDetail,
    repos: [{ type: 'TARGET', orgName: 'o', repoName: 'r', branchName: 'main' }],
    prs: []
  }))
  expect(out).toContain('none yet')
})
